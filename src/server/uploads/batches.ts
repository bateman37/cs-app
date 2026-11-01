import type { Readable } from "node:stream";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { UploadStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { availableActions, TERMINAL_STATUSES, type UploadStatusName } from "@/domain/cargas";
import { isIsoDate } from "@/domain/vigencia";
import { recordAudit } from "@/server/audit";
import { authorize } from "@/server/authorize";
import { DomainError, StaleVersionError } from "@/server/errors";
import { pageResult, paging } from "@/server/common";
import { adminTransaction } from "@/server/tx";
import { uploadConfig } from "./config";
import { enqueueJob } from "./queue";
import { getPendingSources, getProfile, getProfiles } from "./registry";
import { fileSize, newStorageId, receiveToStorage, removePart, StorageError } from "./storage";

/** La subida supera un límite configurado (HTTP 413). */
export class UploadLimitError extends DomainError {}
/** Demasiadas cargas simultáneas o en cola (HTTP 429). */
export class UploadBusyError extends DomainError {}

const isoDate = z
  .string()
  .trim()
  .refine((v) => isIsoDate(v), "Fecha no válida (AAAA-MM-DD).");

/** Metadatos comunes, separados de la fecha de carga: extracción declarada, intervalo y cobertura. */
export const declaredSchema = z
  .object({
    extraccion: isoDate.optional(),
    desde: isoDate.optional(),
    hasta: isoDate.optional(),
    cobertura: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((v) => !v.desde || !v.hasta || v.desde <= v.hasta, "El intervalo declarado es incoherente: «desde» no puede ser posterior a «hasta».");

export function sanitizeName(name: string): string {
  // Solo informativo: sin rutas ni caracteres de control; nunca se usa para el almacenamiento.
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
  return clean || "archivo";
}

function formatOf(name: string): "csv" | "xlsx" | null {
  const ext = name.toLowerCase().split(".").pop();
  return ext === "csv" ? "csv" : ext === "xlsx" ? "xlsx" : null;
}

let activeUploads = 0;

export type ReceiveInput = {
  profileId: string;
  originalName: string;
  metadata: unknown;
  declared: unknown;
  contentLength: number | null;
  body: Readable;
};

/**
 * Recibe un archivo: autoriza ANTES de leer el cuerpo, valida perfil, formato, metadatos y límites,
 * escribe en streaming al almacén privado y, solo con el archivo completo y su checksum, deja el lote en
 * cola con su trabajo de preparación en una única transacción.
 */
export async function receiveUpload(actorId: string, input: ReceiveInput): Promise<{ id: string; status: UploadStatus }> {
  const cfg = uploadConfig();
  await authorize(prisma, actorId, "ADMIN");
  const profile = await getProfile(input.profileId);
  if (!profile) throw new DomainError("La fuente indicada no está disponible.");
  const name = sanitizeName(input.originalName);
  const format = formatOf(name);
  if (!format || !profile.formats.includes(format)) {
    throw new DomainError(`Formato no admitido para esta fuente: use ${profile.formats.map((f) => f.toUpperCase()).join(" o ")}.`);
  }
  const meta = profile.metadataSchema.safeParse(input.metadata ?? {});
  if (!meta.success) {
    throw new DomainError(meta.error.issues.map((i) => i.message).join(" "), Object.fromEntries(meta.error.issues.map((i) => [String(i.path[0] ?? "_"), i.message])));
  }
  const declared = declaredSchema.safeParse(input.declared ?? {});
  if (!declared.success) throw new DomainError(declared.error.issues.map((i) => i.message).join(" "));
  const scopeKey = profile.scopeKey?.(meta.data) ?? null;
  if (profile.policy === "REPLACE_SCOPE" && !scopeKey) throw new DomainError("Falta el ámbito que se sustituye.");

  if (input.contentLength !== null && input.contentLength > cfg.maxBytes) {
    throw new UploadLimitError(`El archivo supera el tamaño máximo permitido (${Math.round(cfg.maxBytes / 1048576)} MB).`);
  }
  if (activeUploads >= cfg.maxConcurrentUploads) {
    throw new UploadBusyError("Hay demasiadas subidas simultáneas. Inténtelo de nuevo en unos instantes.");
  }
  const open = await prisma.uploadBatch.count({
    where: { status: { in: ["RECEIVING", "QUEUED", "PREPARING", "ACTIVATION_QUEUED", "ACTIVATING"] } },
  });
  if (open >= cfg.maxOpenBatches) throw new UploadBusyError("Hay demasiadas cargas en curso. Espere a que terminen e inténtelo de nuevo.");

  const storageId = newStorageId();
  const batch = await prisma.uploadBatch.create({
    data: {
      profileId: profile.id,
      profileVersion: profile.version,
      status: "RECEIVING",
      originalName: name,
      storageId,
      fileFormat: format,
      metadata: meta.data as Prisma.InputJsonValue,
      scopeKey,
      declaredExtractionDate: declared.data.extraccion ? new Date(`${declared.data.extraccion}T00:00:00Z`) : null,
      declaredFrom: declared.data.desde ? new Date(`${declared.data.desde}T00:00:00Z`) : null,
      declaredTo: declared.data.hasta ? new Date(`${declared.data.hasta}T00:00:00Z`) : null,
      coverageNote: declared.data.cobertura ?? null,
      phase: "Recibiendo archivo",
      createdById: actorId,
    },
  });
  activeUploads++;
  let result: { size: number; checksum: string };
  try {
    result = await receiveToStorage(input.body, storageId, cfg.maxBytes);
  } catch (e) {
    const limit = e instanceof StorageError && e.code === "LIMIT";
    await prisma.uploadBatch.updateMany({
      where: { id: batch.id, status: "RECEIVING" },
      data: {
        status: "REJECTED",
        statusDetail: limit ? "El archivo supera el tamaño máximo permitido." : "Subida incompleta: el archivo no llegó completo y no se ha procesado.",
        finishedAt: new Date(),
      },
    });
    await removePart(storageId);
    if (limit) throw new UploadLimitError("El archivo supera el tamaño máximo permitido.");
    throw new DomainError("La subida se interrumpió antes de completarse; no se ha procesado.");
  } finally {
    activeUploads--;
  }
  const same = await prisma.uploadBatch.findFirst({
    where: { checksum: result.checksum, id: { not: batch.id }, status: { notIn: ["REJECTED", "CANCELLED"] } },
    select: { id: true },
  });
  return adminTransaction(actorId, async (tx, actor) => {
    const res = await tx.uploadBatch.updateMany({
      where: { id: batch.id, status: "RECEIVING" },
      data: {
        status: "QUEUED",
        phase: "En cola",
        sizeBytes: BigInt(result.size),
        checksum: result.checksum,
        metadata: { ...(meta.data as object), ...(same ? { __mismoChecksumQue: same.id } : {}) } as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });
    if (res.count === 0) throw new DomainError("El lote ya no está recibiendo archivo (caducó o se canceló).");
    await enqueueJob(tx, batch.id, "PREPARE", actor.id);
    await recordAudit(tx, actor, {
      action: "UPLOAD",
      entityType: "UploadBatch",
      entityId: batch.id,
      batchId: batch.id,
      summary: `Carga «${name}» recibida para ${profile.label} (${result.size} bytes${same ? `; mismo checksum que el lote ${same.id}` : ""})`,
      after: { perfil: profile.id, checksum: result.checksum, tamano: result.size },
    });
    return { id: batch.id, status: "QUEUED" as const };
  });
}

// ------------------------------------------------------------------ Consultas (solo ADMIN)

const num = (v: bigint | number) => Number(v);

export async function listUploads(
  actorId: string,
  query: { page?: number; pageSize?: number; status?: UploadStatusName; profileId?: string } = {},
) {
  await authorize(prisma, actorId, "ADMIN");
  const { page, pageSize, skip, take } = paging({ pageSize: 20, ...query });
  const where: Prisma.UploadBatchWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.profileId ? { profileId: query.profileId } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.uploadBatch.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take,
      select: {
        id: true, profileId: true, status: true, statusDetail: true, originalName: true, sizeBytes: true, phase: true,
        rowsProcessed: true, rowsReceived: true, rowsValid: true, rowsError: true, rowsImported: true,
        createdAt: true, finishedAt: true, createdBy: { select: { email: true } },
      },
    }),
    prisma.uploadBatch.count({ where }),
  ]);
  return pageResult(rows.map((r) => ({ ...r, sizeBytes: num(r.sizeBytes) })), total, page, pageSize);
}

