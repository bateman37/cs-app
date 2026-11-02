import { createHash } from "node:crypto";
import { createReadStream, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createExport, getExport } from "@/server/exports/service";
import { exportFilePath } from "@/server/exports/run";
import { buildWorker, freshEnvironment, killAndWait, reapOwnWorkers, spawnWorker, waitFor } from "./cargas-helpers";
import { addClient, addGroup } from "./economia-helpers";
import { batchOf } from "./calidad-helpers";

/**
 * CSAPP-09 §8: recuperación de la exportación con el trabajador COMPILADO y PostgreSQL real. SIGKILL durante la preparación y durante la generación;
 * el nuevo trabajador retoma sin duplicados ni parciales. Mide el RSS máximo del trabajador mientras genera (memoria acotada por bloque, no por archivo).
 */
const ROWS = Number(process.env.CSAPP_TEST_EXPORT_ROWS ?? 300_000);
const FAST = { CSAPP_WORKER_LEASE_MS: "2000", CSAPP_WORKER_HEARTBEAT_MS: "500", CSAPP_WORKER_POLL_MS: "200", CSAPP_WORKER_BACKOFF_MS: "100", CSAPP_EXPORT_PAGE_ROWS: "2000" };
let dir: string;
let admin: { id: string };
beforeAll(() => { buildWorker(); }, 120_000);
afterEach(async () => { await reapOwnWorkers(); }); // también tras un fallo: ningún trabajador hijo queda vivo
afterAll(async () => { await reapOwnWorkers(); if (dir) rmSync(dir, { recursive: true, force: true }); });
beforeEach(async () => {
  admin = (await freshEnvironment()).admin;
  dir = mkdtempSync(path.join(tmpdir(), "csapp09-expw-"));
  process.env.CSAPP_EXPORT_DIR = dir;
});

async function seed(n: number) {
  const g = await addGroup("Atlas");
  const c = await addClient("Atlas 1", g.id);
  const zd = await batchOf(admin.id, "zendesk-tiempo");
  await prisma.$executeRaw`
    INSERT INTO "ZdTimeEntry" ("originFingerprint", "firstBatchId", "ticketId", "workDate", "loggedHours", "loggedMinutes", minutes, fingerprint, "drvGroupId", "drvClientId", "drvEligibility", "drvBucket", "updatedAt")
    SELECT 'o-' || i, ${zd.id}, (800000 + i % 5000)::text, date '2026-10-01' + (i % 31), 0, (i % 59) + 1, (i % 59) + 1, 'f-' || i, ${g.id}, ${c.id}, 'ELIGIBLE', 'ATTRIBUTABLE', now()
    FROM generate_series(1, ${n}) AS i`;
  const sum = await prisma.$queryRaw<{ m: string }[]>`SELECT sum(minutes)::bigint::text AS m FROM "ZdTimeEntry"`;
  return { minutes: BigInt(sum[0].m) };
}
const rssKb = async (pid: number) => { try { return Number(/VmRSS:\s+(\d+)/.exec(await readFile(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0); } catch { return 0; } };

describe("exportación con el trabajador real", () => {
  it(`SIGKILL en preparación y en generación: el nuevo trabajador completa ${ROWS.toLocaleString("es-ES")} hechos sin duplicados ni parciales; checksum, unicidad y totales; RSS acotado`, async () => {
    const { minutes } = await seed(ROWS);
    const job = await createExport(admin.id, { dataset: "horas", scope: "group", sel: "", desde: "2026-10-01", hasta: "2026-10-31", servicio: "TOTAL" });
    expect(job.requested.totals).toEqual({ horas: ROWS });

    // 1) Muerte durante la PREPARACIÓN (la lectura coherente se pierde entera: nada queda a medias).
    const w1 = spawnWorker(FAST);
    try {
      await waitFor(async () => ((await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } })).status === "PREPARING" ? true : null), 60_000, 20);
    } finally { await killAndWait(w1, "SIGKILL"); }
    const mid = await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
    if (mid.materializedAt === null) expect(await prisma.exportRow.count({ where: { jobId: job.id } })).toBe(0); // transacción revertida: sin materialización parcial

    // 2) Muerte durante la GENERACIÓN (con progreso real).
    const w2 = spawnWorker(FAST);
    let peakKb = 0;
    try {
      await waitFor(async () => {
        if (w2.pid) peakKb = Math.max(peakKb, await rssKb(w2.pid));
        const j = await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
        return j.status === "GENERATING" && Number(j.progressDone) > 0 ? true : null;
      }, 180_000, 20);
    } finally { await killAndWait(w2, "SIGKILL"); }
    const killed = await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(["GENERATING", "READY"]).toContain(killed.status);
    expect(await prisma.exportFile.count({ where: { jobId: job.id } })).toBe(killed.status === "READY" ? 2 : 0); // nada publicado a medias

    // 3) Un tercer trabajador retoma desde la materialización (misma lectura) y termina.
    const w3 = spawnWorker(FAST);
    try {
      await waitFor(async () => {
        if (w3.pid) peakKb = Math.max(peakKb, await rssKb(w3.pid));
        return (await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } })).status === "READY" ? true : null;
      }, 300_000, 100);
    } finally { await killAndWait(w3, "SIGTERM"); }
    const done = await getExport(admin.id, job.id);
    expect(done).toMatchObject({ status: "READY", progressDone: String(ROWS) });
    const data = done.files.filter((f) => f.kind === "DATA");
    expect(data.reduce((s, f) => s + Number(f.rows), 0)).toBe(ROWS);

    // Contenido: recuento de líneas, unicidad de la clave, suma de minutos, checksum recalculado en streaming.
    let lines = 0; let mins = 0n; const ids = new Set<string>();
    for (const f of data) {
      const stored = await prisma.exportFile.findUniqueOrThrow({ where: { id: f.id } });
      const p = exportFilePath(stored.storageId);
      const hash = createHash("sha256");
      await new Promise<void>((res, rej) => { const s = createReadStream(p); s.on("data", (b) => hash.update(b)); s.on("end", () => res()); s.on("error", rej); });
      expect(hash.digest("hex")).toBe(f.checksum);
      const rl = createInterface({ input: createReadStream(p, { encoding: "utf8" }) });
      let header: string[] | null = null;
      for await (const line of rl) {
        if (!header) { header = line.replace(/^﻿/, "").split(";"); continue; }
        if (line === "") continue;
        const cols = line.split(";");
        lines++;
        ids.add(`${cols[header.indexOf("fuente")]}|${cols[header.indexOf("id_entrada")]}`);
        mins += BigInt(cols[header.indexOf("minutos")].split(",")[0]);
      }
    }
    expect(lines).toBe(ROWS);
    expect(ids.size).toBe(ROWS);
    expect(mins).toBe(minutes);
    const job2 = await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(job2.attempts).toBeGreaterThanOrEqual(2);
    console.log(`[exportación ${ROWS} filas] RSS máximo del trabajador ≈ ${(peakKb / 1024).toFixed(0)} MB; intentos ${job2.attempts}; archivos ${data.map((f) => `${f.name} ${f.rows} filas ${f.bytes} B`).join(", ")}`);
    expect(peakKb / 1024).toBeLessThan(700); // memoria acotada: no proporcional al contenido completo
  }, 900_000);
});
