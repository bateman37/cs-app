import "dotenv/config";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { databaseNameOf } from "../../src/lib/env";
import { activateTestTarget, assertSameDatabase, guardedTruncateAll, resolveTestTarget, type ApprovedTarget } from "../../src/lib/test-guard";

/**
 * Núcleo del recorrido de navegador: protección de base, preparación de datos sintéticos,
 * ciclo de vida de `next start` y utilidades de comprobación. Los casos viven en ./casos.
 * Escrito con spawn de Node (sin shell) para que no dependa de bash; no está probado en Windows.
 */
export const PORT = Number(process.env.E2E_PORT ?? 3101);
export const BASE = `http://localhost:${PORT}`;
const ROOT = path.resolve(import.meta.dirname, "../..");

export type Result = { label: string; ok: boolean; detail?: string };

/** Destino de pruebas aprobado (guard central, CSAPP-07 §3). Lanza antes de modificar nada si no es seguro. */
export function testDatabaseUrl(): string {
  return resolveTestTarget().url;
}

export type Accounts = { adminEmail: string; adminPassword: string; readerEmail: string; readerPassword: string };

export type Ctx = {
  base: string;
  browser: Browser;
  accounts: Accounts;
  prisma: import("../../src/generated/prisma/client").PrismaClient;
  results: Result[];
  /** Registra una comprobación numerada; nunca lanza. */
  check(label: string, ok: boolean, detail?: string): void;
  restartServer(): Promise<void>;
  /** Directorio temporal de subida de Cargas (privado, borrado al terminar). */
  uploadDir: string;
  /** Almacén temporal de exportaciones (CSAPP-09), separado del de originales. */
  exportDir: string;
  /** Arranca/detiene el trabajador de cargas construido (`npm run worker:build`) contra la base de test. */
  startWorker(): Promise<void>;
  stopWorker(): Promise<void>;
};

let server: ChildProcess | null = null;
let worker: ChildProcess | null = null;
/** PID de los procesos propios (web compilada y trabajador compilado) para medir su memoria durante todo un intervalo. */
export const ownPids = () => ({ web: server?.pid ?? null, worker: worker?.pid ?? null });

async function startWorkerProcess(dbUrl: string): Promise<void> {
  if (worker) return;
  assertSameDatabase(dbUrl, resolveTestTarget().url, "El trabajador de cargas"); // web, trabajador y preparación comparten el destino aprobado
  const bundle = path.join(ROOT, "worker-dist/worker.mjs");
  worker = spawn(process.execPath, [bundle], {
    cwd: ROOT,
    env: { ...serverEnv(dbUrl), CSAPP_WORKER_POLL_MS: "300" },
    stdio: "ignore",
  });
}

async function stopWorkerProcess(): Promise<void> {
  if (!worker) return;
  const w = worker;
  worker = null;
  await new Promise<void>((resolve) => {
    w.once("exit", () => resolve());
    w.kill("SIGTERM");
    setTimeout(() => {
      w.kill("SIGKILL");
      resolve();
    }, 8000);
  });
}

function serverEnv(dbUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: dbUrl,
    BETTER_AUTH_URL: BASE,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || randomBytes(24).toString("hex"),
    NODE_ENV: "production",
    PORT: String(PORT),
  };
}

