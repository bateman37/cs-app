import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import {
  WRIKE_HEADERS,
  WRIKE_PROFILE,
  WRIKE_RULES,
  extractTicketCandidates,
  isUnimputedTask,
  parseTicketField,
  parseWrikeHours,
  zendeskHosts,
} from "@/domain/wrike";
import { cleanText } from "@/domain/normalize";
import { mapHeaders, parseDateCell } from "@/domain/zendesk";
import type { ActivationContext, HeaderMatch, ImportProfile, Issue, Json, ParsedRow } from "../uploads/profile";
import type { Cell } from "../uploads/readers/types";
import { WRIKE_TIME_SOURCE, activateCorrections, applyDecisionRules, revertTimeBatch } from "../time-correction";
import { lockDerivation } from "../zendesk/derive";
import { rederiveWrikeEntries, wrikeDerivationSql, wrikeStagedSource } from "./derive";
import { refreshWrikePreview } from "./preview";

type Tx = Prisma.TransactionClient;
type Header = (typeof WRIKE_HEADERS)[number];
type Ctx = { index: Record<Header, number> };

const err = (code: string, message: string, column: string): Issue => ({ severity: "error", code, message, column });
const warn = (code: string, message: string, column: string): Issue => ({ severity: "warning", code, message, column });

function matchHeaders(row: string[]): HeaderMatch {
  const m = mapHeaders(row, WRIKE_HEADERS);
  if (!m.ok) {
    const looksLikeZendesk = row.some((h) => h.trim().toLowerCase() === "logged_hours");
    return {
      ok: false,
      message:
        `El archivo no corresponde al perfil Wrike (CSV original de seis campos: ${WRIKE_HEADERS.join(", ")}): ${m.message}.` +
        (looksLikeZendesk ? " Parece un export de tiempos Zendesk: use la fuente «Zendesk · tiempos»." : ""),
    };
  }
  const notes = m.extras.length > 0 ? [`Columnas adicionales informadas (se conservan en el bruto; no se usan): ${m.extras.join(", ")}.`] : [];
  return { ok: true, schemaVersion: "v1-seis-campos", context: { index: m.index } satisfies Ctx, notes };
}

function parseRow(cells: Cell[], context?: unknown): ParsedRow {
  const { index } = context as Ctx;
  const cell = (h: Header) => cells[index[h]];
  const text = (h: Header) => cleanText(cell(h)?.v ?? "") || null;
  const issues: Issue[] = [];

  const user = text("Usuario");
  const project = text("Proyecto");
  const task = text("Nombre de la tarea") ?? "";
  const dateRaw = cell("Fecha registro")?.v ?? "";

  let hours: string | null = null;
  const h = parseWrikeHours(cell("Dedicación (horas)")?.v ?? "");
  if (h.ok) hours = h.value;
  else issues.push(err("HORAS_ILEGIBLES", `Dedicación (horas) ${h.reason}.`, "Dedicación (horas)"));

  let date: string | null = null;
  if (dateRaw.trim() !== "") {
    const d = parseDateCell(cell("Fecha registro"));
    if (d.ok) date = d.value.date;
    else issues.push(err("FECHA_INVALIDA", `Fecha registro: ${d.reason}.`, "Fecha registro"));
  }

  // Ticket explícito: se normaliza solo aquí (puntos de millares con gramática válida); cero o vacío = sin ticket.
  const field = parseTicketField(cell("Ticket Zendesk")?.v ?? "");
  const ticketText = field.state === "VALID" ? field.id : field.state === "INVALID" ? cleanText(cell("Ticket Zendesk")?.v ?? "") : null;
  if (field.state === "INVALID") {
    issues.push(warn("TICKET_EXPLICITO_NO_VALIDO", "Ticket Zendesk no tiene una notación válida: se conserva el texto y no se usa (ni se sustituye por un número del nombre).", "Ticket Zendesk"));
  }
  const candidates = extractTicketCandidates(task, zendeskHosts());

  let exclude: ParsedRow["exclude"];
  if (hours !== null && !issues.some((i) => i.severity === "error")) {
    if (isUnimputedTask(user, dateRaw, hours)) {
      exclude = { code: "SIN_IMPUTACION", message: "Tarea sin imputación: sin usuario, sin fecha y con dedicación cero. Se conserva el bruto y no entra en el hecho de dedicación." };
    } else if (date === null) {
      if (Number(hours) > 0) issues.push(err("FECHA_OBLIGATORIA", "Hay horas positivas pero Fecha registro está vacía: no se puede asignar un día de trabajo.", "Fecha registro"));
      else exclude = { code: "SIN_FECHA_SIN_HORAS", message: "Sin fecha y con dedicación cero: no es un hecho de dedicación. Se conserva el bruto." };
    } else if (Number(hours) === 0) {
      issues.push(warn("HORAS_CERO", "Dedicación cero con fecha: se conserva sin aportar minutos.", "Dedicación (horas)"));
    }
  }

  return {
    typed: { usuario: user, proyecto: project, tarea: task, ticket_zendesk: ticketText, fecha: date, horas: hours },
    derived: { explicitState: field.state, explicitTicket: field.state === "VALID" ? field.id : null, candidates: candidates as unknown as Json },
    issues,
    exclude,
  };
}

