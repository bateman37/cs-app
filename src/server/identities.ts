import type { Prisma } from "@/generated/prisma/client";
import { identitySchema, identityUpdateSchema, versionedSchema } from "@/domain/schemas";
import { KIND_LABEL, SYSTEM_LABEL, type Kind, type System } from "@/domain/catalogs";
import { searchValueOf } from "@/domain/normalize";
import { describeInterval, fromDbDate, overlaps, toDbDate, type Interval } from "@/domain/vigencia";
import { recordAudit } from "./audit";
import { adminTransaction } from "./tx";
import { DomainError, StaleVersionError } from "./errors";
import { resolveTarget } from "./common";
import { parseInput } from "./parse";

const withTargets = {
  group: { select: { name: true } },
  client: { select: { name: true } },
  implementation: { select: { name: true, client: { select: { name: true } } } },
} satisfies Prisma.ExternalIdentityInclude;

function targetName(row: {
  group: { name: string } | null;
  client: { name: string } | null;
  implementation: { name: string; client: { name: string } } | null;
}): string {
  if (row.group) return `Grupo «${row.group.name}»`;
  if (row.client) return `Cliente «${row.client.name}»`;
  if (row.implementation) return `implantación «${row.implementation.client.name} › ${row.implementation.name}»`;
  return "otro destino";
}

/** Rechaza una vigencia solapada con otra activa de la misma identidad, explicando cuál. */
async function assertNoConflict(
  tx: Prisma.TransactionClient,
  identity: { system: System; kind: Kind; searchValue: string; rawValue: string; interval: Interval },
  excludeId?: string,
) {
  const others = await tx.externalIdentity.findMany({
    where: {
      system: identity.system,
      kind: identity.kind,
      searchValue: identity.searchValue,
      isActive: true,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    include: withTargets,
  });
  const clash = others.find((o) =>
    overlaps(identity.interval, { from: fromDbDate(o.validFrom), to: fromDbDate(o.validTo) }),
  );
  if (clash) {
    const message =
      `«${identity.rawValue}» (${SYSTEM_LABEL[identity.system]}, ${KIND_LABEL[identity.kind].toLowerCase()}) ya está asignada a ` +
      `${targetName(clash)} con vigencia ${describeInterval({ from: fromDbDate(clash.validFrom), to: fromDbDate(clash.validTo) })}, ` +
      `que se solapa con la indicada. No se reasigna automáticamente: ajuste o cierre esa vigencia, o desactive esa equivalencia, y repita.`;
    throw new DomainError(message, { validFrom: "Vigencia solapada con otra asignación de la misma identidad." });
  }
}

export async function createIdentity(actorId: string, raw: unknown) {
  const input = parseInput(identitySchema, raw);
  const searchValue = searchValueOf(input.kind, input.rawValue);
  const rawValue = input.rawValue.trim();
  return adminTransaction(actorId, async (tx, actor) => {
    const target = await resolveTarget(tx, input.targetType, input.targetId, { requireActive: true });
    await assertNoConflict(tx, {
      system: input.system,
      kind: input.kind,
      searchValue,
      rawValue,
      interval: { from: input.validFrom, to: input.validTo },
    });
    const identity = await tx.externalIdentity.create({
      data: {
        system: input.system,
        kind: input.kind,
        rawValue,
        searchValue,
        validFrom: toDbDate(input.validFrom),
        validTo: toDbDate(input.validTo),
        note: input.note,
        ...target.fk,
      },
    });
    await recordAudit(tx, actor, {
      action: "CREATE",
      entityType: "ExternalIdentity",
      entityId: identity.id,
      groupId: target.groupId,
      clientId: target.clientId,
      summary: `Equivalencia ${SYSTEM_LABEL[input.system]} «${rawValue}» asignada a ${target.name}`,
      after: identity,
    });
    return identity;
  });
}

export async function updateIdentity(actorId: string, id: string, raw: unknown) {
  const input = parseInput(identityUpdateSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const before = await tx.externalIdentity.findUnique({ where: { id }, include: withTargets });
    if (!before) throw new DomainError("Equivalencia no encontrada.");
    const rawValue = input.rawValue.trim();
    const searchValue = searchValueOf(before.kind, rawValue);
    if (before.system === "ZENDESK" && before.kind === "ORG_ID" && !/^\d{1,30}$/.test(rawValue)) {
      throw new DomainError("Revise los campos marcados.", {
        rawValue: "El ID de organización Zendesk debe ser un número entero (solo dígitos).",
      });
    }
    if (before.isActive) {
      await assertNoConflict(
        tx,
        { system: before.system, kind: before.kind, searchValue, rawValue, interval: { from: input.validFrom, to: input.validTo } },
        id,
      );
    }
    const res = await tx.externalIdentity.updateMany({
      where: { id, version: input.expectedVersion },
      data: {
        rawValue,
        searchValue,
        validFrom: toDbDate(input.validFrom),
        validTo: toDbDate(input.validTo),
        note: input.note,
        version: { increment: 1 },
      },
    });
    if (res.count === 0) throw new StaleVersionError("La equivalencia");
    const after = await tx.externalIdentity.findUniqueOrThrow({ where: { id } });
    const ctx = await contextOf(tx, before);
    await recordAudit(tx, actor, {
      action: "UPDATE",
      entityType: "ExternalIdentity",
      entityId: id,
      ...ctx,
      summary: `Modificación de la equivalencia ${SYSTEM_LABEL[before.system]} «${after.rawValue}»`,
      before: stripTargets(before),
      after,
    });
    return after;
  });
}