async function waitReady(): Promise<void> {
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${BASE}/login`, { redirect: "manual" });
      if (r.status === 200) return;
    } catch {
      /* aún no arranca */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("`next start` no respondió en 60 s.");
}

export async function startServer(dbUrl: string): Promise<void> {
  assertSameDatabase(dbUrl, resolveTestTarget().url, "El proceso web");
  const nextBin = path.join(ROOT, "node_modules/next/dist/bin/next");
  server = spawn(process.execPath, [nextBin, "start", "-p", String(PORT)], { cwd: ROOT, env: serverEnv(dbUrl), stdio: "ignore" });
  await waitReady();
}

export async function stopServer(): Promise<void> {
  if (!server) return;
  const s = server;
  server = null;
  await new Promise<void>((resolve) => {
    s.once("exit", () => resolve());
    s.kill("SIGTERM");
    setTimeout(() => {
      s.kill("SIGKILL");
      resolve();
    }, 5000);
  });
}

/**
 * Aplica migraciones a la base de test (nunca a otra) y la vacía. ANTES de cualquier migración o TRUNCATE comprueba, en la conexión efectiva
 * que ejecutará la operación, que `current_database()` es el destino aprobado; si no coincide no se modifica nada.
 */
export async function prepareDatabase(approved: ApprovedTarget | string, prisma: Ctx["prisma"]): Promise<void> {
  const target = typeof approved === "string" ? resolveTestTarget({ ...process.env, TEST_DATABASE_URL: approved }) : approved;
  const { assertConnectedTo } = await import("../../src/lib/test-guard");
  await assertConnectedTo(prisma, target.target.name); // falla antes de migrar o vaciar
  execFileSync(process.execPath, [path.join(ROOT, "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: target.url, SHADOW_DATABASE_URL: "" },
    stdio: "pipe",
  });
  await guardedTruncateAll(prisma, target);
}

export async function runAll(casos: ((ctx: Ctx) => Promise<void>)[]): Promise<number> {
  // El entorno de pruebas se fija ANTES de importar ningún singleton; un cliente ya conectado a otra base hace fallar aquí, sin mutar nada.
  const approved = activateTestTarget();
  const dbUrl = approved.url;
  process.env.BETTER_AUTH_URL = BASE;
  process.env.BETTER_AUTH_SECRET ||= randomBytes(24).toString("hex");
  const { prisma } = await import("../../src/lib/db");
  const { provisionAccount } = await import("../../src/server/accounts");
  assertSameDatabase(process.env.DATABASE_URL ?? "", dbUrl, "El cliente de preparación");
  await prepareDatabase(approved, prisma);
  // Cargas: almacén temporal propio y perfiles sintéticos, SOLO porque este destino es una base de test
  // comprobada (las tres condiciones del registro: variable = nombre de la base, sufijo _test, esquema marcador).
  const uploadDir = await mkdtemp(path.join(tmpdir(), "csapp-e2e-cargas-"));
  process.env.CSAPP_UPLOAD_DIR = uploadDir;
  // Exportaciones (CSAPP-09): almacén temporal PROPIO y separado del de originales, compartido por web y trabajador; limpieza restringida a este directorio.
  const exportDir = await mkdtemp(path.join(tmpdir(), "csapp-e2e-exportaciones-"));
  process.env.CSAPP_EXPORT_DIR = exportDir;
  process.env.CSAPP_EXPORT_PAGE_ROWS = "500";
  process.env.CSAPP_ENABLE_SYNTHETIC_PROFILES = databaseNameOf(dbUrl);
  const { setupSyntheticSchema, resetSynthetic } = await import("../../tests/synthetic/schema");
  await setupSyntheticSchema();
  await resetSynthetic();
  // Cuentas sintéticas con contraseñas al azar en cada ejecución: no se versionan ni se imprimen.
  const accounts: Accounts = {
    adminEmail: "admin.e2e@test.local",
    adminPassword: randomBytes(12).toString("hex"),
    readerEmail: "consulta.e2e@test.local",
    readerPassword: randomBytes(12).toString("hex"),
  };
  await provisionAccount({ email: accounts.adminEmail, name: "Admin E2E", password: accounts.adminPassword, role: "ADMIN" });
  await provisionAccount({ email: accounts.readerEmail, name: "Consulta E2E", password: accounts.readerPassword, role: "CONSULTA" });

  const results: Result[] = [];
  let n = 0;
  const ctxBase = {
    base: BASE,
    accounts,
    prisma,
    results,
    check(label: string, ok: boolean, detail?: string) {
      n += 1;
      const r = { label: `${String(n).padStart(2, "0")} ${label}`, ok, detail };
      results.push(r);
      console.log(`${ok ? "PASS" : "FAIL"} ${r.label}${!ok && detail ? ` — ${detail}` : ""}`);
    },
    async restartServer() {
      await stopServer();
      await startServer(dbUrl);
    },
    uploadDir,
    exportDir,
    startWorker: () => startWorkerProcess(dbUrl),
    stopWorker: stopWorkerProcess,
  };
  let browser: Browser | null = null;
  try {
    await startServer(dbUrl);
    browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
    const ctx: Ctx = { ...ctxBase, browser };
    for (const caso of casos) {
      try {
        await caso(ctx);
      } catch (e) {
        ctx.check(`El caso ${caso.name || "(anónimo)"} terminó sin error inesperado`, false, e instanceof Error ? (e.message.split("\n").map((l) => l.trim()).filter(Boolean).slice(-2).join(" · ") || e.name) : "error");
      }
    }
  } finally {
    await browser?.close();
    await stopWorkerProcess();
    await stopServer();
    await rm(uploadDir, { recursive: true, force: true });
    await rm(exportDir, { recursive: true, force: true });
    await prisma.$disconnect();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nResumen: ${results.length - failed} PASS, ${failed} FAIL, ${results.length} comprobaciones ejecutadas.`);
  return failed === 0 ? 0 : 1;
}
