import { mkdtempSync, readFileSync, rmSync, statSync, createReadStream, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import yauzl from "yauzl";
import { prisma } from "@/lib/db";
import { confirmUpload, listUploads, receiveUpload } from "@/server/uploads/batches";
import { uploadConfig } from "@/server/uploads/config";
import { batch, buildWorker, freshEnvironment, killAndWait, removeUploadDir, spawnWorker, useUploadDir, waitFor } from "./cargas-helpers";
import { seedVolumeMasters, volumeTickets, volumeTimes, writeTickets, writeTimes } from "./generators/zendesk";
import { timesSummary, ticketsSummary } from "@/server/zendesk/summary";
import { TICKETS, TIEMPO } from "./zendesk-helpers";

/**
 * Volumen y recuperación de los importadores operativos con XLSX sintético generado en streaming (fuera de Git) y el
 * trabajador REAL. Tamaños del origen: ≈114 000 tickets y ≈250 000 tiempos. Mide filas, bytes, tiempos de recepción,
 * preparación y activación y pico de memoria (VmHWM de /proc, solo Linux). `npm run test:largo` lo incluye.
 */
const TICKETS_N = Number(process.env.CSAPP_TEST_ZD_TICKETS ?? 114_000);
const TIMES_N = Number(process.env.CSAPP_TEST_ZD_TIMES ?? 250_000);
const RESTART_N = Number(process.env.CSAPP_TEST_ZD_RESTART_ROWS ?? 80_000);
const FAST = { CSAPP_WORKER_LEASE_MS: "2000", CSAPP_WORKER_HEARTBEAT_MS: "500", CSAPP_WORKER_POLL_MS: "200", CSAPP_WORKER_BACKOFF_MS: "100" };

let dir: string;
let tmp: string;
let admin: { id: string };
beforeAll(() => {
  dir = useUploadDir();
  tmp = mkdtempSync(path.join(tmpdir(), "csapp-zdvol-"));
  buildWorker();
});
afterAll(() => {
  removeUploadDir(dir);
  rmSync(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
  admin = (await freshEnvironment()).admin;
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

/** Suma de los bytes descomprimidos declarados por el contenedor ZIP del libro. */
function uncompressedBytes(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      let total = 0;
      zip.on("entry", (e) => {
        total += e.uncompressedSize;
        zip.readEntry();
      });
      zip.on("end", () => resolve(total));
      zip.readEntry();
    });
  });
}

const seedMasters = () => seedVolumeMasters(prisma);

async function runVolume(profileId: string, file: string, expectRows: number, label: string) {
  const size = statSync(file).size;
  const tUp = Date.now();
  const up = await receiveUpload(admin.id, { profileId, originalName: `${label}.xlsx`, metadata: {}, declared: { extraccion: "2026-10-01" }, contentLength: size, body: createReadStream(file) });
  const uploadMs = Date.now() - tUp;
  const worker = spawnWorker({ CSAPP_WORKER_POLL_MS: "200", NODE_OPTIONS: "--max-old-space-size=512" });
  let peak = 0;
  const latencies: number[] = [];
  const t0 = Date.now();
  let prepareMs = 0;
  let activateMs = 0;
  try {
    await waitFor(async () => {
      peak = Math.max(peak, peakRssMb(worker.pid) ?? 0);
      // La navegación sigue respondiendo mientras el trabajador prepara.
      const t = Date.now();
      await listUploads(admin.id, { pageSize: 5 });
      latencies.push(Date.now() - t);
      return (await batch(up.id)).status === "READY" ? true : null;
    }, 30 * 60_000, 500);
    prepareMs = Date.now() - t0;
    const ready = await batch(up.id);
    expect(ready).toMatchObject({ rowsReceived: expectRows, rowsError: 0 });
    const t1 = Date.now();
    await confirmUpload(admin.id, up.id);
    await waitFor(async () => {
      peak = Math.max(peak, peakRssMb(worker.pid) ?? 0);
      const b = await batch(up.id);
      if (b.status === "FAILED") throw new Error(b.statusDetail ?? "FAILED");
      return b.status === "COMPLETED" ? true : null;
    }, 30 * 60_000, 500);
    activateMs = Date.now() - t1;
  } finally {
    await killAndWait(worker, "SIGTERM");
  }
  const done = await batch(up.id);
  latencies.sort((a, b) => a - b);
  const cfg = uploadConfig();
  const measures = {
    fuente: profileId,
    filas: expectRows,
    archivoComprimidoMB: Math.round((size / 1048576) * 10) / 10,
    archivoDescomprimidoMB: Math.round(((await uncompressedBytes(file)) / 1048576) * 10) / 10,
    limites: { maxBytesMB: Math.round(cfg.maxBytes / 1048576), maxDescomprimidoMB: Math.round(cfg.maxUncompressedBytes / 1048576), maxRelacion: cfg.maxRatio, maxFilas: cfg.maxRows },
    lecturasDuranteLaPreparacion: latencies.length,
    latenciaLecturaP95ms: latencies[Math.floor(latencies.length * 0.95)] ?? 0,
    recepcionSegundos: Math.round(uploadMs / 100) / 10,
    preparacionSegundos: Math.round(prepareMs / 100) / 10,
    filasPorSegundoPreparacion: Math.round(expectRows / (prepareMs / 1000)),
    activacionSegundos: Math.round(activateMs / 100) / 10,
    picoRssTrabajadorMB: peak || null,
  };
  console.log(`MEDIDAS_ZENDESK ${JSON.stringify(measures)}`);
  return { up, done, measures };
}

