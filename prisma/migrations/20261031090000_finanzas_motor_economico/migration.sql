-- CSAPP-05: equivalencias Wrike/PAP a Grupo Cliente, finanzas anuales, configuración económica, asignaciones de servicio
-- y proyección de tiempos ampliada. Migración incremental: no modifica las anteriores ni borra datos.

-- Equivalencias: Wrike y PAP pueden identificar directamente un Grupo Cliente (solo con proyecto). Zendesk ORG_ID sigue siendo de Cliente.
-- La exclusión de solapamientos ("ExternalIdentity_no_overlap") es por sistema+tipo+valor, sea cual sea el destino, y ya existía.
ALTER TABLE "ExternalIdentity" DROP CONSTRAINT "ExternalIdentity_system_kind_target";
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_system_kind_target" CHECK (
  ("system" = 'BC' AND "kind" = 'GROUP_KEY' AND "groupId" IS NOT NULL)
  OR ("system" = 'ZENDESK' AND "kind" IN ('ORG_ID', 'ORG_NAME') AND "clientId" IS NOT NULL)
  OR ("system" IN ('WRIKE', 'PAP') AND "kind" IN ('PROJECT_ID', 'PROJECT_NAME'))
  OR ("system" IN ('WRIKE', 'PAP') AND "kind" IN ('ORG_ID', 'ORG_NAME') AND "groupId" IS NULL)
);

CREATE TABLE "FinanceBatch" (
    "batchId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'UPLOAD',
    "extractionDate" DATE,
    "controls" JSONB NOT NULL DEFAULT '{}',
    "controlIncome" DECIMAL(38,20),
    "controlDiff" DECIMAL(38,20),
    "tolerance" DECIMAL(18,6) NOT NULL,
    "settingsRevisionId" BIGINT,
    "reviewedScopeVersion" INTEGER,
    "reviewedActiveBatchId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewSnapshot" JSONB,
    "derivedStamp" TEXT,
    "derivedVersion" INTEGER NOT NULL DEFAULT 1,
    "derivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceBatch_pkey" PRIMARY KEY ("batchId")
);

