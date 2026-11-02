import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { prisma } from "@/lib/db";
import { createBackup, type CreateOptions } from "@/server/ops/backup/create";
import { parsePgUrl, pgClientConfig } from "@/server/ops/backup/pgtools";
import { ensureInstallationId, verifyStore } from "@/server/ops/stores";
import { resetDatabase, makeUsers } from "./helpers";
import { addClient, addGroup } from "./economia-helpers";

/**
 * Fixtures de CSAPP-10 §7-8: una instalación sintética mínima pero REPRESENTATIVA (usuarios, grupo y cliente, lotes con su archivo original, cola pendiente,
 * ConfigRevision, cobertura declarada, ReconRun y exportaciones: una LISTA vigente con archivo real y checksum, una caducada y una en cola) sobre la base de
 * pruebas aprobada y almacenes temporales PROPIOS en una carpeta con ESPACIOS (cubre rutas de Windows con espacios en la carpeta de usuario).
 */
export const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

export type World = {
  root: string;
  uploads: string;
  exports: string;
  state: string;
  backups: string;
  admin: { id: string };
  reader: { id: string };
  installationId: string;
  files: { uploadDone: { storageId: string; sha: string; bytes: number }; uploadQueued: { storageId: string; sha: string }; exportReady: { storageId: string; sha: string; jobId: string }; exportExpiredJobId: string };
  cleanup: () => Promise<void>;
};

const saved: Record<string, string | undefined> = {};
const KEYS = ["CSAPP_UPLOAD_DIR", "CSAPP_EXPORT_DIR", "CSAPP_STATE_DIR", "BETTER_AUTH_URL"];

/** `web` apunta a un puerto donde nadie escucha (la web «está parada»). */
export async function makeWorld(): Promise<World> {
  const root = await mkdtemp(path.join(tmpdir(), "csapp copia ensayo "));
  const uploads = path.join(root, "Mis Datos", "originales");
  const exports = path.join(root, "Mis Datos", "exportaciones");
  const state = path.join(root, "estado");
  const backups = path.join(root, "copias de seguridad");
  await mkdir(uploads, { recursive: true });
  await mkdir(exports, { recursive: true });
  await mkdir(state, { recursive: true });
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.CSAPP_UPLOAD_DIR = uploads;
  process.env.CSAPP_EXPORT_DIR = exports;
  process.env.CSAPP_STATE_DIR = state;
  process.env.BETTER_AUTH_URL = "http://127.0.0.1:1"; // puerto cerrado: la web no responde

  await resetDatabase();
  const { admin, reader } = await makeUsers();
  const installationId = await ensureInstallationId();
  for (const kind of ["uploads", "exports"] as const) await verifyStore(kind, installationId, { create: true });

  const g = await addGroup("Atlas");
  const c = await addClient("Atlas 1", g.id);
  await prisma.configRevision.create({ data: { family: "QUALITY", revisionNo: 1, payload: { x: 1 }, reason: "Configuración inicial", kind: "INITIAL", activatedById: admin.id } });
  await prisma.reconRun.create({ data: { actorId: admin.id, params: { scope: "group" }, stamp: "stamp-1", readAt: new Date(), results: [], manifest: {}, summary: { ok: 1 } } });
  await prisma.session.create({ data: { token: `tok-${randomUUID()}`, userId: admin.id, expiresAt: new Date(Date.now() + 86_400_000) } });
  void c;

  // Carga COMPLETADA con su original, y una carga en cola (trabajo PENDING) con el suyo.
  const mkUpload = async (status: "COMPLETED" | "QUEUED", content: string) => {
    const storageId = randomUUID();
    const buf = Buffer.from(content);
    await writeFile(path.join(uploads, "files", storageId), buf).catch(async () => { await mkdir(path.join(uploads, "files"), { recursive: true }); await writeFile(path.join(uploads, "files", storageId), buf); });
    const b = await prisma.uploadBatch.create({ data: { profileId: "zendesk-tiempo", profileVersion: 1, status, originalName: "export ñ.xlsx", storageId, fileFormat: "xlsx", sizeBytes: BigInt(buf.length), checksum: sha(buf), createdById: admin.id } });
    return { b, storageId, sha: sha(buf), bytes: buf.length };
  };
  const done = await mkUpload("COMPLETED", "contenido original completado\n".repeat(50));
  const queued = await mkUpload("QUEUED", "contenido original en cola\n".repeat(30));
  await prisma.uploadJob.create({ data: { batchId: queued.b.id, kind: "PREPARE", status: "PENDING", actorId: admin.id } });

  // Exportaciones: LISTA vigente con archivo real, CADUCADA (sin archivo) y EN COLA.
  const mkJob = (status: "READY" | "EXPIRED" | "QUEUED", extra: Record<string, unknown> = {}) =>
    prisma.exportJob.create({ data: { ownerId: admin.id, dataset: "horas", query: { dataset: "horas" }, status, formatVersion: "csv-v1", engineVersion: "eco-v2+calidad-v2", configRevisions: {}, requestedStamp: "s", requestedReadAt: new Date(), requestedTotals: { horas: 1 }, ...extra } });
  const exportBytes = Buffer.from("﻿a;b\n1;2\n".repeat(40));
  const readyJob = await mkJob("READY", { finishedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000), rowCount: 40n });
  const exportStorageId = randomUUID();
  await mkdir(path.join(exports, "files"), { recursive: true });
  await writeFile(path.join(exports, "files", exportStorageId), exportBytes);
  await prisma.exportFile.create({ data: { jobId: readyJob.id, fileKey: "horas", kind: "horas", name: "horas.csv", rows: 40n, bytes: BigInt(exportBytes.length), checksum: sha(exportBytes), storageId: exportStorageId } });
  const expired = await mkJob("EXPIRED", { finishedAt: new Date(Date.now() - 172_800_000), expiresAt: new Date(Date.now() - 86_400_000), phase: "caducada" });
  await mkJob("QUEUED", { phase: "en cola" });

  // Temporales y sondas que NO deben copiarse.
  await mkdir(path.join(uploads, "incoming"), { recursive: true });
  await writeFile(path.join(uploads, "incoming", `${randomUUID()}.part`), "parcial");
  await mkdir(path.join(exports, "tmp"), { recursive: true });
  await writeFile(path.join(exports, "tmp", `${randomUUID()}.1.1.part`), "parcial");
  await writeFile(path.join(exports, ".sonda-1-abcd"), "ok");

  return {
    root, uploads, exports, state, backups, admin, reader, installationId,
    files: { uploadDone: { storageId: done.storageId, sha: done.sha, bytes: done.bytes }, uploadQueued: { storageId: queued.storageId, sha: queued.sha }, exportReady: { storageId: exportStorageId, sha: sha(exportBytes), jobId: readyJob.id }, exportExpiredJobId: expired.id },
    cleanup: async () => {
      for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
      await rm(root, { recursive: true, force: true });
    },
  };
}

