import { createReadStream, mkdtempSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { receiveUpload } from "@/server/uploads/batches";
import { batch, buildWorker, freshEnvironment, killAndWait, reapOwnWorkers, removeUploadDir, spawnWorker, useUploadDir, waitFor } from "./cargas-helpers";
import { writeLargeCsv } from "./synthetic/data";

/**
 * CSAPP-10 §4 con el trabajador COMPILADO y PostgreSQL real: pérdida temporal de la base (sesiones terminadas con pg_terminate_backend, solo las del propio trabajador),
 * almacén de originales no accesible, parada con trabajo en curso (cierre ordenado: el trabajo vuelve a la cola sin completarse) y plazo de cierre agotado (código 3 sin
 * marcar nada como completado). En todos los casos: reintentos acotados, error identificable, recuperación SIN duplicados y sin activación parcial.
 */
const ROWS = Number(process.env.CSAPP_TEST_OPS_ROWS ?? 60_000);
const APP = "csapp10-wk";
const FAST = { CSAPP_WORKER_LEASE_MS: "2000", CSAPP_WORKER_HEARTBEAT_MS: "300", CSAPP_WORKER_POLL_MS: "150", CSAPP_WORKER_CHUNK_ROWS: "1500", CSAPP_WORKER_BACKOFF_MS: "100", PGAPPNAME: APP };
let dir: string, tmp: string, big: string;
let admin: { id: string };
beforeAll(async () => { dir = useUploadDir(); tmp = mkdtempSync(path.join(tmpdir(), "csapp10-ops-")); big = path.join(tmp, "grande.csv"); await writeLargeCsv(big, ROWS); buildWorker(); }, 120_000);
afterEach(async () => { await reapOwnWorkers(); });
afterAll(async () => { await reapOwnWorkers(); removeUploadDir(dir); rmSync(tmp, { recursive: true, force: true }); });
beforeEach(async () => { admin = (await freshEnvironment()).admin; await prisma.workerInstance.deleteMany(); });

const upload = () => receiveUpload(admin.id, { profileId: "sintetico-incorporar", originalName: "grande.csv", metadata: {}, declared: {}, contentLength: statSync(big).size, body: createReadStream(big) });
const staged = (id: string) => prisma.uploadStagedRow.count({ where: { batchId: id } });
const exited = (c: { exitCode: number | null; signalCode: NodeJS.Signals | null }) => c.exitCode !== null || c.signalCode !== null;
const waitExit = (c: { once: (e: "exit", cb: (code: number | null) => void) => unknown; exitCode: number | null; signalCode: NodeJS.Signals | null }, ms: number) => new Promise<number | null>((res) => { if (exited(c)) return res(c.exitCode); const t = setTimeout(() => res(-999), ms); c.once("exit", (code) => { clearTimeout(t); res(code); }); });

describe("operación con el trabajador real", () => {
  it("pérdida temporal de la base: el trabajador sobrevive, se identifica el error, el latido se reanuda y el lote termina sin duplicados", async () => {
    const up = await upload();
    const w = spawnWorker(FAST);
    await waitFor(async () => { const b = await batch(up.id); return b.status === "PREPARING" && b.rowsProcessed > 0 ? b : null; }, 60_000, 30);
    const before = await prisma.workerInstance.findFirstOrThrow();
    // Se terminan SOLO las sesiones de la base de ESTE trabajador (application_name propio); la conexión de la prueba no se toca.
    const killed = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM (SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = '${APP}' AND datname = current_database()) t`);
    expect(Number(killed[0].n)).toBeGreaterThan(0);
    const done = await waitFor(async () => { const b = await batch(up.id); return b.status === "READY" ? b : null; }, 120_000, 100);
    expect(exited(w), "el trabajador debe seguir vivo tras perder sus conexiones").toBe(false);
    expect(done.rowsReceived).toBe(ROWS);
    expect(await staged(up.id)).toBe(ROWS); // ni una fila duplicada ni perdida
    const after = await prisma.workerInstance.findFirstOrThrow();
    expect(after.lastSeenAt.getTime()).toBeGreaterThan(before.lastSeenAt.getTime()); // el latido se reanudó
    expect(w.output.join("")).toMatch(/(Error del bucle|con error \(|El latido no pudo escribirse|Trabajo .* perdido|terminated|Connection|conexión)/i); // error identificable en el registro
    await killAndWait(w, "SIGTERM");
  }, 240_000);

  it("almacén de originales no accesible: error identificable con reintentos acotados; al recuperarlo el lote termina una sola vez", async () => {
    const up = await upload();
    const files = path.join(dir, "files");
    const away = path.join(dir, "files.fuera");
    renameSync(files, away); // el almacén desaparece (como un volumen desmontado)
    const w = spawnWorker({ ...FAST, CSAPP_WORKER_MAX_ATTEMPTS: "50" });
    const job = await waitFor(async () => { const j = await prisma.uploadJob.findFirst({ where: { batchId: up.id } }); return j && j.lastError ? j : null; }, 60_000, 100);
    expect(job.lastError!.length).toBeGreaterThan(5); // error identificable guardado en el trabajo
    expect(exited(w)).toBe(false);
    expect(job.attempts).toBeLessThanOrEqual(50); // reintentos acotados
    expect((await batch(up.id)).status).not.toBe("READY");
    renameSync(away, files); // vuelve el volumen
    const done = await waitFor(async () => { const b = await batch(up.id); return b.status === "READY" ? b : null; }, 120_000, 100);
    expect(done.rowsReceived).toBe(ROWS);
    expect(await staged(up.id)).toBe(ROWS);
    await killAndWait(w, "SIGTERM");
  }, 240_000);

  it("parada con trabajo en curso: cierre ordenado (código 0), el trabajo vuelve a la cola SIN completarse, el estado queda DETENIDO y otro trabajador lo termina sin duplicar", async () => {
    const up = await upload();
    const w = spawnWorker(FAST);
    await waitFor(async () => { const b = await batch(up.id); return b.status === "PREPARING" && b.rowsProcessed > 0 ? b : null; }, 60_000, 30);
    w.kill("SIGTERM");
    expect(await waitExit(w, 60_000)).toBe(0);
    const mid = await batch(up.id);
    expect(["QUEUED", "PREPARING"]).toContain(mid.status); // NO listo por haber recibido una señal de parada
    expect(await staged(up.id)).toBe(mid.checkpointPosition); // checkpoint y staging coherentes
    expect((await prisma.workerInstance.findFirstOrThrow()).state).toBe("STOPPED");
    const w2 = spawnWorker(FAST);
    const done = await waitFor(async () => { const b = await batch(up.id); return b.status === "READY" ? b : null; }, 120_000, 100);
    expect(done.rowsReceived).toBe(ROWS);
    expect(await staged(up.id)).toBe(ROWS);
    await killAndWait(w2, "SIGTERM");
  }, 240_000);

  it("plazo de cierre agotado: sale con código 3 sin marcar el lote como listo; otro trabajador lo reanuda tras caducar el lease", async () => {
    const up = await upload();
    const w = spawnWorker({ ...FAST, CSAPP_WORKER_STOP_TIMEOUT_MS: "1" });
    await waitFor(async () => { const b = await batch(up.id); return b.status === "PREPARING" && b.rowsProcessed > 0 ? b : null; }, 60_000, 30);
    w.kill("SIGTERM");
    const code = await waitExit(w, 60_000);
    expect([3, 0]).toContain(code); // 3 si el trabajo no alcanzó la frontera en 1 ms; 0 si ya estaba en ella
    const mid = await batch(up.id);
    expect(mid.status).not.toBe("READY");
    expect(mid.status).not.toBe("COMPLETED");
    const w2 = spawnWorker(FAST);
    const done = await waitFor(async () => { const b = await batch(up.id); return b.status === "READY" ? b : null; }, 120_000, 100);
    expect(done.rowsReceived).toBe(ROWS);
    expect(await staged(up.id)).toBe(ROWS);
    await killAndWait(w2, "SIGTERM");
  }, 240_000);
});
