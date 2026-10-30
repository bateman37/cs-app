import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { mulDecimal } from "@/domain/wrike";
import { recordAudit } from "@/server/audit";
import { authorize } from "@/server/authorize";
import { DomainError, StaleVersionError } from "@/server/errors";
import { TIME_SOURCES, type TimeSource } from "@/server/time-correction";
import { adminTransaction } from "@/server/tx";
import { applyCorrectionRules as applyWrikeRules } from "../wrike/time";
import { refreshWrikePreview } from "../wrike/preview";
import { refreshTimePreview } from "./preview";
import { applyCorrectionRules as applyZendeskRules } from "./time";

type Tx = Prisma.TransactionClient;

const decisionSchema = z.object({
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/, "Fila no válida."),
  decision: z.enum(["CORRECTION", "DIFFERENT", "CLEAR"]),
  targetEntryId: z.string().min(1).optional(),
  /** Revisión del registro objetivo que el Administrador estaba viendo. */
  expectedEntryRevision: z.coerce.number().int().min(1).optional(),
  /** Versión del lote que estaba viendo (concurrencia). */
  expectedBatchVersion: z.coerce.number().int().min(1).optional(),
  /** Confirmación explícita de ESTA sustitución concreta. */
  confirmReplace: z.union([z.boolean(), z.literal("on"), z.literal("true")]).optional(),
});

export type CorrectionDecisionInput = z.infer<typeof decisionSchema>;

const rulesOf = (profileId: string) =>
  profileId === "wrike"
    ? { apply: applyWrikeRules, refresh: refreshWrikePreview }
    : { apply: applyZendeskRules, refresh: refreshTimePreview };

const raw = Prisma.raw;

type StagedRow = { position: number; typed: Record<string, string | null>; derived: Record<string, unknown> | null; disposition: string | null; minutes: string };

async function loadRow(db: Tx | typeof prisma, src: TimeSource, batchId: string, fingerprint: string): Promise<StagedRow | undefined> {
  const rows = await db.$queryRaw<StagedRow[]>(Prisma.sql`
    SELECT r.position, r.typed, r.derived, r.disposition, trim_scale(${src.minutesOfStaged})::text AS minutes
    FROM "UploadStagedRow" r, LATERAL (SELECT r.typed AS typed) s
    WHERE r."batchId" = ${batchId} AND r.fingerprint = ${fingerprint} AND r.classification = 'VALID' AND NOT r."duplicateInFile"`);
  return rows[0];
}

/** Contenido de la fila del lote con las mismas claves que el contenido de un registro (para compararlos). */
export function incomingContent(profileId: string, typed: Record<string, string | null>, minutes: string): Record<string, string | null> {
  if (profileId === "wrike") {
    return {
      userName: typed.usuario ?? null,
      projectName: typed.proyecto ?? null,
      taskName: typed.tarea ?? null,
      ticketFieldRaw: typed.ticket_zendesk ?? null,
      workDate: typed.fecha ?? null,
      minutes,
    };
  }
  return {
    ticketId: typed.ticket_id ?? null,
    userId: typed.user_id ?? null,
    userName: typed.user_name ?? null,
    workDate: typed.date ?? null,
    hourText: typed.hour ?? null,
    minutes,
    dayLabel: typed.dia_semana ?? null,
    segmenter: typed.segmentador_app_time ?? null,
    sourceId: typed.id ?? null,
    channel: typed.type ?? null,
  };
}

/**
 * Decisión explícita del Administrador sobre una fila del lote, mientras está listo para revisar: «corrige este registro
 * activo concreto de la misma fuente» (con o sin ID externo; crea una revisión del registro sin sumar la duración anterior y
 * la nueva), «es otro trabajo» o «sin decidir». El servidor valida fuente, lote, fila, estado, objetivo activo y revisión, y
 * exige confirmar la sustitución concreta. Queda auditada con el antes/después y los minutos. Nunca se decide por parecido.
 */
