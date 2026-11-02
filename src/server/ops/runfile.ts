import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { appRoot } from "@/lib/runtime";

/**
 * Archivo de ejecución del supervisor (CSAPP-10 §3): identifica SUS procesos (supervisor, web, trabajador) y su vigencia por latido propio. `parar` solo
 * actúa sobre lo que está registrado aquí; nunca busca procesos por nombre. Sin dependencias de shell (Windows y Linux).
 */
export type RunFile = { token: string; root: string; port: number; host: string; supervisorPid: number; webPid: number | null; workerPid: number | null; workerId: string; startedAt: string; heartbeatAt: string; sha: string; stopRequested?: boolean };

export const stateDir = (env: Record<string, string | undefined> = process.env) => path.resolve(/*turbopackIgnore: true*/ env.CSAPP_STATE_DIR || path.join(appRoot(), "estado-runtime"));
export const runFilePath = (dir = stateDir()) => path.join(dir, "cs-app.run.json");
export const stopRequestPath = (dir = stateDir()) => path.join(dir, "cs-app.stop");
export const RUNFILE_FRESH_MS = 30_000;

export async function readRunFile(dir = stateDir()): Promise<RunFile | null> {
  try { return JSON.parse(await readFile(runFilePath(dir), "utf8")) as RunFile; } catch { return null; }
}
export async function writeRunFile(r: RunFile, dir = stateDir()): Promise<void> {
  await mkdir(dir, { recursive: true });
  const tmp = `${runFilePath(dir)}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(r, null, 2));
  await rename(tmp, runFilePath(dir));
}
export async function clearRunFile(dir = stateDir()): Promise<void> {
  await rm(runFilePath(dir), { force: true });
  await rm(stopRequestPath(dir), { force: true });
}
export const isPidAlive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };
/** Una instancia está en marcha si su supervisor vive Y su latido es reciente (protege frente a PID reutilizados). */
export function runFileLive(r: RunFile | null, now = Date.now()): boolean {
  return !!r && isPidAlive(r.supervisorPid) && now - new Date(r.heartbeatAt).getTime() < RUNFILE_FRESH_MS;
}
