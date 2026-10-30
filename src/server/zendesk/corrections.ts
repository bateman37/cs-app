import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { ZENDESK_TIME_PROFILE } from "@/domain/zendesk";
import { recordAudit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { adminTransaction } from "@/server/tx";
import { applyCorrectionRules } from "./time";

const decisionSchema = z.object({
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/, "Fila no válida."),
  decision: z.enum(["CORRECTION", "DIFFERENT", "CLEAR"]),
  targetEntryId: z.string().min(1).optional(),
});

export type CorrectionDecisionInput = z.infer<typeof decisionSchema>;

/**
 * Decisión explícita del Administrador sobre una fila con posible corrección (ZTM 05), dentro del propio lote y
 * mientras está listo para revisar: «corrige este registro concreto» (crea una revisión del registro interno, sin
 * sumar la duración anterior y la nueva), «es otro trabajo» (se materializa como fila distinta) o «sin decidir».
 * Queda auditada con el antes/después y las horas afectadas. Nunca se decide por parecido.
 */
export async function decideTimeCorrection(actorId: string, batchId: string, raw: unknown) {
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError(parsed.error.issues.map((i) => i.message).join(" "));
  const input = parsed.data;
  return adminTransaction(actorId, async (tx, actor) => {
    const locked = await tx.$queryRaw<{ status: string; profileId: string }[]>(Prisma.sql`
      SELECT status::text AS status, "profileId" FROM "UploadBatch" WHERE id = ${batchId} FOR UPDATE`);
    const b = locked[0];
    if (!b || b.profileId !== ZENDESK_TIME_PROFILE) throw new DomainError("Carga de tiempos no encontrada.");
    if (b.status !== "READY") throw new DomainError(`Solo se pueden decidir correcciones en un lote listo para revisar (estado «${b.status}»).`);

    const rows = await tx.$queryRaw<{ typed: Record<string, string | null>; disposition: string | null }[]>(Prisma.sql`
      SELECT typed, disposition FROM "UploadStagedRow"
      WHERE "batchId" = ${batchId} AND fingerprint = ${input.fingerprint} AND classification = 'VALID' AND NOT "duplicateInFile"`);
    const row = rows[0];
    if (!row) throw new DomainError("La fila indicada no pertenece a este lote o no es una fila válida.");
    const prior = await tx.zdTimeDecision.findUnique({ where: { batchId_fingerprint: { batchId, fingerprint: input.fingerprint } } });
    if (row.disposition !== "PENDING_DECISION" && !prior) throw new DomainError("Esta fila no tiene una posible corrección que decidir.");

    let target: { id: string; minutes: string } | null = null;
    if (input.decision === "CORRECTION") {
      if (!input.targetEntryId) throw new DomainError("Indique qué registro corrige esta fila.");
      const t = await tx.$queryRaw<{ id: string; minutes: string }[]>(Prisma.sql`
        SELECT e.id, e.minutes::text AS minutes FROM "ZdTimeEntry" e
        WHERE e.id = ${input.targetEntryId} AND e."sourceId" = ${row.typed.id} AND e."ticketId" = ${row.typed.ticket_id}
          AND e."workDate" = ${row.typed.date}::date AND e."userId" IS NOT DISTINCT FROM ${row.typed.user_id}
          AND (e."userId" IS NOT NULL OR e."userName" IS NOT DISTINCT FROM ${row.typed.user_name})`);
      if (!t[0]) throw new DomainError("Ese registro no es una coincidencia de esta fila (mismo id, ticket, persona y día).");
      target = t[0];
    }

    // La decisión anterior se retira y se aplica la nueva; las disposiciones se recalculan con las reglas del perfil.
    await tx.zdTimeDecision.deleteMany({ where: { batchId, fingerprint: input.fingerprint } });
    if (input.decision !== "CLEAR") {
      await tx.zdTimeDecision.create({
        data: {
          batchId,
          fingerprint: input.fingerprint,
          decision: input.decision,
          targetEntryId: target?.id ?? null,
          decidedById: actor.id,
        },
      });
    }
    await tx.$executeRaw(Prisma.sql`
      UPDATE "UploadStagedRow" SET disposition = 'NEW'
      WHERE "batchId" = ${batchId} AND fingerprint = ${input.fingerprint} AND disposition IN ('PENDING_DECISION', 'CORRECTION')`);
    await applyCorrectionRules(tx, batchId);
    await tx.uploadBatch.update({ where: { id: batchId }, data: { version: { increment: 1 } } });

    const newMinutes = Number(row.typed.logged_hours) * 60 + Number(row.typed.logged_minutes);
    const summary =
      input.decision === "CORRECTION"
        ? `Corrección explícita (id ${row.typed.id}, ticket ${row.typed.ticket_id}, ${row.typed.date}): ${Number(target?.minutes) / 60} h → ${newMinutes / 60} h`
        : input.decision === "DIFFERENT"
          ? `Fila confirmada como otro trabajo (id ${row.typed.id}, ticket ${row.typed.ticket_id}, ${row.typed.date}): ${newMinutes / 60} h`
          : `Decisión retirada (id ${row.typed.id}, ticket ${row.typed.ticket_id}, ${row.typed.date})`;
    await recordAudit(tx, actor, {
      action: "UPDATE",
      entityType: "ZdTimeDecision",
      entityId: input.fingerprint,
      batchId,
      summary,
      before: prior ? { decision: prior.decision, targetEntryId: prior.targetEntryId } : null,
      after: { decision: input.decision, targetEntryId: target?.id ?? null, minutesBefore: target?.minutes ?? null, minutesAfter: String(newMinutes) },
    });
    return { fingerprint: input.fingerprint, decision: input.decision };
  });
}
