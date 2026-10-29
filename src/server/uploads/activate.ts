import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { AccessError } from "@/lib/access";
import { authorize } from "@/server/authorize";
import { recordAudit } from "@/server/audit";
import { uploadConfig } from "./config";
import { computeDispositions, recomputeCounters } from "./disposition";
import type { ActivationContext } from "./profile";
import { getProfile } from "./registry";
import { assertFence, enqueueJob, markJobCancelled, markJobDone, NonRetryableError, type ClaimedJob } from "./queue";
import type { JobRuntime } from "./prepare";

type BatchLock = {
  id: string;
  status: string;
  profileId: string;
  profileVersion: number;
  scopeKey: string | null;
  rulesSnapshot: string | null;
  metadata: Record<string, unknown>;
  supersedesBatchId: string | null;
  supersededByBatchId: string | null;
  originalName: string;
};

async function lockBatch(tx: Prisma.TransactionClient, batchId: string): Promise<BatchLock> {
  const rows = await tx.$queryRaw<BatchLock[]>(Prisma.sql`
    SELECT id, status::text AS status, "profileId", "profileVersion", "scopeKey", "rulesSnapshot", metadata,
           "supersedesBatchId", "supersededByBatchId", "originalName"
    FROM "UploadBatch" WHERE id = ${batchId} FOR UPDATE`);
  if (!rows[0]) throw new NonRetryableError("Lote no encontrado.");
  return rows[0];
}

async function actorOf(tx: Prisma.TransactionClient, job: ClaimedJob) {
  try {
    return await authorize(tx, job.actorId, "ADMIN");
  } catch (e) {
    if (e instanceof AccessError) throw new NonRetryableError("El autor de la operación ya no es un administrador activo.");
    throw e;
  }
}

/** Un ámbito = (perfil, scopeKey): bloquea activaciones incompatibles del mismo ámbito sin bloqueo global. */
async function lockScope(tx: Prisma.TransactionClient, profileId: string, scopeKey: string | null) {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${profileId}|${scopeKey ?? ""}`}, 0))`);
}

/**
 * Activación. El reclamo confirma ACTIVATING en su propia transacción; después UNA transacción atómica
 * aplica los datos del ámbito, las procedencias, el estado final y la auditoría. Un fallo deshace todo.
 */
