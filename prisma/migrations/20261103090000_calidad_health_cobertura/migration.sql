-- CSAPP-08: Client Health mensual con historial, notas de revisión QA y cobertura declarada de lotes. Migración incremental: no modifica ni borra
-- ninguna tabla anterior ni la ConfigRevision de CSAPP-07 (la carga v1 de Calidad se lee mediante un adaptador, sin actualizar su JSON).

-- CreateTable
CREATE TABLE "HealthFeedback" (
    "id" BIGSERIAL NOT NULL,
    "groupId" TEXT,
    "clientId" TEXT,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "comment" TEXT,
    "feedbackOn" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "HealthFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthFeedbackEvent" (
    "id" BIGSERIAL NOT NULL,
    "feedbackId" BIGINT NOT NULL,
    "version" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "comment" TEXT,
    "feedbackOn" DATE,
    "prevState" TEXT,
    "prevComment" TEXT,
    "prevFeedbackOn" DATE,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byId" TEXT NOT NULL,

    CONSTRAINT "HealthFeedbackEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityNote" (
    "id" BIGSERIAL NOT NULL,
    "groupId" TEXT,
    "clientId" TEXT,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "topic" TEXT NOT NULL,
    "evidence" TEXT,
    "text" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadCoverageDeclaration" (
    "id" BIGSERIAL NOT NULL,
    "batchId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "population" TEXT NOT NULL,
    "statusScope" TEXT NOT NULL,
    "coveredFrom" DATE,
    "coveredTo" DATE,
    "extractedOn" DATE,
    "reason" TEXT NOT NULL,
    "declaredById" TEXT NOT NULL,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadCoverageDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HealthFeedback_year_month_idx" ON "HealthFeedback"("year", "month");

-- CreateIndex
CREATE INDEX "HealthFeedback_updatedById_idx" ON "HealthFeedback"("updatedById");

-- CreateIndex
CREATE UNIQUE INDEX "HealthFeedback_groupId_year_month_key" ON "HealthFeedback"("groupId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "HealthFeedback_clientId_year_month_key" ON "HealthFeedback"("clientId", "year", "month");

-- CreateIndex
CREATE INDEX "HealthFeedbackEvent_byId_idx" ON "HealthFeedbackEvent"("byId");

-- CreateIndex
CREATE UNIQUE INDEX "HealthFeedbackEvent_feedbackId_version_key" ON "HealthFeedbackEvent"("feedbackId", "version");

-- CreateIndex
CREATE INDEX "QualityNote_groupId_year_month_idx" ON "QualityNote"("groupId", "year", "month");

-- CreateIndex
CREATE INDEX "QualityNote_clientId_year_month_idx" ON "QualityNote"("clientId", "year", "month");

-- CreateIndex
CREATE INDEX "QualityNote_authorId_idx" ON "QualityNote"("authorId");

-- CreateIndex
CREATE INDEX "UploadCoverageDeclaration_declaredById_idx" ON "UploadCoverageDeclaration"("declaredById");

-- CreateIndex
CREATE UNIQUE INDEX "UploadCoverageDeclaration_batchId_version_key" ON "UploadCoverageDeclaration"("batchId", "version");

-- AddForeignKey
ALTER TABLE "HealthFeedback" ADD CONSTRAINT "HealthFeedback_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ClientGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthFeedback" ADD CONSTRAINT "HealthFeedback_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthFeedback" ADD CONSTRAINT "HealthFeedback_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthFeedbackEvent" ADD CONSTRAINT "HealthFeedbackEvent_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "HealthFeedback"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthFeedbackEvent" ADD CONSTRAINT "HealthFeedbackEvent_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityNote" ADD CONSTRAINT "QualityNote_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ClientGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityNote" ADD CONSTRAINT "QualityNote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityNote" ADD CONSTRAINT "QualityNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadCoverageDeclaration" ADD CONSTRAINT "UploadCoverageDeclaration_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadCoverageDeclaration" ADD CONSTRAINT "UploadCoverageDeclaration_declaredById_fkey" FOREIGN KEY ("declaredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CreateIndex (lecturas por periodo y por fotografía de observaciones)
CREATE INDEX "ZdTicketRevision_createdOn_idx" ON "ZdTicketRevision"("createdOn");
CREATE INDEX "ZdTicketObservation_observedOn_batchId_idx" ON "ZdTicketObservation"("observedOn", "batchId");

-- Integridad de Client Health: destino único (grupo O cliente, nunca ambos ni ninguno), meses y estados cerrados.
ALTER TABLE "HealthFeedback" ADD CONSTRAINT "HealthFeedback_target_check" CHECK (num_nonnulls("groupId", "clientId") = 1);
ALTER TABLE "HealthFeedback" ADD CONSTRAINT "HealthFeedback_month_check" CHECK ("month" BETWEEN 1 AND 12 AND "year" BETWEEN 2000 AND 2100);
ALTER TABLE "HealthFeedback" ADD CONSTRAINT "HealthFeedback_state_check" CHECK ("state" IN ('POSITIVE', 'NEGATIVE', 'MIXED', 'NONE'));
ALTER TABLE "HealthFeedback" ADD CONSTRAINT "HealthFeedback_none_check" CHECK ("state" <> 'NONE' OR ("comment" IS NULL AND "feedbackOn" IS NULL));
ALTER TABLE "HealthFeedbackEvent" ADD CONSTRAINT "HealthFeedbackEvent_action_check" CHECK ("action" IN ('CREATE', 'UPDATE', 'CLEAR'));
ALTER TABLE "QualityNote" ADD CONSTRAINT "QualityNote_target_check" CHECK (num_nonnulls("groupId", "clientId") = 1);
ALTER TABLE "QualityNote" ADD CONSTRAINT "QualityNote_month_check" CHECK ("month" BETWEEN 1 AND 12);

-- Cobertura declarada: valores cerrados y alcance temporal ordenado.
ALTER TABLE "UploadCoverageDeclaration" ADD CONSTRAINT "UploadCoverageDeclaration_population_check" CHECK ("population" IN ('ALL_CLIENTS', 'PARTIAL', 'UNKNOWN'));
ALTER TABLE "UploadCoverageDeclaration" ADD CONSTRAINT "UploadCoverageDeclaration_status_check" CHECK ("statusScope" IN ('ALL_STATUSES', 'UNRESOLVED_ONLY', 'NOT_APPLICABLE', 'UNKNOWN'));
ALTER TABLE "UploadCoverageDeclaration" ADD CONSTRAINT "UploadCoverageDeclaration_range_check" CHECK ("coveredFrom" IS NULL OR "coveredTo" IS NULL OR "coveredFrom" <= "coveredTo");
ALTER TABLE "UploadCoverageDeclaration" ADD CONSTRAINT "UploadCoverageDeclaration_version_check" CHECK ("version" >= 1);

-- Historial y declaraciones son de solo añadir: ni UPDATE ni DELETE.
CREATE OR REPLACE FUNCTION csapp_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Este historial es de solo añadir (no se modifica ni se borra).' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "HealthFeedbackEvent_append_only" BEFORE UPDATE OR DELETE ON "HealthFeedbackEvent" FOR EACH ROW EXECUTE FUNCTION csapp_append_only();
CREATE TRIGGER "UploadCoverageDeclaration_append_only" BEFORE UPDATE OR DELETE ON "UploadCoverageDeclaration" FOR EACH ROW EXECUTE FUNCTION csapp_append_only();
CREATE TRIGGER "QualityNote_append_only" BEFORE UPDATE OR DELETE ON "QualityNote" FOR EACH ROW EXECUTE FUNCTION csapp_append_only();
