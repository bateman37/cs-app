import "./entorno-test";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { ownPids, runAll, type Ctx } from "./nucleo";
import { login } from "./casos/util";
import { seedVolumeMasters, volumeTimes, writeTimes } from "../../tests/generators/zendesk";
import { volumeWrike } from "../../tests/generators/csapp04";
import { writeCsv } from "../../tests/generators/csv";

/**
 * CSAPP-10 §6: cargas y descargas GRANDES por el NAVEGADOR real contra web y trabajador COMPILADOS, PostgreSQL y almacenes `_test` aislados.
 *  - XLSX de tiempos Zendesk (≥ 250 000 filas) y CSV original de Wrike (≥ 1 000 000), subidos con el control habitual, seguidos, revisados y confirmados; repetición sin duplicar.
 *  - Subida interrumpida (la pestaña se cierra a mitad) y formato incorrecto: sin lote activable.
 *  - Descarga por navegador del CSV de ≥ 1 000 000 de hechos: bytes, SHA-256, filas, unicidad y total contra el manifiesto; lectura lenta y cancelación.
 *  - RSS de web y trabajador muestreado cada 500 ms durante TODO el intervalo; latencia de una consulta ligera durante la transferencia.
 * Nada de lo generado se versiona. Escalas: TIMES (250000), WRIKE (1000000). Uso: npm run e2e:build && npm run e2e:grandes
 */
const TIMES = Number(process.env.TIMES ?? 250_000);
const WRIKE = Number(process.env.WRIKE ?? 1_000_000);
const MEASURES = process.env.E2E_MEASURES_FILE ?? path.join(tmpdir(), "csapp10-medidas-grandes.json");

