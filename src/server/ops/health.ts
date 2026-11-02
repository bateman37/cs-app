import { readdir } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { appRoot, buildInfo, isOperational } from "@/lib/runtime";
import { exportConfig } from "@/server/exports/config";
import { uploadConfig } from "@/server/uploads/config";
import { currentLayoutProblems, probeStore, readInstallationId, readMarker, storeDirs, type StoreKind } from "./stores";

/**
 * Comprobación técnica mínima (CSAPP-10 §4), consultable por CLI y por el Administrador. Sin otra plataforma: lee la base y los almacenes.
 * Distingue web, base, trabajador (ausente / presente en reposo / procesando / presente sin avance / detenido), colas, trabajos atascados y almacenes.
 * No incluye secretos, DSN, sesiones, SQL ni contenido de clientes. Umbrales técnicos documentados en docs/operacion/instalacion-operacion.md.
 */
export type HealthLevel = "error" | "warn";
export type HealthProblem = { code: string; level: HealthLevel; message: string };
export type WorkerVerdict = "ausente" | "presente_en_reposo" | "presente_procesando" | "presente_sin_avance" | "detenido";

export function healthThresholds(env: Record<string, string | undefined> = process.env) {
  const hb = uploadConfig().heartbeatMs;
  const num = (n: string, f: number) => { const v = Number(env[n]); return Number.isFinite(v) && v > 0 ? v : f; };
  return {
    /** Un trabajador está vivo si su último latido tiene menos de este tiempo (3 latidos por defecto: tolera dos perdidos). */
    workerAliveMs: num("CSAPP_HEALTH_WORKER_ALIVE_MS", 3 * hb),
    /** Un trabajo en curso sin ningún bloque confirmado durante este tiempo se considera «presente pero sin avanzar». */
    stallMs: num("CSAPP_HEALTH_STALL_MS", 15 * 60_000),
    /** Un trabajo en cola más antiguo que esto sin trabajador vivo es una cola desatendida. */
    queueAgeMs: num("CSAPP_HEALTH_QUEUE_AGE_MS", 5 * 60_000),
    /** Espacio libre mínimo de un almacén (el mismo valor técnico de las exportaciones). */
    minFreeBytes: exportConfig().minFreeBytes,
    /** Retención de instancias detenidas/muertas en la vista. */
    instanceHistoryMs: num("CSAPP_HEALTH_INSTANCE_HISTORY_MS", 24 * 3600_000),
  };
}

export type WorkerRow = { id: string; pid: number; host: string; version: string; sha: string; state: string; currentKind: string | null; startedAt: string; lastSeenAt: string; ageSec: number; alive: boolean; progressAgeSec: number | null; stalled: boolean; stopRequested: boolean; versionMatches: boolean };
export type QueueRow = { pending: number; running: number; oldestPendingAgeSec: number | null; expiredLeases: number };
export type StoreRow = { kind: StoreKind; dir: string; exists: boolean; writable: boolean; freeBytes: number | null; marker: "ok" | "ajena" | "sin_marca" | "ausente"; error?: string };
export type HealthReport = {
  generatedAt: string;
  version: { version: string; sha: string; dirty: boolean; builtAt: string | null; known: boolean };
  overall: "ok" | "degradado" | "caido";
  web: { ok: true };
  database: { ok: boolean; latencyMs: number | null; error?: string };
  schema: { state: "ok" | "pendiente" | "adelantado" | "desconocido" | "fallida" | "sin_base"; expected: number; applied: number; missing: string[]; unexpected: string[]; failed: string[] };
  workers: { verdict: WorkerVerdict; instances: WorkerRow[]; thresholds: { aliveMs: number; stallMs: number; queueAgeMs: number } };
  queues: { uploads: QueueRow; exports: QueueRow };
  stuck: { kind: string; id: string; reason: string; ageSec: number }[];
  stores: StoreRow[];
  problems: HealthProblem[];
};

/** Minimiza lo público: solo si la web responde y la base está disponible. */
export type PublicHealth = { status: "ok" | "degradado" | "caido" };

