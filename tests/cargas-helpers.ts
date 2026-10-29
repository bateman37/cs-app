import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { prisma } from "@/lib/db";
import { databaseNameOf } from "@/lib/env";
import { receiveUpload } from "@/server/uploads/batches";
import { runOnce } from "@/server/uploads/worker";
import { resetDatabase, makeUsers } from "./helpers";
import { dropSyntheticSchema, resetSynthetic, setupSyntheticSchema } from "./synthetic/schema";
import { resetRegistryCache } from "@/server/uploads/registry";

/** Habilita los perfiles sintéticos SOLO para esta ejecución de pruebas (base _test comprobada). */
export function enableSynthetic() {
  process.env.CSAPP_ENABLE_SYNTHETIC_PROFILES = databaseNameOf(process.env.DATABASE_URL ?? "");
}

export function useUploadDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "csapp-cargas-"));
  process.env.CSAPP_UPLOAD_DIR = dir;
  return dir;
}

export function removeUploadDir(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

export async function freshEnvironment() {
  enableSynthetic();
  const base = process.env.CSAPP_UPLOAD_DIR;
  if (base) {
    rmSync(path.join(base, "files"), { recursive: true, force: true });
    rmSync(path.join(base, "incoming"), { recursive: true, force: true });
  }
  await resetDatabase();
  await dropSyntheticSchema();
  await setupSyntheticSchema();
  await resetSynthetic();
  resetRegistryCache();
  return makeUsers();
}

export function metaHeader(perfil: object = {}, declarado: object = {}) {
  return Buffer.from(JSON.stringify({ perfil, declarado })).toString("base64");
}

/** Sube un texto como archivo mediante el servicio (mismo camino que la ruta API). */
export async function uploadText(
  actorId: string,
  text: string | Buffer,
  opts: { profileId?: string; name?: string; metadata?: object; declared?: object } = {},
) {
  const buf = typeof text === "string" ? Buffer.from(text) : text;
  return receiveUpload(actorId, {
    profileId: opts.profileId ?? "sintetico-incorporar",
    originalName: opts.name ?? "datos.csv",
    metadata: opts.metadata ?? {},
    declared: opts.declared ?? {},
    contentLength: buf.length,
    body: Readable.from([buf]),
  });
}

/** Procesa trabajos en el propio proceso hasta vaciar la cola (equivale a un trabajador). */
export async function drain(workerId = "test-worker", max = 50): Promise<number> {
  let n = 0;
  while (n < max && (await runOnce(workerId))) n++;
  return n;
}

export async function batch(id: string) {
  return prisma.uploadBatch.findUniqueOrThrow({ where: { id } });
}

export async function waitFor<T>(fn: () => Promise<T | null | false | undefined>, timeoutMs = 60_000, stepMs = 200): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error("Tiempo de espera agotado");
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

let built = false;
export function buildWorker() {
  if (built) return;
  execFileSync(process.execPath, ["scripts/build-worker.mjs"], { cwd: process.cwd(), stdio: "pipe" });
  built = true;
}

/** Arranca el trabajador REAL construido (proceso hijo) contra la base de test. */
export function spawnWorker(extraEnv: Record<string, string> = {}): ChildProcess & { output: string[] } {
  buildWorker();
  const child = spawn(process.execPath, ["worker-dist/worker.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  }) as ChildProcess & { output: string[] };
  child.output = [];
  child.stdout?.on("data", (d: Buffer) => child.output.push(d.toString()));
  child.stderr?.on("data", (d: Buffer) => child.output.push(d.toString()));
  return child;
}

export function killAndWait(child: ChildProcess, signal: NodeJS.Signals = "SIGKILL"): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode) return resolve();
    child.once("exit", () => resolve());
    child.kill(signal);
  });
}
