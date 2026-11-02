import { Prisma } from "@/generated/prisma/client";
import { STANDARD_CAUSE } from "@/domain/zendesk";
import type { PulseScope } from "@/domain/pulse-query";
import { SERVICE_OF_SQL, type ServiceSelection } from "@/server/economics/engine";
import { N3_DESTINATIONS, papSetSql, selValues, ticketSetSql, timeCol, type Selector } from "@/server/pulse/sql";
import type { Tx } from "@/server/analytics/snapshot";
import { Dec } from "@/domain/finance";
import { UNRESOLVED_STATUSES } from "@/domain/zendesk";

/**
 * Hechos de Calidad por CONJUNTOS (CSAPP-08 §10): una consulta por familia de hechos, nunca una por entidad, KPI o mes. El detalle y el agregado comparten
 * estos fragmentos de predicado, de modo que una cifra y sus filas no pueden divergir. Los ids de entidad son de Grupo o de Cliente (nunca implantaciones).
 */
export type QScopeDb = Exclude<PulseScope, "implementation">;

/** Vínculo válido de un ticket externo con un Work Item Bug_: resuelto, no rechazado y con evidencia vigente (lote completado) o confirmación manual. */
export const validBugLinkSql = (ticketIdExpr: Prisma.Sql): Prisma.Sql => Prisma.sql`
  EXISTS (
    SELECT 1 FROM "WorkItemLink" l
    JOIN "WorkItem" w ON w.id = l."workItemId"
    JOIN "WorkItemRevision" wr ON wr.id = w."currentRevisionId"
    WHERE l."ticketId" = ${ticketIdExpr} AND wr."isBug" AND l."drvState" = 'RESOLVED_EXTERNAL' AND COALESCE(l."manualState", '') <> 'REJECTED'
      AND (l."manualState" = 'CONFIRMED' OR EXISTS (SELECT 1 FROM "WorkItemLinkEvidence" e JOIN "UploadBatch" eb ON eb.id = e."batchId" AND eb.status = 'COMPLETED' WHERE e."linkId" = l.id)))`;

const isProblem = Prisma.sql`x.type = 'problem'`;
export const STD = Prisma.sql`(lower(x.cause) = ${STANDARD_CAUSE})`;
export const predicate = {
  incidentOrProblem: Prisma.sql`x.type IN ('incident', 'problem')`,
  incident: Prisma.sql`x.type = 'incident'`,
  problem: isProblem,
  n3: Prisma.sql`x.destinations && ${N3_DESTINATIONS}::text[]`,
  n3Pmo: Prisma.sql`x.destinations && ARRAY['PMO_N3']::text[]`,
  n3It: Prisma.sql`x.destinations && ARRAY['IT_N3']::text[]`,
  bugStd: Prisma.sql`(${isProblem} AND ${STD})`,
  bugLink: Prisma.sql`(${isProblem} AND ${validBugLinkSql(Prisma.sql`x.ticket_id`)})`,
};
export const bugUnion = Prisma.sql`(${predicate.bugStd} OR ${predicate.bugLink})`;

export type TicketFacts = { entity: string; total: number; inc: number; prob: number; n3: number; n3pmo: number; n3it: number; s: number; b: number; both: number; union: number; incLinked: number; unknownType: number };
/** Tickets CREADOS en el rango (fecha de creación, nunca la del escalado): flujo, N3 y sexto indicador en una sola pasada. */
export async function ticketFacts(tx: Tx, scope: QScopeDb, ids: string[], from: string, to: string): Promise<Map<string, TicketFacts>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.$queryRaw<{ entity: string; total: bigint; inc: bigint; prob: bigint; n3: bigint; n3pmo: bigint; n3it: bigint; s: bigint; b: bigint; both: bigint; uni: bigint; inclinked: bigint; unk: bigint }[]>(Prisma.sql`
    SELECT x.entity, count(*) AS total,
      count(*) FILTER (WHERE ${predicate.incident}) AS inc, count(*) FILTER (WHERE ${predicate.problem}) AS prob,
      count(*) FILTER (WHERE ${predicate.n3}) AS n3, count(*) FILTER (WHERE ${predicate.n3Pmo}) AS n3pmo, count(*) FILTER (WHERE ${predicate.n3It}) AS n3it,
      count(*) FILTER (WHERE ${predicate.bugStd}) AS s, count(*) FILTER (WHERE ${predicate.bugLink}) AS b,
      count(*) FILTER (WHERE ${predicate.bugStd} AND ${predicate.bugLink}) AS "both", count(*) FILTER (WHERE ${bugUnion}) AS uni,
      count(*) FILTER (WHERE ${predicate.incident} AND ${validBugLinkSql(Prisma.sql`x.ticket_id`)}) AS inclinked,
      count(*) FILTER (WHERE x.type NOT IN ('incident', 'problem', 'task', 'question')) AS unk
    FROM (${ticketSetSql(scope, ids, from, to)}) x WHERE x.entity IS NOT NULL GROUP BY 1`);
  return new Map(rows.map((r) => [r.entity, { entity: r.entity, total: Number(r.total), inc: Number(r.inc), prob: Number(r.prob), n3: Number(r.n3), n3pmo: Number(r.n3pmo), n3it: Number(r.n3it), s: Number(r.s), b: Number(r.b), both: Number(r.both), union: Number(r.uni), incLinked: Number(r.inclinked), unknownType: Number(r.unk) }]));
}

