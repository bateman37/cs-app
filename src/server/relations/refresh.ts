import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { authorize } from "@/server/authorize";
import { recordAudit } from "@/server/audit";
import { adminTransaction } from "@/server/tx";
import { noteProgress, setActivity } from "@/server/ops/worker-instance";
import { lockDerivation, rederiveEntries } from "@/server/zendesk/derive";
import { rederiveWrikeEntries } from "@/server/wrike/derive";
import { rederivePapItems } from "@/server/pap/profile";
import { rederiveWorkItemLinks } from "@/server/bugs/links";
import { financeMasterStamp, reresolveRows } from "@/server/finance/resolve";
import { uploadConfig } from "@/server/uploads/config";
import { LostLeaseError, NonRetryableError } from "@/server/uploads/queue";
import { relationReport, assertConciliation, type RelationReport } from "./report";

/**
 * Actualización automática de relaciones (HOTFIX-02 §4). Contrato completo: docs/arquitectura/hotfix02-enlace-automatico.md.
 *
 *  - Una sola fila de estado (`RelationRefresh`, ámbito `global`). Los disparadores de la base suman 1 a `requestedGeneration` ante cualquier
 *    cambio de maestros (también el que llega mientras se recalcula): nada se pierde ni se acumula como trabajo duplicado (coalescencia).
 *  - El trabajador reclama la fila con lease y token de fencing (como la cola de cargas), toma la generación `g` al empezar y, en UNA transacción
 *    protegida por el bloqueo de derivación, recalcula por CONJUNTOS todo lo derivado: tiempos Zendesk, tiempos Wrike, PAP, vínculos Work Item–ticket
 *    y atribución financiera. Al terminar publica `completedGeneration = g`; si ya hay una generación mayor queda PENDING y vuelve a ejecutarse.
 *    Una tarea antigua nunca marca como definitiva una atribución hecha con un maestro posterior: solo publica hasta SU generación.
 *  - Idempotente: cada derivación solo escribe (y versiona) lo que cambia; reintentar, reiniciar el trabajador o repetir no suma dos veces.
 *  - Conciliación antes/después: filas y minutos de cada fuente, PAP únicos, tickets e ingresos no cambian al moverse de pendiente a identificado;
 *    si no concilian la transacción se deshace y el fallo queda registrado.
 */
export const REFRESH_SCOPE = "global";

export type RefreshStatus = {
  /** Estado de negocio: `UP_TO_DATE` solo si no queda ninguna generación solicitada sin publicar. */
  state: "UP_TO_DATE" | "PENDING" | "RUNNING" | "FAILED";
  requestedGeneration: number;
  completedGeneration: number;
  reason: string | null;
  requestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  attempts: number;
  maxAttempts: number;
  progress: { phase: string; step: number; steps: number } | null;
  lastError: string | null;
  lastReport: RelationReport | null;
};

const num = (v: bigint | number | null | undefined) => Number(v ?? 0);
const iso = (d: Date | null) => (d ? d.toISOString() : null);

type Row = Awaited<ReturnType<typeof prisma.relationRefresh.findUnique>>;
function shape(r: Row): RefreshStatus {
  if (!r) return { state: "UP_TO_DATE", requestedGeneration: 0, completedGeneration: 0, reason: null, requestedAt: null, startedAt: null, finishedAt: null, attempts: 0, maxAttempts: 0, progress: null, lastError: null, lastReport: null };
  const requested = num(r.requestedGeneration);
  const completed = num(r.completedGeneration);
  const behind = requested > completed;
  const state: RefreshStatus["state"] = r.status === "FAILED" && behind ? "FAILED" : r.status === "RUNNING" && behind ? "RUNNING" : behind ? "PENDING" : "UP_TO_DATE";
  return {
    state, requestedGeneration: requested, completedGeneration: completed, reason: r.reason, requestedAt: iso(r.requestedAt), startedAt: iso(r.startedAt), finishedAt: iso(r.finishedAt),
    attempts: r.attempts, maxAttempts: r.maxAttempts, progress: (r.progress as RefreshStatus["progress"]) ?? null, lastError: r.lastError, lastReport: (r.lastReport as RelationReport | null) ?? null,
  };
}

/** Estado actual (lectura pura, sin permisos: lo usan el sello de datos y los avisos). La consulta de Administración exige ADMIN. */
export async function readRefreshStatus(db: Pick<typeof prisma, "relationRefresh"> = prisma): Promise<RefreshStatus> {
  return shape(await db.relationRefresh.findUnique({ where: { scope: REFRESH_SCOPE } }));
}

export async function getRefreshStatus(actorId: string): Promise<RefreshStatus> {
  await authorize(prisma, actorId, "READ");
  return readRefreshStatus();
}

