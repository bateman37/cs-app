import { Prisma } from "@/generated/prisma/client";
import { Dec, effectiveCut, tariffRun } from "@/domain/finance";
import { groupEffectiveActive, matchesEstado, type Estado } from "@/domain/estado";
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
  /** Estado propio del Grupo (explícito). */
  isActive: boolean;
  /** Estado efectivo (HOTFIX-03 §7): Grupo activo y, si tiene Clientes externos, al menos uno activo. Decide las listas Activos/Inactivos. */
  effectiveActive: boolean;
  /** Clientes externos activos / total (detalle del estado). */
  externalClients: { total: number; active: number };
  clients: number;
  implementations: number;
  support: MetaCell;
  hosting: MetaCell;
  complexity: MetaCell;
  product: MetaCell;
  coverage: "completa" | "parcial" | "sin_datos";
  /**
   * Unidades de coincidencia (HOTFIX-02 §6): cada Cliente con atributos propios y, si el Grupo tiene valores propios, una unidad de Grupo. Soporte y Servidor
   * seleccionados a la vez deben coincidir EN LA MISMA unidad; nunca el soporte de un Cliente con el servidor de otro.
   */
  units: { support: string[]; hosting: string[]; /** Unidad activa efectiva: Cliente activo con su Grupo activo; la unidad propia del Grupo, según su estado efectivo. */ active: boolean }[];
};

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type GroupRow = { id: string; name: string; bc: string | null; active: boolean; clients: number; impls: number; extTotal: number; extActive: number };
type TermRow = { attr: string; value: string; gid: string | null; cgid: string | null; cid: string | null; cactive: boolean | null };
const groupRowsSql = (ids?: string[]): Prisma.Sql => Prisma.sql`
      SELECT g.id, g.name, g."bcDenomination" AS bc, g."isActive" AS active,
        (SELECT count(*) FROM "Client" c WHERE c."groupId" = g.id)::int AS clients,
        (SELECT count(*) FROM "Implementation" i JOIN "Client" c ON c.id = i."clientId" WHERE c."groupId" = g.id)::int AS impls,
        (SELECT count(*) FROM "Client" c WHERE c."groupId" = g.id AND NOT c."isInternal")::int AS "extTotal",
        (SELECT count(*) FROM "Client" c WHERE c."groupId" = g.id AND NOT c."isInternal" AND c."isActive")::int AS "extActive"
      FROM "ClientGroup" g ${ids ? Prisma.sql`WHERE g.id = ANY(${ids})` : Prisma.empty} ORDER BY g.name, g.id`;

/**
 * Maestros de TODOS los grupos con vigencia a la fecha de corte (una consulta por conjuntos). Las dos lecturas son SECUENCIALES sobre el cliente de la
 * transacción: un `Promise.all` sobre `tx` emite una segunda consulta mientras la primera sigue en curso (advertencia de `pg`, CSAPP-10).
 */
export async function loadGroupMeta(tx: Tx, cut: string, ids?: string[]): Promise<GroupMeta[]> {
  const onlyT = ids ? Prisma.sql`AND (t."groupId" = ANY(${ids}) OR c."groupId" = ANY(${ids}))` : Prisma.empty;
  const groups = await tx.$queryRaw<GroupRow[]>(groupRowsSql(ids));
  const terms = await tx.$queryRaw<TermRow[]>(Prisma.sql`
      SELECT t.attribute::text AS attr, t.value, t."groupId" AS gid, c."groupId" AS cgid, c.id AS cid, c."isActive" AS cactive
      FROM "ServiceTerm" t
      LEFT JOIN "Implementation" i ON i.id = t."implementationId"
      LEFT JOIN "Client" c ON c.id = COALESCE(t."clientId", i."clientId")
      WHERE (t."validFrom" IS NULL OR t."validFrom" <= ${cut}::date) AND (t."validTo" IS NULL OR ${cut}::date < t."validTo") ${onlyT}`);
  return groupMetaFrom(groups, terms);
}

/**
 * Maestros de todos los grupos a VARIAS fechas de corte con dos consultas (grupos y vigencias de los atributos de todos los cortes), no dos por corte.
 * Cada corte se construye con la misma función pura que `loadGroupMeta`.
 */
