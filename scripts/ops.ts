import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { appRoot, buildInfo } from "../src/lib/runtime";
import { prisma } from "../src/lib/db";
import { collectHealth, redactedDiagnostic } from "../src/server/ops/health";
import { runPreflight, portFree, portOf } from "../src/server/ops/preflight";
import { adoptStores, ensureInstallationId, verifyStore } from "../src/server/ops/stores";
import { clearRunFile, isPidAlive, readRunFile, runFileLive, stateDir, stopRequestPath, writeRunFile, type RunFile } from "../src/server/ops/runfile";
import { requestWorkerStop } from "../src/server/ops/worker-instance";

/**
 * Herramienta operativa de CS App (CSAPP-10 §3-4). Node puro, sin Bash; funciona en PowerShell. Uso: `npm run ops -- <orden>`.
 *   verificar            comprobación previa (versiones, base, permisos, rutas, secreto, origen, espacio, herramientas). No imprime credenciales.
 *   preparar             enlaza la instalación con sus almacenes privados (idempotente; tras «npm run db:migrar»).
 *   iniciar              supervisor en primer plano: web compilada + trabajador compilado; cierre coordinado; nunca deja hijos huérfanos.
 *   parar [--forzar]     cierre ordenado de lo que ESTE supervisor registró. Nunca mata procesos por nombre.
 *   estado               procesos registrados y vigencia.
 *   salud [--json]       comprobación técnica (base, esquema, trabajador, colas, almacenes). Código de salida 0 ok / 1 degradado / 2 caído.
 *   diagnostico <ruta>   diagnóstico redactado (sin secretos ni datos de clientes).
 *   adoptar-almacenes    adopta explícitamente almacenes existentes (restauración o traslado deliberados).
 */
const cmd = process.argv[2] ?? "ayuda";
const flag = (n: string) => process.argv.includes(`--${n}`);
const ts = () => new Date().toISOString();
const log = (level: string, m: string) => console.log(`${ts()} ${level} supervisor ${m}`);
const SYMBOL = { ok: "  OK ", warn: "AVISO", error: "ERROR" } as const;

async function verificar(): Promise<number> {
  const findings = await runPreflight(process.env, { checkPort: flag("puerto") });
  for (const f of findings) console.log(`[${SYMBOL[f.level]}] ${f.code}: ${f.message}`);
  const errors = findings.filter((f) => f.level === "error").length;
  const warns = findings.filter((f) => f.level === "warn").length;
  console.log(errors ? `\n${errors} error(es) y ${warns} aviso(s): corrija los errores antes de continuar.` : `\nSin errores (${warns} aviso(s)).`);
  return errors ? 1 : 0;
}

async function preparar(): Promise<number> {
  const id = await ensureInstallationId();
  console.log(`Instalación ${id.slice(0, 8)}… registrada.`);
  let bad = 0;
  for (const kind of ["uploads", "exports"] as const) {
    const v = await verifyStore(kind, id, { create: true });
    const ok = v.state === "ok" || v.state === "creado";
    if (!ok) bad++;
    console.log(`[${ok ? "  OK " : "ERROR"}] ${kind === "uploads" ? "Originales" : "Exportaciones"} (${v.dir}): ${v.message}`);
  }
  return bad ? 1 : 0;
}

async function salud(): Promise<number> {
  const h = await collectHealth();
  if (flag("json")) console.log(JSON.stringify(h, null, 2));
  else {
    console.log(`CS App ${h.version.version} · SHA ${h.version.sha.slice(0, 12)} · ${h.overall.toUpperCase()}`);
    console.log(`Base: ${h.database.ok ? `disponible (${h.database.latencyMs} ms)` : "NO disponible"} · Esquema: ${h.schema.state} (${h.schema.applied}/${h.schema.expected})`);
    console.log(`Trabajador: ${h.workers.verdict}${h.workers.instances.filter((w) => w.alive).map((w) => ` [${w.id} ${w.state}${w.currentKind ? ` ${w.currentKind}` : ""}]`).join("")}`);
    console.log(`Cargas: ${h.queues.uploads.pending} en cola, ${h.queues.uploads.running} en curso · Exportaciones: ${h.queues.exports.pending} en cola, ${h.queues.exports.running} en curso`);
    for (const s of h.stores) console.log(`Almacén ${s.kind}: ${s.exists ? (s.writable ? "escribible" : "SIN escritura") : "AUSENTE"} · libre ${s.freeBytes === null ? "?" : `${(s.freeBytes / 1048576).toFixed(0)} MB`} · marca ${s.marker}`);
    for (const p of h.problems) console.log(`[${p.level === "error" ? "ERROR" : "AVISO"}] ${p.code}: ${p.message}`);
  }
  if (flag("web")) {
    const url = new URL("/api/salud", process.env.BETTER_AUTH_URL ?? `http://127.0.0.1:${portOf(process.env)}`);
    try { const r = await fetch(url, { signal: AbortSignal.timeout(5000) }); console.log(`Web (${url.origin}): HTTP ${r.status} ${JSON.stringify(await r.json())}`); } catch { console.log(`Web (${url.origin}): no responde.`); return 2; }
  }
  return h.overall === "ok" ? 0 : h.overall === "degradado" ? 1 : 2;
}

