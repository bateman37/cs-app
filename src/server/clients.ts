import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { clientSchema, implementationSchema, versionedSchema } from "@/domain/schemas";
import { authorize } from "./authorize";
import { recordAudit } from "./audit";
import { adminTransaction } from "./tx";
import { DomainError, StaleVersionError } from "./errors";
import { pageResult, paging, resolveTarget, statusWhere, type ListQuery } from "./common";
import { parseInput } from "./parse";

export type ClientListQuery = ListQuery & {
  groupId?: string; // "" = todos, "none" = sin grupo asignado
  internal?: "yes" | "no" | "";
  pendingZendesk?: boolean;
};

export async function listClients(actorId: string, query: ClientListQuery = {}) {
  await authorize(prisma, actorId, "READ");
  const q = (query.q ?? "").trim();
  const and: Prisma.ClientWhereInput[] = [statusWhere(query.status)];
  if (q) {
    and.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { group: { name: { contains: q, mode: "insensitive" } } },
        { identities: { some: { rawValue: { contains: q, mode: "insensitive" } } } },
        { implementations: { some: { name: { contains: q, mode: "insensitive" } } } },
      ],
    });
  }
  if (query.groupId === "none") and.push({ groupId: null });
  else if (query.groupId) and.push({ groupId: query.groupId });
  if (query.internal === "yes") and.push({ isInternal: true });
  if (query.internal === "no") and.push({ isInternal: false });
  if (query.pendingZendesk) {
    and.push({ NOT: { identities: { some: { system: "ZENDESK", kind: "ORG_ID", isActive: true } } } });
  }
  const dir = query.dir === "desc" ? "desc" : "asc";
  const orderBy: Prisma.ClientOrderByWithRelationInput =
    query.sort === "group"
      ? { group: { name: dir } }
      : query.sort === "updated"
        ? { updatedAt: dir }
        : { name: dir };
  const { page, pageSize, skip, take } = paging(query);
  const where: Prisma.ClientWhereInput = { AND: and };
  const [rows, total] = await Promise.all([
    prisma.client.findMany({
      where,
      orderBy: [orderBy, { id: "asc" }],
      skip,
      take,
      include: {
        group: { select: { id: true, name: true, isActive: true } },
        _count: { select: { implementations: true } },
        identities: { where: { system: "ZENDESK", kind: "ORG_ID", isActive: true }, select: { rawValue: true } },
      },
    }),
    prisma.client.count({ where }),
  ]);
  return pageResult(rows, total, page, pageSize);
}

export async function getClient(actorId: string, id: string) {
  const actor = await authorize(prisma, actorId, "READ");
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      group: true,
      implementations: { orderBy: [{ isActive: "desc" }, { name: "asc" }] },
      identities: {
        where: { OR: [{ clientId: id }, { implementation: { clientId: id } }] },
        orderBy: [{ isActive: "desc" }, { system: "asc" }, { rawValue: "asc" }],
        include: { implementation: { select: { id: true, name: true } } },
      },
      terms: {
        where: { OR: [{ clientId: id }, { implementation: { clientId: id } }] },
        orderBy: [{ attribute: "asc" }, { validFrom: { sort: "asc", nulls: "first" } }],
        include: { implementation: { select: { id: true, name: true } } },
      },
      milestones: {
        where: { OR: [{ clientId: id }, { implementation: { clientId: id } }] },
        orderBy: { date: "desc" },
        include: { implementation: { select: { id: true, name: true } } },
      },
    },
  });
  if (!client) return null;
  const groupTerms = client.groupId
    ? await prisma.serviceTerm.findMany({
        where: { groupId: client.groupId },
        orderBy: [{ attribute: "asc" }, { validFrom: { sort: "asc", nulls: "first" } }],
      })
    : [];
  return { ...client, groupTerms, canSeeHistory: actor.role === "ADMIN" };
}

async function assertAssignableGroup(tx: Prisma.TransactionClient, groupId: string | null, current: string | null) {
  if (!groupId) return;
  const group = await tx.clientGroup.findUnique({ where: { id: groupId } });
  if (!group) throw new DomainError("Grupo Cliente no encontrado.", { groupId: "Seleccione un grupo válido." });
  if (!group.isActive && groupId !== current) {
    throw new DomainError(`El grupo «${group.name}» está inactivo: no admite nuevas asignaciones.`, {
      groupId: "Este grupo está inactivo.",
    });
  }
}

