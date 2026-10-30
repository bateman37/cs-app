import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { cleanText } from "@/domain/normalize";
import { todayMadrid } from "@/domain/vigencia";
import {
  TAG_DESTINATION,
  TICKETS_RULES,
  TICKET_HEADERS,
  TICKET_STATUSES,
  TICKET_TYPES,
  ZENDESK_TICKETS_PROFILE,
  classifyToken,
  mapHeaders,
  parseDateCell,
  parseExactId,
  parseTags,
} from "@/domain/zendesk";
import type { ActivationContext, HeaderMatch, ImportProfile, Issue, ParsedRow } from "../uploads/profile";
import type { Cell } from "../uploads/readers/types";
import { lockDerivation, rederiveEntries } from "./derive";

type Tx = Prisma.TransactionClient;
type Header = (typeof TICKET_HEADERS)[number];
type Ctx = { index: Record<Header, number> };

const err = (code: string, message: string, column: string): Issue => ({ severity: "error", code, message, column });
const warn = (code: string, message: string, column: string): Issue => ({ severity: "warning", code, message, column });

function matchHeaders(row: string[]): HeaderMatch {
  const m = mapHeaders(row, TICKET_HEADERS);
  if (!m.ok) {
    const looksLikeTime = row.some((h) => h.trim().toLowerCase() === "logged_hours");
    return {
      ok: false,
      message:
        `El archivo no corresponde al perfil vigente de Tickets Zendesk (ocho cabeceras con status): ${m.message}. ` +
        `Los exports antiguos de cuatro, cinco o siete campos no se admiten.` +
        (looksLikeTime ? " Parece un export de tiempos: use la fuente «Zendesk · tiempos»." : ""),
    };
  }
  const notes = m.extras.length > 0 ? [`Columnas adicionales informadas (no se usan): ${m.extras.join(", ")}.`] : [];
  return { ok: true, schemaVersion: "v1-ocho-campos", context: { index: m.index } satisfies Ctx, notes };
}

function parseRow(cells: Cell[], context?: unknown): ParsedRow {
  const { index } = context as Ctx;
  const cell = (h: Header) => cells[index[h]];
  const issues: Issue[] = [];

  const tid = parseExactId(cell("ticket_id"));
  let ticketId: string | null = null;
  if (!tid.ok) issues.push(err("TICKET_ID_ILEGIBLE", `ticket_id: ${tid.reason}.`, "ticket_id"));
  else if (tid.value === null) issues.push(err("TICKET_ID_VACIO", "ticket_id es obligatorio.", "ticket_id"));
  else ticketId = tid.value;

  let organizationId: string | null = null;
  const org = parseExactId(cell("organization_id"));
  if (org.ok) organizationId = org.value;
  else {
    organizationId = cleanText(cell("organization_id")?.v ?? "") || null;
    issues.push(warn("ORG_ID_ILEGIBLE", `organization_id: ${org.reason}; se conserva el texto y quedará sin resolver.`, "organization_id"));
  }

  const entorno = cleanText(cell("Entorno y Tipología")?.v ?? "") || null;
  const causa = cleanText(cell("CausaRaiz(Agr)")?.v ?? "") || null;

  let tags: string[] = [];
  const t = parseTags(cell("tags")?.v ?? "");
  if (t.ok) tags = t.value;
  else issues.push(err("TAGS_INVALIDOS", `tags: ${t.reason}.`, "tags"));

  let createdOn: string | null = null;
  let createdTime: string | null = null;
  const d = parseDateCell(cell("fecha_creación"));
  if (d.ok) {
    createdOn = d.value.date;
    createdTime = d.value.time;
  } else issues.push(err("FECHA_INVALIDA", `fecha_creación: ${d.reason}.`, "fecha_creación"));

  const type = cleanText(cell("type")?.v ?? "") || null;
  if (type === null) issues.push(err("TYPE_VACIO", "type es obligatorio.", "type"));
  else if (classifyToken(type, TICKET_TYPES) === null) {
    issues.push(warn("TYPE_NO_CLASIFICADO", `type «${type}» no está en el catálogo (incident, problem, task, question): se conserva como no clasificado.`, "type"));
  }
  const status = cleanText(cell("status")?.v ?? "") || null;
  if (status === null) issues.push(err("STATUS_VACIO", "status es obligatorio.", "status"));
  else if (classifyToken(status, TICKET_STATUSES) === null) {
    issues.push(warn("STATUS_NO_CLASIFICADO", `status «${status}» no está en el catálogo (new, open, pending, hold, solved, closed): se conserva como no clasificado.`, "status"));
  }

  return {
    typed: {
      ticket_id: ticketId,
      organization_id: organizationId,
      entorno,
      causa_raiz: causa,
      tags,
      created_on: createdOn,
      created_time: createdTime,
      type,
      status,
    },
    issues,
    entityKey: ticketId ?? undefined,
  };
}

