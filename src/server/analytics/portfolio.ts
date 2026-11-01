import { Prisma } from "@/generated/prisma/client";
import { Dec, effectiveCut } from "@/domain/finance";
import { BLOCK_PERIOD, SELECT_MIXED, SELECT_NONE, type AnalysisQuery } from "@/domain/analytics-query";
import { economicsInTx, PERIOD_KEYS, type EconomicResult, type EntityResult, type PeriodKey, type PeriodSeries } from "@/server/economics/engine";
import { readSnapshot, snapshotPoint, type Tx } from "./snapshot";

/**
 * Cartera económica de Comparativa (CSAPP-06 §5). La fila es el Grupo Cliente (BC). Los filtros de identificación seleccionan grupos
 * COMPLETOS («grupos que contienen…»): conservan el ingreso y las horas del grupo entero; nunca recortan solo las horas. Tarjetas,
 * subtotales y media filtrada usan todos los grupos filtrados antes de paginar, calculados por el motor común en la misma instantánea.
 */

export type MetaCell = {
  /** Valores a mostrar (propios del grupo o, si no hay, los de sus Clientes). */
  values: string[];
  /** Todos los valores del grupo y de sus hijos (para «grupos que contienen…»). */
  contains: string[];
  source: "group" | "clients" | "none";
  heterogeneous: boolean;
  /** Clientes con dato y total de Clientes: cobertura cuando el dato no es propio del grupo. */
  clientsWith: number;
  clientsTotal: number;
};
export type GroupMeta = {
  id: string;
  name: string;
  bcDenomination: string | null;
  isActive: boolean;
  clients: number;
  implementations: number;
  support: MetaCell;
  hosting: MetaCell;
  complexity: MetaCell;
  product: MetaCell;
  coverage: "completa" | "parcial" | "sin_datos";
};

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Maestros de TODOS los grupos con vigencia a la fecha de corte (una consulta por conjuntos). */
export async function loadGroupMeta(tx: Tx, cut: string, ids?: string[]): Promise<GroupMeta[]> {
  const onlyG = ids ? Prisma.sql`WHERE g.id = ANY(${ids})` : Prisma.empty;
  const onlyT = ids ? Prisma.sql`AND (t."groupId" = ANY(${ids}) OR c."groupId" = ANY(${ids}))` : Prisma.empty;
  const [groups, terms] = await Promise.all([
    tx.$queryRaw<{ id: string; name: string; bc: string | null; active: boolean; clients: number; impls: number }[]>(Prisma.sql`
      SELECT g.id, g.name, g."bcDenomination" AS bc, g."isActive" AS active,
        (SELECT count(*) FROM "Client" c WHERE c."groupId" = g.id)::int AS clients,
        (SELECT count(*) FROM "Implementation" i JOIN "Client" c ON c.id = i."clientId" WHERE c."groupId" = g.id)::int AS impls
      FROM "ClientGroup" g ${onlyG} ORDER BY g.name, g.id`),
    tx.$queryRaw<{ attr: string; value: string; gid: string | null; cgid: string | null; cid: string | null }[]>(Prisma.sql`
      SELECT t.attribute::text AS attr, t.value, t."groupId" AS gid, c."groupId" AS cgid, c.id AS cid
      FROM "ServiceTerm" t
      LEFT JOIN "Implementation" i ON i.id = t."implementationId"
      LEFT JOIN "Client" c ON c.id = COALESCE(t."clientId", i."clientId")
      WHERE (t."validFrom" IS NULL OR t."validFrom" <= ${cut}::date) AND (t."validTo" IS NULL OR ${cut}::date < t."validTo") ${onlyT}`),
  ]);
  type Acc = { own: Set<string>; child: Set<string>; kids: Set<string> };
  const acc = new Map<string, Acc>();
  const cell = (gid: string, attr: string): Acc => {
    const k = `${gid}|${attr}`;
    let a = acc.get(k);
    if (!a) acc.set(k, (a = { own: new Set(), child: new Set(), kids: new Set() }));
    return a;
  };
  for (const t of terms) {
    if (t.gid) cell(t.gid, t.attr).own.add(t.value);
    else if (t.cgid) {
      const a = cell(t.cgid, t.attr);
      a.child.add(t.value);
      if (t.cid) a.kids.add(t.cid);
    }
  }
  const mk = (gid: string, attr: string, clientsTotal: number): MetaCell => {
    const a = acc.get(`${gid}|${attr}`);
    const own = [...(a?.own ?? [])].sort();
    const child = [...(a?.child ?? [])].sort();
    const values = own.length > 0 ? own : child;
    return {
      values,
      contains: [...new Set([...own, ...child])].sort(),
      source: own.length > 0 ? "group" : child.length > 0 ? "clients" : "none",
      heterogeneous: values.length > 1,
      clientsWith: a?.kids.size ?? 0,
      clientsTotal,
    };
  };
  return groups.map((g) => {
    const support = mk(g.id, "SUPPORT", g.clients);
    const hosting = mk(g.id, "HOSTING", g.clients);
    const full = (c: MetaCell) => c.source === "group" || (c.source === "clients" && c.clientsTotal > 0 && c.clientsWith >= c.clientsTotal);
    const some = (c: MetaCell) => c.source !== "none";
    return {
      id: g.id,
      name: g.name,
      bcDenomination: g.bc,
      isActive: g.active,
      clients: g.clients,
      implementations: g.impls,
      support,
      hosting,
      complexity: mk(g.id, "COMPLEXITY", g.clients),
      product: mk(g.id, "PRODUCT", g.clients),
      coverage: full(support) && full(hosting) ? "completa" : some(support) || some(hosting) ? "parcial" : "sin_datos",
    };
  });
}

