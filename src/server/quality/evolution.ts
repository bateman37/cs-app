import { Prisma } from "@/generated/prisma/client";
import { todayMadrid } from "@/domain/vigencia";
import { type QualityConfig } from "@/domain/quality-config";
import type { Coverage, CoverageSource } from "@/domain/quality-coverage";
import { qualityPeriod, type QualityPeriod, type QualityQuery } from "@/domain/quality-query";
import { loadGroupMetaForCuts } from "@/server/analytics/portfolio";
import { snapshotPoint, type Tx } from "@/server/analytics/snapshot";
import { getActive } from "@/server/pulse/config";
import { selectorsOf } from "@/server/pulse/sql";
import { loadDeclarations, loadTicketBatches } from "./coverage";
import { cov, evaluateMonth, loadEntities, loadStocks, loadUsers, snapshotOf, type BacklogInfo, type MonthFacts, type QualityRow, type StockEntity } from "./engine";
import { hourFactsByPeriod, papFactsByPeriod, ticketFactsByPeriod, type FactPeriod } from "./facts";
import { loadHealthForMonths } from "./health";

/**
 * Lectura por CONJUNTOS de la evolución mensual de una ficha (CSAPP-10 §5). Separa la obtención de hechos de la evaluación:
 *  - OBTENCIÓN: cada familia de hechos se lee UNA vez para todos los meses (tickets, PAP y horas agrupados por mes; usuarios de todos los años necesarios;
 *    atributos vigentes de todos los cortes; stock de cada fotografía distinta; Health de la entidad; declaraciones y lotes de tickets una sola vez).
 *    El número de sentencias no depende del número de meses.
 *  - EVALUACIÓN: `evaluateMonth` (el mismo evaluador puro de la cartera y la ficha) con los hechos de cada mes: su cohorte, usuarios, cobertura, fotografía
 *    (política EXACT / última anterior), referencias por percentiles recalculadas con la cohorte de ESE mes y los seis pesos. No hay otra fórmula de colores.
 * Misma instantánea (la transacción del llamador), misma revisión activa y mismos puntos de sincronización de la lectura coherente que la ficha.
 */
export type EvolutionMonthResult = { month: number; period: QualityPeriod; row: QualityRow | null; backlog: BacklogInfo };
export type EvolutionSource = { meta: { qualityRevision: number; qualityPersisted: boolean; pulseRevision: number }; months: EvolutionMonthResult[] };

/** Periodos mensuales de la serie: meses completos hasta el anterior al del corte y el mes del corte con su fecha y modo (mismos que evaluaría la ficha mensual). */
export function evolutionMonths(q: QualityQuery, today: string): { lastM: number; months: { month: number; q: QualityQuery; period: QualityPeriod }[]; year: number; per: QualityPeriod } {
  const per = qualityPeriod(q.base.date, q.base.mode, today);
  const lastM = per.future ? 0 : per.month;
  const todayM = todayMadrid(new Date(`${today}T12:00:00Z`));
  const months: { month: number; q: QualityQuery; period: QualityPeriod }[] = [];
  for (let m = 1; m <= lastM; m++) {
    const date = m === lastM ? q.base.date : `${per.year}-${String(m).padStart(2, "0")}-01`;
    const mode = m === lastM ? q.base.mode : "FULL_MONTH";
    const qm: QualityQuery = { ...q, base: { ...q.base, date, mode, q: "", page: 1, pageSize: 1, status: "todos" }, sel: "", color: "", sim: "" };
    months.push({ month: m, q: qm, period: qualityPeriod(date, mode, todayM) });
  }
  return { lastM, months, year: per.year, per };
}

