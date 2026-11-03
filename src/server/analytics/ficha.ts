import { Prisma } from "@/generated/prisma/client";
import { Dec, effectiveCut } from "@/domain/finance";
import { likePattern, type AnalysisQuery } from "@/domain/analytics-query";
import { economicsInTx, PERIOD_KEYS, type EconomicResult, type EntityResult, type PeriodSeries } from "@/server/economics/engine";
import { alignMonths, annualPoints, cell, cellsOf, cumulativeCells, MEASURES, trimEmptyYears, type AnnualPoint, type Cell, type MeasureKey, type MonthRow, type MonthSrc } from "@/domain/ficha-series";
import { equipoTable, problemTable, ticketTable, type DedMap, type EquipoTable, type ProblemTable, type TicketTable } from "@/domain/ficha-dedicacion";
import { loadDedication, loadPap, type DedicationPeriod, type EntityRef, type PapSummary, type PeriodRange } from "./operational";
import { readSnapshot, snapshotPoint, type Tx } from "./snapshot";

/**
 * Ficha de Análisis Cliente (HOTFIX-02 §8): UNA lectura panorámica de Grupo Cliente, Cliente o implantación (sin pestañas). El ingreso económico
 * existe solo al nivel Grupo; un Cliente/implantación muestra sus horas, PAP y dedicación propios y, aparte, el contexto económico «del grupo»
 * (series del Grupo identificadas como tales) sin repartir dinero. Los gráficos, tooltips y tablas equivalentes salen de las series del motor
 * (`EntityResult.monthly/prevMonthly/history`) a través de `domain/ficha-series`: no hay otra fórmula para el gráfico.
 */

// ---------------------------------------------------------------- Selector de entidades (búsqueda en servidor, paginada)

export type EntityHit = { type: EntityRef["type"]; id: string; name: string; parent: string | null; isActive: boolean };

