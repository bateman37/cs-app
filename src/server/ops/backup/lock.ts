import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isPidAlive, stateDir } from "../runfile";

/**
 * Bloqueo de copia (CSAPP-10 §7): `backup.lock` en el directorio de estado, con PID y latido. Impide dos copias/restauraciones a la vez y permite que
 * `ops iniciar` se niegue a arrancar mientras haya una copia en curso (`backupLockLive`). Vigencia por LATIDO (protege frente a PID reutilizados o a un
 * proceso muerto que dejó el archivo): sin latido reciente el bloqueo se considera caducado y puede retomarse. Sin dependencias de base ni de shell.
 */
export type BackupLock = { token: string; pid: number; host: string; kind: "crear" | "restaurar"; startedAt: string; heartbeatAt: string };
export const BACKUP_LOCK_FRESH_MS = 30_000;
export const BACKUP_LOCK_BEAT_MS = 5_000;
export const backupLockPath = (dir = stateDir()) => path.join(dir, "backup.lock");

export class BackupBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupBusyError";
  }
}

async function read(dir: string): Promise<BackupLock | null> {
  try { return JSON.parse(await readFile(backupLockPath(dir), "utf8")) as BackupLock; } catch { return null; }
}
const fresh = (l: BackupLock | null, now: number) => !!l && Number.isFinite(new Date(l.heartbeatAt).getTime()) && now - new Date(l.heartbeatAt).getTime() < BACKUP_LOCK_FRESH_MS && isPidAlive(l.pid);

/** ¿Hay una copia/restauración en curso? Consultado por `ops iniciar`. */
export async function backupLockLive(dir: string = stateDir(), now = Date.now()): Promise<boolean> {
  return fresh(await read(dir), now);
}

export async function readBackupLock(dir: string = stateDir()): Promise<BackupLock | null> {
  return read(dir);
}

export type HeldLock = { token: string; release: () => Promise<void> };

/** Adquiere el bloqueo (creación exclusiva `wx`) y lo mantiene con latido. Un bloqueo caducado se retira (se aparta por renombrado) y se reintenta. */
export async function acquireBackupLock(kind: BackupLock["kind"], dir: string = stateDir(), opts: { beatMs?: number } = {}): Promise<HeldLock> {
  await mkdir(dir, { recursive: true });
  const token = randomUUID();
  const mine = (): BackupLock => ({ token, pid: process.pid, host: hostname().slice(0, 100), kind, startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() });
  const file = backupLockPath(dir);
  let created = false;
  for (let attempt = 0; attempt < 3 && !created; attempt++) {
    try {
      await writeFile(file, JSON.stringify(mine(), null, 2), { flag: "wx" });
      created = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const cur = await read(dir);
      if (fresh(cur, Date.now())) throw new BackupBusyError(`Ya hay una copia o restauración en curso (PID ${cur!.pid}, ${cur!.kind}, desde ${cur!.startedAt}). No se inicia otra.`);
      // Caducado: se aparta con un nombre único (si dos procesos compiten, solo uno lo consigue) y se reintenta.
      await rename(file, `${file}.caducado-${token.slice(0, 8)}`).catch(() => undefined);
      await rm(`${file}.caducado-${token.slice(0, 8)}`, { force: true }).catch(() => undefined);
    }
  }
  if (!created) throw new BackupBusyError("No se pudo adquirir el bloqueo de copia (otro proceso lo disputa). Reintente.");
  let alive = true;
  const beat = async () => {
    const cur = await read(dir);
    if (!alive || !cur || cur.token !== token) return; // ya no es nuestro: no se reescribe
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ ...cur, heartbeatAt: new Date().toISOString() }, null, 2)).then(() => rename(tmp, file)).catch(() => undefined);
  };
  const timer = setInterval(() => void beat(), opts.beatMs ?? BACKUP_LOCK_BEAT_MS);
  timer.unref?.();
  return {
    token,
    release: async () => {
      alive = false;
      clearInterval(timer);
      const cur = await read(dir);
      if (cur?.token === token) await rm(file, { force: true });
    },
  };
}
