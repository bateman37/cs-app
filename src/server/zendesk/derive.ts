import { Prisma } from "@/generated/prisma/client";
import { INCIDENT_APP_CAUSES, INCIDENT_INFRA_CAUSE, PMO_CUTOFF, TICKET_STATUSES, TICKET_TYPES } from "@/domain/zendesk";

type Tx = Prisma.TransactionClient;

/**
 * Derivación de atribución de tiempos (ZTM 02-04), por SQL de conjuntos y en un único sitio: la usan la
 * previsualización (sobre el staging), la activación (al materializar) y el recálculo (sobre los registros).
 *
 * `src` produce: key text, payload jsonb (carga útil opaca que se devuelve tal cual), ticket_id text, user_id text, user_name text,
 * work_date date. Devuelve, por clave: payload, ticket_known, org_id, client_id, group_id, internal, person_id, via, name_conflict,
 * pmo, team_id, level_id, eligibility, bucket y flags. Reglas:
 *  - persona: por user_id con equivalencia vigente; el nombre solo como alias explícito y vigente, nunca por parecido;
 *    un ID reconocido no se reasigna por el nombre (si el nombre apunta a otra persona se marca el conflicto);
 *  - nivel, equipo y PMO: del maestro vigente a la fecha del trabajo;
 *  - elegibilidad: antes del corte cualquier equipo es elegible; desde el corte PMO se excluye, no PMO es elegible
 *    y PMO desconocido queda pendiente;
 *  - bucket: un único motivo principal por fila (partición contable); el resto son indicadores en flags.
 */