const destinationValues = Prisma.join(Object.entries(TAG_DESTINATION).map(([tag, dest]) => Prisma.sql`(${tag}, ${dest})`));

/** Filas del lote que se materializan: todas las válidas y no repetidas (nuevas, revisadas y ya conocidas). */
const stagedTickets = (batchId: string) => Prisma.sql`
  SELECT r.fingerprint, r.typed->>'ticket_id' AS ticket_id, r.typed->>'organization_id' AS org, r.typed->>'entorno' AS entorno,
    r.typed->>'causa_raiz' AS causa, ARRAY(SELECT jsonb_array_elements_text(r.typed->'tags')) AS tags,
    ARRAY(SELECT DISTINCT m.dest FROM jsonb_array_elements_text(r.typed->'tags') t(tag) JOIN (VALUES ${destinationValues}) m(tag, dest) ON m.tag = t.tag ORDER BY 1) AS dest,
    (r.typed->>'created_on')::date AS created_on, r.typed->>'created_time' AS created_time, r.typed->>'type' AS type, r.typed->>'status' AS status
  FROM "UploadStagedRow" r
  WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' AND r."duplicateInFile" = false`;

const batchTicketIds = (batchId: string) => Prisma.sql`
  SELECT DISTINCT r.typed->>'ticket_id' FROM "UploadStagedRow" r WHERE r."batchId" = ${batchId} AND r.classification = 'VALID'`;

/**
 * Observación vigente de cada ticket: la más reciente por fecha de observación (extracción declarada o, si no se
 * declaró, recepción); empate por recepción del lote y después por orden de activación. Nunca por posición de fila.
 */
async function recomputeCurrent(tx: Tx, ids: Prisma.Sql) {
  await tx.$executeRaw(Prisma.sql`
    UPDATE "ZdTicket" t SET "currentObservationId" = c.oid, "currentRevisionId" = c.rid, "updatedAt" = now()
    FROM (
      SELECT DISTINCT ON (o."ticketId") o."ticketId", o.id AS oid, o."revisionId" AS rid
      FROM "ZdTicketObservation" o WHERE o."ticketId" IN (${ids})
      ORDER BY o."ticketId", o."observedOn" DESC, o."receivedAt" DESC, o.id DESC) c
    WHERE t."ticketId" = c."ticketId"
      AND (t."currentObservationId" IS DISTINCT FROM c.oid OR t."currentRevisionId" IS DISTINCT FROM c.rid)`);
}

