import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { authorize } from "@/server/authorize";
import { pageResult, paging } from "@/server/common";
import { PAP_PROFILE } from "@/domain/pap";
import { previewState } from "../zendesk/preview";
import { papScopeSql } from "./profile";

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

async function head(batchId: string) {
  return prisma.uploadBatch.findUnique({
    where: { id: batchId },
    select: { id: true, profileId: true, status: true, scopeKey: true, rowsReceived: true, rowsError: true, declaredExtractionDate: true, createdAt: true },
  });
}

/** Entidades distintas del archivo (filas válidas y únicas), con su ámbito calculado al momento y sus referencias expandidas. */
const entities = (batchId: string) => Prisma.sql`
  SELECT r.position, r."sourceRow", r.sheet, r.fingerprint, r.disposition, r.derived->>'papId' AS pap_id, r.derived->>'corrective' AS corrective,
    r.typed->>'title' AS title, r.typed->>'proyecto' AS project, r.typed->>'resultado' AS result, r.typed->>'fecha_produccion' AS production_date,
    r.typed->>'fecha_produccion_texto' AS production_text, r.typed->>'fecha_solicitud' AS request_date, r.derived->'causes' AS causes, r.derived->'refs' AS refs,
    sc.scope, sc.group_id, sc.client_id
  FROM "UploadStagedRow" r
  LEFT JOIN (${papScopeSql(Prisma.sql`
    SELECT r2.position::text AS key, r2.typed->>'proyecto' AS project, (r2.typed->>'fecha_produccion')::date AS production_date
    FROM "UploadStagedRow" r2 WHERE r2."batchId" = ${batchId} AND r2.classification = 'VALID' AND NOT r2."duplicateInFile"`)}) sc ON sc.key = r.position::text
  WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' AND NOT r."duplicateInFile"`;

export type PapSummary = {
  listKey: string | null;
  rowsReceived: number;
  rowsWithError: number;
  duplicatesInFile: number;
  /** PAP distintos del archivo: cada uno es una intervención, aunque tenga varias causas o varios tickets. */
  distinctPap: number;
  newPap: number;
  revisedPap: number;
  unchangedPap: number;
  corrective: number;
  nonCorrective: number;
  unknownCause: number;
  /** Pertenencias a cada familia: NO son aditivas (un PAP con tres causas pertenece a varias familias). */
  memberships: { category: string; pap: number }[];
  /** PAP correctivos DISTINTOS por origen del correctivo (también se solapan entre sí). */
  origins: { origin: string; pap: number }[];
  withProductionDate: number;
  withoutProductionDate: number;
  unreadableProductionDate: number;
  withoutRequestDate: number;
  productionFrom: string | null;
  productionTo: string | null;
  results: { result: string; pap: number }[];
  scopes: { scope: string; pap: number }[];
  scopeContradictions: number;
  refs: { ticketPairs: number; ticketsKnown: number; ticketsPending: number; unparsed: number; cal: number; bugRefs: number; bugExplicit: number; bugResolved: number; bugAmbiguousProduct: number };
  observedOn: string;
  freshnessKnown: boolean;
  olderThanCurrent: number;
  sameDayObservations: number;
  preview: { computedAt: Date; stale: boolean } | null;
};

