import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { authorize } from "@/server/authorize";
import { pageResult, paging } from "@/server/common";
import { TICKET_STATUSES, TICKET_TYPES, TIME_BUCKETS, ZENDESK_TICKETS_PROFILE, ZENDESK_TIME_PROFILE, type TimeBucket } from "@/domain/zendesk";
import { derivationSql, stagedSource, ticketViewSql } from "./derive";

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

async function batchHead(batchId: string) {
  return prisma.uploadBatch.findUnique({
    where: { id: batchId },
    select: { id: true, profileId: true, status: true, declaredExtractionDate: true, createdAt: true, rowsReceived: true, rowsError: true },
  });
}

// ---------------------------------------------------------------- Tickets

const stagedTicketSrc = (batchId: string) => Prisma.sql`
  SELECT r.typed->>'ticket_id' AS key, r.typed->>'organization_id' AS org_id, (r.typed->>'created_on')::date AS created_on,
    r.typed->>'causa_raiz' AS cause,
    (lower(r.typed->>'type') = ANY(${[...TICKET_TYPES]}::text[])) AS type_known,
    (lower(r.typed->>'status') = ANY(${[...TICKET_STATUSES]}::text[])) AS status_known
  FROM "UploadStagedRow" r
  WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' AND r."duplicateInFile" = false`;

export type TicketsSummary = {
  rowsReceived: number;
  rowsWithError: number;
  /** Filas idénticas dentro del archivo (se materializan una vez). */
  duplicatesInFile: number;
  /** Tickets distintos válidos del archivo: cada uno aporta una observación. */
  distinctTickets: number;
  newTickets: number;
  revised: number;
  /** Contenido idéntico a una revisión ya registrada: solo se añade la observación. */
  unchanged: number;
  observations: number;
  /** Observaciones más antiguas que la vigente de otro lote: se conservan como histórico y no la sustituyen. */
  olderThanCurrent: number;
  orgNone: number;
  orgNoClient: number;
  clientNoGroup: number;
  internal: number;
  external: number;
  unresolvedClient: number;
  incomplete: number;
  observedOn: string;
  freshnessKnown: boolean;
  tagsDestinations: Record<string, number>;
};