export const baseOpts = (w: World, extra: Partial<CreateOptions> = {}): CreateOptions => ({
  destino: w.backups, dbUrl: process.env.DATABASE_URL as string, uploadsDir: w.uploads, exportsDir: w.exports, stateDir: w.state, webStopped: false, ...extra,
});
export const makeBackup = (w: World, extra: Partial<CreateOptions> = {}) => createBackup(baseOpts(w, extra));

// ---------------------------------------------------------------- Bases de restauración propias (cs_app_bk…_test)

const OWN = /^cs_app_bk[a-z0-9_]*_test$/;
async function adminClient(): Promise<Client> {
  const conn = { ...parsePgUrl(process.env.DATABASE_URL as string), database: "postgres" };
  const c = new Client(pgClientConfig(conn));
  await c.connect();
  return c;
}
/** URL de una base propia de las pruebas de copia (mismo servidor y credenciales que la de pruebas aprobada). */
export function ownDbUrl(name: string): string {
  if (!OWN.test(name)) throw new Error("Solo se usan bases propias cs_app_bk…_test.");
  const u = new URL(process.env.DATABASE_URL as string);
  u.pathname = `/${name}`;
  return u.toString();
}
/** Retira una base PROPIA de pruebas (limpieza de la prueba; nunca la herramienta de restauración). */
export async function dropOwnDb(name: string): Promise<void> {
  if (!OWN.test(name)) throw new Error("Solo se retiran bases propias cs_app_bk…_test.");
  const c = await adminClient();
  try { await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); } finally { await c.end(); }
}
/** Crea una base PROPIA vacía (para comprobar que la restauración acepta una base preexistente vacía). */
export async function createOwnDb(name: string): Promise<void> {
  if (!OWN.test(name)) throw new Error("Solo se crean bases propias cs_app_bk…_test.");
  const c = await adminClient();
  try { await c.query(`CREATE DATABASE "${name}"`); } finally { await c.end(); }
}
export async function dbExists(name: string): Promise<boolean> {
  const c = await adminClient();
  try { return (await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount === 1; } finally { await c.end(); }
}

/** Ejecutable doble de pg_dump (script Node con shebang). `mode`: «falla» sale con error tras escribir un volcado parcial. Solo POSIX. */
export async function fakePgDump(dir: string, mode: "falla" | "parcial-y-ok-vacio"): Promise<string> {
  const f = path.join(dir, `pg_dump_doble_${randomBytes(3).toString("hex")}`);
  const body = mode === "falla"
    ? `#!/usr/bin/env node\nif(process.argv.includes("--version")){console.log("pg_dump (PostgreSQL) 16.15");process.exit(0);}\nconst fs=require("fs");const i=process.argv.indexOf("-f");if(i>0)fs.writeFileSync(process.argv[i+1],"PGDMP-parcial");process.stderr.write("pg_dump: error: simulado");process.exit(1);\n`
    : `#!/usr/bin/env node\nif(process.argv.includes("--version")){console.log("pg_dump (PostgreSQL) 16.15");process.exit(0);}\nconst fs=require("fs");const i=process.argv.indexOf("-f");if(i>0)fs.writeFileSync(process.argv[i+1],"");process.exit(0);\n`;
  await writeFile(f, body);
  chmodSync(f, 0o755);
  return f;
}
