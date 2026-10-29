import { milestoneSchema, milestoneUpdateSchema, versionedSchema } from "@/domain/schemas";
import { MILESTONE_LABEL } from "@/domain/catalogs";
import { formatDate, fromDbDate, toDbDate } from "@/domain/vigencia";
import { recordAudit } from "./audit";
import { adminTransaction } from "./tx";
import { DomainError, StaleVersionError } from "./errors";
import { resolveTarget } from "./common";
import { parseInput } from "./parse";

async function ownerOf(tx: Parameters<Parameters<typeof adminTransaction>[1]>[0], m: { groupId: string | null; clientId: string | null; implementationId: string | null }) {
  const type = m.groupId ? "group" : m.clientId ? "client" : "implementation";
  return resolveTarget(tx, type, (m.groupId ?? m.clientId ?? m.implementationId) as string, { requireActive: false });
}

export async function createMilestone(actorId: string, raw: unknown) {
  const input = parseInput(milestoneSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const target = await resolveTarget(tx, input.targetType, input.targetId, { requireActive: true });
    const m = await tx.milestone.create({
      data: { type: input.type, date: toDbDate(input.date) as Date, note: input.note, ...target.fk },
    });
    await recordAudit(tx, actor, {
      action: "CREATE",
      entityType: "Milestone",
      entityId: m.id,
      groupId: target.groupId,
      clientId: target.clientId,
      summary: `Hito «${MILESTONE_LABEL[m.type]}» el ${formatDate(fromDbDate(m.date))} en ${target.name}`,
      after: m,
    });
    return m;
  });
}

export async function updateMilestone(actorId: string, id: string, raw: unknown) {
  const input = parseInput(milestoneUpdateSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const before = await tx.milestone.findUnique({ where: { id } });
    if (!before) throw new DomainError("Hito no encontrado.");
    const target = await ownerOf(tx, before);
    const res = await tx.milestone.updateMany({
      where: { id, version: input.expectedVersion },
      data: { type: input.type, date: toDbDate(input.date) as Date, note: input.note, version: { increment: 1 } },
    });
    if (res.count === 0) throw new StaleVersionError("El hito");
    const after = await tx.milestone.findUniqueOrThrow({ where: { id } });
    await recordAudit(tx, actor, {
      action: "UPDATE",
      entityType: "Milestone",
      entityId: id,
      groupId: target.groupId,
      clientId: target.clientId,
      summary: `Modificación del hito «${MILESTONE_LABEL[after.type]}» de ${target.name}`,
      before,
      after,
    });
    return after;
  });
}

export async function setMilestoneActive(actorId: string, id: string, active: boolean, raw: unknown) {
  const { expectedVersion } = parseInput(versionedSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const before = await tx.milestone.findUnique({ where: { id } });
    if (!before) throw new DomainError("Hito no encontrado.");
    const target = await ownerOf(tx, before);
    const res = await tx.milestone.updateMany({
      where: { id, version: expectedVersion },
      data: { isActive: active, version: { increment: 1 } },
    });
    if (res.count === 0) throw new StaleVersionError("El hito");
    const after = await tx.milestone.findUniqueOrThrow({ where: { id } });
    await recordAudit(tx, actor, {
      action: active ? "REACTIVATE" : "DEACTIVATE",
      entityType: "Milestone",
      entityId: id,
      groupId: target.groupId,
      clientId: target.clientId,
      summary: `${active ? "Reactivación" : "Desactivación"} del hito «${MILESTONE_LABEL[after.type]}» de ${target.name}`,
      before,
      after,
    });
    return after;
  });
}