export async function ticketsSummary(actorId: string, batchId: string): Promise<TicketsSummary | null> {
  await authorize(prisma, actorId, "ADMIN");
  const head = await batchHead(batchId);
  if (!head || head.profileId !== ZENDESK_TICKETS_PROFILE) return null;
  const [c] = await prisma.$queryRaw<Record<string, bigint>[]>(Prisma.sql`
    SELECT count(*) FILTER (WHERE classification = 'VALID' AND "duplicateInFile") AS dup,
      count(*) FILTER (WHERE classification = 'VALID' AND NOT "duplicateInFile") AS distinct_t,
      count(*) FILTER (WHERE disposition = 'NEW') AS new_t,
      count(*) FILTER (WHERE disposition = 'REVISION') AS revised,
      count(*) FILTER (WHERE disposition = 'DUPLICATE_EXISTING') AS unchanged
    FROM "UploadStagedRow" WHERE "batchId" = ${batchId}`);
  const observedOn = head.declaredExtractionDate ? head.declaredExtractionDate.toISOString().slice(0, 10) : head.createdAt.toISOString().slice(0, 10);
  const [older] = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
    SELECT count(*) AS n FROM "UploadStagedRow" r
    WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' AND NOT r."duplicateInFile"
      AND EXISTS (SELECT 1 FROM "ZdTicketObservation" o
        WHERE o."ticketId" = r.typed->>'ticket_id' AND o."batchId" <> ${batchId}
          AND (o."observedOn", o."receivedAt") > (${observedOn}::date, ${head.createdAt}))`);
  const [v] = await prisma.$queryRaw<Record<string, bigint>[]>(Prisma.sql`
    SELECT count(*) FILTER (WHERE org_state = 'NO_ORGANIZATION') AS org_none,
      count(*) FILTER (WHERE org_state = 'NO_CLIENT') AS org_no_client,
      count(*) FILTER (WHERE org_state = 'CLIENT_NO_GROUP') AS no_group,
      count(*) FILTER (WHERE client_id IS NOT NULL AND internal) AS internal,
      count(*) FILTER (WHERE client_id IS NOT NULL AND NOT internal) AS external,
      count(*) FILTER (WHERE client_id IS NULL) AS unresolved,
      count(*) FILTER (WHERE incomplete) AS incomplete
    FROM (${ticketViewSql(stagedTicketSrc(batchId))}) v`);
  const dest = await prisma.$queryRaw<{ d: string; n: bigint }[]>(Prisma.sql`
    SELECT d, count(*) AS n FROM (
      SELECT DISTINCT r.typed->>'ticket_id' AS t, m.dest AS d FROM "UploadStagedRow" r,
        LATERAL jsonb_array_elements_text(r.typed->'tags') tg(tag)
        JOIN (VALUES ('team_n2','CS_N2'),('team_n3_pmo','PMO_N3'),('team_it','IT_N3'),('team_plataforma','VFS_N4'),
          ('team_plataformavfs','VFS_N4'),('team_plataformaarq','ARQ_VFS_N4'),('team_plataformavsw','VSW_N4')) m(tag, dest) ON m.tag = tg.tag
      WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' AND NOT r."duplicateInFile") x
    GROUP BY d`);
  const destinations: Record<string, number> = {};
  for (const r of dest) destinations[r.d] = n(r.n);
  // Unión N3 (PMO o IT): un ticket con ambos cuenta una vez.
  const [n3] = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
    SELECT count(DISTINCT r.typed->>'ticket_id') AS n FROM "UploadStagedRow" r
    WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' AND NOT r."duplicateInFile"
      AND (r.typed->'tags' ? 'team_n3_pmo' OR r.typed->'tags' ? 'team_it')`);
  destinations.N3_UNION = n(n3?.n);
  return {
    rowsReceived: head.rowsReceived,
    rowsWithError: head.rowsError,
    duplicatesInFile: n(c?.dup),
    distinctTickets: n(c?.distinct_t),
    newTickets: n(c?.new_t),
    revised: n(c?.revised),
    unchanged: n(c?.unchanged),
    observations: n(c?.distinct_t),
    olderThanCurrent: n(older?.n),
    orgNone: n(v?.org_none),
    orgNoClient: n(v?.org_no_client),
    clientNoGroup: n(v?.no_group),
    internal: n(v?.internal),
    external: n(v?.external),
    unresolvedClient: n(v?.unresolved),
    incomplete: n(v?.incomplete),
    observedOn,
    freshnessKnown: head.declaredExtractionDate !== null,
    tagsDestinations: destinations,
  };
}

export const TICKET_FILTERS = ["new", "revised", "unchanged", "org_none", "org_no_client", "client_no_group", "internal", "external", "incomplete", "older"] as const;
export type TicketFilter = (typeof TICKET_FILTERS)[number];
export const TICKET_FILTER_LABEL: Record<TicketFilter, string> = {
  new: "Tickets nuevos",
  revised: "Tickets revisados (contenido distinto)",
  unchanged: "Sin cambios (solo observación)",
  org_none: "Sin organización informada",
  org_no_client: "Organización sin Cliente equivalente",
  client_no_group: "Cliente sin Grupo BC",
  internal: "Internos",
  external: "Externos",
  incomplete: "Clasificación incompleta",
  older: "Observación anterior a la vigente",
};

