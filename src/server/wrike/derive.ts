import { Prisma } from "@/generated/prisma/client";
import { INCIDENT_APP_CAUSES, INCIDENT_INFRA_CAUSE, PMO_CUTOFF } from "@/domain/zendesk";

type Tx = Prisma.TransactionClient;

/**
 * Derivación de la dedicación Wrike (WRK 04-07), por SQL de conjuntos y en un único sitio: la usan la previsualización
 * (sobre el staging), la activación y el recálculo (sobre los registros).
 *
 * `src` produce: key text, payload jsonb, project text, user_name text, work_date date, explicit_state text,
 * explicit_ticket text, cands jsonb. Reglas:
 *  - ticket: campo explícito válido; solo si falta, el único candidato inequívoco del nombre; con varios no se elige;
 *    se confirma contra los tickets cargados y, si todavía no existe, queda como referencia pendiente;
 *  - persona: alias/ID de Wrike de PERSONAL vigente a la fecha del trabajo (nunca por parecido);
 *  - ámbito: equivalencia de Proyecto (cliente o implantación; o solo el Grupo Cliente cuando el proyecto coincide con la clave BC de
 *    un grupo) y, con ticket confirmado, su Cliente; si ambos
 *    señalan ámbitos incompatibles se conservan las horas y el conflicto, sin elegir cliente;
 *  - elegibilidad (política histórica única): antes del corte no sustituye a Zendesk; desde el corte, PMO elegible, no
 *    PMO fuera, PMO desconocido pendiente;
 *  - causa: solo con ticket confirmado, con alojamiento vigente a la FECHA DEL TRABAJO; sin evidencia, no clasificada.
 */