async function estado(): Promise<number> {
  const r = await readRunFile();
  if (!r) { console.log("No hay instancia registrada en este directorio de estado."); return 3; }
  const live = runFileLive(r);
  console.log(`Supervisor ${r.supervisorPid} (${live ? "vivo" : "NO vigente"}) · web ${r.webPid ?? "-"} (${r.webPid && isPidAlive(r.webPid) ? "vivo" : "no"}) · trabajador ${r.workerPid ?? "-"} (${r.workerPid && isPidAlive(r.workerPid) ? "vivo" : "no"}) · puerto ${r.port} · SHA ${r.sha.slice(0, 12)} · desde ${r.startedAt}`);
  return live ? 0 : 3;
}

async function iniciar(): Promise<number> {
  const root = appRoot();
  const dir = stateDir();
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const workerBin = path.join(root, "worker-dist", "worker.mjs");
  if (!existsSync(path.join(root, ".next", "BUILD_ID")) || !existsSync(workerBin)) { console.error("Faltan los artefactos compilados (.next y worker-dist). Ejecute «npm run build:todo» antes de iniciar."); return 1; }
  const bi = buildInfo();
  if (!bi.known) console.error("AVISO: no existe build-info.json: ejecute «npm run build:todo».");
  (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  const findings = await runPreflight(process.env, { checkPort: false });
  const errors = findings.filter((f) => f.level === "error");
  if (errors.length) { for (const f of errors) console.error(`[ERROR] ${f.code}: ${f.message}`); return 1; }
  const existing = await readRunFile(dir);
  if (runFileLive(existing)) { console.error(`Ya hay una instancia en marcha (supervisor ${existing!.supervisorPid}). No se inicia otra: use «npm run ops -- parar» primero.`); return 1; }
  const host = process.env.CSAPP_HOST || "127.0.0.1";
  const port = portOf(process.env);
  if (!(await portFree(port, host))) { console.error(`El puerto ${port} está ocupado por otro proceso. No se inicia una instancia accidental.`); return 1; }
  const live = await prisma.workerInstance.count({ where: { state: { not: "STOPPED" }, lastSeenAt: { gt: new Date(Date.now() - 45_000) } } });
  if (live > 0) { console.error(`Hay ${live} trabajador(es) vivo(s) registrado(s) en esta base (¿otra instancia o supervisor en otro directorio?). No se inicia otra.`); return 1; }
  const id = await ensureInstallationId();
  for (const kind of ["uploads", "exports"] as const) {
    const v = await verifyStore(kind, id, { create: true });
    if (v.state !== "ok" && v.state !== "creado") { console.error(`[ERROR] ${v.message}`); return 1; }
  }
  await clearRunFile(dir);
  const token = randomUUID();
  const workerId = `trabajador-${process.pid}-${token.slice(0, 8)}`;
  // Los procesos operativos no heredan bases de pruebas/shadow: se vacían (un valor definido, aunque vacío, impide que `next start` las cargue desde .env).
  const env = { ...process.env, NODE_ENV: "production", CSAPP_HOME: root, PORT: String(port), CSAPP_WORKER_ID: workerId, TEST_DATABASE_URL: "", SHADOW_DATABASE_URL: "" } as NodeJS.ProcessEnv;
  let stopping = false;
  const kids: { name: string; p: ChildProcess }[] = [];
  const run: RunFile = { token, root, port, host, supervisorPid: process.pid, webPid: null, workerPid: null, workerId, startedAt: ts(), heartbeatAt: ts(), sha: bi.sha };
  const start = (name: string, args: string[]) => {
    const p: ChildProcess = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit", windowsHide: true });
    kids.push({ name, p });
    p.once("exit", (code, sig) => {
      log(stopping ? "INFO" : "ERROR", `${name} terminó (${sig ?? `código ${code}`}).`);
      if (!stopping) void shutdown(`${name} terminó de forma inesperada`, 1);
    });
    return p;
  };
  let exitCode = 0;
  const stopTimeoutMs = (Number(process.env.CSAPP_WORKER_STOP_TIMEOUT_MS) > 0 ? Number(process.env.CSAPP_WORKER_STOP_TIMEOUT_MS) : 120_000) + 15_000;
  async function shutdown(why: string, code = 0) {
    if (stopping) return;
    stopping = true;
    exitCode = code;
    log("INFO", `Cierre coordinado: ${why}.`);
    run.stopRequested = true;
    await writeRunFile(run, dir).catch(() => undefined);
    await requestWorkerStop(workerId).catch(() => undefined); // multiplataforma: no depende de señales POSIX
    for (const k of kids) { if (k.p.exitCode === null) try { k.p.kill("SIGTERM"); } catch { /* ya terminado */ } }
    const deadline = Date.now() + stopTimeoutMs;
    while (kids.some((k) => k.p.exitCode === null && k.p.signalCode === null) && Date.now() < deadline) await sleep(250);
    for (const k of kids) if (k.p.exitCode === null && k.p.signalCode === null) { log("ERROR", `${k.name} no terminó en ${Math.round(stopTimeoutMs / 1000)} s: se fuerza (solo este proceso hijo). Su trabajo no se marca completado.`); try { k.p.kill("SIGKILL"); } catch { /* ya terminado */ } exitCode = exitCode || 3; }
    await clearRunFile(dir).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(exitCode);
  }
  process.on("SIGINT", () => void shutdown("señal de parada"));
  process.on("SIGTERM", () => void shutdown("señal de parada"));
  const web = start("web", [nextBin, "start", "-p", String(port), "-H", host]);
  const worker = start("trabajador", [workerBin]);
  run.webPid = web.pid ?? null; run.workerPid = worker.pid ?? null;
  await writeRunFile(run, dir);
  log("INFO", `Instancia iniciada: web ${run.webPid} en http://${host}:${port}, trabajador ${run.workerPid}, SHA ${bi.sha.slice(0, 12)}. Parar: «npm run ops -- parar» o Ctrl+C.`);
  setInterval(() => {
    run.heartbeatAt = ts();
    void writeRunFile(run, dir).catch(() => undefined);
    if (existsSync(stopRequestPath(dir))) void shutdown("petición de «ops parar»");
  }, 2000);
  return await new Promise<number>(() => undefined);
}

async function parar(): Promise<number> {
  const dir = stateDir();
  const r = await readRunFile(dir);
  if (!r) { console.log("No hay instancia registrada: nada que parar."); return 0; }
  if (!runFileLive(r)) {
    console.log("El registro existe pero el supervisor ya no está vigente (proceso terminado o sin latido). Se limpia el registro; si quedaran procesos, ver «estado».");
    const kids = [r.webPid, r.workerPid].filter((p): p is number => !!p && isPidAlive(p));
    if (kids.length) { console.log(`AVISO: siguen vivos los procesos registrados ${kids.join(", ")}: se piden parar con SIGTERM solo a esos PID.`); for (const p of kids) try { process.kill(p, "SIGTERM"); } catch { /* ya no existe */ } }
    await clearRunFile(dir);
    return 0;
  }
  await mkdir(dir, { recursive: true });
  await writeFile(stopRequestPath(dir), `${ts()}\n`);
  await requestWorkerStop(r.workerId).catch(() => undefined);
  console.log(`Parada solicitada al supervisor ${r.supervisorPid}; esperando cierre ordenado…`);
  const timeout = (Number(process.env.CSAPP_WORKER_STOP_TIMEOUT_MS) > 0 ? Number(process.env.CSAPP_WORKER_STOP_TIMEOUT_MS) : 120_000) + 30_000;
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (!isPidAlive(r.supervisorPid)) { console.log("Instancia detenida."); return 0; } await sleep(500); }
  if (flag("forzar")) { for (const p of [r.workerPid, r.webPid, r.supervisorPid]) if (p && isPidAlive(p)) try { process.kill(p, "SIGKILL"); } catch { /* ya no existe */ } await clearRunFile(dir); console.log("Procesos registrados forzados a terminar (su trabajo en curso se recuperará por lease)."); return 3; }
  console.error("El cierre no terminó en el tiempo máximo. No se fuerza nada; repita con --forzar si desea terminar los procesos registrados.");
  return 1;
}

