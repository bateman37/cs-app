import { Prisma } from "@/generated/prisma/client";
import { orphanFingerprintsSql } from "./uploads/provenance";

type Tx = Prisma.TransactionClient;

/**
 * Corrección explícita de un registro de tiempo (ZTM 05 ampliado, CSAPP-04): común a las fuentes con registros de
 * dedicación sin ID fiable (Zendesk sin id, Wrike). Una fila del lote puede declararse «corrección de ESTE registro activo
 * de la misma fuente»; al activar sustituye el contenido (nunca suma duración antigua y nueva) y conserva el anterior para
 * revertir. Nada se decide por parecido: la relación la fija el Administrador y el servidor la valida.
 */
export type TimeSource = {
  profileId: string;
  entry: string;
  decision: string;
  correction: string;
  /** Expresión jsonb con el contenido corregible del registro (alias `e`). */
  snapshot: Prisma.Sql;
  /** Lista SET que aplica el contenido de la fila del lote (alias `s`, con `s.typed` y `s.derived`). */
  setFromStaged: Prisma.Sql;
  /** Lista SET que restaura el contenido de `c.previous` (alias `c` de la corrección). */
  setFromPrevious: Prisma.Sql;
  /** Minutos que aportaría la fila del lote (alias `s`). */
  minutesOfStaged: Prisma.Sql;
  /** Campos mostrados en la comparación: [clave del snapshot, etiqueta]. */
  fields: [string, string][];
};

const raw = Prisma.raw;

export const ZENDESK_TIME_SOURCE: TimeSource = {
  profileId: "zendesk-tiempo",
  entry: '"ZdTimeEntry"',
  decision: '"ZdTimeDecision"',
  correction: '"ZdTimeCorrection"',
  snapshot: Prisma.sql`jsonb_build_object('ticketId', e."ticketId", 'userId', e."userId", 'userName', e."userName", 'workDate', e."workDate"::text,
    'hourText', e."hourText", 'loggedHours', trim_scale(e."loggedHours")::text, 'loggedMinutes', trim_scale(e."loggedMinutes")::text,
    'minutes', trim_scale(e.minutes)::text, 'dayLabel', e."dayLabel", 'segmenter', e.segmenter, 'sourceId', e."sourceId", 'channel', e.channel)`,
  setFromStaged: Prisma.sql`"ticketId" = s.typed->>'ticket_id', "userId" = s.typed->>'user_id', "userName" = s.typed->>'user_name',
    "workDate" = (s.typed->>'date')::date, "hourText" = s.typed->>'hour', "loggedHours" = (s.typed->>'logged_hours')::numeric,
    "loggedMinutes" = (s.typed->>'logged_minutes')::numeric,
    minutes = (s.typed->>'logged_hours')::numeric * 60 + (s.typed->>'logged_minutes')::numeric,
    "dayLabel" = s.typed->>'dia_semana', segmenter = s.typed->>'segmentador_app_time', "sourceId" = s.typed->>'id', channel = s.typed->>'type'`,
  setFromPrevious: Prisma.sql`"ticketId" = c.previous->>'ticketId', "userId" = c.previous->>'userId', "userName" = c.previous->>'userName',
    "workDate" = (c.previous->>'workDate')::date, "hourText" = c.previous->>'hourText', "loggedHours" = (c.previous->>'loggedHours')::numeric,
    "loggedMinutes" = (c.previous->>'loggedMinutes')::numeric, minutes = (c.previous->>'minutes')::numeric,
    "dayLabel" = c.previous->>'dayLabel', segmenter = c.previous->>'segmenter', "sourceId" = c.previous->>'sourceId', channel = c.previous->>'channel'`,
  minutesOfStaged: Prisma.sql`(s.typed->>'logged_hours')::numeric * 60 + (s.typed->>'logged_minutes')::numeric`,
  fields: [
    ["ticketId", "Ticket"],
    ["userId", "ID de persona"],
    ["userName", "Persona"],
    ["workDate", "Fecha del trabajo"],
    ["hourText", "Hora"],
    ["minutes", "Minutos"],
    ["dayLabel", "Día de la semana"],
    ["segmenter", "Segmentador"],
    ["sourceId", "ID del registro"],
    ["channel", "Tipo"],
  ],
};