-- CreateTable
CREATE TABLE "FinanceRow" (
    "id" BIGSERIAL NOT NULL,
    "batchId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "groupLabel" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "incomeOriginal" TEXT,
    "income" DECIMAL(38,20),
    "incomeDerivedZero" BOOLEAN NOT NULL DEFAULT false,
    "differenceOriginal" TEXT,
    "difference" DECIMAL(38,20),
    "groupId" TEXT,
    "resolution" TEXT NOT NULL DEFAULT 'UNRESOLVED',
    "resolutionDetail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceScope" (
    "year" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "activeBatchId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceScope_pkey" PRIMARY KEY ("year","category")
);

-- CreateTable
CREATE TABLE "FinanceDecision" (
    "id" BIGSERIAL NOT NULL,
    "batchId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT '',
    "value" JSONB,
    "reason" TEXT,
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EconomicSettingsRevision" (
    "id" BIGSERIAL NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "targetEurosPerDay" DECIMAL(18,6) NOT NULL,
    "dayHours" DECIMAL(10,4) NOT NULL,
    "reconciliationTolerance" DECIMAL(18,6) NOT NULL,
    "reason" TEXT,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedById" TEXT,

    CONSTRAINT "EconomicSettingsRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceAssignment" (
    "id" TEXT NOT NULL,
    "matchKind" TEXT NOT NULL,
    "matchValue" TEXT NOT NULL,
    "searchValue" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "validFrom" DATE,
    "validTo" DATE,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceBatch_year_category_idx" ON "FinanceBatch"("year", "category");

-- CreateIndex
CREATE INDEX "FinanceRow_batchId_groupId_idx" ON "FinanceRow"("batchId", "groupId");

-- CreateIndex
CREATE INDEX "FinanceRow_batchId_sourceKey_idx" ON "FinanceRow"("batchId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceRow_batchId_fingerprint_key" ON "FinanceRow"("batchId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceDecision_batchId_kind_key_key" ON "FinanceDecision"("batchId", "kind", "key");

-- CreateIndex
CREATE UNIQUE INDEX "EconomicSettingsRevision_revisionNo_key" ON "EconomicSettingsRevision"("revisionNo");

-- CreateIndex
CREATE INDEX "ServiceAssignment_matchKind_searchValue_idx" ON "ServiceAssignment"("matchKind", "searchValue");

-- AddForeignKey
ALTER TABLE "FinanceBatch" ADD CONSTRAINT "FinanceBatch_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceRow" ADD CONSTRAINT "FinanceRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "FinanceBatch"("batchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceDecision" ADD CONSTRAINT "FinanceDecision_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceDecision" ADD CONSTRAINT "FinanceDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EconomicSettingsRevision" ADD CONSTRAINT "EconomicSettingsRevision_activatedById_fkey" FOREIGN KEY ("activatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integridad de las tablas financieras y de configuración.
ALTER TABLE "FinanceBatch" ADD CONSTRAINT "FinanceBatch_category_check" CHECK ("category" IN ('SOPORTE', 'ADMIN_DELEGADA', 'OTROS'));
ALTER TABLE "FinanceBatch" ADD CONSTRAINT "FinanceBatch_origin_check" CHECK ("origin" IN ('UPLOAD', 'HISTORICAL'));
ALTER TABLE "FinanceBatch" ADD CONSTRAINT "FinanceBatch_year_check" CHECK ("year" BETWEEN 2000 AND 2100);
ALTER TABLE "FinanceBatch" ADD CONSTRAINT "FinanceBatch_tolerance_check" CHECK ("tolerance" >= 0);
ALTER TABLE "FinanceScope" ADD CONSTRAINT "FinanceScope_category_check" CHECK ("category" IN ('SOPORTE', 'ADMIN_DELEGADA', 'OTROS'));
ALTER TABLE "FinanceRow" ADD CONSTRAINT "FinanceRow_resolution_check" CHECK ("resolution" IN ('RESOLVED', 'UNRESOLVED', 'AMBIGUOUS', 'DECISION'));
ALTER TABLE "FinanceRow" ADD CONSTRAINT "FinanceRow_derived_zero_check" CHECK (NOT "incomeDerivedZero" OR ("income" = 0 AND "incomeOriginal" IS NULL));
ALTER TABLE "FinanceRow" ADD CONSTRAINT "FinanceRow_income_known_check" CHECK ("income" IS NOT NULL);
ALTER TABLE "EconomicSettingsRevision" ADD CONSTRAINT "EconomicSettingsRevision_values_check"
  CHECK ("targetEurosPerDay" > 0 AND "dayHours" > 0 AND "reconciliationTolerance" >= 0);
ALTER TABLE "ServiceAssignment" ADD CONSTRAINT "ServiceAssignment_kind_check" CHECK ("matchKind" IN ('ENTORNO', 'WRIKE_PROJECT'));
ALTER TABLE "ServiceAssignment" ADD CONSTRAINT "ServiceAssignment_service_check" CHECK ("service" IN ('SOPORTE', 'ADMIN_DELEGADA', 'OTROS'));
ALTER TABLE "ServiceAssignment" ADD CONSTRAINT "ServiceAssignment_valid_range" CHECK ("validFrom" IS NULL OR "validTo" IS NULL OR "validFrom" < "validTo");
ALTER TABLE "ServiceAssignment" ADD CONSTRAINT "ServiceAssignment_values_not_blank" CHECK (btrim("matchValue") <> '' AND btrim("searchValue") <> '');
-- Un mismo valor no puede tener dos servicios activos con vigencias solapadas (también ante concurrencia).
ALTER TABLE "ServiceAssignment" ADD CONSTRAINT "ServiceAssignment_no_overlap" EXCLUDE USING gist (
  "matchKind" WITH =, "searchValue" WITH =, daterange("validFrom", "validTo", '[)') WITH &&
) WHERE ("isActive");

-- Configuración económica inicial (revisión 1). Objetivo y jornada son valores de negocio confirmados; la tolerancia es técnica/propuesta (CAL 08).
INSERT INTO "EconomicSettingsRevision" ("revisionNo", "targetEurosPerDay", "dayHours", "reconciliationTolerance", "reason", "activatedById")
VALUES (1, 550, 8, 0.01, 'Configuración inicial: objetivo 550 €/jornada y jornada de 8 h confirmados; tolerancia de conciliación 0,01 € técnica y propuesta.', NULL);

-- Proyección común de dedicación ampliada con los datos de servicio, equipo, rol e implantación que necesita el motor económico.
-- Las columnas anteriores conservan nombre, orden y significado; las nuevas se añaden al final. Una actividad sigue siendo (source, entryId).
CREATE OR REPLACE VIEW "TimeActivity" AS
  SELECT 'ZENDESK'::text AS source, e.id AS "entryId", e."workDate", e.minutes, e."ticketId" AS "ticketId",
    e."drvPersonId" AS "personId", e."drvPmo" AS pmo, e."drvEligibility" AS eligibility, (e."drvEligibility" = 'ELIGIBLE') AS "isEligible",
    e."drvGroupId" AS "groupId", e."drvClientId" AS "clientId", e."drvBucket" AS bucket,
    e."drvTeamId" AS "teamId", e."drvLevelId" AS "levelId", NULL::text AS "roleId", NULL::text AS "implementationId",
    NULL::text AS "projectName", e."drvInternal" AS "isInternal", rv.entorno AS "ticketEntorno", rv."adminDelegada" AS "ticketAdminDelegada",
    false AS "scopeConflict"
  FROM "ZdTimeEntry" e
  LEFT JOIN "ZdTicket" zt ON zt."ticketId" = e."ticketId"
  LEFT JOIN "ZdTicketRevision" rv ON rv.id = zt."currentRevisionId"
  UNION ALL
  SELECT 'WRIKE'::text, w.id, w."workDate", w.minutes, w."drvTicketId",
    w."drvPersonId", w."drvPmo", w."drvEligibility", (w."drvEligibility" = 'ELIGIBLE'),
    w."drvGroupId", w."drvClientId", w."drvBucket",
    w."drvTeamId", w."drvLevelId", w."drvRoleId", w."drvImplementationId",
    w."projectName", c."isInternal", rv.entorno, rv."adminDelegada",
    w."drvConflict"
  FROM "WrikeTimeEntry" w
  LEFT JOIN "Client" c ON c.id = w."drvClientId"
  LEFT JOIN "ZdTicket" zt ON zt."ticketId" = w."drvTicketId"
  LEFT JOIN "ZdTicketRevision" rv ON rv.id = zt."currentRevisionId";
