import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { cleanText } from "@/domain/normalize";
import {
  TIME_HEADERS,
  TIME_RULES,
  ZENDESK_TIME_PROFILE,
  mapHeaders,
  parseDateCell,
  parseExactId,
  parseHourCell,
  parseLooseId,
  parseNonNegativeDecimal,
} from "@/domain/zendesk";
import type { ActivationContext, HeaderMatch, ImportProfile, Issue, ParsedRow } from "../uploads/profile";
import type { Cell } from "../uploads/readers/types";
import { ZENDESK_TIME_SOURCE, activateCorrections, applyDecisionRules, revertTimeBatch } from "../time-correction";
import { derivationSql, lockDerivation, rederiveEntries, stagedSource } from "./derive";
import { refreshTimePreview } from "./preview";

type Tx = Prisma.TransactionClient;
type Header = (typeof TIME_HEADERS)[number];
type Ctx = { index: Record<Header, number> };

const err = (code: string, message: string, column: string): Issue => ({ severity: "error", code, message, column });
const warn = (code: string, message: string, column: string): Issue => ({ severity: "warning", code, message, column });

function matchHeaders(row: string[]): HeaderMatch {
  const m = mapHeaders(row, TIME_HEADERS);
  if (!m.ok) {
    const looksLikeTickets = row.some((h) => h.trim().toLowerCase() === "tags");
    return {
      ok: false,
      message:
        `El archivo no corresponde al perfil de Tiempos Zendesk (once campos, columnas A–K): ${m.message}.` +
        (looksLikeTickets ? " Parece un export de tickets: use la fuente «Zendesk · tickets»." : ""),
    };
  }
  const notes = m.extras.length > 0 ? [`Columnas adicionales informadas (no se usan; las calculadas del libro no son entrada): ${m.extras.join(", ")}.`] : [];
  return { ok: true, schemaVersion: "v1-once-campos", context: { index: m.index } satisfies Ctx, notes };
}

function parseRow(cells: Cell[], context?: unknown): ParsedRow {
  const { index } = context as Ctx;
  const cell = (h: Header) => cells[index[h]];
  const text = (h: Header) => cleanText(cell(h)?.v ?? "") || null;
  const issues: Issue[] = [];

  let ticketId: string | null = null;
  const tid = parseExactId(cell("ticket_id"));
  if (!tid.ok) issues.push(err("TICKET_ID_ILEGIBLE", `ticket_id: ${tid.reason}.`, "ticket_id"));
  else if (tid.value === null) issues.push(err("TICKET_ID_VACIO", "ticket_id es obligatorio.", "ticket_id"));
  else ticketId = tid.value;

  let userId: string | null = null;
  const uid = parseExactId(cell("user_id"));
  if (uid.ok) userId = uid.value;
  else {
    userId = cleanText(cell("user_id")?.v ?? "") || null;
    issues.push(warn("USER_ID_NO_NUMERICO", `user_id: ${uid.reason}; se conserva el texto y no se resolverá la persona por ID.`, "user_id"));
  }
  const userName = text("user_name");
  if (userId === null && userName === null) {
    issues.push(warn("SIN_PERSONA", "No hay user_id ni user_name: no se puede atribuir a una persona.", "user_id"));
  }

  let date: string | null = null;
  const d = parseDateCell(cell("date"));
  if (d.ok) date = d.value.date;
  else issues.push(err("FECHA_INVALIDA", `date: ${d.reason}.`, "date"));

  const hour = parseHourCell(cell("hour"));
  if (!hour.readable) issues.push(warn("HORA_ILEGIBLE", "hour no es una hora del día legible; se conserva el texto y no se usa como duración.", "hour"));

  let hours: string | null = null;
  const lh = parseNonNegativeDecimal(cell("logged_hours"));
  if (lh.ok) hours = lh.value;
  else issues.push(err("DURACION_ILEGIBLE", `logged_hours ${lh.reason}.`, "logged_hours"));
  let minutes: string | null = null;
  const lm = parseNonNegativeDecimal(cell("logged_minutes"));
  if (lm.ok) minutes = lm.value;
  else issues.push(err("DURACION_ILEGIBLE", `logged_minutes ${lm.reason}.`, "logged_minutes"));

  return {
    typed: {
      ticket_id: ticketId,
      user_id: userId,
      user_name: userName,
      date,
      hour: hour.value,
      logged_hours: hours,
      logged_minutes: minutes,
      dia_semana: text("Día de la semana"),
      segmentador_app_time: text("Segmentador app time"),
      id: parseLooseId(cell("id")),
      type: text("type"),
    },
    issues,
  };
}

// ---------------------------------------------------------------- Correcciones explícitas (ZTM 05)

/**
 * Decisiones aplicadas y candidatos. Una corrección posible = mismo id y mismo contexto de trabajo (ticket,
 * persona y día) que un registro activo, con contenido distinto: se advierte y NO se sustituye ni se suma por
 * defecto; hasta que el Administrador decida, la fila conserva su bruto y no añade actividad.
 * Es idempotente: se ejecuta tras preparar y otra vez justo antes de activar.
 */
