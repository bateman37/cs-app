import { Prisma } from "@/generated/prisma/client";
import { wrikeDerivationSql, wrikeStagedSource } from "./derive";
import { writeStamp } from "../zendesk/preview";

type Tx = Prisma.TransactionClient;

/**
 * Motivo principal e indicadores de las filas de un lote Wrike que se materializarían (NEW y CORRECTION). Reutiliza la tabla
 * de instantánea de tiempos (ZdTimePreview, ZdPreviewStamp: son genéricas por lote). Con `fingerprint` solo se recalcula esa fila.
 */
export async function refreshWrikePreview(tx: Tx, batchId: string, fingerprint?: string) {
  const only = fingerprint ? Prisma.sql`AND r.fingerprint = ${fingerprint}` : Prisma.empty;
  if (fingerprint) {
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM "ZdTimePreview" p USING "UploadStagedRow" r
      WHERE p."batchId" = ${batchId} AND r."batchId" = p."batchId" AND r.position = p.position AND r.fingerprint = ${fingerprint}`);
  } else {
    await tx.$executeRaw(Prisma.sql`DELETE FROM "ZdTimePreview" WHERE "batchId" = ${batchId}`);
  }
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "ZdTimePreview" ("batchId", position, bucket, flags)
    SELECT ${batchId}, d.key::int, d.bucket, d.flags
    FROM (${wrikeDerivationSql(wrikeStagedSource(batchId, { extra: Prisma.sql`AND r.disposition IN ('NEW', 'CORRECTION') ${only}` }))}) d`);
  if (!fingerprint) await writeStamp(tx, batchId, "wrike");
}
