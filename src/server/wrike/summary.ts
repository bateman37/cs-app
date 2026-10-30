import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { authorize } from "@/server/authorize";
import { pageResult, paging } from "@/server/common";
import { WRIKE_BUCKETS, WRIKE_PROFILE, type WrikeBucket } from "@/domain/wrike";
import { previewState } from "../zendesk/preview";

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

async function head(batchId: string) {
  return prisma.uploadBatch.findUnique({ where: { id: batchId }, select: { id: true, profileId: true, status: true, rowsReceived: true, rowsError: true, rowsExcluded: true } });
}

/**
 * Filas del lote con su motivo principal (una partición contable). En un lote completado el motivo sale de los registros
 * materializados; antes de activar, de la instantánea calculada al preparar.
 */
function rowsSql(batchId: string, completed: boolean): Prisma.Sql {
  const bucketOf = (fallback: Prisma.Sql) => Prisma.sql`
    CASE WHEN b.classification = 'ERROR' THEN 'ERROR'
         WHEN b.classification = 'EXCLUDED' THEN 'UNIMPUTED'
         WHEN b.dup THEN 'DUPLICATE_FILE'
         WHEN b.disposition = 'DUPLICATE_EXISTING' THEN 'DUPLICATE_EXISTING'
         WHEN b.disposition = 'PENDING_DECISION' THEN 'PENDING_DECISION'
         ELSE ${fallback} END`;
  const base = Prisma.sql`
    SELECT r.position, r.sheet, r."sourceRow", r.classification, r."duplicateInFile" AS dup, r.disposition, r.fingerprint,
      r.typed->>'usuario' AS user_name, r.typed->>'proyecto' AS project, r.typed->>'tarea' AS task, r.typed->>'ticket_zendesk' AS ticket_text,
      r.typed->>'fecha' AS work_date,
      CASE WHEN r.classification = 'VALID' THEN (r.typed->>'horas')::numeric * 60 END AS minutes
    FROM "UploadStagedRow" r WHERE r."batchId" = ${batchId}`;
  if (completed) {
    return Prisma.sql`
      SELECT b.*, ${bucketOf(Prisma.sql`COALESCE(e1."drvBucket", e2."drvBucket", 'PENDING_ELIGIBILITY')`)} AS bucket, COALESCE(e1."drvFlags", e2."drvFlags") AS flags
      FROM (${base}) b
      LEFT JOIN "WrikeTimeEntry" e1 ON b.disposition = 'NEW' AND e1."originFingerprint" = b.fingerprint
      LEFT JOIN "WrikeTimeDecision" dc ON b.disposition = 'CORRECTION' AND dc."batchId" = ${batchId} AND dc.fingerprint = b.fingerprint
      LEFT JOIN "WrikeTimeEntry" e2 ON e2.id = dc."targetEntryId"`;
  }
  return Prisma.sql`
    SELECT b.*, ${bucketOf(Prisma.sql`COALESCE(p.bucket, 'PENDING_ELIGIBILITY')`)} AS bucket, p.flags AS flags
    FROM (${base}) b
    LEFT JOIN "ZdTimePreview" p ON p."batchId" = ${batchId} AND p.position = b.position`;
}

export type WrikeSummary = {
  rowsReceived: number;
  rowsWithError: number;
  /** Filas sin usuario, fecha y con cero horas: se conservan en bruto y no entran en el hecho de dedicación. */
  unimputedTasks: number;
  validRows: number;
  validMinutes: string;
  validHours: string;
  buckets: { bucket: WrikeBucket; rows: number; minutes: string; hours: string }[];
  partitionRows: number;
  partitionMinutes: string;
  reconciled: boolean;
  /** Tickets: de campo explícito, de nombre (inferidos), referencias pendientes, ambiguos, inválidos y sin ticket (filas materializables). */
  tickets: { explicitConfirmed: number; byName: number; pendingExplicit: number; pendingByName: number; ambiguous: number; invalid: number; none: number; contradictions: number };
  flags: { flag: string; rows: number; hours: string }[];
  roles: { role: string; rows: number; hours: string }[];
  pendingCorrections: number;
  source: "registros" | "previsualizacion";
  preview: { computedAt: Date; stale: boolean } | null;
};

