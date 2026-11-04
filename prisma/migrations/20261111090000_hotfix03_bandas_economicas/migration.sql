-- CSAPP-HOTFIX-03: bandas económicas configurables (factores del objetivo). Incremental; NULL conserva las revisiones anteriores con las bandas iniciales.
ALTER TABLE "EconomicSettingsRevision" ADD COLUMN "bandFactors" JSONB;

-- CSAPP-HOTFIX-03: procedencia técnica de la configuración inicial de Calidad. Las revisiones son inmutables (disparador); solo se amplía el CHECK del tipo.
ALTER TABLE "ConfigRevision" DROP CONSTRAINT "ConfigRevision_kind_check";
ALTER TABLE "ConfigRevision" ADD CONSTRAINT "ConfigRevision_kind_check" CHECK ("kind" IN ('INITIAL', 'ACTIVATION', 'ROLLBACK', 'SYSTEM_INITIAL'));
