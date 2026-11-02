import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat, statfs } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { CSV_BOM, csvLine } from "@/domain/csv";
import { authorize } from "@/server/authorize";
import { AccessError } from "@/lib/access";
import { readDataStamp } from "@/server/analytics/stamp";
import { getManifest } from "@/server/pulse/config";
import { uploadConfig } from "@/server/uploads/config";
import { noteProgress, setActivity } from "@/server/ops/worker-instance";
import { LostLeaseError, NonRetryableError, ReleaseRequested } from "@/server/uploads/queue";
import { DATASETS, datasetOf, toCsvCells, type DatasetDef, type FileDef } from "./datasets";
import { FORMAT_VERSION, exportConfig } from "./config";
import { parseExportRequest, resolveParams, type ExportRequest } from "./service";

/**
 * Trabajador de exportaciones (CSAPP-09 §6, §8). Cola en PostgreSQL con lease y fencing (mismo patrón que las cargas, sin Redis):
 *  1) PREPARAR: en UNA lectura coherente REPEATABLE READ se materializa el contexto y los registros proyectados (`ExportRow`) con el mismo sello; la
 *     transacción termina antes de generar nada y no se mantiene durante la descarga del navegador.
 *  2) GENERAR: se lee la materialización por bloques (clave `seq`), se escribe un temporal propio de ESTE intento con contrapresión y SHA-256, se verifica y se
 *     publica con rename atómico a un nombre determinista (UUID derivado del trabajo); solo la transacción final con fencing lo ofrece (ExportFile + LISTO).
 *  Un fallo tras escribir y antes de marcar LISTO regenera desde la materialización (mismos bytes) sin anexar ni duplicar filas.
 */
export type ExportHooks = { afterMaterialize?: () => Promise<void> | void; afterPage?: (info: { fileKey: string; part: number; page: number }) => Promise<void> | void; beforePublish?: () => Promise<void> | void };
export type ClaimedExport = { id: string; ownerId: string; dataset: string; query: unknown; attempts: number; maxAttempts: number; fence: number; leaseOwner: string; materialized: boolean };

