import "dotenv/config";
import { randomUUID } from "node:crypto";
import { getEnv } from "../src/lib/env";
import { prisma } from "../src/lib/db";
import { buildInfo } from "../src/lib/runtime";
import { uploadConfig } from "../src/server/uploads/config";
import { exportConfig } from "../src/server/exports/config";
import { runWorkerLoop } from "../src/server/uploads/worker";
import { runExportLoop } from "../src/server/exports/run";
import { assertStartup } from "../src/server/ops/startup";
import { markStopped, registerWorker, startHeartbeat } from "../src/server/ops/worker-instance";

/**
 * Trabajador compilado (CSAPP-10 §3-4): proceso separado de la web que consume la cola de PostgreSQL con la MISMA configuración efectiva
 * (mismo .env, base y almacenes). Registra su instancia y emite un latido en reposo y procesando. Cierre ordenado con SIGINT/SIGTERM o, de forma
 * multiplataforma, cuando `npm run ops -- parar` lo pide en la base: termina o devuelve el trabajo en una frontera segura, con un tiempo máximo
 * (CSAPP_WORKER_STOP_TIMEOUT_MS, 120 s). Si ese plazo se agota sale con código 3 SIN marcar nada como completado: el lease caduca y otro trabajador reanuda.
 */
const instanceId = process.env.CSAPP_WORKER_ID || `trabajador-${process.pid}-${randomUUID().slice(0, 8)}`;
type Level = "INFO" | "WARN" | "ERROR";
const logAt = (level: Level, m: string) => (level === "ERROR" ? console.error : console.log)(`${new Date().toISOString()} ${level} ${instanceId} ${m}`);
const levelOf = (m: string): Level => (/^(Error|El latido|Trabajo perdido|Exportación .* (perdida|con error|fallida))/.test(m) || /con error \(/.test(m) ? "WARN" : "INFO");
const log = (m: string) => logAt(levelOf(m), m);

async function main() {
  getEnv(); // valida la configuración sin mostrar valores
  await assertStartup("worker", logAt);
  const b = buildInfo();
  const cfg = uploadConfig();
  log(`Versión ${b.version} (${b.sha.slice(0, 12)}${b.known ? "" : ", build-info.json ausente"}). Almacén de originales: ${cfg.dir}; exportaciones: ${exportConfig().dir}`);
  const controller = new AbortController();
  const stopTimeoutMs = Number(process.env.CSAPP_WORKER_STOP_TIMEOUT_MS) > 0 ? Number(process.env.CSAPP_WORKER_STOP_TIMEOUT_MS) : 120_000;
  let stopTimer: NodeJS.Timeout | undefined;
  let forced = false;
  const stop = (why: string) => {
    if (controller.signal.aborted) return;
    log(`${why}: finalizando de forma ordenada (máximo ${Math.round(stopTimeoutMs / 1000)} s; el trabajo en curso termina o vuelve a la cola en una frontera segura)…`);
    controller.abort();
    stopTimer = setTimeout(() => {
      forced = true;
      logAt("ERROR", `El trabajo en curso no terminó en ${Math.round(stopTimeoutMs / 1000)} s: se sale SIN marcarlo como completado; su lease caducará y otro trabajador lo reanudará sin duplicar.`);
      void markStopped(instanceId).catch(() => undefined).finally(() => process.exit(3));
    }, stopTimeoutMs);
  };
  process.on("SIGINT", () => stop("Señal de parada recibida"));
  process.on("SIGTERM", () => stop("Señal de parada recibida"));
  await registerWorker(instanceId);
  const stopHeartbeat = startHeartbeat({ id: instanceId, intervalMs: cfg.heartbeatMs, isStopping: () => controller.signal.aborted, onStopRequested: () => stop("Parada solicitada por «ops parar»"), log: (l, m) => logAt(l, m) });
  log(`Trabajador ${instanceId} en marcha (latido cada ${cfg.heartbeatMs} ms).`);
  // Dos bucles independientes en el mismo proceso: una exportación grande no bloquea las cargas ni al revés.
  await Promise.all([runWorkerLoop({ workerId: instanceId, signal: controller.signal, log }), runExportLoop({ workerId: instanceId, signal: controller.signal, log: (m) => log(`[exportaciones] ${m}`) })]);
  if (stopTimer) clearTimeout(stopTimer);
  stopHeartbeat();
  if (!forced) await markStopped(instanceId).catch(() => undefined);
  await prisma.$disconnect();
  log("Trabajador detenido.");
}

main().catch((e: unknown) => {
  logAt("ERROR", `El trabajador terminó con error: ${e instanceof Error ? e.message.split("\n")[0].replace(/postgres(ql)?:\/\/\S+/g, "(URL oculta)") : "desconocido"}`);
  process.exitCode = 1;
});