export const WRIKE_TIME_SOURCE: TimeSource = {
  profileId: "wrike",
  entry: '"WrikeTimeEntry"',
  decision: '"WrikeTimeDecision"',
  correction: '"WrikeTimeCorrection"',
  snapshot: Prisma.sql`jsonb_build_object('userName', e."userName", 'projectName', e."projectName", 'taskName', e."taskName",
    'ticketFieldRaw', e."ticketFieldRaw", 'explicitState', e."explicitState", 'explicitTicket', e."explicitTicket",
    'nameCandidates', e."nameCandidates", 'workDate', e."workDate"::text, 'hours', trim_scale(e.hours)::text, 'minutes', trim_scale(e.minutes)::text)`,
  setFromStaged: Prisma.sql`"userName" = s.typed->>'usuario', "projectName" = s.typed->>'proyecto', "taskName" = s.typed->>'tarea',
    "ticketFieldRaw" = s.typed->>'ticket_zendesk', "explicitState" = s.derived->>'explicitState', "explicitTicket" = s.derived->>'explicitTicket',
    "nameCandidates" = COALESCE(s.derived->'candidates', '[]'::jsonb), "workDate" = (s.typed->>'fecha')::date,
    hours = (s.typed->>'horas')::numeric, minutes = (s.typed->>'horas')::numeric * 60`,
  setFromPrevious: Prisma.sql`"userName" = c.previous->>'userName', "projectName" = c.previous->>'projectName', "taskName" = c.previous->>'taskName',
    "ticketFieldRaw" = c.previous->>'ticketFieldRaw', "explicitState" = c.previous->>'explicitState', "explicitTicket" = c.previous->>'explicitTicket',
    "nameCandidates" = c.previous->'nameCandidates', "workDate" = (c.previous->>'workDate')::date,
    hours = (c.previous->>'hours')::numeric, minutes = (c.previous->>'minutes')::numeric`,
  minutesOfStaged: Prisma.sql`(s.typed->>'horas')::numeric * 60`,
  fields: [
    ["userName", "Usuario"],
    ["projectName", "Proyecto"],
    ["taskName", "Nombre de la tarea"],
    ["ticketFieldRaw", "Ticket Zendesk"],
    ["workDate", "Fecha registro"],
    ["minutes", "Minutos"],
  ],
};

export const TIME_SOURCES: Record<string, TimeSource> = {
  [ZENDESK_TIME_SOURCE.profileId]: ZENDESK_TIME_SOURCE,
  [WRIKE_TIME_SOURCE.profileId]: WRIKE_TIME_SOURCE,
};

/**
 * Decisiones vigentes del lote sobre sus filas: la corrección solo vale si el objetivo sigue activo y en la revisión que el
 * Administrador vio. Una decisión obsoleta deja la fila pendiente (no se materializa como nueva ni corrige a ciegas).
 */
export async function applyDecisionRules(tx: Tx, src: TimeSource, batchId: string) {
  const valid = Prisma.sql`EXISTS (SELECT 1 FROM ${raw(src.entry)} e WHERE e.id = d."targetEntryId" AND (d."targetRevision" IS NULL OR e.revision = d."targetRevision"))`;
  await tx.$executeRaw(Prisma.sql`
    UPDATE "UploadStagedRow" r SET disposition = 'CORRECTION'
    FROM ${raw(src.decision)} d
    WHERE d."batchId" = r."batchId" AND d.fingerprint = r.fingerprint AND d.decision = 'CORRECTION' AND ${valid}
      AND r."batchId" = ${batchId} AND r.classification = 'VALID' AND r."duplicateInFile" = false AND r.disposition = 'NEW'`);
  await tx.$executeRaw(Prisma.sql`
    UPDATE "UploadStagedRow" r SET disposition = 'PENDING_DECISION'
    FROM ${raw(src.decision)} d
    WHERE d."batchId" = r."batchId" AND d.fingerprint = r.fingerprint AND d.decision = 'CORRECTION' AND NOT ${valid}
      AND r."batchId" = ${batchId} AND r.classification = 'VALID' AND r."duplicateInFile" = false AND r.disposition = 'NEW'`);
}

const stagedBy = (batchId: string, disposition: string) => Prisma.sql`
  SELECT r.position, r.fingerprint, r.typed, r.derived FROM "UploadStagedRow" r
  WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' AND r."duplicateInFile" = false AND r.disposition = ${disposition}`;