class CancelledSignal extends Error {}
type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------- Almacén privado de exportaciones

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function exportFilePath(storageId: string): string {
  if (!UUID.test(storageId)) throw new Error("Identificador de archivo no válido.");
  return path.join(exportConfig().dir, "files", storageId);
}
function tmpPath(storageId: string, fence: number): string {
  return path.join(exportConfig().dir, "tmp", `${storageId}.${fence}.${process.pid}.part`);
}
async function ensureExportDirs() {
  const dir = exportConfig().dir;
  await mkdir(path.join(dir, "files"), { recursive: true });
  await mkdir(path.join(dir, "tmp"), { recursive: true });
}
/** UUID determinista por (trabajo, archivo, parte): un reintento publica sobre el mismo nombre con los mismos bytes. */
export function storageIdFor(jobId: string, fileKey: string, part: number): string {
  const h = createHash("sha256").update(`${jobId}|${fileKey}|${part}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ---------------------------------------------------------------- Cola con lease y fencing

export async function claimNextExport(workerId: string): Promise<ClaimedExport | null> {
  const cfg = uploadConfig();
  await failExhaustedExports();
  const rows = await prisma.$queryRaw<ClaimedExport[]>(Prisma.sql`
    UPDATE "ExportJob" j SET status = (CASE WHEN j."materializedAt" IS NULL THEN 'PREPARING' ELSE 'GENERATING' END)::"ExportStatus",
      phase = CASE WHEN j."materializedAt" IS NULL THEN 'preparando' ELSE 'generando' END, "leaseOwner" = ${workerId},
      "leaseExpiresAt" = now() + (${cfg.leaseMs} * interval '1 millisecond'), "heartbeatAt" = now(), fence = j.fence + 1, attempts = j.attempts + 1, "startedAt" = COALESCE(j."startedAt", now())
    WHERE j.id = (
      SELECT id FROM "ExportJob"
      WHERE ((status = 'QUEUED' AND "runAfter" <= now()) OR (status IN ('PREPARING', 'GENERATING') AND "leaseExpiresAt" < now())) AND attempts < "maxAttempts"
      ORDER BY "createdAt", id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING j.id, j."ownerId", j.dataset, j.query, j.attempts, j."maxAttempts", j.fence, j."leaseOwner", (j."materializedAt" IS NOT NULL) AS materialized`);
  return rows[0] ?? null;
}

export async function failExhaustedExports(): Promise<number> {
  const ttl = exportConfig().ttlHours;
  return prisma.$executeRaw(Prisma.sql`
    UPDATE "ExportJob" SET status = 'FAILED', phase = 'fallida', "finishedAt" = now(), "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "expiresAt" = now() + (${ttl} * interval '1 hour'),
      "lastError" = 'El trabajador dejó de responder y se agotaron los intentos. Puede reintentar la exportación.'
    WHERE status IN ('PREPARING', 'GENERATING') AND "leaseExpiresAt" < now() AND attempts >= "maxAttempts"`);
}

async function heartbeatExport(job: ClaimedExport): Promise<boolean> {
  const n = await prisma.$executeRaw(Prisma.sql`
    UPDATE "ExportJob" SET "leaseExpiresAt" = now() + (${uploadConfig().leaseMs} * interval '1 millisecond'), "heartbeatAt" = now()
    WHERE id = ${job.id} AND fence = ${job.fence} AND "leaseOwner" = ${job.leaseOwner} AND status IN ('PREPARING', 'GENERATING')`);
  return n === 1;
}

/** Bloquea la fila del trabajo y exige el mismo propietario de lease y token: el trabajador antiguo no puede confirmar. */
export async function assertExportFence(tx: Tx, job: ClaimedExport): Promise<{ cancelRequested: boolean }> {
  const rows = await tx.$queryRaw<{ cancelRequested: boolean }[]>(Prisma.sql`
    SELECT "cancelRequested" FROM "ExportJob" WHERE id = ${job.id} AND fence = ${job.fence} AND "leaseOwner" = ${job.leaseOwner} AND status IN ('PREPARING', 'GENERATING') FOR UPDATE`);
  if (rows.length === 0) throw new LostLeaseError();
  noteProgress("export");
  return rows[0];
}

async function failExport(job: ClaimedExport, message: string, retryable: boolean): Promise<"retry" | "failed" | "lost"> {
  const cfg = uploadConfig();
  const safe = message.slice(0, 500);
  return prisma.$transaction(async (tx) => {
    try { await assertExportFence(tx, job); } catch { return "lost"; }
    if (retryable && job.attempts < job.maxAttempts) {
      const wait = Math.min(cfg.backoffBaseMs * 2 ** (job.attempts - 1), 60_000);
      await tx.$executeRaw(Prisma.sql`UPDATE "ExportJob" SET status = 'QUEUED', phase = 'reintento programado', "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "lastError" = ${safe}, "runAfter" = now() + (${wait} * interval '1 millisecond') WHERE id = ${job.id}`);
      return "retry";
    }
    await tx.$executeRaw(Prisma.sql`UPDATE "ExportJob" SET status = 'FAILED', phase = 'fallida', "lastError" = ${safe}, "finishedAt" = now(), "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "expiresAt" = now() + (${exportConfig().ttlHours} * interval '1 hour') WHERE id = ${job.id}`);
    return "failed";
  });
}

async function cancelExportJob(job: ClaimedExport, reason: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    try { await assertExportFence(tx, job); } catch { return; }
    await tx.$executeRaw(Prisma.sql`UPDATE "ExportJob" SET status = 'CANCELLED', phase = 'cancelada', "lastError" = ${reason}, "finishedAt" = now(), "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "expiresAt" = now() + (${exportConfig().ttlHours} * interval '1 hour') WHERE id = ${job.id}`);
  });
  await deleteMaterialization(job.id);
}