async function schemaState(): Promise<HealthReport["schema"]> {
  const b = buildInfo();
  let expected = b.migrations;
  if (expected.length === 0) {
    try { expected = (await readdir(path.join(appRoot(), "prisma", "migrations"), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch { expected = []; }
  }
  const rows = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>(Prisma.sql`
    SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name`).catch(() => null);
  if (rows === null) return { state: "sin_base", expected: expected.length, applied: 0, missing: expected, unexpected: [], failed: [] };
  const applied = rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
  const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
  if (expected.length === 0) return { state: "desconocido", expected: 0, applied: applied.length, missing: [], unexpected: [], failed };
  const missing = expected.filter((m) => !applied.includes(m));
  const unexpected = applied.filter((m) => !expected.includes(m));
  const state = failed.length ? "fallida" : missing.length ? "pendiente" : unexpected.length ? "adelantado" : "ok";
  return { state, expected: expected.length, applied: applied.length, missing, unexpected, failed };
}

export function classifyWorkers(rows: WorkerRow[]): WorkerVerdict {
  const live = rows.filter((r) => r.alive && r.state !== "STOPPED");
  if (live.length === 0) return rows.some((r) => r.state === "STOPPED") ? "detenido" : "ausente";
  if (live.some((r) => r.stalled)) return "presente_sin_avance";
  if (live.some((r) => r.state === "BUSY")) return "presente_procesando";
  return "presente_en_reposo";
}

/** `now` inyectable: las pruebas usan reloj controlado, sin esperar tiempos reales ni inflar umbrales. */
export async function collectHealth(opts: { now?: Date; thresholds?: ReturnType<typeof healthThresholds> } = {}): Promise<HealthReport> {
  const now = opts.now ?? new Date();
  const th = opts.thresholds ?? healthThresholds();
  const b = buildInfo();
  const problems: HealthProblem[] = [];
  const add = (code: string, level: HealthLevel, message: string) => problems.push({ code, level, message });
  const report: HealthReport = {
    generatedAt: now.toISOString(), version: { version: b.version, sha: b.sha, dirty: b.dirty, builtAt: b.builtAt, known: b.known },
    overall: "ok", web: { ok: true }, database: { ok: false, latencyMs: null },
    schema: { state: "sin_base", expected: 0, applied: 0, missing: [], unexpected: [], failed: [] },
    workers: { verdict: "ausente", instances: [], thresholds: { aliveMs: th.workerAliveMs, stallMs: th.stallMs, queueAgeMs: th.queueAgeMs } },
    queues: { uploads: { pending: 0, running: 0, oldestPendingAgeSec: null, expiredLeases: 0 }, exports: { pending: 0, running: 0, oldestPendingAgeSec: null, expiredLeases: 0 } },
    stuck: [], stores: [], problems,
  };
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    report.database = { ok: true, latencyMs: Date.now() - t0 };
  } catch (e) {
    report.database = { ok: false, latencyMs: null, error: "La base de datos no responde." };
    void e;
    add("BASE_NO_DISPONIBLE", "error", "La base de datos no está disponible: web viva, pero sin acceso a datos.");
  }
  const sec = (d: Date) => Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000));

  // Almacenes: se comprueban aunque la base falle (acceso al disco).
  const dirs = storeDirs();
  const installationId = report.database.ok ? await readInstallationId().catch(() => null) : null;
  for (const kind of ["uploads", "exports"] as const) {
    const pr = await probeStore(dirs[kind]);
    const mk = pr.exists ? await readMarker(dirs[kind]) : null;
    const marker: StoreRow["marker"] = !pr.exists ? "ausente" : !mk ? "sin_marca" : installationId && mk.installationId !== installationId ? "ajena" : "ok";
    report.stores.push({ kind, dir: pr.dir, exists: pr.exists, writable: pr.writable, freeBytes: pr.freeBytes, marker, error: pr.error });
    const label = kind === "uploads" ? "originales" : "exportaciones";
    if (!pr.exists) add("ALMACEN_AUSENTE", "error", `El almacén de ${label} no existe o no es accesible (${pr.error ?? "sin detalle"}).`);
    else if (!pr.writable) add("ALMACEN_SIN_ESCRITURA", "error", `El almacén de ${label} no admite escritura (${pr.error ?? "sin detalle"}).`);
    else if (pr.freeBytes !== null && pr.freeBytes < th.minFreeBytes) add("ALMACEN_SIN_ESPACIO", "error", `El almacén de ${label} tiene ${(pr.freeBytes / 1048576).toFixed(0)} MB libres, menos del mínimo técnico (${(th.minFreeBytes / 1048576).toFixed(0)} MB).`);
    if (marker === "ajena") add("ALMACEN_AJENO", "error", `El almacén de ${label} pertenece a otra instalación.`);
    if (marker === "sin_marca" && pr.exists) add("ALMACEN_SIN_MARCA", "warn", `El almacén de ${label} no está enlazado a la instalación (ejecute «npm run ops -- preparar»).`);
  }
  for (const lp of currentLayoutProblems(isOperational())) add(lp.code, "error", lp.message);

  if (report.database.ok) {
    report.schema = await schemaState();
    const s = report.schema;
    if (s.state === "pendiente") add("ESQUEMA_PENDIENTE", "error", `Faltan ${s.missing.length} migraciones por aplicar (${s.missing.join(", ")}): ejecute «npm run db:migrar».`);
    else if (s.state === "fallida") add("MIGRACION_FALLIDA", "error", `Hay migraciones fallidas sin resolver: ${s.failed.join(", ")}.`);
    else if (s.state === "adelantado") add("ESQUEMA_ADELANTADO", "warn", `La base tiene migraciones que este código no conoce (${s.unexpected.join(", ")}): código más antiguo que el esquema. Compatibilidad no garantizada (ver guía de vuelta atrás).`);
    else if (s.state === "desconocido") add("ESQUEMA_DESCONOCIDO", "warn", "Sin build-info.json no puede compararse el esquema con el código compilado.");

    const inst = await prisma.workerInstance.findMany({ where: { lastSeenAt: { gt: new Date(now.getTime() - th.instanceHistoryMs) } }, orderBy: { lastSeenAt: "desc" }, take: 50 });
    const rows: WorkerRow[] = inst.map((w) => {
      const alive = w.state !== "STOPPED" && now.getTime() - w.lastSeenAt.getTime() < th.workerAliveMs;
      const progressAgeSec = w.progressAt ? sec(w.progressAt) : null;
      const stalled = alive && w.state === "BUSY" && progressAgeSec !== null && progressAgeSec * 1000 > th.stallMs;
      return { id: w.id, pid: w.pid, host: w.host, version: w.version, sha: w.sha, state: w.state, currentKind: w.currentKind, startedAt: w.startedAt.toISOString(), lastSeenAt: w.lastSeenAt.toISOString(), ageSec: sec(w.lastSeenAt), alive, progressAgeSec, stalled, stopRequested: !!w.stopRequestedAt, versionMatches: w.sha === b.sha || !b.known };
    });
    report.workers = { verdict: classifyWorkers(rows), instances: rows, thresholds: report.workers.thresholds };
    const v = report.workers.verdict;
    if (v === "ausente") add("TRABAJADOR_AUSENTE", "error", "No hay ningún trabajador vivo: las cargas y exportaciones no avanzarán hasta arrancarlo («npm run worker:start»).");
    if (v === "presente_sin_avance") add("TRABAJADOR_SIN_AVANCE", "error", "Hay un trabajador vivo pero su trabajo en curso no confirma bloques desde hace más de lo esperado.");
    for (const r of rows) if (r.alive && !r.versionMatches) add("TRABAJADOR_OTRA_VERSION", "warn", `El trabajador ${r.id} ejecuta otra versión (${r.sha.slice(0, 8)}) que la web (${b.sha.slice(0, 8)}).`);

    const q = async (table: "UploadJob" | "ExportJob") => {
      const pend = table === "UploadJob" ? Prisma.sql`status = 'PENDING'` : Prisma.sql`status = 'QUEUED'`;
      const run = table === "UploadJob" ? Prisma.sql`status = 'RUNNING'` : Prisma.sql`status IN ('PREPARING', 'GENERATING')`;
      const rowsQ = await prisma.$queryRaw<{ pending: bigint; running: bigint; oldest: Date | null; expired: bigint }[]>(Prisma.sql`
        SELECT count(*) FILTER (WHERE ${pend}) AS pending, count(*) FILTER (WHERE ${run}) AS running,
          min("createdAt") FILTER (WHERE ${pend}) AS oldest, count(*) FILTER (WHERE ${run} AND "leaseExpiresAt" < ${now}) AS expired
        FROM ${Prisma.raw(`"${table}"`)}`);
      const r = rowsQ[0];
      return { pending: Number(r.pending), running: Number(r.running), oldestPendingAgeSec: r.oldest ? sec(r.oldest) : null, expiredLeases: Number(r.expired) } satisfies QueueRow;
    };
    report.queues = { uploads: await q("UploadJob"), exports: await q("ExportJob") };
    for (const [name, qr] of Object.entries(report.queues) as ["uploads" | "exports", QueueRow][]) {
      const label = name === "uploads" ? "cargas" : "exportaciones";
      if (qr.oldestPendingAgeSec !== null && qr.oldestPendingAgeSec * 1000 > th.queueAgeMs && !report.workers.instances.some((w) => w.alive)) {
        add("COLA_DESATENDIDA", "error", `Hay trabajos de ${label} en cola desde hace ${Math.round(qr.oldestPendingAgeSec / 60)} min y ningún trabajador vivo.`);
        report.stuck.push({ kind: `cola:${name}`, id: "-", reason: "En cola sin trabajador vivo", ageSec: qr.oldestPendingAgeSec });
      }
      if (qr.expiredLeases > 0) {
        const alive = report.workers.instances.some((w) => w.alive);
        add("LEASE_VENCIDO", alive ? "warn" : "error", `${qr.expiredLeases} trabajo(s) de ${label} con lease vencido: ${alive ? "el trabajador vivo los reclamará" : "no hay trabajador vivo que los reclame"}.`);
      }
    }
    for (const w of report.workers.instances.filter((x) => x.stalled)) report.stuck.push({ kind: w.currentKind ?? "trabajo", id: w.id, reason: "Trabajador vivo sin avance", ageSec: w.progressAgeSec ?? 0 });
  }

  const err = problems.some((p) => p.level === "error");
  report.overall = !report.database.ok ? "caido" : err ? "degradado" : "ok";
  return report;
}

export const toPublicHealth = (r: HealthReport): PublicHealth => ({ status: !r.database.ok ? "caido" : r.overall });

/** Informe descargable para soporte: solo lo ya redactado en `HealthReport` (sin secretos, DSN, sesiones, SQL ni datos de clientes). */
export function redactedDiagnostic(r: HealthReport) {
  return { ...r, stores: r.stores.map((s) => ({ ...s, dir: path.basename(s.dir) })) };
}