export const applyCorrectionRules = (tx: Tx, batchId: string) => applyDecisionRules(tx, WRIKE_TIME_SOURCE, batchId);

async function activate(tx: Tx, ctx: ActivationContext) {
  await lockDerivation(tx);
  await applyCorrectionRules(tx, ctx.batchId);
  const inserted = await tx.$executeRaw(Prisma.sql`
    INSERT INTO "WrikeTimeEntry" ("originFingerprint", "firstBatchId", "userName", "projectName", "taskName", "ticketFieldRaw", "explicitState",
      "explicitTicket", "nameCandidates", "workDate", hours, minutes, fingerprint,
      "drvTicketId", "drvTicketMethod", "drvTicketState", "drvPersonId", "drvPmo", "drvTeamId", "drvLevelId", "drvRoleId", "drvGroupId", "drvClientId",
      "drvImplementationId", "drvScopeMethod", "drvConflict", "drvCause", "drvEligibility", "drvBucket", "drvFlags", "drvBatchId", "updatedAt")
    SELECT d.payload->>'fp', ${ctx.batchId}, d.payload->'t'->>'usuario', d.payload->'t'->>'proyecto', d.payload->'t'->>'tarea',
      d.payload->'t'->>'ticket_zendesk', d.payload->'d'->>'explicitState', d.payload->'d'->>'explicitTicket', COALESCE(d.payload->'d'->'candidates', '[]'::jsonb),
      (d.payload->'t'->>'fecha')::date, (d.payload->'t'->>'horas')::numeric, (d.payload->'t'->>'horas')::numeric * 60, d.payload->>'fp',
      d.ticket_id, d.ticket_method, d.ticket_state, d.person_id, d.pmo, d.team_id, d.level_id, d.role_id, d.group_id, d.client_id,
      d.impl_id, d.scope_method, d.conflict, d.cause_class, d.eligibility, d.bucket, d.flags, ${ctx.batchId}, now()
    FROM (${wrikeDerivationSql(
      wrikeStagedSource(ctx.batchId, {
        extra: Prisma.sql`AND r.disposition = 'NEW'`,
        payload: Prisma.sql`jsonb_build_object('fp', r.fingerprint, 't', r.typed, 'd', r.derived)`,
      }),
    )}) d
    ON CONFLICT ("originFingerprint") DO NOTHING`);
  const revised = await activateCorrections(tx, WRIKE_TIME_SOURCE, ctx.batchId, (ids) => rederiveWrikeEntries(tx, ids, ctx.batchId));
  return { inserted, revised };
}

async function revert(tx: Tx, ctx: ActivationContext) {
  await lockDerivation(tx);
  await revertTimeBatch(tx, WRIKE_TIME_SOURCE, ctx.batchId, (ids) => rederiveWrikeEntries(tx, ids, null));
}

export const wrikeBatchEntries = (batchId: string) => Prisma.sql`
  e."originFingerprint" IN (SELECT s.fingerprint FROM "UploadRecordSource" s WHERE s."batchId" = ${batchId})`;

export const wrike: ImportProfile = {
  id: WRIKE_PROFILE,
  label: "Wrike",
  description:
    "CSV original DETALLESOPORTEN3 (seis campos: Usuario, Proyecto, Nombre de la tarea, Ticket Zendesk, Fecha registro, Dedicación en horas), sin abrirlo ni pegarlo en Excel. " +
    "Las horas son decimales (0,5 h = 30 min); la fuente PMO desde 01/01/2025. Las filas idénticas se materializan una vez y una modificación real se decide con la corrección explícita.",
  version: 1,
  formats: ["csv"],
  delimiter: ",",
  policy: "INCORPORATE",
  metadataFields: [],
  metadataSchema: z.object({}).strict(),
  blocksConfirmOnErrors: true,
  matchHeaders,
  parseRow,
  async rulesFingerprint() {
    return WRIKE_RULES;
  },
  async postPrepare(tx, batchId) {
    await applyCorrectionRules(tx, batchId);
    await refreshWrikePreview(tx, batchId);
  },
  activate,
  revert,
  async rederive(tx, ctx) {
    await lockDerivation(tx);
    return { updated: await rederiveWrikeEntries(tx, wrikeBatchEntries(ctx.batchId), ctx.batchId) };
  },
};
