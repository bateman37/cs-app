import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/server/audit";
import { authorize } from "@/server/authorize";
import { pageResult, paging } from "@/server/common";
import { DomainError, StaleVersionError } from "@/server/errors";
import { adminTransaction } from "@/server/tx";
import { BUG_PROFILES } from "@/domain/bugs";
import { previewState } from "../zendesk/preview";
import { resolveLinksSql } from "./links";

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
const PROFILE_IDS: string[] = Object.values(BUG_PROFILES);

async function head(batchId: string) {
  return prisma.uploadBatch.findUnique({
    where: { id: batchId },
    select: { id: true, profileId: true, status: true, scopeKey: true, metadata: true, rowsReceived: true, rowsError: true, declaredExtractionDate: true, declaredFrom: true, declaredTo: true, coverageNote: true, createdAt: true },
  });
}

const items = (batchId: string) => Prisma.sql`
  SELECT r.position, r."sourceRow", r.sheet, r.disposition, r.typed->>'id' AS wid, r.typed->>'tipo' AS item_type, r.typed->>'titulo' AS title,
    r.typed->>'estado' AS state, r.derived->>'stateCategory' AS category, (r.derived->>'stateKnown')::boolean AS state_known, (r.derived->>'isBug')::boolean AS is_bug,
    r.typed->>'creado' AS created, r.typed->>'cambiado' AS changed, r.typed->>'reportado_por' AS reported_by, r.derived->'links' AS links
  FROM "UploadStagedRow" r WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' AND NOT r."duplicateInFile"`;

const pairs = (batchId: string) => Prisma.sql`
  SELECT (x.wid || '|' || (l->>'ticketId')) AS key, x.wid, l->>'ticketId' AS ticket_id FROM (${items(batchId)}) x, jsonb_array_elements(x.links) l`;

export type BugsSummary = {
  product: string;
  scopeKey: string | null;
  view: string | null;
  declared: { extraction: string | null; from: string | null; to: string | null; coverage: string | null };
  observedOn: string;
  freshnessKnown: boolean;
  rowsReceived: number;
  rowsWithError: number;
  duplicatesInFile: number;
  /** Elementos distintos: cada uno es un Work Item aunque se repita en otras cargas. */
  distinctItems: number;
  newItems: number;
  revisedItems: number;
  unchangedItems: number;
  byType: { type: string; items: number }[];
  /** Solo Work Item Type = Bug_ participa en defectos. */
  bugs: number;
  bugsByState: { state: string; category: string; known: boolean; bugs: number }[];
  unknownStates: number;
  /** Pares Work Item–ticket DISTINTOS (una URL repetida no los multiplica) y su resolución actual. */
  linkPairs: number;
  linksByState: { state: string; pairs: number }[];
  bugsWithoutLinks: number;
  /** Elementos del mismo producto y ámbito conocidos que esta vista no contiene: no observados, no cerrados. */
  notObservedInThisView: { items: number; lastObservedFrom: string | null; lastObservedTo: string | null };
  olderThanCurrent: number;
  preview: { computedAt: Date; stale: boolean } | null;
};

