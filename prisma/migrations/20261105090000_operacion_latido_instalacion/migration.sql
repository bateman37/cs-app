-- CSAPP-10: latido por trabajador e identidad de instalación. Incremental: no modifica ninguna tabla anterior.
CREATE TYPE "WorkerState" AS ENUM ('IDLE', 'BUSY', 'STOPPING', 'STOPPED');

CREATE TABLE "WorkerInstance" (
    "id" TEXT NOT NULL,
    "pid" INTEGER NOT NULL,
    "host" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "state" "WorkerState" NOT NULL DEFAULT 'IDLE',
    "currentKind" TEXT,
    "currentJobId" TEXT,
    "currentBatchId" TEXT,
    "progressAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "stopRequestedAt" TIMESTAMP(3),

    CONSTRAINT "WorkerInstance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkerInstance_lastSeenAt_idx" ON "WorkerInstance"("lastSeenAt");

CREATE TABLE "InstallationMeta" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstallationMeta_pkey" PRIMARY KEY ("key")
);
