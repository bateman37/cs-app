import "dotenv/config";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "pg";
import { resolveTestTarget } from "../src/lib/test-guard";

/**
 * Ensayo de actualización 09 → 10 y de vuelta atrás de CÓDIGO (CSAPP-10 §9), sobre una base propia `cs_app_upg_test` con DATOS sembrados por el código de 09.
 * Requiere un checkout COMPILADO de 09 (`ENSAYO_ANTERIOR=/ruta` con `npm run build` y `node scripts/build-worker.mjs`).
 * Fases: sembrar con 09 → huella → migrar con el comando de producción de 10 → huella (idéntica en toda tabla anterior) → arrancar 10, salud, entrar → parar →
 * código 09 (compilado) sobre el esquema nuevo: arranca, entra y lee sin alterar datos → huella → volver a 10. Solo muta su propia base y sus directorios.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const OLD = process.env.ENSAYO_ANTERIOR;
const DB = "cs_app_upg_test";
const PORT = Number(process.env.ENSAYO_PORT ?? 3131);
const results: { label: string; ok: boolean; detail?: string }[] = [];
const out: Record<string, unknown> = {};
const check = (label: string, ok: boolean, detail?: string) => { results.push({ label, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${String(results.length).padStart(2, "0")} ${label}${!ok && detail ? ` — ${detail}` : ""}`); };
const run = (cwd: string, cmd: string, args: string[], env: Record<string, string | undefined>, timeout = 900_000) => spawnSync(cmd, args, { cwd, env: env as NodeJS.ProcessEnv, encoding: "utf8", timeout });
const node = process.execPath;
const alive = (pid?: number | null) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };

async function main() {
  if (!OLD) throw new Error("Indique ENSAYO_ANTERIOR=/ruta/al/checkout/compilado/de/09");
  const approved = resolveTestTarget();
  const adminUrl = new URL(approved.url); adminUrl.pathname = "/postgres"; adminUrl.search = "";
  const target = new URL(approved.url); target.pathname = `/${DB}`; target.search = "?schema=public";
  if (DB === approved.target.name) throw new Error("Destino no seguro.");
  const adm = new Client({ connectionString: adminUrl.toString() }); await adm.connect();
  await adm.query(`DROP DATABASE IF EXISTS ${DB}`); await adm.query(`CREATE DATABASE ${DB}`); await adm.end();
  const base = await mkdtemp(path.join(tmpdir(), "csapp10-upg con espacios-"));
  const uploads = path.join(base, "originales"), exports = path.join(base, "exportaciones"), state = path.join(base, "estado");
  const secret = randomBytes(24).toString("hex");
  const prod: Record<string, string | undefined> = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, NODE_ENV: "production", DOTENV_CONFIG_PATH: path.join(base, "no.env"), DATABASE_URL: target.toString(), BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: `http://127.0.0.1:${PORT}`, CSAPP_PORT: String(PORT), PORT: String(PORT), CSAPP_UPLOAD_DIR: uploads, CSAPP_EXPORT_DIR: exports, CSAPP_STATE_DIR: state, CSAPP_WORKER_HEARTBEAT_MS: "1000", CSAPP_WORKER_POLL_MS: "500", CSAPP_WORKER_STOP_TIMEOUT_MS: "20000", TEST_DATABASE_URL: "", SHADOW_DATABASE_URL: "" };
  const cli = (args: string[], env = prod) => run(ROOT, node, [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), ...args], env);
  const prisma = (cwd: string, args: string[], env = prod) => run(cwd, node, [path.join(cwd, "node_modules/prisma/build/index.js"), ...args], env);
  const huella = async (file: string) => { const r = cli(["scripts/huella-datos.ts", file]); if (r.status !== 0) throw new Error(`huella: ${r.stderr}`); return JSON.parse(await readFile(file, "utf8")) as { tablas: Record<string, { n: number; md5: string }>; totalFilas: number }; };
  const waitHealth = async (ms = 90_000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/api/salud`); if (r.status === 200) return await r.json(); } catch { /* aún no */ } await sleep(500); } return null; };
  const login = async (email: string, password: string) => { const r = await fetch(`http://127.0.0.1:${PORT}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: `http://127.0.0.1:${PORT}` }, body: JSON.stringify({ email, password }) }); return { status: r.status, cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") }; };
  const t0 = Date.now(); const fase: Record<string, number> = {}; const lap = (k: string) => { fase[k] = Math.round((Date.now() - t0) / 100) / 10; };
  const kids: ChildProcess[] = [];
  try {
    // 1) Instalación 09 con DATOS de 09 (esquema de 8 migraciones y sembrado por el código de 09)
    const m09 = prisma(OLD, ["migrate", "deploy"]);
    check("09: migrate deploy aplica las ocho migraciones de 09", m09.status === 0 && /8 migrations/.test(m09.stdout + m09.stderr), (m09.stdout + m09.stderr).slice(-200));
    const seedEnv = { ...prod, NODE_ENV: undefined, TEST_DATABASE_URL: target.toString(), DATABASE_URL: approved.url.replace(approved.target.name, "cs_app"), CSAPP_EXPORT_DIR: undefined, CSAPP_UPLOAD_DIR: undefined };
    const seed = run(OLD, node, [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), "scripts/volumen-calidad.ts", "80", "4000", "3000"], seedEnv, 1_200_000);
    check("09: el código de 09 siembra datos sintéticos representativos (grupos, tiempos, tickets, fotografías, Health, cobertura, exportación y conciliación)", seed.status === 0, (seed.stderr || seed.stdout).slice(-300));
    lap("sembrado con 09");
    const applied09 = new Client({ connectionString: target.toString().replace(/\?schema=.*/, "") }); await applied09.connect();
    const nMig09 = (await applied09.query(`SELECT count(*)::int n FROM _prisma_migrations`)).rows[0].n;
    const hasNew = (await applied09.query(`SELECT to_regclass('public."WorkerInstance"') t`)).rows[0].t;
    await applied09.end();
    check("Antes de actualizar: 8 migraciones y todavía sin las tablas de 10", nMig09 === 8 && hasNew === null, `${nMig09} ${hasNew}`);
    const pre = await huella(path.join(base, "huella-09.json"));
    out.huellaPrevia = { tablas: Object.keys(pre.tablas).length, filas: pre.totalFilas };
    check("Huella previa: hay datos en las tablas de 09 (no una base vacía)", pre.totalFilas > 5000 && pre.tablas["ZdTimeEntry"]?.n > 1000, `${pre.totalFilas}`);
    // 2) Actualización con el código de 10
    const ver = cli(["scripts/ops.ts", "salud"]);
    check("Con el código de 10 y el esquema de 09, la salud advierte «migraciones pendientes» (no arranca a ciegas)", /ESQUEMA_PENDIENTE/.test(ver.stdout), ver.stdout.slice(0, 300));
    const up = prisma(ROOT, ["migrate", "deploy"]);
    check("Actualizar: el comando de producción aplica SOLO la migración nueva, sin reset", up.status === 0 && /20261105090000_operacion_latido_instalacion/.test(up.stdout + up.stderr) && !/20261029200318|20261104090000/.test(up.stdout.split("have been applied")[1] ?? ""), (up.stdout + up.stderr).slice(-200));
    const prep = cli(["scripts/ops.ts", "preparar"]);
    check("Preparar: los almacenes (nuevos) se enlazan a la instalación", prep.status === 0, prep.stdout + prep.stderr);
    const post = await huella(path.join(base, "huella-10.json"));
    const diffs = Object.keys(pre.tablas).filter((t) => post.tablas[t]?.md5 !== pre.tablas[t].md5 || post.tablas[t]?.n !== pre.tablas[t].n);
    out.huellaPosterior = { tablas: Object.keys(post.tablas).length, filas: post.totalFilas, diferencias: diffs };
    check("Tras actualizar: la huella de CADA tabla anterior es idéntica (datos conservados bit a bit)", diffs.length === 0, diffs.join(","));
    lap("actualizar");
    // 3) Arranque de 10 sobre datos de 09
    const sup = spawn(node, [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), "scripts/ops.ts", "iniciar"], { cwd: ROOT, env: prod as NodeJS.ProcessEnv, stdio: "ignore" }); kids.push(sup);
    const h = await waitHealth();
    check("10 arranca sobre los datos de 09 y su salud es correcta", !!h && (h as { status: string }).status === "ok", JSON.stringify(h));
    const { status: ls, cookie } = await login("vol@test.local", "clave-de-prueba-123");
    const pages: Record<string, number> = {};
    for (const p of ["/comparativa", "/analisis-cliente", "/pulse-rent", "/calidad?fecha=2026-10-31&modo=FULL_MONTH", "/administracion/cargas", "/administracion/operacion"]) pages[p] = (await fetch(`http://127.0.0.1:${PORT}${p}`, { headers: { cookie } })).status;
    out.paginas10 = pages;
    check("10: la cuenta de 09 entra y las cuatro vistas y Administración responden 200", ls === 200 && Object.values(pages).every((s) => s === 200), JSON.stringify(pages));
    const st1 = cli(["scripts/ops.ts", "parar"]);
    check("10: parada ordenada", st1.status === 0, st1.stdout + st1.stderr);
    // Leer las vistas por primera vez crea, de forma perezosa y en cualquier versión, la revisión INICIAL de configuración: es lo ÚNICO que puede cambiar respecto a la huella previa.
    const used = await huella(path.join(base, "huella-10-uso.json"));
    const LAZY = new Set(["EconomicSettingsRevision", "ConfigRevision"]);
    const dUse = Object.keys(used.tablas).filter((t) => !pre.tablas[t] || used.tablas[t].md5 !== pre.tablas[t].md5);
    out.cambiosPorPrimerUso = dUse;
    check("Tras usar 10: solo cambian las revisiones iniciales de configuración creadas de forma perezosa en la primera lectura", dUse.every((t) => LAZY.has(t)), dUse.join(","));
    lap("arranque 10");
    // 4) Vuelta atrás de CÓDIGO: 09 compilado sobre el esquema de 10 (solo añadió tablas)
    const web09 = spawn(node, [path.join(OLD, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT)], { cwd: OLD, env: prod as NodeJS.ProcessEnv, stdio: "ignore" }); kids.push(web09);
    const wk09 = spawn(node, [path.join(OLD, "worker-dist/worker.mjs")], { cwd: OLD, env: prod as NodeJS.ProcessEnv, stdio: "ignore" }); kids.push(wk09);
    let up09 = false; for (let i = 0; i < 120 && !up09; i++) { try { up09 = (await fetch(`http://127.0.0.1:${PORT}/login`)).status === 200; } catch { /* aún no */ } await sleep(500); }
    const l09 = await login("vol@test.local", "clave-de-prueba-123");
    const pages09: Record<string, number> = {};
    for (const p of ["/comparativa", "/analisis-cliente", "/pulse-rent", "/calidad?fecha=2026-10-31&modo=FULL_MONTH", "/administracion/cargas"]) pages09[p] = (await fetch(`http://127.0.0.1:${PORT}${p}`, { headers: { cookie: l09.cookie } })).status;
    out.paginas09SobreEsquema10 = pages09;
    check("Vuelta atrás de código: 09 compilado arranca sobre el esquema de 10, la cuenta entra y las cuatro vistas responden 200", up09 && l09.status === 200 && Object.values(pages09).every((s) => s === 200), JSON.stringify(pages09));
    await sleep(2500);
    for (const k of [wk09, web09]) { k.kill("SIGTERM"); }
    await sleep(3000);
    check("Vuelta atrás de código: 09 se detiene", !alive(web09.pid) && !alive(wk09.pid));
    const back = await huella(path.join(base, "huella-09-sobre-10.json"));
    const diffs2 = Object.keys(used.tablas).filter((t) => back.tablas[t]?.md5 !== used.tablas[t].md5 || back.tablas[t]?.n !== used.tablas[t].n);
    check("Vuelta atrás de código: usar 09 sobre el esquema de 10 no alteró ningún dato (huella idéntica a la de antes de volver)", diffs2.length === 0, diffs2.join(","));
    lap("vuelta atrás de código");
    // 5) Volver a avanzar a 10 (sin migraciones pendientes)
    const again = prisma(ROOT, ["migrate", "deploy"]);
    check("Volver a 10: no hay migraciones pendientes y la instalación sigue consistente", /No pending migrations/i.test(again.stdout + again.stderr));
    const s2 = cli(["scripts/ops.ts", "salud"]);
    check("Volver a 10: salud sin errores de esquema ni almacenes", !/ESQUEMA_|MIGRACION_|ALMACEN_/.test(s2.stdout), s2.stdout.slice(0, 300));
    out.fases = fase;
  } finally {
    for (const k of kids) if (alive(k.pid)) try { k.kill("SIGKILL"); } catch { /* ya terminado */ }
    cli(["scripts/ops.ts", "parar"]);
    await writeFile(path.join(tmpdir(), "csapp10-ensayo-actualizacion.json"), JSON.stringify({ results, ...out }, null, 2));
    await rm(base, { recursive: true, force: true });
    const a2 = new Client({ connectionString: adminUrl.toString() }); await a2.connect(); await a2.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`); await a2.end(); // solo SU base de ensayo (nombre fijado y comprobado arriba)
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nResumen: ${results.length - failed} PASS, ${failed} FAIL.`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message.split("\n")[0] : "error"); process.exit(2); });