function matchesSelection(cell: MetaCell, selected: string[]): boolean {
  if (selected.length === 0) return true;
  return selected.some((s) => (s === SELECT_NONE ? cell.contains.length === 0 : s === SELECT_MIXED ? cell.heterogeneous : cell.contains.includes(s)));
}

/** Conjunto filtrado de grupos (los filtros de identificación seleccionan grupos económicos completos). */
export function filterGroups(all: GroupMeta[], q: AnalysisQuery): GroupMeta[] {
  const needle = fold(q.q);
  return all.filter(
    (g) =>
      (q.status === "todos" || (q.status === "activos" ? g.isActive : !g.isActive)) &&
      (needle === "" || fold(g.name).includes(needle) || fold(g.bcDenomination ?? "").includes(needle)) &&
      matchesSelection(g.support, q.support) &&
      matchesSelection(g.hosting, q.hosting) &&
      matchesSelection(g.complexity, q.complexity) &&
      (q.product === "" || (q.product === SELECT_NONE ? g.product.contains.length === 0 : g.product.contains.includes(q.product))) &&
      (q.coverage === "todas" || g.coverage === q.coverage),
  );
}

// ---------------------------------------------------------------- Orden: nulos al final (nunca como ceros), estable

const metricOf = (p: PeriodSeries, metric: string): Dec | null => {
  const dec = (s: string | null | undefined) => (s === null || s === undefined ? null : Dec.parse(s));
  switch (metric) {
    case "hours": return dec(p.hours.inPerimeter);
    case "revenue": return dec(p.revenue.value);
    case "perDay": return dec(p.perDay.value);
    case "devTarget": return dec(p.deviationVsTarget.value);
    case "devPortfolio": return dec(p.deviationVsPortfolio?.value);
    case "stock": return p.users.stock.value === null ? null : Dec.int(p.users.stock.value);
    case "avgUsers": return dec(p.users.averageUsers);
    case "tariff": return dec(p.perUserPerYear.value);
    default: return null;
  }
};

export type PortfolioRow = { meta: GroupMeta; periods: Record<PeriodKey, PeriodSeries> };

