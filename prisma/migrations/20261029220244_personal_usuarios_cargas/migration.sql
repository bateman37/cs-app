-- CreateEnum
CREATE TYPE "PersonSystem" AS ENUM ('PAP', 'ZENDESK', 'WRIKE');

-- CreateEnum
CREATE TYPE "PersonAliasKind" AS ENUM ('NAME', 'ID', 'EMAIL');

-- CreateEnum
CREATE TYPE "PersonAttribute" AS ENUM ('LEVEL', 'TEAM', 'PMO_MEMBER', 'PMO_ROLE');

-- CreateEnum
CREATE TYPE "StaffCatalogKind" AS ENUM ('LEVEL', 'TEAM', 'PMO_ROLE');

-- CreateEnum
CREATE TYPE "UserValueKind" AS ENUM ('INITIAL', 'COPIED', 'PROPAGATED', 'ADJUSTED');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('RECEIVING', 'QUEUED', 'PREPARING', 'READY', 'ACTIVATION_QUEUED', 'ACTIVATING', 'COMPLETED', 'REJECTED', 'FAILED', 'CANCELLED', 'REVERTED');

-- CreateEnum
CREATE TYPE "UploadJobKind" AS ENUM ('PREPARE', 'ACTIVATE', 'REVERT');

-- CreateEnum
CREATE TYPE "UploadJobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StagedClass" AS ENUM ('VALID', 'ERROR', 'EXCLUDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'INITIALIZE';
ALTER TYPE "AuditAction" ADD VALUE 'UPLOAD';
ALTER TYPE "AuditAction" ADD VALUE 'CONFIRM';
ALTER TYPE "AuditAction" ADD VALUE 'CANCEL';
ALTER TYPE "AuditAction" ADD VALUE 'ACTIVATE';
ALTER TYPE "AuditAction" ADD VALUE 'REVERT';
ALTER TYPE "AuditAction" ADD VALUE 'REPROCESS';

-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "personId" TEXT;

-- CreateTable
CREATE TABLE "StaffCatalogItem" (
    "id" TEXT NOT NULL,
    "kind" "StaffCatalogKind" NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonAlias" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "system" "PersonSystem" NOT NULL,
    "kind" "PersonAliasKind" NOT NULL,
    "rawValue" TEXT NOT NULL,
    "searchValue" TEXT NOT NULL,
    "validFrom" DATE,
    "validTo" DATE,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonTerm" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "attribute" "PersonAttribute" NOT NULL,
    "catalogItemId" TEXT,
    "flag" BOOLEAN,
    "validFrom" DATE,
    "validTo" DATE,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMatrix" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "clientId" TEXT,
    "implementationId" TEXT,
    "year" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMatrix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMatrixMonth" (
    "matrixId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,
    "kind" "UserValueKind" NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMatrixMonth_pkey" PRIMARY KEY ("matrixId","month")
);

-- CreateTable
CREATE TABLE "UploadBatch" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "profileVersion" INTEGER NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'RECEIVING',
    "statusDetail" TEXT,
    "originalName" TEXT NOT NULL,
    "storageId" TEXT NOT NULL,
    "fileFormat" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "checksum" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "scopeKey" TEXT,
    "declaredExtractionDate" DATE,
    "declaredFrom" DATE,
    "declaredTo" DATE,
    "coverageNote" TEXT,
    "phase" TEXT,
    "rowsProcessed" INTEGER NOT NULL DEFAULT 0,
    "checkpointPosition" INTEGER NOT NULL DEFAULT 0,
    "rowsReceived" INTEGER NOT NULL DEFAULT 0,
    "rowsValid" INTEGER NOT NULL DEFAULT 0,
    "rowsError" INTEGER NOT NULL DEFAULT 0,
    "rowsReviewed" INTEGER NOT NULL DEFAULT 0,
    "rowsDuplicate" INTEGER NOT NULL DEFAULT 0,
    "rowsExcluded" INTEGER NOT NULL DEFAULT 0,
    "rowsWarning" INTEGER NOT NULL DEFAULT 0,
    "rowsImported" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "rulesSnapshot" TEXT,
    "supersedesBatchId" TEXT,
    "supersededByBatchId" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "confirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "preparedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "UploadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadJob" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "kind" "UploadJobKind" NOT NULL,
    "status" "UploadJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "fence" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "UploadJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadStagedRow" (
    "id" BIGSERIAL NOT NULL,
    "batchId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "sheet" TEXT,
    "sourceRow" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "typed" JSONB,
    "fingerprint" TEXT,
    "entityKey" TEXT,
    "classification" "StagedClass" NOT NULL,
    "issues" JSONB,
    "hasWarning" BOOLEAN NOT NULL DEFAULT false,
    "duplicateInFile" BOOLEAN NOT NULL DEFAULT false,
    "disposition" TEXT,

    CONSTRAINT "UploadStagedRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadRecordSource" (
    "id" BIGSERIAL NOT NULL,
    "batchId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL DEFAULT '',
    "fingerprint" TEXT NOT NULL,
    "entityKey" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstPosition" INTEGER NOT NULL,

    CONSTRAINT "UploadRecordSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonAlias_personId_idx" ON "PersonAlias"("personId");

-- CreateIndex
CREATE INDEX "PersonAlias_system_kind_searchValue_idx" ON "PersonAlias"("system", "kind", "searchValue");

-- CreateIndex
CREATE INDEX "PersonTerm_personId_attribute_idx" ON "PersonTerm"("personId", "attribute");

-- CreateIndex
CREATE INDEX "PersonTerm_catalogItemId_idx" ON "PersonTerm"("catalogItemId");

-- CreateIndex
CREATE INDEX "UserMatrix_groupId_idx" ON "UserMatrix"("groupId");

-- CreateIndex
CREATE INDEX "UserMatrix_clientId_idx" ON "UserMatrix"("clientId");

-- CreateIndex
CREATE INDEX "UserMatrix_implementationId_idx" ON "UserMatrix"("implementationId");

-- CreateIndex
CREATE INDEX "UserMatrixMonth_updatedById_idx" ON "UserMatrixMonth"("updatedById");

-- CreateIndex
CREATE UNIQUE INDEX "UploadBatch_storageId_key" ON "UploadBatch"("storageId");

-- CreateIndex
CREATE INDEX "UploadBatch_createdAt_idx" ON "UploadBatch"("createdAt");

-- CreateIndex
CREATE INDEX "UploadBatch_profileId_status_idx" ON "UploadBatch"("profileId", "status");

-- CreateIndex
CREATE INDEX "UploadBatch_profileId_scopeKey_idx" ON "UploadBatch"("profileId", "scopeKey");

-- CreateIndex
CREATE INDEX "UploadBatch_checksum_idx" ON "UploadBatch"("checksum");

-- CreateIndex
CREATE INDEX "UploadJob_status_runAfter_idx" ON "UploadJob"("status", "runAfter");

-- CreateIndex
CREATE INDEX "UploadJob_batchId_idx" ON "UploadJob"("batchId");

-- CreateIndex
CREATE INDEX "UploadStagedRow_batchId_classification_idx" ON "UploadStagedRow"("batchId", "classification");

-- CreateIndex
CREATE INDEX "UploadStagedRow_batchId_fingerprint_idx" ON "UploadStagedRow"("batchId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "UploadStagedRow_batchId_position_key" ON "UploadStagedRow"("batchId", "position");

-- CreateIndex
CREATE INDEX "UploadRecordSource_profileId_dedupeKey_fingerprint_idx" ON "UploadRecordSource"("profileId", "dedupeKey", "fingerprint");

-- CreateIndex
CREATE INDEX "UploadRecordSource_profileId_dedupeKey_entityKey_idx" ON "UploadRecordSource"("profileId", "dedupeKey", "entityKey");

-- CreateIndex
CREATE UNIQUE INDEX "UploadRecordSource_batchId_fingerprint_key" ON "UploadRecordSource"("batchId", "fingerprint");

-- CreateIndex
CREATE INDEX "AuditEvent_personId_at_idx" ON "AuditEvent"("personId", "at");

-- CreateIndex
CREATE INDEX "AuditEvent_batchId_at_idx" ON "AuditEvent"("batchId", "at");

-- AddForeignKey
ALTER TABLE "PersonAlias" ADD CONSTRAINT "PersonAlias_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonTerm" ADD CONSTRAINT "PersonTerm_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonTerm" ADD CONSTRAINT "PersonTerm_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "StaffCatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMatrix" ADD CONSTRAINT "UserMatrix_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ClientGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMatrix" ADD CONSTRAINT "UserMatrix_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMatrix" ADD CONSTRAINT "UserMatrix_implementationId_fkey" FOREIGN KEY ("implementationId") REFERENCES "Implementation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMatrixMonth" ADD CONSTRAINT "UserMatrixMonth_matrixId_fkey" FOREIGN KEY ("matrixId") REFERENCES "UserMatrix"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMatrixMonth" ADD CONSTRAINT "UserMatrixMonth_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadBatch" ADD CONSTRAINT "UploadBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadJob" ADD CONSTRAINT "UploadJob_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadJob" ADD CONSTRAINT "UploadJob_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadStagedRow" ADD CONSTRAINT "UploadStagedRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadRecordSource" ADD CONSTRAINT "UploadRecordSource_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Integridad que Prisma no expresa (CSAPP-02). Convención de vigencias: [validFrom, validTo).
-- btree_gist ya lo crea la migración inicial.
-- ---------------------------------------------------------------------------

-- ---- Personal
CREATE UNIQUE INDEX "Person_name_ci_key" ON "Person" (lower("name"));
ALTER TABLE "Person" ADD CONSTRAINT "Person_name_not_blank" CHECK (btrim("name") <> '');
CREATE UNIQUE INDEX "StaffCatalogItem_kind_name_ci_key" ON "StaffCatalogItem" ("kind", lower("name"));
ALTER TABLE "StaffCatalogItem" ADD CONSTRAINT "StaffCatalogItem_name_not_blank" CHECK (btrim("name") <> '');

ALTER TABLE "PersonAlias" ADD CONSTRAINT "PersonAlias_system_kind" CHECK (
  ("system" = 'PAP' AND "kind" IN ('NAME', 'ID', 'EMAIL'))
  OR ("system" IN ('ZENDESK', 'WRIKE') AND "kind" IN ('NAME', 'ID'))
);
ALTER TABLE "PersonAlias" ADD CONSTRAINT "PersonAlias_valid_range"
  CHECK ("validFrom" IS NULL OR "validTo" IS NULL OR "validFrom" < "validTo");
ALTER TABLE "PersonAlias" ADD CONSTRAINT "PersonAlias_values_not_blank"
  CHECK (btrim("rawValue") <> '' AND btrim("searchValue") <> '');
-- Un mismo alias/ID/correo de un sistema no puede pertenecer a dos personas (ni repetirse)
-- en vigencias solapadas, tampoco ante operaciones concurrentes.
ALTER TABLE "PersonAlias" ADD CONSTRAINT "PersonAlias_no_overlap" EXCLUDE USING gist (
  "system" WITH =, "kind" WITH =, "searchValue" WITH =,
  daterange("validFrom", "validTo", '[)') WITH &&
) WHERE ("isActive");

ALTER TABLE "PersonTerm" ADD CONSTRAINT "PersonTerm_valid_range"
  CHECK ("validFrom" IS NULL OR "validTo" IS NULL OR "validFrom" < "validTo");
ALTER TABLE "PersonTerm" ADD CONSTRAINT "PersonTerm_value_shape" CHECK (
  ("attribute" = 'PMO_MEMBER' AND "flag" IS NOT NULL AND "catalogItemId" IS NULL)
  OR ("attribute" <> 'PMO_MEMBER' AND "flag" IS NULL AND "catalogItemId" IS NOT NULL)
);
ALTER TABLE "PersonTerm" ADD CONSTRAINT "PersonTerm_no_overlap" EXCLUDE USING gist (
  "personId" WITH =, "attribute" WITH =,
  daterange("validFrom", "validTo", '[)') WITH &&
);

-- Roles PMO iniciales conocidos (MST 05). Nivel y equipo no se siembran: no hay fuente.
INSERT INTO "StaffCatalogItem" ("id", "kind", "name", "updatedAt") VALUES
  ('seed-pmo-role-ana', 'PMO_ROLE', 'ANA', CURRENT_TIMESTAMP),
  ('seed-pmo-role-dev', 'PMO_ROLE', 'DEV', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- ---- Usuarios contratados
ALTER TABLE "UserMatrix" ADD CONSTRAINT "UserMatrix_one_scope"
  CHECK (num_nonnulls("groupId", "clientId", "implementationId") = 1);
ALTER TABLE "UserMatrix" ADD CONSTRAINT "UserMatrix_year_range" CHECK ("year" BETWEEN 2000 AND 2100);
-- Clave única por ámbito, entidad y año (el mes es la clave de UserMatrixMonth).
CREATE UNIQUE INDEX "UserMatrix_group_year_key" ON "UserMatrix" ("groupId", "year") WHERE "groupId" IS NOT NULL;
CREATE UNIQUE INDEX "UserMatrix_client_year_key" ON "UserMatrix" ("clientId", "year") WHERE "clientId" IS NOT NULL;
CREATE UNIQUE INDEX "UserMatrix_implementation_year_key" ON "UserMatrix" ("implementationId", "year") WHERE "implementationId" IS NOT NULL;
ALTER TABLE "UserMatrixMonth" ADD CONSTRAINT "UserMatrixMonth_month_range" CHECK ("month" BETWEEN 1 AND 12);
ALTER TABLE "UserMatrixMonth" ADD CONSTRAINT "UserMatrixMonth_value_non_negative" CHECK ("value" >= 0);
ALTER TABLE "UserMatrixMonth" ADD CONSTRAINT "UserMatrixMonth_source_not_blank" CHECK (btrim("source") <> '');

-- ---- Cargas
ALTER TABLE "UploadBatch" ADD CONSTRAINT "UploadBatch_size_non_negative" CHECK ("sizeBytes" >= 0);
ALTER TABLE "UploadBatch" ADD CONSTRAINT "UploadBatch_counters_non_negative" CHECK (
  "rowsProcessed" >= 0 AND "rowsReceived" >= 0 AND "rowsValid" >= 0 AND "rowsError" >= 0 AND "rowsReviewed" >= 0
  AND "rowsDuplicate" >= 0 AND "rowsExcluded" >= 0 AND "rowsWarning" >= 0 AND "rowsImported" >= 0
);
ALTER TABLE "UploadBatch" ADD CONSTRAINT "UploadBatch_declared_range"
  CHECK ("declaredFrom" IS NULL OR "declaredTo" IS NULL OR "declaredFrom" <= "declaredTo");
-- Un lote solo sustituye a otro y es sustituido por uno.
CREATE UNIQUE INDEX "UploadBatch_supersedes_key" ON "UploadBatch" ("supersedesBatchId") WHERE "supersedesBatchId" IS NOT NULL;
CREATE UNIQUE INDEX "UploadBatch_superseded_by_key" ON "UploadBatch" ("supersededByBatchId") WHERE "supersededByBatchId" IS NOT NULL;
-- Solo un trabajo pendiente o en curso por lote y tipo: encolar dos veces no duplica el efecto.
CREATE UNIQUE INDEX "UploadJob_open_per_batch_kind_key" ON "UploadJob" ("batchId", "kind") WHERE "status" IN ('PENDING', 'RUNNING');
ALTER TABLE "UploadJob" ADD CONSTRAINT "UploadJob_attempts_range" CHECK ("attempts" >= 0 AND "maxAttempts" >= 1);