async function activate(tx: Tx, ctx: ActivationContext) {
  await lockDerivation(tx);
  const declared = ctx.batch.declaredExtractionDate;
  const observedOn = declared ?? todayMadrid(ctx.batch.createdAt);
  const kind = declared ? "DECLARED" : "RECEIVED";

  const newTickets = await tx.$executeRaw(Prisma.sql`
    INSERT INTO "ZdTicket" ("ticketId", "firstBatchId", "updatedAt")
    SELECT DISTINCT s.ticket_id, ${ctx.batchId}, now() FROM (${stagedTickets(ctx.batchId)}) s
    ON CONFLICT ("ticketId") DO NOTHING`);

  const revisions = await tx.$executeRaw(Prisma.sql`
    INSERT INTO "ZdTicketRevision" ("ticketId", fingerprint, "revisionNo", "organizationId", entorno, "causaRaiz", tags, destinations,
      "createdOn", "createdTime", "ticketType", status, "typeKnown", "statusKnown", "adminDelegada", "previousRevisionId", "changedFields", "batchId")
    SELECT s.ticket_id, s.fingerprint, COALESCE(p."revisionNo", 0) + 1, s.org, s.entorno, s.causa, s.tags, s.dest,
      s.created_on, s.created_time, s.type, s.status,
      lower(s.type) = ANY(${[...TICKET_TYPES]}::text[]), lower(s.status) = ANY(${[...TICKET_STATUSES]}::text[]),
      CASE WHEN s.entorno IS NULL THEN NULL ELSE position('delegada' in lower(s.entorno)) > 0 END,
      p.id,
      array_remove(ARRAY[
        CASE WHEN p.id IS NOT NULL AND p."organizationId" IS DISTINCT FROM s.org THEN 'organization_id' END,
        CASE WHEN p.id IS NOT NULL AND p.entorno IS DISTINCT FROM s.entorno THEN 'Entorno y Tipología' END,
        CASE WHEN p.id IS NOT NULL AND p."causaRaiz" IS DISTINCT FROM s.causa THEN 'CausaRaiz(Agr)' END,
        CASE WHEN p.id IS NOT NULL AND p.tags IS DISTINCT FROM s.tags THEN 'tags' END,
        CASE WHEN p.id IS NOT NULL AND p."createdOn" IS DISTINCT FROM s.created_on THEN 'fecha_creación' END,
        CASE WHEN p.id IS NOT NULL AND p."ticketType" IS DISTINCT FROM s.type THEN 'type' END,
        CASE WHEN p.id IS NOT NULL AND p.status IS DISTINCT FROM s.status THEN 'status' END
      ], NULL),
      ${ctx.batchId}
    FROM (${stagedTickets(ctx.batchId)}) s
    LEFT JOIN LATERAL (
      SELECT x.id, x."revisionNo", x."organizationId", x.entorno, x."causaRaiz", x.tags, x."createdOn", x."ticketType", x.status
      FROM "ZdTicketRevision" x WHERE x."ticketId" = s.ticket_id ORDER BY x."revisionNo" DESC LIMIT 1) p ON true
    WHERE NOT EXISTS (SELECT 1 FROM "ZdTicketRevision" x WHERE x."ticketId" = s.ticket_id AND x.fingerprint = s.fingerprint)`);

  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "ZdTicketObservation" ("ticketId", "batchId", "revisionId", "observedOn", "observedKind", "receivedAt")
    SELECT s.ticket_id, ${ctx.batchId}, rv.id, ${observedOn}::date, ${kind}, ${ctx.batch.createdAt}
    FROM (${stagedTickets(ctx.batchId)}) s
    JOIN "ZdTicketRevision" rv ON rv."ticketId" = s.ticket_id AND rv.fingerprint = s.fingerprint
    ON CONFLICT ("batchId", "ticketId") DO NOTHING`);

  await recomputeCurrent(tx, batchTicketIds(ctx.batchId));
  // La llegada o el cambio de un ticket enriquece los tiempos ya cargados, sin releerlos.
  await rederiveEntries(tx, Prisma.sql`e."ticketId" IN (${batchTicketIds(ctx.batchId)})`, ctx.batchId);
  return { inserted: newTickets, revised: revisions - newTickets };
}

/**
 * Reversión del lote (ya marcado REVERTED): retira sus observaciones y solo las revisiones que ningún otro lote
 * sustenta; la vigencia se recalcula con las observaciones restantes (nunca restaura una revisión antigua por
 * encima de otra posterior todavía observada) y un ticket sin sustento desaparece. Los tiempos no se borran:
 * su atribución se recalcula.
 */
async function revert(tx: Tx, ctx: ActivationContext) {
  await lockDerivation(tx);
  await tx.$executeRaw(Prisma.sql`DELETE FROM "ZdTicketObservation" WHERE "batchId" = ${ctx.batchId}`);
  await tx.$executeRaw(Prisma.sql`
    DELETE FROM "ZdTicketRevision" r
    WHERE r."ticketId" IN (${batchTicketIds(ctx.batchId)})
      AND NOT EXISTS (SELECT 1 FROM "ZdTicketObservation" o WHERE o."revisionId" = r.id)`);
  await tx.$executeRaw(Prisma.sql`
    UPDATE "ZdTicket" t SET "currentObservationId" = NULL, "currentRevisionId" = NULL
    WHERE t."ticketId" IN (${batchTicketIds(ctx.batchId)})`);
  await recomputeCurrent(tx, batchTicketIds(ctx.batchId));
  await tx.$executeRaw(Prisma.sql`
    DELETE FROM "ZdTicket" t
    WHERE t."ticketId" IN (${batchTicketIds(ctx.batchId)}) AND NOT EXISTS (SELECT 1 FROM "ZdTicketRevision" r WHERE r."ticketId" = t."ticketId")`);
  await rederiveEntries(tx, Prisma.sql`e."ticketId" IN (${batchTicketIds(ctx.batchId)})`, ctx.batchId);
}

export const zendeskTickets: ImportProfile = {
  id: ZENDESK_TICKETS_PROFILE,
  label: "Zendesk · tickets",
  description:
    "Export de tickets con ocho campos (ticket_id, organization_id, Entorno y Tipología, CausaRaiz(Agr), tags, fecha_creación, type, status). " +
    "Un ticket_id es una entidad con revisiones y observaciones; los tickets sin horas se conservan.",
  version: 1,
  formats: ["xlsx"],
  policy: "INCORPORATE",
  metadataFields: [{ name: "hoja", label: "Hoja del libro (solo si hay varias hojas compatibles)", type: "text", required: false }],
  metadataSchema: z.object({ hoja: z.string().trim().max(120).optional() }).strict(),
  selectsSheet: true,
  blocksConfirmOnErrors: true,
  entityConflictPolicy: "conflict_all",
  matchHeaders,
  parseRow,
  async rulesFingerprint() {
    return TICKETS_RULES;
  },
  activate,
  revert,
  async rederive(tx, ctx) {
    await lockDerivation(tx);
    return { updated: await rederiveEntries(tx, Prisma.sql`e."ticketId" IN (${batchTicketIds(ctx.batchId)})`, ctx.batchId) };
  },
};
