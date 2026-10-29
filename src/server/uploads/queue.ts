import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { uploadConfig } from "./config";

/**
 * Cola de trabajos en PostgreSQL (sin Redis). Reclamación atómica con FOR UPDATE SKIP LOCKED,
 * lease con latido y token de fencing: un trabajador que perdió el trabajo no puede confirmar.
 */
export type JobKind = "PREPARE" | "ACTIVATE" | "REVERT";

export type ClaimedJob = {
  id: string;
  batchId: string;
  kind: JobKind;
  attempts: number;
  maxAttempts: number;
  fence: number;
  actorId: string;
  leaseOwner: string;
};

/** El trabajo ya no pertenece a este trabajador (lease vencido y reclamado por otro). */
export class LostLeaseError extends Error {
  constructor() {
    super("Trabajo perdido: otro trabajador lo ha reclamado.");
    this.name = "LostLeaseError";
  }
}
/** El trabajador se está deteniendo: el trabajo vuelve a la cola conservando el checkpoint. */
export class ReleaseRequested extends Error {
  constructor() {
    super("Trabajador detenido.");
    this.name = "ReleaseRequested";
  }
}
/** Error que no se reintenta (p. ej. el actor ya no es administrador). */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}

type Tx = Prisma.TransactionClient;

export async function enqueueJob(tx: Tx, batchId: string, kind: JobKind, actorId: string) {
  return tx.uploadJob.create({
    data: { batchId, kind, actorId, maxAttempts: uploadConfig().maxAttempts },
  });
}

/** Marca como fallidos los trabajos con lease vencido que agotaron sus intentos. */
export async function failExhaustedJobs(): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ batchId: string; kind: JobKind }[]>(Prisma.sql`
      UPDATE "UploadJob" SET status = 'FAILED', "finishedAt" = now(),
        "lastError" = 'El trabajador dejó de responder y se agotaron los intentos.'
      WHERE status = 'RUNNING' AND "leaseExpiresAt" < now() AND attempts >= "maxAttempts"
      RETURNING "batchId", kind`);
    for (const r of rows) {
      if (r.kind === "REVERT") continue;
      await tx.uploadBatch.updateMany({
        where: { id: r.batchId, status: { in: ["QUEUED", "PREPARING", "ACTIVATION_QUEUED", "ACTIVATING"] } },
        data: { status: "FAILED", statusDetail: "El trabajador dejó de responder y se agotaron los intentos.", finishedAt: new Date() },
      });
    }
    return rows.length;
  });
}

/** Reclama el siguiente trabajo (pendiente, o en curso con lease vencido). */
export async function claimNextJob(workerId: string): Promise<ClaimedJob | null> {
  const cfg = uploadConfig();
  await failExhaustedJobs();
  const rows = await prisma.$queryRaw<ClaimedJob[]>(Prisma.sql`
    UPDATE "UploadJob" j SET status = 'RUNNING', "leaseOwner" = ${workerId},
      "leaseExpiresAt" = now() + (${cfg.leaseMs} * interval '1 millisecond'), "heartbeatAt" = now(),
      fence = j.fence + 1, attempts = j.attempts + 1, "startedAt" = COALESCE(j."startedAt", now())
    WHERE j.id = (
      SELECT id FROM "UploadJob"
      WHERE ((status = 'PENDING' AND "runAfter" <= now()) OR (status = 'RUNNING' AND "leaseExpiresAt" < now()))
        AND attempts < "maxAttempts"
      ORDER BY "createdAt", id
      FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING j.id, j."batchId", j.kind, j.attempts, j."maxAttempts", j.fence, j."actorId", j."leaseOwner"`);
  return rows[0] ?? null;
}

/** Latido: extiende el lease solo si el trabajo sigue siendo de este trabajador. */
export async function heartbeat(job: ClaimedJob): Promise<boolean> {
  const n = await prisma.$executeRaw(Prisma.sql`
    UPDATE "UploadJob" SET "leaseExpiresAt" = now() + (${uploadConfig().leaseMs} * interval '1 millisecond'), "heartbeatAt" = now()
    WHERE id = ${job.id} AND fence = ${job.fence} AND "leaseOwner" = ${job.leaseOwner} AND status = 'RUNNING'`);
  return n === 1;
}

/**
 * Protección por fencing: bloquea la fila del trabajo y exige que siga RUNNING con el mismo
 * propietario y token. Todas las escrituras del trabajador la llaman dentro de su transacción.
 */
export async function assertFence(tx: Tx, job: ClaimedJob): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM "UploadJob"
    WHERE id = ${job.id} AND fence = ${job.fence} AND "leaseOwner" = ${job.leaseOwner} AND status = 'RUNNING'
    FOR UPDATE`);
  if (rows.length === 0) throw new LostLeaseError();
}

export async function markJobDone(tx: Tx, job: ClaimedJob): Promise<void> {
  await tx.uploadJob.update({ where: { id: job.id }, data: { status: "DONE", finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null } });
}

export async function markJobCancelled(tx: Tx, job: ClaimedJob): Promise<void> {
  await tx.uploadJob.update({ where: { id: job.id }, data: { status: "CANCELLED", finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null } });
}

/** Devuelve el trabajo a la cola sin contar el intento (cierre ordenado del trabajador). */
export async function releaseJob(job: ClaimedJob): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "UploadJob" SET status = 'PENDING', attempts = GREATEST(attempts - 1, 0), "leaseOwner" = NULL,
      "leaseExpiresAt" = NULL, "runAfter" = now()
    WHERE id = ${job.id} AND fence = ${job.fence} AND "leaseOwner" = ${job.leaseOwner} AND status = 'RUNNING'`);
}

/**
 * Registra un fallo: reintento con espera acotada o, agotados los intentos (o si no es reintentable),
 * trabajo y lote en FAILED. Nunca deja un trabajo eternamente en ejecución ni en bucle.
 */
export async function failJob(job: ClaimedJob, message: string, retryable = true): Promise<"retry" | "failed" | "lost"> {
  const cfg = uploadConfig();
  const safe = message.slice(0, 500);
  return prisma.$transaction(async (tx) => {
    try {
      await assertFence(tx, job);
    } catch {
      return "lost";
    }
    if (retryable && job.attempts < job.maxAttempts) {
      const wait = Math.min(cfg.backoffBaseMs * 2 ** (job.attempts - 1), 60_000);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "UploadJob" SET status = 'PENDING', "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "lastError" = ${safe},
          "runAfter" = now() + (${wait} * interval '1 millisecond') WHERE id = ${job.id}`);
      return "retry";
    }
    await tx.uploadJob.update({
      where: { id: job.id },
      data: { status: "FAILED", lastError: safe, finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null },
    });
    if (job.kind !== "REVERT") {
      await tx.uploadBatch.updateMany({
        where: { id: job.batchId, status: { in: ["QUEUED", "PREPARING", "ACTIVATION_QUEUED", "ACTIVATING"] } },
        data: { status: "FAILED", statusDetail: safe, finishedAt: new Date() },
      });
    }
    return "failed";
  });
}