export async function bugsSummary(actorId: string, batchId: string): Promise<BugsSummary | null> {
  await authorize(prisma, actorId, "ADMIN");
  const h = await head(batchId);
  if (!h || !PROFILE_IDS.includes(h.profileId)) return null;
  const product = h.profileId === BUG_PROFILES.VFS ? "VFS" : "VSW";
  const it = items(batchId);
  const observedOn = (h.declaredExtractionDate ?? h.createdAt).toISOString().slice(0, 10);
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const [c, types, states, lk, nolinks, dup, notObs, older] = await Promise.all([
    prisma.$queryRaw<Record<string, bigint>[]>(Prisma.sql`
      SELECT count(*) AS distinct_items, count(*) FILTER (WHERE disposition = 'NEW') AS new_items, count(*) FILTER (WHERE disposition = 'REVISION') AS revised,
        count(*) FILTER (WHERE disposition = 'DUPLICATE_EXISTING') AS unchanged, count(*) FILTER (WHERE is_bug) AS bugs,
        count(*) FILTER (WHERE NOT state_known) AS unknown_states FROM (${it}) x`),
    prisma.$queryRaw<{ item_type: string; items: bigint }[]>(Prisma.sql`SELECT item_type, count(*) AS items FROM (${it}) x GROUP BY 1 ORDER BY 2 DESC, 1`),
    prisma.$queryRaw<{ state: string; category: string; known: boolean; bugs: bigint }[]>(Prisma.sql`
      SELECT state, category, state_known AS known, count(*) AS bugs FROM (${it}) x WHERE is_bug GROUP BY 1, 2, 3 ORDER BY 4 DESC, 1`),
    prisma.$queryRaw<{ state: string; pairs: bigint }[]>(Prisma.sql`
      SELECT r.state, count(*) AS pairs FROM (${resolveLinksSql(Prisma.sql`SELECT DISTINCT key, ticket_id FROM (${pairs(batchId)}) p`)}) r GROUP BY 1 ORDER BY 1`),
    prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM (${it}) x WHERE is_bug AND jsonb_array_length(x.links) = 0`),
    prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM "UploadStagedRow" WHERE "batchId" = ${batchId} AND classification = 'VALID' AND "duplicateInFile"`),
    prisma.$queryRaw<{ n: bigint; lo: Date | null; hi: Date | null }[]>(Prisma.sql`
      SELECT count(*) AS n, min(w."lastObservedOn") AS lo, max(w."lastObservedOn") AS hi FROM "WorkItem" w
      WHERE w.product = ${product} AND w."scopeKey" = ${h.scopeKey ?? ""}
        AND NOT EXISTS (SELECT 1 FROM "UploadStagedRow" r WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' AND r.typed->>'id' = w."workItemId")`),
    prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT count(*) AS n FROM (${it}) x JOIN "WorkItem" w ON w.product = ${product} AND w."scopeKey" = ${h.scopeKey ?? ""} AND w."workItemId" = x.wid
      WHERE EXISTS (SELECT 1 FROM "WorkItemObservation" o WHERE o."workItemId" = w.id AND o."batchId" <> ${batchId} AND (o."observedOn", o."receivedAt") > (${observedOn}::date, ${h.createdAt}))`),
  ]);
  const meta = (h.metadata ?? {}) as { vista?: string };
  return {
    product,
    scopeKey: h.scopeKey,
    view: meta.vista ?? null,
    declared: { extraction: iso(h.declaredExtractionDate), from: iso(h.declaredFrom), to: iso(h.declaredTo), coverage: h.coverageNote },
    observedOn,
    freshnessKnown: h.declaredExtractionDate !== null,
    rowsReceived: h.rowsReceived,
    rowsWithError: h.rowsError,
    duplicatesInFile: n(dup[0]?.n),
    distinctItems: n(c[0]?.distinct_items),
    newItems: n(c[0]?.new_items),
    revisedItems: n(c[0]?.revised),
    unchangedItems: n(c[0]?.unchanged),
    byType: types.map((t) => ({ type: t.item_type, items: n(t.items) })),
    bugs: n(c[0]?.bugs),
    bugsByState: states.map((s) => ({ state: s.state, category: s.category, known: s.known, bugs: n(s.bugs) })),
    unknownStates: n(c[0]?.unknown_states),
    linkPairs: lk.reduce((a, r) => a + n(r.pairs), 0),
    linksByState: lk.map((r) => ({ state: r.state, pairs: n(r.pairs) })),
    bugsWithoutLinks: n(nolinks[0]?.n),
    notObservedInThisView: { items: n(notObs[0]?.n), lastObservedFrom: iso(notObs[0]?.lo ?? null), lastObservedTo: iso(notObs[0]?.hi ?? null) },
    olderThanCurrent: n(older[0]?.n),
    preview: await previewState(prisma, batchId, "bugs"),
  };
}

export const BUG_FILTERS = ["bugs", "no-links", "pending-ticket", "central", "unknown-state", "not-bug", "revision"] as const;

export type BugRowView = {
  position: number;
  sheet: string | null;
  sourceRow: number;
  wid: string;
  item_type: string;
  title: string;
  state: string;
  category: string;
  state_known: boolean;
  is_bug: boolean;
  created: string | null;
  disposition: string | null;
  link_states: string[] | null;
};

export async function listBatchBugs(actorId: string, batchId: string, query: { page?: number; pageSize?: number; filter?: string } = {}) {
  await authorize(prisma, actorId, "ADMIN");
  const { page, pageSize, skip, take } = paging({ pageSize: 20, ...query });
  const h = await head(batchId);
  if (!h || !PROFILE_IDS.includes(h.profileId)) return pageResult([] as BugRowView[], 0, 1, pageSize);
  const f = (BUG_FILTERS as readonly string[]).includes(query.filter ?? "") ? query.filter : null;
  const base = Prisma.sql`
    SELECT x.*, (SELECT array_agg(DISTINCT r.state ORDER BY r.state) FROM (${resolveLinksSql(Prisma.sql`
        SELECT (x.wid || '|' || (l->>'ticketId')) AS key, l->>'ticketId' AS ticket_id FROM jsonb_array_elements(x.links) l`)}) r) AS link_states
    FROM (${items(batchId)}) x`;
  const cond = (() => {
    switch (f) {
      case "bugs": return Prisma.sql`y.is_bug`;
      case "not-bug": return Prisma.sql`NOT y.is_bug`;
      case "no-links": return Prisma.sql`y.is_bug AND y.link_states IS NULL`;
      case "pending-ticket": return Prisma.sql`'PENDING_TICKET' = ANY(y.link_states)`;
      case "central": return Prisma.sql`'CENTRAL_INTERNAL' = ANY(y.link_states)`;
      case "unknown-state": return Prisma.sql`NOT y.state_known`;
      case "revision": return Prisma.sql`y.disposition = 'REVISION'`;
      default: return Prisma.sql`true`;
    }
  })();
  const [data, total] = await Promise.all([
    prisma.$queryRaw<BugRowView[]>(Prisma.sql`
      SELECT y.position, y.sheet, y."sourceRow", y.wid, y.item_type, y.title, y.state, y.category, y.state_known, y.is_bug, y.created, y.disposition, y.link_states
      FROM (${base}) y WHERE ${cond} ORDER BY y.position LIMIT ${take} OFFSET ${skip}`),
    prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM (${base}) y WHERE ${cond}`),
  ]);
  return pageResult(data, n(total[0]?.n), page, pageSize);
}