export async function wrikeSummary(actorId: string, batchId: string): Promise<WrikeSummary | null> {
  await authorize(prisma, actorId, "ADMIN");
  const h = await head(batchId);
  if (!h || h.profileId !== WRIKE_PROFILE) return null;
  const completed = h.status === "COMPLETED";
  const rows = rowsSql(batchId, completed);
  const [bucketRows, flagRows, totals, unimputed] = await Promise.all([
    prisma.$queryRaw<{ bucket: string; rows: bigint; minutes: string; hours: string }[]>(Prisma.sql`
      SELECT bucket, count(*) AS rows, sum(minutes)::text AS minutes, trim_scale(round(sum(minutes) / 60, 4))::text AS hours
      FROM (${rows}) x WHERE x.classification = 'VALID' GROUP BY bucket`),
    prisma.$queryRaw<{ flag: string; rows: bigint; hours: string }[]>(Prisma.sql`
      SELECT f AS flag, count(*) AS rows, trim_scale(round(sum(minutes) / 60, 4))::text AS hours
      FROM (${rows}) x, unnest(x.flags) f WHERE x.classification = 'VALID' GROUP BY f ORDER BY f`),
    prisma.$queryRaw<{ rows: bigint; minutes: string | null; hours: string | null }[]>(Prisma.sql`
      SELECT count(*) AS rows, sum((typed->>'horas')::numeric * 60)::text AS minutes, trim_scale(round(sum((typed->>'horas')::numeric) , 4))::text AS hours
      FROM "UploadStagedRow" WHERE "batchId" = ${batchId} AND classification = 'VALID'`),
    prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM "UploadStagedRow" WHERE "batchId" = ${batchId} AND classification = 'EXCLUDED'`),
  ]);
  const byBucket = new Map(bucketRows.map((b) => [b.bucket, b]));
  const buckets = WRIKE_BUCKETS.map((bucket) => {
    const b = byBucket.get(bucket);
    return { bucket, rows: n(b?.rows), minutes: b?.minutes ?? "0", hours: b?.hours ?? "0" };
  });
  const partitionRows = buckets.reduce((a, b) => a + b.rows, 0);
  const [recon] = await prisma.$queryRaw<{ minutes: string | null }[]>(Prisma.sql`
    SELECT sum(minutes)::text AS minutes FROM (${rows}) x WHERE x.classification = 'VALID' AND x.bucket NOT IN ('ERROR', 'UNIMPUTED')`);
  const t = totals[0];
  const validRows = n(t?.rows);
  const pm = recon?.minutes ?? "0";
  const [tk] = await prisma.$queryRaw<Record<string, bigint>[]>(Prisma.sql`
    SELECT
      count(*) FILTER (WHERE NOT (flags && ARRAY['NO_TICKET','TICKET_PENDING','TICKET_AMBIGUOUS','TICKET_EXPLICIT_INVALID','TICKET_BY_NAME'])) AS explicit_confirmed,
      count(*) FILTER (WHERE 'TICKET_BY_NAME' = ANY(flags) AND NOT 'TICKET_PENDING' = ANY(flags)) AS by_name,
      count(*) FILTER (WHERE 'TICKET_PENDING' = ANY(flags) AND NOT 'TICKET_BY_NAME' = ANY(flags)) AS pending_explicit,
      count(*) FILTER (WHERE 'TICKET_PENDING' = ANY(flags) AND 'TICKET_BY_NAME' = ANY(flags)) AS pending_name,
      count(*) FILTER (WHERE 'TICKET_AMBIGUOUS' = ANY(flags)) AS ambiguous,
      count(*) FILTER (WHERE 'TICKET_EXPLICIT_INVALID' = ANY(flags)) AS invalid,
      count(*) FILTER (WHERE 'NO_TICKET' = ANY(flags)) AS none,
      count(*) FILTER (WHERE 'NAME_CONTRADICTS_EXPLICIT' = ANY(flags)) AS contradictions
    FROM (${rows}) x
    WHERE x.classification = 'VALID' AND x.bucket NOT IN ('DUPLICATE_FILE', 'DUPLICATE_EXISTING', 'PENDING_DECISION')`);
  const roles = await prisma.$queryRaw<{ role: string; rows: bigint; hours: string }[]>(Prisma.sql`
    SELECT substr(f, 6) AS role, count(*) AS rows, trim_scale(round(sum(minutes) / 60, 4))::text AS hours
    FROM (${rows}) x, unnest(x.flags) f WHERE x.classification = 'VALID' AND f LIKE 'ROLE:%' GROUP BY f ORDER BY f`);
  return {
    rowsReceived: h.rowsReceived,
    rowsWithError: h.rowsError,
    unimputedTasks: n(unimputed[0]?.n),
    validRows,
    validMinutes: t?.minutes ?? "0",
    validHours: t?.hours ?? "0",
    buckets,
    partitionRows,
    partitionMinutes: pm,
    reconciled: partitionRows === validRows && Number(pm) === Number(t?.minutes ?? 0) && h.rowsReceived === h.rowsError + n(unimputed[0]?.n) + validRows,
    tickets: {
      explicitConfirmed: n(tk?.explicit_confirmed),
      byName: n(tk?.by_name),
      pendingExplicit: n(tk?.pending_explicit),
      pendingByName: n(tk?.pending_name),
      ambiguous: n(tk?.ambiguous),
      invalid: n(tk?.invalid),
      none: n(tk?.none),
      contradictions: n(tk?.contradictions),
    },
    flags: flagRows.filter((f) => !f.flag.startsWith("ROLE:")).map((f) => ({ flag: f.flag, rows: n(f.rows), hours: f.hours })),
    roles: roles.map((r) => ({ role: r.role, rows: n(r.rows), hours: r.hours })),
    pendingCorrections: buckets.find((b) => b.bucket === "PENDING_DECISION")?.rows ?? 0,
    source: completed ? "registros" : "previsualizacion",
    preview: completed ? null : await previewState(prisma, batchId, "wrike"),
  };
}

export type WrikeRowView = {
  position: number;
  sheet: string | null;
  sourceRow: number;
  fingerprint: string | null;
  user_name: string | null;
  project: string | null;
  task: string | null;
  ticket_text: string | null;
  work_date: string | null;
  hours: string | null;
  bucket: string;
  flags: string[] | null;
  disposition: string | null;
};

/** Detalle filtrable por motivo (partición) o por indicador. «UNIMPUTED» y «ERROR» también son motivos. */
export async function listBatchWrike(actorId: string, batchId: string, query: { page?: number; pageSize?: number; bucket?: string; flag?: string } = {}) {
  await authorize(prisma, actorId, "ADMIN");
  const { page, pageSize, skip, take } = paging({ pageSize: 20, ...query });
  const h = await head(batchId);
  if (!h || h.profileId !== WRIKE_PROFILE) return pageResult([] as WrikeRowView[], 0, 1, pageSize);
  const rows = rowsSql(batchId, h.status === "COMPLETED");
  const known = [...WRIKE_BUCKETS, "UNIMPUTED", "ERROR"] as string[];
  const cond = Prisma.sql`true
    ${query.bucket && known.includes(query.bucket) ? Prisma.sql`AND x.bucket = ${query.bucket}` : Prisma.empty}
    ${query.flag ? Prisma.sql`AND ${query.flag} = ANY(x.flags)` : Prisma.empty}`;
  const [data, total] = await Promise.all([
    prisma.$queryRaw<WrikeRowView[]>(Prisma.sql`
      SELECT x.position, x.sheet, x."sourceRow", x.fingerprint, x.user_name, x.project, x.task, x.ticket_text, x.work_date,
        trim_scale(round(x.minutes / 60, 4))::text AS hours, x.bucket, x.flags, x.disposition
      FROM (${rows}) x WHERE ${cond} ORDER BY x.position LIMIT ${take} OFFSET ${skip}`),
    prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM (${rows}) x WHERE ${cond}`),
  ]);
  return pageResult(data, n(total[0]?.n), page, pageSize);
}