export async function loadGroupMetaForCuts(tx: Tx, cuts: string[]): Promise<Map<string, GroupMeta[]>> {
  const out = new Map<string, GroupMeta[]>();
  const distinct = [...new Set(cuts)];
  if (distinct.length === 0) return out;
  const groups = await tx.$queryRaw<GroupRow[]>(groupRowsSql());
  const terms = await tx.$queryRaw<(TermRow & { cut: string })[]>(Prisma.sql`
      SELECT to_char(p.cut, 'YYYY-MM-DD') AS cut, t.attribute::text AS attr, t.value, t."groupId" AS gid, c."groupId" AS cgid, c.id AS cid, c."isActive" AS cactive
      FROM unnest(${distinct}::date[]) AS p(cut)
      JOIN "ServiceTerm" t ON (t."validFrom" IS NULL OR t."validFrom" <= p.cut) AND (t."validTo" IS NULL OR p.cut < t."validTo")
      LEFT JOIN "Implementation" i ON i.id = t."implementationId"
      LEFT JOIN "Client" c ON c.id = COALESCE(t."clientId", i."clientId")`);
  const byCut = new Map<string, TermRow[]>(distinct.map((c) => [c, []]));
  for (const t of terms) byCut.get(t.cut)?.push(t);
  for (const c of distinct) out.set(c, groupMetaFrom(groups, byCut.get(c) as TermRow[]));
  return out;
}

/** Construcción pura de los maestros de cada grupo a partir de sus filas y de los atributos vigentes (compartida por todos los cargadores). */
function groupMetaFrom(groups: GroupRow[], terms: TermRow[]): GroupMeta[] {
  type Acc = { own: Set<string>; child: Set<string>; kids: Set<string> };
  const perClient = new Map<string, Map<string, { support: Set<string>; hosting: Set<string>; active: boolean }>>();
  const groupActive = new Map(groups.map((g) => [g.id, groupEffectiveActive({ isActive: g.active }, Array.from({ length: g.extTotal }, (_, i) => ({ isActive: i < g.extActive })))]));
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
      if (t.cid && (t.attr === "SUPPORT" || t.attr === "HOSTING")) {
        const byClient = perClient.get(t.cgid) ?? new Map();
        perClient.set(t.cgid, byClient);
        const u = byClient.get(t.cid) ?? { support: new Set<string>(), hosting: new Set<string>(), active: t.cactive !== false };
        byClient.set(t.cid, u);
        (t.attr === "SUPPORT" ? u.support : u.hosting).add(t.value);
      }
    }
  }
  const unitsOf = (gid: string): GroupMeta["units"] => {
    const ownS = [...(acc.get(`${gid}|SUPPORT`)?.own ?? [])].sort();
    const ownH = [...(acc.get(`${gid}|HOSTING`)?.own ?? [])].sort();
    const gActive = groups.find((g) => g.id === gid)?.active ?? true;
    const units: GroupMeta["units"] = [...(perClient.get(gid)?.values() ?? [])].map((u) => ({ support: u.support.size ? [...u.support].sort() : ownS, hosting: u.hosting.size ? [...u.hosting].sort() : ownH, active: u.active && gActive }));
    if (ownS.length > 0 || ownH.length > 0) units.push({ support: ownS, hosting: ownH, active: groupActive.get(gid) ?? gActive });
    return units;
  };
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
      effectiveActive: groupActive.get(g.id) ?? g.active,
      externalClients: { total: g.extTotal, active: g.extActive },
      clients: g.clients,
      implementations: g.impls,
      support,
      hosting,
      complexity: mk(g.id, "COMPLEXITY", g.clients),
      product: mk(g.id, "PRODUCT", g.clients),
      coverage: full(support) && full(hosting) ? "completa" : some(support) || some(hosting) ? "parcial" : "sin_datos",
      units: unitsOf(g.id),
    };
  });
}

/** Valores especiales heredados («Sin informar», «Heterogéneo»): solo las vistas aún no migradas los usan. */
function matchesSpecial(g: GroupMeta, q: AnalysisQuery): boolean {
  const sp = q.support.filter((v) => v === SELECT_NONE || v === SELECT_MIXED);
  const ho = q.hosting.filter((v) => v === SELECT_NONE || v === SELECT_MIXED);
  return (sp.length === 0 || matchesSelection(g.support, sp)) && (ho.length === 0 || matchesSelection(g.hosting, ho));
}

function matchesSelection(cell: MetaCell, selected: string[]): boolean {
  if (selected.length === 0) return true;
  return selected.some((s) => (s === SELECT_NONE ? cell.contains.length === 0 : s === SELECT_MIXED ? cell.heterogeneous : cell.contains.includes(s)));
}

