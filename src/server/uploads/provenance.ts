import { Prisma } from "@/generated/prisma/client";

/**
 * Huellas «huérfanas» de un lote: las que él aportó y ningún OTRO lote vigente (COMPLETED) aporta.
 * Son las únicas que una reversión puede retirar; una fila también aportada por otro lote vigente
 * se conserva. Se expresa como fragmento SQL para operar por conjuntos, sin traer filas a memoria.
 */
export function orphanFingerprintsSql(batchId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT s.fingerprint FROM "UploadRecordSource" s
    WHERE s."batchId" = ${batchId}
      AND NOT EXISTS (
        SELECT 1 FROM "UploadRecordSource" o
        JOIN "UploadBatch" ob ON ob.id = o."batchId"
        WHERE o."profileId" = s."profileId" AND o."dedupeKey" = s."dedupeKey"
          AND o.fingerprint = s.fingerprint AND o."batchId" <> s."batchId" AND ob.status = 'COMPLETED'
      )`;
}