async function releaseExport(job: ClaimedExport): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "ExportJob" SET status = 'QUEUED', phase = 'en cola', attempts = GREATEST(attempts - 1, 0), "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "runAfter" = now()
    WHERE id = ${job.id} AND fence = ${job.fence} AND "leaseOwner" = ${job.leaseOwner} AND status IN ('PREPARING', 'GENERATING')`);
}

// ---------------------------------------------------------------- Preparación (materialización en una lectura coherente)

async function materialize(job: ClaimedExport, req: ExportRequest, ds: DatasetDef): Promise<void> {
  const cfg = exportConfig();
  await prisma.$transaction(
    async (tx) => {
      const st = await assertExportFence(tx, job); // primera sentencia: fija la instantánea y el fencing
      if (st.cancelRequested) throw new CancelledSignal();
      // El permiso del solicitante se vuelve a comprobar en la misma instantánea (revocado mientras esperaba → no se prepara nada).
      await authorize(tx, job.ownerId, "READ");
      await tx.$executeRaw(Prisma.sql`DELETE FROM "ExportRow" WHERE "jobId" = ${job.id}`);
      const { params, context } = await resolveParams(tx, req);
      const counts: Record<string, number> = {};
      for (const f of ds.files) {
        const cols = f.columns.map((c) => Prisma.sql`q.${Prisma.raw(`"${c.name}"`)}::text`);
        const order = f.order.map((c) => Prisma.raw(`q."${c}"`));
        const n = await tx.$executeRaw(Prisma.sql`
          INSERT INTO "ExportRow" ("jobId", "fileKey", seq, cells)
          SELECT ${job.id}, ${f.fileKey}, row_number() OVER (ORDER BY ${Prisma.join(order, ", ")}), to_jsonb(ARRAY[${Prisma.join(cols, ", ")}]::text[])
          FROM (${f.sql(params)}) q`);
        counts[f.fileKey] = n;
      }
      const total = Object.values(counts).reduce((s, v) => s + v, 0);
      if (total > cfg.maxRows) throw new NonRetryableError(`El conjunto tiene ${total} filas y el máximo por exportación es ${cfg.maxRows}.`);
      const stamp = (await readDataStamp(tx)).stamp;
      const manifest = await getManifest(tx);
      const readAt = (await tx.$queryRaw<{ t: Date }[]>(Prisma.sql`SELECT now() AS t`))[0].t;
      const requested = await tx.exportJob.findUniqueOrThrow({ where: { id: job.id }, select: { requestedStamp: true } });
      const materialContext = {
        ...context, dataset: ds.key, etiqueta: ds.label, consulta: { ...req }, revisiones: manifest, sello_datos: stamp, leido_el: readAt.toISOString(), formato: FORMAT_VERSION,
        archivos: ds.files.map((f) => ({ clave: f.fileKey, titulo: f.title, granularidad: f.granularity, clave_unica: f.key, orden: f.order, aditivo: f.additive, regla_conciliacion: f.reconciliation, filas: counts[f.fileKey], columnas: f.columns.map((c) => ({ nombre: c.name, tipo: c.kind, unidad: c.unit ?? null, descripcion: c.doc })) })),
      };
      await tx.exportJob.update({
        where: { id: job.id },
        // La fila del trabajo está bloqueada (FOR UPDATE) durante la preparación: los latidos esperan a este commit, así que el lease se renueva aquí mismo
        // para que una preparación larga no deje el lease vencido justo al confirmarse.
        data: { leaseExpiresAt: new Date(Date.now() + uploadConfig().leaseMs), heartbeatAt: new Date(), materializedAt: readAt, materialStamp: stamp, materialContext: materialContext as unknown as Prisma.InputJsonValue, rowCount: BigInt(total), laterThanScreen: requested.requestedStamp !== stamp, status: "GENERATING", phase: "generando", progressDone: 0, progressTotal: BigInt(total) },
      });
    },
    { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: cfg.materializeTimeoutMs },
  );
}

async function deleteMaterialization(jobId: string): Promise<void> {
  for (;;) {
    const n = await prisma.$executeRaw(Prisma.sql`DELETE FROM "ExportRow" WHERE ctid IN (SELECT ctid FROM "ExportRow" WHERE "jobId" = ${jobId} LIMIT 100000)`);
    if (n === 0) break;
  }
}

// ---------------------------------------------------------------- Generación por bloques con contrapresión

type Part = { fileKey: string; part: number; kind: "DATA" | "MANIFEST"; name: string; rows: number; bytes: number; checksum: string; additive: boolean; storageId: string };

async function writeChunk(ws: ReturnType<typeof createWriteStream>, buf: Buffer): Promise<void> {
  if (!ws.write(buf)) await once(ws, "drain");
}

async function reportProgress(job: ClaimedExport, done: number): Promise<void> {
  const rows = await prisma.$queryRaw<{ cancelRequested: boolean }[]>(Prisma.sql`
    UPDATE "ExportJob" SET "progressDone" = ${done}, "heartbeatAt" = now(), "leaseExpiresAt" = now() + (${uploadConfig().leaseMs} * interval '1 millisecond')
    WHERE id = ${job.id} AND fence = ${job.fence} AND "leaseOwner" = ${job.leaseOwner} AND status = 'GENERATING' RETURNING "cancelRequested"`);
  if (rows.length === 0) throw new LostLeaseError();
  if (rows[0].cancelRequested) throw new CancelledSignal();
}

async function publish(tmp: string, finalPath: string): Promise<void> {
  const fh = await open(tmp, "r+");
  try { await fh.sync(); } finally { await fh.close(); }
  await rename(tmp, finalPath); // atómico: un lector nunca ve un archivo a medias
}

async function writeFilePart(job: ClaimedExport, jobId: string, ds: DatasetDef, f: FileDef, total: number, part: number, doneBefore: number, hooks: ExportHooks): Promise<{ part: Part; done: number }> {
  const cfg = exportConfig();
  const storageId = storageIdFor(jobId, f.fileKey, part);
  const tmp = tmpPath(storageId, job.fence);
  const from = (part - 1) * cfg.partRows + 1;
  const to = Math.min(part * cfg.partRows, total);
  const hash = createHash("sha256");
  let bytes = 0;
  const ws = createWriteStream(tmp, { flags: "w" });
  const failed = new Promise<never>((_, rej) => ws.once("error", rej));
  failed.catch(() => undefined);
  const put = async (s: string) => {
    const b = Buffer.from(s, "utf8");
    hash.update(b);
    bytes += b.length;
    if (bytes > cfg.maxFileBytes) throw new NonRetryableError(`El archivo supera el tamaño máximo (${cfg.maxFileBytes} bytes). Reduzca el periodo o el ámbito.`);
    await Promise.race([writeChunk(ws, b), failed]);
  };
  let done = doneBefore;
  try {
    await put(CSV_BOM + csvLine(f.columns.map((c) => c.name)) + "\r\n");
    let last = from - 1;
    let page = 0;
    while (last < to) {
      // OJO: la columna de salida NO se llama `seq` (un `ORDER BY seq` ordenaría por el texto de salida, orden léxico, y saltaría filas).
      const rows = await prisma.$queryRaw<{ pos: string; cells: (string | null)[] }[]>(Prisma.sql`
        SELECT r.seq::text AS pos, r.cells FROM "ExportRow" r WHERE r."jobId" = ${jobId} AND r."fileKey" = ${f.fileKey} AND r.seq > ${last} AND r.seq <= ${to} ORDER BY r.seq LIMIT ${cfg.pageRows}`);
      if (rows.length === 0) break;
      await put(rows.map((r) => csvLine(toCsvCells(f.columns, r.cells))).join("\r\n") + "\r\n");
      last = Number(rows[rows.length - 1].pos);
      done += rows.length;
      page++;
      await reportProgress(job, done);
      noteProgress("export");
      await hooks.afterPage?.({ fileKey: f.fileKey, part, page });
    }
    if (last !== to && to >= from) throw new Error(`La materialización de «${f.fileKey}» está incompleta (${last}/${to}).`);
    ws.end();
    await Promise.race([once(ws, "finish"), failed]);
    await publish(tmp, exportFilePath(storageId));
  } catch (e) {
    ws.destroy();
    await rm(tmp, { force: true });
    if ((e as NodeJS.ErrnoException)?.code === "ENOSPC") throw new NonRetryableError("Sin espacio en el almacén de exportaciones: libere espacio y reintente.");
    throw e;
  }
  const rowsInPart = Math.max(0, to - from + 1);
  const range = Math.ceil(total / cfg.partRows) > 1 ? `_p${String(part).padStart(3, "0")}` : "";
  const q = ds.key;
  return { part: { fileKey: f.fileKey, part, kind: "DATA", name: `${q}_${f.fileKey}${range}.csv`, rows: rowsInPart, bytes, checksum: hash.digest("hex"), additive: f.additive, storageId }, done };
}

async function writeManifest(job: ClaimedExport, jobId: string, manifest: unknown): Promise<Part> {
  const storageId = storageIdFor(jobId, "manifiesto", 1);
  const tmp = tmpPath(storageId, job.fence);
  const body = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
  const ws = createWriteStream(tmp, { flags: "w" });
  await writeChunk(ws, body);
  ws.end();
  await once(ws, "finish");
  await publish(tmp, exportFilePath(storageId));
  return { fileKey: "manifiesto", part: 1, kind: "MANIFEST", name: "manifiesto.json", rows: 1, bytes: body.length, checksum: createHash("sha256").update(body).digest("hex"), additive: false, storageId };
}

async function generate(job: ClaimedExport, ds: DatasetDef, hooks: ExportHooks): Promise<void> {
  const cfg = exportConfig();
  await ensureExportDirs();
  const free = await statfs(cfg.dir).then((s) => Number(s.bavail) * Number(s.bsize)).catch(() => Infinity);
  if (free < cfg.minFreeBytes) throw new NonRetryableError("No hay espacio libre suficiente en el almacén de exportaciones. Libere espacio y reintente.");
  const j = await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
  const ctx = j.materialContext as { archivos: { clave: string; filas: number }[] } & Record<string, unknown>;
  const parts: Part[] = [];
  let done = 0;
  for (const f of ds.files) {
    const total = ctx.archivos.find((a) => a.clave === f.fileKey)?.filas ?? 0;
    const nParts = Math.max(1, Math.ceil(total / cfg.partRows));
    for (let p = 1; p <= nParts; p++) {
      const r = await writeFilePart(job, job.id, ds, f, total, p, done, hooks);
      parts.push(r.part);
      done = r.done;
    }
  }
  const warnings = parts.filter((p) => p.kind === "DATA" && p.part > 1).length > 0 ? [`Un archivo supera ${cfg.partRows} filas de datos (límite prudente de una hoja de Excel: 1 048 575): se ha partido de forma determinista por orden de clave en partes numeradas; no se ha truncado nada.`] : [];
  const manifest = {
    ...ctx, version_formato: FORMAT_VERSION, avisos: warnings, lectura_posterior_a_la_pantalla: j.laterThanScreen,
    pantalla: { sello_datos: j.requestedStamp, leido_el: j.requestedReadAt.toISOString(), totales: j.requestedTotals },
    archivos_generados: parts.map((p) => ({ nombre: p.name, clave: p.fileKey, parte: p.part, filas: p.rows, bytes: p.bytes, sha256: p.checksum, aditivo: p.additive })),
    total_filas: parts.reduce((s, p) => s + p.rows, 0),
  };
  const mf = await writeManifest(job, job.id, manifest);
  await hooks.beforePublish?.();
  await prisma.$transaction(async (tx) => {
    const st = await assertExportFence(tx, job); // solo el trabajador vigente confirma; el antiguo recibe LostLeaseError
    if (st.cancelRequested) throw new CancelledSignal();
    await authorize(tx, job.ownerId, "READ");
    for (const p of [...parts, mf]) {
      await tx.exportFile.upsert({
        where: { jobId_fileKey_part: { jobId: job.id, fileKey: p.fileKey, part: p.part } },
        create: { jobId: job.id, fileKey: p.fileKey, part: p.part, kind: p.kind, name: p.name, rows: BigInt(p.rows), bytes: BigInt(p.bytes), checksum: p.checksum, additive: p.additive, storageId: p.storageId },
        update: { kind: p.kind, name: p.name, rows: BigInt(p.rows), bytes: BigInt(p.bytes), checksum: p.checksum, additive: p.additive },
      });
    }
    await tx.$executeRaw(Prisma.sql`UPDATE "ExportJob" SET status = 'READY', phase = 'listo', "progressDone" = ${done}, "finishedAt" = now(), "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL, "expiresAt" = now() + (${cfg.ttlHours} * interval '1 hour') WHERE id = ${job.id}`);
  });
}

