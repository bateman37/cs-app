import { Prisma } from "@/generated/prisma/client";
import { Dec } from "@/domain/finance";
import { todayMadrid } from "@/domain/vigencia";
import { PROFILE_KEYS, PROFILE_LABEL } from "@/domain/pulse-catalog";
import { flowRate, hoursPerUserMonth, type IndicatorKey, type QualityConfig } from "@/domain/quality-config";
import { qualityPeriod, type QualityPeriod, type QualityQuery } from "@/domain/quality-query";
import { diagnosisFamily, type DiagnosisFamily } from "@/domain/quality-config";
import { papSetSql, type selectorsOf, ticketSetSql } from "@/server/pulse/sql";
import { qualitySelectors } from "./selectors";
import { getActive } from "@/server/pulse/config";
import { readSnapshot, type Tx } from "@/server/analytics/snapshot";
import { loadUsers } from "./engine";
import { evolutionMonths } from "./evolution";
import { bugUnion, hourFactsByPeriod, predicate, ticketFactsByPeriod, type FactPeriod, type HourRow, type TicketFacts } from "./facts";
import { selectedEntityIds } from "./detail";

/**
 * Apartados de los seis indicadores de Calidad (HOTFIX-02 §9). Cada apartado sirve la SELECCIÓN actual (Grupos o Clientes que dejan los segmentadores
 * Soporte/Servidor) o, con `sel`, UN objeto: los mismos hechos por conjuntos que el resumen (`facts.ts`), agrupados por mes del año del corte. Una consulta
 * por familia de hechos, nunca una por mes ni por entidad. Las tasas por usuario usan SOLO las entidades con usuarios informados ese mes y lo dicen.
 */
export type MonthCol = { month: number; from: string; to: string; partial: boolean; users: number | null; userMonths: string | null; usersKnown: number };
export type SectionBase = { kpi: IndicatorKey; scopeName: string | null; entities: number; period: QualityPeriod; months: MonthCol[]; usersMissing: number; qualityRevision: number };
const ZERO = Dec.ZERO;
const D = (n: number | string) => (typeof n === "number" ? Dec.int(n) : (Dec.parse(n) as Dec));

type Ctx = { tx: Tx; q: QualityQuery; ids: string[]; base: SectionBase; cfg: QualityConfig; today: string; monthList: ReturnType<typeof evolutionMonths>["months"]; knownUsers: (m: number) => Set<string> };

async function context(tx: Tx, q: QualityQuery, kpi: IndicatorKey, today: string): Promise<Ctx> {
  const per = qualityPeriod(q.base.date, q.base.mode, today);
  const active = await getActive(tx, "QUALITY", q.qrev ?? undefined);
  const { ids, name } = await selectedEntityIds(tx, q, per.cut);
  const { months } = evolutionMonths(q, today);
  const users = await loadUsers(tx, q.scope, ids, [per.year]);
  const known = new Map<number, Set<string>>();
  const cols: MonthCol[] = months.map((m) => {
    let stock = 0; let um = ZERO; const ok = new Set<string>();
    for (const id of ids) {
      const v = users(id, per.year, m.month);
      if (v === null) continue;
      ok.add(id); stock += v; um = um.add(Dec.int(v).ratio(m.period.days, m.period.daysInMonth));
    }
    known.set(m.month, ok);
    return { month: m.month, from: m.period.from, to: m.period.cut, partial: m.period.partial, users: ok.size ? stock : null, userMonths: ok.size ? um.toString() : null, usersKnown: ok.size };
  });
  const last = cols[cols.length - 1];
  const base: SectionBase = { kpi, scopeName: name, entities: ids.length, period: per, months: cols, usersMissing: last ? ids.length - last.usersKnown : ids.length, qualityRevision: active.revisionNo };
  return { tx, q, ids, base, cfg: active.payload, today, monthList: months, knownUsers: (m) => known.get(m) ?? new Set() };
}