/**
 * Soporte/Servidor de HOTFIX-02: OR dentro de cada filtro y AND entre ambos EN EL MISMO Cliente (unidad). Sin selección = todos. Un Grupo incluido
 * conserva todo su ingreso y sus horas: el filtro decide la pertenencia del Grupo, no recorta sus cifras.
 */
export function matchesCommon(g: Pick<GroupMeta, "units">, soporte: readonly string[], servidor: readonly string[], estado: Estado = "todos"): boolean {
  if (soporte.length === 0 && servidor.length === 0) return true;
  // HOTFIX-03 §7: con «Activos» el Soporte/Servidor debe justificarse en un Cliente compatible ACTIVO; con «Inactivos», en uno inactivo; con «Todos», en cualquiera.
  return g.units.filter((u) => estado === "todos" || (estado === "activos") === u.active).some((u) => (soporte.length === 0 || u.support.some((v) => soporte.includes(v))) && (servidor.length === 0 || u.hosting.some((v) => servidor.includes(v))));
}

/** Conjunto filtrado de grupos (los filtros de identificación seleccionan grupos económicos completos). */
export function filterGroups(all: GroupMeta[], q: AnalysisQuery): GroupMeta[] {
  const needle = fold(q.q);
  return all.filter(
    (g) =>
      matchesEstado(g.effectiveActive, q.status) &&
      (needle === "" || fold(g.name).includes(needle) || fold(g.bcDenomination ?? "").includes(needle)) &&
      matchesCommon(g, q.support.filter((v) => v !== SELECT_NONE && v !== SELECT_MIXED), q.hosting.filter((v) => v !== SELECT_NONE && v !== SELECT_MIXED), q.status) &&
      matchesSpecial(g, q) &&
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
    if (sort === "support" || sort === "hosting") {
      const x = a.meta[sort].values.join("+");
      const y = b.meta[sort].values.join("+");
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

/**
 * Totales de Usuarios al corte y Tarifa anual/usuario de TODO el filtrado (HOTFIX-02 §7), con componentes agregados: usuarios = Σ de stocks conocidos;
 * tarifa = 12 × ΣR / Σ usuarios·mes de los grupos con tarifa calculable (nunca la media de tarifas). `missing` cuenta los grupos que no aportan y hace
 * parcial el total (el servicio no lo presenta como completo).
 */
export type UsersTariffTotal = { users: string | null; usersMissing: number; tariff: string | null; tariffMissing: number; groups: number };
export function usersTariffTotal(rows: readonly PortfolioRow[], k: PeriodKey): UsersTariffTotal {
  let users = 0;
  let known = 0;
  let rev = Dec.ZERO;
  let um = Dec.ZERO;
  let tariffGroups = 0;
  for (const r of rows) {
    const p = r.periods[k];
    if (p.users.stock.value !== null) {
      users += p.users.stock.value;
      known++;
    }
    const t = p.perUserPerYear;
    if (t.value !== null && t.operands?.ingresoPeriodo && t.operands.usuariosMes) {
      rev = rev.add(Dec.parse(t.operands.ingresoPeriodo) as Dec);
      um = um.add(Dec.parse(t.operands.usuariosMes) as Dec);
      tariffGroups++;
    }
  }
  const tr = tariffGroups > 0 ? tariffRun(rev, um) : null;
  return { users: known > 0 ? String(users) : null, usersMissing: rows.length - known, tariff: tr?.value.toString() ?? null, tariffMissing: rows.length - tariffGroups, groups: rows.length };
}

const totalsOf = (rows: readonly PortfolioRow[]) => Object.fromEntries(PERIOD_KEYS.map((k) => [k, usersTariffTotal(rows, k)])) as Record<PeriodKey, UsersTariffTotal>;

export type PortfolioView = {
  query: AnalysisQuery;
  cut: string;
  /** Total de grupos del maestro y del conjunto filtrado (cartera). */
  totalGroups: number;
  filteredGroups: number;
  rows: PortfolioRow[];
  /** Usuarios y tarifa agregados de TODO el filtrado (no solo la página). */
  totals: Record<PeriodKey, UsersTariffTotal>;
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
      totals: totalsOf(sorted),
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
      query, cut, totalGroups: all.length, filteredGroups: cohort.length, rows, allRows: rows, totals: totalsOf(rows), page: 1, pageCount: 1,
      economics: { periodsDefinition: econ.periodsDefinition, settings: econ.settings, recalculatedWithOlderSettings: econ.recalculatedWithOlderSettings, portfolio: econ.portfolio, unattributed: econ.unattributed, reference: econ.reference, input: econ.input },
    };
  });
}

export { BLOCK_PERIOD, PERIOD_KEYS };
