import "dotenv/config";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { databaseNameOf } from "../../src/lib/env";

/**
 * Núcleo del recorrido de navegador: protección de base, preparación de datos sintéticos,
 * ciclo de vida de `next start` y utilidades de comprobación. Los casos viven en ./casos.
 * Escrito con spawn de Node (sin shell) para que no dependa de bash; no está probado en Windows.
 */
export const PORT = Number(process.env.E2E_PORT ?? 3101);
export const BASE = `http://localhost:${PORT}`;
const ROOT = path.resolve(import.meta.dirname, "../..");

export type Result = { label: string; ok: boolean; detail?: string };

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Falta TEST_DATABASE_URL (base aislada, nombre acabado en _test).");
  const name = databaseNameOf(url);
  if (!/^cs_app(_[a-z0-9]+)*_test$/.test(name)) throw new Error(`TEST_DATABASE_URL debe acabar en _test. Recibido: ${name || "(vacío)"}.`);
  if (process.env.DATABASE_URL && databaseNameOf(process.env.DATABASE_URL) === name) {
    throw new Error("TEST_DATABASE_URL no puede ser la misma base que DATABASE_URL.");
  }
  return url;
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
  /** Arranca/detiene el trabajador de cargas construido (`npm run worker:build`) contra la base de test. */
  startWorker(): Promise<void>;
  stopWorker(): Promise<void>;
};

let server: ChildProcess | null = null;
let worker: ChildProcess | null = null;

async function startWorkerProcess(dbUrl: string): Promise<void> {
  if (worker) return;
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

/** Aplica migraciones a la base de test (nunca a otra) y la vacía. */
export async function prepareDatabase(dbUrl: string, prisma: Ctx["prisma"]): Promise<void> {
  // testDatabaseUrl() ya comprobó el nombre y que difiere de DATABASE_URL; aquí se reafirma antes de vaciar.
  if (!/^cs_app(_[a-z0-9]+)*_test$/.test(databaseNameOf(dbUrl))) throw new Error("Destino no es una base de test.");
  execFileSync(process.execPath, [path.join(ROOT, "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: dbUrl, SHADOW_DATABASE_URL: "" },
    stdio: "pipe",
  });
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

export async function runAll(casos: ((ctx: Ctx) => Promise<void>)[]): Promise<number> {
  const dbUrl = testDatabaseUrl();
  process.env.DATABASE_URL = dbUrl;
  process.env.BETTER_AUTH_URL = BASE;
  process.env.BETTER_AUTH_SECRET ||= randomBytes(24).toString("hex");
  const { prisma } = await import("../../src/lib/db");
  const { provisionAccount } = await import("../../src/server/accounts");
  await prepareDatabase(dbUrl, prisma);
  // Cargas: almacén temporal propio y perfiles sintéticos, SOLO porque este destino es una base de test
  // comprobada (las tres condiciones del registro: variable = nombre de la base, sufijo _test, esquema marcador).
  const uploadDir = await mkdtemp(path.join(tmpdir(), "csapp-e2e-cargas-"));
  process.env.CSAPP_UPLOAD_DIR = uploadDir;
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
        ctx.check(`El caso ${caso.name || "(anónimo)"} terminó sin error inesperado`, false, e instanceof Error ? e.message.split("\n")[0] : "error");
      }
    }
  } finally {
    await browser?.close();
    await stopWorkerProcess();
    await stopServer();
    await rm(uploadDir, { recursive: true, force: true });
    await prisma.$disconnect();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nResumen: ${results.length - failed} PASS, ${failed} FAIL, ${results.length} comprobaciones ejecutadas.`);
  return failed === 0 ? 0 : 1;
}
