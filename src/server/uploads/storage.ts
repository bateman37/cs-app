import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { uploadConfig } from "./config";

/** Error de almacenamiento con mensaje seguro de mostrar. */
export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code: "LIMIT" | "ABORTED" | "INVALID",
  ) {
    super(message);
    this.name = "StorageError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function newStorageId(): string {
  return randomUUID();
}

function assertId(storageId: string) {
  if (!UUID.test(storageId)) throw new StorageError("Identificador de archivo no válido.", "INVALID");
}

/** Rutas derivadas SOLO de identificadores internos (nunca del nombre ni de rutas del navegador). */
export function filePath(storageId: string): string {
  assertId(storageId);
  return path.join(uploadConfig().dir, "files", storageId);
}
export function partPath(storageId: string): string {
  assertId(storageId);
  return path.join(uploadConfig().dir, "incoming", `${storageId}.part`);
}

export async function ensureDirs() {
  const dir = uploadConfig().dir;
  await mkdir(path.join(dir, "files"), { recursive: true });
  await mkdir(path.join(dir, "incoming"), { recursive: true });
}

/**
 * Escribe un cuerpo en streaming al fichero parcial, calculando SHA-256 y tamaño, con límite duro.
 * Al terminar bien: fsync y rename atómico al nombre definitivo. Si falla, borra el parcial.
 */
export async function receiveToStorage(
  body: Readable,
  storageId: string,
  maxBytes: number,
): Promise<{ size: number; checksum: string }> {
  await ensureDirs();
  const part = partPath(storageId);
  const hash = createHash("sha256");
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (size > maxBytes) return cb(new StorageError("El archivo supera el tamaño máximo permitido.", "LIMIT"));
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(body, meter, createWriteStream(part, { flags: "wx" }));
    const fh = await open(part, "r+");
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(part, filePath(storageId));
  } catch (e) {
    await rm(part, { force: true });
    if (e instanceof StorageError) throw e;
    throw new StorageError("La subida se interrumpió antes de completarse.", "ABORTED");
  }
  return { size, checksum: hash.digest("hex") };
}

export function openFile(storageId: string) {
  return createReadStream(filePath(storageId));
}

export async function fileSize(storageId: string): Promise<number | null> {
  try {
    return (await stat(filePath(storageId))).size;
  } catch {
    return null;
  }
}

export async function removePart(storageId: string) {
  await rm(partPath(storageId), { force: true });
}

/** Lee los primeros bytes (firma) sin cargar el archivo. */
export async function readHead(storageId: string, n = 8): Promise<Buffer> {
  const fh = await open(filePath(storageId), "r");
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** Para pruebas y mantenimiento: ficheros presentes en un subdirectorio del almacén. */
export async function listDir(sub: "files" | "incoming"): Promise<string[]> {
  try {
    return await readdir(path.join(uploadConfig().dir, sub));
  } catch {
    return [];
  }
}