export async function evolutionRows(tx: Tx, q: QualityQuery, id: string, cfg: QualityConfig, today: string): Promise<EvolutionSource | null> {
  const { months } = evolutionMonths(q, today);
  if (months.length === 0) return null;
  const scope = q.scope;
  const active = await getActive(tx, "QUALITY", q.qrev ?? undefined);
  const pulse = await getActive(tx, "PULSE", q.prev ?? undefined);

  // --- Maestros vigentes de cada corte (dos consultas) y entidades
  const groupsByCut = await loadGroupMetaForCuts(tx, months.map((m) => m.period.cut));
  await snapshotPoint("quality:after-meta");
  const all = await loadEntities(tx, scope, groupsByCut.get(months[0].period.cut) ?? []);
  const ids = all.map((e) => e.id);
  const declarations = await loadDeclarations(tx);
  const ticketBatches = await loadTicketBatches(tx);

  // --- Hechos de todos los meses, por conjuntos
  const periods: FactPeriod[] = months.map((m, i) => ({ k: i, from: m.period.from, to: m.period.cut }));
  const tByP = await ticketFactsByPeriod(tx, scope, ids, periods);
  await snapshotPoint("quality:after-tickets");
  const pByP = await papFactsByPeriod(tx, scope, ids, periods);
  const hByP = await hourFactsByPeriod(tx, scope, ids, periods, selectorsOf(pulse.payload));
  await snapshotPoint("quality:after-hours");
  // El Client Health solo interviene en la fila evaluada (la cohorte de referencia no lo usa): se lee el de la entidad de la ficha, todos los meses de una vez.
  const healthByMonth = await loadHealthForMonths(tx, scope, [id], months[0].period.year, months.map((m) => m.month));

  // --- Fotografías: una compatible por mes según la política; cada fotografía distinta se lee una sola vez
  const snaps = months.map((m) => snapshotOf(m.period.cut, ticketBatches, cfg));
  const photos = new Map<string, { batchId: string; observedOn: string }>();
  for (const s of snaps) if (s.usedBatch && s.observedOn) photos.set(s.usedBatch.batchId, { batchId: s.usedBatch.batchId, observedOn: s.observedOn });
  const stockByBatch = await loadStocks(tx, scope, ids, [...photos.values()], cfg.incidents.concerningDays, cfg.incidents.ageBands);
  await snapshotPoint("quality:after-stock");
  const years = [...new Set([...months.map((m) => m.period.year), ...snaps.flatMap((s) => (s.dYM ? [s.dYM.y] : []))])];
  const users = await loadUsers(tx, scope, ids, years);
  const bugSource = (await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM "WorkItemObservation" o JOIN "UploadBatch" b ON b.id = o."batchId" AND b.status = 'COMPLETED'`))[0].n > 0n;
  const unresolvedLinks = Number((await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM "WorkItemLink" WHERE "drvState" IN ('PENDING_TICKET', 'NO_CLIENT') AND COALESCE("manualState", '') <> 'REJECTED'`))[0].n);

  // --- Evaluación de cada mes con el evaluador común y los hechos de ese mes
  const out: EvolutionMonthResult[] = [];
  months.forEach((m, i) => {
    const { period } = m;
    const s = snaps[i];
    const covOf = (source: CoverageSource): Coverage => cov(declarations, source, period.from, period.cut);
    const facts: MonthFacts = {
      period, groups: groupsByCut.get(period.cut) ?? [], all, users, usersD: s.dYM ? users : null, dYM: s.dYM,
      tFacts: tByP.get(i) ?? new Map(), pFacts: pByP.get(i) ?? new Map(), hourRows: hByP.get(i) ?? [], healthMap: healthByMonth.get(m.month) ?? new Map(),
      coverage: { tickets: covOf("tickets"), zd_time: covOf("zd_time"), wrike_time: covOf("wrike_time"), pap: covOf("pap") }, bugSource, unresolvedLinks,
      choice: s.choice, usedBatch: s.usedBatch, observedOn: s.observedOn,
      stock: s.usedBatch ? (stockByBatch.get(s.usedBatch.batchId) ?? new Map<string, StockEntity>()) : new Map<string, StockEntity>(), backlog: s.backlog,
    };
    const { evaluateAll } = evaluateMonth(facts, { ...m.q, sel: id }, cfg, pulse.payload.references, new Set([id]));
    out.push({ month: m.month, period, row: evaluateAll(cfg).get(id) ?? null, backlog: s.backlog });
  });
  return { meta: { qualityRevision: active.revisionNo, qualityPersisted: active.persisted, pulseRevision: pulse.revisionNo }, months: out };
}
