import { Prisma } from "@/generated/prisma/client";
import { effectiveCut } from "@/domain/finance";
import { likePattern, type AnalysisQuery } from "@/domain/analytics-query";
import { economicsInTx, PERIOD_KEYS, type EconomicResult, type EntityResult, type PeriodKey } from "@/server/economics/engine";
import { filterGroups, loadGroupMeta, type GroupMeta, type MetaCell } from "./portfolio";
import { loadBugs, loadDedication, loadPap, loadTickets, type BugSummary, type DedicationPeriod, type EntityRef, type PapSummary, type PeriodRange, type TicketPeriod } from "./operational";
import { readSnapshot, snapshotPoint, type Tx } from "./snapshot";

/**
 * Ficha de Análisis Cliente (CSAPP-06 §6-§8): Grupo Cliente, Cliente o implantación, por secciones de carga diferida. El ingreso económico
 * existe solo al nivel Grupo; un Cliente/implantación muestra sus horas, usuarios y hechos operativos y, aparte, el contexto económico
 * «del grupo» sin repartir dinero. La cohorte de referencia de las desviaciones es el conjunto filtrado desde Comparativa (o la cartera
 * completa, identificada, si se abre directamente).
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
  /** Dato de contexto del grupo, rotulado «del grupo» cuando la entidad es Cliente/implantación. */
  groupMeta: GroupMeta | null;
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
  const [clients, clientsTotal, impls, implsTotal, own, gm] = await Promise.all([
    clientsOf ? tx.client.findMany({ where: clientsOf, select: { id: true, name: true, isActive: true, _count: { select: { implementations: true } } }, orderBy: [{ name: "asc" }, { id: "asc" }], take: MAX_CHILDREN }) : Promise.resolve([]),
    clientsOf ? tx.client.count({ where: clientsOf }) : Promise.resolve(0),
    implsWhere ? tx.implementation.findMany({ where: implsWhere, select: { id: true, name: true, isActive: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: MAX_CHILDREN }) : Promise.resolve([]),
    implsWhere ? tx.implementation.count({ where: implsWhere }) : Promise.resolve(0),
    ownTerms(tx, ref, cut),
    group ? loadGroupMeta(tx, cut, [group.id]) : Promise.resolve([]),
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
    groupMeta: gm[0] ?? null,
  };
}

// ---------------------------------------------------------------- Ficha completa

export type FichaView = {
  query: AnalysisQuery;
  context: EntityContext;
  cut: string;
  /** Resultado económico/horas de la entidad (Grupo: con ingreso; Cliente/implantación: horas y usuarios, sin ratio propio). */
  entity: EntityResult;
  /** Cliente/implantación: contexto económico «del grupo» (no se suma al resultado operativo del Cliente). */
  groupContext: EntityResult | null;
  cohort: { kind: "filtered" | "all" | "none"; groups: number; note: string | null; portfolio: EconomicResult["portfolio"] };
  economics: Pick<EconomicResult, "periodsDefinition" | "settings" | "recalculatedWithOlderSettings" | "reference" | "input" | "unattributed">;
  dedication: Record<string, DedicationPeriod> | null;
  pap: PapSummary | null;
  tickets: { supported: boolean; periods: Record<string, TicketPeriod> } | null;
  bugs: BugSummary | null;
  sources: { profileId: string; status: string; extraction: string | null; received: string; rows: number }[] | null;
};

function ranges(e: EconomicResult): PeriodRange[] {
  return [
    ...PERIOD_KEYS.map((k) => ({ key: k as string, from: e.periodsDefinition[k].from, to: e.periodsDefinition[k].to })),
  ];
}

export async function getFicha(actorId: string, query: AnalysisQuery, ref: EntityRef): Promise<FichaView | null> {
  return readSnapshot(actorId, async (tx) => {
    const cut = effectiveCut(query.date, query.mode);
    const context = await loadEntityContext(tx, ref, cut);
    if (!context) return null;
    await snapshotPoint("ficha:after-context");
    const common = { service: query.service, date: query.date, mode: query.mode, settingsRevision: query.revision ?? undefined, unpaged: true as const };

    // Cohorte de referencia (solo Grupo): el conjunto filtrado desde Comparativa o la cartera completa (identificada). En pestañas distintas
    // del resumen no se necesita la cohorte: el motor calcula solo la entidad.
    let cohort: FichaView["cohort"] = { kind: "none", groups: 0, note: null, portfolio: null };
    let econ: EconomicResult;
    let entity: EntityResult;
    let groupContext: EntityResult | null = null;
    if (ref.type === "group") {
      let ids = [ref.id];
      if (query.tab === "resumen") {
        const all = await loadGroupMeta(tx, cut);
        const filtered = filterGroups(all, query);
        const inFiltered = filtered.some((g) => g.id === ref.id);
        const useFiltered = filtered.length > 0 && inFiltered && filtered.length < all.length;
        ids = (useFiltered ? filtered : all).map((g) => g.id);
        cohort = {
          kind: useFiltered ? "filtered" : "all",
          groups: ids.length,
          note: useFiltered
            ? `Cohorte filtrada de referencia: ${ids.length} de ${all.length} grupos (los filtros de Comparativa).`
            : filtered.length > 0 && !inFiltered
              ? `El grupo no pertenece al conjunto filtrado indicado: se usa la cartera completa (${all.length} grupos) como referencia general.`
              : `Referencia general: cartera completa (${all.length} grupos).`,
          portfolio: null,
        };
      }
      econ = await economicsInTx(tx, { ...common, scope: { type: "groups", ids }, detailFor: ref.id });
      cohort.portfolio = econ.portfolio;
      if (query.tab !== "resumen") cohort = { kind: "none", groups: 1, note: "La desviación contra cartera se calcula en la pestaña Resumen y evolución.", portfolio: null };
      entity = econ.entities.find((e) => e.id === ref.id) as EntityResult;
    } else {
      econ = await economicsInTx(tx, { ...common, scope: ref.type === "client" ? { type: "client", id: ref.id } : { type: "implementation", id: ref.id }, detailFor: ref.id });
      entity = econ.entities[0];
      if (context.group) {
        const g = await economicsInTx(tx, { ...common, scope: { type: "groups", ids: [context.group.id] } });
        groupContext = g.entities[0] ?? null;
      }
    }
    await snapshotPoint("ficha:after-economics");

    const periods = ranges(econ);
    const monthlyDed: PeriodRange[] = entity.monthly.map((m) => ({ key: m.label, from: m.from, to: m.to }));
    const needsOps = query.tab !== "resumen" || true; // la dedicación mensual alimenta las gráficas del resumen
    const dedication = needsOps ? await loadDedication(tx, ref, [...periods, ...monthlyDed], query.service) : null;
    const pap = query.tab === "pap" || query.tab === "resumen" ? await loadPap(tx, ref, [...periods, ...entity.monthly.map((m) => ({ key: m.label, from: m.from, to: m.to }))]) : null;
    const tickets = query.tab === "tickets" ? await loadTickets(tx, ref, periods) : null;
    const bugs = query.tab === "tickets" ? await loadBugs(tx, ref, periods) : null;
    const sources =
      query.tab === "datos"
        ? (
            await tx.$queryRaw<{ profileId: string; status: string; extraction: string | null; received: string; rows: number }[]>(Prisma.sql`
              SELECT DISTINCT ON ("profileId") "profileId", status::text AS status, to_char("declaredExtractionDate", 'YYYY-MM-DD') AS extraction,
                to_char("createdAt" AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD HH24:MI') AS received, "rowsImported" AS rows
              FROM "UploadBatch" WHERE status = 'COMPLETED' ORDER BY "profileId", "createdAt" DESC`)
          )
        : null;
    return {
      query, context, cut, entity, groupContext, cohort,
      economics: { periodsDefinition: econ.periodsDefinition, settings: econ.settings, recalculatedWithOlderSettings: econ.recalculatedWithOlderSettings, reference: econ.reference, input: econ.input, unattributed: econ.unattributed },
      dedication, pap, tickets, bugs, sources,
    };
  });
}

export type { MetaCell, PeriodKey };
