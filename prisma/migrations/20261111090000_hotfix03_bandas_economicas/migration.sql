-- CSAPP-HOTFIX-03: bandas económicas configurables (factores del objetivo). Incremental; NULL conserva las revisiones anteriores con las bandas iniciales.
ALTER TABLE "EconomicSettingsRevision" ADD COLUMN "bandFactors" JSONB;

-- CSAPP-HOTFIX-03: procedencia técnica de la configuración inicial de Calidad. Las revisiones son inmutables (disparador); solo se amplía el CHECK del tipo.
ALTER TABLE "ConfigRevision" DROP CONSTRAINT "ConfigRevision_kind_check";
ALTER TABLE "ConfigRevision" ADD CONSTRAINT "ConfigRevision_kind_check" CHECK ("kind" IN ('INITIAL', 'ACTIVATION', 'ROLLBACK', 'SYSTEM_INITIAL'));

-- CSAPP-HOTFIX-03: decisión explícita «No aplica» por sistema para un Grupo o Cliente (nunca por relleno automático de vacíos).
CREATE TABLE "MasterLinkDecision" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "clientId" TEXT,
    "system" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    "note" TEXT,
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MasterLinkDecision_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "MasterLinkDecision" ADD CONSTRAINT "MasterLinkDecision_target" CHECK (("groupId" IS NULL) <> ("clientId" IS NULL));
ALTER TABLE "MasterLinkDecision" ADD CONSTRAINT "MasterLinkDecision_system" CHECK ("system" IN ('WRIKE', 'ZENDESK', 'PAP', 'SUPPORT', 'HOSTING'));
ALTER TABLE "MasterLinkDecision" ADD CONSTRAINT "MasterLinkDecision_status" CHECK ("status" IN ('NOT_APPLICABLE'));
CREATE UNIQUE INDEX "MasterLinkDecision_group_system" ON "MasterLinkDecision"("groupId", "system") WHERE "groupId" IS NOT NULL;
CREATE UNIQUE INDEX "MasterLinkDecision_client_system" ON "MasterLinkDecision"("clientId", "system") WHERE "clientId" IS NOT NULL;
CREATE INDEX "MasterLinkDecision_groupId_idx" ON "MasterLinkDecision"("groupId");
CREATE INDEX "MasterLinkDecision_clientId_idx" ON "MasterLinkDecision"("clientId");
ALTER TABLE "MasterLinkDecision" ADD CONSTRAINT "MasterLinkDecision_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ClientGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MasterLinkDecision" ADD CONSTRAINT "MasterLinkDecision_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MasterLinkDecision" ADD CONSTRAINT "MasterLinkDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
