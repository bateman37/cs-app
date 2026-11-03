-- CSAPP-HOTFIX-01 §4-5: «lo último cargado sustituye el contenido activo», instantánea activa de tiempos y PAP con identidad única.
-- Migración incremental: no edita migraciones anteriores, no borra auditoría ni brutos y conserva los datos existentes.

-- 1. Secuencia de recepción aceptada (asignada por el servidor cuando el archivo llega completo y el lote entra en cola).
CREATE SEQUENCE "UploadBatch_receptionSeq_seq";
ALTER TABLE "UploadBatch" ADD COLUMN "receptionSeq" BIGINT;
ALTER TABLE "UploadBatch" ADD COLUMN "legacyBase" BOOLEAN NOT NULL DEFAULT false;

-- Lotes anteriores al hotfix: orden por fecha de creación (única señal fiable que existe) y marca de base heredada.
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY "createdAt", id) AS rn
  FROM "UploadBatch" WHERE status NOT IN ('RECEIVING', 'REJECTED')
)
UPDATE "UploadBatch" b SET "receptionSeq" = ordered.rn FROM ordered WHERE ordered.id = b.id;
UPDATE "UploadBatch" SET "legacyBase" = true;
SELECT setval('"UploadBatch_receptionSeq_seq"', COALESCE((SELECT max("receptionSeq") FROM "UploadBatch"), 0) + 1, false);

CREATE INDEX "UploadBatch_profileId_status_receptionSeq_idx" ON "UploadBatch"("profileId", "status", "receptionSeq");

-- 2. PAP: una sola identidad por ID. El namespace técnico único es «pap»; la lista antigua queda como procedencia en los metadatos del lote.
CREATE TEMP TABLE "_pap_map" AS
SELECT it.id AS item_id, it."papId" AS pap_id,
  first_value(it.id) OVER (
    PARTITION BY it."papId"
    ORDER BY COALESCE((SELECT b."receptionSeq" FROM "PapObservation" o JOIN "UploadBatch" b ON b.id = o."batchId" WHERE o.id = it."currentObservationId"), 0) DESC, it."createdAt", it.id
  ) AS canon_id
FROM "PapItem" it;

-- 2a. Revisiones de los duplicados con el mismo contenido que una del canónico: se reasignan sus observaciones y se retiran.
CREATE TEMP TABLE "_pap_revmap" AS
SELECT dr.id AS dup_rev, cr.id AS canon_rev
FROM "_pap_map" m
JOIN "PapRevision" dr ON dr."itemId" = m.item_id
JOIN "PapRevision" cr ON cr."itemId" = m.canon_id AND cr.fingerprint = dr.fingerprint
WHERE m.item_id <> m.canon_id;

UPDATE "PapObservation" o SET "revisionId" = rm.canon_rev FROM "_pap_revmap" rm WHERE o."revisionId" = rm.dup_rev;
UPDATE "PapRevision" r SET "previousRevisionId" = rm.canon_rev FROM "_pap_revmap" rm WHERE r."previousRevisionId" = rm.dup_rev;
DELETE FROM "PapRevision" r USING "_pap_revmap" rm WHERE r.id = rm.dup_rev;

-- 2b. Resto de revisiones y observaciones de los duplicados pasan al canónico. Numeración provisional negativa (única por id) para no chocar.
UPDATE "PapRevision" r SET "itemId" = m.canon_id, "revisionNo" = -(r.id::int)
FROM "_pap_map" m WHERE r."itemId" = m.item_id AND m.item_id <> m.canon_id;
UPDATE "PapObservation" o SET "itemId" = m.canon_id FROM "_pap_map" m WHERE o."itemId" = m.item_id AND m.item_id <> m.canon_id;

-- 2c. Renumeración de las revisiones de los canónicos afectados por orden de la primera recepción que las observó.
UPDATE "PapRevision" r SET "revisionNo" = -(r.id::int)
WHERE r."revisionNo" > 0 AND r."itemId" IN (SELECT DISTINCT canon_id FROM "_pap_map" WHERE item_id <> canon_id);
WITH ranked AS (
  SELECT r.id, row_number() OVER (
      PARTITION BY r."itemId"
      ORDER BY COALESCE((SELECT min(b."receptionSeq") FROM "PapObservation" o JOIN "UploadBatch" b ON b.id = o."batchId" WHERE o."revisionId" = r.id), 0), r.id) AS rn,
    lag(r.id) OVER (
      PARTITION BY r."itemId"
      ORDER BY COALESCE((SELECT min(b."receptionSeq") FROM "PapObservation" o JOIN "UploadBatch" b ON b.id = o."batchId" WHERE o."revisionId" = r.id), 0), r.id) AS prev_id
  FROM "PapRevision" r WHERE r."itemId" IN (SELECT DISTINCT canon_id FROM "_pap_map" WHERE item_id <> canon_id)
)
UPDATE "PapRevision" r SET "revisionNo" = ranked.rn, "previousRevisionId" = ranked.prev_id FROM ranked WHERE ranked.id = r.id;

-- 2d. Retirada de los ítems duplicados (ya sin revisiones ni observaciones) y puntero vigente por orden de recepción.
DELETE FROM "PapItem" it USING "_pap_map" m WHERE it.id = m.item_id AND m.item_id <> m.canon_id;
UPDATE "PapItem" t SET "currentObservationId" = c.oid, "currentRevisionId" = c.rid, "listKey" = 'pap', "updatedAt" = now()
FROM (
  SELECT DISTINCT ON (o."itemId") o."itemId", o.id AS oid, o."revisionId" AS rid
  FROM "PapObservation" o JOIN "UploadBatch" b ON b.id = o."batchId"
  ORDER BY o."itemId", b."receptionSeq" DESC NULLS LAST, o.id DESC) c