const periodsOf = (c: Ctx): FactPeriod[] => c.monthList.map((m) => ({ k: m.month, from: m.period.from, to: m.period.cut }));
const sumFacts = (c: Ctx, by: Map<number, Map<string, TicketFacts>>, month: number, pick: (f: TicketFacts) => number, onlyKnown: boolean): number => {
  let n = 0;
  const ok = c.knownUsers(month);
  for (const [id, f] of by.get(month) ?? []) if (!onlyKnown || ok.has(id)) n += pick(f);
  return n;
};
const rate100 = (n: number, userMonths: string | null): string | null => (userMonths === null ? null : flowRate(n, D(userMonths))?.toString() ?? null);

// ---------------------------------------------------------------- Dedicación

export type HoursLine = { key: string; label: string; group: "CS" | "PMO" | "CONTEXTO" | "OTRO"; role: string | null; inIndicator: boolean; month: string; previous: string | null; cum: string };
export type DedicationSection = SectionBase & {
  lines: HoursLine[];
  groups: { label: string; note: string; month: string; previous: string | null; cum: string }[];
  monthly: { month: number; total: string; selected: string; userMonths: string | null; perUser: string | null }[];
  pendingHours: string; unknownServiceHours: string; selection: { profiles: string[]; confirmed: boolean }; service: string;
};
const GROUP_OF: Record<string, HoursLine["group"]> = { CS_N1: "CS", CS_N2: "CS", PMO_N3: "PMO", IT_N3: "CONTEXTO", PLATAFORMA_N4: "CONTEXTO" };

export async function dedicationSection(c: Ctx, pulseSel: ReturnType<typeof selectorsOf>): Promise<DedicationSection> {
  const byMonth = await hourFactsByPeriod(c.tx, c.q.scope, c.ids, periodsOf(c), pulseSel);
  const svc = c.q.base.service;
  const inScope = (r: HourRow) => svc === "TOTAL" || r.svc === svc;
  const lastM = c.monthList[c.monthList.length - 1]?.month ?? 0;
  const sel = c.cfg.dedication.selectionConfirmed ? c.cfg.dedication.profiles : [];
  const acc = new Map<string, { key: string; role: string | null; month: Dec; prev: Dec; cum: Dec }>();
  let pending = ZERO; let unknownSvc = ZERO;
  const monthly: DedicationSection["monthly"] = [];
  for (const m of c.base.months) {
    let total = ZERO; let selected = ZERO;
    for (const r of byMonth.get(m.month) ?? []) {
      if (r.bucketClass === "PENDING") { if (m.month === lastM) pending = pending.add(r.minutes); continue; }
      if (!inScope(r)) { if (m.month === lastM && (r.svc === "SIN_CLASIFICAR" || r.svc === "CONFLICTO")) unknownSvc = unknownSvc.add(r.minutes); continue; }
      const role = r.profile === "PMO_N3" ? r.role : null;
      const k = `${r.profile}|${role ?? ""}`;
      const a = acc.get(k) ?? { key: r.profile, role, month: ZERO, prev: ZERO, cum: ZERO };
      a.cum = a.cum.add(r.minutes);
      if (m.month === lastM) a.month = a.month.add(r.minutes);
      if (m.month === lastM - 1) a.prev = a.prev.add(r.minutes);
      acc.set(k, a);
      total = total.add(r.minutes);
      if (sel.includes(r.profile)) selected = selected.add(r.minutes);
    }
    const hSel = selected.divInt(60);
    monthly.push({ month: m.month, total: total.divInt(60).toString(), selected: hSel.toString(), userMonths: m.userMonths, perUser: m.userMonths === null ? null : hoursPerUserMonth(hSel, D(m.userMonths))?.toString() ?? null });
  }
  const order = [...PROFILE_KEYS, "SIN_PERFIL"] as string[];
  const lines: HoursLine[] = [...acc.values()]
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key) || (a.role ?? "").localeCompare(b.role ?? ""))
    .map((a) => ({
      key: a.key, label: a.key === "SIN_PERFIL" ? "Sin perfil" : PROFILE_LABEL[a.key as keyof typeof PROFILE_LABEL] ?? a.key, group: GROUP_OF[a.key] ?? "OTRO", role: a.role, inIndicator: sel.includes(a.key),
      month: a.month.divInt(60).toString(), previous: lastM > 1 ? a.prev.divInt(60).toString() : null, cum: a.cum.divInt(60).toString(),
    }));
  const sumOf = (g: HoursLine["group"][], f: (l: HoursLine) => string | null): string | null => {
    const vs = lines.filter((l) => g.includes(l.group)).map(f);
    return vs.some((v) => v === null) && lastM <= 1 ? null : vs.reduce((s, v) => s.add(D(v ?? "0")), ZERO).toString();
  };
  const groups = [
    { label: "Customer Success (CS N1 + CS N2)", note: "soporte ordinario", g: ["CS" as const] },
    { label: "Mantenimiento PMO (N3)", note: "Wrike desde 2025, antes Zendesk", g: ["PMO" as const] },
    { label: "Contexto IT / Plataforma", note: "no entra en el indicador salvo que se elija", g: ["CONTEXTO" as const, "OTRO" as const] },
  ].map((x) => ({ label: x.label, note: x.note, month: sumOf(x.g, (l) => l.month) ?? "0", previous: lastM > 1 ? sumOf(x.g, (l) => l.previous) : null, cum: sumOf(x.g, (l) => l.cum) ?? "0" }));
  return { ...c.base, lines, groups, monthly, pendingHours: pending.divInt(60).toString(), unknownServiceHours: unknownSvc.divInt(60).toString(), selection: { profiles: c.cfg.dedication.profiles, confirmed: c.cfg.dedication.selectionConfirmed }, service: svc };
}

