import "dotenv/config";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "pg";
import { resolveTestTarget } from "../src/lib/test-guard";

/**
 * Ensayo de instalación y operación (CSAPP-10 §3-4): sobre una base NUEVA `cs_app_inst_test` y carpetas temporales propias, con el web y el trabajador COMPILADOS
 * (`npm run build:todo` previo) y la configuración mínima de PRODUCCIÓN (sin variables de prueba): verificar → migrar (y repetir) → preparar → primer Administrador
 * (y repetir sin sobrescribir) → iniciar → salud → entrar → estado vacío honesto → segundo arranque rechazado → parar de forma ordenada → reiniciar con persistencia →
 * parada final sin procesos huérfanos; y arranque/parada del trabajador suelto (`npm run worker:start`). Solo mutación: su propia base y sus propios directorios.
 * Uso: npm run ensayo:instalacion   (salida: evidencias PASS/FAIL y JSON en $TMP/csapp10-ensayo-instalacion.json)
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const DB = "cs_app_inst_test";
const PORT = Number(process.env.ENSAYO_PORT ?? 3121);
const results: { label: string; ok: boolean; detail?: string }[] = [];
const out: Record<string, unknown> = {};
const check = (label: string, ok: boolean, detail?: string) => { results.push({ label, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${String(results.length).padStart(2, "0")} ${label}${!ok && detail ? ` — ${detail}` : ""}`); };
const tsx = (args: string[], env: Record<string, string | undefined>, input?: string) => spawnSync(process.execPath, [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), ...args], { cwd: ROOT, env: env as NodeJS.ProcessEnv, encoding: "utf8", input, timeout: 300_000 });
const alive = (pid: number | null | undefined) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };

async function main() {
  const approved = resolveTestTarget(); // exige TEST_DATABASE_URL explícita y de prueba; el destino del ensayo es OTRA base de prueba propia
  const admin = new URL(approved.url); admin.pathname = "/postgres"; admin.search = "";
  const target = new URL(approved.url); target.pathname = `/${DB}`; target.search = "?schema=public";
  if (!/^cs_app(_[a-z0-9]+)*_test$/.test(DB) || DB === approved.target.name) throw new Error("Destino del ensayo no seguro.");
  const pg = new Client({ connectionString: admin.toString() }); await pg.connect();
  await pg.query(`DROP DATABASE IF EXISTS ${DB}`); await pg.query(`CREATE DATABASE ${DB}`); await pg.end();

  const base = await mkdtemp(path.join(tmpdir(), "csapp10-inst con espacios-")); // ruta con ESPACIOS a propósito
  const uploads = path.join(base, "datos", "originales"), exports = path.join(base, "datos", "exportaciones"), state = path.join(base, "estado");
  const password = randomBytes(12).toString("hex");
  const secret = randomBytes(24).toString("hex");
  // Entorno de PRODUCCIÓN mínimo: ni TEST_DATABASE_URL, ni SHADOW, ni opciones de prueba; .env del repositorio NO se lee.
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, NODE_ENV: "production", DOTENV_CONFIG_PATH: path.join(base, "no-existe.env"),
    DATABASE_URL: target.toString(), BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: `http://127.0.0.1:${PORT}`, CSAPP_PORT: String(PORT), CSAPP_HOST: "127.0.0.1",
    CSAPP_UPLOAD_DIR: uploads, CSAPP_EXPORT_DIR: exports, CSAPP_STATE_DIR: state, CSAPP_HOME: ROOT,
    CSAPP_WORKER_HEARTBEAT_MS: "1000", CSAPP_WORKER_POLL_MS: "500", CSAPP_WORKER_STOP_TIMEOUT_MS: "20000", TEST_DATABASE_URL: "", SHADOW_DATABASE_URL: "",
  };
  const t0 = Date.now();
  const fase: Record<string, number> = {};
  const lap = (k: string) => { fase[k] = Math.round((Date.now() - t0) / 100) / 10; };
  const base_url = `http://127.0.0.1:${PORT}`;
  let sup: ChildProcess | null = null;
  const supLog: string[] = [];
  try {
    // 1) Verificación previa
    const v = tsx(["scripts/ops.ts", "verificar", "--puerto"], env);
    out.verificar = v.stdout;
    check("Verificar: sin errores con la configuración de producción mínima (versiones, base, permisos, rutas con espacios, secreto, origen, espacio, puerto)", v.status === 0, v.stdout.split("\n").filter((l) => /ERROR/.test(l)).join(" | "));
    check("Verificar: no imprime ni la clave de la base ni el secreto", !v.stdout.includes(secret) && !v.stdout.includes(new URL(approved.url).password || "\u0000"));
    const bad = tsx(["scripts/ops.ts", "verificar"], { ...env, BETTER_AUTH_SECRET: "corto", CSAPP_UPLOAD_DIR: "relativa/ruta", CSAPP_EXPORT_DIR: "relativa/ruta" });
    check("Verificar: secreto corto y rutas relativas son errores accionables (código ≠ 0)", bad.status === 1 && /SECRETO_CORTO/.test(bad.stdout) && /UPLOAD_DIR_RELATIVA|ALMACENES_IGUALES/.test(bad.stdout), bad.stdout.slice(-300));
    lap("verificar");
    // 2) Migraciones incrementales (con el comando de producción) y repetición
    const m1 = spawnSync(process.execPath, [path.join(ROOT, "node_modules/prisma/build/index.js"), "migrate", "deploy"], { cwd: ROOT, env: env as NodeJS.ProcessEnv, encoding: "utf8" });
    const nMig = (m1.stdout.match(/applied|Applying migration/gi) ?? []).length;
    check("Migrar: «prisma migrate deploy» aplica las nueve migraciones sobre la base vacía", m1.status === 0 && /9 migrations/.test(m1.stdout + m1.stderr) || nMig >= 9, (m1.stdout + m1.stderr).slice(-200));
    const m2 = spawnSync(process.execPath, [path.join(ROOT, "node_modules/prisma/build/index.js"), "migrate", "deploy"], { cwd: ROOT, env: env as NodeJS.ProcessEnv, encoding: "utf8" });
    check("Migrar: repetir es idempotente («No pending migrations»)", m2.status === 0 && /No pending migrations/i.test(m2.stdout + m2.stderr));
    lap("migrar");
    // 3) Preparar almacenes y primer Administrador
    const p1 = tsx(["scripts/ops.ts", "preparar"], env);
    check("Preparar: enlaza la instalación con sus dos almacenes privados distintos", p1.status === 0 && existsSync(path.join(uploads, ".csapp-store.json")) && existsSync(path.join(exports, ".csapp-store.json")), p1.stdout + p1.stderr);
    const idA = JSON.parse(await readFile(path.join(uploads, ".csapp-store.json"), "utf8")).installationId;
    tsx(["scripts/ops.ts", "preparar"], env);
    check("Preparar: repetirlo no cambia la identidad de la instalación", JSON.parse(await readFile(path.join(uploads, ".csapp-store.json"), "utf8")).installationId === idA);
    const acc = (extra: Record<string, string | undefined> = {}) => tsx(["scripts/crear-cuenta.ts", "--correo", "admin@ensayo.local", "--nombre", "Admin Ensayo", "--rol", "admin"], { ...env, CSAPP_CUENTA_CLAVE: password, ...extra });
    const a1 = acc();
    check("Cuenta: primer Administrador creado con contraseña por entrada segura (variable de sesión, no argumento)", a1.status === 0 && /Cuenta creada/.test(a1.stdout) && !a1.stdout.includes(password));
    const a2 = acc({ CSAPP_CUENTA_CLAVE: "otra-clave-distinta-123" });
    check("Cuenta: repetir no crea otra cuenta ni sobrescribe la clave", a2.status === 0 && /ya existe/.test(a2.stdout));
    lap("preparar y cuenta");

    // 4) Arranque coordinado
    const start = () => { const c = spawn(process.execPath, [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), "scripts/ops.ts", "iniciar"], { cwd: ROOT, env: env as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] }); c.stdout?.on("data", (d: Buffer) => supLog.push(d.toString())); c.stderr?.on("data", (d: Buffer) => supLog.push(d.toString())); return c; };
    const waitHealth = async (ms = 90_000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const r = await fetch(`${base_url}/api/salud`); if (r.status === 200) return await r.json() as { status: string }; } catch { /* aún no */ } await sleep(500); } return null; };
    sup = start();
    const h1 = await waitHealth();
    lap("arranque");
    check("Salud pública mínima: responde 200 con solo {status}", !!h1 && Object.keys(h1).join() === "status", JSON.stringify(h1));
    const run1 = JSON.parse(await readFile(path.join(state, "cs-app.run.json"), "utf8")) as { supervisorPid: number; webPid: number; workerPid: number };
    check("Supervisor: registra sus tres procesos (supervisor, web, trabajador) y están vivos", alive(run1.supervisorPid) && alive(run1.webPid) && alive(run1.workerPid));

    // Entrar por HTTP real (Better Auth) y leer el detalle de salud como Administrador
    const login = await fetch(`${base_url}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: base_url }, body: JSON.stringify({ email: "admin@ensayo.local", password }) });
    const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    check("Entrar: el primer Administrador inicia sesión (HTTP 200 y cookie de sesión)", login.status === 200 && cookie.length > 10, String(login.status));
    await sleep(2500);
    const det = await (await fetch(`${base_url}/api/administracion/salud`, { headers: { cookie } })).json() as { overall: string; workers: { verdict: string }; schema: { state: string; applied: number }; stores: { marker: string; writable: boolean }[]; version: { sha: string } };
    out.saludDetalle = det;
    check("Salud detallada (Administrador): trabajador «presente en reposo» SIN ningún trabajo, esquema compatible y almacenes enlazados y escribibles", det.workers.verdict === "presente_en_reposo" && det.schema.state === "ok" && det.schema.applied === 9 && det.stores.every((s) => s.marker === "ok" && s.writable), JSON.stringify({ w: det.workers.verdict, s: det.schema, st: det.stores }));
    check("Salud detallada: sin sesión no se sirve (401/redirección al acceso)", [401, 307, 302].includes((await fetch(`${base_url}/api/administracion/salud`, { redirect: "manual" })).status));
    const html = await (await fetch(`${base_url}/comparativa`, { headers: { cookie } })).text();
    check("Estado vacío honesto: Comparativa sin datos no muestra cifras ni colores inventados", /No hay|sin datos|Todavía no|vacío/i.test(html) && !/\b(Verde|Rojo)\b.*€\/jornada/.test(html));
    const second = spawnSync(process.execPath, [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), "scripts/ops.ts", "iniciar"], { cwd: ROOT, env: env as NodeJS.ProcessEnv, encoding: "utf8", timeout: 120_000 });
    check("Segundo arranque rechazado: no crea una instancia accidental (ya hay una; puerto ocupado)", second.status === 1 && /Ya hay una instancia|ocupado/.test(second.stderr + second.stdout), (second.stderr + second.stdout).slice(-200));
    check("El rechazo no mató ni alteró la primera instancia", alive(run1.supervisorPid) && alive(run1.webPid) && alive(run1.workerPid));

    // 5) Persistencia: un dato mínimo propio, parada ordenada, reinicio
    const pgc = new Client({ connectionString: target.toString().replace(/\?schema=.*/, "") }); await pgc.connect();
    await pgc.query(`INSERT INTO "ClientGroup"(id, name, "updatedAt") VALUES ('gp1', 'Grupo persistente', now())`);
    const stop1 = tsx(["scripts/ops.ts", "parar"], env);
    lap("parada 1");
    check("Parar: cierre ordenado (código 0) y ningún proceso registrado sigue vivo", stop1.status === 0 && !alive(run1.supervisorPid) && !alive(run1.webPid) && !alive(run1.workerPid), stop1.stdout + stop1.stderr);
    const w = (await pgc.query(`SELECT state, "stoppedAt" FROM "WorkerInstance" ORDER BY "startedAt" DESC LIMIT 1`)).rows[0];
    check("Parar: el trabajador queda registrado como DETENIDO (no «ausente») y la salud lo distingue", w.state === "STOPPED" && !!w.stoppedAt);
    check("Parar: el registro de ejecución se elimina (el siguiente arranque no se confunde)", !existsSync(path.join(state, "cs-app.run.json")));
    sup = start();
    const h2 = await waitHealth();
    const login2 = await fetch(`${base_url}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: base_url }, body: JSON.stringify({ email: "admin@ensayo.local", password }) });
    const cookie2 = login2.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const groups = await (await fetch(`${base_url}/administracion/clientes`, { headers: { cookie: cookie2 } })).text();
    check("Reinicio: la cuenta y los datos persisten (el Grupo creado antes de parar sigue ahí) y la clave original sigue siendo la válida", !!h2 && login2.status === 200 && /Grupo persistente/.test(groups));
    const bad2 = await fetch(`${base_url}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: base_url }, body: JSON.stringify({ email: "admin@ensayo.local", password: "otra-clave-distinta-123" }) });
    check("Reinicio: la clave del segundo intento de «crear cuenta» NO sustituyó a la original", bad2.status !== 200);
    const run2 = JSON.parse(await readFile(path.join(state, "cs-app.run.json"), "utf8")) as { supervisorPid: number; webPid: number; workerPid: number };
    const stop2 = tsx(["scripts/ops.ts", "parar"], env);
    check("Parada final: sin procesos huérfanos (supervisor, web y trabajador terminados)", stop2.status === 0 && !alive(run2.supervisorPid) && !alive(run2.webPid) && !alive(run2.workerPid));
    lap("parada 2");
    const orphan = spawnSync("pgrep", ["-f", `${ROOT}/worker-dist/worker.mjs`], { encoding: "utf8" });
    check("Parada final: ningún proceso worker.mjs de esta carpeta queda vivo", orphan.stdout.trim() === "", orphan.stdout);

    // 6) Trabajador suelto (`npm run worker:start`): late en reposo y se detiene con SIGTERM
    const wk = spawn(process.execPath, [path.join(ROOT, "worker-dist/worker.mjs")], { cwd: ROOT, env: { ...env, CSAPP_WORKER_ID: "trabajador-suelto" } as unknown as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
    const wlog: string[] = []; wk.stdout?.on("data", (d: Buffer) => wlog.push(d.toString())); wk.stderr?.on("data", (d: Buffer) => wlog.push(d.toString()));
    await sleep(4000);
    const idle = (await pgc.query(`SELECT state, "lastSeenAt" > now() - interval '5 seconds' AS fresh FROM "WorkerInstance" WHERE id = 'trabajador-suelto'`)).rows[0];
    check("Trabajador suelto: registra su instancia y late en reposo", idle?.state === "IDLE" && idle?.fresh === true, JSON.stringify(idle));
    wk.kill("SIGTERM");
    const code = await new Promise<number | null>((res) => { wk.once("exit", (c) => res(c)); setTimeout(() => res(-1), 30_000); });
    const stopped = (await pgc.query(`SELECT state FROM "WorkerInstance" WHERE id = 'trabajador-suelto'`)).rows[0];
    check("Trabajador suelto: SIGTERM → cierre ordenado (código 0) y estado DETENIDO", code === 0 && stopped.state === "STOPPED", `${code} ${stopped.state}`);
    check("Registros del trabajador con fecha, nivel e instancia", wlog.join("").split("\n").filter(Boolean).every((l) => /^\d{4}-\d\d-\d\dT[\d:.]+Z (INFO|WARN|ERROR) trabajador-suelto /.test(l)), wlog.join("").slice(0, 200));
    await pgc.end();
    out.fases = fase;
    out.log = supLog.join("").split("\n").slice(-12);
  } finally {
    if (sup && alive(sup.pid)) { tsx(["scripts/ops.ts", "parar"], env); await sleep(1500); if (alive(sup.pid)) sup.kill("SIGKILL"); }
    await writeFile(path.join(tmpdir(), "csapp10-ensayo-instalacion.json"), JSON.stringify({ results, ...out }, null, 2));
    await rm(base, { recursive: true, force: true });
    const pg2 = new Client({ connectionString: admin.toString() }); await pg2.connect(); await pg2.query(`DROP DATABASE IF EXISTS ${DB}`); await pg2.end(); // solo su propia base de ensayo
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nResumen: ${results.length - failed} PASS, ${failed} FAIL.`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message.split("\n")[0] : "error"); process.exit(2); });