/** Solicita una generación nueva (misma operación que los disparadores). Devuelve la generación solicitada. */
async function bump(tx: Prisma.TransactionClient, reason: string, actorId: string | null): Promise<number> {
  const rows = await tx.$queryRaw<{ g: bigint }[]>(Prisma.sql`
    INSERT INTO "RelationRefresh" ("scope", "requestedGeneration", "status", "reason", "requestedAt", "requestedById", "updatedAt")
    VALUES (${REFRESH_SCOPE}, 1, 'PENDING', ${reason}, now(), ${actorId}, now())
    ON CONFLICT ("scope") DO UPDATE SET
      "requestedGeneration" = "RelationRefresh"."requestedGeneration" + 1,
      "status" = CASE WHEN "RelationRefresh"."status" = 'RUNNING' THEN 'RUNNING' ELSE 'PENDING' END,
      "attempts" = CASE WHEN "RelationRefresh"."status" = 'FAILED' THEN 0 ELSE "RelationRefresh"."attempts" END,
      "runAfter" = CASE WHEN "RelationRefresh"."status" = 'RUNNING' THEN "RelationRefresh"."runAfter" ELSE now() END,
      "reason" = ${reason}, "requestedAt" = now(), "requestedById" = ${actorId}, "updatedAt" = now()
    RETURNING "requestedGeneration" AS g`);
  return num(rows[0].g);
}

/**
 * Acción de Administración «Actualizar relaciones de los datos cargados»: recuperación de la instalación existente y de un fallo. Es idempotente
 * (si ya hay una actualización pendiente o en curso, solo asegura que no se pierda y lo indica) y no relee originales ni cambia ganadores.
 */
export async function requestRepair(actorId: string): Promise<{ generation: number; alreadyPending: boolean }> {
  return adminTransaction(actorId, async (tx, actor) => {
    const before = await tx.relationRefresh.findUnique({ where: { scope: REFRESH_SCOPE } });
    const pending = before ? num(before.requestedGeneration) > num(before.completedGeneration) && before.status !== "FAILED" : false;
    const generation = await bump(tx, "REPARACION_MANUAL", actor.id);
    await recordAudit(tx, actor, {
      action: "REPROCESS", entityType: "RelationRefresh", entityId: REFRESH_SCOPE,
      summary: "Actualizar relaciones de los datos cargados (recuperación): se recalculan las atribuciones de lo ya cargado con los maestros actuales",
      after: { generation, yaPendiente: pending },
    });
    return { generation, alreadyPending: pending };
  });
}

// ---------------------------------------------------------------- Reclamo con lease y fencing

export type ClaimedRefresh = { generation: number; fence: number; leaseOwner: string; attempts: number; maxAttempts: number };

/** Marca FAILED la ejecución cuyo lease venció habiendo agotado los intentos (nunca queda eternamente en curso ni en bucle). */
async function failExhausted(): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "RelationRefresh" SET status = 'FAILED', "finishedAt" = now(), "leaseOwner" = NULL, "leaseExpiresAt" = NULL, progress = NULL,
      "lastError" = 'El trabajador dejó de responder y se agotaron los intentos de actualizar las relaciones.', "updatedAt" = now()
    WHERE scope = ${REFRESH_SCOPE} AND status = 'RUNNING' AND "leaseExpiresAt" < now() AND attempts >= "maxAttempts"`);
}

export async function claimRefresh(workerId: string): Promise<ClaimedRefresh | null> {
  const cfg = uploadConfig();
  await failExhausted();
  const rows = await prisma.$queryRaw<{ generation: bigint; fence: number; leaseOwner: string; attempts: number; maxAttempts: number }[]>(Prisma.sql`
    UPDATE "RelationRefresh" r SET status = 'RUNNING', "leaseOwner" = ${workerId}, "leaseExpiresAt" = now() + (${cfg.leaseMs} * interval '1 millisecond'),
      fence = r.fence + 1, attempts = r.attempts + 1, "startedAt" = now(), progress = NULL, "updatedAt" = now()
    WHERE r.scope = ${REFRESH_SCOPE} AND r."requestedGeneration" > r."completedGeneration" AND r.attempts < r."maxAttempts"
      AND ((r.status = 'PENDING' AND r."runAfter" <= now()) OR (r.status = 'RUNNING' AND r."leaseExpiresAt" < now()))
    RETURNING r."requestedGeneration" AS generation, r.fence, r."leaseOwner", r.attempts, r."maxAttempts"`);
  const c = rows[0];
  return c ? { generation: num(c.generation), fence: c.fence, leaseOwner: c.leaseOwner, attempts: c.attempts, maxAttempts: c.maxAttempts } : null;
}

async function heartbeat(c: ClaimedRefresh): Promise<boolean> {
  const n = await prisma.$executeRaw(Prisma.sql`
    UPDATE "RelationRefresh" SET "leaseExpiresAt" = now() + (${uploadConfig().leaseMs} * interval '1 millisecond')
    WHERE scope = ${REFRESH_SCOPE} AND fence = ${c.fence} AND "leaseOwner" = ${c.leaseOwner} AND status = 'RUNNING'`);
  return n === 1;
}

/** El fencing se comprueba SIN bloquear la fila de estado (el progreso y los disparadores la actualizan desde otras conexiones). */
async function assertFence(tx: Prisma.TransactionClient, c: ClaimedRefresh): Promise<void> {
  const rows = await tx.$queryRaw<{ ok: boolean }[]>(Prisma.sql`
    SELECT true AS ok FROM "RelationRefresh" WHERE scope = ${REFRESH_SCOPE} AND fence = ${c.fence} AND "leaseOwner" = ${c.leaseOwner} AND status = 'RUNNING'`);
  if (rows.length === 0) throw new LostLeaseError();
  noteProgress("upload");
}

async function setProgress(c: ClaimedRefresh, phase: string, step: number, steps: number): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "RelationRefresh" SET progress = ${JSON.stringify({ phase, step, steps })}::jsonb, "updatedAt" = now()
    WHERE scope = ${REFRESH_SCOPE} AND fence = ${c.fence} AND "leaseOwner" = ${c.leaseOwner}`);
}