// ---------------------------------------------------------------- Tickets: escalados, incidentes, bugs (flujo mensual)

export type FlowMonth = { month: number; total: number; inc: number; prob: number; n3: number; n3pmo: number; n3it: number; s: number; b: number; both: number; union: number; rate: Record<"n3" | "flow" | "bugs", string | null> };
export type TicketsSection = SectionBase & { monthly: FlowMonth[]; cum: Omit<FlowMonth, "month" | "rate">; previousYearCum: Omit<FlowMonth, "month" | "rate"> | null };

async function flowMonths(c: Ctx): Promise<FlowMonth[]> {
  const by = await ticketFactsByPeriod(c.tx, c.q.scope, c.ids, periodsOf(c));
  return c.base.months.map((m) => {
    const all = (p: (f: TicketFacts) => number) => sumFacts(c, by, m.month, p, false);
    const known = (p: (f: TicketFacts) => number) => sumFacts(c, by, m.month, p, true);
    return {
      month: m.month, total: all((f) => f.total), inc: all((f) => f.inc), prob: all((f) => f.prob), n3: all((f) => f.n3), n3pmo: all((f) => f.n3pmo), n3it: all((f) => f.n3it),
      s: all((f) => f.s), b: all((f) => f.b), both: all((f) => f.both), union: all((f) => f.union),
      rate: { n3: rate100(known((f) => f.n3), m.userMonths), flow: rate100(known((f) => f.inc + f.prob), m.userMonths), bugs: rate100(known((f) => f.union), m.userMonths) },
    };
  });
}
const cumOf = (m: FlowMonth[]): TicketsSection["cum"] => m.reduce((a, x) => ({ total: a.total + x.total, inc: a.inc + x.inc, prob: a.prob + x.prob, n3: a.n3 + x.n3, n3pmo: a.n3pmo + x.n3pmo, n3it: a.n3it + x.n3it, s: a.s + x.s, b: a.b + x.b, both: a.both + x.both, union: a.union + x.union }), { total: 0, inc: 0, prob: 0, n3: 0, n3pmo: 0, n3it: 0, s: 0, b: 0, both: 0, union: 0 });

export async function ticketsSection(c: Ctx): Promise<TicketsSection> {
  const monthly = await flowMonths(c);
  return { ...c.base, monthly, cum: cumOf(monthly), previousYearCum: null };
}

// ---------------------------------------------------------------- PAP correctivos