export async function listBatchTickets(actorId: string, batchId: string, query: { page?: number; pageSize?: number; filter?: TicketFilter } = {}) {
  await authorize(prisma, actorId, "ADMIN");
  const { page, pageSize, skip, take } = paging({ pageSize: 20, ...query });
  const head = await batchHead(batchId);
  if (!head || head.profileId !== ZENDESK_TICKETS_PROFILE) return pageResult([], 0, 1, pageSize);
  const observedOn = head.declaredExtractionDate ? head.declaredExtractionDate.toISOString().slice(0, 10) : head.createdAt.toISOString().slice(0, 10);
  const f = query.filter;
  const cond = Prisma.sql`${
    f === "new" ? Prisma.sql`x.disposition = 'NEW'`
    : f === "revised" ? Prisma.sql`x.disposition = 'REVISION'`
    : f === "unchanged" ? Prisma.sql`x.disposition = 'DUPLICATE_EXISTING'`
    : f === "org_none" ? Prisma.sql`x.org_state = 'NO_ORGANIZATION'`
    : f === "org_no_client" ? Prisma.sql`x.org_state = 'NO_CLIENT'`
    : f === "client_no_group" ? Prisma.sql`x.org_state = 'CLIENT_NO_GROUP'`
    : f === "internal" ? Prisma.sql`x.client_id IS NOT NULL AND x.internal`
    : f === "external" ? Prisma.sql`x.client_id IS NOT NULL AND NOT x.internal`
    : f === "incomplete" ? Prisma.sql`x.incomplete`
    : f === "older" ? Prisma.sql`x.older`
    : Prisma.sql`true`}`;
  const base = Prisma.sql`
    SELECT r.position, r.sheet, r."sourceRow", r.disposition, r.typed->>'ticket_id' AS ticket_id, r.typed->>'status' AS status, r.typed->>'type' AS type,
      r.typed->>'organization_id' AS org, v.client_id, cl.name AS client_name, gr.name AS group_name, v.internal, v.org_state, v.incident_class, v.hosting,
      v.incomplete, r.typed->>'causa_raiz' AS cause, r.typed->'tags' AS tags,
      EXISTS (SELECT 1 FROM "ZdTicketObservation" o WHERE o."ticketId" = r.typed->>'ticket_id' AND o."batchId" <> ${batchId}
        AND (o."observedOn", o."receivedAt") > (${observedOn}::date, ${head.createdAt})) AS older
    FROM "UploadStagedRow" r
    JOIN (${ticketViewSql(stagedTicketSrc(batchId))}) v ON v.key = r.typed->>'ticket_id'
    LEFT JOIN "Client" cl ON cl.id = v.client_id
    LEFT JOIN "ClientGroup" gr ON gr.id = cl."groupId"
    WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' AND NOT r."duplicateInFile"`;
  const [rows, total] = await Promise.all([
    prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT * FROM (${base}) x WHERE ${cond} ORDER BY x.position LIMIT ${take} OFFSET ${skip}`),
    prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM (${base}) x WHERE ${cond}`),
  ]);
  return pageResult(rows as TicketRowView[], n(total[0]?.n), page, pageSize);
}

export type TicketRowView = {
  position: number;
  sheet: string | null;
  sourceRow: number;
  disposition: string | null;
  ticket_id: string;
  status: string | null;
  type: string | null;
  org: string | null;
  client_name: string | null;
  group_name: string | null;
  internal: boolean | null;
  org_state: string;
  incident_class: string;
  hosting: string | null;
  incomplete: boolean;
  cause: string | null;
  tags: string[];
  older: boolean;
};

/** Detalle de un ticket: revisiones, observaciones y tiempos vinculados (para abrirlo desde la ficha del lote). */
export async function getTicketDetail(actorId: string, ticketId: string) {
  await authorize(prisma, actorId, "ADMIN");
  const ticket = await prisma.zdTicket.findUnique({ where: { ticketId } });
  if (!ticket) return null;
  const [revisions, observations, times] = await Promise.all([
    prisma.zdTicketRevision.findMany({ where: { ticketId }, orderBy: { revisionNo: "desc" } }),
    prisma.zdTicketObservation.findMany({ where: { ticketId }, orderBy: [{ observedOn: "desc" }, { id: "desc" }] }),
    prisma.$queryRaw<{ bucket: string; rows: bigint; hours: string }[]>(Prisma.sql`
      SELECT "drvBucket" AS bucket, count(*) AS rows, trim_scale(round(sum(minutes) / 60, 4))::text AS hours
      FROM "ZdTimeEntry" WHERE "ticketId" = ${ticketId} GROUP BY 1 ORDER BY 1`),
  ]);
  return { ticket, revisions, observations, times: times.map((t) => ({ bucket: t.bucket, rows: n(t.rows), hours: t.hours })) };
}