// ---------------------------------------------------------------- Ejecución

export type RefreshOutcome = { report: RelationReport; updated: Record<string, number> };

const PHASES = ["Tiempos Zendesk", "Tiempos Wrike", "PAP", "Vínculos de Work Items", "Atribución financiera", "Conciliación"] as const;

/** Recalcula TODO lo derivado (sin límite de lotes) dentro de la transacción del llamador, que ya tiene el bloqueo de derivación. */
export async function refreshAllDerived(tx: Prisma.TransactionClient, progress?: (phase: string, step: number) => Promise<void>): Promise<Record<string, number>> {
  const updated: Record<string, number> = {};
  const step = async (i: number) => progress?.(PHASES[i], i + 1);
  await step(0);
  updated.zendesk = await rederiveEntries(tx, Prisma.sql`true`, null, { keepBatch: true });
  await step(1);
  updated.wrike = await rederiveWrikeEntries(tx, Prisma.sql`true`, null, { keepBatch: true });
  await step(2);
  updated.pap = await rederivePapItems(tx, Prisma.sql`true`);
  await step(3);
  updated.vinculos = await rederiveWorkItemLinks(tx, Prisma.sql`true`);
  await step(4);
  // Cada lote financiero completado (activo o conservado como evidencia): solo atribución; importes, año y filtros no se tocan.
  const batches = await tx.$queryRaw<{ batchId: string; year: number }[]>(Prisma.sql`
    SELECT fb."batchId", fb.year FROM "FinanceBatch" fb JOIN "UploadBatch" b ON b.id = fb."batchId" WHERE b.status IN ('COMPLETED', 'REVERTED') ORDER BY fb."batchId"`);
  let finance = 0;
  const stamp = await financeMasterStamp(tx);
  for (const b of batches) {
    const n = await reresolveRows(tx, b.batchId, b.year);
    finance += n;
    await tx.$executeRaw(Prisma.sql`
      UPDATE "FinanceBatch" SET "derivedStamp" = ${stamp}, "derivedAt" = now(), "derivedVersion" = "derivedVersion" + ${n > 0 ? 1 : 0}
      WHERE "batchId" = ${b.batchId} AND ("derivedStamp" IS DISTINCT FROM ${stamp} OR ${n} > 0)`);
  }
  updated.finanzas = finance;
  return updated;
}