WHERE t.id = c."itemId" AND t.id IN (SELECT canon_id FROM "_pap_map");
UPDATE "PapItem" SET "listKey" = 'pap' WHERE "listKey" <> 'pap';
-- El ámbito de deduplicación del perfil pasa al namespace único (la lista original se conserva en los metadatos).
UPDATE "UploadBatch" SET "scopeKey" = 'pap' WHERE "profileId" = 'pap' AND "scopeKey" IS DISTINCT FROM 'pap';
UPDATE "UploadRecordSource" SET "dedupeKey" = 'pap' WHERE "profileId" = 'pap' AND "dedupeKey" <> 'pap';

DROP TABLE "_pap_revmap";
DROP TABLE "_pap_map";

-- 2e. «Petición cliente» como categoría propia en las causas ya cargadas (con variantes de tildes, caja y espacios) y estado correctivo derivado.
UPDATE "PapCause" SET category = 'CLIENT_REQUEST', origin = NULL
WHERE category = 'OTHER'
  AND translate(lower(normalized), 'áéíóúü', 'aeiouu') ~ '^peticion(es)?\s+(de(l)?\s+)?cliente\y';
UPDATE "PapRevision" r SET "correctiveState" = 'NON_CORRECTIVE'
WHERE r."correctiveState" = 'UNKNOWN'
  AND EXISTS (SELECT 1 FROM "PapCause" c WHERE c."revisionId" = r.id)
  AND NOT EXISTS (SELECT 1 FROM "PapCause" c WHERE c."revisionId" = r.id AND c.category IN ('CORRECTIVE', 'OTHER'));

-- 3. Instantánea activa de tiempos. Por fuente (perfil), el lote activo es el COMPLETADO de mayor secuencia que ya sigue el contrato nuevo.
-- Sin ninguno, la base heredada (todo lo vigente anterior al hotfix) sigue siendo la actividad activa.
CREATE VIEW "ActiveTimeBatch" AS
SELECT p.profile AS "profileId",
  (SELECT b.id FROM "UploadBatch" b
   WHERE b."profileId" = p.profile AND b.status = 'COMPLETED' AND NOT b."legacyBase"
   ORDER BY b."receptionSeq" DESC NULLS LAST LIMIT 1) AS "batchId"
FROM (VALUES ('zendesk-tiempo'), ('wrike')) AS p(profile);

CREATE VIEW "ActiveZdTimeEntry" AS
SELECT e.* FROM "ZdTimeEntry" e
JOIN "ActiveTimeBatch" a ON a."profileId" = 'zendesk-tiempo'
WHERE a."batchId" IS NULL
   OR EXISTS (SELECT 1 FROM "UploadRecordSource" s WHERE s."batchId" = a."batchId" AND s.fingerprint = e."originFingerprint");

CREATE VIEW "ActiveWrikeTimeEntry" AS
SELECT e.* FROM "WrikeTimeEntry" e
JOIN "ActiveTimeBatch" a ON a."profileId" = 'wrike'
WHERE a."batchId" IS NULL
   OR EXISTS (SELECT 1 FROM "UploadRecordSource" s WHERE s."batchId" = a."batchId" AND s.fingerprint = e."originFingerprint");

-- La proyección común lee solo la actividad activa (mismas columnas, mismo orden y significado que antes).
CREATE OR REPLACE VIEW "TimeActivity" AS
  SELECT 'ZENDESK'::text AS source, e.id AS "entryId", e."workDate", e.minutes, e."ticketId" AS "ticketId",
    e."drvPersonId" AS "personId", e."drvPmo" AS pmo, e."drvEligibility" AS eligibility, (e."drvEligibility" = 'ELIGIBLE') AS "isEligible",
    e."drvGroupId" AS "groupId", e."drvClientId" AS "clientId", e."drvBucket" AS bucket,
    e."drvTeamId" AS "teamId", e."drvLevelId" AS "levelId", NULL::text AS "roleId", NULL::text AS "implementationId",
    NULL::text AS "projectName", e."drvInternal" AS "isInternal", rv.entorno AS "ticketEntorno", rv."adminDelegada" AS "ticketAdminDelegada",
    false AS "scopeConflict"
  FROM "ActiveZdTimeEntry" e
  LEFT JOIN "ZdTicket" zt ON zt."ticketId" = e."ticketId"
  LEFT JOIN "ZdTicketRevision" rv ON rv.id = zt."currentRevisionId"
  UNION ALL
  SELECT 'WRIKE'::text, w.id, w."workDate", w.minutes, w."drvTicketId",
    w."drvPersonId", w."drvPmo", w."drvEligibility", (w."drvEligibility" = 'ELIGIBLE'),
    w."drvGroupId", w."drvClientId", w."drvBucket",
    w."drvTeamId", w."drvLevelId", w."drvRoleId", w."drvImplementationId",
    w."projectName", c."isInternal", rv.entorno, rv."adminDelegada",
    w."drvConflict"
  FROM "ActiveWrikeTimeEntry" w
  LEFT JOIN "Client" c ON c.id = w."drvClientId"
  LEFT JOIN "ZdTicket" zt ON zt."ticketId" = w."drvTicketId"
  LEFT JOIN "ZdTicketRevision" rv ON rv.id = zt."currentRevisionId";
