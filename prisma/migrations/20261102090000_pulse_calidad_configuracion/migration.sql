-- CSAPP-07: configuración versionada de Pulse Rent y Calidad. Migración incremental: no modifica ninguna tabla anterior.

-- CreateTable
CREATE TABLE "ConfigRevision" (
    "id" BIGSERIAL NOT NULL,
    "family" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "reason" TEXT,
    "kind" TEXT NOT NULL,
    "restoredFromRevisionNo" INTEGER,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedById" TEXT,

    CONSTRAINT "ConfigRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigDraft" (
    "id" BIGSERIAL NOT NULL,
    "family" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "baseRevisionNo" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "ConfigDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfigRevision_family_revisionNo_key" ON "ConfigRevision"("family", "revisionNo");

-- CreateIndex
CREATE UNIQUE INDEX "ConfigDraft_family_key" ON "ConfigDraft"("family");

-- AddForeignKey
ALTER TABLE "ConfigRevision" ADD CONSTRAINT "ConfigRevision_activatedById_fkey" FOREIGN KEY ("activatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigDraft" ADD CONSTRAINT "ConfigDraft_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integridad: familias y tipos de activación cerrados; una reversión identifica su origen.
ALTER TABLE "ConfigRevision" ADD CONSTRAINT "ConfigRevision_family_check" CHECK ("family" IN ('PULSE', 'QUALITY'));
ALTER TABLE "ConfigRevision" ADD CONSTRAINT "ConfigRevision_kind_check" CHECK ("kind" IN ('INITIAL', 'ACTIVATION', 'ROLLBACK'));
ALTER TABLE "ConfigRevision" ADD CONSTRAINT "ConfigRevision_rollback_check" CHECK (("kind" = 'ROLLBACK') = ("restoredFromRevisionNo" IS NOT NULL));
ALTER TABLE "ConfigRevision" ADD CONSTRAINT "ConfigRevision_no_check" CHECK ("revisionNo" >= 1);
ALTER TABLE "ConfigDraft" ADD CONSTRAINT "ConfigDraft_family_check" CHECK ("family" IN ('PULSE', 'QUALITY'));

-- Las revisiones activadas son inmutables: ni UPDATE ni DELETE.
CREATE OR REPLACE FUNCTION csapp_config_revision_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Las revisiones de configuración son inmutables (no se modifican ni se borran).' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ConfigRevision_immutable" BEFORE UPDATE OR DELETE ON "ConfigRevision" FOR EACH ROW EXECUTE FUNCTION csapp_config_revision_immutable();