/** Ejecuta la generación reclamada. Una transacción atómica: o se publica todo con coherencia o no se publica nada. */
export async function runRefresh(c: ClaimedRefresh, shouldStop: () => boolean = () => false): Promise<RefreshOutcome> {
  const cfg = uploadConfig();
  const timeout = Number(process.env.CSAPP_RELATION_REFRESH_TIMEOUT_MS) > 0 ? Number(process.env.CSAPP_RELATION_REFRESH_TIMEOUT_MS) : 60 * 60_000;
  let lost = false;
  const timer = setInterval(() => {
    heartbeat(c).then((ok) => { if (!ok) lost = true; }).catch(() => undefined);
  }, cfg.heartbeatMs);
  try {
    return await prisma.$transaction(
      async (tx) => {
        await assertFence(tx, c);
        await lockDerivation(tx); // serializa con activaciones y reprocesos (mismo bloqueo que las derivaciones de carga)
        const before = await relationReport(tx);
        const updated = await refreshAllDerived(tx, async (phase, step) => {
          if (lost || shouldStop()) throw lost ? new LostLeaseError() : new Error("Trabajador detenido: la actualización se reintentará.");
          await assertFence(tx, c);
          await setProgress(c, phase, step, PHASES.length);
        });
        await setProgress(c, PHASES[5], 6, PHASES.length);
        const after = await relationReport(tx);
        assertConciliation(before, after);
        const report: RelationReport = { ...after, before: before.totals, updated, generation: c.generation, finishedAt: new Date().toISOString() };
        // Publica hasta SU generación; si durante el recálculo llegó otro cambio de maestros, queda PENDING y se ejecuta de nuevo.
        const n = await tx.$executeRaw(Prisma.sql`
          UPDATE "RelationRefresh" SET "completedGeneration" = GREATEST("completedGeneration", ${c.generation}::bigint),
            status = CASE WHEN "requestedGeneration" > ${c.generation}::bigint THEN 'PENDING' ELSE 'IDLE' END,
            "runAfter" = now(), "finishedAt" = now(), "leaseOwner" = NULL, "leaseExpiresAt" = NULL, attempts = 0, progress = NULL, "lastError" = NULL,
            "lastReport" = ${JSON.stringify(report)}::jsonb, "updatedAt" = now()
          WHERE scope = ${REFRESH_SCOPE} AND fence = ${c.fence} AND "leaseOwner" = ${c.leaseOwner} AND status = 'RUNNING'`);
        if (n !== 1) throw new LostLeaseError();
        return { report, updated };
      },
      { maxWait: 10_000, timeout },
    );
  } finally {
    clearInterval(timer);
  }
}

/** Registra un fallo: reintento con espera acotada o, agotados los intentos, FAILED visible (Administración ofrece «Actualizar relaciones»). */
export async function failRefresh(c: ClaimedRefresh, message: string, retryable = true): Promise<"retry" | "failed" | "lost"> {
  const cfg = uploadConfig();
  const safe = message.slice(0, 500);
  const wait = Math.min(cfg.backoffBaseMs * 2 ** (c.attempts - 1), 60_000);
  const retry = retryable && c.attempts < c.maxAttempts;
  const n = await prisma.$executeRaw(Prisma.sql`
    UPDATE "RelationRefresh" SET status = ${retry ? "PENDING" : "FAILED"}, "leaseOwner" = NULL, "leaseExpiresAt" = NULL, progress = NULL, "lastError" = ${safe},
      "runAfter" = now() + (${retry ? wait : 0} * interval '1 millisecond'), "finishedAt" = CASE WHEN ${retry} THEN "finishedAt" ELSE now() END, "updatedAt" = now()
    WHERE scope = ${REFRESH_SCOPE} AND fence = ${c.fence} AND "leaseOwner" = ${c.leaseOwner} AND status = 'RUNNING'`);
  return n === 0 ? "lost" : retry ? "retry" : "failed";
}

/** Devuelve la ejecución a la cola sin contar el intento (cierre ordenado del trabajador). */
export async function releaseRefresh(c: ClaimedRefresh): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "RelationRefresh" SET status = 'PENDING', attempts = GREATEST(attempts - 1, 0), "leaseOwner" = NULL, "leaseExpiresAt" = NULL, progress = NULL, "runAfter" = now()
    WHERE scope = ${REFRESH_SCOPE} AND fence = ${c.fence} AND "leaseOwner" = ${c.leaseOwner} AND status = 'RUNNING'`);
}

/** Reclama y ejecuta una actualización pendiente. Devuelve true si había alguna (con o sin éxito). */
export async function runRefreshOnce(workerId: string, shouldStop: () => boolean = () => false, log: (m: string) => void = () => {}): Promise<boolean> {
  const c = await claimRefresh(workerId);
  if (!c) return false;
  setActivity("upload", { kind: "RELATIONS", jobId: `relations-${c.fence}`, batchId: null });
  try {
    log(`Actualización de relaciones (generación ${c.generation}, intento ${c.attempts}/${c.maxAttempts})`);
    const out = await runRefresh(c, shouldStop);
    log(`Actualización de relaciones terminada: ${JSON.stringify(out.updated)}`);
  } catch (e) {
    if (e instanceof LostLeaseError) log("Actualización de relaciones perdida: otro trabajador la ha reclamado; no se escribe nada más.");
    else {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      const stopping = shouldStop();
      if (stopping) await releaseRefresh(c);
      else {
        const r = await failRefresh(c, msg, !(e instanceof NonRetryableError));
        log(`Actualización de relaciones con error (${r}): ${msg.split("\n")[0].slice(0, 200)}`);
      }
    }
  } finally {
    setActivity("upload", null);
  }
  return true;
}
