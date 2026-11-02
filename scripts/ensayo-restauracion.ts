import "./e2e/entorno-test"; // PRIMER import: fija DATABASE_URL = TEST_DATABASE_URL aprobada (guard central) antes de que nada abra la base de trabajo.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "pg";
import { resolveTestTarget, guardedTruncateAll, parseTarget } from "../src/lib/test-guard";
import { prisma } from "../src/lib/db";
import { collectControls, diffControls, type Controls } from "../src/server/ops/backup/controls";
import { parsePgUrl, pgClientConfig } from "../src/server/ops/backup/pgtools";
import { sha256File, walk } from "../src/server/ops/backup/fsutil";
import { ensureInstallationId, verifyStore } from "../src/server/ops/stores";
import { provisionAccount } from "../src/server/accounts";
import { todayMadrid } from "../src/domain/vigencia";

/**
 * Ensayo real de copia y restauración (CSAPP-10 §7-8). `npm run ensayo:restauracion`. Instala una instalación de PRUEBA sobre la base aislada
 * `cs_app_bkorigen_test` con almacenes en directorios temporales propios (con espacios), genera datos SINTÉTICOS representativos de 01–09, registra
 * resultados de referencia por HTTP real contra la web COMPILADA, detiene de forma controlada, crea y verifica la copia con la herramienta (CLI, procesos
 * reales), restaura en `cs_app_bkrestaurado_test` con `--nuevo-origen`, arranca la web y el trabajador COMPILADOS restaurados y compara. Escribe un JSON
 * con todas las cifras. NUNCA toca cs_app, cs_app_test, cs_app_perf_test ni cs_app_shadow: el origen es la base TEST_DATABASE_URL (debe llamarse
 * cs_app_bkorigen_test) y el destino es la propia cs_app_bkrestaurado_test, retirada al empezar y al terminar (es un recurso propio del ensayo).
 * Requiere `npm run e2e:build` (web y trabajador compilados) y las herramientas cliente de PostgreSQL. No se ha ejecutado en Windows.
 *   Opciones: --filas <n> (tiempos extra de volumen, por defecto 30000) · --salida <archivo.json> · --conservar (no borra los directorios temporales)
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const EXTRA_ROWS = Number(arg("filas", "30000"));
const KEEP = process.argv.includes("--conservar");
const ORIGIN_NAME = "cs_app_bkorigen_test";
const RESTORED_NAME = "cs_app_bkrestaurado_test";
const PORT_ORIGIN = Number(process.env.ENSAYO_PORT_ORIGEN ?? 3211);
const PORT_RESTORED = Number(process.env.ENSAYO_PORT_RESTAURADO ?? 3212);

type Check = { n: number; label: string; ok: boolean; detail?: string };
const checks: Check[] = [];
const timings: Record<string, number> = {};
const facts: Record<string, unknown> = {};
const check = (label: string, ok: boolean, detail?: string) => { const c = { n: checks.length + 1, label, ok, detail }; checks.push(c); console.log(`${ok ? "PASS" : "FAIL"} ${String(c.n).padStart(2, "0")} ${label}${!ok && detail ? ` — ${detail}` : ""}`); };
const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => { const s = Date.now(); try { return await fn(); } finally { timings[name] = Date.now() - s; console.log(`     · ${name}: ${((Date.now() - s) / 1000).toFixed(1)} s`); } };

// ---------------------------------------------------------------- Infraestructura de procesos

const FORBIDDEN_CHILD = ["TEST_DATABASE_URL", "SHADOW_DATABASE_URL", "CSAPP_ENABLE_SYNTHETIC_PROFILES", "CSAPP_APPROVED_TEST_DB", "CSAPP_COUNT_QUERIES", "DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "CSAPP_UPLOAD_DIR", "CSAPP_EXPORT_DIR", "CSAPP_STATE_DIR", "CSAPP_RESTORE_DATABASE_URL", "PORT"];
/** Entorno de un proceso hijo OPERATIVO: el del padre sin opciones de prueba ni valores heredados de la base aprobada. */
function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env = {} as Record<string, string>;
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !FORBIDDEN_CHILD.includes(k)) env[k] = v;
  // Next y dotenv leen el .env de la carpeta de trabajo SIN sobrescribir lo ya definido: se fijan VACÍAS las opciones de prueba/shadow para que no se
  // cuelen en la instalación operativa (el arranque las rechaza, y es lo que se quiere comprobar con una instalación sin ellas).
  return { ...env, TEST_DATABASE_URL: "", SHADOW_DATABASE_URL: "", CSAPP_ENABLE_SYNTHETIC_PROFILES: "", CSAPP_APPROVED_TEST_DB: "", CSAPP_COUNT_QUERIES: "", NODE_ENV: "production", CSAPP_HOME: ROOT, ...extra } as NodeJS.ProcessEnv;
}
type Proc = { child: ChildProcess; log: string; exited: Promise<number | null> };
function start(name: string, args: string[], env: NodeJS.ProcessEnv, logDir: string): Proc {
  const log = path.join(logDir, `${name}.log`);
  const out = createWriteStream(log);
  const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  child.stdout?.pipe(out);
  child.stderr?.pipe(out);
  const exited = new Promise<number | null>((r) => child.once("exit", (c) => r(c)));
  return { child, log, exited };
}
async function stop(p: Proc | null, signal: NodeJS.Signals = "SIGTERM", ms = 30_000): Promise<number | null> {
  if (!p || p.child.exitCode !== null) return p?.child.exitCode ?? null;
  p.child.kill(signal);
  const r = await Promise.race([p.exited, sleep(ms).then(() => "timeout" as const)]);
  if (r === "timeout") { p.child.kill("SIGKILL"); return p.exited; }
  return r;
}
function run(args: string[], env: NodeJS.ProcessEnv, stdin?: string): Promise<{ code: number; out: string; err: string; ms: number }> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const c = execFile(process.execPath, args, { cwd: ROOT, env, maxBuffer: 64 * 1024 * 1024 }, (e, out, err) => resolve({ code: e ? ((e as { code?: number }).code ?? 1) : 0, out, err, ms: Date.now() - t0 }));
    if (stdin !== undefined) c.stdin?.end(stdin);
  });
}
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const tsx = (script: string, args: string[], env: NodeJS.ProcessEnv) => run([TSX, path.join(ROOT, script), ...args], env);

async function waitHttp(url: string, ms = 90_000): Promise<number> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(3000) }); if (r.status > 0) return Date.now() - t0; } catch { /* aún no */ }
    await sleep(250);
  }
  throw new Error(`${url} no respondió en ${ms} ms`);
}
const responds = async (url: string) => { try { await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(2500) }); return true; } catch { return false; } };

// ---------------------------------------------------------------- HTTP real: sesión, instantáneas y comparación