export type PapFacts = { entity: string; corrective: number; standard: number; project: number; clientOrigin: number; total: number; noDate: number; unknownState: number };
/** PAP únicos por lista+ID con producción en el rango. Sin filtro por resultado; sin fecha o sin causa se cuentan aparte (ubicación/clasificación pendiente). */
export async function papFacts(tx: Tx, scope: QScopeDb, ids: string[], from: string, to: string): Promise<Map<string, PapFacts>> {
  if (ids.length === 0) return new Map();
  const cause = (cat: string, origins: string[]) => Prisma.sql`EXISTS (SELECT 1 FROM "PapCause" c WHERE c."revisionId" = x.rev_id AND c.category = ${cat} AND c.origin = ANY(${origins}::text[]))`;
  const rows = await tx.$queryRaw<{ entity: string; corr: bigint; std: bigint; proj: bigint; cli: bigint; total: bigint; nodate: bigint; unk: bigint }[]>(Prisma.sql`
    SELECT x.entity,
      count(*) FILTER (WHERE x."productionDate" BETWEEN ${from}::date AND ${to}::date AND x.state = 'CORRECTIVE') AS corr,
      count(*) FILTER (WHERE x."productionDate" BETWEEN ${from}::date AND ${to}::date AND ${cause("CORRECTIVE", ["STANDARD"])}) AS std,
      count(*) FILTER (WHERE x."productionDate" BETWEEN ${from}::date AND ${to}::date AND ${cause("CORRECTIVE", ["CUSTOMIZATION", "CONFIG_DATA", "PROCESSES", "INFRASTRUCTURE"])}) AS proj,
      count(*) FILTER (WHERE x."productionDate" BETWEEN ${from}::date AND ${to}::date AND ${cause("CORRECTIVE", ["CLIENT_ORIGIN"])}) AS cli,
      count(*) FILTER (WHERE x."productionDate" BETWEEN ${from}::date AND ${to}::date) AS total,
      count(*) FILTER (WHERE x."productionDate" IS NULL) AS nodate,
      count(*) FILTER (WHERE x."productionDate" BETWEEN ${from}::date AND ${to}::date AND x.state = 'UNKNOWN') AS unk
    FROM (${papSetSql(scope, ids)}) x GROUP BY 1`);
  return new Map(rows.map((r) => [r.entity, { entity: r.entity, corrective: Number(r.corr), standard: Number(r.std), project: Number(r.proj), clientOrigin: Number(r.cli), total: Number(r.total), noDate: Number(r.nodate), unknownState: Number(r.unk) }]));
}

export type HourRow = { entity: string; profile: string; role: string; svc: string; bucketClass: "ELIGIBLE" | "PENDING"; minutes: Dec };
/**
 * Horas por entidad, perfil canónico, rol PMO y servicio (una consulta). Elegibles según la fecha del trabajo (antes de 2025 Zendesk; desde 2025 PMO Wrike
 * y resto Zendesk, ya resuelto por `TimeActivity`); las pendientes de elegibilidad se devuelven aparte para limitar el indicador. Una actividad
 * `(source, entryId)` cuenta una vez. Los usuarios y la causa no intervienen: la rentabilidad conserva las horas sea cual sea el origen.
 */
