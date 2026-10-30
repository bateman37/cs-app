import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { cleanText } from "@/domain/normalize";
import { todayMadrid } from "@/domain/vigencia";
import {
  BUG_PROFILES,
  BUG_RULES,
  VFS_HEADERS,
  VIEW_KINDS,
  VSW_HEADERS,
  classifyState,
  isBugType,
  parseLocalDateTime,
  parseTags,
  type BugProduct,
} from "@/domain/bugs";
import { extractZendeskUrlIds, parseTicketRefList } from "@/domain/refs";
import { zendeskHosts } from "@/domain/wrike";
import { mapHeaders } from "@/domain/zendesk";
import type { ActivationContext, HeaderMatch, ImportProfile, Issue, Json, ParsedRow } from "../uploads/profile";
import type { Cell } from "../uploads/readers/types";
import { lockDerivation } from "../zendesk/derive";
import { refreshBugsPreview } from "./preview";
import { rederiveWorkItemLinks } from "./links";

type Tx = Prisma.TransactionClient;

const err = (code: string, message: string, column: string): Issue => ({ severity: "error", code, message, column });
const warn = (code: string, message: string, column: string): Issue => ({ severity: "warning", code, message, column });

const HEADERS: Record<BugProduct, readonly string[]> = { VFS: VFS_HEADERS, VSW: VSW_HEADERS };
const LABEL: Record<BugProduct, string> = { VFS: "Bugs VFS", VSW: "Bugs VSW" };

export const bugScopeKey = (product: BugProduct, ambito: string | undefined) => `${product}|${(ambito ?? "").trim() || "principal"}`;

