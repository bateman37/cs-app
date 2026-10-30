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
import { orphanFingerprintsSql } from "../uploads/provenance";
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
  // La decisión «corrige este registro» solo vale si el registro sigue existiendo.
  await tx.$executeRaw(Prisma.sql`
    UPDATE "UploadStagedRow" r SET disposition = 'CORRECTION'
    FROM "ZdTimeDecision" d
    WHERE d."batchId" = r."batchId" AND d.fingerprint = r.fingerprint AND d.decision = 'CORRECTION'
      AND EXISTS (SELECT 1 FROM "ZdTimeEntry" e WHERE e.id = d."targetEntryId")
      AND r."batchId" = ${batchId} AND r.classification = 'VALID' AND r."duplicateInFile" = false AND r.disposition = 'NEW'`);
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

const stagedBy = (batchId: string, disposition: string) => Prisma.sql`
  SELECT r.position, r.fingerprint, r.typed FROM "UploadStagedRow" r
  WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' AND r."duplicateInFile" = false AND r.disposition = ${disposition}`;

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
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "ZdTimeCorrection" ("entryId", "batchId", fingerprint, "previousFingerprint", previous, "minutesBefore", "minutesAfter", "decidedById")
    SELECT e.id, ${ctx.batchId}, s.fingerprint, e.fingerprint,
      jsonb_build_object('userName', e."userName", 'hourText', e."hourText", 'loggedHours', trim_scale(e."loggedHours")::text,
        'loggedMinutes', trim_scale(e."loggedMinutes")::text, 'minutes', trim_scale(e.minutes)::text, 'dayLabel', e."dayLabel", 'segmenter', e.segmenter, 'channel', e.channel),
      e.minutes, (s.typed->>'logged_hours')::numeric * 60 + (s.typed->>'logged_minutes')::numeric, dc."decidedById"
    FROM (${stagedBy(ctx.batchId, "CORRECTION")}) s
    JOIN "ZdTimeDecision" dc ON dc."batchId" = ${ctx.batchId} AND dc.fingerprint = s.fingerprint
    JOIN "ZdTimeEntry" e ON e.id = dc."targetEntryId"`);
  const revised = await tx.$executeRaw(Prisma.sql`
    UPDATE "ZdTimeEntry" e SET
      "userName" = s.typed->>'user_name', "hourText" = s.typed->>'hour', "loggedHours" = (s.typed->>'logged_hours')::numeric,
      "loggedMinutes" = (s.typed->>'logged_minutes')::numeric,
      minutes = (s.typed->>'logged_hours')::numeric * 60 + (s.typed->>'logged_minutes')::numeric,
      "dayLabel" = s.typed->>'dia_semana', segmenter = s.typed->>'segmentador_app_time', channel = s.typed->>'type',
      fingerprint = s.fingerprint, revision = e.revision + 1, "updatedAt" = now()
    FROM (${stagedBy(ctx.batchId, "CORRECTION")}) s
    JOIN "ZdTimeDecision" dc ON dc."batchId" = ${ctx.batchId} AND dc.fingerprint = s.fingerprint
    WHERE e.id = dc."targetEntryId"`);
  return { inserted, revised };
}

type CorrectionRow = { id: bigint; entryId: string; previous: Record<string, string | null>; previousFingerprint: string; minutesBefore: string };

/**
 * Reversión del lote (ya marcado REVERTED): deshace sus correcciones respetando las posteriores y retira solo los
 * registros que ningún otro lote vigente aporta ni corrige.
 */
async function revert(tx: Tx, ctx: ActivationContext) {
  await lockDerivation(tx);
  const mine = await tx.$queryRaw<CorrectionRow[]>(Prisma.sql`
    SELECT id, "entryId", previous, "previousFingerprint", "minutesBefore"::text AS "minutesBefore"
    FROM "ZdTimeCorrection" WHERE "batchId" = ${ctx.batchId} AND NOT reverted ORDER BY id DESC`);
  for (const c of mine) {
    const later = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`
      SELECT id FROM "ZdTimeCorrection" WHERE "entryId" = ${c.entryId} AND id > ${c.id} AND NOT reverted ORDER BY id ASC LIMIT 1`);
    if (later[0]) {
      // Hay una corrección posterior vigente: su «antes» pasa a ser el de esta; no se restaura nada por encima.
      await tx.$executeRaw(Prisma.sql`
        UPDATE "ZdTimeCorrection" SET previous = ${JSON.stringify(c.previous)}::jsonb, "previousFingerprint" = ${c.previousFingerprint},
          "minutesBefore" = ${c.minutesBefore}::numeric WHERE id = ${later[0].id}`);
    } else {
      const p = c.previous;
      await tx.$executeRaw(Prisma.sql`
        UPDATE "ZdTimeEntry" SET "userName" = ${p.userName}, "hourText" = ${p.hourText}, "loggedHours" = ${p.loggedHours}::numeric,
          "loggedMinutes" = ${p.loggedMinutes}::numeric, minutes = ${p.minutes}::numeric, "dayLabel" = ${p.dayLabel}, segmenter = ${p.segmenter},
          channel = ${p.channel}, fingerprint = ${c.previousFingerprint}, revision = revision + 1, "updatedAt" = now()
        WHERE id = ${c.entryId}`);
    }
    await tx.$executeRaw(Prisma.sql`UPDATE "ZdTimeCorrection" SET reverted = true WHERE id = ${c.id}`);
  }
  if (mine.length > 0) {
    // Un registro cuyo lote de origen ya se revirtió solo seguía vivo por la corrección que acabamos de deshacer.
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM "ZdTimeEntry" e
      WHERE e.id IN (${Prisma.join(mine.map((c) => c.entryId))})
        AND NOT EXISTS (SELECT 1 FROM "UploadRecordSource" s JOIN "UploadBatch" b ON b.id = s."batchId"
          WHERE s."profileId" = ${ZENDESK_TIME_PROFILE} AND s.fingerprint = e."originFingerprint" AND b.status = 'COMPLETED')
        AND NOT EXISTS (SELECT 1 FROM "ZdTimeCorrection" c WHERE c."entryId" = e.id AND NOT c.reverted)`);
  }
  await tx.$executeRaw(Prisma.sql`
    DELETE FROM "ZdTimeEntry" e
    WHERE e."originFingerprint" IN (${orphanFingerprintsSql(ctx.batchId)})
      AND NOT EXISTS (SELECT 1 FROM "ZdTimeCorrection" c WHERE c."entryId" = e.id AND c."batchId" <> ${ctx.batchId} AND NOT c.reverted)`);
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