export function sortRows(rows: PortfolioRow[], sort: string, dir: "asc" | "desc"): PortfolioRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const byName = (a: PortfolioRow, b: PortfolioRow) => a.meta.name.localeCompare(b.meta.name, "es") || (a.meta.id < b.meta.id ? -1 : 1);
  return [...rows].sort((a, b) => {
    if (sort === "name") return sign * byName(a, b);
    if (sort === "support") {
      const x = a.meta.support.values.join("+");
      const y = b.meta.support.values.join("+");
      if ((x === "") !== (y === "")) return x === "" ? 1 : -1; // sin informar al final
      return sign * x.localeCompare(y, "es") || byName(a, b);
    }
    const [pk, metric] = sort.split(".") as [PeriodKey, string];
    const x = metricOf(a.periods[pk], metric);
    const y = metricOf(b.periods[pk], metric);
    if (x === null || y === null) return x === null && y === null ? byName(a, b) : x === null ? 1 : -1; // nulos siempre al final, en ambos sentidos
    return sign * x.cmp(y) || byName(a, b);
  });
}

export type PortfolioView = {
  query: AnalysisQuery;
  cut: string;
  /** Total de grupos del maestro y del conjunto filtrado (cartera). */
  totalGroups: number;
  filteredGroups: number;
  rows: PortfolioRow[];
  page: number;
  pageCount: number;
  economics: Pick<EconomicResult, "periodsDefinition" | "settings" | "recalculatedWithOlderSettings" | "portfolio" | "unattributed" | "reference" | "input">;
};

export async function getPortfolio(actorId: string, query: AnalysisQuery): Promise<PortfolioView> {
  return readSnapshot(actorId, async (tx) => {
    const cut = effectiveCut(query.date, query.mode);
    const all = await loadGroupMeta(tx, cut);
    await snapshotPoint("portfolio:after-first-read");
    const cohort = filterGroups(all, query);
    const econ = await economicsInTx(tx, {
      scope: { type: "groups", ids: cohort.map((g) => g.id) },
      service: query.service,
      date: query.date,
      mode: query.mode,
      settingsRevision: query.revision ?? undefined,
      unpaged: true,
    });
    await snapshotPoint("portfolio:after-economics");
    const byId = new Map<string, EntityResult>(econ.entities.map((e) => [e.id, e]));
    const rows: PortfolioRow[] = cohort.map((meta) => ({ meta, periods: (byId.get(meta.id) as EntityResult).periods }));
    const sorted = sortRows(rows, query.sort, query.dir);
    const pageCount = Math.max(1, Math.ceil(sorted.length / query.pageSize));
    const page = Math.min(query.page, pageCount);
    return {
      query,
      cut,
      totalGroups: all.length,
      filteredGroups: cohort.length,
      rows: sorted.slice((page - 1) * query.pageSize, page * query.pageSize),
      page,
      pageCount,
      economics: { periodsDefinition: econ.periodsDefinition, settings: econ.settings, recalculatedWithOlderSettings: econ.recalculatedWithOlderSettings, portfolio: econ.portfolio, unattributed: econ.unattributed, reference: econ.reference, input: econ.input },
    };
  });
}

/** Filas COMPLETAS del conjunto filtrado, en el mismo orden (para exportar: nunca solo la página). */
export async function getPortfolioAll(actorId: string, query: AnalysisQuery): Promise<PortfolioView & { allRows: PortfolioRow[] }> {
  return readSnapshot(actorId, async (tx) => {
    const cut = effectiveCut(query.date, query.mode);
    const all = await loadGroupMeta(tx, cut);
    const cohort = filterGroups(all, query);
    const econ = await economicsInTx(tx, { scope: { type: "groups", ids: cohort.map((g) => g.id) }, service: query.service, date: query.date, mode: query.mode, settingsRevision: query.revision ?? undefined, unpaged: true });
    const byId = new Map<string, EntityResult>(econ.entities.map((e) => [e.id, e]));
    const rows = sortRows(cohort.map((meta) => ({ meta, periods: (byId.get(meta.id) as EntityResult).periods })), query.sort, query.dir);
    return {
      query, cut, totalGroups: all.length, filteredGroups: cohort.length, rows, allRows: rows, page: 1, pageCount: 1,
      economics: { periodsDefinition: econ.periodsDefinition, settings: econ.settings, recalculatedWithOlderSettings: econ.recalculatedWithOlderSettings, portfolio: econ.portfolio, unattributed: econ.unattributed, reference: econ.reference, input: econ.input },
    };
  });
}

export { BLOCK_PERIOD, PERIOD_KEYS };