/** Aplica las correcciones del lote: guarda el contenido anterior, sustituye (sin sumar) y recalcula lo derivado. */
export async function activateCorrections(
  tx: Tx,
  src: TimeSource,
  batchId: string,
  rederive: (ids: Prisma.Sql) => Promise<number>,
): Promise<number> {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO ${raw(src.correction)} ("entryId", "batchId", fingerprint, "previousFingerprint", previous, "minutesBefore", "minutesAfter", "decidedById")
    SELECT e.id, ${batchId}, s.fingerprint, e.fingerprint, ${src.snapshot}, e.minutes, ${src.minutesOfStaged}, dc."decidedById"
    FROM (${stagedBy(batchId, "CORRECTION")}) s
    JOIN ${raw(src.decision)} dc ON dc."batchId" = ${batchId} AND dc.fingerprint = s.fingerprint
    JOIN ${raw(src.entry)} e ON e.id = dc."targetEntryId"`);
  const revised = await tx.$executeRaw(Prisma.sql`
    UPDATE ${raw(src.entry)} e SET ${src.setFromStaged}, fingerprint = s.fingerprint, revision = e.revision + 1, "updatedAt" = now()
    FROM (${stagedBy(batchId, "CORRECTION")}) s
    JOIN ${raw(src.decision)} dc ON dc."batchId" = ${batchId} AND dc.fingerprint = s.fingerprint
    WHERE e.id = dc."targetEntryId"`);
  if (revised > 0) {
    await rederive(
      Prisma.sql`e.id IN (SELECT dc."targetEntryId" FROM ${raw(src.decision)} dc WHERE dc."batchId" = ${batchId} AND dc.decision = 'CORRECTION')`,
    );
  }
  return revised;
}

type CorrectionRow = { id: bigint; entryId: string; previousFingerprint: string; minutesBefore: string };

/**
 * Reversión del lote (ya marcado REVERTED): deshace sus correcciones respetando las posteriores vigentes y retira solo los
 * registros que ningún otro lote vigente aporta ni corrige.
 */
export async function revertTimeBatch(
  tx: Tx,
  src: TimeSource,
  batchId: string,
  rederive: (ids: Prisma.Sql) => Promise<number>,
) {
  const mine = await tx.$queryRaw<CorrectionRow[]>(Prisma.sql`
    SELECT id, "entryId", "previousFingerprint", "minutesBefore"::text AS "minutesBefore"
    FROM ${raw(src.correction)} WHERE "batchId" = ${batchId} AND NOT reverted ORDER BY id DESC`);
  for (const c of mine) {
    const later = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`
      SELECT id FROM ${raw(src.correction)} WHERE "entryId" = ${c.entryId} AND id > ${c.id} AND NOT reverted ORDER BY id ASC LIMIT 1`);
    if (later[0]) {
      // Hay una corrección posterior vigente: su «antes» pasa a ser el de esta; no se restaura nada por encima.
      await tx.$executeRaw(Prisma.sql`
        UPDATE ${raw(src.correction)} n SET previous = c.previous, "previousFingerprint" = c."previousFingerprint", "minutesBefore" = c."minutesBefore"
        FROM ${raw(src.correction)} c WHERE c.id = ${c.id} AND n.id = ${later[0].id}`);
    } else {
      await tx.$executeRaw(Prisma.sql`
        UPDATE ${raw(src.entry)} e SET ${src.setFromPrevious}, fingerprint = c."previousFingerprint", revision = e.revision + 1, "updatedAt" = now()
        FROM ${raw(src.correction)} c WHERE c.id = ${c.id} AND e.id = c."entryId"`);
    }
    await tx.$executeRaw(Prisma.sql`UPDATE ${raw(src.correction)} SET reverted = true WHERE id = ${c.id}`);
  }
  if (mine.length > 0) {
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM ${raw(src.entry)} e
      WHERE e.id IN (${Prisma.join(mine.map((c) => c.entryId))})
        AND NOT EXISTS (SELECT 1 FROM "UploadRecordSource" s JOIN "UploadBatch" b ON b.id = s."batchId"
          WHERE s."profileId" = ${src.profileId} AND s.fingerprint = e."originFingerprint" AND b.status = 'COMPLETED')
        AND NOT EXISTS (SELECT 1 FROM ${raw(src.correction)} c WHERE c."entryId" = e.id AND NOT c.reverted)`);
    await rederive(Prisma.sql`e.id IN (${Prisma.join(mine.map((c) => c.entryId))})`);
  }
  await tx.$executeRaw(Prisma.sql`
    DELETE FROM ${raw(src.entry)} e
    WHERE e."originFingerprint" IN (${orphanFingerprintsSql(batchId)})
      AND NOT EXISTS (SELECT 1 FROM ${raw(src.correction)} c WHERE c."entryId" = e.id AND c."batchId" <> ${batchId} AND NOT c.reverted)`);
}