export function derivationSql(src: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    WITH s AS (${src}),
    base AS (
      SELECT s.key, s.payload, s.work_date, s.user_id,
        (t."ticketId" IS NOT NULL) AS ticket_known,
        rev."organizationId" AS org_id,
        idn."clientId" AS client_id,
        c."groupId" AS group_id,
        c."isInternal" AS internal,
        COALESCE(pid."personId", pnm."personId") AS person_id,
        CASE WHEN pid."personId" IS NOT NULL THEN 'ID' WHEN pnm."personId" IS NOT NULL THEN 'NAME' END AS via,
        (pid."personId" IS NOT NULL AND pnm."personId" IS NOT NULL AND pid."personId" <> pnm."personId") AS name_conflict
      FROM s
      LEFT JOIN "ZdTicket" t ON t."ticketId" = s.ticket_id
      LEFT JOIN "ZdTicketRevision" rev ON rev.id = t."currentRevisionId"
      LEFT JOIN LATERAL (
        SELECT e."clientId" FROM "ExternalIdentity" e
        WHERE rev."organizationId" IS NOT NULL AND e.system = 'ZENDESK' AND e.kind = 'ORG_ID' AND e."isActive"
          AND e."searchValue" = rev."organizationId"
          AND (e."validFrom" IS NULL OR e."validFrom" <= s.work_date) AND (e."validTo" IS NULL OR s.work_date < e."validTo")
        LIMIT 1) idn ON true
      LEFT JOIN "Client" c ON c.id = idn."clientId"
      LEFT JOIN LATERAL (
        SELECT a."personId" FROM "PersonAlias" a
        WHERE s.user_id IS NOT NULL AND a.system = 'ZENDESK' AND a.kind = 'ID' AND a."isActive" AND a."searchValue" = s.user_id
          AND (a."validFrom" IS NULL OR a."validFrom" <= s.work_date) AND (a."validTo" IS NULL OR s.work_date < a."validTo")
        LIMIT 1) pid ON true
      LEFT JOIN LATERAL (
        SELECT a."personId" FROM "PersonAlias" a
        WHERE s.user_name IS NOT NULL AND a.system = 'ZENDESK' AND a.kind = 'NAME' AND a."isActive" AND a."searchValue" = lower(s.user_name)
          AND (a."validFrom" IS NULL OR a."validFrom" <= s.work_date) AND (a."validTo" IS NULL OR s.work_date < a."validTo")
        LIMIT 1) pnm ON true
    ),
    ext AS (
      SELECT b.*,
        pm.flag AS pmo, tm."catalogItemId" AS team_id, lv."catalogItemId" AS level_id
      FROM base b
      LEFT JOIN LATERAL (
        SELECT x.flag FROM "PersonTerm" x WHERE x."personId" = b.person_id AND x.attribute = 'PMO_MEMBER'
          AND (x."validFrom" IS NULL OR x."validFrom" <= b.work_date) AND (x."validTo" IS NULL OR b.work_date < x."validTo") LIMIT 1) pm ON b.person_id IS NOT NULL
      LEFT JOIN LATERAL (
        SELECT x."catalogItemId" FROM "PersonTerm" x WHERE x."personId" = b.person_id AND x.attribute = 'TEAM'
          AND (x."validFrom" IS NULL OR x."validFrom" <= b.work_date) AND (x."validTo" IS NULL OR b.work_date < x."validTo") LIMIT 1) tm ON b.person_id IS NOT NULL
      LEFT JOIN LATERAL (
        SELECT x."catalogItemId" FROM "PersonTerm" x WHERE x."personId" = b.person_id AND x.attribute = 'LEVEL'
          AND (x."validFrom" IS NULL OR x."validFrom" <= b.work_date) AND (x."validTo" IS NULL OR b.work_date < x."validTo") LIMIT 1) lv ON b.person_id IS NOT NULL
    ),
    el AS (
      SELECT ext.*,
        CASE WHEN work_date < ${PMO_CUTOFF}::date THEN 'ELIGIBLE'
             WHEN pmo IS TRUE THEN 'EXCLUDED_PMO'
             WHEN pmo IS FALSE THEN 'ELIGIBLE'
             ELSE 'PENDING_ELIGIBILITY' END AS eligibility
      FROM ext
    )
    SELECT key, payload, ticket_known, org_id, client_id, group_id, internal, person_id, via, name_conflict, pmo, team_id, level_id, eligibility,
      CASE WHEN eligibility = 'EXCLUDED_PMO' THEN 'EXCLUDED_PMO'
           WHEN eligibility = 'PENDING_ELIGIBILITY' THEN 'PENDING_ELIGIBILITY'
           WHEN NOT ticket_known THEN 'NO_TICKET'
           WHEN org_id IS NULL THEN 'NO_ORGANIZATION'
           WHEN client_id IS NULL THEN 'NO_CLIENT'
           WHEN person_id IS NULL THEN 'NO_PERSON'
           ELSE 'ATTRIBUTABLE' END AS bucket,
      array_remove(ARRAY[
        CASE WHEN NOT ticket_known THEN 'NO_TICKET' END,
        CASE WHEN ticket_known AND org_id IS NULL THEN 'NO_ORGANIZATION' END,
        CASE WHEN org_id IS NOT NULL AND client_id IS NULL THEN 'NO_CLIENT' END,
        CASE WHEN client_id IS NOT NULL AND group_id IS NULL AND internal IS NOT TRUE THEN 'NO_GROUP' END,
        CASE WHEN person_id IS NULL THEN 'NO_PERSON' END,
        CASE WHEN user_id IS NULL THEN 'NO_USER_ID' END,
        CASE WHEN via = 'NAME' THEN 'PERSON_BY_NAME' END,
        CASE WHEN name_conflict THEN 'NAME_ID_CONFLICT' END,
        CASE WHEN internal IS TRUE THEN 'INTERNAL' END
      ], NULL) AS flags
    FROM el`;
}

/** Origen de claves para derivar filas ya materializadas (key = id del registro). */
export const entrySource = (where: Prisma.Sql) => Prisma.sql`
  SELECT e.id AS key, NULL::jsonb AS payload, e."ticketId" AS ticket_id, e."userId" AS user_id, e."userName" AS user_name, e."workDate" AS work_date
  FROM "ZdTimeEntry" e WHERE ${where}`;

/**
 * Origen de claves para derivar las filas válidas de un lote (key = posición). `payload` viaja con cada fila hasta el
 * resultado, de modo que los consumidores no tienen que volver a unir la derivación con el staging (esa unión, con un
 * planificador sin estadísticas, tiende a un bucle anidado que reevalúa la derivación por fila).
 */
export const stagedSource = (batchId: string, opts: { extra?: Prisma.Sql; payload?: Prisma.Sql; includeDuplicates?: boolean } = {}) => Prisma.sql`
  SELECT r.position::text AS key, ${opts.payload ?? Prisma.sql`NULL::jsonb`} AS payload, r.typed->>'ticket_id' AS ticket_id, r.typed->>'user_id' AS user_id,
         r.typed->>'user_name' AS user_name, (r.typed->>'date')::date AS work_date
  FROM "UploadStagedRow" r
  WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' ${opts.includeDuplicates ? Prisma.empty : Prisma.sql`AND r."duplicateInFile" = false`} ${opts.extra ?? Prisma.empty}`;

/** Serializa las operaciones que escriben tickets o derivados de tiempos (evita derivados obsoletos por carreras). */
export async function lockDerivation(tx: Tx) {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('csapp-zd-derive', 0))`);
}

/**
 * Recalcula lo derivado de los registros indicados. Solo escribe (y versiona) los que cambian: el recálculo es
 * idempotente y no altera contenido fuente, fechas de trabajo ni observaciones.
 */
export async function rederiveEntries(tx: Tx, where: Prisma.Sql, batchId: string | null): Promise<number> {
  // La derivación se materializa primero y después se aplica: unir una derivación cara dentro del UPDATE deja al
  // planificador decidir el orden sin estadísticas fiables (riesgo de reevaluarla por fila).
  await tx.$executeRaw(Prisma.sql`DROP TABLE IF EXISTS "_zd_drv"`);
  await tx.$executeRaw(Prisma.sql`CREATE TEMP TABLE "_zd_drv" ON COMMIT DROP AS ${derivationSql(entrySource(where))}`);
  await tx.$executeRaw(Prisma.sql`CREATE INDEX ON "_zd_drv" (key)`);
  await tx.$executeRaw(Prisma.sql`ANALYZE "_zd_drv"`);
  return tx.$executeRaw(Prisma.sql`
    UPDATE "ZdTimeEntry" e SET
      "drvTicketKnown" = d.ticket_known, "drvOrganizationId" = d.org_id, "drvClientId" = d.client_id, "drvGroupId" = d.group_id,
      "drvInternal" = d.internal, "drvPersonId" = d.person_id, "drvPersonVia" = d.via, "drvPmo" = d.pmo, "drvTeamId" = d.team_id,
      "drvLevelId" = d.level_id, "drvEligibility" = d.eligibility, "drvBucket" = d.bucket, "drvFlags" = d.flags,
      "drvVersion" = e."drvVersion" + 1, "drvAt" = now(), "drvBatchId" = ${batchId}, "updatedAt" = now()
    FROM "_zd_drv" d
    WHERE e.id = d.key AND (
      e."drvTicketKnown", e."drvOrganizationId", e."drvClientId", e."drvGroupId", e."drvInternal", e."drvPersonId", e."drvPersonVia",
      e."drvPmo", e."drvTeamId", e."drvLevelId", e."drvEligibility", e."drvBucket", e."drvFlags"
    ) IS DISTINCT FROM (
      d.ticket_known, d.org_id, d.client_id, d.group_id, d.internal, d.person_id, d.via, d.pmo, d.team_id, d.level_id,
      d.eligibility, d.bucket, d.flags)`);
}

/**
 * Vista derivada de tickets (relaciones y clasificación dependientes de maestros), calculada al consultar.
 * `src` produce: key, payload jsonb (se devuelve tal cual), org_id, created_on date, cause, type_known bool, status_known bool.
 * La vigencia de la equivalencia de organización y el alojamiento se evalúan en la fecha de creación del ticket.
 */
export function ticketViewSql(src: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT s.key, s.payload, s.org_id, s.created_on, s.cause,
      idn."clientId" AS client_id, c."groupId" AS group_id, c."isInternal" AS internal, h.value AS hosting,
      CASE WHEN s.org_id IS NULL THEN 'NO_ORGANIZATION'
           WHEN idn."clientId" IS NULL THEN 'NO_CLIENT'
           WHEN c."groupId" IS NULL AND NOT c."isInternal" THEN 'CLIENT_NO_GROUP'
           ELSE 'RESOLVED' END AS org_state,
      CASE WHEN s.cause IS NULL THEN 'PENDIENTE'
           WHEN lower(s.cause) = ANY(${[...INCIDENT_APP_CAUSES]}::text[]) THEN 'INCIDENTE_VINCLE'
           WHEN lower(s.cause) = ${INCIDENT_INFRA_CAUSE} THEN
             CASE h.value WHEN 'CLOUD' THEN 'INCIDENTE_VINCLE' WHEN 'OP' THEN 'NO_INCIDENTE_VINCLE' ELSE 'PENDIENTE' END
           ELSE 'NO_INCIDENTE_VINCLE' END AS incident_class,
      (s.cause IS NULL OR NOT s.type_known OR NOT s.status_known
        OR (lower(s.cause) = ${INCIDENT_INFRA_CAUSE} AND h.value IS NULL)) AS incomplete
    FROM (${src}) s
    LEFT JOIN LATERAL (
      SELECT e."clientId" FROM "ExternalIdentity" e
      WHERE s.org_id IS NOT NULL AND e.system = 'ZENDESK' AND e.kind = 'ORG_ID' AND e."isActive" AND e."searchValue" = s.org_id
        AND (e."validFrom" IS NULL OR e."validFrom" <= s.created_on) AND (e."validTo" IS NULL OR s.created_on < e."validTo")
      LIMIT 1) idn ON true
    LEFT JOIN "Client" c ON c.id = idn."clientId"
    LEFT JOIN LATERAL (
      SELECT st.value FROM "ServiceTerm" st
      WHERE st.attribute = 'HOSTING' AND c.id IS NOT NULL AND (st."clientId" = c.id OR (c."groupId" IS NOT NULL AND st."groupId" = c."groupId"))
        AND (st."validFrom" IS NULL OR st."validFrom" <= s.created_on) AND (st."validTo" IS NULL OR s.created_on < st."validTo")
      ORDER BY (st."clientId" IS NOT NULL) DESC LIMIT 1) h ON true`;
}

/** Filas válidas y no repetidas de un lote de tickets, con la posición como carga útil (para la instantánea de previsualización). */
export const stagedTicketSrc = (batchId: string) => Prisma.sql`
  SELECT r.typed->>'ticket_id' AS key, jsonb_build_object('position', r.position) AS payload,
    r.typed->>'organization_id' AS org_id, (r.typed->>'created_on')::date AS created_on, r.typed->>'causa_raiz' AS cause,
    (lower(r.typed->>'type') = ANY(${[...TICKET_TYPES]}::text[])) AS type_known,
    (lower(r.typed->>'status') = ANY(${[...TICKET_STATUSES]}::text[])) AS status_known
  FROM "UploadStagedRow" r
  WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' AND r."duplicateInFile" = false`;