async function main(): Promise<number> {
  switch (cmd) {
    case "verificar": return verificar();
    case "preparar": return preparar();
    case "salud": return salud();
    case "estado": return estado();
    case "iniciar": return iniciar();
    case "parar": return parar();
    case "diagnostico": { const out = process.argv[3]; if (!out) { console.error("Indique la ruta de salida: npm run ops -- diagnostico <archivo.json>"); return 1; } await writeFile(path.resolve(out), JSON.stringify(redactedDiagnostic(await collectHealth()), null, 2)); console.log(`Diagnóstico redactado escrito en ${path.resolve(out)}.`); return 0; }
    case "adoptar-almacenes": { const id = await ensureInstallationId(); for (const v of await adoptStores(id)) console.log(`${v.kind}: ${v.message} (${v.dir})`); return 0; }
    default:
      console.log("Uso: npm run ops -- <verificar|preparar|iniciar|parar|estado|salud|diagnostico|adoptar-almacenes>  (ver docs/operacion/instalacion-operacion.md)");
      return cmd === "ayuda" ? 0 : 1;
  }
}

main().then(
  async (code) => { if (cmd !== "iniciar") { await prisma.$disconnect().catch(() => undefined); process.exit(code); } },
  async (e: unknown) => { console.error(e instanceof Error ? e.message.split("\n")[0].replace(/postgres(ql)?:\/\/\S+/g, "(URL oculta)") : "Error desconocido."); await prisma.$disconnect().catch(() => undefined); process.exit(1); },
);