export async function setIdentityActive(actorId: string, id: string, active: boolean, raw: unknown) {
  const { expectedVersion } = parseInput(versionedSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const before = await tx.externalIdentity.findUnique({ where: { id }, include: withTargets });
    if (!before) throw new DomainError("Equivalencia no encontrada.");
    if (active) {
      await resolveTarget(tx, targetTypeOf(before), targetIdOf(before), { requireActive: true });
      await assertNoConflict(
        tx,
        {
          system: before.system,
          kind: before.kind,
          searchValue: before.searchValue,
          rawValue: before.rawValue,
          interval: { from: fromDbDate(before.validFrom), to: fromDbDate(before.validTo) },
        },
        id,
      );
    }
    const res = await tx.externalIdentity.updateMany({
      where: { id, version: expectedVersion },
      data: { isActive: active, version: { increment: 1 } },
    });
    if (res.count === 0) throw new StaleVersionError("La equivalencia");
    const after = await tx.externalIdentity.findUniqueOrThrow({ where: { id } });
    const ctx = await contextOf(tx, before);
    await recordAudit(tx, actor, {
      action: active ? "REACTIVATE" : "DEACTIVATE",
      entityType: "ExternalIdentity",
      entityId: id,
      ...ctx,
      summary: `${active ? "Reactivación" : "Desactivación"} de la equivalencia ${SYSTEM_LABEL[before.system]} «${after.rawValue}»`,
      before: stripTargets(before),
      after,
    });
    return after;
  });
}

type Row = Prisma.ExternalIdentityGetPayload<{ include: typeof withTargets }>;

function targetTypeOf(r: Pick<Row, "groupId" | "clientId">) {
  return r.groupId ? "group" : r.clientId ? "client" : "implementation";
}
function targetIdOf(r: Pick<Row, "groupId" | "clientId" | "implementationId">) {
  return (r.groupId ?? r.clientId ?? r.implementationId) as string;
}
function stripTargets<T extends object>(row: T) {
  const { group, client, implementation, ...rest } = row as T & { group?: unknown; client?: unknown; implementation?: unknown };
  void group; void client; void implementation;
  return rest;
}

async function contextOf(
  tx: Prisma.TransactionClient,
  row: Pick<Row, "groupId" | "clientId" | "implementationId">,
): Promise<{ groupId: string | null; clientId: string | null }> {
  const t = await resolveTarget(tx, targetTypeOf(row), targetIdOf(row), { requireActive: false });
  return { groupId: t.groupId, clientId: t.clientId };
}
