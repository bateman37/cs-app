import { createReadStream, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { confirmUpload, receiveUpload } from "@/server/uploads/batches";
import { batch, buildWorker, freshEnvironment, killAndWait, removeUploadDir, spawnWorker, useUploadDir, waitFor } from "./cargas-helpers";
import { writeLargeCsv } from "./synthetic/data";
import { syntheticRecords } from "./synthetic/schema";

/** Pruebas con el trabajador REAL (proceso hijo construido con scripts/build-worker.mjs). */
const ROWS = Number(process.env.CSAPP_TEST_RESTART_ROWS ?? 300_000);
const FAST = {
  CSAPP_WORKER_LEASE_MS: "2000",
  CSAPP_WORKER_HEARTBEAT_MS: "500",
  CSAPP_WORKER_POLL_MS: "200",
  CSAPP_WORKER_CHUNK_ROWS: "2000",
  CSAPP_WORKER_BACKOFF_MS: "100",
};

let dir: string;
let tmp: string;
let big: string;
let admin: { id: string };

beforeAll(async () => {
  dir = useUploadDir();
  tmp = mkdtempSync(path.join(tmpdir(), "csapp-big-"));
  big = path.join(tmp, "grande.csv");
  await writeLargeCsv(big, ROWS);
  buildWorker();
}, 120_000);
afterAll(() => {
  removeUploadDir(dir);
  rmSync(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
  admin = (await freshEnvironment()).admin;
});

async function uploadBig() {
  return receiveUpload(admin.id, {
    profileId: "sintetico-incorporar",
    originalName: "grande.csv",
    metadata: {},
    declared: {},
    contentLength: statSync(big).size,
    body: createReadStream(big),
  });
}

describe("Trabajador persistente real", () => {
  it("SIGKILL durante la preparación: al reiniciar retoma el mismo lote sin duplicados y termina; la activación también", async () => {
    const up = await uploadBig();
    const w1 = spawnWorker(FAST);
    try {
      await waitFor(async () => {
        const b = await batch(up.id);
        return b.status === "PREPARING" && b.rowsProcessed > 0 ? b : null;
      }, 60_000, 50);
    } finally {
      await killAndWait(w1, "SIGKILL");
    }
    const mid = await batch(up.id);
    expect(mid.status, "el trabajador terminó antes de poder interrumpirlo: aumente CSAPP_TEST_RESTART_ROWS").toBe("PREPARING");
    const staged = await prisma.uploadStagedRow.count({ where: { batchId: up.id } });
    expect(staged).toBe(mid.checkpointPosition); // checkpoint y staging coherentes (misma transacción)
    expect(staged).toBeGreaterThan(0);
    expect(staged).toBeLessThan(ROWS);

    const w2 = spawnWorker(FAST);
    try {
      await waitFor(async () => ((await batch(up.id)).status === "READY" ? true : null), 120_000);
    } finally {
      // se detiene luego, en el siguiente bloque
    }
    const ready = await batch(up.id);
    expect(ready).toMatchObject({ rowsReceived: ROWS, rowsValid: ROWS, rowsError: 0, rowsDuplicate: 0 });
    const distinct = await prisma.$queryRaw<{ n: bigint; d: bigint }[]>`
      SELECT count(*) AS n, count(DISTINCT position) AS d FROM "UploadStagedRow" WHERE "batchId" = ${up.id}`;
    expect(Number(distinct[0].n)).toBe(ROWS);
    expect(Number(distinct[0].d)).toBe(ROWS);
    const job = await prisma.uploadJob.findFirstOrThrow({ where: { batchId: up.id, kind: "PREPARE" } });
    expect(job).toMatchObject({ status: "DONE", attempts: 2 });
    expect(await syntheticRecords()).toHaveLength(0);

    // Activación por el trabajador reiniciado (el estado vive en la base, no en el proceso web).
    await confirmUpload(admin.id, up.id);
    await waitFor(async () => ((await batch(up.id)).status === "COMPLETED" ? true : null), 120_000);
    const n = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM csapp_synthetic.record`);
    expect(Number(n[0].n)).toBe(ROWS);
    expect((await batch(up.id)).rowsImported).toBe(ROWS);

    // Cierre ordenado: SIGTERM termina con código 0.
    const code = await new Promise<number | null>((resolve) => {
      w2.once("exit", (c) => resolve(c));
      w2.kill("SIGTERM");
    });
    expect(code).toBe(0);
  }, 300_000);

  it("SIGTERM durante la preparación devuelve el trabajo a la cola conservando el checkpoint", async () => {
    const up = await uploadBig();
    const w1 = spawnWorker(FAST);
    await waitFor(async () => {
      const b = await batch(up.id);
      return b.status === "PREPARING" && b.rowsProcessed > 0 ? b : null;
    }, 60_000, 50);
    await new Promise<void>((resolve) => {
      w1.once("exit", () => resolve());
      w1.kill("SIGTERM");
    });
    const b = await batch(up.id);
    const job = await prisma.uploadJob.findFirstOrThrow({ where: { batchId: up.id } });
    expect(b.status).toBe("PREPARING");
    expect(job.status).toBe("PENDING"); // liberado, sin esperar al vencimiento del lease
    expect(job.attempts).toBe(0); // un cierre ordenado no consume intentos
    expect(b.checkpointPosition).toBeGreaterThan(0);
    const w2 = spawnWorker(FAST);
    try {
      await waitFor(async () => ((await batch(up.id)).status === "READY" ? true : null), 120_000);
    } finally {
      await killAndWait(w2, "SIGTERM");
    }
    expect((await batch(up.id)).rowsReceived).toBe(ROWS);
    expect(await prisma.uploadStagedRow.count({ where: { batchId: up.id } })).toBe(ROWS);
  }, 300_000);

  it("dos trabajadores reales sobre la misma cola activan una sola vez", async () => {
    const small = path.join(tmp, "pequeno.csv");
    await writeLargeCsv(small, 2000);
    const up = await receiveUpload(admin.id, {
      profileId: "sintetico-incorporar", originalName: "p.csv", metadata: {}, declared: {}, contentLength: null, body: createReadStream(small),
    });
    const a = spawnWorker(FAST);
    const b = spawnWorker(FAST);
    try {
      await waitFor(async () => ((await batch(up.id)).status === "READY" ? true : null), 60_000);
      await confirmUpload(admin.id, up.id);
      await waitFor(async () => ((await batch(up.id)).status === "COMPLETED" ? true : null), 60_000);
      expect(await syntheticRecords()).toHaveLength(2000);
      expect(await prisma.uploadRecordSource.count({ where: { batchId: up.id } })).toBe(2000);
      expect(await prisma.uploadJob.count({ where: { batchId: up.id, status: "DONE" } })).toBe(2);
    } finally {
      await Promise.all([killAndWait(a, "SIGTERM"), killAndWait(b, "SIGTERM")]);
    }
  }, 120_000);
});
