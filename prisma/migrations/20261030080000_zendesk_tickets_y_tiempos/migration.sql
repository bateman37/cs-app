-- CSAPP-03: Zendesk tickets (entidad, revisiones, observaciones) y tiempos (registros, correcciones, decisiones).
-- Incremental sobre 20261029220244_personal_usuarios_cargas: sin borrado ni reset de datos existentes.
-- AlterEnum
ALTER TYPE "UploadJobKind" ADD VALUE 'REDERIVE';

-- CreateTable
CREATE TABLE "ZdTicket" (
    "ticketId" TEXT NOT NULL,
    "firstBatchId" TEXT NOT NULL,
    "currentRevisionId" BIGINT,
    "currentObservationId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZdTicket_pkey" PRIMARY KEY ("ticketId")
);

-- CreateTable
CREATE TABLE "ZdTicketRevision" (
    "id" BIGSERIAL NOT NULL,
    "ticketId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "organizationId" TEXT,
    "entorno" TEXT,
    "causaRaiz" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "destinations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdOn" DATE NOT NULL,
    "createdTime" TEXT,
    "ticketType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "typeKnown" BOOLEAN NOT NULL,
    "statusKnown" BOOLEAN NOT NULL,
    "adminDelegada" BOOLEAN,
    "previousRevisionId" BIGINT,
    "changedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "batchId" TEXT NOT NULL,
    "createdAtDb" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZdTicketRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZdTicketObservation" (
    "id" BIGSERIAL NOT NULL,
    "ticketId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "revisionId" BIGINT NOT NULL,
    "observedOn" DATE NOT NULL,
    "observedKind" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZdTicketObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZdTimeEntry" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "originFingerprint" TEXT NOT NULL,
    "firstBatchId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "workDate" DATE NOT NULL,
    "hourText" TEXT,
    "loggedHours" DECIMAL(65,30) NOT NULL,
    "loggedMinutes" DECIMAL(65,30) NOT NULL,
    "minutes" DECIMAL(65,30) NOT NULL,
    "dayLabel" TEXT,
    "segmenter" TEXT,
    "sourceId" TEXT,
    "channel" TEXT,
    "fingerprint" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "drvTicketKnown" BOOLEAN NOT NULL DEFAULT false,
    "drvOrganizationId" TEXT,
    "drvClientId" TEXT,
    "drvGroupId" TEXT,
    "drvInternal" BOOLEAN,
    "drvPersonId" TEXT,
    "drvPersonVia" TEXT,
    "drvPmo" BOOLEAN,
    "drvTeamId" TEXT,
    "drvLevelId" TEXT,
    "drvEligibility" TEXT NOT NULL DEFAULT 'PENDING_ELIGIBILITY',
    "drvBucket" TEXT NOT NULL DEFAULT 'NO_TICKET',
    "drvFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "drvVersion" INTEGER NOT NULL DEFAULT 1,
    "drvAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "drvBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZdTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZdTimeCorrection" (
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

    CONSTRAINT "ZdTimeCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZdTimeDecision" (
    "id" BIGSERIAL NOT NULL,
    "batchId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "targetEntryId" TEXT,
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZdTimeDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ZdTicket_firstBatchId_idx" ON "ZdTicket"("firstBatchId");

-- CreateIndex
CREATE INDEX "ZdTicketRevision_batchId_idx" ON "ZdTicketRevision"("batchId");

-- CreateIndex
CREATE INDEX "ZdTicketRevision_organizationId_idx" ON "ZdTicketRevision"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ZdTicketRevision_ticketId_fingerprint_key" ON "ZdTicketRevision"("ticketId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "ZdTicketRevision_ticketId_revisionNo_key" ON "ZdTicketRevision"("ticketId", "revisionNo");

-- CreateIndex
CREATE INDEX "ZdTicketObservation_ticketId_observedOn_idx" ON "ZdTicketObservation"("ticketId", "observedOn");

-- CreateIndex
CREATE INDEX "ZdTicketObservation_revisionId_idx" ON "ZdTicketObservation"("revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "ZdTicketObservation_batchId_ticketId_key" ON "ZdTicketObservation"("batchId", "ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "ZdTimeEntry_originFingerprint_key" ON "ZdTimeEntry"("originFingerprint");

-- CreateIndex
CREATE INDEX "ZdTimeEntry_ticketId_idx" ON "ZdTimeEntry"("ticketId");

-- CreateIndex
CREATE INDEX "ZdTimeEntry_workDate_idx" ON "ZdTimeEntry"("workDate");

-- CreateIndex
CREATE INDEX "ZdTimeEntry_drvPersonId_idx" ON "ZdTimeEntry"("drvPersonId");

-- CreateIndex
CREATE INDEX "ZdTimeEntry_drvClientId_idx" ON "ZdTimeEntry"("drvClientId");

-- CreateIndex
CREATE INDEX "ZdTimeEntry_drvBucket_idx" ON "ZdTimeEntry"("drvBucket");

-- CreateIndex
CREATE INDEX "ZdTimeEntry_sourceId_ticketId_idx" ON "ZdTimeEntry"("sourceId", "ticketId");

-- CreateIndex
CREATE INDEX "ZdTimeEntry_firstBatchId_idx" ON "ZdTimeEntry"("firstBatchId");

-- CreateIndex
CREATE INDEX "ZdTimeCorrection_entryId_idx" ON "ZdTimeCorrection"("entryId");

-- CreateIndex
CREATE INDEX "ZdTimeCorrection_batchId_idx" ON "ZdTimeCorrection"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "ZdTimeDecision_batchId_fingerprint_key" ON "ZdTimeDecision"("batchId", "fingerprint");

-- AddForeignKey
ALTER TABLE "ZdTicket" ADD CONSTRAINT "ZdTicket_firstBatchId_fkey" FOREIGN KEY ("firstBatchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZdTicketRevision" ADD CONSTRAINT "ZdTicketRevision_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ZdTicket"("ticketId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZdTicketRevision" ADD CONSTRAINT "ZdTicketRevision_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZdTicketObservation" ADD CONSTRAINT "ZdTicketObservation_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ZdTicket"("ticketId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZdTicketObservation" ADD CONSTRAINT "ZdTicketObservation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZdTicketObservation" ADD CONSTRAINT "ZdTicketObservation_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ZdTicketRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZdTimeEntry" ADD CONSTRAINT "ZdTimeEntry_firstBatchId_fkey" FOREIGN KEY ("firstBatchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZdTimeCorrection" ADD CONSTRAINT "ZdTimeCorrection_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "ZdTimeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZdTimeCorrection" ADD CONSTRAINT "ZdTimeCorrection_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZdTimeCorrection" ADD CONSTRAINT "ZdTimeCorrection_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZdTimeDecision" ADD CONSTRAINT "ZdTimeDecision_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZdTimeDecision" ADD CONSTRAINT "ZdTimeDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Restricciones que Prisma no expresa.
ALTER TABLE "ZdTicket" ADD CONSTRAINT "ZdTicket_id_digits" CHECK ("ticketId" ~ '^[0-9]+$');
ALTER TABLE "ZdTicketRevision" ADD CONSTRAINT "ZdTicketRevision_no_positive" CHECK ("revisionNo" >= 1);
ALTER TABLE "ZdTicketRevision" ADD CONSTRAINT "ZdTicketRevision_org_digits_or_text" CHECK ("organizationId" IS NULL OR btrim("organizationId") <> '');
ALTER TABLE "ZdTicketObservation" ADD CONSTRAINT "ZdTicketObservation_kind" CHECK ("observedKind" IN ('DECLARED', 'RECEIVED'));
ALTER TABLE "ZdTimeEntry" ADD CONSTRAINT "ZdTimeEntry_ticket_digits" CHECK ("ticketId" ~ '^[0-9]+$');
ALTER TABLE "ZdTimeEntry" ADD CONSTRAINT "ZdTimeEntry_duration_non_negative" CHECK ("loggedHours" >= 0 AND "loggedMinutes" >= 0 AND "minutes" >= 0);
ALTER TABLE "ZdTimeEntry" ADD CONSTRAINT "ZdTimeEntry_eligibility" CHECK ("drvEligibility" IN ('ELIGIBLE', 'EXCLUDED_PMO', 'PENDING_ELIGIBILITY'));
ALTER TABLE "ZdTimeEntry" ADD CONSTRAINT "ZdTimeEntry_bucket" CHECK ("drvBucket" IN (
  'EXCLUDED_PMO', 'PENDING_ELIGIBILITY', 'NO_TICKET', 'NO_ORGANIZATION', 'NO_CLIENT', 'NO_PERSON', 'ATTRIBUTABLE'));
ALTER TABLE "ZdTimeEntry" ADD CONSTRAINT "ZdTimeEntry_person_via" CHECK ("drvPersonVia" IS NULL OR "drvPersonVia" IN ('ID', 'NAME'));
ALTER TABLE "ZdTimeDecision" ADD CONSTRAINT "ZdTimeDecision_decision" CHECK (
  ("decision" = 'CORRECTION' AND "targetEntryId" IS NOT NULL) OR ("decision" = 'DIFFERENT' AND "targetEntryId" IS NULL));
-- Los tramos de agregación habituales (por persona, cliente, fecha) usan estos índices parciales de los registros atribuibles.
CREATE INDEX "ZdTimeEntry_attributable_client_date_idx" ON "ZdTimeEntry" ("drvClientId", "workDate") WHERE "drvBucket" = 'ATTRIBUTABLE';