function makeProfile(product: BugProduct): ImportProfile {
  const headers = HEADERS[product];
  const other: BugProduct = product === "VFS" ? "VSW" : "VFS";

  function matchHeaders(row: string[]): HeaderMatch {
    const m = mapHeaders(row, headers);
    if (!m.ok) {
      const otherMatch = mapHeaders(row, HEADERS[other]);
      return {
        ok: false,
        message:
          `El archivo no corresponde al perfil ${LABEL[product]} (${headers.join(", ")}): ${m.message}.` +
          (otherMatch.ok ? ` Parece un export de ${LABEL[other]}: el producto no se deduce, elija la fuente «${LABEL[other]}».` : ""),
      };
    }
    const notes = m.extras.length > 0 ? [`Columnas adicionales informadas (se conservan en el bruto; no se usan): ${m.extras.join(", ")}.`] : [];
    return { ok: true, schemaVersion: product === "VFS" ? "v1-vfs-trece-campos" : "v1-vsw-diez-campos", context: { index: m.index }, notes };
  }

  function parseRow(cells: Cell[], context?: unknown): ParsedRow {
    const { index } = context as { index: Record<string, number> };
    const has = (h: string) => h in index;
    const val = (h: string) => (has(h) ? (cells[index[h]]?.v ?? "") : "");
    const text = (h: string) => cleanText(val(h)) || null;
    const issues: Issue[] = [];

    const idRaw = cleanText(val("ID"));
    let id: string | null = null;
    if (/^\d{1,15}$/.test(idRaw)) id = idRaw.replace(/^0+(?=\d)/, "") || "0";
    else issues.push(err("ID_INVALIDO", idRaw === "" ? "ID es obligatorio." : "ID no es un identificador numérico de Work Item.", "ID"));

    const type = text("Work Item Type");
    if (type === null) issues.push(err("TIPO_VACIO", "Work Item Type es obligatorio.", "Work Item Type"));
    const title = text("Title");
    if (title === null) issues.push(err("TITULO_VACIO", "Title es obligatorio.", "Title"));
    const state = text("State");
    if (state === null) issues.push(err("ESTADO_VACIO", "State es obligatorio.", "State"));

    let created: string | null = null;
    let createdDate: string | null = null;
    const c = parseLocalDateTime(val("Created Date"));
    if (c.ok) {
      created = c.value.local;
      createdDate = c.value.date;
    } else issues.push(err("CREATED_INVALIDA", `Created Date: ${c.reason}.`, "Created Date"));

    let changed: string | null = null;
    if (has("Changed Date") && cleanText(val("Changed Date")) !== "") {
      const ch = parseLocalDateTime(val("Changed Date"));
      if (ch.ok) changed = ch.value.local;
      else issues.push(err("CHANGED_INVALIDA", `Changed Date: ${ch.reason}.`, "Changed Date"));
    }

    let comments: number | null = null;
    if (has("Comment Count") && cleanText(val("Comment Count")) !== "") {
      if (/^\d{1,9}$/.test(cleanText(val("Comment Count")))) comments = Number(cleanText(val("Comment Count")));
      else issues.push(warn("COMENTARIOS_ILEGIBLES", "Comment Count no es un entero: se ignora.", "Comment Count"));
    }

    const hosts = zendeskHosts();
    const links: { ticketId: string; source: string; raw: string }[] = [];
    const ticketText = text("Zendesk Ticket ID");
    if (ticketText !== null && !/^0+$/.test(ticketText)) {
      if (/^\d{1,15}$/.test(ticketText)) links.push({ ticketId: ticketText.replace(/^0+(?=\d)/, ""), source: "ZENDESK_TICKET_ID", raw: ticketText });
      else {
        const r = parseTicketRefList(ticketText, hosts);
        for (const x of r.refs) links.push({ ticketId: x.id, source: "ZENDESK_TICKET_ID", raw: x.raw });
        if (r.unparsed.length > 0) issues.push(warn("TICKET_ID_ILEGIBLE", `Zendesk Ticket ID contiene texto no interpretable como ticket: se conserva y no genera vínculo (${r.unparsed.map((u) => u.text).join("; ").slice(0, 120)}).`, "Zendesk Ticket ID"));
      }
    }
    const clients = text("Clients");
    if (clients !== null) {
      for (const x of extractZendeskUrlIds(clients, hosts)) links.push({ ticketId: x.id, source: "CLIENTS_URL", raw: x.raw });
    }
    const dedup = new Map<string, { ticketId: string; source: string; raw: string }>();
    for (const l of links) dedup.set(`${l.ticketId}|${l.source}`, l);

    const st = state !== null ? classifyState(state) : { category: "PENDING_REVIEW", known: false };
    if (state !== null && !st.known) issues.push(warn("ESTADO_NO_CLASIFICADO", `State «${state}» no está en el catálogo de etapas: se conserva y requiere revisión; no se interpreta como abierto ni cerrado.`, "State"));
    const isBug = type !== null && isBugType(type);

    return {
      typed: {
        tipo: type,
        id,
        titulo: title,
        creado_por: text("Created By"),
        creado: created,
        asignado_a: text("Assigned To"),
        estado: state,
        area_path: text("Area Path"),
        tags: parseTags(val("Tags")),
        comentarios: comments,
        cambiado: changed,
        reportado_por: text("Reported by"),
        ticket_zendesk: ticketText,
        clients,
      },
      derived: {
        isBug,
        stateCategory: st.category,
        stateKnown: st.known,
        createdDate,
        links: [...dedup.values()] as unknown as Json,
      },
      issues,
      entityKey: id ?? undefined,
    };
  }

  const staged = (batchId: string) => Prisma.sql`
    SELECT r.fingerprint, r.typed, r.derived, r.position FROM "UploadStagedRow" r
    WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' AND r."duplicateInFile" = false`;

  async function activate(tx: Tx, ctx: ActivationContext) {
    await lockDerivation(tx);
    const observedOn = ctx.batch.declaredExtractionDate ?? todayMadrid(ctx.batch.createdAt);
    const kind = ctx.batch.declaredExtractionDate ? "DECLARED" : "RECEIVED";
    const scopeKey = ctx.scopeKey ?? bugScopeKey(product, undefined);

    const newItems = await tx.$executeRaw(Prisma.sql`
      INSERT INTO "WorkItem" (product, "scopeKey", "workItemId", "firstBatchId", "updatedAt")
      SELECT DISTINCT ${product}, ${scopeKey}, s.typed->>'id', ${ctx.batchId}, now() FROM (${staged(ctx.batchId)}) s
      ON CONFLICT (product, "scopeKey", "workItemId") DO NOTHING`);

    await tx.$executeRaw(Prisma.sql`DROP TABLE IF EXISTS "_wi_rev"`);
    await tx.$executeRaw(Prisma.sql`
      CREATE TEMP TABLE "_wi_rev" ON COMMIT DROP AS
      SELECT w.id AS wid, s.fingerprint, s.typed AS t, s.derived AS d, COALESCE(p."revisionNo", 0) + 1 AS rev_no, p.id AS prev_id,
        array_remove(ARRAY[
          CASE WHEN p.id IS NOT NULL AND p."itemType" IS DISTINCT FROM s.typed->>'tipo' THEN 'Work Item Type' END,
          CASE WHEN p.id IS NOT NULL AND p.title IS DISTINCT FROM s.typed->>'titulo' THEN 'Title' END,
          CASE WHEN p.id IS NOT NULL AND p.state IS DISTINCT FROM s.typed->>'estado' THEN 'State' END,
          CASE WHEN p.id IS NOT NULL AND p."assignedTo" IS DISTINCT FROM s.typed->>'asignado_a' THEN 'Assigned To' END,
          CASE WHEN p.id IS NOT NULL AND p."createdBy" IS DISTINCT FROM s.typed->>'creado_por' THEN 'Created By' END,
          CASE WHEN p.id IS NOT NULL AND p."createdLocal" IS DISTINCT FROM s.typed->>'creado' THEN 'Created Date' END,
          CASE WHEN p.id IS NOT NULL AND p."changedLocal" IS DISTINCT FROM s.typed->>'cambiado' THEN 'Changed Date' END,
          CASE WHEN p.id IS NOT NULL AND p."areaPath" IS DISTINCT FROM s.typed->>'area_path' THEN 'Area Path' END,
          CASE WHEN p.id IS NOT NULL AND p.tags IS DISTINCT FROM ARRAY(SELECT jsonb_array_elements_text(s.typed->'tags')) THEN 'Tags' END,
          CASE WHEN p.id IS NOT NULL AND p."commentCount" IS DISTINCT FROM (s.typed->>'comentarios')::int THEN 'Comment Count' END,
          CASE WHEN p.id IS NOT NULL AND p."reportedBy" IS DISTINCT FROM s.typed->>'reportado_por' THEN 'Reported by' END,
          CASE WHEN p.id IS NOT NULL AND p."clientsRaw" IS DISTINCT FROM s.typed->>'clients' THEN 'Clients' END,
          CASE WHEN p.id IS NOT NULL AND p."zendeskTicketRaw" IS DISTINCT FROM s.typed->>'ticket_zendesk' THEN 'Zendesk Ticket ID' END
        ], NULL) AS changed
      FROM (${staged(ctx.batchId)}) s
      JOIN "WorkItem" w ON w.product = ${product} AND w."scopeKey" = ${scopeKey} AND w."workItemId" = s.typed->>'id'
      LEFT JOIN LATERAL (
        SELECT x.id, x."revisionNo", x."itemType", x.title, x.state, x."assignedTo", x."createdBy", x."createdLocal", x."changedLocal", x."areaPath",
          x.tags, x."commentCount", x."reportedBy", x."clientsRaw", x."zendeskTicketRaw"
        FROM "WorkItemRevision" x WHERE x."workItemId" = w.id ORDER BY x."revisionNo" DESC LIMIT 1) p ON true`);
    const revisions = await tx.$executeRaw(Prisma.sql`
      INSERT INTO "WorkItemRevision" ("workItemId", fingerprint, "revisionNo", "itemType", "isBug", title, state, "stateCategory", "stateKnown", "assignedTo",
        "createdBy", "createdLocal", "createdDate", "changedLocal", "areaPath", tags, "commentCount", "reportedBy", "clientsRaw", "zendeskTicketRaw",
        "previousRevisionId", "changedFields", "batchId")
      SELECT wid, fingerprint, rev_no, t->>'tipo', (d->>'isBug')::boolean, t->>'titulo', t->>'estado', d->>'stateCategory', (d->>'stateKnown')::boolean,
        t->>'asignado_a', t->>'creado_por', t->>'creado', (d->>'createdDate')::date, t->>'cambiado', t->>'area_path',
        ARRAY(SELECT jsonb_array_elements_text(t->'tags')), (t->>'comentarios')::int, t->>'reportado_por', t->>'clients', t->>'ticket_zendesk',
        prev_id, changed, ${ctx.batchId}
      FROM "_wi_rev"
      ON CONFLICT ("workItemId", fingerprint) DO NOTHING`);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "WorkItemObservation" ("workItemId", "batchId", "revisionId", "observedOn", "observedKind", "receivedAt")
      SELECT r.wid, ${ctx.batchId}, rv.id, ${observedOn}::date, ${kind}, ${ctx.batch.createdAt}
      FROM "_wi_rev" r JOIN "WorkItemRevision" rv ON rv."workItemId" = r.wid AND rv.fingerprint = r.fingerprint
      ON CONFLICT ("batchId", "workItemId") DO NOTHING`);
    await recomputeCurrent(tx, Prisma.sql`SELECT wid FROM "_wi_rev"`);

    // Vínculos: el par Work Item–ticket es único; la evidencia (qué carga lo vio, y cómo) se añade sin tocar la decisión manual.
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "WorkItemLink" ("workItemId", "ticketId")
      SELECT DISTINCT r.wid, l->>'ticketId' FROM "_wi_rev" r, jsonb_array_elements(r.d->'links') l
      ON CONFLICT ("workItemId", "ticketId") DO NOTHING`);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "WorkItemLinkEvidence" ("linkId", "batchId", source, "rawRef", "observedOn")
      SELECT DISTINCT ON (k.id, l->>'source') k.id, ${ctx.batchId}, l->>'source', l->>'raw', ${observedOn}::date
      FROM "_wi_rev" r CROSS JOIN LATERAL jsonb_array_elements(r.d->'links') l
      JOIN "WorkItemLink" k ON k."workItemId" = r.wid AND k."ticketId" = l->>'ticketId'
      ORDER BY k.id, l->>'source'
      ON CONFLICT ("linkId", "batchId", source) DO NOTHING`);
    await rederiveWorkItemLinks(tx, Prisma.sql`l."workItemId" IN (SELECT wid FROM "_wi_rev")`);
    await refreshBugsPreview(tx, ctx.batchId);
    return { inserted: newItems, revised: revisions - newItems };
  }

  const batchItems = (batchId: string) => Prisma.sql`
    SELECT DISTINCT w.id FROM "UploadStagedRow" r
    JOIN "WorkItem" w ON w.product = ${product} AND w."workItemId" = r.typed->>'id'
    WHERE r."batchId" = ${batchId} AND r.classification = 'VALID'`;

  /** Reversión (el lote ya está REVERTED): retira sus observaciones y evidencias; lo sustentado por otros lotes se conserva. */
  async function revert(tx: Tx, ctx: ActivationContext) {
    await lockDerivation(tx);
    await tx.$executeRaw(Prisma.sql`DROP TABLE IF EXISTS "_wi_ids"`);
    await tx.$executeRaw(Prisma.sql`CREATE TEMP TABLE "_wi_ids" ON COMMIT DROP AS SELECT DISTINCT "workItemId" AS wid FROM "WorkItemObservation" WHERE "batchId" = ${ctx.batchId}`);
    await tx.$executeRaw(Prisma.sql`DELETE FROM "WorkItemLinkEvidence" WHERE "batchId" = ${ctx.batchId}`);
    await tx.$executeRaw(Prisma.sql`DELETE FROM "WorkItemObservation" WHERE "batchId" = ${ctx.batchId}`);
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM "WorkItemRevision" r WHERE r."workItemId" IN (SELECT wid FROM "_wi_ids")
        AND NOT EXISTS (SELECT 1 FROM "WorkItemObservation" o WHERE o."revisionId" = r.id)`);
    await tx.$executeRaw(Prisma.sql`UPDATE "WorkItem" w SET "currentObservationId" = NULL, "currentRevisionId" = NULL, "lastObservedOn" = NULL WHERE w.id IN (SELECT wid FROM "_wi_ids")`);
    await recomputeCurrent(tx, Prisma.sql`SELECT wid FROM "_wi_ids"`);
    // Un vínculo sin evidencia de ningún lote vigente y sin decisión manual desaparece; con decisión manual se conserva.
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM "WorkItemLink" l WHERE l."workItemId" IN (SELECT wid FROM "_wi_ids") AND l."manualState" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "WorkItemLinkEvidence" e WHERE e."linkId" = l.id)`);
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM "WorkItem" w WHERE w.id IN (SELECT wid FROM "_wi_ids")
        AND NOT EXISTS (SELECT 1 FROM "WorkItemRevision" r WHERE r."workItemId" = w.id)
        AND NOT EXISTS (SELECT 1 FROM "WorkItemLink" l WHERE l."workItemId" = w.id)`);
  }

  return {
    id: BUG_PROFILES[product],
    label: LABEL[product],
    description:
      `CSV de bugs de producto ${product} (${headers.length} campos, UTF-8, coma). Se carga por separado del otro producto: el producto no se deduce ni se mezcla por coincidencia de ID. ` +
      "Se guardan todos los Work Item Type, pero solo Bug_ cuenta como defecto. Declare qué vista contiene (abiertos, intervalo o amplia): la ausencia en otra vista no cierra ni borra un elemento.",
    version: 1,
    formats: ["csv"],
    delimiter: ",",
    policy: "INCORPORATE",
    metadataFields: [
      {
        name: "vista",
        label: "Vista del listado",
        type: "select",
        required: true,
        options: VIEW_KINDS.map((v) => ({ value: v.value, label: v.label })),
      },
      { name: "ambito", label: "Ámbito DevOps (proyecto/área); por defecto «principal»", type: "text", required: false },
    ],
    metadataSchema: z
      .object({ vista: z.enum(VIEW_KINDS.map((v) => v.value) as [string, ...string[]]), ambito: z.string().trim().max(80).optional() })
      .strict(),
    scopeKey: (m) => bugScopeKey(product, m.ambito as string | undefined),
    blocksConfirmOnErrors: true,
    entityConflictPolicy: "conflict_all",
    matchHeaders,
    parseRow,
    async rulesFingerprint() {
      return BUG_RULES;
    },
    async postPrepare(tx, batchId) {
      await refreshBugsPreview(tx, batchId);
    },
    activate,
    revert,
    async rederive(tx, ctx) {
      await lockDerivation(tx);
      const updated = await rederiveWorkItemLinks(tx, Prisma.sql`l."workItemId" IN (${batchItems(ctx.batchId)})`);
      await refreshBugsPreview(tx, ctx.batchId);
      return { updated };
    },
  };
}

/** Observación vigente: la más reciente por fecha de observación; empate por recepción del lote y por orden. Nunca por posición. */
async function recomputeCurrent(tx: Tx, ids: Prisma.Sql) {
  await tx.$executeRaw(Prisma.sql`
    UPDATE "WorkItem" w SET "currentObservationId" = c.oid, "currentRevisionId" = c.rid, "lastObservedOn" = c.last_on, "updatedAt" = now()
    FROM (
      SELECT DISTINCT ON (o."workItemId") o."workItemId", o.id AS oid, o."revisionId" AS rid, o."observedOn" AS last_on
      FROM "WorkItemObservation" o WHERE o."workItemId" IN (${ids})
      ORDER BY o."workItemId", o."observedOn" DESC, o."receivedAt" DESC, o.id DESC) c
    WHERE w.id = c."workItemId"
      AND (w."currentObservationId" IS DISTINCT FROM c.oid OR w."currentRevisionId" IS DISTINCT FROM c.rid OR w."lastObservedOn" IS DISTINCT FROM c.last_on)`);
}

export const bugsVfs = makeProfile("VFS");
export const bugsVsw = makeProfile("VSW");
