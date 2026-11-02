import { Prisma } from "@/generated/prisma/client";
import { INCIDENT_APP_CAUSES, INCIDENT_INFRA_CAUSE } from "@/domain/zendesk";
import { PROFILE_KEYS, type PapKind, type PulseConfig, type ProfileKey } from "@/domain/pulse-catalog";
import type { PulseScope } from "@/domain/pulse-query";
import { CLASS_OF_SQL, SERVICE_OF_SQL, type ServiceSelection } from "@/server/economics/engine";
import { ticketViewSql } from "@/server/zendesk/derive";

/**
 * Fragmentos SQL de Pulse Rent. El RESUMEN (agregados por conjuntos) y el DETALLE (filas paginadas que concilian con el numerador) se
 * construyen a partir de los MISMOS fragmentos, de modo que una cifra y su detalle no pueden divergir (CSAPP-07 §7, §11).
 */
export const timeCol = (s: PulseScope) => Prisma.raw(s === "group" ? '"groupId"' : s === "client" ? '"clientId"' : '"implementationId"');
export const papCol = (s: PulseScope) => Prisma.raw(s === "group" ? '"drvGroupId"' : s === "client" ? '"drvClientId"' : '"drvImplementationId"');

export type Selector = { idx: number; key: ProfileKey; team: string | null; level: string | null; pmo: boolean | null };
/** Selectores canónicos en orden de prioridad (el orden de los perfiles): una actividad cuenta en el PRIMER perfil que la captura. */
export function selectorsOf(cfg: PulseConfig): Selector[] {
  let i = 0;
  const out: Selector[] = [];
  for (const key of PROFILE_KEYS) for (const s of cfg.profiles[key] ?? []) out.push({ idx: i++, key, team: s.teamId, level: s.levelId, pmo: s.pmo });
  return out;
}
export const configuredProfiles = (cfg: PulseConfig): Set<ProfileKey> => new Set(PROFILE_KEYS.filter((k) => (cfg.profiles[k] ?? []).length > 0));

export const selValues = (sels: Selector[]) =>
  sels.length === 0
    ? Prisma.sql`SELECT NULL::int AS idx, NULL::text AS key, NULL::text AS team, NULL::text AS level, NULL::boolean AS pmo WHERE false`
    : Prisma.sql`SELECT * FROM (VALUES ${Prisma.join(sels.map((s) => Prisma.sql`(${s.idx}::int, ${s.key}::text, ${s.team}::text, ${s.level}::text, ${s.pmo}::boolean)`))}) v(idx, key, team, level, pmo)`;

/**
 * Actividad elegible del periodo con su perfil canónico y su clase de causa. Columnas: source, entryId, workDate, minutes, ticketId, entity,
 * profile (clave de perfil o SIN_PERFIL), cls (INCIDENTE_VINCLE | OTRO_SOPORTE | SIN_CLASIFICAR). Las horas sin causa quedan SIN_CLASIFICAR.
 */
export function classifiedActivitySql(p: { scope: PulseScope; ids: string[]; from: string; to: string; service: ServiceSelection; selectors: Selector[] }): Prisma.Sql {
  return Prisma.sql`
    WITH sel AS (${selValues(p.selectors)}),
    a0 AS (SELECT t.* FROM "TimeActivity" t WHERE t."isEligible" AND t."workDate" BETWEEN ${p.from}::date AND ${p.to}::date AND t.${timeCol(p.scope)} = ANY(${p.ids})),
    a AS (SELECT a.*, ${SERVICE_OF_SQL} AS svc FROM a0 a),
    c AS (
      SELECT a.*, rv."causaRaiz" AS cause, rv.id AS rev_id, h.value AS hosting
      FROM a
      LEFT JOIN "ZdTicket" zt ON zt."ticketId" = a."ticketId"
      LEFT JOIN "ZdTicketRevision" rv ON rv.id = zt."currentRevisionId"
      LEFT JOIN LATERAL (
        SELECT st.value FROM "ServiceTerm" st
        WHERE st.attribute = 'HOSTING' AND (st."clientId" = a."clientId" OR (a."groupId" IS NOT NULL AND st."groupId" = a."groupId"))
          AND (st."validFrom" IS NULL OR st."validFrom" <= a."workDate") AND (st."validTo" IS NULL OR a."workDate" < st."validTo")
        ORDER BY (st."clientId" IS NOT NULL) DESC LIMIT 1) h ON true
      WHERE (${p.service} = 'TOTAL' OR a.svc = ${p.service}))
    SELECT c.source, c."entryId", c."workDate", c.minutes, c."ticketId", c.${timeCol(p.scope)} AS entity, COALESCE(pf.key, 'SIN_PERFIL') AS profile,
      CASE WHEN c.rev_id IS NULL OR c.cause IS NULL THEN 'SIN_CLASIFICAR'
           WHEN lower(c.cause) = ANY(${[...INCIDENT_APP_CAUSES]}::text[]) THEN 'INCIDENTE_VINCLE'
           WHEN lower(c.cause) = ${INCIDENT_INFRA_CAUSE} THEN CASE c.hosting WHEN 'CLOUD' THEN 'INCIDENTE_VINCLE' WHEN 'OP' THEN 'OTRO_SOPORTE' ELSE 'SIN_CLASIFICAR' END
           ELSE 'OTRO_SOPORTE' END AS cls
    FROM c
    LEFT JOIN LATERAL (
      SELECT s.key FROM sel s
      WHERE (s.team IS NULL OR s.team = c."teamId") AND (s.level IS NULL OR s.level = c."levelId") AND (s.pmo IS NULL OR s.pmo IS NOT DISTINCT FROM c.pmo)
      ORDER BY s.idx LIMIT 1) pf ON true`;
}

