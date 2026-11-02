import { hostname } from "node:os";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { buildInfo } from "@/lib/runtime";

/**
 * Latido por trabajador (CSAPP-10 §4). Cada proceso registra su instancia y la refresca AUNQUE no haya trabajos: la presencia deja de inferirse de los
 * trabajos recientes. El avance observable del trabajo en curso (último bloque confirmado) se anota en memoria desde `assertFence`/`assertExportFence`
 * y se publica en el siguiente latido: así se distingue «presente pero sin avanzar». Solo escribe en `WorkerInstance`; nunca decide el estado de un lote.
 */
/** Un proceso ejecuta dos bucles (cargas y exportaciones): cada uno ocupa su ranura. El avance publicado es el MÁS ANTIGUO de las ranuras activas. */
type Slot = { kind: string; jobId: string; batchId: string | null; progressAt: Date };
const slots = new Map<string, Slot>();

export function setActivity(slot: "upload" | "export", a: { kind: string; jobId: string; batchId?: string | null } | null): void {
  if (!a) { slots.delete(slot); return; }
  slots.set(slot, { kind: `${slot}:${a.kind}`, jobId: a.jobId, batchId: a.batchId ?? null, progressAt: new Date() });
}
/** Avance real (un bloque confirmado) de la ranura. Barato: solo memoria. */
export function noteProgress(slot: "upload" | "export"): void { const s = slots.get(slot); if (s) s.progressAt = new Date(); }
export function currentActivity(): { kind: string | null; jobId: string | null; batchId: string | null; progressAt: Date | null } {
  const act = [...slots.values()];
  if (act.length === 0) return { kind: null, jobId: null, batchId: null, progressAt: null };
  const oldest = act.reduce((m, x) => (x.progressAt < m.progressAt ? x : m));
  return { kind: act.map((x) => x.kind).join("+"), jobId: act.map((x) => x.jobId).join("+").slice(0, 200), batchId: oldest.batchId, progressAt: oldest.progressAt };
}

export type WorkerStateName = "IDLE" | "BUSY" | "STOPPING" | "STOPPED";

export async function registerWorker(id: string, now = new Date()): Promise<void> {
  const b = buildInfo();
  await prisma.workerInstance.upsert({
    where: { id },
    create: { id, pid: process.pid, host: hostname().slice(0, 100), version: b.version, sha: b.sha, state: "IDLE", startedAt: now, lastSeenAt: now },
    update: { pid: process.pid, host: hostname().slice(0, 100), version: b.version, sha: b.sha, state: "IDLE", startedAt: now, lastSeenAt: now, stoppedAt: null, stopRequestedAt: null },
  });
}

/** Un latido: estado según haya o no trabajo, y lectura de la petición de cierre (multiplataforma). Devuelve true si se pidió detener. */
export async function beat(id: string, stopping: boolean): Promise<{ stopRequested: boolean }> {
  const a = currentActivity();
  const state: WorkerStateName = stopping ? "STOPPING" : a.kind ? "BUSY" : "IDLE";
  const rows = await prisma.$queryRaw<{ stopRequestedAt: Date | null }[]>(Prisma.sql`
    UPDATE "WorkerInstance" SET "lastSeenAt" = now(), state = ${state}::"WorkerState", "currentKind" = ${a.kind}, "currentJobId" = ${a.jobId},
      "currentBatchId" = ${a.batchId}, "progressAt" = ${a.progressAt}
    WHERE id = ${id} RETURNING "stopRequestedAt"`);
  return { stopRequested: !!rows[0]?.stopRequestedAt };
}

export async function markStopped(id: string): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "WorkerInstance" SET state = 'STOPPED'::"WorkerState", "stoppedAt" = now(), "lastSeenAt" = now(), "currentKind" = NULL, "currentJobId" = NULL, "currentBatchId" = NULL, "progressAt" = NULL WHERE id = ${id}`);
}

/** Solicita el cierre ordenado de uno o de todos los trabajadores vivos. Devuelve las instancias afectadas. */
export async function requestWorkerStop(id?: string): Promise<number> {
  return prisma.$executeRaw(Prisma.sql`
    UPDATE "WorkerInstance" SET "stopRequestedAt" = now() WHERE state <> 'STOPPED' AND "stopRequestedAt" IS NULL ${id ? Prisma.sql`AND id = ${id}` : Prisma.empty}`);
}

/**
 * Bucle de latido independiente de los trabajos. Un fallo de base de datos NO detiene el proceso: se reintenta en el siguiente latido (la base puede volver).
 * `onStopRequested` se invoca una vez cuando la base pide el cierre.
 */
export function startHeartbeat(opts: { id: string; intervalMs: number; isStopping: () => boolean; onStopRequested: () => void; log?: (level: "INFO" | "WARN", m: string) => void }): () => void {
  let requested = false;
  let down = false;
  const tick = async () => {
    try {
      const r = await beat(opts.id, opts.isStopping());
      if (down) { down = false; opts.log?.("INFO", "Base de datos recuperada: el latido se reanuda."); }
      if (r.stopRequested && !requested) { requested = true; opts.onStopRequested(); }
    } catch (e) {
      if (!down) { down = true; opts.log?.("WARN", `El latido no pudo escribirse (${e instanceof Error ? e.message.split("\n")[0].slice(0, 120) : "error"}); se reintenta.`); }
    }
  };
  const timer = setInterval(() => void tick(), opts.intervalMs);
  timer.unref?.();
  void tick();
  return () => clearInterval(timer);
}