// ---------------------------------------------------------------- Tiempos

/**
 * Filas del lote con su motivo principal (una partición contable). En un lote completado el motivo sale de los
 * registros materializados (indexados); antes de activar, de la derivación en vivo sobre el staging.
 */
function timeRowsSql(batchId: string, completed: boolean): Prisma.Sql {
  const base = Prisma.sql`
    SELECT r.position, r.sheet, r."sourceRow", r.classification, r."duplicateInFile" AS dup, r.disposition, r.fingerprint,
      r.typed->>'ticket_id' AS ticket_id, r.typed->>'user_id' AS user_id, r.typed->>'user_name' AS user_name, r.typed->>'date' AS work_date,
      r.typed->>'id' AS source_id,
      CASE WHEN r.classification = 'VALID' THEN (r.typed->>'logged_hours')::numeric * 60 + (r.typed->>'logged_minutes')::numeric END AS minutes
    FROM "UploadStagedRow" r WHERE r."batchId" = ${batchId}`;
  const fixed = (alias: string, fallback: Prisma.Sql) => Prisma.sql`
    CASE WHEN ${Prisma.raw(alias)}.classification <> 'VALID' THEN NULL
         WHEN ${Prisma.raw(alias)}.dup THEN 'DUPLICATE_FILE'
         WHEN ${Prisma.raw(alias)}.disposition = 'DUPLICATE_EXISTING' THEN 'DUPLICATE_EXISTING'
         WHEN ${Prisma.raw(alias)}.disposition = 'PENDING_DECISION' THEN 'PENDING_DECISION'
         ELSE ${fallback} END`;
  if (completed) {
    return Prisma.sql`
      SELECT b.*, ${fixed("b", Prisma.sql`COALESCE(e1."drvBucket", e2."drvBucket", 'NO_TICKET')`)} AS bucket, COALESCE(e1."drvFlags", e2."drvFlags") AS flags
      FROM (${base}) b
      LEFT JOIN "ZdTimeEntry" e1 ON b.disposition = 'NEW' AND e1."originFingerprint" = b.fingerprint
      LEFT JOIN "ZdTimeDecision" dc ON b.disposition = 'CORRECTION' AND dc."batchId" = ${batchId} AND dc.fingerprint = b.fingerprint
      LEFT JOIN "ZdTimeEntry" e2 ON e2.id = dc."targetEntryId"`;
  }
  return Prisma.sql`
    SELECT b.*, ${fixed("b", Prisma.sql`COALESCE(d.bucket, 'NO_TICKET')`)} AS bucket, d.flags
    FROM (${base}) b
    LEFT JOIN (${derivationSql(stagedSource(batchId, Prisma.sql`AND r.disposition IN ('NEW', 'CORRECTION')`))}) d ON d.key = b.position::text`;
}

export type TimesSummary = {
  rowsReceived: number;
  rowsWithError: number;
  /** Filas válidas (todas tienen duración): la partición las reparte sin solaparse. */
  validRows: number;
  validMinutes: string;
  validHours: string;
  buckets: { bucket: TimeBucket; rows: number; minutes: string; hours: string }[];
  /** Suma de la partición: debe coincidir con las filas y horas válidas. */
  partitionRows: number;
  partitionMinutes: string;
  reconciled: boolean;
  flags: { flag: string; rows: number; hours: string }[];
  /** Horas de filas materializadas (no duplicadas) con Cliente resuelto, aunque falte la persona. */
  withClientHours: string;
  internalHours: string;
  pendingCorrections: number;
  source: "registros" | "previsualizacion";
};