export async function createClient(actorId: string, raw: unknown) {
  const input = parseInput(clientSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    await assertAssignableGroup(tx, input.groupId, null);
    const client = await tx.client.create({ data: input });
    await recordAudit(tx, actor, {
      action: "CREATE",
      entityType: "Client",
      entityId: client.id,
      groupId: client.groupId,
      clientId: client.id,
      summary: `Alta del Cliente «${client.name}»`,
      after: client,
    });
    return client;
  });
}

export async function updateClient(actorId: string, id: string, raw: unknown) {
  const input = parseInput(clientSchema.extend(versionedSchema.shape), raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const before = await tx.client.findUnique({ where: { id } });
    if (!before) throw new DomainError("Cliente no encontrado.");
    await assertAssignableGroup(tx, input.groupId, before.groupId);
    const { expectedVersion, ...data } = input;
    const res = await tx.client.updateMany({
      where: { id, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count === 0) throw new StaleVersionError("El Cliente");
    const after = await tx.client.findUniqueOrThrow({ where: { id } });
    const moved = before.groupId !== after.groupId;
    await recordAudit(tx, actor, {
      action: "UPDATE",
      entityType: "Client",
      entityId: id,
      groupId: after.groupId,
      clientId: id,
      summary: `Modificación del Cliente «${after.name}»${moved ? " (cambio de grupo)" : ""}`,
      before,
      after,
    });
    return after;
  });
}

export async function setClientActive(actorId: string, id: string, active: boolean, raw: unknown) {
  const { expectedVersion } = parseInput(versionedSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const before = await tx.client.findUnique({ where: { id } });
    if (!before) throw new DomainError("Cliente no encontrado.");
    const res = await tx.client.updateMany({
      where: { id, version: expectedVersion },
      data: { isActive: active, version: { increment: 1 } },
    });
    if (res.count === 0) throw new StaleVersionError("El Cliente");
    const after = await tx.client.findUniqueOrThrow({ where: { id } });
    await recordAudit(tx, actor, {
      action: active ? "REACTIVATE" : "DEACTIVATE",
      entityType: "Client",
      entityId: id,
      groupId: after.groupId,
      clientId: id,
      summary: `${active ? "Reactivación" : "Desactivación"} del Cliente «${after.name}»`,
      before,
      after,
    });
    return after;
  });
}

// ---------------------------------------------------------------- Implantaciones

export async function createImplementation(actorId: string, clientId: string, raw: unknown) {
  const input = parseInput(implementationSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const target = await resolveTarget(tx, "client", clientId, { requireActive: true });
    const impl = await tx.implementation.create({ data: { ...input, clientId } });
    await recordAudit(tx, actor, {
      action: "CREATE",
      entityType: "Implementation",
      entityId: impl.id,
      groupId: target.groupId,
      clientId,
      summary: `Alta de la implantación «${impl.name}» del Cliente «${target.name}»`,
      after: impl,
    });
    return impl;
  });
}

export async function updateImplementation(actorId: string, id: string, raw: unknown) {
  const input = parseInput(implementationSchema.extend(versionedSchema.shape), raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const before = await tx.implementation.findUnique({ where: { id }, include: { client: true } });
    if (!before) throw new DomainError("Implantación no encontrada.");
    const { expectedVersion, ...data } = input;
    const res = await tx.implementation.updateMany({
      where: { id, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count === 0) throw new StaleVersionError("La implantación");
    const after = await tx.implementation.findUniqueOrThrow({ where: { id } });
    await recordAudit(tx, actor, {
      action: "UPDATE",
      entityType: "Implementation",
      entityId: id,
      groupId: before.client.groupId,
      clientId: before.clientId,
      summary: `Modificación de la implantación «${after.name}»`,
      before: { ...before, client: undefined },
      after,
    });
    return after;
  });
}

export async function setImplementationActive(actorId: string, id: string, active: boolean, raw: unknown) {
  const { expectedVersion } = parseInput(versionedSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const before = await tx.implementation.findUnique({ where: { id }, include: { client: true } });
    if (!before) throw new DomainError("Implantación no encontrada.");
    const res = await tx.implementation.updateMany({
      where: { id, version: expectedVersion },
      data: { isActive: active, version: { increment: 1 } },
    });
    if (res.count === 0) throw new StaleVersionError("La implantación");
    const after = await tx.implementation.findUniqueOrThrow({ where: { id } });
    await recordAudit(tx, actor, {
      action: active ? "REACTIVATE" : "DEACTIVATE",
      entityType: "Implementation",
      entityId: id,
      groupId: before.client.groupId,
      clientId: before.clientId,
      summary: `${active ? "Reactivación" : "Desactivación"} de la implantación «${after.name}»`,
      before: { ...before, client: undefined },
      after,
    });
    return after;
  });
}