export async function papSummary(actorId: string, batchId: string): Promise<PapSummary | null> {
  await authorize(prisma, actorId, "ADMIN");
  const h = await head(batchId);
  if (!h || h.profileId !== PAP_PROFILE) return null;
  const e = entities(batchId);
  const observedOn = (h.declaredExtractionDate ?? h.createdAt).toISOString().slice(0, 10);
  const [c, mem, org, res, sc, dates, refs, contra, dup, older, tie] = await Promise.all([
    prisma.$queryRaw<Record<string, bigint>[]>(Prisma.sql`
      SELECT count(*) AS distinct_pap, count(*) FILTER (WHERE disposition = 'NEW') AS new_pap, count(*) FILTER (WHERE disposition = 'REVISION') AS revised,
        count(*) FILTER (WHERE disposition = 'DUPLICATE_EXISTING') AS unchanged, count(*) FILTER (WHERE corrective = 'CORRECTIVE') AS corrective,
        count(*) FILTER (WHERE corrective = 'NON_CORRECTIVE') AS non_corrective, count(*) FILTER (WHERE corrective = 'UNKNOWN') AS unknown
      FROM (${e}) x`),
    prisma.$queryRaw<{ category: string; pap: bigint }[]>(Prisma.sql`
      SELECT c->>'category' AS category, count(DISTINCT x.pap_id) AS pap FROM (${e}) x, jsonb_array_elements(x.causes) c GROUP BY 1 ORDER BY 1`),
    prisma.$queryRaw<{ origin: string; pap: bigint }[]>(Prisma.sql`
      SELECT c->>'origin' AS origin, count(DISTINCT x.pap_id) AS pap FROM (${e}) x, jsonb_array_elements(x.causes) c
      WHERE c->>'category' = 'CORRECTIVE' GROUP BY 1 ORDER BY 1`),
    prisma.$queryRaw<{ result: string | null; pap: bigint }[]>(Prisma.sql`SELECT result, count(*) AS pap FROM (${e}) x GROUP BY 1 ORDER BY 2 DESC LIMIT 30`),
    prisma.$queryRaw<{ scope: string | null; pap: bigint }[]>(Prisma.sql`SELECT scope, count(*) AS pap FROM (${e}) x GROUP BY 1 ORDER BY 1`),
    prisma.$queryRaw<Record<string, bigint | string | null>[]>(Prisma.sql`
      SELECT count(*) FILTER (WHERE production_date IS NOT NULL) AS with_prod, count(*) FILTER (WHERE production_date IS NULL) AS without_prod,
        count(*) FILTER (WHERE production_date IS NULL AND production_text IS NOT NULL) AS unreadable, count(*) FILTER (WHERE request_date IS NULL) AS no_request,
        min(production_date) AS pmin, max(production_date) AS pmax
      FROM (${e}) x`),
    prisma.$queryRaw<Record<string, bigint>[]>(Prisma.sql`
      WITH r AS (SELECT x.pap_id, ref FROM (${e}) x, jsonb_array_elements(x.refs) ref)
      SELECT
        count(DISTINCT (r.pap_id, ref->>'refId')) FILTER (WHERE ref->>'kind' IN ('TICKET_ASSOCIATED', 'TICKET_PAP')) AS ticket_pairs,
        count(DISTINCT (r.pap_id, ref->>'refId')) FILTER (WHERE ref->>'kind' IN ('TICKET_ASSOCIATED', 'TICKET_PAP') AND EXISTS (SELECT 1 FROM "ZdTicket" t WHERE t."ticketId" = ref->>'refId')) AS known,
        count(*) FILTER (WHERE ref->>'kind' = 'TEXT') AS unparsed, count(*) FILTER (WHERE ref->>'kind' = 'CAL') AS cal,
        count(DISTINCT (r.pap_id, ref->>'key')) FILTER (WHERE ref->>'kind' = 'BUG' ) AS bug_refs,
        count(DISTINCT (r.pap_id, ref->>'key')) FILTER (WHERE ref->>'kind' = 'BUG' AND ref->>'product' IS NOT NULL) AS bug_explicit,
        count(DISTINCT (r.pap_id, ref->>'key')) FILTER (WHERE ref->>'kind' = 'BUG' AND ref->>'product' IS NOT NULL
          AND EXISTS (SELECT 1 FROM "WorkItem" w WHERE w.product = ref->>'product' AND w."workItemId" = ref->>'refId')) AS bug_resolved,
        count(DISTINCT (r.pap_id, ref->>'key')) FILTER (WHERE ref->>'kind' = 'BUG' AND ref->>'product' IS NULL) AS bug_ambiguous
      FROM r`),
    // Contradicción de ámbito: el grupo del proyecto no coincide con el grupo del Cliente de un ticket asociado (se muestra, no se corrige).
    prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT count(DISTINCT x.pap_id) AS n FROM (${e}) x, jsonb_array_elements(x.refs) ref
      JOIN "ZdTicket" t ON t."ticketId" = ref->>'refId' JOIN "ZdTicketRevision" rv ON rv.id = t."currentRevisionId"
      JOIN LATERAL (SELECT i."clientId" FROM "ExternalIdentity" i WHERE i.system = 'ZENDESK' AND i.kind = 'ORG_ID' AND i."isActive" AND i."searchValue" = rv."organizationId" LIMIT 1) idn ON true
      JOIN "Client" cl ON cl.id = idn."clientId"
      WHERE ref->>'kind' IN ('TICKET_ASSOCIATED', 'TICKET_PAP') AND x.group_id IS NOT NULL AND cl."isInternal" = false AND cl."groupId" IS DISTINCT FROM x.group_id`),
    prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM "UploadStagedRow" WHERE "batchId" = ${batchId} AND classification = 'VALID' AND "duplicateInFile"`),
    prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT count(*) AS n FROM (${e}) x JOIN "PapItem" it ON it."listKey" = ${h.scopeKey ?? ""} AND it."papId" = x.pap_id
      WHERE EXISTS (SELECT 1 FROM "PapObservation" o WHERE o."itemId" = it.id AND o."batchId" <> ${batchId} AND (o."observedOn", o."receivedAt") > (${observedOn}::date, ${h.createdAt}))`),
    prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT count(*) AS n FROM (${e}) x JOIN "PapItem" it ON it."listKey" = ${h.scopeKey ?? ""} AND it."papId" = x.pap_id
      WHERE EXISTS (SELECT 1 FROM "PapObservation" o WHERE o."itemId" = it.id AND o."batchId" <> ${batchId} AND o."observedOn" = ${observedOn}::date)`),
  ]);
  const x = c[0];
  const d = dates[0];
  const r = refs[0];
  return {
    listKey: h.scopeKey,
    rowsReceived: h.rowsReceived,
    rowsWithError: h.rowsError,
    duplicatesInFile: n(dup[0]?.n),
    distinctPap: n(x?.distinct_pap),
    newPap: n(x?.new_pap),
    revisedPap: n(x?.revised),
    unchangedPap: n(x?.unchanged),
    corrective: n(x?.corrective),
    nonCorrective: n(x?.non_corrective),
    unknownCause: n(x?.unknown),
    memberships: mem.map((m) => ({ category: m.category, pap: n(m.pap) })),
    origins: org.map((o) => ({ origin: o.origin ?? "OTHER_CORRECTIVE", pap: n(o.pap) })),
    withProductionDate: n(d?.with_prod as bigint),
    withoutProductionDate: n(d?.without_prod as bigint),
    unreadableProductionDate: n(d?.unreadable as bigint),
    withoutRequestDate: n(d?.no_request as bigint),
    productionFrom: d?.pmin ? String(d.pmin).slice(0, 10) : null,
    productionTo: d?.pmax ? String(d.pmax).slice(0, 10) : null,
    results: res.map((q) => ({ result: q.result ?? "(sin resultado)", pap: n(q.pap) })),
    scopes: sc.map((q) => ({ scope: q.scope ?? "UNMAPPED", pap: n(q.pap) })),
    scopeContradictions: n(contra[0]?.n),
    refs: {
      ticketPairs: n(r?.ticket_pairs),
      ticketsKnown: n(r?.known),
      ticketsPending: n(r?.ticket_pairs) - n(r?.known),
      unparsed: n(r?.unparsed),
      cal: n(r?.cal),
      bugRefs: n(r?.bug_refs),
      bugExplicit: n(r?.bug_explicit),
      bugResolved: n(r?.bug_resolved),
      bugAmbiguousProduct: n(r?.bug_ambiguous),
    },
    observedOn,
    freshnessKnown: h.declaredExtractionDate !== null,
    olderThanCurrent: n(older[0]?.n),
    sameDayObservations: n(tie[0]?.n),
    preview: await previewState(prisma, batchId, "pap"),
  };
}

