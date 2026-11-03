import { Dec } from "./finance";

/**
 * Los tres cuadros de dedicación de la ficha (HOTFIX-02 §8): por equipo y perfil, por tipo de ticket y perfil, y por tipo de problema Vincle.
 * Funciones PURAS sobre `loadDedication` (minutos exactos); los tres cuadros salen del mismo conjunto de actividades y concilian: el total de
 * cada cuadro es la suma de sus filas de nivel superior (las filas de detalle por perfil no se suman otra vez). Un porcentaje sin denominador
 * (cero o ausente) es `null` y se presenta como «—», nunca 0 %.
 */
export type PeriodKey = "month" | "prevMonth" | "cum" | "prevYear" | "prevCum";
/** Orden de columnas de los cuadros: mes, mes anterior, CUM, CUM anterior comparable, año anterior completo. */
export const TABLE_PERIODS: PeriodKey[] = ["month", "prevMonth", "cum", "prevCum", "prevYear"];

export type DedProfile = { profile: string; incidentMinutes: string; otherMinutes: string; unclassifiedMinutes: string; minutes: string };
export type DedCause = { cause: string; cls: string; minutes: string };
export type DedPeriod = { totalMinutes: string; profiles: DedProfile[]; causes: DedCause[] };
export type DedMap = Partial<Record<PeriodKey, DedPeriod>>;

/** Perfiles fijos del cuadro (los del Excel de Dennis), en su orden. */
export const FIXED_PROFILES = ["CS N1", "CS N2", "PMO ANA", "PMO DEV", "IT", "Plataforma"] as const;

/** Etiqueta de perfil de la ficha: «IT N3» → IT, «Plataforma N4» → Plataforma; el resto se conserva tal cual (Sin identificar al final). */
export function fichaProfile(label: string): string {
  const l = label.trim();
  if (/^it(\s|$)/i.test(l)) return "IT";
  if (/^(plataforma|plat)(\s|$)/i.test(l)) return "Plataforma";
  const fixed = FIXED_PROFILES.find((p) => p.toLowerCase() === l.toLowerCase());
  return fixed ?? l;
}
const rank = (p: string): number => {
  const i = (FIXED_PROFILES as readonly string[]).indexOf(p);
  return i >= 0 ? i : p === "Sin identificar" ? 1000 : 500;
};

const M = (s: string | undefined): Dec => (s === undefined ? Dec.ZERO : (Dec.parse(s) ?? Dec.ZERO));
export const toHours = (m: Dec): string => m.divInt(60).toString();
/** Fracción parte/total con un redondeo; null si el total es cero (no hay denominador). */
export const share = (part: Dec, total: Dec): string | null => (total.isZero() ? null : part.div(total).toString());

export type Quantity = { minutes: string; hours: string };
const q = (m: Dec): Quantity => ({ minutes: m.toString(), hours: toHours(m) });

// ---------------------------------------------------------------- 1. Equipo y perfil

export type EquipoRow = { profile: string; periods: Record<PeriodKey, Quantity>; share: Record<PeriodKey, string | null> };
export type EquipoTable = { rows: EquipoRow[]; total: Record<PeriodKey, Quantity> };

function minutesByProfile(p: DedPeriod | undefined): Map<string, { total: Dec; incident: Dec; other: Dec; unclassified: Dec }> {
  const out = new Map<string, { total: Dec; incident: Dec; other: Dec; unclassified: Dec }>();
  for (const r of p?.profiles ?? []) {
    const k = fichaProfile(r.profile);
    const cur = out.get(k) ?? { total: Dec.ZERO, incident: Dec.ZERO, other: Dec.ZERO, unclassified: Dec.ZERO };
    cur.total = cur.total.add(M(r.minutes));
    cur.incident = cur.incident.add(M(r.incidentMinutes));
    cur.other = cur.other.add(M(r.otherMinutes));
    cur.unclassified = cur.unclassified.add(M(r.unclassifiedMinutes));
    out.set(k, cur);
  }
  return out;
}

export function equipoTable(d: DedMap): EquipoTable {
  const per = Object.fromEntries(TABLE_PERIODS.map((k) => [k, minutesByProfile(d[k])])) as Record<PeriodKey, ReturnType<typeof minutesByProfile>>;
  const names = new Set<string>(FIXED_PROFILES);
  for (const k of TABLE_PERIODS) for (const n of per[k].keys()) names.add(n);
  const totals = Object.fromEntries(TABLE_PERIODS.map((k) => [k, M(d[k]?.totalMinutes)])) as Record<PeriodKey, Dec>;
  const rows = [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "es")).map((profile) => ({
    profile,
    periods: Object.fromEntries(TABLE_PERIODS.map((k) => [k, q(per[k].get(profile)?.total ?? Dec.ZERO)])) as Record<PeriodKey, Quantity>,
    share: Object.fromEntries(TABLE_PERIODS.map((k) => [k, share(per[k].get(profile)?.total ?? Dec.ZERO, totals[k])])) as Record<PeriodKey, string | null>,
  }));
  return { rows, total: Object.fromEntries(TABLE_PERIODS.map((k) => [k, q(totals[k])])) as Record<PeriodKey, Quantity> };
}

// ---------------------------------------------------------------- 2. Tipo de ticket y perfil

export const TICKET_TYPES = [
  { cls: "incident", label: "Incidente/Problema Vincle" },
  { cls: "other", label: "Otro soporte" },
  { cls: "unclassified", label: "Causa pendiente" },
] as const;
export type TicketTypeKey = (typeof TICKET_TYPES)[number]["cls"];
export type TicketGroup = { cls: TicketTypeKey; label: string; total: Record<PeriodKey, Quantity>; profiles: EquipoRow[] };
export type TicketTable = { groups: TicketGroup[]; total: Record<PeriodKey, Quantity> };