export type PapMonth = { month: number; total: number; corrective: number; standard: number; project: number; clientOrigin: number; clientRequest: number; evolutive: number; maintenance: number; otherCause: number; unclassified: number; rate: string | null; previousYear: { total: number; corrective: number } };
export type PapSection = SectionBase & { monthly: PapMonth[]; noDate: number; cum: Omit<PapMonth, "month" | "rate" | "previousYear">; previousCum: { total: number; corrective: number } };
const PAP_COUNTS = (cause: (cat: string, origin?: string) => Prisma.Sql) => Prisma.sql`
  count(*) AS total, count(*) FILTER (WHERE x.state = 'CORRECTIVE') AS corrective,
  count(*) FILTER (WHERE ${cause("CORRECTIVE", "STANDARD")}) AS standard,
  count(*) FILTER (WHERE ${cause("CORRECTIVE", "CUSTOMIZATION")} OR ${cause("CORRECTIVE", "CONFIG_DATA")} OR ${cause("CORRECTIVE", "PROCESSES")} OR ${cause("CORRECTIVE", "INFRASTRUCTURE")}) AS project,
  count(*) FILTER (WHERE ${cause("CORRECTIVE", "CLIENT_ORIGIN")}) AS client_origin,
  count(*) FILTER (WHERE ${cause("CLIENT_REQUEST")}) AS client_request,
  count(*) FILTER (WHERE ${cause("EVOLUTIVE")}) AS evolutive,
  count(*) FILTER (WHERE ${cause("MAINTENANCE")}) AS maintenance,
  count(*) FILTER (WHERE ${cause("OTHER")}) AS other_cause,
  count(*) FILTER (WHERE x.state = 'UNKNOWN' OR NOT EXISTS (SELECT 1 FROM "PapCause" c WHERE c."revisionId" = x.rev_id)) AS unclassified`;
const causeSql = (cat: string, origin?: string): Prisma.Sql =>
  origin
    ? Prisma.sql`EXISTS (SELECT 1 FROM "PapCause" c WHERE c."revisionId" = x.rev_id AND c.category = ${cat} AND c.origin = ${origin})`
    : Prisma.sql`EXISTS (SELECT 1 FROM "PapCause" c WHERE c."revisionId" = x.rev_id AND c.category = ${cat})`;

