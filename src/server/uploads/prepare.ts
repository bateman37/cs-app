import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { readerLimits, uploadConfig } from "./config";
import { computeDispositions, recomputeCounters } from "./disposition";
import { rowFingerprint } from "./fingerprint";
import type { Issue, Json } from "./profile";
import { getProfile } from "./registry";
import { assertFence, markJobCancelled, markJobDone, ReleaseRequested, type ClaimedJob } from "./queue";
import { readRows } from "./readers";
import { ReaderError, type Cell } from "./readers/types";
import { filePath, readHead } from "./storage";

export type JobRuntime = { job: ClaimedJob; shouldStop: () => boolean };

class CancelledError extends Error {}
class RejectedError extends Error {}

type Tx = Prisma.TransactionClient;

async function fenced<T>(job: ClaimedJob, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await assertFence(tx, job);
      return fn(tx);
    },
    { maxWait: 10_000, timeout: uploadConfig().activationTimeoutMs },
  );
}

async function reject(job: ClaimedJob, batchId: string, message: string) {
  await fenced(job, async (tx) => {
    await tx.uploadBatch.updateMany({
      where: { id: batchId, status: { in: ["QUEUED", "PREPARING"] } },
      data: { status: "REJECTED", statusDetail: message.slice(0, 500), phase: "Rechazado", finishedAt: new Date() },
    });
    await markJobDone(tx, job);
  });
}

function isEmptyRow(cells: Cell[]) {
  return cells.every((c) => c.v.trim() === "");
}

/**
 * Preparación: lee por bloques, valida con el perfil, escribe staging con checkpoint y progreso
 * (en la misma transacción de cada bloque, protegida por fencing) y calcula contadores por SQL.
 * Reanudable: tras un reinicio vuelve a leer y salta las posiciones ya confirmadas.
 */
