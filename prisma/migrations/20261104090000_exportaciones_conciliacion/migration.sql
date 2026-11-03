-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('QUEUED', 'PREPARING', 'GENERATING', 'READY', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'QUEUED',
    "phase" TEXT,
    "progressDone" BIGINT NOT NULL DEFAULT 0,
    "progressTotal" BIGINT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "formatVersion" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "configRevisions" JSONB NOT NULL,
    "requestedStamp" TEXT NOT NULL,
    "requestedReadAt" TIMESTAMP(3) NOT NULL,
    "requestedTotals" JSONB NOT NULL,
    "materializedAt" TIMESTAMP(3),
    "materialStamp" TEXT,
    "materialContext" JSONB,
    "rowCount" BIGINT,
    "laterThanScreen" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "fence" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportFile" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "part" INTEGER NOT NULL DEFAULT 1,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rows" BIGINT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "checksum" TEXT NOT NULL,
    "additive" BOOLEAN NOT NULL DEFAULT true,
    "storageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportRow" (
    "jobId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "cells" JSONB NOT NULL,

    CONSTRAINT "ExportRow_pkey" PRIMARY KEY ("jobId","fileKey","seq")
);

-- CreateTable
CREATE TABLE "ReconRun" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "stamp" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL,
    "results" JSONB NOT NULL,
    "manifest" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExportJob_ownerId_createdAt_idx" ON "ExportJob"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "ExportJob_status_runAfter_idx" ON "ExportJob"("status", "runAfter");

-- CreateIndex
CREATE INDEX "ExportJob_status_expiresAt_idx" ON "ExportJob"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExportFile_storageId_key" ON "ExportFile"("storageId");

-- CreateIndex
CREATE UNIQUE INDEX "ExportFile_jobId_fileKey_part_key" ON "ExportFile"("jobId", "fileKey", "part");

-- CreateIndex
CREATE INDEX "ReconRun_createdAt_idx" ON "ReconRun"("createdAt");

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportFile" ADD CONSTRAINT "ExportFile_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ExportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconRun" ADD CONSTRAINT "ReconRun_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

