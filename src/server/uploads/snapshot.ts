import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { authorize } from "@/server/authorize";

/** Fuentes de tiempo con instantánea activa por fuente (HOTFIX-01 §4): cada export completo posterior sustituye el conjunto activo anterior. */
const SNAPSHOT_VIEW: Record<string, string> = { "zendesk-tiempo": "ActiveZdTimeEntry", wrike: "ActiveWrikeTimeEntry" };

export type SnapshotImpact = {
  /** «legacy»: la base anterior al hotfix; «batch»: la instantánea de otro lote. */
  activeKind: "legacy" | "batch";
  activeBatchId: string | null;
  activeRecords: number;
  activeMinutes: string;
  incomingRows: number;
};

export const isSnapshotProfile = (profileId: string) => profileId in SNAPSHOT_VIEW;

/** Impacto visible antes de confirmar: qué actividad activa se sustituye y cuántas filas válidas aporta el export. Solo lectura. */
export async function snapshotImpact(actorId: string, batchId: string): Promise<SnapshotImpact | null> {
  await authorize(prisma, actorId, "ADMIN");
  const b = await prisma.uploadBatch.findUnique({ where: { id: batchId }, select: { profileId: true } });
  const view = b ? SNAPSHOT_VIEW[b.profileId] : undefined;
  if (!b || !view) return null;
  const [act] = await prisma.$queryRaw<{ n: bigint; m: string }[]>(
    Prisma.sql`SELECT count(*) AS n, COALESCE(sum(minutes), 0)::text AS m FROM ${Prisma.raw(`"${view}"`)}`,
  );
  const [ab] = await prisma.$queryRaw<{ id: string | null }[]>(Prisma.sql`SELECT "batchId" AS id FROM "ActiveTimeBatch" WHERE "profileId" = ${b.profileId}`);
  const [inc] = await prisma.$queryRaw<{ n: bigint }[]>(
    Prisma.sql`SELECT count(DISTINCT fingerprint) AS n FROM "UploadStagedRow" WHERE "batchId" = ${batchId} AND classification = 'VALID'`,
  );
  return { activeKind: ab?.id ? "batch" : "legacy", activeBatchId: ab?.id ?? null, activeRecords: Number(act.n), activeMinutes: act.m, incomingRows: Number(inc.n) };
}