// ---------------------------------------------------------------- Procesamiento de un trabajo

export async function processExport(job: ClaimedExport, shouldStop: () => boolean, log: (m: string) => void = () => {}, hooks: ExportHooks = {}): Promise<void> {
  const cfg = uploadConfig();
  let lost = false;
  const timer = setInterval(() => { heartbeatExport(job).then((ok) => { if (!ok) lost = true; }).catch(() => undefined); }, cfg.heartbeatMs);
  setActivity("export", { kind: "job", jobId: job.id });
  try {
    log(`Exportación ${job.id} (${job.dataset}), intento ${job.attempts}/${job.maxAttempts}`);
    const ds = datasetOf(job.dataset);
    if (!ds) throw new NonRetryableError("Conjunto de exportación desconocido.");
    try {
      await authorize(prisma, job.ownerId, "READ");
    } catch (e) {
      if (e instanceof AccessError) throw new NonRetryableError("El solicitante ya no tiene permiso para exportar: no se genera el archivo.");
      throw e;
    }
    const req = parseExportRequest(job.query);
    if (shouldStop()) throw new ReleaseRequested();
    if (!job.materialized) {
      await materialize(job, req, ds);
      await hooks.afterMaterialize?.();
    }
    if (shouldStop() || lost) throw lost ? new LostLeaseError() : new ReleaseRequested();
    await generate(job, ds, hooks);
    log(`Exportación ${job.id} lista`);
  } catch (e) {
    if (e instanceof LostLeaseError || lost) log(`Exportación ${job.id} perdida: otro trabajador la ha reclamado; no se confirma nada.`);
    else if (e instanceof CancelledSignal) { await cancelExportJob(job, "Cancelada por la persona solicitante."); log(`Exportación ${job.id} cancelada.`); }
    else if (e instanceof ReleaseRequested) { await releaseExport(job); log(`Exportación ${job.id} devuelta a la cola por cierre ordenado.`); }
    else if (e instanceof NonRetryableError) {
      const noPerm = e.message.includes("ya no tiene permiso");
      if (noPerm) { await cancelExportJob(job, e.message); } else await failExport(job, e.message, false);
      log(`Exportación ${job.id} fallida sin reintento: ${e.message}`);
    } else {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      const r = await failExport(job, msg, true);
      log(`Exportación ${job.id} con error (${r}): ${msg.split("\n")[0].slice(0, 200)}`);
    }
  } finally {
    clearInterval(timer);
    setActivity("export", null);
  }
}

