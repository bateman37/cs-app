import { Prisma } from "@/generated/prisma/client";
import { derivationSql, stagedSource, stagedTicketSrc, ticketViewSql } from "./derive";

type Tx = Prisma.TransactionClient;
type Db = Tx | import("@/generated/prisma/client").PrismaClient;

/**
 * Instantáneas de previsualización. La derivación (relaciones, atribución, motivo) es cara a escala del origen: se calcula
 * una vez al preparar (o al activar/recalcular) y la ficha la lee indexada. Una huella de los datos de los que depende
 * (maestros y tickets) avisa si cambiaron después; «Reprocesar» la recalcula. La activación siempre deriva con los datos actuales.
 */
const count = (table: string) => Prisma.sql`(SELECT count(*)::text || ':' || coalesce(max("updatedAt")::text, '') FROM ${Prisma.raw(`"${table}"`)})`;

export async function dataStamp(db: Db, kind: "tickets" | "times"): Promise<string> {
  const parts = kind === "tickets" ? ["ExternalIdentity", "Client", "ServiceTerm"] : ["ZdTicket", "ExternalIdentity", "Client", "PersonAlias", "PersonTerm"];
  const r = await db.$queryRaw<{ s: string }[]>(Prisma.sql`SELECT concat_ws('|', ${Prisma.join(parts.map(count), ", ")}) AS s`);
  return r[0].s;
}

async function writeStamp(tx: Tx, batchId: string, kind: "tickets" | "times") {
  const stamp = await dataStamp(tx, kind);
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "ZdPreviewStamp" ("batchId", "computedAt", stamp) VALUES (${batchId}, now(), ${stamp})
    ON CONFLICT ("batchId") DO UPDATE SET "computedAt" = now(), stamp = EXCLUDED.stamp`);
}

export async function refreshTicketPreview(tx: Tx, batchId: string) {
  await tx.$executeRaw(Prisma.sql`DELETE FROM "ZdTicketPreview" WHERE "batchId" = ${batchId}`);
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "ZdTicketPreview" ("batchId", position, "ticketId", "orgState", "clientId", "groupId", internal, hosting, "incidentClass", incomplete)
    SELECT ${batchId}, (v.payload->>'position')::int, v.key, v.org_state, v.client_id, v.group_id, v.internal, v.hosting, v.incident_class, v.incomplete
    FROM (${ticketViewSql(stagedTicketSrc(batchId))}) v`);
  await writeStamp(tx, batchId, "tickets");
}

/**
 * Motivo principal e indicadores de las filas que se materializarían (NEW y CORRECTION). Con `fingerprint` solo se recalcula
 * esa fila (decisión de corrección); en otro caso, todo el lote.
 */
export async function refreshTimePreview(tx: Tx, batchId: string, fingerprint?: string) {
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
    FROM (${derivationSql(stagedSource(batchId, { extra: Prisma.sql`AND r.disposition IN ('NEW', 'CORRECTION') ${only}` }))}) d`);
  if (!fingerprint) await writeStamp(tx, batchId, "times");
}

/** ¿Cambiaron los maestros o los tickets desde que se calculó la instantánea de este lote? */
export async function previewState(db: Db, batchId: string, kind: "tickets" | "times"): Promise<{ computedAt: Date; stale: boolean } | null> {
  const r = await db.$queryRaw<{ computedAt: Date; stamp: string }[]>(Prisma.sql`SELECT "computedAt", stamp FROM "ZdPreviewStamp" WHERE "batchId" = ${batchId}`);
  if (!r[0]) return null;
  return { computedAt: r[0].computedAt, stale: r[0].stamp !== (await dataStamp(db, kind)) };
}