describe("Volumen de los importadores Zendesk", () => {
  it(`importa ${TICKETS_N} tickets y ${TIMES_N} tiempos por el motor completo con XLSX y reconcilia`, async () => {
    await seedMasters();
    const f1 = path.join(tmp, "tickets.xlsx");
    const tg = Date.now();
    await writeTickets(f1, volumeTickets(TICKETS_N));
    const genTickets = Date.now() - tg;
    const t = await runVolume(TICKETS, f1, TICKETS_N, "tickets");
    expect(t.done.status).toBe("COMPLETED");
    expect(await prisma.zdTicket.count()).toBe(TICKETS_N);
    const ts = await ticketsSummary(admin.id, t.up.id);
    expect(ts).toMatchObject({ distinctTickets: TICKETS_N, newTickets: TICKETS_N, revised: 0 });

    const f2 = path.join(tmp, "tiempos.xlsx");
    const tg2 = Date.now();
    await writeTimes(f2, volumeTimes(TIMES_N, { tickets: TICKETS_N }));
    const genTimes = Date.now() - tg2;
    const m = await runVolume(TIEMPO, f2, TIMES_N, "tiempos");
    expect(m.done.status).toBe("COMPLETED");
    expect(await prisma.zdTimeEntry.count()).toBe(TIMES_N);
    const s = await timesSummary(admin.id, m.up.id);
    expect(s?.reconciled).toBe(true);
    expect(s?.validRows).toBe(TIMES_N);
    expect(s?.partitionRows).toBe(TIMES_N);
    const buckets = Object.fromEntries(s!.buckets.filter((b) => b.rows).map((b) => [b.bucket, b.rows]));
    expect(buckets.ATTRIBUTABLE).toBeGreaterThan(0);
    // Repetir el mismo archivo no duplica nada: todas las filas son duplicados de un lote ya importado.
    const again = await runVolume(TIEMPO, f2, TIMES_N, "tiempos-repetido");
    expect(again.done.rowsImported).toBe(0);
    expect(await prisma.zdTimeEntry.count()).toBe(TIMES_N);
    const out = { tickets: t.measures, tiempos: m.measures, tiemposRepetidos: again.measures, generacionTicketsSegundos: Math.round(genTickets / 1000), generacionTiemposSegundos: Math.round(genTimes / 1000), buckets };
    writeFileSync(process.env.CSAPP_TEST_ZD_MEASURES_FILE ?? path.join(tmpdir(), "csapp-medidas-zendesk.json"), JSON.stringify(out, null, 2));
  }, 90 * 60_000);

  it("SIGKILL durante la preparación y durante la activación de tiempos: se retoma sin duplicados ni activación parcial", async () => {
    await seedMasters();
    const f = path.join(tmp, "reinicio.xlsx");
    await writeTimes(f, volumeTimes(RESTART_N, { tickets: 2000 }));
    const up = await receiveUpload(admin.id, { profileId: TIEMPO, originalName: "reinicio.xlsx", metadata: {}, declared: {}, contentLength: statSync(f).size, body: createReadStream(f) });
    const w1 = spawnWorker({ ...FAST, CSAPP_WORKER_CHUNK_ROWS: "2000" });
    try {
      await waitFor(async () => {
        const b = await batch(up.id);
        return b.status === "PREPARING" && b.rowsProcessed > 0 ? b : null;
      }, 120_000, 50);
    } finally {
      await killAndWait(w1, "SIGKILL");
    }
    const mid = await batch(up.id);
    expect(mid.status, "terminó antes de poder interrumpirlo: aumente CSAPP_TEST_ZD_RESTART_ROWS").toBe("PREPARING");
    const staged = await prisma.uploadStagedRow.count({ where: { batchId: up.id } });
    expect(staged).toBe(mid.checkpointPosition);
    expect(staged).toBeLessThan(RESTART_N);
    const w2 = spawnWorker({ ...FAST, CSAPP_WORKER_CHUNK_ROWS: "2000" });
    try {
      await waitFor(async () => ((await batch(up.id)).status === "READY" ? true : null), 300_000, 200);
    } finally {
      await killAndWait(w2, "SIGKILL");
    }
    const ready = await batch(up.id);
    expect(ready.rowsReceived).toBe(RESTART_N);
    const distinct = await prisma.$queryRaw<{ n: bigint; d: bigint }[]>`SELECT count(*) AS n, count(DISTINCT position) AS d FROM "UploadStagedRow" WHERE "batchId" = ${up.id}`;
    expect([Number(distinct[0].n), Number(distinct[0].d)]).toEqual([RESTART_N, RESTART_N]);

    // Activación: se mata al trabajador en plena transacción; la base queda sin registros a medias y otro la completa.
    await confirmUpload(admin.id, up.id);
    const w3 = spawnWorker(FAST);
    try {
      await waitFor(async () => ((await batch(up.id)).status === "ACTIVATING" ? true : null), 120_000, 20);
    } finally {
      await killAndWait(w3, "SIGKILL");
    }
    const partial = await prisma.zdTimeEntry.count();
    expect(partial === 0 || partial === RESTART_N, `activación parcial: ${partial}`).toBe(true);
    const w4 = spawnWorker(FAST);
    try {
      await waitFor(async () => ((await batch(up.id)).status === "COMPLETED" ? true : null), 300_000, 200);
    } finally {
      await killAndWait(w4, "SIGTERM");
    }
    expect(await prisma.zdTimeEntry.count()).toBe(RESTART_N);
    expect(await prisma.auditEvent.count({ where: { batchId: up.id, action: "ACTIVATE" } })).toBe(1);
    expect((await batch(up.id)).rowsImported).toBe(RESTART_N);
  }, 40 * 60_000);
});