export async function timesSummary(actorId: string, batchId: string): Promise<TimesSummary | null> {
  await authorize(prisma, actorId, "ADMIN");
  const head = await batchHead(batchId);
  if (!head || head.profileId !== ZENDESK_TIME_PROFILE) return null;
  const completed = head.status === "COMPLETED";
  const rows = timeRowsSql(batchId, completed);
  const [bucketRows, flagRows, totals, extra] = await Promise.all([
    prisma.$queryRaw<{ bucket: string; rows: bigint; minutes: string; hours: string }[]>(Prisma.sql`
      SELECT bucket, count(*) AS rows, sum(minutes)::text AS minutes, trim_scale(round(sum(minutes) / 60, 4))::text AS hours
      FROM (${rows}) x WHERE x.classification = 'VALID' GROUP BY bucket`),
    prisma.$queryRaw<{ flag: string; rows: bigint; hours: string }[]>(Prisma.sql`
      SELECT f AS flag, count(*) AS rows, trim_scale(round(sum(minutes) / 60, 4))::text AS hours
      FROM (${rows}) x, unnest(x.flags) f WHERE x.classification = 'VALID' GROUP BY f ORDER BY f`),
    prisma.$queryRaw<{ rows: bigint; minutes: string | null; hours: string | null }[]>(Prisma.sql`
      SELECT count(*) AS rows, sum((typed->>'logged_hours')::numeric * 60 + (typed->>'logged_minutes')::numeric)::text AS minutes,
        trim_scale(round(sum((typed->>'logged_hours')::numeric * 60 + (typed->>'logged_minutes')::numeric) / 60, 4))::text AS hours
      FROM "UploadStagedRow" WHERE "batchId" = ${batchId} AND classification = 'VALID'`),
    prisma.$queryRaw<{ with_client: string | null; internal: string | null }[]>(Prisma.sql`
      SELECT trim_scale(round(sum(minutes) FILTER (WHERE NOT ('NO_TICKET' = ANY(flags) OR 'NO_ORGANIZATION' = ANY(flags) OR 'NO_CLIENT' = ANY(flags))
              AND bucket NOT IN ('DUPLICATE_FILE', 'DUPLICATE_EXISTING', 'PENDING_DECISION', 'EXCLUDED_PMO', 'PENDING_ELIGIBILITY')) / 60, 4))::text AS with_client,
        trim_scale(round(sum(minutes) FILTER (WHERE 'INTERNAL' = ANY(flags)) / 60, 4))::text AS internal
      FROM (${rows}) x WHERE x.classification = 'VALID'`),
  ]);
  const byBucket = new Map(bucketRows.map((b) => [b.bucket, b]));
  const buckets = TIME_BUCKETS.map((bucket) => {
    const b = byBucket.get(bucket);
    return { bucket, rows: n(b?.rows), minutes: b?.minutes ?? "0", hours: b?.hours ?? "0" };
  });
  const partitionRows = buckets.reduce((a, b) => a + b.rows, 0);
  const [recon] = await prisma.$queryRaw<{ minutes: string | null }[]>(Prisma.sql`
    SELECT sum(minutes)::text AS minutes FROM (${rows}) x WHERE x.classification = 'VALID' AND x.bucket IS NOT NULL`);
  const pm = recon?.minutes ?? "0";
  const t = totals[0];
  const validRows = n(t?.rows);
  return {
    rowsReceived: head.rowsReceived,
    rowsWithError: head.rowsError,
    validRows,
    validMinutes: t?.minutes ?? "0",
    validHours: t?.hours ?? "0",
    buckets,
    partitionRows,
    partitionMinutes: pm,
    reconciled: partitionRows === validRows && Number(pm) === Number(t?.minutes ?? 0),
    flags: flagRows.map((f) => ({ flag: f.flag, rows: n(f.rows), hours: f.hours })),
    withClientHours: extra[0]?.with_client ?? "0",
    internalHours: extra[0]?.internal ?? "0",
    pendingCorrections: buckets.find((b) => b.bucket === "PENDING_DECISION")?.rows ?? 0,
    source: completed ? "registros" : "previsualizacion",
  };
}

export type TimeRowView = {
  position: number;
  sheet: string | null;
  sourceRow: number;
  ticket_id: string;
  user_id: string | null;
  user_name: string | null;
  work_date: string;
  source_id: string | null;
  hours: string;
  bucket: TimeBucket;
  flags: string[] | null;
  disposition: string | null;
};