// ---------------------------------------------------------------- Work Item activo y revisión explícita de vínculos

export async function getWorkItemDetail(actorId: string, id: string) {
  await authorize(prisma, actorId, "ADMIN");
  const w = await prisma.workItem.findUnique({ where: { id } });
  if (!w) return null;
  const [revisions, observations, links] = await Promise.all([
    prisma.workItemRevision.findMany({ where: { workItemId: id }, orderBy: { revisionNo: "desc" } }),
    prisma.workItemObservation.findMany({ where: { workItemId: id }, orderBy: [{ observedOn: "desc" }, { id: "desc" }] }),
    prisma.$queryRaw<
      { id: bigint; ticketId: string; manualState: string | null; manualAt: Date | null; manualNote: string | null; version: number; drvState: string; drvTicketType: string | null;
        clientName: string | null; groupName: string | null; evidence: { batchId: string; source: string; rawRef: string; observedOn: string }[] | null; observedInCurrent: boolean }[]
    >(Prisma.sql`
      SELECT l.id, l."ticketId", l."manualState", l."manualAt", l."manualNote", l.version, l."drvState", l."drvTicketType", c.name AS "clientName", g.name AS "groupName",
        (SELECT jsonb_agg(jsonb_build_object('batchId', e."batchId", 'source', e.source, 'rawRef', e."rawRef", 'observedOn', to_char(e."observedOn", 'YYYY-MM-DD')) ORDER BY e."observedOn" DESC, e.id DESC)
         FROM "WorkItemLinkEvidence" e WHERE e."linkId" = l.id) AS evidence,
        EXISTS (SELECT 1 FROM "WorkItemLinkEvidence" e JOIN "WorkItemObservation" o ON o."batchId" = e."batchId" AND o."workItemId" = l."workItemId"
          WHERE e."linkId" = l.id AND o.id = ${w.currentObservationId}) AS "observedInCurrent"
      FROM "WorkItemLink" l LEFT JOIN "Client" c ON c.id = l."drvClientId" LEFT JOIN "ClientGroup" g ON g.id = l."drvGroupId"
      WHERE l."workItemId" = ${id} ORDER BY l."ticketId"`),
  ]);
  return { workItem: w, revisions, observations, links: links.map((l) => ({ ...l, id: String(l.id) })) };
}

const reviewSchema = z.object({
  linkId: z.string().regex(/^\d+$/),
  decision: z.enum(["CONFIRMED", "REJECTED", "CLEAR"]),
  expectedVersion: z.coerce.number().int().min(1),
  note: z.string().trim().max(500).optional(),
});

/**
 * Revisión explícita de un vínculo Work Item–ticket (solo Administrador, con control de versión y auditoría). La decisión manual es
 * independiente de la evidencia que aporte cada CSV: cargar otro archivo no la borra y la decisión no cambia la causa raíz del ticket.
 */
export async function reviewWorkItemLink(actorId: string, raw: unknown) {
  const parsed = reviewSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError(parsed.error.issues.map((i) => i.message).join(" "));
  const input = parsed.data;
  return adminTransaction(actorId, async (tx, actor) => {
    const rows = await tx.$queryRaw<{ id: bigint; workItemId: string; ticketId: string; manualState: string | null; version: number }[]>(Prisma.sql`
      SELECT id, "workItemId", "ticketId", "manualState", version FROM "WorkItemLink" WHERE id = ${BigInt(input.linkId)} FOR UPDATE`);
    const l = rows[0];
    if (!l) throw new DomainError("Vínculo no encontrado.");
    if (l.version !== input.expectedVersion) throw new StaleVersionError("El vínculo");
    const state = input.decision === "CLEAR" ? null : input.decision;
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WorkItemLink" SET "manualState" = ${state}, "manualById" = ${state ? actor.id : null}, "manualAt" = ${state ? new Date() : null},
        "manualNote" = ${state ? (input.note ?? null) : null}, version = version + 1 WHERE id = ${l.id}`);
    await recordAudit(tx, actor, {
      action: "UPDATE",
      entityType: "WorkItemLink",
      entityId: input.linkId,
      summary: `Vínculo del Work Item ${l.workItemId} con el ticket ${l.ticketId}: ${state === "CONFIRMED" ? "confirmado" : state === "REJECTED" ? "rechazado" : "decisión retirada"}`,
      before: { manualState: l.manualState },
      after: { manualState: state, nota: input.note ?? null },
    });
    return { id: input.linkId, manualState: state };
  });
}
