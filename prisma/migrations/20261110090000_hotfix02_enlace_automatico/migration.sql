-- CSAPP-HOTFIX-02 (datos): enlace automático de lo ya cargado con los maestros.
-- Incremental: no edita migraciones previas y NO recalcula filas. Prepara el esquema y deja PROGRAMADA una reparación (RelationRefresh) que ejecuta el
-- trabajador de forma recuperable (ver docs/arquitectura/hotfix02-enlace-automatico.md).

-- 1. Normalización única de nombres (gemela de `normalizeName`/`nameKey` en src/domain/normalize.ts): Unicode NFC, espacios (incluidos los no
--    separables y otros Unicode) recortados y colapsados, sin distinguir caja. No elimina acentos, puntuación ni palabras.
CREATE OR REPLACE FUNCTION csapp_norm_name(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(btrim(regexp_replace(normalize(t, NFC), '[\s   -     　﻿]+', ' ', 'g'), ' '))
$$;

-- 2. Estado de la actualización de relaciones y alias con varios Grupos candidatos.
CREATE TABLE "RelationRefresh" (
    "scope" TEXT NOT NULL,
    "requestedGeneration" BIGINT NOT NULL DEFAULT 0,
    "completedGeneration" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "reason" TEXT,
    "requestedAt" TIMESTAMP(3),
    "requestedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "fence" INTEGER NOT NULL DEFAULT 0,
    "progress" JSONB,
    "lastError" TEXT,
    "lastReport" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelationRefresh_pkey" PRIMARY KEY ("scope")
);
ALTER TABLE "RelationRefresh" ADD CONSTRAINT "RelationRefresh_status" CHECK ("status" IN ('IDLE', 'PENDING', 'RUNNING', 'FAILED'));
ALTER TABLE "RelationRefresh" ADD CONSTRAINT "RelationRefresh_generations" CHECK ("completedGeneration" >= 0 AND "requestedGeneration" >= 0);

CREATE TABLE "AliasCandidate" (
    "id" TEXT NOT NULL,
    "system" "ExternalSystem" NOT NULL,
    "kind" "IdentityKind" NOT NULL,
    "rawValue" TEXT NOT NULL,
    "searchValue" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "batchId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AliasCandidate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AliasCandidate_system_kind_searchValue_groupId_key" ON "AliasCandidate"("system", "kind", "searchValue", "groupId");
CREATE INDEX "AliasCandidate_system_kind_searchValue_idx" ON "AliasCandidate"("system", "kind", "searchValue");

-- 3. Procedencia del ámbito de un PAP (equivalencia directa o alias de varios Grupos resuelto por el ticket vinculado).
ALTER TABLE "PapItem" ADD COLUMN "drvVia" TEXT;
-- Un nombre PAP con varios Grupos candidatos que ningún ticket resuelve queda AMBIGUOUS (sin asignar); antes se confundía con «sin equivalencia».
ALTER TABLE "PapItem" DROP CONSTRAINT "PapItem_scope";
ALTER TABLE "PapItem" ADD CONSTRAINT "PapItem_scope" CHECK ("drvScope" IN ('CLIENT', 'IMPLEMENTATION', 'GROUP_ONLY', 'NO_PROJECT', 'UNMAPPED', 'AMBIGUOUS'));
ALTER TABLE "PapItem" ADD CONSTRAINT "PapItem_via" CHECK ("drvVia" IS NULL OR "drvVia" IN ('IDENTITY', 'TICKET_ALIAS'));

-- 4. Cualquier cambio de maestros solicita una generación nueva. Disparador por sentencia (una fila de estado; no se bloquea la operación del maestro).
CREATE OR REPLACE FUNCTION csapp_request_relation_refresh() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "RelationRefresh" ("scope", "requestedGeneration", "status", "reason", "requestedAt", "updatedAt")
  VALUES ('global', 1, 'PENDING', TG_TABLE_NAME, now(), now())
  ON CONFLICT ("scope") DO UPDATE SET
    "requestedGeneration" = "RelationRefresh"."requestedGeneration" + 1,
    "status" = CASE WHEN "RelationRefresh"."status" = 'RUNNING' THEN 'RUNNING' ELSE 'PENDING' END,
    "attempts" = CASE WHEN "RelationRefresh"."status" = 'FAILED' THEN 0 ELSE "RelationRefresh"."attempts" END,
    "runAfter" = CASE WHEN "RelationRefresh"."status" = 'RUNNING' THEN "RelationRefresh"."runAfter" ELSE now() END,
    "reason" = TG_TABLE_NAME,
    "requestedAt" = now(),
    "updatedAt" = now();
  RETURN NULL;
END
$$;

CREATE TRIGGER "relation_refresh_ClientGroup" AFTER INSERT OR UPDATE OR DELETE ON "ClientGroup" FOR EACH STATEMENT EXECUTE FUNCTION csapp_request_relation_refresh();
CREATE TRIGGER "relation_refresh_Client" AFTER INSERT OR UPDATE OR DELETE ON "Client" FOR EACH STATEMENT EXECUTE FUNCTION csapp_request_relation_refresh();
CREATE TRIGGER "relation_refresh_Implementation" AFTER INSERT OR UPDATE OR DELETE ON "Implementation" FOR EACH STATEMENT EXECUTE FUNCTION csapp_request_relation_refresh();
CREATE TRIGGER "relation_refresh_ExternalIdentity" AFTER INSERT OR UPDATE OR DELETE ON "ExternalIdentity" FOR EACH STATEMENT EXECUTE FUNCTION csapp_request_relation_refresh();
CREATE TRIGGER "relation_refresh_ServiceTerm" AFTER INSERT OR UPDATE OR DELETE ON "ServiceTerm" FOR EACH STATEMENT EXECUTE FUNCTION csapp_request_relation_refresh();
CREATE TRIGGER "relation_refresh_Person" AFTER INSERT OR UPDATE OR DELETE ON "Person" FOR EACH STATEMENT EXECUTE FUNCTION csapp_request_relation_refresh();
CREATE TRIGGER "relation_refresh_PersonAlias" AFTER INSERT OR UPDATE OR DELETE ON "PersonAlias" FOR EACH STATEMENT EXECUTE FUNCTION csapp_request_relation_refresh();
CREATE TRIGGER "relation_refresh_PersonTerm" AFTER INSERT OR UPDATE OR DELETE ON "PersonTerm" FOR EACH STATEMENT EXECUTE FUNCTION csapp_request_relation_refresh();
CREATE TRIGGER "relation_refresh_StaffCatalogItem" AFTER INSERT OR UPDATE OR DELETE ON "StaffCatalogItem" FOR EACH STATEMENT EXECUTE FUNCTION csapp_request_relation_refresh();
CREATE TRIGGER "relation_refresh_AliasCandidate" AFTER INSERT OR UPDATE OR DELETE ON "AliasCandidate" FOR EACH STATEMENT EXECUTE FUNCTION csapp_request_relation_refresh();

-- 5. Claves de comparación de nombres ya guardadas con la normalización única. Solo cambian las que difieren (NFC); una colisión con otra
--    equivalencia/alias vigente del mismo valor se omite (la fila conserva su clave anterior y el administrador la verá en el diagnóstico).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, csapp_norm_name("rawValue") AS nv FROM "ExternalIdentity" WHERE kind NOT IN ('ORG_ID', 'PROJECT_ID') AND "searchValue" <> csapp_norm_name("rawValue") LOOP
    BEGIN
      UPDATE "ExternalIdentity" SET "searchValue" = r.nv WHERE id = r.id;
    EXCEPTION WHEN exclusion_violation OR unique_violation THEN
      RAISE NOTICE 'ExternalIdentity % conserva su clave anterior (colisión)', r.id;
    END;
  END LOOP;
  FOR r IN SELECT id, csapp_norm_name("rawValue") AS nv FROM "PersonAlias" WHERE kind <> 'ID' AND "searchValue" <> csapp_norm_name("rawValue") LOOP
    BEGIN
      UPDATE "PersonAlias" SET "searchValue" = r.nv WHERE id = r.id;
    EXCEPTION WHEN exclusion_violation OR unique_violation THEN
      RAISE NOTICE 'PersonAlias % conserva su clave anterior (colisión)', r.id;
    END;
  END LOOP;
  UPDATE "ServiceAssignment" SET "searchValue" = csapp_norm_name("matchValue") WHERE "searchValue" <> csapp_norm_name("matchValue");
END
$$;

-- 6. Reparación programada de la instalación existente: si ya hay cargas completadas, se deja pendiente (generación 1) para que el trabajador
--    recalcule todos los derivados con los maestros actuales, sin releer originales ni pedir otra subida. En una instalación vacía no hace falta:
--    la primera alta de maestros crea la fila. Los cambios de la sección 5 de arriba han podido solicitarla ya (disparadores).
INSERT INTO "RelationRefresh" ("scope", "requestedGeneration", "completedGeneration", "status", "reason", "requestedAt", "updatedAt")
SELECT 'global', 1, 0, 'PENDING', 'MIGRACION_HOTFIX02', now(), now()
WHERE EXISTS (SELECT 1 FROM "UploadBatch" WHERE status = 'COMPLETED')
ON CONFLICT ("scope") DO UPDATE SET
  "requestedGeneration" = GREATEST("RelationRefresh"."requestedGeneration", 1),
  "status" = 'PENDING',
  "reason" = 'MIGRACION_HOTFIX02',
  "requestedAt" = now();
