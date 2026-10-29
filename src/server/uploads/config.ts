import path from "node:path";
import type { ReaderLimits } from "./readers/types";

/** Configuración del motor de cargas, leída del entorno en cada uso (web y trabajador). */
function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const MB = 1024 * 1024;

export function uploadConfig() {
  return {
    /** Directorio privado persistente compartido por web y trabajador (fuera de public y de Git). */
    dir: path.resolve(process.env.CSAPP_UPLOAD_DIR || path.join(process.cwd(), "almacen-cargas")),
    maxBytes: num("CSAPP_UPLOAD_MAX_BYTES", 200 * MB),
    maxUncompressedBytes: num("CSAPP_UPLOAD_MAX_UNCOMPRESSED_BYTES", 1024 * MB),
    maxRatio: num("CSAPP_UPLOAD_MAX_RATIO", 200),
    maxRows: num("CSAPP_UPLOAD_MAX_ROWS", 5_000_000),
    maxSharedStringsBytes: num("CSAPP_UPLOAD_MAX_SHARED_STRINGS_BYTES", 256 * MB),
    maxConcurrentUploads: num("CSAPP_UPLOAD_MAX_CONCURRENT", 3),
    maxOpenBatches: num("CSAPP_UPLOAD_MAX_OPEN_BATCHES", 20),
    incompleteMinutes: num("CSAPP_UPLOAD_INCOMPLETE_MINUTES", 60),
    chunkRows: num("CSAPP_WORKER_CHUNK_ROWS", 1000),
    leaseMs: num("CSAPP_WORKER_LEASE_MS", 60_000),
    heartbeatMs: num("CSAPP_WORKER_HEARTBEAT_MS", 15_000),
    pollMs: num("CSAPP_WORKER_POLL_MS", 2_000),
    maxAttempts: num("CSAPP_WORKER_MAX_ATTEMPTS", 3),
    backoffBaseMs: num("CSAPP_WORKER_BACKOFF_MS", 2_000),
    activationTimeoutMs: num("CSAPP_WORKER_ACTIVATION_TIMEOUT_MS", 30 * 60_000),
  };
}

export function readerLimits(): ReaderLimits {
  const c = uploadConfig();
  return {
    maxFileBytes: c.maxBytes,
    maxUncompressedBytes: c.maxUncompressedBytes,
    maxCompressionRatio: c.maxRatio,
    maxRows: c.maxRows,
    maxSharedStringsBytes: c.maxSharedStringsBytes,
  };
}
