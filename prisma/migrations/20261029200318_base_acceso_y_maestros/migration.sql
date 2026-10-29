-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'CONSULTA');

-- CreateEnum
CREATE TYPE "ExternalSystem" AS ENUM ('BC', 'ZENDESK', 'WRIKE', 'PAP');

-- CreateEnum
CREATE TYPE "IdentityKind" AS ENUM ('GROUP_KEY', 'ORG_ID', 'ORG_NAME', 'PROJECT_ID', 'PROJECT_NAME');

-- CreateEnum
CREATE TYPE "ServiceAttribute" AS ENUM ('SUPPORT', 'HOSTING', 'COMPLEXITY', 'PRODUCT');

-- CreateEnum
CREATE TYPE "MilestoneType" AS ENUM ('START', 'CLOUD_MIGRATION', 'MAJOR_VERSION');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DEACTIVATE', 'REACTIVATE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'CONSULTA',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bcDenomination" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "name" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Implementation" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Implementation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalIdentity" (
    "id" TEXT NOT NULL,
    "system" "ExternalSystem" NOT NULL,
    "kind" "IdentityKind" NOT NULL,
    "rawValue" TEXT NOT NULL,
    "searchValue" TEXT NOT NULL,
    "groupId" TEXT,
    "clientId" TEXT,
    "implementationId" TEXT,
    "validFrom" DATE,
    "validTo" DATE,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceTerm" (
    "id" TEXT NOT NULL,
    "attribute" "ServiceAttribute" NOT NULL,
    "value" TEXT NOT NULL,
    "groupId" TEXT,
    "clientId" TEXT,
    "implementationId" TEXT,
    "validFrom" DATE,
    "validTo" DATE,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "type" "MilestoneType" NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "groupId" TEXT,
    "clientId" TEXT,
    "implementationId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "groupId" TEXT,
    "clientId" TEXT,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimit_key_key" ON "RateLimit"("key");

-- CreateIndex
CREATE INDEX "Client_groupId_idx" ON "Client"("groupId");

-- CreateIndex
CREATE INDEX "Implementation_clientId_idx" ON "Implementation"("clientId");

-- CreateIndex
CREATE INDEX "ExternalIdentity_system_kind_searchValue_idx" ON "ExternalIdentity"("system", "kind", "searchValue");

-- CreateIndex
CREATE INDEX "ExternalIdentity_groupId_idx" ON "ExternalIdentity"("groupId");

-- CreateIndex
CREATE INDEX "ExternalIdentity_clientId_idx" ON "ExternalIdentity"("clientId");

-- CreateIndex
CREATE INDEX "ExternalIdentity_implementationId_idx" ON "ExternalIdentity"("implementationId");

-- CreateIndex
CREATE INDEX "ServiceTerm_groupId_idx" ON "ServiceTerm"("groupId");

-- CreateIndex
CREATE INDEX "ServiceTerm_clientId_idx" ON "ServiceTerm"("clientId");

-- CreateIndex
CREATE INDEX "ServiceTerm_implementationId_idx" ON "ServiceTerm"("implementationId");

-- CreateIndex
CREATE INDEX "Milestone_groupId_idx" ON "Milestone"("groupId");

-- CreateIndex
CREATE INDEX "Milestone_clientId_idx" ON "Milestone"("clientId");

-- CreateIndex
CREATE INDEX "Milestone_implementationId_idx" ON "Milestone"("implementationId");

-- CreateIndex
CREATE INDEX "AuditEvent_groupId_at_idx" ON "AuditEvent"("groupId", "at");

