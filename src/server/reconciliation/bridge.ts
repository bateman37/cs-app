import { buildPeriods, type CutMode } from "@/domain/finance";
import { parsePulseQuery, type PulsePeriod } from "@/domain/pulse-query";
import { todayMadrid } from "@/domain/vigencia";
import type { Tx } from "@/server/analytics/snapshot";
import { economicsInTx, PERIOD_KEYS, type EconomicScope, type PeriodKey } from "@/server/economics/engine";
import { computePulse } from "@/server/pulse/service";
import type { HourRow, PapFacts, TicketFacts } from "@/server/quality/facts";
import { compare, d, mk, ZERO, type Check } from "./checks";

/**
 * Puente de conciliación de Comparativa, Análisis Cliente, Pulse Rent y Calidad (CSAPP-10 §10). Nivel 4. Se ejecuta en la MISMA lectura coherente que los
 * niveles 1-3 y SOLO LEE: no es otro motor; llama a los mismos servicios que las pantallas (`economicsInTx` para Comparativa y Análisis Cliente,
 * `computePulse` para Pulse Rent, `hourFacts`/`ticketFacts`/`papFacts` para Calidad) con el MISMO periodo, servicio y ámbito, y compara solo lo que
 * comparte perímetro y unidad. Calidad se contrasta con sus indicadores (tickets, PAP, horas elegibles), nunca forzando igualdad con las horas de otro perfil o
 * filtro financiero. El periodo del informe debe coincidir con uno de los cinco periodos de las pantallas; si no, el puente lo dice y no inventa nada.
 */
export type BridgeInput = {
  p: { scope: "group" | "client"; sel: string; desde: string; hasta: string; servicio: "SOPORTE" | "ADMIN_DELEGADA" | "OTROS" | "TOTAL" };
  from: string;
  to: string;
  ids: string[];
  hf: HourRow[];
  tf: Map<string, TicketFacts>;
  pf: Map<string, PapFacts>;
  now?: Date;
};

const PULSE_OF: Record<PeriodKey, PulsePeriod> = { month: "mes", prevMonth: "anterior", cum: "cum", prevYear: "anioant", prevCum: "cumant" };
const PERIOD_LABEL: Record<PeriodKey, string> = { month: "Mes seleccionado", prevMonth: "Mes anterior", cum: "CUM actual", prevYear: "Año anterior completo", prevCum: "CUM anterior comparable" };
const SOURCES = ["economicsInTx (Comparativa y Análisis Cliente)", "computePulse (Pulse Rent)", "hourFacts/ticketFacts/papFacts (Calidad)"];

/** El periodo del informe como uno de los cinco periodos de las pantallas (y su modo de corte), o null. */
export function matchScreenPeriod(desde: string, hasta: string, today: string): { key: PeriodKey; mode: CutMode } | null {
  for (const mode of ["FULL_MONTH", "CUTOFF"] as const) {
    let periods;
    try { periods = buildPeriods(hasta, mode, today); } catch { return null; }
    for (const key of PERIOD_KEYS) if (periods[key].from === desde && periods[key].to === hasta) return { key, mode };
  }
  return null;
}

const unavailable = (id: string, title: string, unit: string, why: string): Check =>
  mk({ id, level: 4, title, unit, status: "NO_DISPONIBLE", sources: SOURCES, notes: [why] });