export async function runPrepare(rt: JobRuntime): Promise<void> {
  const { job } = rt;
  const cfg = uploadConfig();
  const batch = await prisma.uploadBatch.findUnique({ where: { id: job.batchId } });
  if (!batch || !["QUEUED", "PREPARING"].includes(batch.status)) {
    await fenced(job, (tx) => markJobDone(tx, job));
    return;
  }
  const profile = await getProfile(batch.profileId);
  if (!profile) return reject(job, batch.id, "El perfil de esta carga no está disponible.");
  const dedupeKey = batch.scopeKey ?? "";

  try {
    const rules = await profile.rulesFingerprint(prisma);
    let checkpoint = batch.checkpointPosition;
    await fenced(job, async (tx) => {
      const cur = await tx.uploadBatch.findUniqueOrThrow({ where: { id: batch.id } });
      if (cur.cancelRequested || cur.status === "CANCELLED") throw new CancelledError();
      // Si cambiaron las reglas desde el primer bloque, lo ya preparado es obsoleto: se reinicia.
      if (checkpoint > 0 && cur.rulesSnapshot !== rules) checkpoint = 0;
      if (checkpoint === 0) {
        await tx.$executeRaw(Prisma.sql`DELETE FROM "UploadStagedRow" WHERE "batchId" = ${batch.id}`);
      }
      await tx.uploadBatch.update({
        where: { id: batch.id },
        data: {
          status: "PREPARING",
          phase: "Leyendo y validando",
          rulesSnapshot: rules,
          profileVersion: profile.version,
          checkpointPosition: checkpoint,
          rowsProcessed: checkpoint,
        },
      });
    });

    // El nombre o la extensión no validan el contenido: se comprueba la firma.
    const head = await readHead(batch.storageId, 4096);
    if (batch.fileFormat === "xlsx" && !(head[0] === 0x50 && head[1] === 0x4b)) {
      return reject(job, batch.id, "El archivo no es un libro XLSX válido (no tiene formato ZIP).");
    }
    if (batch.fileFormat === "csv" && head.includes(0)) {
      return reject(job, batch.id, "El archivo no parece un CSV de texto (contiene bytes binarios).");
    }

    type Staged = Prisma.UploadStagedRowCreateManyInput;
    let buf: Staged[] = [];
    let position = 0;
    let currentSheet: string | null | undefined = undefined;
    let expectHeader = true;
    let headerSeen = false;
    let schemaVersion = "";

    const flush = async (last: number) => {
      const rows = buf;
      buf = [];
      await fenced(job, async (tx) => {
        const cur = await tx.uploadBatch.findUniqueOrThrow({ where: { id: batch.id }, select: { cancelRequested: true, status: true } });
        if (cur.cancelRequested || cur.status === "CANCELLED") throw new CancelledError();
        if (rows.length > 0) await tx.uploadStagedRow.createMany({ data: rows });
        await tx.uploadBatch.update({ where: { id: batch.id }, data: { checkpointPosition: last, rowsProcessed: last } });
      });
      if (rt.shouldStop()) throw new ReleaseRequested();
    };

    try {
      for await (const row of readRows(filePath(batch.storageId), {
        format: batch.fileFormat as "csv" | "xlsx",
        limits: readerLimits(),
        delimiter: profile.delimiter,
        sheet: profile.sheet,
      })) {
        if (row.sheet !== currentSheet) {
          currentSheet = row.sheet;
          expectHeader = true;
        }
        if (expectHeader) {
          const m = profile.matchHeaders(row.cells.map((c) => c.v));
          if (!m.ok) throw new RejectedError(m.message);
          schemaVersion = m.schemaVersion;
          headerSeen = true;
          expectHeader = false;
          continue;
        }
        if (isEmptyRow(row.cells)) continue;
        position++;
        if (position <= checkpoint) continue;

        const parsed = profile.parseRow(row.cells);
        const issues: Issue[] = [...parsed.issues];
        const hasError = issues.some((i) => i.severity === "error");
        if (parsed.exclude && !hasError) {
          issues.push({ severity: "warning", code: parsed.exclude.code, message: parsed.exclude.message });
        }
        buf.push({
          batchId: batch.id,
          position,
          sheet: row.sheet,
          sourceRow: row.rowNumber,
          raw: row.cells.map((c) => [c.v, c.k]) as Prisma.InputJsonValue,
          typed: parsed.typed as Prisma.InputJsonValue,
          fingerprint: hasError ? null : rowFingerprint(parsed.typed as Record<string, Json>),
          entityKey: hasError ? null : (parsed.entityKey ?? null),
          classification: hasError ? "ERROR" : parsed.exclude ? "EXCLUDED" : "VALID",
          issues: issues.length > 0 ? (issues as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          hasWarning: issues.some((i) => i.severity === "warning"),
        });
        if (buf.length >= cfg.chunkRows) await flush(position);
      }
    } catch (e) {
      if (e instanceof ReaderError) return reject(job, batch.id, e.message);
      if (e instanceof RejectedError) return reject(job, batch.id, e.message);
      throw e;
    }
    if (!headerSeen) return reject(job, batch.id, "El archivo está vacío: no tiene cabecera.");
    await flush(position);

    // Posproceso por conjuntos: conflictos de clave, duplicados del archivo, disposiciones y contadores.
    await fenced(job, async (tx) => {
      await tx.uploadBatch.update({ where: { id: batch.id }, data: { phase: "Comprobando duplicados y revisiones" } });
      if (profile.entityConflictPolicy === "conflict") {
        await tx.$executeRaw(Prisma.sql`
          UPDATE "UploadStagedRow" r SET classification = 'ERROR', fingerprint = NULL,
            issues = COALESCE(r.issues, '[]'::jsonb) || ${JSON.stringify([
              { severity: "error", code: "CLAVE_REPETIDA", message: "La clave de entidad se repite en el archivo con contenido distinto." },
            ])}::jsonb
          WHERE r."batchId" = ${batch.id} AND r.classification = 'VALID' AND r."entityKey" IS NOT NULL
            AND EXISTS (SELECT 1 FROM "UploadStagedRow" p WHERE p."batchId" = r."batchId" AND p."entityKey" = r."entityKey"
              AND p.classification = 'VALID' AND p.fingerprint <> r.fingerprint AND p.position < r.position)`);
      }
      await tx.$executeRaw(Prisma.sql`UPDATE "UploadStagedRow" SET "duplicateInFile" = false WHERE "batchId" = ${batch.id} AND "duplicateInFile"`);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "UploadStagedRow" SET "duplicateInFile" = true WHERE id IN (
          SELECT id FROM (
            SELECT id, row_number() OVER (PARTITION BY fingerprint ORDER BY position) AS rn
            FROM "UploadStagedRow" WHERE "batchId" = ${batch.id} AND classification = 'VALID') t
          WHERE rn > 1)`);
      await computeDispositions(tx, batch.id, profile, dedupeKey);
      const counters = await recomputeCounters(tx, batch.id);
      const issueRows = await tx.$queryRaw<{ severity: string; code: string; message: string; n: bigint }[]>(Prisma.sql`
        SELECT i->>'severity' AS severity, i->>'code' AS code, min(i->>'message') AS message, count(*) AS n
        FROM "UploadStagedRow", jsonb_array_elements(issues) i
        WHERE "batchId" = ${batch.id} AND issues IS NOT NULL
        GROUP BY 1, 2 ORDER BY n DESC LIMIT 50`);
      await tx.uploadBatch.update({
        where: { id: batch.id },
        data: {
          ...counters,
          status: "READY",
          phase: "Listo para revisar",
          preparedAt: new Date(),
          summary: {
            schemaVersion,
            issues: issueRows.map((r) => ({ severity: r.severity, code: r.code, message: r.message, count: Number(r.n) })),
          },
        },
      });
      await markJobDone(tx, job);
    });
  } catch (e) {
    if (e instanceof CancelledError) {
      await fenced(job, async (tx) => {
        await tx.uploadBatch.updateMany({
          where: { id: batch.id, status: { in: ["QUEUED", "PREPARING"] } },
          data: { status: "CANCELLED", phase: "Cancelado", finishedAt: new Date() },
        });
        await markJobCancelled(tx, job);
      });
      return;
    }
    throw e;
  }
}