async function signIn(base: string, email: string, password: string): Promise<string> {
  const r = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ email, password }), redirect: "manual" });
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  if (r.status >= 400 || !/session_token/.test(cookie)) throw new Error(`No se pudo iniciar sesión (${r.status})`);
  return cookie;
}
type Snap = { status: number; text: string; sha: string; hrefs: string[]; bytes: number };
const TS = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?|\b\d{1,2}[/.]\d{1,2}[/.]\d{4},? \d{1,2}:\d{2}(?::\d{2})?\b/g;
function visibleText(html: string): { text: string; hrefs: string[] } {
  const main = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? html;
  const hrefs = [...main.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")).filter((h) => !h.startsWith("#"));
  const text = main.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ").trim();
  // El panel «Sus exportaciones recientes» depende de QUIÉN mira (es la lista propia de cada persona): se excluye de la comparación de las vistas;
  // el estado y la descarga de las exportaciones se comprueban aparte, como propietario.
  const own = text.replace(/Sus exportaciones recientes[\s\S]*?(?=Interpretaciones pendientes|$)/, " ").replace(/Todavía no ha solicitado exportaciones\./, " ").replace(/\s+/g, " ").trim();
  return { text: own.replace(TS, "‹marca-temporal›"), hrefs };
}
async function snapshot(base: string, cookie: string, route: string): Promise<Snap> {
  const r = await fetch(`${base}${route}`, { headers: { cookie }, redirect: "manual" });
  const buf = Buffer.from(await r.arrayBuffer());
  if (/text\/csv|application\/json/.test(r.headers.get("content-type") ?? "")) {
    const text = buf.toString("utf8").replace(TS, "‹marca-temporal›");
    return { status: r.status, text, sha: createHash("sha256").update(text).digest("hex"), hrefs: [], bytes: buf.length };
  }
  const v = visibleText(buf.toString("utf8"));
  return { status: r.status, text: v.text, sha: createHash("sha256").update(v.text).digest("hex"), hrefs: v.hrefs, bytes: buf.length };
}

// ---------------------------------------------------------------- Datos sintéticos de 01–09

const pad = (n: number) => String(n).padStart(2, "0");
async function seedOrigin(adminId: string, uploadsDir: string, exportsDir: string) {
  void exportsDir;
  const h = await import("../tests/economia-helpers");
  const c = await import("../tests/calidad-helpers");
  const { seedAnalitica } = await import("../tests/generators/analitica");
  const { importZd, TICKETS, uploadZd } = await import("../tests/zendesk-helpers");
  const { excelSerial, ticket, ticketsBuffer } = await import("../tests/generators/zendesk");
  const { saveDraft, activateDraft } = await import("../src/server/pulse/config");
  const { defaultQualityConfig } = await import("../src/domain/quality-config");
  const { defaultPulseConfig } = await import("../src/domain/pulse-catalog");
  const { saveHealthCell } = await import("../src/server/quality/health");
  const { runReconciliation } = await import("../src/server/reconciliation/service");
  const { createExport } = await import("../src/server/exports/service");
  const { runExportOnce, expireExports } = await import("../src/server/exports/run");
  const { INDICATOR_KEYS } = await import("../src/domain/quality-config");

  const today = todayMadrid();
  const Y = Number(today.slice(0, 4));
  const M = Number(today.slice(5, 7));
  const w = await seedAnalitica(adminId, today); // grupos/clientes, usuarios variables por mes, tickets, tiempos Zendesk/Wrike, finanzas, PAP, términos de servicio, hitos
  await c.declareAllSources(adminId, `${Y - 1}-01-01`, today); // cobertura declarada de las cuatro fuentes

  // Vigencias: términos de servicio con fechas (no solapadas) y usuarios con valores distintos por mes y ámbito.
  await prisma.serviceTerm.create({ data: { attribute: "SUPPORT", value: "GOLD", groupId: w.eco.id, validFrom: new Date(`${Y - 1}-01-01T00:00:00Z`), validTo: new Date(`${Y - 1}-12-31T00:00:00Z`) } });
  await prisma.serviceTerm.create({ data: { attribute: "SUPPORT", value: "SILVER_RECURRENTE", groupId: w.eco.id, validFrom: new Date(`${Y}-01-01T00:00:00Z`) } });
  await h.setUsers(adminId, { clientId: w.b1.id }, Y, Array.from({ length: 12 }, (_, i) => (i < 4 ? null : 30 + i)));
  // Sustitución financiera atómica y su predecesora (el lote anterior queda enlazado, no borrado).
  const pred = await prisma.financeScope.findUniqueOrThrow({ where: { year_category: { year: Y, category: "SOPORTE" } } });
  const succ = await h.seedFinance(adminId, "SOPORTE", Y, [{ groupId: w.atlas.id, income: "99000" }, { groupId: w.boreal.id, income: "31000" }, { groupId: w.cenit.id, income: "49000" }]);
  await prisma.uploadBatch.update({ where: { id: pred.activeBatchId! }, data: { supersededByBatchId: succ.id } });
  await prisma.uploadBatch.update({ where: { id: succ.id }, data: { supersedesBatchId: pred.activeBatchId } });
  facts.sustitucionFinanciera = { predecesora: pred.activeBatchId, sucesora: succ.id };

  // Tickets con varias observaciones (revisiones distintas del mismo ticket en fotografías sucesivas), bugs, PAP y vínculos.
  const end = new Date(Date.UTC(Y, M - 1, 0)).toISOString().slice(0, 10); // último día del mes anterior
  const P = { y: Number(end.slice(0, 4)), m: Number(end.slice(5, 7)) };
  const day = (n: number) => `${P.y}-${pad(P.m)}-${pad(n)}`;
  const tb = await c.batchOf(adminId, "zendesk-tickets", end);
  const tb0 = await c.batchOf(adminId, "zendesk-tickets", `${P.y}-${pad(P.m)}-10`);
  const mk = (id: string, o: Record<string, unknown>, batch = tb) => c.seedTicket(batch.id, { id, observedOn: end, entorno: "Soporte", ...(o as object) } as never);
  for (let i = 0; i < 6; i++) { await mk(`Q${i}`, { org: "7001", type: "incident", created: day(3 + i), status: "open", observedOn: `${P.y}-${pad(P.m)}-10` }, tb0); await mk(`Q${i}`, { org: "7001", type: "incident", created: day(3 + i), status: i % 2 ? "solved" : "pending" }); }
  await mk("QPB1", { org: "7001", type: "problem", created: day(5), cause: "incidente_estándar_plataforma" });
  await mk("QN3", { org: "7001", type: "incident", created: day(9), destinations: ["PMO_N3", "IT_N3"], cause: "incidente_uso_indebido" });
  await c.seedBugLink(tb.id, { bugId: "9100", ticket: "QPB1" });
  const pb = await c.batchOf(adminId, "pap");
  await c.seedPap(pb.id, { id: "91", groupId: w.atlas.id, clientId: w.a1.id, date: day(10), state: "CORRECTIVE", causes: [{ category: "CORRECTIVE", origin: "STANDARD" }], listKey: "L9" });
  await c.declare(adminId, tb.id, { statusScope: "ALL_STATUSES", from: `${Y}-01-01`, to: end });

  // Health y configuración versionada (ConfigRevision inmutables): cambio de pesos de Calidad y revisión de Pulse.
  await saveHealthCell(adminId, { scope: "group", entityId: w.atlas.id, year: P.y, month: P.m, state: "POSITIVE", comment: "Cliente satisfecho (sintético)", expectedVersion: 0 });
  await saveHealthCell(adminId, { scope: "group", entityId: w.boreal.id, year: P.y, month: P.m, state: "NEGATIVE", comment: "Incidencias abiertas (sintético)", expectedVersion: 0 });
  const custom = { mode: "CUSTOM" as const, custom: Object.fromEntries(INDICATOR_KEYS.map((k, i) => [k, String([20, 20, 15, 15, 15, 15][i])])) };
  const dq = await saveDraft(adminId, "QUALITY", { ...defaultQualityConfig(), weights: custom } as never, { expectedVersion: null, note: "ensayo" });
  await activateDraft(adminId, "QUALITY", { expectedRevisionNo: 1, expectedDraftVersion: dq.version, reason: "Pesos personalizados del ensayo" });
  const dp = await saveDraft(adminId, "PULSE", defaultPulseConfig() as never, { expectedVersion: null });
  await activateDraft(adminId, "PULSE", { expectedRevisionNo: 1, expectedDraftVersion: dp.version, reason: "Revisión de Pulse del ensayo" });

  // Volumen: filas de tiempo adicionales (SQL por bloques) atribuibles al Grupo Atlas.
  if (EXTRA_ROWS > 0) {
    const batch = await c.batchOf(adminId, "zendesk-tiempo");
    for (let off = 0; off < EXTRA_ROWS; off += 3000) {
      const n = Math.min(3000, EXTRA_ROWS - off);
      await prisma.zdTimeEntry.createMany({ data: Array.from({ length: n }, (_, i) => { const k = off + i; return { originFingerprint: `bulk-${randomUUID()}`, firstBatchId: batch.id, ticketId: String(930000 + (k % 997)), workDate: new Date(Date.UTC(Y, k % M, 1 + (k % 27))), loggedHours: 0, loggedMinutes: 15 + (k % 45), minutes: 15 + (k % 45), fingerprint: `bk${k}`, drvGroupId: w.atlas.id, drvClientId: k % 2 ? w.a1.id : w.a2.id, drvEligibility: "ELIGIBLE", drvBucket: "ATTRIBUTABLE" }; }) });
    }
  }

  // Lote REAL importado por el trabajador en proceso (original conservado en el almacén) y lotes de fixtures con su original sintético.
  const rows = Array.from({ length: 40 }, (_, i) => ticket({ ticket_id: String(88000 + i), organization_id: "7001", creada: { date: excelSerial(`${P.y}-${pad(P.m)}-${pad(1 + (i % 27))}`) }, status: i % 3 ? "open" : "solved", tags: "[]", causa: "incidente_estándar_plataforma" }));
  const real = await importZd(adminId, TICKETS, await ticketsBuffer(rows), { declared: { extraccion: end } });
  facts.loteImportado = { id: real.id, estado: real.status };
  const fixtureBatches = await prisma.uploadBatch.findMany({ where: { NOT: { id: real.id } } });
  let fixed = 0;
  for (const b of fixtureBatches) {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(b.storageId)) continue;
    const sid = randomUUID();
    const buf = Buffer.from(`Original sintético del lote ${b.id} (${b.profileId})\n`.repeat(200));
    await mkdir(path.join(uploadsDir, "files"), { recursive: true });
    await writeFile(path.join(uploadsDir, "files", sid), buf);
    await prisma.uploadBatch.update({ where: { id: b.id }, data: { storageId: sid, checksum: createHash("sha256").update(buf).digest("hex"), sizeBytes: BigInt(buf.length), originalName: `sintético ñ ${b.profileId}.xlsx` } });
    fixed++;
  }
  facts.originalesSinteticosDeFixtures = fixed;

  // Informe de conciliación (ReconRun) y exportaciones con propietario: una LISTA vigente (archivo real), una CADUCADA.
  const recon = await runReconciliation(adminId, { dataset: "horas", scope: "group", sel: "", desde: `${Y}-01-01`, hasta: end, servicio: "TOTAL" });
  facts.reconRunId = recon.id;
  const req = { dataset: "horas", scope: "group", sel: "", desde: `${Y}-01-01`, hasta: end, servicio: "TOTAL" };
  const ready = await createExport(adminId, req);
  while (await runExportOnce("ensayo-origen")) { /* hasta vaciar */ }
  const exp = await createExport(adminId, { ...req, hasta: day(15) });
  while (await runExportOnce("ensayo-origen")) { /* hasta vaciar */ }
  await prisma.exportJob.update({ where: { id: exp.id }, data: { expiresAt: new Date(Date.now() - 3600_000) } });
  await expireExports();
  facts.exportaciones = { lista: ready.id, caducada: exp.id };
  return { w, P, end, today, Y, req, TICKETS, uploadZd, ticketsBuffer, ticket, excelSerial, createExport };
}