/** Fuentes para la pantalla: disponibles (con su formulario) y pendientes (deshabilitadas). */
export async function listSources(actorId: string) {
  await authorize(prisma, actorId, "ADMIN");
  const profiles = await getProfiles();
  return {
    available: profiles.map((p) => ({
      id: p.id, label: p.label, description: p.description, formats: p.formats, metadataFields: p.metadataFields,
    })),
    pending: await getPendingSources(),
  };
}

/** Motivo por el que un perfil bloquea confirmar un lote con errores obligatorios sin resolver (o null). */
export function confirmBlockReason(profile: { blocksConfirmOnErrors?: boolean } | null, rowsError: number): string | undefined {
  if (!profile?.blocksConfirmOnErrors || rowsError <= 0) return undefined;
  return `Hay ${rowsError.toLocaleString("es-ES")} fila(s) con errores obligatorios sin resolver: el lote no se confirma mientras queden. Corrija el archivo, súbalo de nuevo y cancele este lote.`;
}

export async function getUpload(actorId: string, id: string) {
  await authorize(prisma, actorId, "ADMIN");
  const batch = await prisma.uploadBatch.findUnique({
    where: { id },
    include: {
      createdBy: { select: { email: true } },
      jobs: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!batch) return null;
  const profile = await getProfile(batch.profileId);
  const pendingRevert = batch.jobs.some((j) => j.kind === "REVERT" && (j.status === "PENDING" || j.status === "RUNNING"));
  const pendingRederive = batch.jobs.some((j) => j.kind === "REDERIVE" && (j.status === "PENDING" || j.status === "RUNNING"));
  const sameChecksum = batch.checksum
    ? await prisma.uploadBatch.findMany({
        where: { checksum: batch.checksum, id: { not: batch.id } },
        select: { id: true, status: true, originalName: true },
        take: 5,
      })
    : [];
  const gate = batch.status === "READY" ? await profile?.confirmGate?.(prisma, batch.id) : undefined;
  const actions = availableActions(batch.status as UploadStatusName, {
    supportsRevert: profile ? Boolean(profile.revert) : false,
    isCurrentOfScope: batch.supersededByBatchId === null,
    supportsRederive: Boolean(profile?.rederive),
    confirmBlockedReason: confirmBlockReason(profile, batch.rowsError) ?? gate,
  });
  if (pendingRevert) actions.revert = { allowed: false, reason: "La reversión ya está en cola." };
  if (pendingRederive) actions.reprocess = { allowed: false, reason: "El recálculo ya está en cola." };
  return { batch: { ...batch, sizeBytes: num(batch.sizeBytes) }, profile: profile ? { id: profile.id, label: profile.label, policy: profile.policy } : null, actions, pendingRevert, pendingRederive, sameChecksum };
}

/** Estado ligero para sondeo desde la interfaz. */
export async function uploadStatus(actorId: string, id: string) {
  await authorize(prisma, actorId, "ADMIN");
  const b = await prisma.uploadBatch.findUnique({
    where: { id },
    select: {
      id: true, status: true, statusDetail: true, phase: true, rowsProcessed: true, rowsReceived: true, rowsValid: true,
      rowsError: true, rowsDuplicate: true, rowsExcluded: true, rowsReviewed: true, rowsWarning: true, rowsImported: true, version: true,
    },
  });
  if (!b) return null;
  // Un recálculo en cola o en curso mantiene el sondeo aunque el lote ya esté completado.
  const busy = (await prisma.uploadJob.count({ where: { batchId: id, status: { in: ["PENDING", "RUNNING"] } } })) > 0;
  return { ...b, terminal: TERMINAL_STATUSES.includes(b.status as UploadStatusName), busy };
}

/** Previsualización limitada y paginada del staging (nunca altera datos activos). */
export async function listStagedRows(
  actorId: string,
  id: string,
  query: { page?: number; pageSize?: number; classification?: "VALID" | "ERROR" | "EXCLUDED"; onlyWarnings?: boolean } = {},
) {
  await authorize(prisma, actorId, "ADMIN");
  const { page, pageSize, skip, take } = paging({ pageSize: 25, ...query });
  const where: Prisma.UploadStagedRowWhereInput = {
    batchId: id,
    ...(query.classification ? { classification: query.classification } : {}),
    ...(query.onlyWarnings ? { hasWarning: true } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.uploadStagedRow.findMany({
      where, orderBy: { position: "asc" }, skip, take,
      select: { position: true, sheet: true, sourceRow: true, raw: true, typed: true, classification: true, issues: true, duplicateInFile: true, disposition: true },
    }),
    prisma.uploadStagedRow.count({ where }),
  ]);
  return pageResult(rows, total, page, pageSize);
}

// ------------------------------------------------------------------ Acciones (compare-and-set de estado)

async function explain(tx: Prisma.TransactionClient, id: string, verb: string): Promise<never> {
  const b = await tx.uploadBatch.findUnique({ where: { id }, select: { status: true } });
  if (!b) throw new DomainError("Carga no encontrada.");
  throw new DomainError(`No se puede ${verb}: el lote está en estado «${b.status}».`);
}

export async function confirmUpload(actorId: string, id: string, opts: { expectedVersion?: number } = {}) {
  return adminTransaction(actorId, async (tx, actor) => {
    const cur = await tx.uploadBatch.findUnique({ where: { id }, select: { status: true, rowsError: true, profileId: true } });
    if (cur?.status === "READY") {
      const profile = await getProfile(cur.profileId);
      const blocked = confirmBlockReason(profile, cur.rowsError) ?? (await profile?.confirmGate?.(tx, id));
      if (blocked) throw new DomainError(blocked);
    }
    const res = await tx.uploadBatch.updateMany({
      where: { id, status: "READY", ...(opts.expectedVersion !== undefined ? { version: opts.expectedVersion } : {}) },
      data: { status: "ACTIVATION_QUEUED", phase: "En cola de activación", confirmedById: actor.id, confirmedAt: new Date(), version: { increment: 1 } },
    });
    if (res.count === 0) {
      if (opts.expectedVersion !== undefined) {
        const cur = await tx.uploadBatch.findUnique({ where: { id }, select: { status: true, version: true } });
        if (cur?.status === "READY" && cur.version !== opts.expectedVersion) throw new StaleVersionError("El lote");
      }
      return explain(tx, id, "confirmar");
    }
    await enqueueJob(tx, id, "ACTIVATE", actor.id);
    await recordAudit(tx, actor, { action: "CONFIRM", entityType: "UploadBatch", entityId: id, batchId: id, summary: "Carga confirmada: pasa a la cola de activación" });
    return { id, status: "ACTIVATION_QUEUED" as const };
  });
}

export async function cancelUpload(actorId: string, id: string) {
  return adminTransaction(actorId, async (tx, actor) => {
    const cur = await tx.uploadBatch.findUnique({ where: { id }, select: { status: true } });
    if (!cur) throw new DomainError("Carga no encontrada.");
    const act = availableActions(cur.status as UploadStatusName).cancel;
    if (!act.allowed) throw new DomainError(act.reason ?? "No se puede cancelar.");
    let outcome: "cancelled" | "requested";
    if (cur.status === "PREPARING") {
      const r = await tx.uploadBatch.updateMany({ where: { id, status: "PREPARING" }, data: { cancelRequested: true, phase: "Cancelación solicitada" } });
      if (r.count === 0) return explain(tx, id, "cancelar");
      outcome = "requested";
    } else {
      const r = await tx.uploadBatch.updateMany({
        where: { id, status: { in: ["RECEIVING", "QUEUED", "READY", "ACTIVATION_QUEUED"] } },
        data: { status: "CANCELLED", phase: "Cancelado", finishedAt: new Date(), version: { increment: 1 } },
      });
      if (r.count === 0) return explain(tx, id, "cancelar");
      await tx.uploadJob.updateMany({ where: { batchId: id, status: "PENDING" }, data: { status: "CANCELLED", finishedAt: new Date() } });
      outcome = "cancelled";
    }
    await recordAudit(tx, actor, { action: "CANCEL", entityType: "UploadBatch", entityId: id, batchId: id, summary: outcome === "requested" ? "Cancelación solicitada durante la preparación" : "Carga cancelada antes de activar" });
    return { id, outcome };
  });
}

export async function reprocessUpload(actorId: string, id: string) {
  return adminTransaction(actorId, async (tx, actor) => {
    const b = await tx.uploadBatch.findUnique({ where: { id }, select: { storageId: true, status: true, profileId: true } });
    if (!b) throw new DomainError("Carga no encontrada.");
    const profile = await getProfile(b.profileId);
    const act = availableActions(b.status as UploadStatusName, { supportsRederive: Boolean(profile?.rederive) }).reprocess;
    if (!act.allowed) throw new DomainError(act.reason ?? "No se puede reprocesar.");
    if (b.status === "COMPLETED") {
      // Lote ya activo: se recalcula lo derivado con los maestros y fuentes actuales, sin releer el archivo.
      await enqueueJob(tx, id, "REDERIVE", actor.id);
      await recordAudit(tx, actor, { action: "REPROCESS", entityType: "UploadBatch", entityId: id, batchId: id, summary: "Recálculo solicitado: relaciones y atribución con los datos actuales" });
      return { id, status: "COMPLETED" as const, rederive: true as const };
    }
    if ((await fileSize(b.storageId)) === null) throw new DomainError("El archivo original ya no está en el almacén: suba el archivo de nuevo.");
    const r = await tx.uploadBatch.updateMany({
      where: { id, status: { in: ["READY", "REJECTED", "FAILED"] } },
      data: {
        status: "QUEUED", statusDetail: null, phase: "En cola (reproceso)", checkpointPosition: 0, rowsProcessed: 0,
        rowsReceived: 0, rowsValid: 0, rowsError: 0, rowsReviewed: 0, rowsDuplicate: 0, rowsExcluded: 0, rowsWarning: 0,
        rowsImported: 0, summary: Prisma.DbNull, rulesSnapshot: null, cancelRequested: false, finishedAt: null, preparedAt: null,
        version: { increment: 1 },
      },
    });
    if (r.count === 0) return explain(tx, id, "reprocesar");
    await enqueueJob(tx, id, "PREPARE", actor.id);
    await recordAudit(tx, actor, { action: "REPROCESS", entityType: "UploadBatch", entityId: id, batchId: id, summary: "Reproceso solicitado reutilizando el archivo original" });
    return { id, status: "QUEUED" as const };
  });
}

export async function revertUpload(actorId: string, id: string) {
  return adminTransaction(actorId, async (tx, actor) => {
    const b = await tx.uploadBatch.findUnique({ where: { id }, select: { status: true, profileId: true, supersededByBatchId: true } });
    if (!b) throw new DomainError("Carga no encontrada.");
    const profile = await getProfile(b.profileId);
    const act = availableActions(b.status as UploadStatusName, {
      supportsRevert: profile ? Boolean(profile.revert) : false,
      isCurrentOfScope: b.supersededByBatchId === null,
    }).revert;
    if (!act.allowed) throw new DomainError(act.reason ?? "No se puede revertir.");
    await enqueueJob(tx, id, "REVERT", actor.id);
    return { id, queued: true as const };
  });
}
