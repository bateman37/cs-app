import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { uploadConfig } from "./config";
import { runActivate, runRevert } from "./activate";
import { runPrepare } from "./prepare";
import {
  claimNextJob,
  failJob,
  heartbeat,
  LostLeaseError,
  NonRetryableError,
  ReleaseRequested,
  releaseJob,
  type ClaimedJob,
} from "./queue";
import { removePart } from "./storage";

type Log = (message: string) => void;

/** Ejecuta un trabajo reclamado con latido; traduce los fallos en reintento, fallo o liberación. */
export async function processJob(job: ClaimedJob, shouldStop: () => boolean, log: Log = () => {}): Promise<void> {
  const cfg = uploadConfig();
  let lost = false;
  const timer = setInterval(() => {
    heartbeat(job)
      .then((ok) => {
        if (!ok) lost = true;
      })
      .catch(() => undefined);
  }, cfg.heartbeatMs);
  const rt = { job, shouldStop: () => shouldStop() || lost };
  try {
    log(`Trabajo ${job.kind} del lote ${job.batchId} (intento ${job.attempts}/${job.maxAttempts})`);
    if (job.kind === "PREPARE") await runPrepare(rt);
    else if (job.kind === "ACTIVATE") await runActivate(rt);
    else await runRevert(rt);
    log(`Trabajo ${job.kind} del lote ${job.batchId} terminado`);
  } catch (e) {
    if (e instanceof LostLeaseError || lost) {
      log(`Trabajo ${job.id} perdido: otro trabajador lo ha reclamado; no se escribe nada más.`);
    } else if (e instanceof ReleaseRequested) {
      await releaseJob(job);
      log(`Trabajo ${job.id} devuelto a la cola por cierre ordenado.`);
    } else if (e instanceof NonRetryableError) {
      await failJob(job, e.message, false);
      log(`Trabajo ${job.id} fallido sin reintento: ${e.message}`);
    } else {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      const r = await failJob(job, msg);
      log(`Trabajo ${job.id} con error (${r}): ${msg.split("\n")[0].slice(0, 200)}`);
    }
  } finally {
    clearInterval(timer);
  }
}

/** Reclama y procesa un trabajo. Devuelve true si había alguno. */
export async function runOnce(workerId: string, shouldStop: () => boolean = () => false, log?: Log): Promise<boolean> {
  const job = await claimNextJob(workerId);
  if (!job) return false;
  await processJob(job, shouldStop, log);
  return true;
}

/** Mantenimiento: subidas incompletas caducadas pasan a REJECTED y se borra su fichero parcial. */
export async function maintenance(): Promise<number> {
  const cutoff = new Date(Date.now() - uploadConfig().incompleteMinutes * 60_000);
  const stale = await prisma.uploadBatch.findMany({
    where: { status: "RECEIVING", createdAt: { lt: cutoff } },
    select: { id: true, storageId: true },
    take: 100,
  });
  let n = 0;
  for (const b of stale) {
    const r = await prisma.uploadBatch.updateMany({
      where: { id: b.id, status: "RECEIVING" },
      data: { status: "REJECTED", statusDetail: "Subida incompleta: el archivo no llegó completo y no se ha procesado.", finishedAt: new Date() },
    });
    if (r.count > 0) {
      await removePart(b.storageId);
      n++;
    }
  }
  return n;
}

/** Bucle del trabajador: sondea la cola, procesa y se detiene al recibir la señal. */
export async function runWorkerLoop(opts: { workerId?: string; signal: AbortSignal; log?: Log }): Promise<void> {
  const workerId = opts.workerId ?? `trabajador-${process.pid}-${randomUUID().slice(0, 8)}`;
  const log = opts.log ?? (() => {});
  const cfg = uploadConfig();
  log(`Trabajador ${workerId} en marcha (sondeo ${cfg.pollMs} ms, lease ${cfg.leaseMs} ms).`);
  let lastMaintenance = 0;
  const stop = () => opts.signal.aborted;
  while (!stop()) {
    try {
      if (Date.now() - lastMaintenance > 30_000) {
        lastMaintenance = Date.now();
        const n = await maintenance();
        if (n > 0) log(`Mantenimiento: ${n} subida(s) incompleta(s) rechazada(s).`);
      }
      const worked = await runOnce(workerId, stop, log);
      if (worked) continue;
    } catch (e) {
      log(`Error del bucle: ${e instanceof Error ? e.message.split("\n")[0] : "desconocido"}`);
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, cfg.pollMs);
      opts.signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
    });
  }
  log("Trabajador detenido.");
}