export async function papSection(c: Ctx): Promise<PapSection> {
  const year = c.base.period.year;
  const rows = c.ids.length === 0 ? [] : await c.tx.$queryRaw<Record<string, bigint | number>[]>(Prisma.sql`
    SELECT date_part('year', x."productionDate")::int AS y, date_part('month', x."productionDate")::int AS m, ${PAP_COUNTS(causeSql)}
    FROM (${papSetSql(c.q.scope, c.ids)}) x
    WHERE x."productionDate" BETWEEN ${`${year - 1}-01-01`}::date AND ${c.base.period.cut}::date GROUP BY 1, 2`);
  const noDate = c.ids.length === 0 ? 0 : Number((await c.tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM (${papSetSql(c.q.scope, c.ids)}) x WHERE x."productionDate" IS NULL`))[0].n);
  const n = (v: bigint | number | undefined) => Number(v ?? 0);
  const get = (y: number, m: number) => rows.find((r) => n(r.y) === y && n(r.m) === m);
  const monthly: PapMonth[] = c.base.months.map((m) => {
    const r = get(year, m.month);
    const prev = get(year - 1, m.month);
    return {
      month: m.month, total: n(r?.total), corrective: n(r?.corrective), standard: n(r?.standard), project: n(r?.project), clientOrigin: n(r?.client_origin), clientRequest: n(r?.client_request),
      evolutive: n(r?.evolutive), maintenance: n(r?.maintenance), otherCause: n(r?.other_cause), unclassified: n(r?.unclassified),
      rate: rate100(n(r?.corrective), m.userMonths), previousYear: { total: n(prev?.total), corrective: n(prev?.corrective) },
    };
  });
  const cum = monthly.reduce((a, x) => ({ total: a.total + x.total, corrective: a.corrective + x.corrective, standard: a.standard + x.standard, project: a.project + x.project, clientOrigin: a.clientOrigin + x.clientOrigin, clientRequest: a.clientRequest + x.clientRequest, evolutive: a.evolutive + x.evolutive, maintenance: a.maintenance + x.maintenance, otherCause: a.otherCause + x.otherCause, unclassified: a.unclassified + x.unclassified }), { total: 0, corrective: 0, standard: 0, project: 0, clientOrigin: 0, clientRequest: 0, evolutive: 0, maintenance: 0, otherCause: 0, unclassified: 0 });
  const prevCum = monthly.reduce((a, x) => ({ total: a.total + x.previousYear.total, corrective: a.corrective + x.previousYear.corrective }), { total: 0, corrective: 0 });
  return { ...c.base, monthly, noDate, cum, previousCum: prevCum };
}

export type PapRow = { listKey: string; papId: string; title: string; production: string; state: string; causes: string };
/** PAP únicos con producción en el mes del corte (los mismos del conteo; una fila por PAP aunque tenga varias causas). */
export async function papRows(tx: Tx, q: QualityQuery, ids: string[], from: string, to: string, page: number, pageSize = 25): Promise<{ rows: PapRow[]; total: number; page: number; pageCount: number }> {
  if (ids.length === 0) return { rows: [], total: 0, page: 1, pageCount: 1 };
  const total = Number((await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM (${papSetSql(q.scope, ids)}) x WHERE x."productionDate" BETWEEN ${from}::date AND ${to}::date`))[0].n);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pageCount);
  const rows = await tx.$queryRaw<{ listKey: string; papId: string; title: string | null; production: string; state: string; causes: string | null }[]>(Prisma.sql`
    SELECT x."listKey", x."papId", x.title, to_char(x."productionDate", 'YYYY-MM-DD') AS production, x.state,
      (SELECT string_agg(DISTINCT COALESCE(c.origin, c.category), ' · ' ORDER BY COALESCE(c.origin, c.category)) FROM "PapCause" c WHERE c."revisionId" = x.rev_id) AS causes
    FROM (${papSetSql(q.scope, ids)}) x WHERE x."productionDate" BETWEEN ${from}::date AND ${to}::date ORDER BY x."productionDate", x."listKey", x."papId" LIMIT ${pageSize} OFFSET ${(p - 1) * pageSize}`);
  return { rows: rows.map((r) => ({ listKey: r.listKey, papId: r.papId, title: r.title ?? "", production: r.production, state: r.state, causes: r.causes ?? "sin causa" })), total, page: p, pageCount };
}

// ---------------------------------------------------------------- Listas de tickets (N3, bugs)