export async function bridgeChecks(tx: Tx, input: BridgeInput): Promise<Check[]> {
  const { p, ids } = input;
  const today = todayMadrid(input.now ?? new Date());
  const titles = {
    h: "Puente · Horas del perímetro de servicio: Comparativa / Análisis Cliente = Calidad (hourFacts elegibles)",
    ph: "Puente · Horas totales (M16): Pulse Rent = Comparativa / Análisis Cliente",
    u: "Puente · Usuarios contratados al corte (M17): Pulse Rent = Comparativa / Análisis Cliente",
    r: "Puente · Horas por usuario mes (M22): numerador y denominador de Pulse Rent = horas y usuarios mes de Comparativa",
    n3: "Puente · Tickets escalados a N3 (M30): Pulse Rent = Calidad (ticketFacts)",
    pap: "Puente · PAP correctivos únicos (M38): Pulse Rent = Calidad (papFacts)",
  };
  const all = (why: string): Check[] => [unavailable("REC-N4-01", titles.h, "min", why), unavailable("REC-N4-02", titles.ph, "h", why), unavailable("REC-N4-03", titles.u, "usuarios", why), unavailable("REC-N4-04", titles.r, "h", why), unavailable("REC-N4-05", titles.n3, "tickets", why), unavailable("REC-N4-06", titles.pap, "PAP", why)];
  const match = matchScreenPeriod(p.desde, p.hasta, today);
  if (!match) return all(`El periodo ${p.desde} – ${p.hasta} no coincide con ninguno de los cinco periodos de Comparativa, Análisis Cliente y Pulse Rent (mes, mes anterior, CUM, año anterior completo, CUM anterior comparable). Para puentear elija «desde» = día 1 del mes (o 1 de enero para el CUM) y «hasta» = corte o fin de mes. No se compara un periodo ajeno.`);
  if (ids.length === 0) return all("No hay entidades en el ámbito seleccionado.");
  const { key, mode } = match;
  const scope: EconomicScope = p.scope === "group" ? { type: "groups", ids } : { type: "clients", ids };
  const econ = await economicsInTx(tx, { scope, service: p.servicio, date: p.hasta, mode, unpaged: true, now: input.now });
  const periodNote = `Periodo de las pantallas: «${PERIOD_LABEL[key]}» (${p.desde} – ${p.hasta}, modo ${mode === "FULL_MONTH" ? "mes completo" : "a fecha de corte"}), servicio ${p.servicio}, ámbito ${p.scope === "group" ? "Grupo Cliente" : "Cliente"}${p.sel ? " (entidad seleccionada)" : " (todas)"}.`;
  const inScope = new Set(ids);
  const series = econ.entities.filter((e) => inScope.has(e.id)).map((e) => ({ e, s: e.periods[key] }));
  const out: Check[] = [];

  // --- N4-01: Comparativa/Análisis Cliente ↔ Calidad (misma magnitud: minutos elegibles del servicio)
  const ecoMinutes = series.reduce((s, x) => s.add(d(x.s.hours.perimeterMinutes)), ZERO);
  const qualityMinutes = input.hf.filter((r) => r.bucketClass === "ELIGIBLE" && (p.servicio === "TOTAL" || r.svc === p.servicio)).reduce((s, r) => s.add(r.minutes), ZERO);
  const exclusions: Check["exclusions"] = [];
  if (key === "cum" && econ.unattributed) exclusions.push({ reason: "Horas elegibles del CUM sin Grupo Cliente (internas, en conflicto o sin ticket): fuera de toda cartera, conciliadas aparte", count: 0, amount: `${econ.unattributed.eligibleHours} h` });
  exclusions.push({ reason: "Horas pendientes de elegibilidad (no entran en el perímetro ni en Calidad)", count: 0, amount: `${series.reduce((s, x) => s.add(d(x.s.hours.pendingEligibility)), ZERO).toString()} h` }, { reason: "Horas excluidas por política (PMO histórico, internas…)", count: 0, amount: `${series.reduce((s, x) => s.add(d(x.s.hours.excluded)), ZERO).toString()} h` });
  out.push(compare(mk({ id: "REC-N4-01", level: 4, title: titles.h, unit: "min", sources: SOURCES, exclusions,
    notes: [periodNote, "Mismo perímetro: horas elegibles del servicio (TimeActivity), atribuidas al ámbito. Comparativa/Análisis Cliente leen los minutos exactos del perímetro; Calidad los suma desde `hourFacts` con el mismo servicio. Las horas de otro perfil o filtro NO se fuerzan a coincidir: la rentabilidad conserva todas las horas, sea cual sea el origen de los tickets."] }), qualityMinutes, ecoMinutes));

  // --- Pulse en la misma lectura: mismo periodo, servicio y ámbito; solo las métricas puenteadas y sin filtros de filas
  const { query } = parsePulseQuery({ fecha: p.hasta, modo: mode, servicio: p.servicio, ambito: p.scope, periodo: PULSE_OF[key], norm: "periodo", m: "M16,M17,M22,M30,M38", estado: "todos", cobertura: "todas" }, input.now ?? new Date());
  const pv = await computePulse(tx, query, { allRows: true });
  const rows = pv.rows.filter((r) => inScope.has(r.id));
  const sumCells = (m: string, f: (c: NonNullable<(typeof rows)[number]["cells"][string]>) => string | null) => rows.reduce((s, r) => s.add(d(r.cells[m] ? f(r.cells[m]) : null)), ZERO);
  const pulseNote = `Pulse Rent leído en la misma lectura: ${rows.length} entidades del ámbito (de ${pv.totalEntities}); periodo ${pv.period.from} – ${pv.period.to}.`;
  if (pv.period.from !== p.desde || pv.period.to !== p.hasta) {
    const why = `Pulse Rent calculó ${pv.period.from} – ${pv.period.to}, distinto del periodo del informe: no se compara.`;
    return [...out, ...all(why).slice(1)];
  }

  // N4-02: horas totales M16 (horas) = Σ minutos del perímetro / 60 (un redondeo por entidad, igual que el motor)
  const ecoHours = series.reduce((s, x) => s.add(d(x.s.hours.perimeterMinutes).divInt(60)), ZERO);
  out.push(compare(mk({ id: "REC-N4-02", level: 4, title: titles.ph, unit: "h", sources: SOURCES, notes: [pulseNote, "Unidad: horas (minutos/60, un redondeo por entidad). Pulse Rent no altera la magnitud al normalizar; solo cambia la referencia estadística, que no interviene aquí."] }), ecoHours, sumCells("M16", (c) => c.raw)));

  // N4-03: usuarios al corte (stock)
  const ecoUsers = series.reduce((s, x) => s.add(d(x.s.users.stock.value === null ? null : String(x.s.users.stock.value))), ZERO);
  const missing = series.filter((x) => x.s.users.stock.value === null).length;
  out.push(compare(mk({ id: "REC-N4-03", level: 4, title: titles.u, unit: "usuarios", sources: SOURCES,
    exclusions: missing ? [{ reason: "Entidades con usuarios sin informar (nulo, distinto de cero): no suman en ninguno de los dos lados", count: missing, amount: null }] : [],
    notes: [pulseNote, "Stock del mes del corte: no se prorratea. Cada Grupo y Cliente conserva sus usuarios propios; el puente suma las entidades del ámbito (el grupo no suma los compartidos de sus hijos)."] }), ecoUsers, sumCells("M17", (c) => c.raw)));

  // N4-04: numerador y denominador de «horas por usuario mes» (M22, variante del periodo); la razón por entidad no se suma
  const hours22 = sumCells("M22", (c) => c.numerator);
  const um22 = sumCells("M22", (c) => c.denominator);
  const ecoUm = series.reduce((s, x) => s.add(d(x.s.users.userMonths)), ZERO);
  out.push(compare(mk({ id: "REC-N4-04", level: 4, title: titles.r, unit: "h + usuarios mes", sources: SOURCES, additive: false,
    notes: [pulseNote, `Numerador (horas): Pulse ${hours22.toString()} frente a Comparativa ${ecoHours.toString()}. Denominador (usuarios mes UM): Pulse ${um22.toString()} frente a Comparativa ${ecoUm.toString()}. El esperado y el observado muestran la SUMA numerador + denominador para detectar cualquier desvío; la razón por entidad no es aditiva y no se suma.`] }), ecoHours.add(ecoUm), hours22.add(um22)));

  // N4-05 / N4-06: Pulse ↔ Calidad (cohorte de CREACIÓN y fecha de producción PAP)
  out.push(compare(mk({ id: "REC-N4-05", level: 4, title: titles.n3, unit: "tickets", sources: SOURCES, notes: [pulseNote, "Unión de ticket_id con destino PMO N3 o IT N3, por fecha de CREACIÓN del ticket (un ticket con varios tags cuenta una vez)."] }), d(String([...input.tf.values()].reduce((s, r) => s + r.n3, 0))), sumCells("M30", (c) => c.raw)));
  out.push(compare(mk({ id: "REC-N4-06", level: 4, title: titles.pap, unit: "PAP", sources: SOURCES, notes: [pulseNote, "PAP únicos (lista + ID) con al menos una causa correctiva y fecha de producción en el periodo; varias causas no multiplican el PAP y el origen cliente participa."] }), d(String([...input.pf.values()].reduce((s, r) => s + r.corrective, 0))), sumCells("M38", (c) => c.raw)));
  return out;
}
