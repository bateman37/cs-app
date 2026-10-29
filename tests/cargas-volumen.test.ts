import { createReadStream, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { confirmUpload, listUploads, receiveUpload } from "@/server/uploads/batches";
import { batch, buildWorker, freshEnvironment, killAndWait, removeUploadDir, spawnWorker, useUploadDir, waitFor } from "./cargas-helpers";
import { writeLargeCsv } from "./synthetic/data";

/**
 * Volumen: archivo CSV sintético grande generado en streaming (fuera de Git) y procesado por el
 * trabajador REAL. Mide filas, duración y pico de memoria (VmHWM de /proc, solo Linux) y comprueba
 * que las lecturas siguen respondiendo mientras se prepara.
 */
const ROWS = Number(process.env.CSAPP_TEST_VOLUME_ROWS ?? 1_000_000);

let dir: string;
let tmp: string;

beforeAll(() => {
  dir = useUploadDir();
  tmp = mkdtempSync(path.join(tmpdir(), "csapp-vol-"));
  buildWorker();
});
afterAll(() => {
  removeUploadDir(dir);
  rmSync(tmp, { recursive: true, force: true });
});

function peakRssMb(pid: number | undefined): number | null {
  if (!pid) return null;
  try {
    const m = /VmHWM:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
    return m ? Math.round(Number(m[1]) / 1024) : null;
  } catch {
    return null;
  }
}

describe("Volumen", () => {
  it(`procesa ${ROWS} filas con el trabajador real manteniendo la navegación disponible`, async () => {
    const { admin } = await freshEnvironment();
    const file = path.join(tmp, "volumen.csv");
    const tGen = Date.now();
    await writeLargeCsv(file, ROWS);
    const size = statSync(file).size;
    const genMs = Date.now() - tGen;

    const tUp = Date.now();
    const up = await receiveUpload(admin.id, {
      profileId: "sintetico-incorporar", originalName: "volumen.csv", metadata: {}, declared: {}, contentLength: size, body: createReadStream(file),
    });
    const uploadMs = Date.now() - tUp;

    const worker = spawnWorker({ CSAPP_WORKER_POLL_MS: "200", NODE_OPTIONS: process.env.CSAPP_TEST_WORKER_NODE_OPTIONS ?? "--max-old-space-size=384" });
    let peak = 0;
    const latencies: number[] = [];
    const t0 = Date.now();
    let prepareMs = 0;
    let activateMs = 0;
    let peakAfterPrepare: number | null = null;
    try {
      await waitFor(async () => {
        const t = Date.now();
        await listUploads(admin.id, { pageSize: 5 });
        await prisma.user.count();
        latencies.push(Date.now() - t);
        peak = Math.max(peak, peakRssMb(worker.pid) ?? 0);
        return (await batch(up.id)).status === "READY" ? true : null;
      }, 20 * 60_000, 250);
      prepareMs = Date.now() - t0;
      peakAfterPrepare = peak;
      const ready = await batch(up.id);
      expect(ready).toMatchObject({ rowsReceived: ROWS, rowsValid: ROWS, rowsError: 0 });
      const t1 = Date.now();
      await confirmUpload(admin.id, up.id);
      await waitFor(async () => {
        peak = Math.max(peak, peakRssMb(worker.pid) ?? 0);
        return (await batch(up.id)).status === "COMPLETED" ? true : null;
      }, 20 * 60_000, 500);
      activateMs = Date.now() - t1;
    } finally {
      await killAndWait(worker, "SIGTERM");
    }
    const done = await batch(up.id);
    expect(done.rowsImported).toBe(ROWS);
    const n = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM csapp_synthetic.record`);
    expect(Number(n[0].n)).toBe(ROWS);
    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
    const measures = {
      filas: ROWS,
      archivoMB: Math.round(size / 1048576),
      generacionSegundos: Math.round(genMs / 1000),
      subidaSegundos: Math.round(uploadMs / 100) / 10,
      preparacionSegundos: Math.round(prepareMs / 100) / 10,
      filasPorSegundoPreparacion: Math.round(ROWS / (prepareMs / 1000)),
      activacionSegundos: Math.round(activateMs / 100) / 10,
      picoRssTrabajadorMB: peak || null,
      picoRssTrabajadorTrasPrepararMB: peakAfterPrepare,
      lecturasDuranteLaPreparacion: latencies.length,
      latenciaLecturaP95ms: p95,
      latenciaLecturaMaxMs: latencies[latencies.length - 1] ?? 0,
    };
    console.log(`MEDIDAS_VOLUMEN ${JSON.stringify(measures)}`);
    writeFileSync(process.env.CSAPP_TEST_MEASURES_FILE ?? path.join(tmpdir(), "csapp-medidas-volumen.json"), JSON.stringify(measures, null, 2));
    expect(latencies.length).toBeGreaterThan(3); // la navegación respondió durante la preparación
    expect(p95).toBeLessThan(3000);
  }, 60 * 60_000);
});