export type TicketRow = { ticketId: string; created: string; type: string; status: string; cause: string | null; family: DiagnosisFamily; destinations: string[]; viaCause: boolean; viaLink: boolean; bugs: string[] };
export async function ticketRows(tx: Tx, q: QualityQuery, ids: string[], cfg: QualityConfig, kind: "n3" | "bugs", from: string, to: string, page: number, pageSize = 25): Promise<{ rows: TicketRow[]; total: number; page: number; pageCount: number }> {
  if (ids.length === 0) return { rows: [], total: 0, page: 1, pageCount: 1 };
  const where = kind === "n3" ? predicate.n3 : bugUnion;
  const total = Number((await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM (${ticketSetSql(q.scope, ids, from, to)}) x WHERE x.entity IS NOT NULL AND ${where}`))[0].n);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pageCount);
  const rows = await tx.$queryRaw<{ ticket_id: string; created: string; type: string; status: string; cause: string | null; destinations: string[] | null; std: boolean; link: boolean; bugs: string[] | null }[]>(Prisma.sql`
    SELECT x.ticket_id, to_char(x.created_on, 'YYYY-MM-DD') AS created, x.type, x.status, x.cause, x.destinations, COALESCE(${predicate.bugStd}, false) AS std, COALESCE(${predicate.bugLink}, false) AS link,
      ARRAY(SELECT DISTINCT w."workItemId" FROM "WorkItemLink" l JOIN "WorkItem" w ON w.id = l."workItemId" JOIN "WorkItemRevision" wr ON wr.id = w."currentRevisionId"
        WHERE l."ticketId" = x.ticket_id AND wr."isBug" AND l."drvState" = 'RESOLVED_EXTERNAL' AND COALESCE(l."manualState", '') <> 'REJECTED' ORDER BY 1) AS bugs
    FROM (${ticketSetSql(q.scope, ids, from, to)}) x WHERE x.entity IS NOT NULL AND ${where} ORDER BY x.created_on, x.ticket_id LIMIT ${pageSize} OFFSET ${(p - 1) * pageSize}`);
  return {
    rows: rows.map((r) => ({ ticketId: r.ticket_id, created: r.created, type: r.type, status: r.status, cause: r.cause, family: diagnosisFamily(r.cause, null, cfg.diagnosis.mappings).family, destinations: r.destinations ?? [], viaCause: r.std, viaLink: r.link, bugs: r.bugs ?? [] })),
    total, page: p, pageCount,
  };
}

// ---------------------------------------------------------------- Contexto de bugs abiertos VFS/VSW (producto, no atribuido a clientes)

export type OpenBugContext = { product: string; category: string; bugs: number }[];
export async function openBugContext(tx: Tx): Promise<{ rows: OpenBugContext; lastObservedOn: string | null }> {
  const rows = await tx.$queryRaw<{ product: string; category: string; n: bigint }[]>(Prisma.sql`
    SELECT w.product, wr."stateCategory" AS category, count(*) AS n FROM "WorkItem" w JOIN "WorkItemRevision" wr ON wr.id = w."currentRevisionId"
    WHERE wr."isBug" AND wr."stateCategory" <> 'TERMINAL' GROUP BY 1, 2 ORDER BY 1, 2`);
  const last = await tx.$queryRaw<{ d: string | null }[]>(Prisma.sql`SELECT to_char(max("lastObservedOn"), 'YYYY-MM-DD') AS d FROM "WorkItem"`);
  return { rows: rows.map((r) => ({ product: r.product, category: r.category, bugs: Number(r.n) })), lastObservedOn: last[0]?.d ?? null };
}

// ---------------------------------------------------------------- Entrada

export type KpiSection =
  | { kind: "HEALTH"; base: SectionBase }
  | { kind: "DEDICATION"; data: DedicationSection }
  | { kind: "PAP_CORRECTIVE"; data: PapSection; list: Awaited<ReturnType<typeof papRows>> }
  | { kind: "N3_ESCALATIONS"; data: TicketsSection; list: Awaited<ReturnType<typeof ticketRows>> }
  | { kind: "INCIDENTS_PROBLEMS"; data: TicketsSection }
  | { kind: "BUGS_STANDARD"; data: TicketsSection; list: Awaited<ReturnType<typeof ticketRows>>; openBugs: Awaited<ReturnType<typeof openBugContext>> };

export async function getKpiSection(actorId: string, q: QualityQuery, kpi: IndicatorKey, now: Date = new Date()): Promise<KpiSection> {
  const today = todayMadrid(now);
  return readSnapshot(actorId, async (tx) => {
    const c = await context(tx, q, kpi, today);
    const per = c.base.period;
    switch (kpi) {
      case "HEALTH": return { kind: "HEALTH", base: c.base };
      case "DEDICATION": return { kind: "DEDICATION", data: await dedicationSection(c, await qualitySelectors(tx, (await getActive(tx, "PULSE", q.prev ?? undefined)).payload)) };
      case "PAP_CORRECTIVE": return { kind: "PAP_CORRECTIVE", data: await papSection(c), list: await papRows(tx, q, c.ids, per.from, per.cut, q.base.page) };
      case "N3_ESCALATIONS": return { kind: "N3_ESCALATIONS", data: await ticketsSection(c), list: await ticketRows(tx, q, c.ids, c.cfg, "n3", per.from, per.cut, q.base.page) };
      case "INCIDENTS_PROBLEMS": return { kind: "INCIDENTS_PROBLEMS", data: await ticketsSection(c) };
      case "BUGS_STANDARD": return { kind: "BUGS_STANDARD", data: await ticketsSection(c), list: await ticketRows(tx, q, c.ids, c.cfg, "bugs", per.from, per.cut, q.base.page), openBugs: await openBugContext(tx) };
    }
  });
}