export async function hourFacts(tx: Tx, scope: QScopeDb, ids: string[], from: string, to: string, selectors: Selector[]): Promise<HourRow[]> {
  if (ids.length === 0) return [];
  const rows = await tx.$queryRaw<{ entity: string; profile: string; role: string; svc: string; cls: string; minutes: string }[]>(Prisma.sql`
    WITH sel AS (${selValues(selectors)}),
    a0 AS (SELECT t.* FROM "TimeActivity" t
          WHERE t."workDate" BETWEEN ${from}::date AND ${to}::date AND t.${timeCol(scope)} = ANY(${ids}) AND (t."isEligible" OR t.eligibility = 'PENDING_ELIGIBILITY')),
    a AS (SELECT a.*, ${SERVICE_OF_SQL} AS svc FROM a0 a),
    f AS (SELECT a.*, a.${timeCol(scope)} AS entity FROM a)
    SELECT f.entity, COALESCE(pf.key, 'SIN_PERFIL') AS profile, COALESCE(upper(r.name), 'SIN_ROL') AS role, f.svc,
      CASE WHEN f."isEligible" THEN 'ELIGIBLE' ELSE 'PENDING' END AS cls, sum(f.minutes)::text AS minutes
    FROM f
    LEFT JOIN LATERAL (
      SELECT s.key FROM sel s WHERE (s.team IS NULL OR s.team = f."teamId") AND (s.level IS NULL OR s.level = f."levelId") AND (s.pmo IS NULL OR s.pmo IS NOT DISTINCT FROM f.pmo)
      ORDER BY s.idx LIMIT 1) pf ON true
    LEFT JOIN "StaffCatalogItem" r ON r.id = f."roleId"
    GROUP BY 1, 2, 3, 4, 5`);
  return rows.map((r) => ({ entity: r.entity, profile: r.profile, role: r.role, svc: r.svc, bucketClass: r.cls as "ELIGIBLE" | "PENDING", minutes: Dec.parse(r.minutes) as Dec }));
}
export type { ServiceSelection };

// ---------------------------------------------------------------- Stock observado (fotografía)

export type StockTicket = { ticketId: string; entity: string; type: string; status: string; createdOn: string; statusKnown: boolean; typeKnown: boolean; cause: string | null; hosting: string | null; entorno: string | null };
/**
 * Tickets de UNA fotografía (lote) con la revisión que ese lote observó, no `currentRevisionId`: un estado posterior no reescribe el pasado. La organización
 * se resuelve con la vigencia a la fecha de creación y el alojamiento con el contrato de clasificación de la creación. Devuelve TODOS los observados del
 * ámbito (activos, resueltos y de otros tipos) para contar cobertura; los activos de incidente/problema alimentan edades y detalle.
 */
export function stockSetSql(scope: QScopeDb, ids: string[], batchId: string, opts: { activeOnly?: boolean } = {}): Prisma.Sql {
  // `activeOnly` filtra ANTES de resolver organización y alojamiento (no se paga la resolución de los resueltos); los de estado desconocido se conservan.
  const only = opts.activeOnly ? Prisma.sql`AND (NOT rv."statusKnown" OR lower(rv.status) IN ('new', 'open', 'pending', 'hold'))` : Prisma.empty;
  const col = scope === "group" ? Prisma.raw("tv.group_id") : Prisma.raw("tv.client_id");
  return Prisma.sql`
    SELECT o."ticketId" AS ticket_id, ${col} AS entity, lower(rv."ticketType") AS type, lower(rv.status) AS status, to_char(rv."createdOn", 'YYYY-MM-DD') AS created_on,
      rv."statusKnown" AS status_known, rv."typeKnown" AS type_known, rv."causaRaiz" AS cause, tv.hosting, rv.entorno
    FROM "ZdTicketObservation" o
    JOIN "UploadBatch" b ON b.id = o."batchId" AND b.status = 'COMPLETED'
    JOIN "ZdTicketRevision" rv ON rv.id = o."revisionId"
    JOIN LATERAL (${ticketViewForRevision()}) tv ON true
    WHERE o."batchId" = ${batchId} ${only} AND ${col} = ANY(${ids})`;
}
import { ticketViewSql } from "@/server/zendesk/derive";
function ticketViewForRevision(): Prisma.Sql {
  return ticketViewSql(Prisma.sql`SELECT o."ticketId" AS key, NULL::jsonb AS payload, rv."organizationId" AS org_id, rv."createdOn" AS created_on, rv."causaRaiz" AS cause, rv."typeKnown" AS type_known, rv."statusKnown" AS status_known`);
}
export const ACTIVE_STATUSES: readonly string[] = UNRESOLVED_STATUSES;