export async function searchEntities(tx: Tx, q: string, page: number, pageSize = 25): Promise<{ rows: EntityHit[]; total: number }> {
  const like = likePattern(q.trim());
  const base = Prisma.sql`
    SELECT 'group'::text AS type, g.id, g.name, NULL::text AS parent, g."isActive" AS active FROM "ClientGroup" g WHERE g.name ILIKE ${like} ESCAPE '\\' OR g."bcDenomination" ILIKE ${like} ESCAPE '\\'
    UNION ALL
    SELECT 'client', c.id, c.name, g.name, c."isActive" FROM "Client" c LEFT JOIN "ClientGroup" g ON g.id = c."groupId" WHERE c.name ILIKE ${like} ESCAPE '\\'
    UNION ALL
    SELECT 'implementation', i.id, i.name, c.name, i."isActive" FROM "Implementation" i JOIN "Client" c ON c.id = i."clientId" WHERE i.name ILIKE ${like} ESCAPE '\\'`;
  const [rows, tot] = await Promise.all([
    tx.$queryRaw<{ type: EntityHit["type"]; id: string; name: string; parent: string | null; active: boolean }[]>(Prisma.sql`
      SELECT * FROM (${base}) x ORDER BY CASE x.type WHEN 'group' THEN 0 WHEN 'client' THEN 1 ELSE 2 END, x.name, x.id LIMIT ${pageSize} OFFSET ${(Math.max(page, 1) - 1) * pageSize}`),
    tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM (${base}) x`),
  ]);
  return { rows: rows.map((r) => ({ type: r.type, id: r.id, name: r.name, parent: r.parent, isActive: r.active })), total: Number(tot[0].n) };
}

export async function searchEntitiesView(actorId: string, q: string, page: number) {
  return readSnapshot(actorId, (tx) => searchEntities(tx, q, page));
}

// ---------------------------------------------------------------- Contexto de la entidad

export type Relation = { id: string; name: string; isActive: boolean; count: number | null };
export type EntityContext = {
  ref: EntityRef;
  name: string;
  isActive: boolean;
  group: { id: string; name: string } | null;
  client: { id: string; name: string } | null;
  children: { clients: Relation[]; clientsTotal: number; implementations: Relation[]; implementationsTotal: number };
  /** Datos propios de la entidad con vigencia a la fecha de corte (no inventa el dato propio de un hijo). */
  own: { support: string[]; hosting: string[]; complexity: string[]; product: string[] };
};

const MAX_CHILDREN = 200;

async function ownTerms(tx: Tx, ref: EntityRef, cut: string) {
  const col = Prisma.raw(ref.type === "group" ? '"groupId"' : ref.type === "client" ? '"clientId"' : '"implementationId"');
  const rows = await tx.$queryRaw<{ attr: string; value: string }[]>(Prisma.sql`
    SELECT attribute::text AS attr, value FROM "ServiceTerm" WHERE ${col} = ${ref.id}
      AND ("validFrom" IS NULL OR "validFrom" <= ${cut}::date) AND ("validTo" IS NULL OR ${cut}::date < "validTo") ORDER BY value`);
  const by = (a: string) => [...new Set(rows.filter((r) => r.attr === a).map((r) => r.value))];
  return { support: by("SUPPORT"), hosting: by("HOSTING"), complexity: by("COMPLEXITY"), product: by("PRODUCT") };
}

export async function loadEntityContext(tx: Tx, ref: EntityRef, cut: string): Promise<EntityContext | null> {
  let name: string;
  let isActive: boolean;
  let group: EntityContext["group"] = null;
  let client: EntityContext["client"] = null;
  if (ref.type === "group") {
    const g = await tx.clientGroup.findUnique({ where: { id: ref.id }, select: { name: true, isActive: true } });
    if (!g) return null;
    name = g.name; isActive = g.isActive; group = { id: ref.id, name: g.name };
  } else if (ref.type === "client") {
    const c = await tx.client.findUnique({ where: { id: ref.id }, select: { name: true, isActive: true, group: { select: { id: true, name: true } } } });
    if (!c) return null;
    name = c.name; isActive = c.isActive; group = c.group; client = { id: ref.id, name: c.name };
  } else {
    const i = await tx.implementation.findUnique({ where: { id: ref.id }, select: { name: true, isActive: true, client: { select: { id: true, name: true, group: { select: { id: true, name: true } } } } } });
    if (!i) return null;
    name = i.name; isActive = i.isActive; client = { id: i.client.id, name: i.client.name }; group = i.client.group;
  }
  const clientsOf = ref.type === "group" ? { groupId: ref.id } : null;
  const implsWhere = ref.type === "group" ? { client: { groupId: ref.id } } : ref.type === "client" ? { clientId: ref.id } : null;
  const [clients, clientsTotal, impls, implsTotal, own] = await Promise.all([
    clientsOf ? tx.client.findMany({ where: clientsOf, select: { id: true, name: true, isActive: true, _count: { select: { implementations: true } } }, orderBy: [{ name: "asc" }, { id: "asc" }], take: MAX_CHILDREN }) : Promise.resolve([]),
    clientsOf ? tx.client.count({ where: clientsOf }) : Promise.resolve(0),
    implsWhere ? tx.implementation.findMany({ where: implsWhere, select: { id: true, name: true, isActive: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: MAX_CHILDREN }) : Promise.resolve([]),
    implsWhere ? tx.implementation.count({ where: implsWhere }) : Promise.resolve(0),
    ownTerms(tx, ref, cut),
  ]);
  return {
    ref, name, isActive, group, client,
    children: {
      clients: clients.map((c) => ({ id: c.id, name: c.name, isActive: c.isActive, count: c._count.implementations })),
      clientsTotal,
      implementations: impls.map((i) => ({ id: i.id, name: i.name, isActive: i.isActive, count: null })),
      implementationsTotal: implsTotal,
    },
    own,
  };
}

// ---------------------------------------------------------------- Ficha completa

export type FichaSeries = {
  /** Serie económica (rentabilidad, ingreso, desviación, CUM): del propio Grupo o, en un Cliente/implantación, del Grupo identificado como contexto. */
  economicOwner: { kind: "own" | "group"; name: string; id: string } | null;
  rows: Record<MeasureKey, MonthRow[] | null>;
  /** Motivo por el que una serie entera no existe (se muestra como «—» con explicación). */
  missing: Partial<Record<MeasureKey, string>>;
  year: number;
  prevYear: number;
  cutMonth: number;
  /** Fecha hasta la que llega el año anterior comparable en el mes del corte (mes parcial: mismo día equivalente). */
  prevCumTo: string;
};

export type FichaView = {
  query: AnalysisQuery;
  context: EntityContext;
  cut: string;
  /** Resultado de la entidad: Grupo con ingreso; Cliente/implantación con horas y usuarios, sin ratio propio. */
  entity: EntityResult;
  /** Cliente/implantación: contexto económico «del grupo» (no se suma al resultado operativo del Cliente). */
  groupContext: EntityResult | null;
  economics: Pick<EconomicResult, "periodsDefinition" | "settings" | "recalculatedWithOlderSettings" | "reference" | "input" | "unattributed">;
  dedication: Record<string, DedicationPeriod>;
  tables: { equipo: EquipoTable; ticket: TicketTable; problema: ProblemTable };
  series: FichaSeries;
  annual: AnnualPoint[];
  pap: PapSummary;
  /** Hitos (arranque, migración CLOUD, cambio mayor de versión) con fecha y ámbito; solo los que existen en los maestros. */
  milestones: { type: string; date: string; scope: string; scopeName: string; note: string | null }[];
};

const rangesOf = (e: EconomicResult): PeriodRange[] => PERIOD_KEYS.map((k) => ({ key: k as string, from: e.periodsDefinition[k].from, to: e.periodsDefinition[k].to }));
const MAX_HISTORY_YEARS = 8;

/** Primer año con datos (ingreso u horas) del ámbito económico: acota los gráficos anuales a los años disponibles. */
async function firstDataYear(tx: Tx, groupId: string | null, ref: EntityRef, cutYear: number): Promise<number> {
  const col = Prisma.raw(ref.type === "group" ? '"groupId"' : ref.type === "client" ? '"clientId"' : '"implementationId"');
  const [fin, own, grp] = await Promise.all([
    groupId
      ? tx.$queryRaw<{ y: number | null }[]>(Prisma.sql`SELECT min(s.year)::int AS y FROM "FinanceScope" s JOIN "FinanceRow" r ON r."batchId" = s."activeBatchId" WHERE r."groupId" = ${groupId}`)
      : Promise.resolve([{ y: null }]),
    tx.$queryRaw<{ y: number | null }[]>(Prisma.sql`SELECT extract(year FROM min("workDate"))::int AS y FROM "TimeActivity" WHERE ${col} = ${ref.id}`),
    groupId && ref.type !== "group"
      ? tx.$queryRaw<{ y: number | null }[]>(Prisma.sql`SELECT extract(year FROM min("workDate"))::int AS y FROM "TimeActivity" WHERE "groupId" = ${groupId}`)
      : Promise.resolve([{ y: null }]),
  ]);
  const ys = [fin[0].y, own[0].y, grp[0].y].filter((y): y is number => typeof y === "number");
  return Math.max(ys.length ? Math.min(...ys) : cutYear, cutYear - MAX_HISTORY_YEARS);
}

export async function getFicha(actorId: string, query: AnalysisQuery, ref: EntityRef): Promise<FichaView | null> {
  return readSnapshot(actorId, async (tx) => {
    const cut = effectiveCut(query.date, query.mode);
    const context = await loadEntityContext(tx, ref, cut);
    if (!context) return null;
    await snapshotPoint("ficha:after-context");
    const cutY = Number(cut.slice(0, 4));
    const cutM = Number(cut.slice(5, 7));
    const common = { service: query.service, date: query.date, mode: query.mode, settingsRevision: query.revision ?? undefined, unpaged: true as const };
    const firstYear = await firstDataYear(tx, context.group?.id ?? null, ref, cutY);
    const historyYears = Array.from({ length: Math.max(0, cutY - firstYear) }, (_, i) => firstYear + i);

    let econ: EconomicResult;
    let entity: EntityResult;
    let groupContext: EntityResult | null = null;
    if (ref.type === "group") {
      econ = await economicsInTx(tx, { ...common, scope: { type: "groups", ids: [ref.id] }, detailFor: ref.id, historyYears });
      entity = econ.entities.find((e) => e.id === ref.id) as EntityResult;
    } else {
      econ = await economicsInTx(tx, { ...common, scope: ref.type === "client" ? { type: "client", id: ref.id } : { type: "implementation", id: ref.id }, detailFor: ref.id });
      entity = econ.entities[0];
      if (context.group) {
        const g = await economicsInTx(tx, { ...common, scope: { type: "groups", ids: [context.group.id] }, detailFor: context.group.id, historyYears });
        groupContext = g.entities[0] ?? null;
      }
    }
    await snapshotPoint("ficha:after-economics");

    const periods = rangesOf(econ);
    const monthRanges = (xs: PeriodSeries[]): PeriodRange[] => xs.map((m) => ({ key: m.label, from: m.from, to: m.to }));
    const dedication = await loadDedication(tx, ref, periods, query.service);
    const pap = await loadPap(tx, ref, [...periods, ...monthRanges(entity.monthly), ...monthRanges(entity.prevMonthly)]);

    // ---- Series: del Grupo (propias) o, para un Cliente/implantación, del Grupo como contexto; horas y PAP siempre del propio ámbito.
    const owner = ref.type === "group" ? entity : groupContext;
    const dayHours = Dec.parse(econ.settings.dayHours) as Dec;
    const rows: FichaSeries["rows"] = { perDay: null, cumPerDay: null, hours: null, revenue: null, pap: null, devTarget: null };
    const missing: FichaSeries["missing"] = {};
    const align = (key: MeasureKey, cur: Cell[], prev: Cell[], cs: MonthSrc[], ps: MonthSrc[]) => alignMonths(MEASURES[key], cutM, cur, prev, cs, ps);
    rows.hours = align("hours", cellsOf("hours", entity.monthly), cellsOf("hours", entity.prevMonthly), entity.monthly, entity.prevMonthly);
    if (owner) {
      rows.perDay = align("perDay", cellsOf("perDay", owner.monthly), cellsOf("perDay", owner.prevMonthly), owner.monthly, owner.prevMonthly);
      rows.revenue = align("revenue", cellsOf("revenue", owner.monthly), cellsOf("revenue", owner.prevMonthly), owner.monthly, owner.prevMonthly);
      rows.devTarget = align("devTarget", cellsOf("devTarget", owner.monthly), cellsOf("devTarget", owner.prevMonthly), owner.monthly, owner.prevMonthly);
      rows.cumPerDay = align("cumPerDay", cumulativeCells(owner.monthly, dayHours), cumulativeCells(owner.prevMonthly, dayHours), owner.monthly, owner.prevMonthly);
    } else {
      for (const k of ["perDay", "revenue", "devTarget", "cumPerDay"] as const) missing[k] = "Sin Grupo Cliente asignado: no hay ingreso al que referir la rentabilidad.";
    }
    const papAny = Object.values(pap.periods).some((p) => p.total > 0) || pap.withoutProductionDate > 0;
    const papCells = (xs: PeriodSeries[]): Cell[] => xs.map((m) => (papAny ? cell(String(pap.periods[m.label]?.total ?? 0)) : cell(null, "Sin PAP atribuidos a este ámbito.")));
    rows.pap = align("pap", papCells(entity.monthly), papCells(entity.prevMonthly), entity.monthly, entity.prevMonthly);

    const annual = owner ? trimEmptyYears(annualPoints(owner.history, cutY, owner.periods.cum)) : [];

    const dedMap: DedMap = Object.fromEntries(PERIOD_KEYS.map((k) => [k, dedication[k]])) as DedMap;
    const tables = { equipo: equipoTable(dedMap), ticket: ticketTable(dedMap), problema: problemTable(dedMap, entity.periods.cum.targetHours.value) };

    const gid = context.group?.id ?? null;
    const cid = context.client?.id ?? (ref.type === "client" ? ref.id : null);
    const ms = await tx.$queryRaw<{ type: string; date: string; note: string | null; gname: string | null; cname: string | null; iname: string | null }[]>(Prisma.sql`
      SELECT m.type::text AS type, to_char(m.date, 'YYYY-MM-DD') AS date, m.note, g.name AS gname, c.name AS cname, i.name AS iname
      FROM "Milestone" m LEFT JOIN "ClientGroup" g ON g.id = m."groupId" LEFT JOIN "Client" c ON c.id = m."clientId" LEFT JOIN "Implementation" i ON i.id = m."implementationId"
      WHERE (${gid}::text IS NOT NULL AND m."groupId" = ${gid})
        OR (${ref.type === "group"} AND m."clientId" IN (SELECT id FROM "Client" WHERE "groupId" = ${ref.id}))
        OR (${cid}::text IS NOT NULL AND m."clientId" = ${cid})
        OR (${ref.type === "implementation"} AND m."implementationId" = ${ref.id})
        OR (${ref.type === "client"} AND m."implementationId" IN (SELECT id FROM "Implementation" WHERE "clientId" = ${ref.id}))
      ORDER BY m.date, m.type`);
    return {
      query, context, cut, entity, groupContext,
      milestones: ms.map((m) => ({ type: m.type, date: m.date, note: m.note, scope: m.iname ? "implantación" : m.cname ? "cliente" : "grupo", scopeName: m.iname ?? m.cname ?? m.gname ?? "" })),
      economics: { periodsDefinition: econ.periodsDefinition, settings: econ.settings, recalculatedWithOlderSettings: econ.recalculatedWithOlderSettings, reference: econ.reference, input: econ.input, unattributed: econ.unattributed },
      dedication, tables, pap, annual,
      series: { economicOwner: owner ? { kind: ref.type === "group" ? "own" : "group", name: owner.name, id: owner.id } : null, rows, missing, year: cutY, prevYear: cutY - 1, cutMonth: cutM, prevCumTo: econ.periodsDefinition.prevCum.to },
    };
  });
}