export function wrikeDerivationSql(src: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    WITH s AS (${src}),
    tk AS (
      SELECT s.*,
        CASE WHEN s.explicit_state = 'VALID' THEN s.explicit_ticket
             WHEN s.explicit_state = 'NONE' AND jsonb_array_length(s.cands) = 1 THEN s.cands->0->>'id' END AS ticket_id,
        CASE WHEN s.explicit_state = 'VALID' THEN 'EXPLICIT'
             WHEN s.explicit_state = 'INVALID' THEN 'EXPLICIT_INVALID'
             WHEN jsonb_array_length(s.cands) = 1 THEN 'NAME'
             WHEN jsonb_array_length(s.cands) > 1 THEN 'AMBIGUOUS' ELSE 'NONE' END AS method,
        (s.explicit_state = 'VALID' AND EXISTS (SELECT 1 FROM jsonb_array_elements(s.cands) c WHERE c->>'id' <> s.explicit_ticket)) AS contradiction
      FROM s
    ),
    tr AS (
      SELECT tk.*, (t."ticketId" IS NOT NULL) AS ticket_known, rev."organizationId" AS org_id, rev."causaRaiz" AS cause
      FROM tk
      LEFT JOIN "ZdTicket" t ON t."ticketId" = tk.ticket_id
      LEFT JOIN "ZdTicketRevision" rev ON rev.id = t."currentRevisionId"
    ),
    sc AS (
      SELECT tr.*, tcl.id AS tclient_any, tcl."isInternal" AS tclient_internal, tcl."groupId" AS tgroup_any,
        pj."clientId" AS pj_client, pj."implementationId" AS pj_impl, pg."groupId" AS pg_group, pic."clientId" AS pj_impl_client,
        pcl."groupId" AS pj_client_group,
        pa."personId" AS person_id
      FROM tr
      LEFT JOIN LATERAL (
        SELECT e."clientId" FROM "ExternalIdentity" e
        WHERE tr.org_id IS NOT NULL AND e.system = 'ZENDESK' AND e.kind = 'ORG_ID' AND e."isActive" AND e."searchValue" = tr.org_id
          AND (e."validFrom" IS NULL OR e."validFrom" <= tr.work_date) AND (e."validTo" IS NULL OR tr.work_date < e."validTo") LIMIT 1) tid ON true
      LEFT JOIN "Client" tcl ON tcl.id = tid."clientId"
      LEFT JOIN LATERAL (
        SELECT e."clientId", e."implementationId", e."groupId" FROM "ExternalIdentity" e
        WHERE tr.project IS NOT NULL AND e.system = 'WRIKE' AND e.kind IN ('PROJECT_NAME', 'PROJECT_ID') AND e."isActive"
          AND e."searchValue" IN (lower(tr.project), tr.project)
          AND (e."validFrom" IS NULL OR e."validFrom" <= tr.work_date) AND (e."validTo" IS NULL OR tr.work_date < e."validTo") LIMIT 1) pj ON true
      LEFT JOIN LATERAL (
        SELECT e."groupId" FROM "ExternalIdentity" e
        WHERE tr.project IS NOT NULL AND pj."clientId" IS NULL AND pj."implementationId" IS NULL
          AND e.system = 'BC' AND e.kind = 'GROUP_KEY' AND e."isActive" AND e."searchValue" = lower(tr.project)
          AND (e."validFrom" IS NULL OR e."validFrom" <= tr.work_date) AND (e."validTo" IS NULL OR tr.work_date < e."validTo") LIMIT 1) pg ON true
      LEFT JOIN "Implementation" pim ON pim.id = pj."implementationId"
      LEFT JOIN LATERAL (SELECT pim."clientId" AS "clientId") pic ON true
      LEFT JOIN "Client" pcl ON pcl.id = COALESCE(pj."clientId", pic."clientId")
      LEFT JOIN LATERAL (
        SELECT a."personId" FROM "PersonAlias" a
        WHERE tr.user_name IS NOT NULL AND a.system = 'WRIKE' AND a.kind IN ('ID', 'NAME') AND a."isActive"
          AND a."searchValue" IN (lower(tr.user_name), tr.user_name)
          AND (a."validFrom" IS NULL OR a."validFrom" <= tr.work_date) AND (a."validTo" IS NULL OR tr.work_date < a."validTo")
        ORDER BY (a.kind = 'ID') DESC LIMIT 1) pa ON true
    ),
    sc2 AS (
      SELECT sc.*,
        COALESCE(sc.pj_client, sc.pj_impl_client) AS p_client,
        sc.pj_impl AS p_impl,
        COALESCE(sc.pj_client_group, sc.pg_group) AS p_group,
        CASE WHEN sc.tclient_internal IS NOT TRUE THEN sc.tclient_any END AS t_client,
        CASE WHEN sc.tclient_internal IS NOT TRUE THEN sc.tgroup_any END AS t_group
      FROM sc
    ),
    cf AS (
      SELECT sc2.*,
        (   (p_client IS NOT NULL AND t_client IS NOT NULL AND p_client <> t_client)
         OR (p_client IS NULL AND p_group IS NOT NULL AND t_client IS NOT NULL AND t_group IS DISTINCT FROM p_group)) AS conflict
      FROM sc2
    ),
    ext AS (
      SELECT cf.*,
        CASE WHEN conflict THEN NULL ELSE COALESCE(p_client, t_client) END AS f_client,
        pm.flag AS pmo, tm."catalogItemId" AS team_id, lv."catalogItemId" AS level_id, rl."catalogItemId" AS role_id
      FROM cf
      LEFT JOIN LATERAL (SELECT x.flag FROM "PersonTerm" x WHERE x."personId" = cf.person_id AND x.attribute = 'PMO_MEMBER'
        AND (x."validFrom" IS NULL OR x."validFrom" <= cf.work_date) AND (x."validTo" IS NULL OR cf.work_date < x."validTo") LIMIT 1) pm ON cf.person_id IS NOT NULL
      LEFT JOIN LATERAL (SELECT x."catalogItemId" FROM "PersonTerm" x WHERE x."personId" = cf.person_id AND x.attribute = 'TEAM'
        AND (x."validFrom" IS NULL OR x."validFrom" <= cf.work_date) AND (x."validTo" IS NULL OR cf.work_date < x."validTo") LIMIT 1) tm ON cf.person_id IS NOT NULL
      LEFT JOIN LATERAL (SELECT x."catalogItemId" FROM "PersonTerm" x WHERE x."personId" = cf.person_id AND x.attribute = 'LEVEL'
        AND (x."validFrom" IS NULL OR x."validFrom" <= cf.work_date) AND (x."validTo" IS NULL OR cf.work_date < x."validTo") LIMIT 1) lv ON cf.person_id IS NOT NULL
      LEFT JOIN LATERAL (SELECT x."catalogItemId" FROM "PersonTerm" x WHERE x."personId" = cf.person_id AND x.attribute = 'PMO_ROLE'
        AND (x."validFrom" IS NULL OR x."validFrom" <= cf.work_date) AND (x."validTo" IS NULL OR cf.work_date < x."validTo") LIMIT 1) rl ON cf.person_id IS NOT NULL
    ),
    fin AS (
      SELECT ext.*,
        fc.id AS fc_id, fc."isInternal" AS f_internal,
        CASE WHEN conflict THEN NULL ELSE COALESCE(fc."groupId", p_group, t_group) END AS f_group,
        CASE WHEN conflict THEN NULL ELSE p_impl END AS f_impl,
        CASE WHEN work_date < ${PMO_CUTOFF}::date THEN 'BEFORE_CUTOFF'
             WHEN pmo IS TRUE THEN 'ELIGIBLE'
             WHEN pmo IS FALSE THEN 'NOT_PMO'
             ELSE 'PENDING_ELIGIBILITY' END AS eligibility,
        CASE WHEN method = 'AMBIGUOUS' THEN 'AMBIGUOUS' WHEN method = 'EXPLICIT_INVALID' THEN 'INVALID'
             WHEN ticket_id IS NULL THEN 'NONE' WHEN ticket_known THEN 'CONFIRMED' ELSE 'PENDING' END AS ticket_state,
        h.value AS hosting, rn.name AS role_name
      FROM ext
      LEFT JOIN "StaffCatalogItem" rn ON rn.id = ext.role_id
      LEFT JOIN "Client" fc ON fc.id = ext.f_client
      LEFT JOIN LATERAL (
        SELECT st.value FROM "ServiceTerm" st
        WHERE st.attribute = 'HOSTING' AND ext.tclient_any IS NOT NULL AND ext.ticket_known
          AND (st."clientId" = ext.tclient_any OR (ext.tgroup_any IS NOT NULL AND st."groupId" = ext.tgroup_any))
          AND (st."validFrom" IS NULL OR st."validFrom" <= ext.work_date) AND (st."validTo" IS NULL OR ext.work_date < st."validTo")
        ORDER BY (st."clientId" IS NOT NULL) DESC LIMIT 1) h ON true
    )
    SELECT key, payload, ticket_id, method AS ticket_method, ticket_state, person_id, pmo, team_id, level_id, role_id,
      f_group AS group_id, f_client AS client_id, f_impl AS impl_id,
      CASE WHEN conflict THEN 'CONFLICT'
           WHEN (p_client IS NOT NULL OR p_group IS NOT NULL) AND ticket_known AND t_client IS NOT NULL THEN 'PROJECT_TICKET'
           WHEN p_client IS NOT NULL OR p_group IS NOT NULL THEN 'PROJECT'
           WHEN t_client IS NOT NULL THEN 'TICKET' END AS scope_method,
      conflict,
      CASE WHEN NOT ticket_known OR cause IS NULL THEN 'UNCLASSIFIED'
           WHEN lower(cause) = ANY(${[...INCIDENT_APP_CAUSES]}::text[]) THEN 'INCIDENTE_VINCLE'
           WHEN lower(cause) = ${INCIDENT_INFRA_CAUSE} THEN CASE hosting WHEN 'CLOUD' THEN 'INCIDENTE_VINCLE' WHEN 'OP' THEN 'NO_INCIDENTE_VINCLE' ELSE 'PENDIENTE' END
           ELSE 'NO_INCIDENTE_VINCLE' END AS cause_class,
      eligibility,
      CASE WHEN eligibility <> 'ELIGIBLE' THEN eligibility
           WHEN conflict THEN 'SCOPE_CONFLICT'
           WHEN f_client IS NOT NULL THEN 'CLIENT'
           WHEN f_group IS NOT NULL THEN 'GROUP_ONLY'
           ELSE 'NO_SCOPE' END AS bucket,
      array_remove(ARRAY[
        CASE WHEN ticket_state = 'NONE' THEN 'NO_TICKET' END,
        CASE WHEN ticket_state = 'PENDING' THEN 'TICKET_PENDING' END,
        CASE WHEN ticket_state = 'AMBIGUOUS' THEN 'TICKET_AMBIGUOUS' END,
        CASE WHEN ticket_state = 'INVALID' THEN 'TICKET_EXPLICIT_INVALID' END,
        CASE WHEN method = 'NAME' AND ticket_id IS NOT NULL THEN 'TICKET_BY_NAME' END,
        CASE WHEN contradiction THEN 'NAME_CONTRADICTS_EXPLICIT' END,
        CASE WHEN person_id IS NULL THEN 'NO_PERSON' END,
        CASE WHEN person_id IS NOT NULL AND role_id IS NULL THEN 'NO_ROLE' END,
        CASE WHEN role_name IS NOT NULL THEN 'ROLE:' || role_name END,
        CASE WHEN project IS NULL OR (p_client IS NULL AND p_group IS NULL) THEN 'NO_PROJECT' END,
        CASE WHEN NOT ticket_known OR cause IS NULL THEN 'CAUSE_UNCLASSIFIED' END,
        CASE WHEN f_internal IS TRUE THEN 'INTERNAL' END,
        CASE WHEN f_client IS NOT NULL AND f_group IS NULL AND f_internal IS NOT TRUE THEN 'NO_GROUP' END
      ], NULL) AS flags
    FROM fin`;
}

/** Origen de claves para derivar registros ya materializados (key = id del registro). */
export const wrikeEntrySource = (where: Prisma.Sql) => Prisma.sql`
  SELECT e.id AS key, NULL::jsonb AS payload, e."projectName" AS project, e."userName" AS user_name, e."workDate" AS work_date,
    e."explicitState" AS explicit_state, e."explicitTicket" AS explicit_ticket, e."nameCandidates" AS cands
  FROM "WrikeTimeEntry" e WHERE ${where}`;

/** Filas válidas y no repetidas de un lote (key = posición); `payload` viaja hasta el resultado. */
export const wrikeStagedSource = (batchId: string, opts: { extra?: Prisma.Sql; payload?: Prisma.Sql } = {}) => Prisma.sql`
  SELECT r.position::text AS key, ${opts.payload ?? Prisma.sql`NULL::jsonb`} AS payload, r.typed->>'proyecto' AS project, r.typed->>'usuario' AS user_name,
    (r.typed->>'fecha')::date AS work_date, r.derived->>'explicitState' AS explicit_state, r.derived->>'explicitTicket' AS explicit_ticket,
    COALESCE(r.derived->'candidates', '[]'::jsonb) AS cands
  FROM "UploadStagedRow" r
  WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' AND r."duplicateInFile" = false ${opts.extra ?? Prisma.empty}`;

export async function lockDerivationWrike(tx: Tx) {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('csapp-zd-derive', 0))`);
}

/** Recalcula lo derivado de los registros indicados; solo escribe y versiona los que cambian (idempotente). */
export async function rederiveWrikeEntries(tx: Tx, where: Prisma.Sql, batchId: string | null): Promise<number> {
  await tx.$executeRaw(Prisma.sql`DROP TABLE IF EXISTS "_wr_drv"`);
  await tx.$executeRaw(Prisma.sql`CREATE TEMP TABLE "_wr_drv" ON COMMIT DROP AS ${wrikeDerivationSql(wrikeEntrySource(where))}`);
  await tx.$executeRaw(Prisma.sql`CREATE INDEX ON "_wr_drv" (key)`);
  await tx.$executeRaw(Prisma.sql`ANALYZE "_wr_drv"`);
  return tx.$executeRaw(Prisma.sql`
    UPDATE "WrikeTimeEntry" e SET
      "drvTicketId" = d.ticket_id, "drvTicketMethod" = d.ticket_method, "drvTicketState" = d.ticket_state, "drvPersonId" = d.person_id,
      "drvPmo" = d.pmo, "drvTeamId" = d.team_id, "drvLevelId" = d.level_id, "drvRoleId" = d.role_id, "drvGroupId" = d.group_id,
      "drvClientId" = d.client_id, "drvImplementationId" = d.impl_id, "drvScopeMethod" = d.scope_method, "drvConflict" = d.conflict,
      "drvCause" = d.cause_class, "drvEligibility" = d.eligibility, "drvBucket" = d.bucket, "drvFlags" = d.flags,
      "drvVersion" = e."drvVersion" + 1, "drvAt" = now(), "drvBatchId" = ${batchId}, "updatedAt" = now()
    FROM "_wr_drv" d
    WHERE e.id = d.key AND (
      e."drvTicketId", e."drvTicketMethod", e."drvTicketState", e."drvPersonId", e."drvPmo", e."drvTeamId", e."drvLevelId", e."drvRoleId",
      e."drvGroupId", e."drvClientId", e."drvImplementationId", e."drvScopeMethod", e."drvConflict", e."drvCause", e."drvEligibility",
      e."drvBucket", e."drvFlags"
    ) IS DISTINCT FROM (
      d.ticket_id, d.ticket_method, d.ticket_state, d.person_id, d.pmo, d.team_id, d.level_id, d.role_id, d.group_id, d.client_id,
      d.impl_id, d.scope_method, d.conflict, d.cause_class, d.eligibility, d.bucket, d.flags)`);
}