export async function runExportOnce(workerId: string, shouldStop: () => boolean = () => false, log?: (m: string) => void, hooks?: ExportHooks): Promise<boolean> {
  const job = await claimNextExport(workerId);
  if (!job) return false;
  await processExport(job, shouldStop, log, hooks);
  return true;
}

// ---------------------------------------------------------------- Caducidad y limpieza (solo artefactos y materialización de SUS exportaciones)

export async function expireExports(log: (m: string) => void = () => {}): Promise<number> {
  const due = await prisma.exportJob.findMany({ where: { status: { in: ["READY", "FAILED", "CANCELLED"] }, expiresAt: { lt: new Date() } }, select: { id: true, files: { select: { storageId: true } } }, take: 50 });
  for (const j of due) {
    const r = await prisma.exportJob.updateMany({ where: { id: j.id, status: { in: ["READY", "FAILED", "CANCELLED"] } }, data: { status: "EXPIRED", phase: "caducada" } });
    if (r.count === 0) continue;
    for (const f of j.files) await rm(exportFilePath(f.storageId), { force: true });
    await prisma.exportFile.deleteMany({ where: { jobId: j.id } });
    await deleteMaterialization(j.id);
    log(`Exportación ${j.id} caducada: artefactos y materialización eliminados (el registro mínimo se conserva).`);
  }
  return due.length;
}