export async function listBatchTimes(
  actorId: string,
  batchId: string,
  query: { page?: number; pageSize?: number; bucket?: TimeBucket; flag?: string } = {},
) {
  await authorize(prisma, actorId, "ADMIN");
  const { page, pageSize, skip, take } = paging({ pageSize: 20, ...query });
  const head = await batchHead(batchId);
  if (!head || head.profileId !== ZENDESK_TIME_PROFILE) return pageResult([] as TimeRowView[], 0, 1, pageSize);
  const rows = timeRowsSql(batchId, head.status === "COMPLETED");
  const cond = Prisma.sql`x.classification = 'VALID'
    ${query.bucket && (TIME_BUCKETS as readonly string[]).includes(query.bucket) ? Prisma.sql`AND x.bucket = ${query.bucket}` : Prisma.empty}
    ${query.flag ? Prisma.sql`AND ${query.flag} = ANY(x.flags)` : Prisma.empty}`;
  const [data, total] = await Promise.all([
    prisma.$queryRaw<TimeRowView[]>(Prisma.sql`
      SELECT x.position, x.sheet, x."sourceRow", x.ticket_id, x.user_id, x.user_name, x.work_date, x.source_id,
        trim_scale(round(x.minutes / 60, 4))::text AS hours, x.bucket, x.flags, x.disposition
      FROM (${rows}) x WHERE ${cond} ORDER BY x.position LIMIT ${take} OFFSET ${skip}`),
    prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM (${rows}) x WHERE ${cond}`),
  ]);
  return pageResult(data, n(total[0]?.n), page, pageSize);
}

export type CorrectionCandidate = {
  position: number;
  sheet: string | null;
  sourceRow: number;
  fingerprint: string;
  ticket_id: string;
  user: string | null;
  work_date: string;
  source_id: string;
  new_hours: string;
  decision: string | null;
  targetEntryId: string | null;
  matches: { id: string; hours: string; hourText: string | null; batchId: string }[];
};

/** Filas con posible corrección y su decisión, con antes/después y horas afectadas. */
export async function listCorrectionCandidates(actorId: string, batchId: string): Promise<CorrectionCandidate[]> {
  await authorize(prisma, actorId, "ADMIN");
  const rows = await prisma.$queryRaw<(Omit<CorrectionCandidate, "matches"> & { matches: CorrectionCandidate["matches"] | null })[]>(Prisma.sql`
    SELECT r.position, r.sheet, r."sourceRow", r.fingerprint, r.typed->>'ticket_id' AS ticket_id,
      COALESCE(r.typed->>'user_id', r.typed->>'user_name') AS "user", r.typed->>'date' AS work_date, r.typed->>'id' AS source_id,
      trim_scale(round(((r.typed->>'logged_hours')::numeric * 60 + (r.typed->>'logged_minutes')::numeric) / 60, 4))::text AS new_hours,
      d.decision, d."targetEntryId",
      (SELECT jsonb_agg(jsonb_build_object('id', e.id, 'hours', trim_scale(round(e.minutes / 60, 4))::text, 'hourText', e."hourText", 'batchId', e."firstBatchId") ORDER BY e."createdAt")
       FROM "ZdTimeEntry" e
       WHERE e."sourceId" = r.typed->>'id' AND e."ticketId" = r.typed->>'ticket_id' AND e."workDate" = (r.typed->>'date')::date
         AND e."userId" IS NOT DISTINCT FROM r.typed->>'user_id'
         AND (e."userId" IS NOT NULL OR e."userName" IS NOT DISTINCT FROM r.typed->>'user_name') AND e.fingerprint <> r.fingerprint) AS matches
    FROM "UploadStagedRow" r
    LEFT JOIN "ZdTimeDecision" d ON d."batchId" = r."batchId" AND d.fingerprint = r.fingerprint
    WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' AND NOT r."duplicateInFile"
      AND (r.disposition = 'PENDING_DECISION' OR d.id IS NOT NULL)
    ORDER BY r.position LIMIT 200`);
  return rows.map((r) => ({ ...r, matches: r.matches ?? [] }));
}