/** Perfil y clase de una métrica de horas como predicado sobre el fragmento anterior (alias x). */
export const CLS_VALUE = { incident: "INCIDENTE_VINCLE", other: "OTRO_SOPORTE", unclassified: "SIN_CLASIFICAR" } as const;

// ---------------------------------------------------------------- Tickets y escalados

/** Tickets creados en el rango con su entidad (Grupo o Cliente; las implantaciones no tienen atribución de tickets). */
export function ticketSetSql(scope: Exclude<PulseScope, "implementation">, ids: string[], from: string, to: string): Prisma.Sql {
  const col = scope === "group" ? Prisma.raw("tv.group_id") : Prisma.raw("tv.client_id");
  return Prisma.sql`
    SELECT tv.key AS ticket_id, tv.created_on, ${col} AS entity, tv.cause, tv.incident_class, lower(rv."ticketType") AS type, rv.status, rv.destinations
    FROM (${ticketViewSql(Prisma.sql`
      SELECT zt."ticketId" AS key, NULL::jsonb AS payload, rv0."organizationId" AS org_id, rv0."createdOn" AS created_on, rv0."causaRaiz" AS cause, rv0."typeKnown" AS type_known, rv0."statusKnown" AS status_known
      FROM "ZdTicket" zt JOIN "ZdTicketRevision" rv0 ON rv0.id = zt."currentRevisionId" WHERE rv0."createdOn" BETWEEN ${from}::date AND ${to}::date`)}) tv
    JOIN "ZdTicket" zt2 ON zt2."ticketId" = tv.key JOIN "ZdTicketRevision" rv ON rv.id = zt2."currentRevisionId"
    WHERE ${col} = ANY(${ids})`;
}
export const N3_DESTINATIONS = ["PMO_N3", "IT_N3"];
export const ticketPredicate = (kind: "all" | "n2" | "n3" | "n2_to_n3"): Prisma.Sql =>
  kind === "all" ? Prisma.sql`true` : kind === "n2" ? Prisma.sql`x.destinations && ARRAY['CS_N2']::text[]` : kind === "n3" ? Prisma.sql`x.destinations && ${N3_DESTINATIONS}::text[]` : Prisma.sql`(x.destinations && ARRAY['CS_N2']::text[] AND x.destinations && ${N3_DESTINATIONS}::text[])`;

// ---------------------------------------------------------------- PAP

export const papSetSql = (scope: PulseScope, ids: string[]): Prisma.Sql => Prisma.sql`
  SELECT t.id AS item_id, t."listKey", t."papId", v.id AS rev_id, v.title, v.result, v."productionDate", v."requestDate", v."correctiveState" AS state, t.${papCol(scope)} AS entity
  FROM "PapItem" t JOIN "PapRevision" v ON v.id = t."currentRevisionId"
  WHERE t.${papCol(scope)} = ANY(${ids})`;

const hasCause = (cat: string, origin?: string) =>
  origin
    ? Prisma.sql`EXISTS (SELECT 1 FROM "PapCause" c WHERE c."revisionId" = x.rev_id AND c.category = ${cat} AND c.origin = ${origin})`
    : Prisma.sql`EXISTS (SELECT 1 FROM "PapCause" c WHERE c."revisionId" = x.rev_id AND c.category = ${cat})`;
/** Predicado de cada categoría de PAP (alias x). Un PAP con varias causas puede pertenecer a varias categorías; el total único no las suma. */
export function papPredicate(kind: PapKind): Prisma.Sql | null {
  switch (kind) {
    case "total": return Prisma.sql`true`;
    case "corrective_total": return Prisma.sql`x.state = 'CORRECTIVE'`;
    case "corrective_standard": return hasCause("CORRECTIVE", "STANDARD");
    case "corrective_project": return Prisma.sql`(${hasCause("CORRECTIVE", "CUSTOMIZATION")} OR ${hasCause("CORRECTIVE", "CONFIG_DATA")} OR ${hasCause("CORRECTIVE", "PROCESSES")} OR ${hasCause("CORRECTIVE", "INFRASTRUCTURE")})`;
    case "client_origin": return hasCause("CORRECTIVE", "CLIENT_ORIGIN");
    case "evolutive_observed": return hasCause("EVOLUTIVE");
    case "evolutive_nonbillable": return null; // sin evidencia positiva de no facturación no hay predicado: la métrica no está disponible
  }
}

/** La cobertura de fuentes ya no se deduce de la existencia de filas fechadas (CSAPP-08): se usa el contrato compartido `loadDeclarations` + `coverageOf`. */
export { CLASS_OF_SQL };