export async function decideTimeCorrection(actorId: string, batchId: string, rawInput: unknown) {
  const parsed = decisionSchema.safeParse(rawInput);
  if (!parsed.success) throw new DomainError(parsed.error.issues.map((i) => i.message).join(" "));
  const input = parsed.data;
  return adminTransaction(actorId, async (tx, actor) => {
    const locked = await tx.$queryRaw<{ status: string; profileId: string; version: number }[]>(Prisma.sql`
      SELECT status::text AS status, "profileId", version FROM "UploadBatch" WHERE id = ${batchId} FOR UPDATE`);
    const b = locked[0];
    const src = b ? TIME_SOURCES[b.profileId] : undefined;
    if (!b || !src) throw new DomainError("Carga de tiempos no encontrada.");
    if (b.status !== "READY") throw new DomainError(`Solo se pueden decidir correcciones en un lote listo para revisar (estado «${b.status}»).`);
    if (input.expectedBatchVersion !== undefined && input.expectedBatchVersion !== b.version) throw new StaleVersionError("El lote");

    const row = await loadRow(tx, src, batchId, input.fingerprint);
    if (!row) throw new DomainError("La fila indicada no pertenece a este lote o no es una fila válida y única.");
    const priorRows = await tx.$queryRaw<{ decision: string; targetEntryId: string | null; targetRevision: number | null }[]>(Prisma.sql`
      SELECT decision, "targetEntryId", "targetRevision" FROM ${raw(src.decision)} WHERE "batchId" = ${batchId} AND fingerprint = ${input.fingerprint}`);
    const prior = priorRows[0];
    if (!prior && !["NEW", "PENDING_DECISION", "CORRECTION"].includes(row.disposition ?? "")) {
      throw new DomainError("Esta fila no se materializaría (repetida o ya importada): no hay nada que decidir.");
    }

    let target: { id: string; revision: number; minutes: string } | null = null;
    if (input.decision === "CORRECTION") {
      if (!input.targetEntryId) throw new DomainError("Seleccione el registro activo que corrige esta fila.");
      if (input.confirmReplace !== true && input.confirmReplace !== "on" && input.confirmReplace !== "true") {
        throw new DomainError("Confirme expresamente que esta fila sustituye a ese registro concreto.");
      }
      if (input.expectedEntryRevision === undefined) throw new DomainError("Falta la revisión del registro que estaba viendo: recargue la ficha.");
      const t = await tx.$queryRaw<{ id: string; revision: number; minutes: string }[]>(Prisma.sql`
        SELECT e.id, e.revision, trim_scale(e.minutes)::text AS minutes FROM ${raw(src.entry)} e WHERE e.id = ${input.targetEntryId} FOR UPDATE`);
      if (!t[0]) throw new DomainError("Ese registro no existe como registro activo de esta fuente (puede ser de otra fuente o haberse retirado).");
      if (t[0].revision !== input.expectedEntryRevision) {
        throw new DomainError("El registro cambió desde que lo seleccionó (otra corrección o reversión): recargue la ficha y revise de nuevo la sustitución.");
      }
      const taken = await tx.$queryRaw<{ fingerprint: string }[]>(Prisma.sql`
        SELECT fingerprint FROM ${raw(src.decision)} WHERE "batchId" = ${batchId} AND "targetEntryId" = ${t[0].id} AND decision = 'CORRECTION' AND fingerprint <> ${input.fingerprint}`);
      if (taken[0]) throw new DomainError("Ese registro ya es el objetivo de otra fila de este lote: un registro solo puede ser corregido por una fila.");
      target = t[0];
    }

    // La decisión anterior se retira y se aplica la nueva; las disposiciones se recalculan con las reglas del perfil.
    await tx.$executeRaw(Prisma.sql`DELETE FROM ${raw(src.decision)} WHERE "batchId" = ${batchId} AND fingerprint = ${input.fingerprint}`);
    if (input.decision !== "CLEAR") {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO ${raw(src.decision)} ("batchId", fingerprint, decision, "targetEntryId", "targetRevision", "decidedById")
        VALUES (${batchId}, ${input.fingerprint}, ${input.decision}, ${target?.id ?? null}, ${target?.revision ?? null}, ${actor.id})`);
    }
    await tx.$executeRaw(Prisma.sql`
      UPDATE "UploadStagedRow" SET disposition = 'NEW'
      WHERE "batchId" = ${batchId} AND fingerprint = ${input.fingerprint} AND disposition IN ('PENDING_DECISION', 'CORRECTION')`);
    const rules = rulesOf(b.profileId);
    await rules.apply(tx, batchId);
    await rules.refresh(tx, batchId, input.fingerprint);
    await tx.uploadBatch.update({ where: { id: batchId }, data: { version: { increment: 1 } } });

    const who = `fila ${row.position}`;
    const summary =
      input.decision === "CORRECTION"
        ? `Corrección explícita (${who}) del registro ${target?.id}: ${Number(target?.minutes) / 60} h → ${Number(row.minutes) / 60} h (revisión ${target?.revision})`
        : input.decision === "DIFFERENT"
          ? `Fila confirmada como otro trabajo (${who}): ${Number(row.minutes) / 60} h`
          : `Decisión retirada (${who})`;
    await recordAudit(tx, actor, {
      action: "UPDATE",
      entityType: "TimeDecision",
      entityId: input.fingerprint,
      batchId,
      summary,
      before: prior ?? null,
      after: {
        origen: b.profileId,
        decision: input.decision,
        targetEntryId: target?.id ?? null,
        targetRevision: target?.revision ?? null,
        minutesBefore: target?.minutes ?? null,
        minutesAfter: row.minutes,
      },
    });
    return { fingerprint: input.fingerprint, decision: input.decision };
  });
}

// ---------------------------------------------------------------- Consulta de objetivos y comparación (solo Administrador)

export type TargetFilters = { ticket?: string; person?: string; from?: string; to?: string; text?: string };
export type TargetEntry = { id: string; revision: number; minutes: string; content: Record<string, string | null> };

const isoDay = /^\d{4}-\d{2}-\d{2}$/;

function filterSql(profileId: string, f: TargetFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  const like = (s: string) => `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  if (f.ticket) {
    parts.push(profileId === "wrike" ? Prisma.sql`(e."drvTicketId" = ${f.ticket} OR e."explicitTicket" = ${f.ticket})` : Prisma.sql`e."ticketId" = ${f.ticket}`);
  }
  if (f.person) {
    parts.push(
      profileId === "wrike"
        ? Prisma.sql`e."userName" ILIKE ${like(f.person)}`
        : Prisma.sql`(e."userName" ILIKE ${like(f.person)} OR e."userId" = ${f.person})`,
    );
  }
  if (f.from && isoDay.test(f.from)) parts.push(Prisma.sql`e."workDate" >= ${f.from}::date`);
  if (f.to && isoDay.test(f.to)) parts.push(Prisma.sql`e."workDate" <= ${f.to}::date`);
  if (f.text) {
    parts.push(
      profileId === "wrike"
        ? Prisma.sql`(e."taskName" ILIKE ${like(f.text)} OR e."projectName" ILIKE ${like(f.text)})`
        : Prisma.sql`(e."sourceId" ILIKE ${like(f.text)} OR e."segmenter" ILIKE ${like(f.text)})`,
    );
  }
  return parts.length > 0 ? Prisma.join(parts, " AND ") : Prisma.sql`true`;
}

/** Registros activos de la misma fuente que cumplen los filtros (ayudan a localizar; no deciden la relación). Máximo 25. */
export async function listCorrectionTargets(actorId: string, batchId: string, filters: TargetFilters): Promise<TargetEntry[] | null> {
  await authorize(prisma, actorId, "ADMIN");
  const b = await prisma.uploadBatch.findUnique({ where: { id: batchId }, select: { profileId: true } });
  const src = b ? TIME_SOURCES[b.profileId] : undefined;
  if (!b || !src) return null;
  const hasFilter = Object.values(filters).some((v) => v);
  if (!hasFilter) return [];
  const rows = await prisma.$queryRaw<{ id: string; revision: number; minutes: string; content: Record<string, string | null> }[]>(Prisma.sql`
    SELECT e.id, e.revision, trim_scale(e.minutes)::text AS minutes, ${src.snapshot} AS content
    FROM ${raw(src.entry)} e WHERE ${filterSql(b.profileId, filters)} ORDER BY e."workDate" DESC, e.id LIMIT 25`);
  return rows;
}

export type CorrectionCompare = {
  profileId: string;
  fields: [string, string][];
  incoming: Record<string, string | null>;
  incomingMinutes: string;
  target: TargetEntry | null;
  differences: string[];
  decision: { decision: string; targetEntryId: string | null; targetRevision: number | null; stale: boolean } | null;
};

/** Ambos registros, sus diferencias y los minutos antes/después para una fila y un objetivo concretos. */
export async function getCorrectionCompare(actorId: string, batchId: string, fingerprint: string, targetEntryId?: string): Promise<CorrectionCompare | null> {
  await authorize(prisma, actorId, "ADMIN");
  const b = await prisma.uploadBatch.findUnique({ where: { id: batchId }, select: { profileId: true } });
  const src = b ? TIME_SOURCES[b.profileId] : undefined;
  if (!b || !src) return null;
  const row = await loadRow(prisma, src, batchId, fingerprint);
  if (!row) return null;
  const incoming = incomingContent(b.profileId, row.typed, row.minutes);
  const dec = await prisma.$queryRaw<{ decision: string; targetEntryId: string | null; targetRevision: number | null }[]>(Prisma.sql`
    SELECT decision, "targetEntryId", "targetRevision" FROM ${raw(src.decision)} WHERE "batchId" = ${batchId} AND fingerprint = ${fingerprint}`);
  const id = targetEntryId ?? dec[0]?.targetEntryId ?? undefined;
  let target: TargetEntry | null = null;
  if (id) {
    const t = await prisma.$queryRaw<TargetEntry[]>(Prisma.sql`
      SELECT e.id, e.revision, trim_scale(e.minutes)::text AS minutes, ${src.snapshot} AS content FROM ${raw(src.entry)} e WHERE e.id = ${id}`);
    target = t[0] ?? null;
  }
  const differences = target ? src.fields.filter(([k]) => (target!.content[k] ?? null) !== (incoming[k] ?? null)).map(([, label]) => label) : [];
  let stale = false;
  if (dec[0]?.decision === "CORRECTION") {
    stale = !target || (dec[0].targetRevision !== null && target.revision !== dec[0].targetRevision);
  }
  return {
    profileId: b.profileId,
    fields: src.fields,
    incoming,
    incomingMinutes: row.minutes,
    target,
    differences,
    decision: dec[0] ? { ...dec[0], stale } : null,
  };
}

/** Minutos exactos de horas decimales (útil en pruebas y presentación). */
export const minutesOfHours = (hours: string) => mulDecimal(hours, 60);
