-- CSAPP-04: Wrike, PAP y bugs de producto VFS/VSW. Migración incremental sobre CSAPP-03: no borra ni reinicia datos.
-- AlterTable
ALTER TABLE "UploadStagedRow" ADD COLUMN     "derived" JSONB;

-- AlterTable
ALTER TABLE "ZdTimeDecision" ADD COLUMN     "targetRevision" INTEGER;

-- CreateTable
CREATE TABLE "WrikeTimeEntry" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "originFingerprint" TEXT NOT NULL,
    "firstBatchId" TEXT NOT NULL,
    "userName" TEXT,
    "projectName" TEXT,
    "taskName" TEXT NOT NULL,
    "ticketFieldRaw" TEXT,
    "explicitState" TEXT NOT NULL,
    "explicitTicket" TEXT,
    "nameCandidates" JSONB NOT NULL DEFAULT '[]',
    "workDate" DATE NOT NULL,
    "hours" DECIMAL(65,30) NOT NULL,
    "minutes" DECIMAL(65,30) NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "drvTicketId" TEXT,
    "drvTicketMethod" TEXT NOT NULL DEFAULT 'NONE',
    "drvTicketState" TEXT NOT NULL DEFAULT 'NONE',
    "drvPersonId" TEXT,
    "drvPmo" BOOLEAN,
    "drvTeamId" TEXT,
    "drvLevelId" TEXT,
    "drvRoleId" TEXT,
    "drvGroupId" TEXT,
    "drvClientId" TEXT,
    "drvImplementationId" TEXT,
    "drvScopeMethod" TEXT,
    "drvConflict" BOOLEAN NOT NULL DEFAULT false,
    "drvCause" TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
    "drvEligibility" TEXT NOT NULL DEFAULT 'PENDING_ELIGIBILITY',
    "drvBucket" TEXT NOT NULL DEFAULT 'PENDING_ELIGIBILITY',
    "drvFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "drvVersion" INTEGER NOT NULL DEFAULT 1,
    "drvAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "drvBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WrikeTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WrikeTimeCorrection" (
    "id" BIGSERIAL NOT NULL,
    "entryId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "previousFingerprint" TEXT NOT NULL,
    "previous" JSONB NOT NULL,
    "minutesBefore" DECIMAL(65,30) NOT NULL,
    "minutesAfter" DECIMAL(65,30) NOT NULL,
    "reverted" BOOLEAN NOT NULL DEFAULT false,
    "decidedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WrikeTimeCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WrikeTimeDecision" (
    "id" BIGSERIAL NOT NULL,
    "batchId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "targetEntryId" TEXT,
    "targetRevision" INTEGER,
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WrikeTimeDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PapItem" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "listKey" TEXT NOT NULL,
    "papId" TEXT NOT NULL,
    "firstBatchId" TEXT NOT NULL,
    "currentRevisionId" BIGINT,
    "currentObservationId" BIGINT,
    "drvScope" TEXT NOT NULL DEFAULT 'UNMAPPED',
    "drvGroupId" TEXT,
    "drvClientId" TEXT,
    "drvImplementationId" TEXT,
    "drvVersion" INTEGER NOT NULL DEFAULT 1,
    "drvAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PapItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PapRevision" (
    "id" BIGSERIAL NOT NULL,
    "itemId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "project" TEXT,
    "result" TEXT,
    "requestDate" DATE,
    "productionDate" DATE,
    "correctiveState" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "previousRevisionId" BIGINT,
    "changedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "batchId" TEXT NOT NULL,
    "createdAtDb" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PapRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PapObservation" (
    "id" BIGSERIAL NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "revisionId" BIGINT NOT NULL,
    "observedOn" DATE NOT NULL,
    "observedKind" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PapObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PapCause" (
    "id" BIGSERIAL NOT NULL,
    "revisionId" BIGINT NOT NULL,
    "rawToken" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "origin" TEXT,

    CONSTRAINT "PapCause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PapReference" (
    "id" BIGSERIAL NOT NULL,
    "revisionId" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "refKey" TEXT NOT NULL,
    "refId" TEXT,
    "product" TEXT,
    "rawText" TEXT NOT NULL,
    "reason" TEXT,

    CONSTRAINT "PapReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItem" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "product" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "firstBatchId" TEXT NOT NULL,
    "currentRevisionId" BIGINT,
    "currentObservationId" BIGINT,
    "lastObservedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItemRevision" (
    "id" BIGSERIAL NOT NULL,
    "workItemId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "itemType" TEXT NOT NULL,
    "isBug" BOOLEAN NOT NULL,
    "title" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "stateCategory" TEXT NOT NULL,
    "stateKnown" BOOLEAN NOT NULL,
    "assignedTo" TEXT,
    "createdBy" TEXT,
    "createdLocal" TEXT,
    "createdDate" DATE,
    "changedLocal" TEXT,
    "areaPath" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "commentCount" INTEGER,
    "reportedBy" TEXT,
    "clientsRaw" TEXT,
    "zendeskTicketRaw" TEXT,
    "previousRevisionId" BIGINT,
    "changedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "batchId" TEXT NOT NULL,
    "createdAtDb" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkItemRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItemObservation" (
    "id" BIGSERIAL NOT NULL,
    "workItemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "revisionId" BIGINT NOT NULL,
    "observedOn" DATE NOT NULL,
    "observedKind" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkItemObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItemLink" (
    "id" BIGSERIAL NOT NULL,
    "workItemId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "manualState" TEXT,
    "manualById" TEXT,
    "manualAt" TIMESTAMP(3),
    "manualNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "drvState" TEXT NOT NULL DEFAULT 'PENDING_TICKET',
    "drvTicketType" TEXT,
    "drvClientId" TEXT,
    "drvGroupId" TEXT,
    "drvInternal" BOOLEAN,
    "drvAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkItemLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItemLinkEvidence" (
    "id" BIGSERIAL NOT NULL,
    "linkId" BIGINT NOT NULL,
    "batchId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "rawRef" TEXT NOT NULL,
    "observedOn" DATE NOT NULL,

    CONSTRAINT "WorkItemLinkEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WrikeTimeEntry_originFingerprint_key" ON "WrikeTimeEntry"("originFingerprint");

-- CreateIndex
CREATE INDEX "WrikeTimeEntry_workDate_idx" ON "WrikeTimeEntry"("workDate");

-- CreateIndex
CREATE INDEX "WrikeTimeEntry_drvPersonId_idx" ON "WrikeTimeEntry"("drvPersonId");

-- CreateIndex
CREATE INDEX "WrikeTimeEntry_drvClientId_idx" ON "WrikeTimeEntry"("drvClientId");

-- CreateIndex
CREATE INDEX "WrikeTimeEntry_drvBucket_idx" ON "WrikeTimeEntry"("drvBucket");

-- CreateIndex
CREATE INDEX "WrikeTimeEntry_drvTicketId_idx" ON "WrikeTimeEntry"("drvTicketId");

-- CreateIndex
CREATE INDEX "WrikeTimeEntry_firstBatchId_idx" ON "WrikeTimeEntry"("firstBatchId");

-- CreateIndex
CREATE INDEX "WrikeTimeCorrection_entryId_idx" ON "WrikeTimeCorrection"("entryId");

-- CreateIndex
CREATE INDEX "WrikeTimeCorrection_batchId_idx" ON "WrikeTimeCorrection"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "WrikeTimeDecision_batchId_fingerprint_key" ON "WrikeTimeDecision"("batchId", "fingerprint");

-- CreateIndex
CREATE INDEX "PapItem_firstBatchId_idx" ON "PapItem"("firstBatchId");

-- CreateIndex
CREATE INDEX "PapItem_drvClientId_idx" ON "PapItem"("drvClientId");

-- CreateIndex
CREATE INDEX "PapItem_drvGroupId_idx" ON "PapItem"("drvGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "PapItem_listKey_papId_key" ON "PapItem"("listKey", "papId");

-- CreateIndex
CREATE INDEX "PapRevision_batchId_idx" ON "PapRevision"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "PapRevision_itemId_fingerprint_key" ON "PapRevision"("itemId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "PapRevision_itemId_revisionNo_key" ON "PapRevision"("itemId", "revisionNo");

-- CreateIndex
CREATE INDEX "PapObservation_itemId_observedOn_idx" ON "PapObservation"("itemId", "observedOn");

-- CreateIndex
CREATE INDEX "PapObservation_revisionId_idx" ON "PapObservation"("revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "PapObservation_batchId_itemId_key" ON "PapObservation"("batchId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "PapCause_revisionId_normalized_key" ON "PapCause"("revisionId", "normalized");

-- CreateIndex
CREATE INDEX "PapReference_kind_refId_idx" ON "PapReference"("kind", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "PapReference_revisionId_kind_refKey_key" ON "PapReference"("revisionId", "kind", "refKey");

-- CreateIndex
CREATE INDEX "WorkItem_product_workItemId_idx" ON "WorkItem"("product", "workItemId");

-- CreateIndex
CREATE INDEX "WorkItem_firstBatchId_idx" ON "WorkItem"("firstBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItem_product_scopeKey_workItemId_key" ON "WorkItem"("product", "scopeKey", "workItemId");

-- CreateIndex
CREATE INDEX "WorkItemRevision_batchId_idx" ON "WorkItemRevision"("batchId");

-- CreateIndex
CREATE INDEX "WorkItemRevision_isBug_stateCategory_idx" ON "WorkItemRevision"("isBug", "stateCategory");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItemRevision_workItemId_fingerprint_key" ON "WorkItemRevision"("workItemId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItemRevision_workItemId_revisionNo_key" ON "WorkItemRevision"("workItemId", "revisionNo");

-- CreateIndex
CREATE INDEX "WorkItemObservation_workItemId_observedOn_idx" ON "WorkItemObservation"("workItemId", "observedOn");

-- CreateIndex
CREATE INDEX "WorkItemObservation_revisionId_idx" ON "WorkItemObservation"("revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItemObservation_batchId_workItemId_key" ON "WorkItemObservation"("batchId", "workItemId");

-- CreateIndex
CREATE INDEX "WorkItemLink_ticketId_idx" ON "WorkItemLink"("ticketId");

-- CreateIndex
CREATE INDEX "WorkItemLink_drvState_idx" ON "WorkItemLink"("drvState");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItemLink_workItemId_ticketId_key" ON "WorkItemLink"("workItemId", "ticketId");

-- CreateIndex
CREATE INDEX "WorkItemLinkEvidence_batchId_idx" ON "WorkItemLinkEvidence"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItemLinkEvidence_linkId_batchId_source_key" ON "WorkItemLinkEvidence"("linkId", "batchId", "source");

-- AddForeignKey
ALTER TABLE "WrikeTimeEntry" ADD CONSTRAINT "WrikeTimeEntry_firstBatchId_fkey" FOREIGN KEY ("firstBatchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WrikeTimeCorrection" ADD CONSTRAINT "WrikeTimeCorrection_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "WrikeTimeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WrikeTimeCorrection" ADD CONSTRAINT "WrikeTimeCorrection_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WrikeTimeCorrection" ADD CONSTRAINT "WrikeTimeCorrection_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WrikeTimeDecision" ADD CONSTRAINT "WrikeTimeDecision_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WrikeTimeDecision" ADD CONSTRAINT "WrikeTimeDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PapItem" ADD CONSTRAINT "PapItem_firstBatchId_fkey" FOREIGN KEY ("firstBatchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PapRevision" ADD CONSTRAINT "PapRevision_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PapItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PapRevision" ADD CONSTRAINT "PapRevision_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PapObservation" ADD CONSTRAINT "PapObservation_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PapItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PapObservation" ADD CONSTRAINT "PapObservation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PapObservation" ADD CONSTRAINT "PapObservation_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "PapRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PapCause" ADD CONSTRAINT "PapCause_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "PapRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PapReference" ADD CONSTRAINT "PapReference_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "PapRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_firstBatchId_fkey" FOREIGN KEY ("firstBatchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemRevision" ADD CONSTRAINT "WorkItemRevision_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemRevision" ADD CONSTRAINT "WorkItemRevision_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemObservation" ADD CONSTRAINT "WorkItemObservation_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemObservation" ADD CONSTRAINT "WorkItemObservation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemObservation" ADD CONSTRAINT "WorkItemObservation_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "WorkItemRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemLink" ADD CONSTRAINT "WorkItemLink_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemLink" ADD CONSTRAINT "WorkItemLink_manualById_fkey" FOREIGN KEY ("manualById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemLinkEvidence" ADD CONSTRAINT "WorkItemLinkEvidence_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "WorkItemLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemLinkEvidence" ADD CONSTRAINT "WorkItemLinkEvidence_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Restricciones que Prisma no expresa.
ALTER TABLE "WrikeTimeEntry" ADD CONSTRAINT "WrikeTimeEntry_duration_non_negative" CHECK ("hours" >= 0 AND "minutes" >= 0);
ALTER TABLE "WrikeTimeEntry" ADD CONSTRAINT "WrikeTimeEntry_minutes_exact" CHECK ("minutes" = "hours" * 60);
ALTER TABLE "WrikeTimeEntry" ADD CONSTRAINT "WrikeTimeEntry_explicit_state" CHECK ("explicitState" IN ('NONE', 'VALID', 'INVALID'));
ALTER TABLE "WrikeTimeEntry" ADD CONSTRAINT "WrikeTimeEntry_eligibility" CHECK ("drvEligibility" IN ('ELIGIBLE', 'BEFORE_CUTOFF', 'NOT_PMO', 'PENDING_ELIGIBILITY'));
ALTER TABLE "WrikeTimeEntry" ADD CONSTRAINT "WrikeTimeEntry_bucket" CHECK ("drvBucket" IN (
  'BEFORE_CUTOFF', 'NOT_PMO', 'PENDING_ELIGIBILITY', 'SCOPE_CONFLICT', 'NO_SCOPE', 'GROUP_ONLY', 'CLIENT'));
ALTER TABLE "WrikeTimeEntry" ADD CONSTRAINT "WrikeTimeEntry_ticket_state" CHECK ("drvTicketState" IN ('CONFIRMED', 'PENDING', 'AMBIGUOUS', 'INVALID', 'NONE'));
ALTER TABLE "WrikeTimeEntry" ADD CONSTRAINT "WrikeTimeEntry_ticket_digits" CHECK ("drvTicketId" IS NULL OR "drvTicketId" ~ '^[0-9]+$');
ALTER TABLE "WrikeTimeDecision" ADD CONSTRAINT "WrikeTimeDecision_decision" CHECK (
  ("decision" = 'CORRECTION' AND "targetEntryId" IS NOT NULL) OR ("decision" = 'DIFFERENT' AND "targetEntryId" IS NULL));
ALTER TABLE "PapItem" ADD CONSTRAINT "PapItem_id_digits" CHECK ("papId" ~ '^[0-9]+$');
ALTER TABLE "PapItem" ADD CONSTRAINT "PapItem_scope" CHECK ("drvScope" IN ('CLIENT', 'IMPLEMENTATION', 'GROUP_ONLY', 'NO_PROJECT', 'UNMAPPED'));
ALTER TABLE "PapRevision" ADD CONSTRAINT "PapRevision_corrective" CHECK ("correctiveState" IN ('CORRECTIVE', 'NON_CORRECTIVE', 'UNKNOWN'));
ALTER TABLE "PapObservation" ADD CONSTRAINT "PapObservation_kind" CHECK ("observedKind" IN ('DECLARED', 'RECEIVED'));
ALTER TABLE "PapReference" ADD CONSTRAINT "PapReference_kind" CHECK ("kind" IN ('TICKET_ASSOCIATED', 'TICKET_PAP', 'BUG', 'CAL', 'TEXT'));
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_product" CHECK ("product" IN ('VFS', 'VSW'));
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_id_digits" CHECK ("workItemId" ~ '^[0-9]+$');
ALTER TABLE "WorkItemObservation" ADD CONSTRAINT "WorkItemObservation_kind" CHECK ("observedKind" IN ('DECLARED', 'RECEIVED'));
ALTER TABLE "WorkItemLink" ADD CONSTRAINT "WorkItemLink_manual" CHECK ("manualState" IS NULL OR "manualState" IN ('CONFIRMED', 'REJECTED'));
ALTER TABLE "WorkItemLink" ADD CONSTRAINT "WorkItemLink_ticket_digits" CHECK ("ticketId" ~ '^[0-9]+$');
ALTER TABLE "WorkItemLinkEvidence" ADD CONSTRAINT "WorkItemLinkEvidence_source" CHECK ("source" IN ('ZENDESK_TICKET_ID', 'CLIENTS_URL'));

-- Una corrección sustituye un registro concreto: dos filas de un mismo lote no pueden corregir el mismo registro.
CREATE UNIQUE INDEX "ZdTimeDecision_one_target_per_batch" ON "ZdTimeDecision" ("batchId", "targetEntryId") WHERE "decision" = 'CORRECTION';
CREATE UNIQUE INDEX "WrikeTimeDecision_one_target_per_batch" ON "WrikeTimeDecision" ("batchId", "targetEntryId") WHERE "decision" = 'CORRECTION';
CREATE INDEX "WrikeTimeEntry_attributable_client_date_idx" ON "WrikeTimeEntry" ("drvClientId", "workDate") WHERE "drvBucket" = 'CLIENT';

-- Representación común de dedicación con origen inequívoco, minutos decimales y elegibilidad histórica. No fusiona las tablas
-- ni sobrecarga ZdTimeEntry.sourceId (que sigue siendo el ID externo del log de Zendesk). Una suma de minutos elegibles aplica
-- la política única: antes de 2025 solo Zendesk; desde 2025, PMO solo Wrike y no PMO solo Zendesk.
CREATE VIEW "TimeActivity" AS
  SELECT 'ZENDESK'::text AS source, e.id AS "entryId", e."workDate", e.minutes, e."ticketId" AS "ticketId",
    e."drvPersonId" AS "personId", e."drvPmo" AS pmo, e."drvEligibility" AS eligibility, (e."drvEligibility" = 'ELIGIBLE') AS "isEligible",
    e."drvGroupId" AS "groupId", e."drvClientId" AS "clientId", e."drvBucket" AS bucket
  FROM "ZdTimeEntry" e
  UNION ALL
  SELECT 'WRIKE'::text, w.id, w."workDate", w.minutes, w."drvTicketId",
    w."drvPersonId", w."drvPmo", w."drvEligibility", (w."drvEligibility" = 'ELIGIBLE'),
    w."drvGroupId", w."drvClientId", w."drvBucket"
  FROM "WrikeTimeEntry" w;
