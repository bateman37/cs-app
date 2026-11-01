import { appendFileSync, createReadStream, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { confirmUpload, receiveUpload, reprocessUpload, revertUpload } from "@/server/uploads/batches";
import { bugsSummary } from "@/server/bugs/summary";
import { papSummary } from "@/server/pap/summary";
import { wrikeSummary } from "@/server/wrike/summary";
import { batch, buildWorker, freshEnvironment, killAndWait, removeUploadDir, spawnWorker, useUploadDir, waitFor } from "./cargas-helpers";
import { writeCsv } from "./generators/csv";
import { volumeBugs, volumePap, volumeWrike } from "./generators/csapp04";
import { volumeTickets, writeTickets } from "./generators/zendesk";
import { writeXlsx } from "./generators/xlsx";
import { BUG_META, BUGS_VFS, BUGS_VSW, PAP, WRIKE } from "./csapp04-helpers";
import { TICKETS } from "./zendesk-helpers";

/**
 * Volumen del circuito completo de CSAPP-04 con fuentes sintéticas del orden de las reales (≈3500 Wrike, ≈5600 PAP, VFS 82 y VSW 145 y
 * lotes mayores) y el trabajador REAL: recepción, preparación, confirmación/activación, recálculo y reversión. Mide tiempos y el pico de
 * memoria (VmHWM de /proc, solo Linux). `npm run test:largo` lo incluye. Los tamaños son parámetros de la prueba, no del importador.
 */
const WRIKE_N = Number(process.env.CSAPP_TEST_WRIKE ?? 3546);
const PAP_N = Number(process.env.CSAPP_TEST_PAP ?? 5629);
const VFS_N = Number(process.env.CSAPP_TEST_VFS ?? 82);
const VSW_N = Number(process.env.CSAPP_TEST_VSW ?? 145);
const TICKETS_N = 8000;

let dir: string;
let tmp: string;
let admin: { id: string };
beforeAll(() => {
  dir = useUploadDir();
  tmp = mkdtempSync(path.join(tmpdir(), "csapp-04vol-"));
  buildWorker();
});
afterAll(() => {
  removeUploadDir(dir);
  rmSync(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
  admin = (await freshEnvironment()).admin;
});

/** Las medidas se imprimen y, si se indica CSAPP_TEST_MEASURES_FILE, también se anexan a ese archivo (el reporter oculta la salida de las pruebas que pasan). */
function report(m: object) {
  const line = `MEDIDAS_CSAPP04 ${JSON.stringify(m)}`;
  console.log(line);
  if (process.env.CSAPP_TEST_MEASURES_FILE) appendFileSync(process.env.CSAPP_TEST_MEASURES_FILE, `${line}\n`);
}

function peakRssMb(pid: number | undefined): number | null {
  if (!pid) return null;
  try {
    const m = /VmHWM:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
    return m ? Math.round(Number(m[1]) / 1024) : null;
  } catch {
    return null;
  }
}

async function seedMasters() {
  const groups = Array.from({ length: 60 }, (_, i) => ({ id: `g${i}`, name: `Grupo sintético ${i}`, updatedAt: new Date() }));
  await prisma.clientGroup.createMany({ data: groups });
  const clients = Array.from({ length: 300 }, (_, i) => ({ id: `c${i}`, name: `Cliente sintético ${i}`, groupId: `g${i % 60}`, updatedAt: new Date() }));
  await prisma.client.createMany({ data: clients });
  // Organizaciones Zendesk 70000.. repartidas por los Clientes (los tickets de volumen usan organizaciones 100000+).
  await prisma.externalIdentity.createMany({
    data: Array.from({ length: 300 }, (_, i) => ({ system: "ZENDESK" as const, kind: "ORG_ID" as const, rawValue: String(100_000 + i), searchValue: String(100_000 + i), clientId: `c${i}`, updatedAt: new Date() })),
  });
  // Proyectos Wrike y PAP: 140 equivalencias de Cliente y 10 equivalencias de proyecto directamente a Grupo.
  const eq = (system: "WRIKE" | "PAP") => [
    ...Array.from({ length: 140 }, (_, i) => ({ system, kind: "PROJECT_NAME" as const, rawValue: `Proyecto ${i}`, searchValue: `proyecto ${i}`, clientId: `c${i}`, updatedAt: new Date() })),
  ];
  await prisma.externalIdentity.createMany({ data: [...eq("WRIKE"), ...eq("PAP")] });
  await prisma.externalIdentity.createMany({
    data: Array.from({ length: 10 }, (_, i) => ({ system: (i % 2 === 0 ? "WRIKE" : "PAP") as "WRIKE" | "PAP", kind: "PROJECT_NAME" as const, rawValue: `Proyecto ${140 + i}`, searchValue: `proyecto ${140 + i}`, groupId: `g${i}`, updatedAt: new Date() })),
  });
  for (let i = 0; i < 40; i++) {
    const p = await prisma.person.create({ data: { name: `Persona ${i}` } });
    await prisma.personAlias.create({ data: { personId: p.id, system: "WRIKE", kind: "NAME", rawValue: `persona.${i}`, searchValue: `persona.${i}` } });
    if (i % 5 !== 4) await prisma.personTerm.create({ data: { personId: p.id, attribute: "PMO_MEMBER", flag: i % 5 !== 3 } });
  }
}

async function run(profileId: string, file: string, name: string, expectRows: number, opts: { metadata?: object; declared?: object } = {}) {
  const size = statSync(file).size;
  const tUp = Date.now();
  const up = await receiveUpload(admin.id, { profileId, originalName: name, metadata: opts.metadata ?? {}, declared: opts.declared ?? { extraccion: "2026-10-01" }, contentLength: size, body: createReadStream(file) });
  const uploadMs = Date.now() - tUp;
  const worker = spawnWorker({ CSAPP_WORKER_POLL_MS: "200", NODE_OPTIONS: "--max-old-space-size=512" });
  let peak = 0;
  const t0 = Date.now();
  let prepareMs = 0;
  let activateMs = 0;
  try {
    await waitFor(async () => {
      peak = Math.max(peak, peakRssMb(worker.pid) ?? 0);
      const b = await batch(up.id);
      if (b.status === "REJECTED" || b.status === "FAILED") throw new Error(`${b.status}: ${b.statusDetail ?? ""}`);
      return b.status === "READY" ? true : null;
    }, 20 * 60_000, 300);
    prepareMs = Date.now() - t0;
    expect(await batch(up.id)).toMatchObject({ rowsReceived: expectRows, rowsError: 0 });
    const t1 = Date.now();
    await confirmUpload(admin.id, up.id);
    await waitFor(async () => {
      peak = Math.max(peak, peakRssMb(worker.pid) ?? 0);
      const b = await batch(up.id);
      if (b.status === "FAILED") throw new Error(b.statusDetail ?? "FAILED");
      return b.status === "COMPLETED" ? true : null;
    }, 20 * 60_000, 300);
    activateMs = Date.now() - t1;
    // Recálculo (REDERIVE) del lote completado: no relee el archivo.
    const t2 = Date.now();
    await reprocessUpload(admin.id, up.id);
    await waitFor(async () => (await prisma.uploadJob.count({ where: { batchId: up.id, status: { in: ["PENDING", "RUNNING"] } } })) === 0, 10 * 60_000, 300);
    const rederiveMs = Date.now() - t2;
    const sec = (ms: number) => Math.round(ms / 100) / 10;
    report({ fuente: profileId, filas: expectRows, archivoMB: Math.round((size / 1048576) * 100) / 100, recepcionS: sec(uploadMs), preparacionS: sec(prepareMs), filasPorSegundoPreparacion: Math.round(expectRows / (prepareMs / 1000)), activacionS: sec(activateMs), recalculoS: sec(rederiveMs), picoRssTrabajadorMB: peak || null });
  } finally {
    await killAndWait(worker, "SIGTERM");
  }
  return up;
}

describe("Volumen del circuito Wrike, PAP y bugs", () => {
  it(`importa ${WRIKE_N} Wrike, ${PAP_N} PAP, VFS ${VFS_N} y VSW ${VSW_N} por el motor completo, repite sin duplicar y revierte`, async () => {
    await seedMasters();
    const tk = path.join(tmp, "tickets.xlsx");
    await writeTickets(tk, volumeTickets(TICKETS_N, { orgs: 300 }));
    await run(TICKETS, tk, "tickets.xlsx", TICKETS_N);

    const wr = path.join(tmp, "wrike.csv");
    await writeCsv(wr, volumeWrike(WRIKE_N, { tickets: TICKETS_N }), { bom: true, eol: "\r\n" });
    const w = await run(WRIKE, wr, "wrike.csv", WRIKE_N);
    const ws = await wrikeSummary(admin.id, w.id);
    expect(ws).toMatchObject({ rowsReceived: WRIKE_N, rowsWithError: 0, reconciled: true });
    expect(ws!.unimputedTasks).toBeGreaterThan(0);
    expect(await prisma.wrikeTimeEntry.count()).toBe(ws!.validRows - ws!.buckets.filter((b) => b.bucket.startsWith("DUPLICATE")).reduce((a, b) => a + b.rows, 0));

    const pp = path.join(tmp, "pap.xlsx");
    await writeXlsx(pp, { sheets: [{ name: "CARGA PAP", rows: volumePap(PAP_N, { tickets: TICKETS_N }) }] });
    const p = await run(PAP, pp, "pap.xlsx", PAP_N, { metadata: { lista: "pap-volumen" } });
    const ps = await papSummary(admin.id, p.id);
    expect(ps).toMatchObject({ rowsWithError: 0, distinctPap: PAP_N, newPap: PAP_N });
    expect(await prisma.papItem.count()).toBe(PAP_N);

    const vf = path.join(tmp, "vfs.csv");
    await writeCsv(vf, volumeBugs("VFS", VFS_N, { tickets: TICKETS_N }), { bom: true });
    const bf = await run(BUGS_VFS, vf, "vfs.csv", VFS_N, { metadata: BUG_META });
    const vw = path.join(tmp, "vsw.csv");
    await writeCsv(vw, volumeBugs("VSW", VSW_N, { tickets: TICKETS_N }), { bom: true });
    const bw = await run(BUGS_VSW, vw, "vsw.csv", VSW_N, { metadata: BUG_META });
    expect(await prisma.workItem.count({ where: { product: "VFS" } })).toBe(VFS_N);
    expect(await prisma.workItem.count({ where: { product: "VSW" } })).toBe(VSW_N);
    const s1 = await bugsSummary(admin.id, bf.id);
    const s2 = await bugsSummary(admin.id, bw.id);
    expect(s1!.bugs + s1!.byType.filter((t) => t.type !== "Bug_").reduce((a, t) => a + t.items, 0)).toBe(VFS_N);
    expect(s2!.linkPairs).toBeGreaterThan(0);

    // Repetir los cuatro archivos no duplica entidades, revisiones ni imputaciones.
    const before = { wr: await prisma.wrikeTimeEntry.count(), pap: await prisma.papRevision.count(), wi: await prisma.workItemRevision.count() };
    for (const [profileId, f, n, meta] of [[WRIKE, wr, WRIKE_N, {}], [PAP, pp, PAP_N, { lista: "pap-volumen" }], [BUGS_VSW, vw, VSW_N, BUG_META]] as const) {
      const again = await run(profileId, f, path.basename(f), n, { metadata: meta });
      expect((await batch(again.id)).rowsDuplicate).toBeGreaterThan(0);
    }
    expect({ wr: await prisma.wrikeTimeEntry.count(), pap: await prisma.papRevision.count(), wi: await prisma.workItemRevision.count() }).toEqual(before);

    // Reversión de un lote propio (el primero de Wrike): lo sustentado por el lote repetido se conserva.
    const worker = spawnWorker({ CSAPP_WORKER_POLL_MS: "200" });
    try {
      const tr = Date.now();
      await revertUpload(admin.id, w.id);
      await waitFor(async () => ((await batch(w.id)).status === "REVERTED" ? true : null), 10 * 60_000, 300);
      report({ fuente: WRIKE, reversionS: Math.round((Date.now() - tr) / 100) / 10 });
    } finally {
      await killAndWait(worker, "SIGTERM");
    }
    expect(await prisma.wrikeTimeEntry.count()).toBe(before.wr);
  }, 3_600_000);
});