/** Elimina temporales y archivos huérfanos antiguos (de intentos caídos o de un trabajador perdido): solo dentro del almacén de exportaciones. */
export async function sweepExportOrphans(olderThanMs = 3_600_000): Promise<number> {
  const dir = exportConfig().dir;
  let n = 0;
  for (const sub of ["tmp", "files"] as const) {
    let names: string[] = [];
    try { names = await readdir(path.join(dir, sub)); } catch { continue; }
    const known = sub === "files" ? new Set((await prisma.exportFile.findMany({ where: { storageId: { in: names } }, select: { storageId: true } })).map((f) => f.storageId)) : new Set<string>();
    for (const name of names) {
      const p = path.join(dir, sub, name);
      if (sub === "files" && (known.has(name) || !UUID.test(name))) continue;
      try {
        if (Date.now() - (await stat(p)).mtimeMs < olderThanMs) continue;
        await rm(p, { force: true });
        n++;
      } catch { /* otro proceso lo retiró */ }
    }
  }
  return n;
}

export async function exportMaintenance(log?: (m: string) => void): Promise<void> {
  await expireExports(log);
  await sweepExportOrphans();
}

export async function runExportLoop(opts: { workerId?: string; signal: AbortSignal; log?: (m: string) => void }): Promise<void> {
  const workerId = opts.workerId ?? `exportador-${process.pid}-${randomUUID().slice(0, 8)}`;
  const log = opts.log ?? (() => {});
  const cfg = uploadConfig();
  let last = 0;
  const stop = () => opts.signal.aborted;
  while (!stop()) {
    try {
      if (Date.now() - last > 60_000) { last = Date.now(); await exportMaintenance(log); }
      if (await runExportOnce(workerId, stop, log)) continue;
    } catch (e) {
      log(`Error del bucle de exportaciones: ${e instanceof Error ? e.message.split("\n")[0] : "desconocido"}`);
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, cfg.pollMs);
      opts.signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
    });
  }
}
export { DATASETS, createReadStream };