-- CreateIndex
CREATE INDEX "AuditEvent_clientId_at_idx" ON "AuditEvent"("clientId", "at");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ClientGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Implementation" ADD CONSTRAINT "Implementation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ClientGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_implementationId_fkey" FOREIGN KEY ("implementationId") REFERENCES "Implementation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTerm" ADD CONSTRAINT "ServiceTerm_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ClientGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTerm" ADD CONSTRAINT "ServiceTerm_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTerm" ADD CONSTRAINT "ServiceTerm_implementationId_fkey" FOREIGN KEY ("implementationId") REFERENCES "Implementation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ClientGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_implementationId_fkey" FOREIGN KEY ("implementationId") REFERENCES "Implementation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Integridad que Prisma no expresa. Convención de vigencias: [validFrom, validTo),
-- validFrom inclusivo, validTo exclusivo, extremo nulo = sin límite conocido.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Nombres canónicos únicos sin distinguir mayúsculas.
CREATE UNIQUE INDEX "ClientGroup_name_ci_key" ON "ClientGroup" (lower("name"));
CREATE UNIQUE INDEX "Client_group_name_ci_key" ON "Client" (COALESCE("groupId", ''), lower("name"));
CREATE UNIQUE INDEX "Implementation_client_name_ci_key" ON "Implementation" ("clientId", lower("name"));
CREATE UNIQUE INDEX "Implementation_client_key_ci_key" ON "Implementation" ("clientId", lower("key")) WHERE "key" IS NOT NULL;
CREATE UNIQUE INDEX "Product_name_ci_key" ON "Product" (lower("name"));

-- Nombres no vacíos.
ALTER TABLE "ClientGroup" ADD CONSTRAINT "ClientGroup_name_not_blank" CHECK (btrim("name") <> '');
ALTER TABLE "Client" ADD CONSTRAINT "Client_name_not_blank" CHECK (btrim("name") <> '');
ALTER TABLE "Implementation" ADD CONSTRAINT "Implementation_name_not_blank" CHECK (btrim("name") <> '');
ALTER TABLE "Product" ADD CONSTRAINT "Product_name_not_blank" CHECK (btrim("name") <> '');

-- Equivalencias: un único destino, sistema/tipo coherentes y vigencia ordenada.
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_one_target"
  CHECK (num_nonnulls("groupId", "clientId", "implementationId") = 1);
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_system_kind_target" CHECK (
  ("system" = 'BC' AND "kind" = 'GROUP_KEY' AND "groupId" IS NOT NULL)
  OR ("system" = 'ZENDESK' AND "kind" IN ('ORG_ID', 'ORG_NAME') AND "clientId" IS NOT NULL)
  OR ("system" IN ('WRIKE', 'PAP') AND "kind" IN ('ORG_ID', 'ORG_NAME', 'PROJECT_ID', 'PROJECT_NAME')
      AND "groupId" IS NULL)
);
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_valid_range"
  CHECK ("validFrom" IS NULL OR "validTo" IS NULL OR "validFrom" < "validTo");
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_values_not_blank"
  CHECK (btrim("rawValue") <> '' AND btrim("searchValue") <> '');
-- La misma identidad (sistema + tipo + valor de búsqueda) no puede estar activa en dos
-- vigencias solapadas, sea cual sea el destino. También protege ante concurrencia.
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_no_overlap" EXCLUDE USING gist (
  "system" WITH =, "kind" WITH =, "searchValue" WITH =,
  daterange("validFrom", "validTo", '[)') WITH &&
) WHERE ("isActive");

-- Datos de servicio: un único ámbito, catálogo válido y vigencias sin solapamiento.
ALTER TABLE "ServiceTerm" ADD CONSTRAINT "ServiceTerm_one_scope"
  CHECK (num_nonnulls("groupId", "clientId", "implementationId") = 1);
ALTER TABLE "ServiceTerm" ADD CONSTRAINT "ServiceTerm_valid_range"
  CHECK ("validFrom" IS NULL OR "validTo" IS NULL OR "validFrom" < "validTo");
ALTER TABLE "ServiceTerm" ADD CONSTRAINT "ServiceTerm_catalog_value" CHECK (
  ("attribute" = 'SUPPORT' AND "value" IN ('GOLD', 'PLATINUM', 'SILVER_ON_DEMAND', 'SILVER_RECURRENTE'))
  OR ("attribute" = 'HOSTING' AND "value" IN ('CLOUD', 'OP'))
  OR ("attribute" = 'COMPLEXITY' AND "value" IN ('BASIC', 'MEDIUM', 'ENTERPRISE'))
  OR ("attribute" = 'PRODUCT' AND btrim("value") <> '')
);
ALTER TABLE "ServiceTerm" ADD CONSTRAINT "ServiceTerm_no_overlap" EXCLUDE USING gist (
  (COALESCE("groupId", "clientId", "implementationId")) WITH =, "attribute" WITH =,
  daterange("validFrom", "validTo", '[)') WITH &&
);

-- Hitos: un único ámbito.
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_one_scope"
  CHECK (num_nonnulls("groupId", "clientId", "implementationId") = 1);