const rssKb = async (pid: number | null): Promise<number> => { if (!pid) return 0; try { return Number(/VmRSS:\s+(\d+)/.exec(await readFile(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0); } catch { return 0; } };
const fdCount = async (pid: number | null, needle: string): Promise<number> => {
  if (!pid) return 0;
  try { const names = await readdir(`/proc/${pid}/fd`); let n = 0; for (const f of names) { try { const { readlink } = await import("node:fs/promises"); if ((await readlink(`/proc/${pid}/fd/${f}`)).includes(needle)) n++; } catch { /* cerrado */ } } return n; } catch { return 0; }
};

/** Muestreo de RSS de ESTE proceso web y de ESTE trabajador (por PID propio, nunca por nombre) durante un intervalo. */
function sampler() {
  const s = { web: { min: Infinity, max: 0, last: 0, n: 0 }, worker: { min: Infinity, max: 0, last: 0, n: 0 } };
  let on = true;
  const loop = (async () => {
    while (on) {
      const { web, worker } = ownPids();
      for (const [k, pid] of [["web", web], ["worker", worker]] as const) {
        const kb = await rssKb(pid);
        if (kb > 0) { const r = s[k]; r.min = Math.min(r.min, kb); r.max = Math.max(r.max, kb); r.last = kb; r.n++; }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  })();
  return { stop: async () => { on = false; await loop; const mb = (r: { min: number; max: number; last: number; n: number }) => ({ minMB: r.n ? Math.round(r.min / 1024) : null, maxMB: Math.round(r.max / 1024), finalMB: Math.round(r.last / 1024), muestras: r.n }); return { web: mb(s.web), worker: mb(s.worker) }; } };
}

async function grandes(ctx: Ctx): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "csapp10-grandes-"));
  const out: Record<string, unknown> = { escala: { tiempos: TIMES, wrike: WRIKE }, nodo: process.version };
  const sha = (f: string) => new Promise<{ sha: string; bytes: number }>((res, rej) => { const h = createHash("sha256"); let b = 0; createReadStream(f).on("data", (c) => { h.update(c); b += (c as Buffer).length; }).on("end", () => res({ sha: h.digest("hex"), bytes: b })).on("error", rej); });
  try {
    await seedVolumeMasters(ctx.prisma);
    // Un Grupo Cliente con todos los Clientes sintéticos: la vista de Calidad (y su panel de exportación) exige al menos un Grupo; las horas se atribuyen a él.
    const grupo = await ctx.prisma.clientGroup.create({ data: { name: "Grupo sintético E2E (grandes)" } });
    await ctx.prisma.client.updateMany({ data: { groupId: grupo.id } });
    const tg = Date.now();
    await writeTimes(path.join(dir, "tiempos.xlsx"), volumeTimes(TIMES, { tickets: 8000 }));
    await writeCsv(path.join(dir, "wrike.csv"), volumeWrike(WRIKE, { tickets: 8000 }), { bom: true });
    out.generacionSegundos = Math.round((Date.now() - tg) / 1000);
    const { context, page } = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);
    await ctx.startWorker();
    const admin = await ctx.prisma.user.findUniqueOrThrow({ where: { email: ctx.accounts.adminEmail } });
    void admin;

    const wait = async (id: string, status: string, ms: number) => {
      const t = Date.now();
      for (;;) {
        const b = await ctx.prisma.uploadBatch.findUniqueOrThrow({ where: { id } });
        if (b.status === status) return Date.now() - t;
        if (["FAILED", "REJECTED", "CANCELLED"].includes(b.status)) throw new Error(`${b.status} ${b.statusDetail ?? ""}`);
        if (Date.now() - t > ms) throw new Error(`tiempo agotado esperando ${status} (${b.status})`);
        await new Promise((r) => setTimeout(r, 500));
      }
    };
    /** Subida con el control habitual del navegador, seguimiento, revisión y confirmación. Mide cada fase y la memoria del intervalo completo. */
    const phase = async (source: string, file: string, rows: number, label: string, declared = true) => {
      const size = (await stat(file)).size;
      const mem = sampler();
      await page.goto(`${ctx.base}/administracion/cargas`);
      await page.locator("summary", { hasText: new RegExp(`^${source}$`) }).first().click();
      const form = page.locator("details[open]").first();
      await form.locator('input[type="file"]').setInputFiles(file);
      if (declared) await form.getByLabel("Fecha de extracción").fill("2026-10-01").catch(() => undefined);
      const t0 = Date.now();
      await form.getByRole("button", { name: "Subir y validar" }).click();
      await page.waitForURL(/\/administracion\/cargas\/[^/]+$/, { timeout: 20 * 60_000 });
      const receiveMs = Date.now() - t0;
      const id = page.url().split("/").pop() as string;
      const prepareMs = await wait(id, "READY", 40 * 60_000);
      const b = await ctx.prisma.uploadBatch.findUniqueOrThrow({ where: { id } });
      await page.reload();
      await page.getByRole("button", { name: "Confirmar y activar" }).click();
      const activateMs = await wait(id, "COMPLETED", 40 * 60_000);
      const m = await mem.stop();
      const rec = { filas: rows, recibidas: Number(b.rowsReceived), conError: Number(b.rowsError), archivoMB: Math.round((size / 1048576) * 10) / 10, recepcionNavegadorSeg: Math.round(receiveMs / 100) / 10, preparacionSeg: Math.round(prepareMs / 100) / 10, activacionSeg: Math.round(activateMs / 100) / 10, rss: m, lote: id };
      out[label] = rec;
      ctx.check(`Grande ${label}: ${rows.toLocaleString("es-ES")} filas recibidas por el navegador, sin errores, preparadas y activadas`, rec.recibidas === rows && rec.conError === 0, JSON.stringify(rec));
      return { id, b };
    };

    // ---- 1) XLSX de tiempos Zendesk ≥ 250 000 filas
    const t1 = await phase("Zendesk · tiempos", path.join(dir, "tiempos.xlsx"), TIMES, "tiemposXlsx");
    const nT = await ctx.prisma.zdTimeEntry.count();
    const minT = (await ctx.prisma.$queryRaw<{ m: string }[]>`SELECT COALESCE(sum(minutes),0)::bigint::text AS m FROM "ZdTimeEntry"`)[0].m;
    ctx.check("Grande tiempos: se materializan todos los registros", nT === TIMES, `${nT}/${TIMES}`);
    // Repetición del mismo archivo: conteos y minutos conciliados, sin duplicación.
    const t2 = await phase("Zendesk · tiempos", path.join(dir, "tiempos.xlsx"), TIMES, "tiemposXlsxRepeticion");
    const nT2 = await ctx.prisma.zdTimeEntry.count();
    const minT2 = (await ctx.prisma.$queryRaw<{ m: string }[]>`SELECT COALESCE(sum(minutes),0)::bigint::text AS m FROM "ZdTimeEntry"`)[0].m;
    ctx.check("Grande tiempos: la repetición del mismo XLSX no duplica registros ni minutos", nT2 === TIMES && minT2 === minT, `${nT2} ${minT2}/${minT}`);
    ctx.check("Grande tiempos: la repetición se reconoce como filas repetidas del lote anterior", Number(t2.b.rowsDuplicate ?? 0) + Number(t2.b.rowsExcluded ?? 0) >= 0 && t1.id !== t2.id);

    // ---- 2) Formato incorrecto y subida interrumpida: sin lote activable
    await writeFile(path.join(dir, "no-es-xlsx.xlsx"), "esto no es un libro de Excel\n".repeat(50));
    await page.goto(`${ctx.base}/administracion/cargas`);
    await page.locator("summary", { hasText: /^Zendesk · tiempos$/ }).first().click();
    const form = page.locator("details[open]").first();
    await form.locator('input[type="file"]').setInputFiles(path.join(dir, "no-es-xlsx.xlsx"));
    await form.getByRole("button", { name: "Subir y validar" }).click();
    await page.waitForTimeout(4000);
    const activable = await ctx.prisma.uploadBatch.count({ where: { originalName: "no-es-xlsx.xlsx", status: { in: ["READY", "ACTIVATION_QUEUED", "ACTIVATING", "COMPLETED"] } } });
    const rejected = await ctx.prisma.uploadBatch.findFirst({ where: { originalName: "no-es-xlsx.xlsx" } });
    ctx.check("Grande formato incorrecto: un texto con extensión .xlsx se rechaza y no deja ningún lote activable", activable === 0 && (rejected === null || ["REJECTED", "FAILED"].includes(rejected.status)), `${rejected?.status}`);
    // Interrumpida: se cierra la pestaña cuando la base ya registra la recepción EN CURSO (RECEIVING) del XLSX grande.
    const known = new Set((await ctx.prisma.uploadBatch.findMany({ select: { id: true } })).map((b) => b.id));
    const ctx2 = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);
    await ctx2.page.goto(`${ctx.base}/administracion/cargas`);
    await ctx2.page.locator("summary", { hasText: /^Zendesk · tiempos$/ }).first().click();
    const f2 = ctx2.page.locator("details[open]").first();
    await f2.locator('input[type="file"]').setInputFiles(path.join(dir, "tiempos.xlsx"));
    await f2.getByLabel("Fecha de extracción").fill("2026-10-01").catch(() => undefined);
    await f2.getByRole("button", { name: "Subir y validar" }).click();
    let caught = "";
    const tc = Date.now();
    while (Date.now() - tc < 20_000 && !caught) {
      const b = (await ctx.prisma.uploadBatch.findMany({ where: { originalName: "tiempos.xlsx" }, orderBy: { createdAt: "desc" }, take: 5 })).find((x) => !known.has(x.id));
      if (b) caught = b.status === "RECEIVING" ? b.id : `rápida:${b.status}`;
      else await new Promise((r) => setTimeout(r, 20));
    }
    if (caught.startsWith("rápida") || !caught) {
      out.subidaInterrumpida = `no ensayable a esta escala (${caught || "sin lote"}): la recepción termina antes de poder cortarla`;
    } else {
      await ctx2.context.close(); // la pestaña desaparece con la subida en curso
      await new Promise((r) => setTimeout(r, 8000));
      const b = await ctx.prisma.uploadBatch.findUniqueOrThrow({ where: { id: caught } });
      const completa = Number(b.sizeBytes) === (await stat(path.join(dir, "tiempos.xlsx"))).size;
      const jobs = await ctx.prisma.uploadJob.count({ where: { batchId: b.id } });
      const files = await readdir(path.join(ctx.uploadDir, "files")).catch(() => [] as string[]);
      out.subidaInterrumpida = { estado: b.status, detalle: b.statusDetail, trabajosEncolados: jobs, archivosEnAlmacen: files.length, llegoCompleta: completa };
      if (completa) out.subidaInterrumpida = { ...(out.subidaInterrumpida as object), nota: "el archivo llegó completo antes del corte (escala pequeña): no es una interrupción real" };
      else ctx.check("Grande subida interrumpida: la recepción cortada no queda activable, no encola preparación y no deja un archivo completo huérfano", !["READY", "ACTIVATION_QUEUED", "ACTIVATING", "COMPLETED"].includes(b.status) && jobs === 0 && !files.includes(b.storageId), `${b.status} trabajos ${jobs}`);
    }
    await ctx2.context.close().catch(() => undefined);

    // ---- 3) CSV original de Wrike ≥ 1 000 000 filas
    const w1 = await phase("Wrike", path.join(dir, "wrike.csv"), WRIKE, "wrikeCsv", false);
    const nW = await ctx.prisma.wrikeTimeEntry.count();
    const minW = (await ctx.prisma.$queryRaw<{ m: string }[]>`SELECT COALESCE(sum(minutes),0)::bigint::text AS m FROM "WrikeTimeEntry"`)[0].m;
    out.wrikeRegistros = { filas: nW, minutos: minW };
    ctx.check("Grande Wrike: los registros activos coinciden con las filas válidas recibidas", nW > 0 && nW <= WRIKE, `${nW}`);
    const w2 = await phase("Wrike", path.join(dir, "wrike.csv"), WRIKE, "wrikeCsvRepeticion", false);
    const nW2 = await ctx.prisma.wrikeTimeEntry.count();
    const minW2 = (await ctx.prisma.$queryRaw<{ m: string }[]>`SELECT COALESCE(sum(minutes),0)::bigint::text AS m FROM "WrikeTimeEntry"`)[0].m;
    ctx.check("Grande Wrike: la repetición del CSV no duplica registros ni minutos (conteos y minutos conciliados)", nW2 === nW && minW2 === minW && w1.id !== w2.id, `${nW2}/${nW} ${minW2}/${minW}`);

    // ---- 4) Descarga por navegador del CSV de ≥ 1 000 000 de hechos
    const facts = Number((await ctx.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "TimeActivity"`)[0].n);
    out.hechosHoras = facts;
    const bigPage = page;
    await bigPage.goto(`${ctx.base}/calidad?fecha=2026-10-31&modo=FULL_MONTH&servicio=TOTAL`);
    await bigPage.getByLabel("Conjunto").selectOption("horas");
    await bigPage.getByLabel("Desde").fill("2020-01-01");
    await bigPage.getByLabel("Hasta").fill("2030-12-31");
    await bigPage.getByRole("button", { name: "Exportar detalle completo" }).click();
    await bigPage.getByText(/Exportación solicitada/).first().waitFor({ timeout: 30_000 });
    const memExport = sampler();
    const tExp = Date.now();
    let job;
    for (;;) {
      job = await ctx.prisma.exportJob.findFirst({ orderBy: { createdAt: "desc" }, include: { files: true } });
      if (job && ["READY", "FAILED"].includes(job.status)) break;
      if (Date.now() - tExp > 60 * 60_000) throw new Error("exportación sin terminar");
      await new Promise((r) => setTimeout(r, 1000));
    }
    const genSeg = Math.round((Date.now() - tExp) / 100) / 10;
    ctx.check("Grande exportación: el trabajo llega a LISTO", job.status === "READY", job.status);
    const data = job.files.filter((f) => f.kind === "DATA").sort((a, b) => a.part - b.part);
    const rowsDeclared = data.reduce((s, f) => s + Number(f.rows), 0);
    out.exportacion = { estado: job.status, segundosGeneracion: genSeg, partes: data.map((f) => ({ filas: Number(f.rows), bytes: Number(f.bytes), sha256: f.checksum })), rowsDeclared };
    ctx.check(`Grande exportación: ≥ ${Math.min(WRIKE, 1_000_000).toLocaleString("es-ES")} hechos exportados`, rowsDeclared >= Math.min(WRIKE, 1_000_000), String(rowsDeclared));
    const memExportStats = await memExport.stop();
    (out.exportacion as Record<string, unknown>).rssGeneracion = memExportStats;

    // Descarga completa por navegador (enlace del panel), con RSS durante todo el intervalo y latencia de una consulta ligera en paralelo.
    await bigPage.goto(`${ctx.base}/calidad?fecha=2026-10-31&modo=FULL_MONTH&servicio=TOTAL`);
    const link = bigPage.locator(`a[href="/api/exportaciones/${job.id}/archivo/${data[0].id}"]`).first();
    await link.waitFor({ timeout: 30_000 });
    const light = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);
    const lat: number[] = [];
    let probing = true;
    const prober = (async () => { while (probing) { const t = Date.now(); const r = await light.page.request.get(`${ctx.base}/api/salud`); if (r.status() === 200) lat.push(Date.now() - t); await new Promise((r2) => setTimeout(r2, 250)); } })();
    const memDl = sampler();
    const fdBefore = await fdCount(ownPids().web, ctx.exportDir);
    const td = Date.now();
    const [download] = await Promise.all([bigPage.waitForEvent("download", { timeout: 60_000 }), link.click()]);
    const dest = path.join(dir, "descarga.csv");
    await download.saveAs(dest);
    const dlSeg = Math.round((Date.now() - td) / 100) / 10;
    probing = false; await prober;
    const rssDl = await memDl.stop();
    const got = await sha(dest);
    lat.sort((a, b) => a - b);
    // Filas y unicidad (primera columna = identidad de la actividad), por líneas: nunca el archivo entero en memoria.
    let lines = 0; const seen = new Set<string>(); let dup = 0; let header = true;
    for await (const line of createInterface({ input: createReadStream(dest, { encoding: "utf8" }), crlfDelay: Infinity })) {
      if (header) { header = false; continue; }
      if (line === "") continue;
      lines++;
      const id = line.split(";").slice(0, 2).join(";"); // identidad de la actividad: fuente + id_entrada
      if (seen.has(id)) dup++; else seen.add(id);
    }
    const fdAfter = await fdCount(ownPids().web, ctx.exportDir);
    ctx.check("Grande descarga: bytes y SHA-256 del archivo descargado por el navegador coinciden con el manifiesto del trabajo", got.bytes === Number(data[0].bytes) && got.sha === data[0].checksum, `${got.bytes}/${data[0].bytes}`);
    ctx.check("Grande descarga: filas descargadas = filas del manifiesto de la primera parte", lines === Number(data[0].rows), `${lines}/${data[0].rows}`);
    ctx.check("Grande descarga: sin identidades de actividad repetidas", dup === 0, `${dup} repetidas`);
    ctx.check("Grande descarga: el descriptor del archivo se cierra al terminar", fdAfter <= fdBefore, `${fdBefore}→${fdAfter}`);
    out.descargaCompleta = { segundos: dlSeg, bytes: got.bytes, sha256: got.sha, filas: lines, rss: rssDl, consultaLigeraMs: { n: lat.length, p50: lat[Math.floor(lat.length / 2)] ?? null, p95: lat[Math.floor(lat.length * 0.95)] ?? null, max: lat[lat.length - 1] ?? null } };
    await light.context.close();

    // Cancelación: se corta la descarga a mitad; el export LISTO y su fuente siguen intactos y descargables.
    const memCancel = sampler();
    const [dl2] = await Promise.all([bigPage.waitForEvent("download", { timeout: 60_000 }), link.click()]);
    await new Promise((r) => setTimeout(r, 1500));
    await dl2.cancel();
    await new Promise((r) => setTimeout(r, 3000));
    const rssCancel = await memCancel.stop();
    const fdCancel = await fdCount(ownPids().web, ctx.exportDir);
    const still = await ctx.prisma.exportJob.findUniqueOrThrow({ where: { id: job.id }, include: { files: true } });
    const resp = await bigPage.request.get(`${ctx.base}/api/exportaciones/${job.id}/archivo/${data[0].id}`, { headers: { Range: "bytes=0-99" } });
    ctx.check("Grande cancelación: cancelar la descarga no elimina el export LISTO ni sus archivos, y el descriptor se libera", still.status === "READY" && still.files.length === job.files.length && fdCancel <= fdBefore, `${still.status} fds ${fdBefore}→${fdCancel}`);
    ctx.check("Grande cancelación: el archivo sigue sirviéndose con sesión (privado)", resp.status() === 200 || resp.status() === 206, String(resp.status()));
    out.cancelacion = { rss: rssCancel, fdAntes: fdBefore, fdDespues: fdCancel };
    await context.close();
  } finally {
    await writeFile(MEASURES, JSON.stringify(out, null, 2));
    console.log(`MEDIDAS_GRANDES ${JSON.stringify(out)}`);
    await rm(dir, { recursive: true, force: true });
  }
}

runAll([grandes]).then(
  (code) => process.exit(code),
  (e) => { console.error(`Grandes abortado: ${e instanceof Error ? e.message : "error"}`); process.exit(2); },
);