export function ticketTable(d: DedMap): TicketTable {
  const per = Object.fromEntries(TABLE_PERIODS.map((k) => [k, minutesByProfile(d[k])])) as Record<PeriodKey, ReturnType<typeof minutesByProfile>>;
  const pick = (cls: TicketTypeKey, v: { incident: Dec; other: Dec; unclassified: Dec }) => (cls === "incident" ? v.incident : cls === "other" ? v.other : v.unclassified);
  const groups: TicketGroup[] = TICKET_TYPES.map(({ cls, label }) => {
    const gTotal = Object.fromEntries(TABLE_PERIODS.map((k) => [k, [...per[k].values()].reduce((a, v) => a.add(pick(cls, v)), Dec.ZERO)])) as Record<PeriodKey, Dec>;
    const names = new Set<string>();
    for (const k of TABLE_PERIODS) for (const [n, v] of per[k]) if (!pick(cls, v).isZero()) names.add(n);
    const profiles = [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "es")).map((profile) => ({
      profile,
      periods: Object.fromEntries(TABLE_PERIODS.map((k) => [k, q(pick(cls, per[k].get(profile) ?? { incident: Dec.ZERO, other: Dec.ZERO, unclassified: Dec.ZERO }))])) as Record<PeriodKey, Quantity>,
      // % dentro del tipo de ticket (como el cuadro del Excel): las filas de perfil de un tipo suman 100 % de ese tipo.
      share: Object.fromEntries(TABLE_PERIODS.map((k) => [k, share(pick(cls, per[k].get(profile) ?? { incident: Dec.ZERO, other: Dec.ZERO, unclassified: Dec.ZERO }), gTotal[k])])) as Record<PeriodKey, string | null>,
    }));
    return { cls, label, total: Object.fromEntries(TABLE_PERIODS.map((k) => [k, q(gTotal[k])])) as Record<PeriodKey, Quantity>, profiles };
  });
  // Total = suma de los TRES tipos (una vez); las filas de perfil son detalle y no se suman otra vez.
  const total = Object.fromEntries(TABLE_PERIODS.map((k) => [k, q(groups.reduce((a, g) => a.add(M(g.total[k].minutes)), Dec.ZERO))])) as Record<PeriodKey, Quantity>;
  return { groups, total };
}

// ---------------------------------------------------------------- 3. Tipo de problema Vincle

export const PROBLEM_TYPES = [
  { key: "integracion", label: "Integración/Procesos", cause: "incidente_integración/procesos" },
  { key: "configuracion", label: "Configuración", cause: "incidente_configuración_plataforma" },
  { key: "personalizacion", label: "Personalización", cause: "incidente_customización_plataforma" },
  { key: "estandar", label: "Estándar", cause: "incidente_estándar_plataforma" },
  { key: "infra", label: "Infraestructura CLOUD", cause: "incidente_infraestructura" },
] as const;
export type ProblemRow = { key: string; label: string; cum: Quantity; shareOfDedicated: string | null; shareOfTarget: string | null; prevCum: Quantity };
export type ProblemTable = { rows: ProblemRow[]; total: ProblemRow; omittedInfra: boolean };

/**
 * Horas de Incidente/Problema Vincle por tipo de problema (causa raíz). La infraestructura solo es incidente Vincle con alojamiento CLOUD a la fecha
 * del trabajo (lo decide `loadDedication`); su fila «procede» si tiene horas en el CUM o en el CUM anterior comparable. % sobre horas dedicadas
 * (todas las del periodo) y % sobre horas objetivo (null si el ámbito no tiene ingreso propio o es cero).
 */
export function problemTable(d: DedMap, targetHoursCum: string | null): ProblemTable {
  const sumCause = (p: DedPeriod | undefined, cause: string): Dec =>
    (p?.causes ?? []).filter((c) => c.cls === "INCIDENTE_VINCLE" && c.cause.toLowerCase() === cause).reduce((a, c) => a.add(M(c.minutes)), Dec.ZERO);
  const totalDed = M(d.cum?.totalMinutes);
  const target = targetHoursCum === null ? null : Dec.parse(targetHoursCum);
  const mk = (key: string, label: string, cum: Dec, prev: Dec): ProblemRow => ({
    key, label, cum: q(cum), prevCum: q(prev),
    shareOfDedicated: share(cum, totalDed),
    // horas objetivo ya en horas: minutos / 60 / objetivo
    shareOfTarget: target === null || target.isZero() ? null : cum.divInt(60).div(target).toString(),
  });
  const all = PROBLEM_TYPES.map((t) => ({ t, cum: sumCause(d.cum, t.cause), prev: sumCause(d.prevCum, t.cause) }));
  const omittedInfra = all.find((x) => x.t.key === "infra")!.cum.isZero() && all.find((x) => x.t.key === "infra")!.prev.isZero();
  const shown = all.filter((x) => x.t.key !== "infra" || !omittedInfra);
  const rows = shown.map((x) => mk(x.t.key, x.t.label, x.cum, x.prev));
  const cumTotal = shown.reduce((a, x) => a.add(x.cum), Dec.ZERO);
  const prevTotal = shown.reduce((a, x) => a.add(x.prev), Dec.ZERO);
  return { rows, total: mk("total", "Totales", cumTotal, prevTotal), omittedInfra };
}