// ---------------------------------------------------------------- Ensayo

const q = async <T = Record<string, unknown>>(url: string, sql: string, params: unknown[] = []): Promise<T[]> => {
  const c = new Client(pgClientConfig(parsePgUrl(url)));
  await c.connect();
  try { return (await c.query(sql, params)).rows as T[]; } finally { await c.end(); }
};
const adminClient = async () => { const c = new Client(pgClientConfig({ ...parsePgUrl(process.env.DATABASE_URL as string), database: "postgres" })); await c.connect(); return c; };
async function dropRestored() { const c = await adminClient(); try { await c.query(`DROP DATABASE IF EXISTS "${RESTORED_NAME}" WITH (FORCE)`); } finally { await c.end(); } }
const dbUrlFor = (name: string) => { const u = new URL(process.env.DATABASE_URL as string); u.pathname = `/${name}`; return u.toString(); };
async function storeHashes(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const { files } = await walk(dir);
  for (const f of files) out[f] = (await sha256File(path.join(dir, ...f.split("/")))).sha256;
  return out;
}
async function dirSize(dir: string): Promise<number> { let n = 0; for (const f of (await walk(dir)).files) n += (await stat(path.join(dir, ...f.split("/")))).size; return n; }

async function main(): Promise<number> {
  const target = resolveTestTarget().target;
  if (target.name !== ORIGIN_NAME) throw new Error(`El ensayo usa SOLO la base ${ORIGIN_NAME} como origen; TEST_DATABASE_URL apunta a ${target.name}.`);
  if (parseTarget(dbUrlFor(RESTORED_NAME))?.name !== RESTORED_NAME) throw new Error("Nombre de destino inválido.");
  for (const p of [path.join(ROOT, ".next", "BUILD_ID"), path.join(ROOT, "worker-dist", "worker.mjs"), path.join(ROOT, "build-info.json")]) await stat(p).catch(() => { throw new Error(`Falta ${p}: ejecute «npm run e2e:build» antes del ensayo.`); });
  const originUrl = process.env.DATABASE_URL as string;
  const restoredUrl = dbUrlFor(RESTORED_NAME);
  const root = await mkdtemp(path.join(tmpdir(), "csapp ensayo restauracion "));
  const D = { uploads: path.join(root, "origen", "Mis Datos", "originales"), exports: path.join(root, "origen", "Mis Datos", "exportaciones"), state: path.join(root, "origen", "estado"), backups: path.join(root, "copias de seguridad"), rUploads: path.join(root, "restaurado", "Mis Datos", "originales"), rExports: path.join(root, "restaurado", "Mis Datos", "exportaciones"), rState: path.join(root, "restaurado", "estado"), logs: path.join(root, "registros") };
  for (const d of [D.uploads, D.exports, D.state, D.backups, D.logs]) await mkdir(d, { recursive: true });
  const secretA = randomBytes(24).toString("hex");
  const secretB = randomBytes(24).toString("hex"); // el restaurado usa SU PROPIO secreto
  const adminEmail = "admin.ensayo@test.local";
  const adminPass = randomBytes(12).toString("hex");
  const newEmail = "cuenta.nueva.restaurado@test.local";
  const newPass = randomBytes(12).toString("hex");
  const baseOrigin = `http://127.0.0.1:${PORT_ORIGIN}`;
  const baseRestored = `http://127.0.0.1:${PORT_RESTORED}`;
  const procs: Proc[] = [];
  const keep = (p: Proc) => { procs.push(p); return p; };
  facts.sistema = { node: process.version, plataforma: `${process.platform} ${process.arch}`, cpus: (await import("node:os")).cpus().length, memoriaGB: Math.round((await import("node:os")).totalmem() / 2 ** 30), root: "(carpeta temporal con espacios)" };
  const originEnv = (extra: Record<string, string> = {}) => childEnv({ DATABASE_URL: originUrl, BETTER_AUTH_SECRET: secretA, BETTER_AUTH_URL: baseOrigin, CSAPP_UPLOAD_DIR: D.uploads, CSAPP_EXPORT_DIR: D.exports, CSAPP_STATE_DIR: D.state, PORT: String(PORT_ORIGIN), CSAPP_WORKER_POLL_MS: "500", ...extra });
  const restoredEnv = (extra: Record<string, string> = {}) => childEnv({ DATABASE_URL: restoredUrl, BETTER_AUTH_SECRET: secretB, BETTER_AUTH_URL: baseRestored, CSAPP_UPLOAD_DIR: D.rUploads, CSAPP_EXPORT_DIR: D.rExports, CSAPP_STATE_DIR: D.rState, PORT: String(PORT_RESTORED), CSAPP_WORKER_POLL_MS: "500", ...extra });
  process.env.CSAPP_UPLOAD_DIR = D.uploads;
  process.env.CSAPP_EXPORT_DIR = D.exports;
  process.env.CSAPP_STATE_DIR = D.state;
  process.env.BETTER_AUTH_SECRET = secretA;
  process.env.BETTER_AUTH_URL = baseOrigin;

  try {
    // 0) Origen: migraciones, base vacía propia, instalación preparada.
    await dropRestored();
    await timed("preparar origen", async () => {
      await new Promise<void>((res, rej) => execFile(process.execPath, [path.join(ROOT, "node_modules/prisma/build/index.js"), "migrate", "deploy"], { cwd: ROOT, env: { ...process.env, DATABASE_URL: originUrl, SHADOW_DATABASE_URL: "" } }, (e) => (e ? rej(e) : res())));
      await guardedTruncateAll(prisma, resolveTestTarget());
      const id = await ensureInstallationId();
      for (const kind of ["uploads", "exports"] as const) await verifyStore(kind, id, { create: true });
      facts.installationIdOrigen = id;
    });
    await provisionAccount({ email: adminEmail, name: "Admin Ensayo", password: adminPass, role: "ADMIN" });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    await provisionAccount({ email: "consulta.ensayo@test.local", name: "Consulta Ensayo", password: randomBytes(12).toString("hex"), role: "CONSULTA" });

    // 1) Datos sintéticos de 01–09.
    const seed = await timed("sembrar datos sintéticos", () => seedOrigin(admin.id, D.uploads, D.exports));
    const { w, P, end } = seed;
    const counts0 = await prisma.$queryRaw<{ t: string; n: bigint }[]>`SELECT 'usuarios' AS t, count(*) AS n FROM "User" UNION ALL SELECT 'grupos', count(*) FROM "ClientGroup" UNION ALL SELECT 'clientes', count(*) FROM "Client" UNION ALL SELECT 'lotes', count(*) FROM "UploadBatch" UNION ALL SELECT 'tickets', count(*) FROM "ZdTicket" UNION ALL SELECT 'revisiones de ticket', count(*) FROM "ZdTicketRevision" UNION ALL SELECT 'observaciones de ticket', count(*) FROM "ZdTicketObservation" UNION ALL SELECT 'tiempos Zendesk', count(*) FROM "ZdTimeEntry" UNION ALL SELECT 'tiempos Wrike', count(*) FROM "WrikeTimeEntry" UNION ALL SELECT 'filas financieras', count(*) FROM "FinanceRow" UNION ALL SELECT 'ConfigRevision', count(*) FROM "ConfigRevision" UNION ALL SELECT 'cobertura declarada', count(*) FROM "UploadCoverageDeclaration" UNION ALL SELECT 'Client Health', count(*) FROM "HealthFeedback" UNION ALL SELECT 'ReconRun', count(*) FROM "ReconRun" UNION ALL SELECT 'ExportJob', count(*) FROM "ExportJob" UNION ALL SELECT 'ExportFile', count(*) FROM "ExportFile" UNION ALL SELECT 'auditoría', count(*) FROM "AuditEvent"`;
    facts.recuentosOrigen = Object.fromEntries(counts0.map((r) => [r.t, Number(r.n)]));
    const rc = facts.recuentosOrigen as Record<string, number>;
    check("Semilla: datos representativos presentes (usuarios, tickets con más de una observación, finanzas sustituidas, ConfigRevision, cobertura, Health, ReconRun, exportación lista)",
      rc["observaciones de ticket"] > 6 && rc["revisiones de ticket"] > rc["tickets"] - 5 && rc["ConfigRevision"] >= 4 && rc["ReconRun"] === 1 && rc["ExportFile"] >= 1 && rc["Client Health"] === 2 && rc["cobertura declarada"] >= 5 && rc["usuarios"] === 2, JSON.stringify(rc));
    const readyExp = await prisma.exportJob.findFirstOrThrow({ where: { status: "READY" }, include: { files: true } });
    const expiredExp = await prisma.exportJob.findFirstOrThrow({ where: { status: "EXPIRED" } });
    check("Semilla: exportación LISTA vigente con archivo real y checksum, y una CADUCADA sin archivo", readyExp.files.length >= 1 && (await prisma.exportFile.count({ where: { jobId: expiredExp.id } })) === 0, `${readyExp.files.length} archivo(s)`);

    // 2) Web y trabajador COMPILADOS del origen; resultados de referencia por HTTP real.
    const web = keep(start("web-origen", [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT_ORIGIN)], originEnv(), D.logs));
    const wk = keep(start("trabajador-origen", [path.join(ROOT, "worker-dist/worker.mjs")], originEnv({ CSAPP_WORKER_ID: "trabajador-origen-ensayo" }), D.logs));
    await waitHttp(`${baseOrigin}/login`);
    await prisma.rateLimit.deleteMany();
    const cookieOrigin = await signIn(baseOrigin, adminEmail, adminPass);
    const routes: { name: string; route: string; owner?: boolean }[] = [
      { name: "Comparativa", route: "/comparativa?modo=FULL_MONTH" },
      { name: "Comparativa (orden, bloques)", route: "/comparativa?tam=25&orden=cum.hours&dir=desc&bloques=mes,anterior,cum,anioant,cumant" },
      { name: "Comparativa CSV", route: "/api/analitica/comparativa.csv" },
      { name: "Comparativa CSV (q=atlas)", route: "/api/analitica/comparativa.csv?q=atlas" },
      { name: "Análisis Cliente · grupo Atlas", route: `/analisis-cliente?ambito=group&id=${w.atlas.id}` },
      { name: "Análisis Cliente · dedicación", route: `/analisis-cliente?ambito=group&id=${w.atlas.id}&pestana=dedicacion` },
      { name: "Análisis Cliente · PAP", route: `/analisis-cliente?ambito=group&id=${w.atlas.id}&pestana=pap` },
      { name: "Análisis Cliente · tickets", route: `/analisis-cliente?ambito=group&id=${w.atlas.id}&pestana=tickets` },
      { name: "Análisis Cliente · cliente", route: `/analisis-cliente?ambito=client&id=${w.a1.id}` },
      { name: "Ficha CSV series", route: `/api/analitica/ficha.csv?ambito=group&id=${w.atlas.id}&tabla=series` },
      { name: "Ficha CSV dedicación", route: `/api/analitica/ficha.csv?ambito=group&id=${w.atlas.id}&tabla=dedicacion` },
      { name: "Ficha CSV PAP", route: `/api/analitica/ficha.csv?ambito=group&id=${w.atlas.id}&tabla=pap` },
      { name: "Ficha CSV tickets", route: `/api/analitica/ficha.csv?ambito=group&id=${w.atlas.id}&tabla=tickets` },
      { name: "Pulse Rent", route: "/pulse-rent?m=M01,M04,M07,M15,M16,M17,M18,M22,M23&norm=bruto&tam=25" },
      { name: "Pulse Rent (anual, orden)", route: "/pulse-rent?m=M01,M04,M18&norm=anual&tam=25&orden=M01&dir=desc" },
      { name: "Pulse Rent detalle", route: `/pulse-rent/detalle?entidad=${w.atlas.id}&metrica=M01&m=M01,M04,M18&norm=bruto` },
      { name: "Pulse CSV filas", route: "/api/analitica/pulse.csv?m=M01,M04,M18&norm=bruto&tabla=filas" },
      { name: "Pulse CSV estadísticas", route: "/api/analitica/pulse.csv?m=M01,M04,M18&norm=bruto&tabla=estadisticas" },
      { name: "Pulse CSV criterios", route: "/api/analitica/pulse.csv?m=M01,M04,M18&norm=bruto&tabla=criterios" },
      { name: "Calidad cartera", route: `/calidad?fecha=${end}&modo=FULL_MONTH` },
      { name: "Calidad Client Health", route: `/calidad?fecha=${end}&modo=FULL_MONTH&vista=health&anio=${P.y}` },
      { name: "Calidad CSV cartera", route: `/api/analitica/calidad.csv?fecha=${end}&modo=FULL_MONTH&tabla=cartera` },
      { name: "Cargas y cobertura declarada", route: "/administracion/cargas" },
      { name: "Conciliación", route: "/administracion/conciliacion" },
      { name: "Conciliación informe", route: `/api/administracion/conciliacion/${facts.reconRunId}/informe` },
      { name: "Conciliación manifiesto", route: `/api/administracion/conciliacion/${facts.reconRunId}/manifiesto` },
      { name: "Exportaciones (estado de la lista)", route: `/api/exportaciones/${readyExp.id}/estado`, owner: true },
      { name: "Exportaciones (estado de la caducada)", route: `/api/exportaciones/${expiredExp.id}/estado`, owner: true },
    ];
    const REF = new Map<string, Snap>();
    const dataFile = readyExp.files[0];
    let dlBuf: Buffer = Buffer.alloc(0);
    // La referencia se captura con la cola pendiente YA creada (el sello de datos cuenta los lotes): es el estado exacto que se copia.
    const captureReference = async () => {
      await timed("referencia HTTP (origen)", async () => { for (const r of routes) REF.set(r.name, await snapshot(baseOrigin, cookieOrigin, r.route)); });
      check("Referencia: las vistas, detalles, cobertura, conciliación y CSV responden 200 en el origen", routes.every((r) => REF.get(r.name)!.status === 200), routes.filter((r) => REF.get(r.name)!.status !== 200).map((r) => `${r.name}=${REF.get(r.name)!.status}`).join(", "));
      check("Referencia: las vistas muestran datos (no son estados vacíos)", REF.get("Comparativa")!.text.length > 500 && REF.get("Comparativa CSV")!.bytes > 500 && REF.get("Calidad CSV cartera")!.bytes > 200, `${REF.get("Comparativa")!.text.length} / ${REF.get("Comparativa CSV")!.bytes}`);
      const dlOrigin = await fetch(`${baseOrigin}/api/exportaciones/${readyExp.id}/archivo/${dataFile.id}`, { headers: { cookie: cookieOrigin } });
      dlBuf = Buffer.from(await dlOrigin.arrayBuffer());
      check("Referencia: descarga de la exportación lista en el origen con SHA-256 igual al registrado", dlOrigin.status === 200 && createHash("sha256").update(dlBuf).digest("hex") === dataFile.checksum);
      facts.exportacionListaBytes = dlBuf.length;
    };

    // 3) La copia NO se crea con la web y el trabajador en marcha (rechazo real, sin copia, sin forzar nada).
    const cliEnv = (extra: Record<string, string> = {}) => ({ ...originEnv(), NODE_ENV: "development", ...extra }) as NodeJS.ProcessEnv;
    const early = await tsx("scripts/backup.ts", ["crear", "--destino", D.backups], cliEnv());
    check("Copia con la instalación EN MARCHA: la herramienta rechaza (web y trabajador vivos), no crea copia y no fuerza nada", early.code === 1 && /No se acredita la parada controlada/.test(early.err) && (await readdir(D.backups)).length === 0, `${early.code} ${early.err.split("\n").slice(0, 3).join(" | ")}`);
    check("El rechazo no imprime credenciales", !(early.out + early.err).includes(new URL(originUrl).password) && !(early.out + early.err).includes(secretA));

    // 4) Parada controlada: pendientes de cola creados con el trabajador parado, luego la web.
    await timed("parada controlada del trabajador", async () => { const code = await stop(wk); facts.salidaTrabajadorOrigen = code; });
    const stopped = await prisma.workerInstance.findMany({ select: { id: true, state: true } });
    check("Parada controlada: el trabajador sale con código 0 y se registra STOPPED", facts.salidaTrabajadorOrigen === 0 && stopped.length >= 1 && stopped.every((s) => s.state === "STOPPED"), JSON.stringify(stopped));
    // Cola pendiente: un trabajo de exportación QUEUED y un lote con trabajo PENDING (con el trabajador parado: nadie los consume).
    const queuedExport = await seed.createExport(admin.id, { ...seed.req, hasta: `${P.y}-${pad(P.m)}-20` });
    const pendingBuf = await seed.ticketsBuffer(Array.from({ length: 25 }, (_, i) => seed.ticket({ ticket_id: String(89000 + i), organization_id: "7001", creada: { date: seed.excelSerial(`${P.y}-${pad(P.m)}-${pad(1 + i)}`) }, status: "open", tags: "[]", causa: "incidente_estándar_plataforma" })));
    const pendingUpload = await seed.uploadZd(admin.id, seed.TICKETS, pendingBuf, { declared: { extraccion: end } });
    facts.colaPendiente = { exportacion: queuedExport.id, lote: pendingUpload.id };
    check("Cola pendiente en el origen: ExportJob QUEUED y UploadBatch con UploadJob PENDING", (await prisma.exportJob.findUniqueOrThrow({ where: { id: queuedExport.id } })).status === "QUEUED" && (await prisma.uploadJob.count({ where: { batchId: pendingUpload.id, status: "PENDING" } })) === 1);
    await captureReference();
    await timed("parada controlada de la web", async () => { facts.salidaWebOrigen = await stop(web); });
    check("La web de origen está parada (no responde en BETTER_AUTH_URL/api/salud)", !(await responds(`${baseOrigin}/api/salud`)));
    await prisma.$disconnect(); // el ensayo suelta su propia conexión al origen antes de la copia

    // 5) Huella del origen antes de la copia (recuentos/identidades/contenido y archivos).
    const cOrigin = new Client(pgClientConfig(parsePgUrl(originUrl)));
    await cOrigin.connect();
    const ctrlBefore: Controls = await collectControls(cOrigin);
    await cOrigin.end();
    const filesBefore = { uploads: await storeHashes(D.uploads), exports: await storeHashes(D.exports) };
    const bytesOrigin = { uploads: await dirSize(D.uploads), exports: await dirSize(D.exports) };
    const dbSize = Number((await q(originUrl, "SELECT pg_database_size(current_database())::text AS n"))[0].n);
    facts.tamanosOrigen = { baseBytes: dbSize, originalesBytes: bytesOrigin.uploads, exportacionesBytes: bytesOrigin.exports, ficherosOriginales: Object.keys(filesBefore.uploads).length, ficherosExportaciones: Object.keys(filesBefore.exports).length, filasTotales: Object.values(ctrlBefore).reduce((a, c) => a + c.rows, 0) };

    // 6) Crear y verificar la copia con la herramienta (CLI real).
    const created = await tsx("scripts/backup.ts", ["crear", "--destino", D.backups, "--json"], cliEnv());
    timings["backup:crear (CLI, extremo a extremo)"] = created.ms;
    check("backup:crear: código 0 y copia publicada", created.code === 0, `${created.code} ${created.err.slice(0, 300)}`);
    const jsonStart = created.out.indexOf("{\n  \"id\"");
    const createdInfo = JSON.parse(created.out.slice(jsonStart)) as { id: string; dir: string; bytes: { dump: number; uploads: number; exports: number; total: number }; requiredBytes: number; timingsMs: Record<string, number>; warnings: string[] };
    facts.copia = { id: createdInfo.id, bytes: createdInfo.bytes, espacioEstimadoNecesario: createdInfo.requiredBytes, fases_ms: createdInfo.timingsMs, avisos: createdInfo.warnings };
    check("La copia no contiene credenciales ni .env", !created.out.includes(new URL(originUrl).password) && !(await readFile(path.join(createdInfo.dir, "manifest.json"), "utf8")).includes(secretA) && !(await readFile(path.join(createdInfo.dir, "config-inventory.json"), "utf8")).includes(secretA));
    const verified = await tsx("scripts/backup.ts", ["verificar", createdInfo.dir], cliEnv());
    timings["backup:verificar (CLI)"] = verified.ms;
    check("backup:verificar: código 0 y todas las comprobaciones OK", verified.code === 0 && /RESULTADO: OK/.test(verified.out) && !/\[FALLO\]/.test(verified.out), verified.out.slice(-300));
    facts.verificacion = verified.out.split("\n").filter((l) => /^\[/.test(l));
    facts.tamanoCopiaEnDisco = await dirSize(createdInfo.dir);
    const manifest = JSON.parse(await readFile(path.join(createdInfo.dir, "manifest.json"), "utf8"));
    facts.manifiesto = { sha256: createHash("sha256").update(await readFile(path.join(createdInfo.dir, "manifest.json"))).digest("hex"), formatVersion: manifest.formatVersion, app: manifest.app, versions: manifest.versions, installationId: manifest.installationId, migraciones: manifest.schema.migrations.length, tablas: Object.keys(manifest.controls.tables).length, archivosInventariados: manifest.files.length, excluidos: manifest.excluded.map((e: { store: string; path: string; reason: string }) => `${e.store}:${e.path} (${e.reason})`) };

    // 7) Restaurar con la herramienta (CLI real) en base y carpetas NUEVAS con --nuevo-origen.
    const informe = path.join(D.logs, "informe-restauracion.json");
    const restored = await tsx("scripts/backup.ts", ["restaurar", createdInfo.dir, "--uploads", D.rUploads, "--exports", D.rExports, "--nuevo-origen", "--informe", informe], cliEnv({ CSAPP_RESTORE_DATABASE_URL: restoredUrl }));
    timings["backup:restaurar (CLI, extremo a extremo)"] = restored.ms;
    check("backup:restaurar: código 0 y RESTAURACIÓN CORRECTA", restored.code === 0 && /RESTAURACIÓN CORRECTA/.test(restored.out), `${restored.code} ${restored.err.slice(0, 400)}`);
    check("La restauración no imprime credenciales ni el secreto", !(restored.out + restored.err).includes(new URL(originUrl).password) && !(restored.out + restored.err).includes(secretA));
    const report = JSON.parse(await readFile(informe, "utf8"));
    facts.informeRestauracion = { ok: report.ok, comprobaciones: report.checks.map((c: { name: string; status: string; detail: string }) => `${c.status} ${c.name}: ${c.detail}`), archivos: report.filesCopied, nuevoOrigen: report.nuevoOrigen, fases_ms: report.timingsMs, avisos: report.warnings, grupos: report.controlGroups };
    check("Informe: ninguna comprobación en FALLO (migraciones, recuentos, identidades, relaciones, ConfigRevision inmutables, archivos, base↔archivos)", report.ok && !report.checks.some((c: { status: string }) => c.status === "FALLO"));

    // 8) Comprobaciones independientes sobre lo restaurado.
    const cRest = new Client(pgClientConfig(parsePgUrl(restoredUrl)));
    await cRest.connect();
    const ctrlRest = await collectControls(cRest);
    await cRest.end();
    const diffs = diffControls(ctrlBefore, ctrlRest);
    const expectedDiffs = ["InstallationMeta.contentSum", "Session.contentSum", "Session.idSum", "Session.rows"];
    check("Restaurado = origen en TODAS las tablas (recuento, identidades, contenido), salvo lo que --nuevo-origen cambia deliberadamente (installationId y sesiones)", JSON.stringify(diffs.map((d) => `${d.table}.${d.field}`).sort()) === JSON.stringify(expectedDiffs.sort()), diffs.map((d) => `${d.table}.${d.field}`).join(", "));
    facts.tablasComparadas = Object.keys(ctrlBefore).length;
    const filesRest = { uploads: await storeHashes(D.rUploads), exports: await storeHashes(D.rExports) };
    const strip = (h: Record<string, string>) => Object.fromEntries(Object.entries(h).filter(([k]) => k !== ".csapp-store.json"));
    check("Archivos restaurados: mismos nombres y SHA-256 que el origen (sin temporales, sondas ni caducadas)", JSON.stringify(strip(filesRest.uploads)) === JSON.stringify(Object.fromEntries(Object.entries(strip(filesBefore.uploads)).filter(([k]) => k.startsWith("files/")))) && JSON.stringify(strip(filesRest.exports)) === JSON.stringify(Object.fromEntries(Object.entries(strip(filesBefore.exports)).filter(([k]) => k.startsWith("files/")))), `${Object.keys(filesRest.uploads).length}/${Object.keys(filesRest.exports).length}`);
    const [instRest] = await q<{ value: string }>(restoredUrl, `SELECT value FROM "InstallationMeta" WHERE key = 'installation_id'`);
    const markerU = JSON.parse(await readFile(path.join(D.rUploads, ".csapp-store.json"), "utf8"));
    check("--nuevo-origen: installationId nuevo (≠ origen), marcas de ambos almacenes reescritas y 0 sesiones", instRest.value !== facts.installationIdOrigen && markerU.installationId === instRest.value && (await q<{ n: number }>(restoredUrl, `SELECT count(*)::int AS n FROM "Session"`))[0].n === 0);
    const trig = await q<{ n: number }>(restoredUrl, `SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'ConfigRevision_immutable'`);
    const immut = await q<{ n: number }>(restoredUrl, `SELECT count(*)::int AS n FROM "ConfigRevision"`);
    check("ConfigRevision restauradas con su disparador de inmutabilidad", trig[0].n === 1 && immut[0].n === (facts.recuentosOrigen as Record<string, number>)["ConfigRevision"]);
    const active = await q<{ s: string; n: number }>(restoredUrl, `SELECT status::text AS s, count(*)::int AS n FROM "UploadBatch" GROUP BY 1 ORDER BY 1`);
    const activeOrigin = await q<{ s: string; n: number }>(originUrl, `SELECT status::text AS s, count(*)::int AS n FROM "UploadBatch" GROUP BY 1 ORDER BY 1`);
    check("Lotes por estado iguales al origen (incluidos activos/cola)", JSON.stringify(active) === JSON.stringify(activeOrigin), JSON.stringify(active));
    const qj0 = await q<{ id: string; status: string }>(restoredUrl, `SELECT id, status::text AS status FROM "ExportJob" ORDER BY id`);
    const beforeJobs = qj0.length;

    // 9) Cuenta de prueba nueva y web COMPILADA restaurada (puerto distinto, secreto propio, modo OPERATIVO).
    const acct = await run([TSX, path.join(ROOT, "scripts/crear-cuenta.ts"), "--correo", newEmail, "--nombre", "Cuenta nueva restaurado", "--rol", "admin"], ({ ...restoredEnv(), CSAPP_CUENTA_CLAVE: newPass }) as NodeJS.ProcessEnv);
    check("Cuenta de prueba nueva creada en la base restaurada (herramienta de cuentas, con su propio secreto)", acct.code === 0, acct.err.slice(0, 200));
    const tOps0 = Date.now();
    const webR = keep(start("web-restaurado", [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT_RESTORED)], restoredEnv(), D.logs));
    const tReady = await waitHttp(`${baseRestored}/login`);
    await q(restoredUrl, `DELETE FROM "RateLimit"`);
    const cookieNew = await signIn(baseRestored, newEmail, newPass);
    const first = await snapshot(baseRestored, cookieNew, "/comparativa?modo=FULL_MONTH");
    timings["puesta operativa: web restaurada lista (arranque → login → primera vista)"] = Date.now() - tOps0;
    timings["arranque de la web restaurada hasta responder"] = tReady;
    check("Web restaurada (compilada, modo operativo, secreto propio): login HTTP con la cuenta nueva y primera vista 200", first.status === 200 && first.text.length > 500);
    const stale = await fetch(`${baseRestored}/comparativa`, { headers: { cookie: cookieOrigin }, redirect: "manual" });
    check("La cookie de sesión del ORIGEN no es válida en el restaurado (redirige a /login, no 200)", stale.status >= 300 && stale.status < 400 && /\/login/.test(stale.headers.get("location") ?? ""), `${stale.status} ${stale.headers.get("location")}`);
    const staleApi = await fetch(`${baseRestored}/api/analitica/comparativa.csv`, { headers: { cookie: cookieOrigin }, redirect: "manual" });
    check("Con la cookie del origen la API analítica del restaurado rechaza (401/redirección)", staleApi.status === 401 || (staleApi.status >= 300 && staleApi.status < 400), String(staleApi.status));

    // 10) Paridad de las vistas, detalles, cobertura, conciliación y CSV: (a) con la cuenta de prueba NUEVA y (b) con la cuenta del origen (propietaria de las exportaciones).
    await q(restoredUrl, `DELETE FROM "RateLimit"`);
    const cookieOwner = await signIn(baseRestored, adminEmail, adminPass); // el propietario conserva su cuenta (hash restaurado)
    const diffsDir = path.join(D.logs, "paridad");
    await mkdir(diffsDir, { recursive: true });
    const excerpt = (a: string, b: string) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return `pos ${i}: «${a.slice(Math.max(0, i - 40), i + 90)}» ≠ «${b.slice(Math.max(0, i - 40), i + 90)}»`; };
    const parity = async (tag: string, cookie: string, withOwnerRoutes: boolean) => {
      const bad: string[] = [];
      const hrefBad: string[] = [];
      let compared = 0;
      for (const r of routes) {
        if (r.owner && !withOwnerRoutes) continue;
        const s = await snapshot(baseRestored, cookie, r.route);
        const ref = REF.get(r.name)!;
        compared++;
        const textOk = s.status === ref.status && s.sha === ref.sha;
        const keepHref = (hs: string[]) => (withOwnerRoutes ? hs : hs.filter((h) => !h.startsWith("/api/exportaciones/")));
        const hrefOk = JSON.stringify(keepHref(s.hrefs)) === JSON.stringify(keepHref(ref.hrefs));
        if (!textOk) { bad.push(r.name); await writeFile(path.join(diffsDir, `${tag}-${r.name.replace(/[^\w]+/g, "_")}.txt`), `REF:\n${ref.text}\n\nRESTAURADO:\n${s.text}\n`); }
        else if (!hrefOk) hrefBad.push(r.name);
        check(`Paridad (${tag}) · ${r.name}: ${textOk ? "contenido idéntico" : "DIFERENTE"}${textOk && !hrefOk ? " (enlaces distintos)" : ""}`, textOk && hrefOk, textOk ? `enlaces: ${keepHref(ref.hrefs).filter((h, i) => h !== keepHref(s.hrefs)[i]).slice(0, 2).join(" | ")}` : `HTTP ${s.status}/${ref.status}; ${excerpt(ref.text, s.text)}`);
      }
      return { compared, textoDistinto: bad, enlacesDistintos: hrefBad };
    };
    const parityNew = await timed("paridad HTTP (cuenta nueva)", () => parity("cuenta nueva", cookieNew, false));
    const parityOwner = await timed("paridad HTTP (cuenta del origen)", () => parity("cuenta del origen", cookieOwner, true));
    facts.paridad = { cuentaNueva: parityNew, cuentaDelOrigen: parityOwner, normalizacion: "se ignoran las marcas temporales (fecha-hora) y el panel «Sus exportaciones recientes» (lista propia de cada persona; su estado se comprueba aparte como propietario); se compara el texto visible de <main>, la lista de enlaces y el contenido de los CSV/JSON; el sello «Referencia de datos» SÍ se compara" };

    // 11) Exportación restaurada: descarga como propietario con SHA-256; la caducada sigue caducada.
    const dlR = await fetch(`${baseRestored}/api/exportaciones/${readyExp.id}/archivo/${dataFile.id}`, { headers: { cookie: cookieOwner } });
    const bufR = Buffer.from(await dlR.arrayBuffer());
    check("Exportación restaurada vigente: descarga HTTP 200 como PROPIETARIO y SHA-256 = checksum registrado = descarga del origen", dlR.status === 200 && createHash("sha256").update(bufR).digest("hex") === dataFile.checksum && bufR.equals(dlBuf), `${dlR.status}`);
    const stR = await (await fetch(`${baseRestored}/api/exportaciones/${expiredExp.id}/estado`, { headers: { cookie: cookieOwner } })).json() as { status?: string };
    const expDl = await fetch(`${baseRestored}/api/exportaciones/${expiredExp.id}/archivo/${randomUUID()}`, { headers: { cookie: cookieOwner }, redirect: "manual" });
    check("La exportación caducada sigue CADUCADA en el restaurado (sin archivo, descarga rechazada)", stR.status === "EXPIRED" && expDl.status >= 400, `${stR.status} ${expDl.status}`);
    const nonOwner = await fetch(`${baseRestored}/api/exportaciones/${readyExp.id}/archivo/${dataFile.id}`, { headers: { cookie: cookieNew }, redirect: "manual" });
    facts.descargaNoPropietarioAdminNuevo = nonOwner.status;
    await stop(webR);

    // 12) Arranque DELIBERADO del trabajador compilado restaurado: retoma la cola sin duplicar ni publicar parcialmente.
    const stagedBefore = (await q<{ n: number }>(restoredUrl, `SELECT count(*)::int AS n FROM "UploadStagedRow" WHERE "batchId" = $1`, [pendingUpload.id]))[0].n;
    const ticketsBefore = (await q<{ n: number }>(restoredUrl, `SELECT count(*)::int AS n FROM "ZdTicket"`))[0].n;
    const exportFilesBefore = (await q<{ n: number }>(restoredUrl, `SELECT count(*)::int AS n FROM "ExportFile"`))[0].n;
    const wr = keep(start("trabajador-restaurado", [path.join(ROOT, "worker-dist/worker.mjs")], restoredEnv({ CSAPP_WORKER_ID: "trabajador-restaurado-ensayo" }), D.logs));
    const tW0 = Date.now();
    let exportDone = false;
    let uploadDone = false;
    while (Date.now() - tW0 < 180_000 && !(exportDone && uploadDone)) {
      await sleep(500);
      exportDone = (await q<{ s: string }>(restoredUrl, `SELECT status::text AS s FROM "ExportJob" WHERE id = $1`, [queuedExport.id]))[0].s === "READY";
      uploadDone = ["READY", "REJECTED", "FAILED"].includes((await q<{ s: string }>(restoredUrl, `SELECT status::text AS s FROM "UploadBatch" WHERE id = $1`, [pendingUpload.id]))[0].s);
    }
    timings["trabajador restaurado: cola pendiente retomada y terminada"] = Date.now() - tW0;
    const wInst = await q<{ id: string; state: string }>(restoredUrl, `SELECT id, state::text AS state FROM "WorkerInstance" WHERE id = 'trabajador-restaurado-ensayo'`);
    check("El trabajador restaurado arranca (modo operativo, almacenes con la identidad NUEVA), se registra y latea", wInst.length === 1, JSON.stringify(wInst));
    const qe = (await q<{ s: string; attempts: number }>(restoredUrl, `SELECT status::text AS s, attempts FROM "ExportJob" WHERE id = $1`, [queuedExport.id]))[0];
    const qeFiles = await q<{ storageId: string; checksum: string; kind: string }>(restoredUrl, `SELECT "storageId", checksum, kind FROM "ExportFile" WHERE "jobId" = $1 ORDER BY kind`, [queuedExport.id]);
    let filesOk = qeFiles.length >= 1;
    for (const f of qeFiles) filesOk &&= (await sha256File(path.join(D.rExports, "files", f.storageId)).catch(() => ({ sha256: "" }))).sha256 === f.checksum;
    check("Exportación en cola: el trabajador restaurado la completa (READY) con archivos cuyo SHA-256 coincide, sin parciales", exportDone && qe.s === "READY" && filesOk, JSON.stringify({ qe, files: qeFiles.length }));
    const batchR = (await q<{ s: string; rowsReceived: number; rowsImported: number }>(restoredUrl, `SELECT status::text AS s, "rowsReceived", "rowsImported" FROM "UploadBatch" WHERE id = $1`, [pendingUpload.id]))[0];
    const stagedAfter = (await q<{ n: number }>(restoredUrl, `SELECT count(*)::int AS n FROM "UploadStagedRow" WHERE "batchId" = $1`, [pendingUpload.id]))[0].n;
    const prepJobs = await q<{ status: string; kind: string; attempts: number }>(restoredUrl, `SELECT status::text AS status, kind::text AS kind, attempts FROM "UploadJob" WHERE "batchId" = $1`, [pendingUpload.id]);
    check("Lote pendiente: el trabajador lo PREPARA una sola vez (un UploadJob, DONE, 1 intento), queda READY con 25 filas recibidas y nada se publica sin confirmar", batchR.s === "READY" && prepJobs.length === 1 && prepJobs[0].status === "DONE" && prepJobs[0].attempts === 1 && batchR.rowsReceived === 25 && stagedAfter >= 25 && stagedBefore === 0 && batchR.rowsImported === 0 && (await q<{ n: number }>(restoredUrl, `SELECT count(*)::int AS n FROM "ZdTicket"`))[0].n === ticketsBefore, JSON.stringify({ batchR, prepJobs, stagedBefore, stagedAfter }));
    const jobsAfter = (await q<{ n: number }>(restoredUrl, `SELECT count(*)::int AS n FROM "ExportJob"`))[0].n;
    const exportFilesAfter = (await q<{ n: number }>(restoredUrl, `SELECT count(*)::int AS n FROM "ExportFile"`))[0].n;
    const readyDup = (await q<{ n: number }>(restoredUrl, `SELECT count(*)::int AS n FROM (SELECT "jobId", "fileKey", part FROM "ExportFile" GROUP BY 1, 2, 3 HAVING count(*) > 1) d`))[0].n;
    check("Sin duplicados: mismo número de ExportJob que antes de arrancar, ningún (trabajo, archivo, parte) repetido y las exportaciones previas intactas", jobsAfter === beforeJobs && readyDup === 0 && exportFilesAfter === exportFilesBefore + qeFiles.length, `${beforeJobs}→${jobsAfter}; archivos ${exportFilesBefore}→${exportFilesAfter}`);
    const leftovers = (await readdir(path.join(D.rExports, "tmp")).catch(() => [])).filter((n) => n.endsWith(".part"));
    const onDisk = (await readdir(path.join(D.rExports, "files"))).length;
    check("Sin archivos temporales colgando y todos los archivos del almacén restaurado están referenciados por la base", leftovers.length === 0 && onDisk === exportFilesAfter, `${leftovers.length} parciales; ${onDisk} en disco / ${exportFilesAfter} en base`);
    await stop(wr);
    const wAfter = await q<{ state: string }>(restoredUrl, `SELECT state::text AS state FROM "WorkerInstance" WHERE id = 'trabajador-restaurado-ensayo'`);
    check("El trabajador restaurado se detiene de forma ordenada (STOPPED)", wAfter[0]?.state === "STOPPED", JSON.stringify(wAfter));
    facts.trabajadorRestaurado = { exportacion: qe, archivosExportacion: qeFiles.length, lote: batchR, trabajosDelLote: prepJobs };

    // 13) La fuente quedó intacta.
    const cOrigin2 = new Client(pgClientConfig(parsePgUrl(originUrl)));
    await cOrigin2.connect();
    const ctrlAfter = await collectControls(cOrigin2);
    await cOrigin2.end();
    const filesAfter = { uploads: await storeHashes(D.uploads), exports: await storeHashes(D.exports) };
    check("FUENTE INTACTA: mismos recuentos, identidades y contenido por tabla que antes de la copia", diffControls(ctrlBefore, ctrlAfter).length === 0, diffControls(ctrlBefore, ctrlAfter).map((d) => `${d.table}.${d.field}`).join(", "));
    check("FUENTE INTACTA: mismos archivos y SHA-256 en ambos almacenes que antes de la copia (incluidos temporales y marcas)", JSON.stringify(filesAfter) === JSON.stringify(filesBefore));
    facts.cronometria_s = Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, Math.round(v / 100) / 10]));
  } finally {
    for (const p of procs) await stop(p, "SIGTERM", 5000).catch(() => undefined);
    await dropRestored().catch(() => undefined);
    if (!KEEP) await rm(root, { recursive: true, force: true }).catch(() => undefined);
    else console.log(`Directorio temporal conservado: ${root}`);
    await prisma.$disconnect().catch(() => undefined);
  }
  const failed = checks.filter((c) => !c.ok);
  const salida = arg("salida", path.join(tmpdir(), "csapp-ensayo-restauracion.json")) as string;
  await writeFile(salida, JSON.stringify({ fecha: new Date().toISOString(), resumen: { pass: checks.length - failed.length, fail: failed.length, total: checks.length }, checks, tiempos_ms: timings, hechos: facts }, null, 2));
  console.log(`\nResumen: ${checks.length - failed.length} PASS, ${failed.length} FAIL de ${checks.length}. Resultados en ${salida}`);
  return failed.length === 0 ? 0 : 1;
}

main().then((c) => process.exit(c), (e: unknown) => { console.error(`ENSAYO ABORTADO: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