export const PAP_FILTERS = ["corrective", "non-corrective", "unknown-cause", "no-production-date", "revision", "unmapped", "group-only", "pending-ticket", "unparsed", "bug-ambiguous"] as const;
export type PapFilter = (typeof PAP_FILTERS)[number];

export type PapRowView = {
  position: number;
  sheet: string | null;
  sourceRow: number;
  pap_id: string;
  title: string;
  project: string | null;
  result: string | null;
  production_date: string | null;
  corrective: string;
  causes: { raw: string; category: string; origin: string | null }[];
  scope: string | null;
  disposition: string | null;
};

export async function listBatchPap(actorId: string, batchId: string, query: { page?: number; pageSize?: number; filter?: string } = {}) {
  await authorize(prisma, actorId, "ADMIN");
  const { page, pageSize, skip, take } = paging({ pageSize: 20, ...query });
  const h = await head(batchId);
  if (!h || h.profileId !== PAP_PROFILE) return pageResult([] as PapRowView[], 0, 1, pageSize);
  const f = (PAP_FILTERS as readonly string[]).includes(query.filter ?? "") ? (query.filter as PapFilter) : null;
  const cond = (() => {
    switch (f) {
      case "corrective": return Prisma.sql`x.corrective = 'CORRECTIVE'`;
      case "non-corrective": return Prisma.sql`x.corrective = 'NON_CORRECTIVE'`;
      case "unknown-cause": return Prisma.sql`x.corrective = 'UNKNOWN'`;
      case "no-production-date": return Prisma.sql`x.production_date IS NULL`;
      case "revision": return Prisma.sql`x.disposition = 'REVISION'`;
      case "unmapped": return Prisma.sql`x.scope IN ('UNMAPPED', 'NO_PROJECT')`;
      case "group-only": return Prisma.sql`x.scope = 'GROUP_ONLY'`;
      case "pending-ticket": return Prisma.sql`EXISTS (SELECT 1 FROM jsonb_array_elements(x.refs) ref WHERE ref->>'kind' IN ('TICKET_ASSOCIATED', 'TICKET_PAP')
        AND NOT EXISTS (SELECT 1 FROM "ZdTicket" t WHERE t."ticketId" = ref->>'refId'))`;
      case "unparsed": return Prisma.sql`EXISTS (SELECT 1 FROM jsonb_array_elements(x.refs) ref WHERE ref->>'kind' = 'TEXT')`;
      case "bug-ambiguous": return Prisma.sql`EXISTS (SELECT 1 FROM jsonb_array_elements(x.refs) ref WHERE ref->>'kind' = 'BUG' AND ref->>'product' IS NULL)`;
      default: return Prisma.sql`true`;
    }
  })();
  const e = entities(batchId);
  const [data, total] = await Promise.all([
    prisma.$queryRaw<PapRowView[]>(Prisma.sql`
      SELECT x.position, x.sheet, x."sourceRow", x.pap_id, x.title, x.project, x.result, x.production_date, x.corrective, x.causes, x.scope, x.disposition
      FROM (${e}) x WHERE ${cond} ORDER BY x.position LIMIT ${take} OFFSET ${skip}`),
    prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM (${e}) x WHERE ${cond}`),
  ]);
  return pageResult(data, n(total[0]?.n), page, pageSize);
}