export async function applyCorrectionRules(tx: Tx, batchId: string) {
  // Decisiones explícitas (con o sin ID externo): válidas solo con el objetivo activo en la revisión que se vio.
  await applyDecisionRules(tx, ZENDESK_TIME_SOURCE, batchId);
  await tx.$executeRaw(Prisma.sql`
    UPDATE "UploadStagedRow" r SET disposition = 'PENDING_DECISION'
    WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' AND r."duplicateInFile" = false AND r.disposition = 'NEW'
      AND r.typed->>'id' IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "ZdTimeDecision" d WHERE d."batchId" = r."batchId" AND d.fingerprint = r.fingerprint)
      AND EXISTS (SELECT 1 FROM "ZdTimeEntry" e
        WHERE e."sourceId" = r.typed->>'id' AND e."ticketId" = r.typed->>'ticket_id' AND e."workDate" = (r.typed->>'date')::date
          AND e."userId" IS NOT DISTINCT FROM r.typed->>'user_id'
          AND (e."userId" IS NOT NULL OR e."userName" IS NOT DISTINCT FROM r.typed->>'user_name')
          AND e.fingerprint <> r.fingerprint)`);
}

async function activate(tx: Tx, ctx: ActivationContext) {
  await lockDerivation(tx);
  await applyCorrectionRules(tx, ctx.batchId);

  // Una sola pasada: la derivación arrastra los campos tipados como carga útil, sin volver a unirse con el staging.
  const inserted = await tx.$executeRaw(Prisma.sql`
    INSERT INTO "ZdTimeEntry" ("originFingerprint", "firstBatchId", "ticketId", "userId", "userName", "workDate", "hourText",
      "loggedHours", "loggedMinutes", minutes, "dayLabel", segmenter, "sourceId", channel, fingerprint,
      "drvTicketKnown", "drvOrganizationId", "drvClientId", "drvGroupId", "drvInternal", "drvPersonId", "drvPersonVia", "drvPmo",
      "drvTeamId", "drvLevelId", "drvEligibility", "drvBucket", "drvFlags", "drvBatchId", "updatedAt")
    SELECT d.payload->>'fp', ${ctx.batchId}, d.payload->'t'->>'ticket_id', d.payload->'t'->>'user_id', d.payload->'t'->>'user_name',
      (d.payload->'t'->>'date')::date, d.payload->'t'->>'hour',
      (d.payload->'t'->>'logged_hours')::numeric, (d.payload->'t'->>'logged_minutes')::numeric,
      (d.payload->'t'->>'logged_hours')::numeric * 60 + (d.payload->'t'->>'logged_minutes')::numeric,
      d.payload->'t'->>'dia_semana', d.payload->'t'->>'segmentador_app_time', d.payload->'t'->>'id', d.payload->'t'->>'type', d.payload->>'fp',
      d.ticket_known, d.org_id, d.client_id, d.group_id, d.internal, d.person_id, d.via, d.pmo, d.team_id, d.level_id,
      d.eligibility, d.bucket, d.flags, ${ctx.batchId}, now()
    FROM (${derivationSql(
      stagedSource(ctx.batchId, { extra: Prisma.sql`AND r.disposition = 'NEW'`, payload: Prisma.sql`jsonb_build_object('fp', r.fingerprint, 't', r.typed)` }),
    )}) d
    ON CONFLICT ("originFingerprint") DO NOTHING`);

  // Correcciones explícitas: conservan el contenido anterior y no suman duración antigua y nueva.
  const revised = await activateCorrections(tx, ZENDESK_TIME_SOURCE, ctx.batchId, (ids) => rederiveEntries(tx, ids, ctx.batchId));
  return { inserted, revised };
}

/** Reversión del lote (ya marcado REVERTED): ver revertTimeBatch (respeta correcciones posteriores y lotes compartidos). */
async function revert(tx: Tx, ctx: ActivationContext) {
  await lockDerivation(tx);
  await revertTimeBatch(tx, ZENDESK_TIME_SOURCE, ctx.batchId, (ids) => rederiveEntries(tx, ids, null));
}

const batchEntries = (batchId: string) => Prisma.sql`
  e."originFingerprint" IN (SELECT s.fingerprint FROM "UploadRecordSource" s WHERE s."batchId" = ${batchId})`;

export const zendeskTiempo: ImportProfile = {
  id: ZENDESK_TIME_PROFILE,
  label: "Zendesk · tiempos",
  description:
    "Export de tiempos con once campos (columnas A–K). Dedicación = logged_hours + logged_minutes / 60; la hora es la hora del registro, no una duración. " +
    "Las filas idénticas se materializan una vez y las correcciones sin ID estable se deciden de forma explícita.",
  version: 1,
  formats: ["xlsx"],
  policy: "INCORPORATE",
  metadataFields: [{ name: "hoja", label: "Hoja del libro (solo si hay varias hojas compatibles)", type: "text", required: false }],
  metadataSchema: z.object({ hoja: z.string().trim().max(120).optional() }).strict(),
  selectsSheet: true,
  blocksConfirmOnErrors: true,
  matchHeaders,
  parseRow,
  async rulesFingerprint() {
    return TIME_RULES;
  },
  async postPrepare(tx, batchId) {
    await applyCorrectionRules(tx, batchId);
    await refreshTimePreview(tx, batchId);
  },
  activate,
  revert,
  async rederive(tx, ctx) {
    await lockDerivation(tx);
    return { updated: await rederiveEntries(tx, batchEntries(ctx.batchId), ctx.batchId) };
  },
};