export async function runActivate(rt: JobRuntime): Promise<"completed" | "stale" | "skipped"> {
  const { job } = rt;
  const cfg = uploadConfig();
  const go = await prisma.$transaction(async (tx) => {
    await assertFence(tx, job);
    const b = await tx.uploadBatch.findUnique({ where: { id: job.batchId }, select: { status: true } });
    if (b?.status === "ACTIVATION_QUEUED") {
      await tx.uploadBatch.update({ where: { id: job.batchId }, data: { status: "ACTIVATING", phase: "Activando" } });
      return true;
    }
    if (b?.status === "ACTIVATING") return true;
    await markJobCancelled(tx, job);
    return false;
  });
  if (!go) return "skipped";

  return prisma.$transaction(
    async (tx) => {
      await assertFence(tx, job);
      const batch = await lockBatch(tx, job.batchId);
      if (batch.status !== "ACTIVATING") throw new NonRetryableError("El lote ya no está en activación.");
      const actor = await actorOf(tx, job);
      const profile = await getProfile(batch.profileId);
      if (!profile) throw new NonRetryableError("El perfil de esta carga no está disponible.");
      await lockScope(tx, batch.profileId, batch.scopeKey);

      // Obsolescencia: reglas, versión de perfil o maestros cambiaron tras la previsualización.
      const rules = await profile.rulesFingerprint(tx);
      if (profile.version !== batch.profileVersion || rules !== batch.rulesSnapshot) {
        await tx.uploadBatch.update({
          where: { id: batch.id },
          data: { status: "QUEUED", phase: "Revalidando: las reglas o maestros cambiaron", checkpointPosition: 0, rowsProcessed: 0, rulesSnapshot: null },
        });
        await markJobDone(tx, job);
        await enqueueJob(tx, batch.id, "PREPARE", job.actorId);
        await recordAudit(tx, actor, {
          action: "REPROCESS",
          entityType: "UploadBatch",
          entityId: batch.id,
          batchId: batch.id,
          summary: `Carga «${batch.originalName}»: las reglas o maestros cambiaron antes de activar; se revalida sin aplicar resultados obsoletos`,
        });
        return "stale" as const;
      }

      const dedupeKey = batch.scopeKey ?? "";
      let previousBatchId: string | null = null;
      if (profile.policy === "REPLACE_SCOPE") {
        const prev = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT id FROM "UploadBatch"
          WHERE "profileId" = ${batch.profileId} AND "scopeKey" = ${batch.scopeKey} AND status = 'COMPLETED'
            AND "supersededByBatchId" IS NULL AND id <> ${batch.id}
          FOR UPDATE`);
        previousBatchId = prev[0]?.id ?? null;
      }
      const ctx: ActivationContext = {
        batchId: batch.id,
        profileId: batch.profileId,
        scopeKey: batch.scopeKey,
        dedupeKey,
        previousBatchId,
        metadata: batch.metadata,
      };
      await computeDispositions(tx, batch.id, profile, dedupeKey);
      const result = await profile.activate(tx, ctx);

      if (profile.policy === "INCORPORATE") {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "UploadRecordSource" ("batchId", "profileId", "dedupeKey", fingerprint, "entityKey", occurrences, "firstPosition")
          SELECT ${batch.id}, ${batch.profileId}, ${dedupeKey}, fingerprint, min("entityKey"), count(*), min(position)
          FROM "UploadStagedRow" WHERE "batchId" = ${batch.id} AND classification = 'VALID'
          GROUP BY fingerprint
          ON CONFLICT ("batchId", fingerprint) DO NOTHING`);
      } else if (previousBatchId) {
        await tx.uploadBatch.update({ where: { id: previousBatchId }, data: { supersededByBatchId: batch.id } });
      }
      const counters = await recomputeCounters(tx, batch.id);
      await tx.uploadBatch.update({
        where: { id: batch.id },
        data: {
          ...counters,
          status: "COMPLETED",
          phase: "Completado",
          rowsImported: result.inserted + result.revised,
          supersedesBatchId: previousBatchId,
          finishedAt: new Date(),
        },
      });
      await markJobDone(tx, job);
      await recordAudit(tx, actor, {
        action: "ACTIVATE",
        entityType: "UploadBatch",
        entityId: batch.id,
        batchId: batch.id,
        summary: `Carga «${batch.originalName}» activada: ${result.inserted} nuevas, ${result.revised} revisadas`,
        after: { ...counters, inserted: result.inserted, revised: result.revised, sustituye: previousBatchId },
      });
      return "completed" as const;
    },
    { maxWait: 10_000, timeout: cfg.activationTimeoutMs },
  );
}

/** Reversión atómica: respeta las filas compartidas con otros lotes vigentes. */
export async function runRevert(rt: JobRuntime): Promise<void> {
  const { job } = rt;
  await prisma.$transaction(
    async (tx) => {
      await assertFence(tx, job);
      const batch = await lockBatch(tx, job.batchId);
      if (batch.status !== "COMPLETED") throw new NonRetryableError("Solo se puede revertir un lote completado.");
      const actor = await actorOf(tx, job);
      const profile = await getProfile(batch.profileId);
      if (!profile?.revert) throw new NonRetryableError("El perfil de esta fuente no admite revertir.");
      await lockScope(tx, batch.profileId, batch.scopeKey);
      let previousBatchId: string | null = null;
      if (profile.policy === "REPLACE_SCOPE") {
        if (batch.supersededByBatchId) throw new NonRetryableError("Este lote ya fue sustituido: revierta primero el posterior.");
        previousBatchId = batch.supersedesBatchId;
        await tx.uploadBatch.update({ where: { id: batch.id }, data: { supersedesBatchId: null } });
        if (previousBatchId) await tx.uploadBatch.update({ where: { id: previousBatchId }, data: { supersededByBatchId: null } });
      }
      // Marcado como REVERTED antes: deja de contar como lote vigente para las huérfanas.
      await tx.uploadBatch.update({
        where: { id: batch.id },
        data: { status: "REVERTED", phase: "Revertido", finishedAt: new Date(), version: { increment: 1 } },
      });
      await profile.revert(tx, {
        batchId: batch.id,
        profileId: batch.profileId,
        scopeKey: batch.scopeKey,
        dedupeKey: batch.scopeKey ?? "",
        previousBatchId,
        metadata: batch.metadata,
      });
      await markJobDone(tx, job);
      await recordAudit(tx, actor, {
        action: "REVERT",
        entityType: "UploadBatch",
        entityId: batch.id,
        batchId: batch.id,
        summary: `Carga «${batch.originalName}» revertida${previousBatchId ? "; se restaura el conjunto anterior del ámbito" : ""}`,
      });
    },
    { maxWait: 10_000, timeout: uploadConfig().activationTimeoutMs },
  );
}
