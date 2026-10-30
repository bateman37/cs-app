import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/server/uploads/profile";

type Tx = Prisma.TransactionClient;

/**
 * Resolución BC de un grupo de origen a un Grupo Cliente (FAC 08, CSAPP-05 §6): por las equivalencias BC/GROUP_KEY del maestro y la
 * normalización existente (sin similitud textual ni primer resultado). El dato es anual: no se elige enero, diciembre ni la fecha de
 * subida; se consideran TODAS las asignaciones activas cuya vigencia intersecta el año.
 *  - un único grupo en todas ellas → RESOLVED (con los intervalos que lo sustentan);
 *  - grupos distintos → AMBIGUOUS, salvo asignación anual explícita del lote (decisión YEAR_ASSIGNMENT, entre los candidatos) → DECISION;
 *  - ninguna → UNRESOLVED.
 *
 * Devuelve los fragmentos de CTE `u`, `cand`, `ck`, `dc` y `res` para anteponer con WITH. `u` produce (ref text, key text).
 * `res` añade group_id, resolution, detail (intervalos) y n_groups.
 */
export function resolutionCtes(u: Prisma.Sql, batchId: string, year: number): Prisma.Sql {
  const from = `${year}-01-01`;
  const to = `${year + 1}-01-01`;
  return Prisma.sql`
    u AS (${u}),
    cand AS (
      SELECT k.key, e.id AS identity_id, e."groupId", e."validFrom", e."validTo"
      FROM (SELECT DISTINCT key FROM u) k
      JOIN "ExternalIdentity" e ON e.system = 'BC' AND e.kind = 'GROUP_KEY' AND e."isActive" AND e."searchValue" = k.key
        AND (e."validFrom" IS NULL OR e."validFrom" < ${to}::date) AND (e."validTo" IS NULL OR e."validTo" > ${from}::date)),
    ck AS (
      SELECT key, count(DISTINCT "groupId") AS n, min("groupId") AS g1,
        jsonb_agg(jsonb_build_object('identityId', identity_id, 'groupId', "groupId", 'from', "validFrom", 'to', "validTo") ORDER BY identity_id) AS detail
      FROM cand GROUP BY key),
    dc AS (SELECT key, value->>'groupId' AS gid FROM "FinanceDecision" WHERE "batchId" = ${batchId} AND kind = 'YEAR_ASSIGNMENT'),
    res AS (
      SELECT u.*,
        CASE WHEN ck.n = 1 THEN ck.g1
             WHEN ck.n > 1 AND EXISTS (SELECT 1 FROM cand c WHERE c.key = u.key AND c."groupId" = dc.gid) THEN dc.gid END AS group_id,
        CASE WHEN ck.n = 1 THEN 'RESOLVED'
             WHEN ck.n > 1 AND EXISTS (SELECT 1 FROM cand c WHERE c.key = u.key AND c."groupId" = dc.gid) THEN 'DECISION'
             WHEN ck.n > 1 THEN 'AMBIGUOUS' ELSE 'UNRESOLVED' END AS resolution,
        jsonb_build_object('year', ${year}::int, 'yearFrom', ${from}::text, 'yearTo', ${to}::text, 'identities', COALESCE(ck.detail, '[]'::jsonb)) AS detail,
        COALESCE(ck.n, 0)::int AS n_groups
      FROM u LEFT JOIN ck ON ck.key = u.key LEFT JOIN dc ON dc.key = u.key)`;
}

/** Huella de los maestros BC con los que se deriva la atribución; si cambia, el recálculo está pendiente. */
export async function financeMasterStamp(db: Db | Tx): Promise<string> {
  const r = await db.$queryRaw<{ stamp: string }[]>(Prisma.sql`
    SELECT md5(COALESCE(string_agg(concat_ws('|', e.id, e.version, e."groupId", e."searchValue", e."validFrom", e."validTo", e."isActive"), ';' ORDER BY e.id), '')) AS stamp
    FROM "ExternalIdentity" e WHERE e.system = 'BC' AND e.kind = 'GROUP_KEY'`);
  return r[0]?.stamp ?? "";
}
