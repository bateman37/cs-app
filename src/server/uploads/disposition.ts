import { Prisma } from "@/generated/prisma/client";
import type { ImportProfile } from "./profile";

type Tx = Prisma.TransactionClient;

/**
 * Disposición de cada fila válida frente a los datos activos, por SQL de conjuntos:
 *  - DUPLICATE_EXISTING: otra fila idéntica (misma huella) ya la aporta un lote vigente (COMPLETED);
 *  - REVISION: la clave de entidad ya existe en un lote vigente con contenido distinto;
 *  - NEW: en cualquier otro caso.
 * Las filas duplicadas dentro del archivo, con error o excluidas quedan sin disposición.
 * En REPLACE_SCOPE todo lo válido se sustituye: todas son NEW.
 */
export async function computeDispositions(tx: Tx, batchId: string, profile: ImportProfile, dedupeKey: string) {
  await tx.$executeRaw(Prisma.sql`UPDATE "UploadStagedRow" SET disposition = NULL WHERE "batchId" = ${batchId} AND disposition IS NOT NULL`);
  if (profile.policy === "REPLACE_SCOPE") {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "UploadStagedRow" SET disposition = 'NEW'
      WHERE "batchId" = ${batchId} AND classification = 'VALID' AND "duplicateInFile" = false`);
    return;
  }
  await tx.$executeRaw(Prisma.sql`
    UPDATE "UploadStagedRow" r SET disposition = CASE
      WHEN EXISTS (
        SELECT 1 FROM "UploadRecordSource" s JOIN "UploadBatch" b ON b.id = s."batchId"
        WHERE s."profileId" = ${profile.id} AND s."dedupeKey" = ${dedupeKey} AND s.fingerprint = r.fingerprint
          AND b.status = 'COMPLETED' AND s."batchId" <> ${batchId}) THEN 'DUPLICATE_EXISTING'
      WHEN r."entityKey" IS NOT NULL AND EXISTS (
        SELECT 1 FROM "UploadRecordSource" s JOIN "UploadBatch" b ON b.id = s."batchId"
        WHERE s."profileId" = ${profile.id} AND s."dedupeKey" = ${dedupeKey} AND s."entityKey" = r."entityKey"
          AND s.fingerprint <> r.fingerprint AND b.status = 'COMPLETED' AND s."batchId" <> ${batchId}) THEN 'REVISION'
      ELSE 'NEW' END
    WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' AND r."duplicateInFile" = false`);
}

export type Counters = {
  rowsReceived: number;
  rowsValid: number;
  rowsError: number;
  rowsExcluded: number;
  rowsWarning: number;
  rowsDuplicate: number;
  rowsReviewed: number;
};

/** Contadores recalculados por agregación (nunca acumulados en memoria ni doble contados). */
export async function recomputeCounters(tx: Tx, batchId: string): Promise<Counters> {
  const r = await tx.$queryRaw<Record<string, bigint>[]>(Prisma.sql`
    SELECT count(*) AS received,
      count(*) FILTER (WHERE classification = 'ERROR') AS error,
      count(*) FILTER (WHERE classification = 'EXCLUDED') AS excluded,
      count(*) FILTER (WHERE "hasWarning") AS warning,
      count(*) FILTER (WHERE classification = 'VALID' AND "duplicateInFile") AS dupfile,
      count(*) FILTER (WHERE disposition = 'DUPLICATE_EXISTING') AS dupexist,
      count(*) FILTER (WHERE disposition = 'REVISION') AS reviewed
    FROM "UploadStagedRow" WHERE "batchId" = ${batchId}`);
  const x = r[0];
  const n = (k: string) => Number(x?.[k] ?? 0);
  return {
    rowsReceived: n("received"),
    rowsError: n("error"),
    rowsValid: n("received") - n("error"),
    rowsExcluded: n("excluded"),
    rowsWarning: n("warning"),
    rowsDuplicate: n("dupfile") + n("dupexist"),
    rowsReviewed: n("reviewed"),
  };
}
