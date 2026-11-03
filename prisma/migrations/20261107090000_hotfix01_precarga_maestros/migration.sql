-- CSAPP-HOTFIX-01 §8-9: decisiones del administrador sobre las revisiones de la precarga de maestros.
-- Incremental: solo añade una tabla; no modifica ninguna anterior. Sin claves foráneas a propósito (el esquema Prisma de UploadBatch y User
-- no se toca para no solapar con otras partes del hotfix): el lote nunca se borra y la integridad la comprueba el servicio al decidir.
CREATE TABLE "MasterLoadDecision" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "reviewKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "reason" TEXT NOT NULL,
    "decidedById" TEXT NOT NULL,
    "decidedByEmail" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MasterLoadDecision_pkey" PRIMARY KEY ("id")
);

-- Una decisión por revisión y lote (idempotente); la búsqueda por checksum liga la decisión al archivo, no a números de fila.
CREATE UNIQUE INDEX "MasterLoadDecision_batchId_reviewKey_key" ON "MasterLoadDecision"("batchId", "reviewKey");
CREATE INDEX "MasterLoadDecision_checksum_reviewKey_idx" ON "MasterLoadDecision"("checksum", "reviewKey");

ALTER TABLE "MasterLoadDecision" ADD CONSTRAINT "MasterLoadDecision_reason_not_blank" CHECK (btrim("reason") <> '' AND btrim("decision") <> '');
