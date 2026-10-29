import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { groupSchema, versionedSchema } from "@/domain/schemas";
import { authorize } from "./authorize";
import { recordAudit } from "./audit";
import { adminTransaction } from "./tx";
import { DomainError, StaleVersionError } from "./errors";
import { pageResult, paging, statusWhere, type ListQuery } from "./common";
import { parseInput } from "./parse";

export async function listGroups(actorId: string, query: ListQuery = {}) {
  await authorize(prisma, actorId, "READ");
  const q = (query.q ?? "").trim();
  const where: Prisma.ClientGroupWhereInput = {
    ...statusWhere(query.status),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { bcDenomination: { contains: q, mode: "insensitive" } },
            { identities: { some: { rawValue: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const dir = query.dir === "desc" ? "desc" : "asc";
  const orderBy: Prisma.ClientGroupOrderByWithRelationInput =
    query.sort === "clients"
      ? { clients: { _count: dir } }
      : query.sort === "updated"
        ? { updatedAt: dir }
        : { name: dir };
  const { page, pageSize, skip, take } = paging(query);
  const [rows, total] = await Promise.all([
    prisma.clientGroup.findMany({
      where,
      orderBy: [orderBy, { id: "asc" }],
      skip,
      take,
      include: { _count: { select: { clients: true } } },
    }),
    prisma.clientGroup.count({ where }),
  ]);
  return pageResult(rows, total, page, pageSize);
}

/** Grupos activos que se ofrecen como destino de una asignación. */
export async function listAssignableGroups(actorId: string, includeId?: string | null) {
  await authorize(prisma, actorId, "READ");
  return prisma.clientGroup.findMany({
    where: { OR: [{ isActive: true }, ...(includeId ? [{ id: includeId }] : [])] },
    orderBy: { name: "asc" },
    select: { id: true, name: true, isActive: true },
  });
}

export async function getGroup(actorId: string, id: string) {
  await authorize(prisma, actorId, "READ");
  return prisma.clientGroup.findUnique({
    where: { id },
    include: {
      clients: { orderBy: { name: "asc" }, include: { _count: { select: { implementations: true } } } },
      identities: { orderBy: [{ isActive: "desc" }, { rawValue: "asc" }] },
      terms: { orderBy: [{ attribute: "asc" }, { validFrom: { sort: "asc", nulls: "first" } }] },
      milestones: { orderBy: { date: "desc" } },
    },
  });
}

export async function createGroup(actorId: string, raw: unknown) {
  const input = parseInput(groupSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const group = await tx.clientGroup.create({ data: input });
    await recordAudit(tx, actor, {
      action: "CREATE",
      entityType: "ClientGroup",
      entityId: group.id,
      groupId: group.id,
      summary: `Alta del Grupo Cliente «${group.name}»`,
      after: group,
    });
    return group;
  });
}

export async function updateGroup(actorId: string, id: string, raw: unknown) {
  const input = parseInput(groupSchema.extend(versionedSchema.shape), raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const before = await tx.clientGroup.findUnique({ where: { id } });
    if (!before) throw new DomainError("Grupo Cliente no encontrado.");
    const { expectedVersion, ...data } = input;
    const res = await tx.clientGroup.updateMany({
      where: { id, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count === 0) throw new StaleVersionError("El Grupo Cliente");
    const after = await tx.clientGroup.findUniqueOrThrow({ where: { id } });
    await recordAudit(tx, actor, {
      action: "UPDATE",
      entityType: "ClientGroup",
      entityId: id,
      groupId: id,
      summary: `Modificación del Grupo Cliente «${after.name}»`,
      before,
      after,
    });
    return after;
  });
}

export async function setGroupActive(actorId: string, id: string, active: boolean, raw: unknown) {
  const { expectedVersion } = parseInput(versionedSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const before = await tx.clientGroup.findUnique({ where: { id } });
    if (!before) throw new DomainError("Grupo Cliente no encontrado.");
    const res = await tx.clientGroup.updateMany({
      where: { id, version: expectedVersion },
      data: { isActive: active, version: { increment: 1 } },
    });
    if (res.count === 0) throw new StaleVersionError("El Grupo Cliente");
    const after = await tx.clientGroup.findUniqueOrThrow({ where: { id } });
    await recordAudit(tx, actor, {
      action: active ? "REACTIVATE" : "DEACTIVATE",
      entityType: "ClientGroup",
      entityId: id,
      groupId: id,
      summary: `${active ? "Reactivación" : "Desactivación"} del Grupo Cliente «${after.name}»`,
      before,
      after,
    });
    return after;
  });
}
