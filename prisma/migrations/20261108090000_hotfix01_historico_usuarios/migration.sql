-- HOTFIX-01 §6-§7: histórico económico y usuarios. Incremental: no edita migraciones previas ni borra datos.

-- Valor estimado a partir de la base 2025 (años históricos). Solo se añade el valor; no se usa en esta misma migración.
ALTER TYPE "UserValueKind" ADD VALUE IF NOT EXISTS 'ESTIMATED';

CREATE TABLE "HistoricGroupOrigin" (
    "groupId" TEXT NOT NULL,
    "sourceBatchId" TEXT NOT NULL,
    "originalLabel" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoricGroupOrigin_pkey" PRIMARY KEY ("groupId")
);

CREATE TABLE "HistoricUserBase" (
    "groupId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "sourceCell" TEXT NOT NULL,
    "fromFormula" BOOLEAN NOT NULL DEFAULT false,
    "batchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoricUserBase_pkey" PRIMARY KEY ("groupId","year","category"),
    CONSTRAINT "HistoricUserBase_value_check" CHECK ("value" >= 0)
);

CREATE TABLE "HistoricUserResolution" (
    "groupId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "category" TEXT,
    "value" INTEGER NOT NULL,
    "reason" TEXT,
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoricUserResolution_pkey" PRIMARY KEY ("groupId","year"),
    CONSTRAINT "HistoricUserResolution_value_check" CHECK ("value" >= 0)
);

CREATE INDEX "HistoricGroupOrigin_sourceBatchId_idx" ON "HistoricGroupOrigin"("sourceBatchId");
CREATE INDEX "HistoricUserBase_batchId_idx" ON "HistoricUserBase"("batchId");

-- Política de edición ordinaria «año actual y año anterior» (Europe/Madrid, decidida en servidor): el bloqueo permanente por fila de la
-- carga inicial 2025 deja de existir. Solo se limpia la marca; valor, tipo (INITIAL/COPIED/ADJUSTED), procedencia, revisión e historial
-- de auditoría se conservan intactos. Desde ahora la ventana de años, no la fila, decide qué es editable.
UPDATE "UserMatrixMonth" SET "isLocked" = false WHERE "isLocked";
