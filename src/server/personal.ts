import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { catalogItemSchema, personSchema, personUpdateSchema, personVersionSchema, type CatalogKind } from "@/domain/personal";
import { isIsoDate, todayMadrid, toDbDate } from "@/domain/vigencia";
import { authorize } from "./authorize";
import { recordAudit } from "./audit";
import { adminTransaction } from "./tx";
import { DomainError, StaleVersionError } from "./errors";
import { pageResult, paging } from "./common";
import { parseInput } from "./parse";

export type PersonListQuery = {
  q?: string;
  status?: "active" | "inactive" | "all";
  /** Equipo (id del catálogo) vigente en la fecha. */
  teamId?: string;
  /** Pertenencia a PMO vigente en la fecha. */
  pmo?: "yes" | "no" | "unknown" | "all";
  /** Fecha de resolución de equipo y PMO (AAAA-MM-DD); por defecto hoy en Europe/Madrid. */
  date?: string;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

/** Condición «el tramo contiene la fecha» con la convención [desde, hasta). */
function validAt(date: string): Prisma.PersonTermWhereInput {
  const d = toDbDate(date) as Date;
  return {
    AND: [{ OR: [{ validFrom: null }, { validFrom: { lte: d } }] }, { OR: [{ validTo: null }, { validTo: { gt: d } }] }],
  };
}

export async function listPeople(actorId: string, query: PersonListQuery = {}) {
  await authorize(prisma, actorId, "READ");
  const date = query.date && isIsoDate(query.date) ? query.date : todayMadrid();
  const q = (query.q ?? "").trim();
  const and: Prisma.PersonWhereInput[] = [];
  if (query.status === "inactive") and.push({ isActive: false });
  else if (query.status !== "all") and.push({ isActive: true });
  if (q) {
    and.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { aliases: { some: { OR: [{ rawValue: { contains: q, mode: "insensitive" } }, { searchValue: { contains: q.toLowerCase() } }] } } },
      ],
    });
  }
  if (query.teamId) and.push({ terms: { some: { attribute: "TEAM", catalogItemId: query.teamId, ...validAt(date) } } });
  if (query.pmo === "yes") and.push({ terms: { some: { attribute: "PMO_MEMBER", flag: true, ...validAt(date) } } });
  else if (query.pmo === "no") and.push({ terms: { some: { attribute: "PMO_MEMBER", flag: false, ...validAt(date) } } });
  else if (query.pmo === "unknown") and.push({ NOT: { terms: { some: { attribute: "PMO_MEMBER", ...validAt(date) } } } });
  const where: Prisma.PersonWhereInput = { AND: and };
  const dir = query.dir === "desc" ? "desc" : "asc";
  const orderBy: Prisma.PersonOrderByWithRelationInput = query.sort === "updated" ? { updatedAt: dir } : { name: dir };
  const { page, pageSize, skip, take } = paging(query);
  const [rows, total] = await Promise.all([
    prisma.person.findMany({
      where,
      orderBy: [orderBy, { id: "asc" }],
      skip,
      take,
      include: {
        terms: { where: validAt(date), include: { catalogItem: { select: { name: true } } } },
        _count: { select: { aliases: true } },
      },
    }),
    prisma.person.count({ where }),
  ]);
  return { ...pageResult(rows, total, page, pageSize), date };
}

export async function getPerson(actorId: string, id: string) {
  await authorize(prisma, actorId, "READ");
  return prisma.person.findUnique({
    where: { id },
    include: {
      aliases: { orderBy: [{ system: "asc" }, { kind: "asc" }, { isActive: "desc" }, { validFrom: { sort: "asc", nulls: "first" } }] },
      terms: {
        orderBy: [{ attribute: "asc" }, { validFrom: { sort: "asc", nulls: "first" } }],
        include: { catalogItem: { select: { id: true, name: true, isActive: true } } },
      },
    },
  });
}

export async function createPerson(actorId: string, raw: unknown) {
  const input = parseInput(personSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const person = await tx.person.create({ data: input });
    await recordAudit(tx, actor, {
      action: "CREATE",
      entityType: "Person",
      entityId: person.id,
      personId: person.id,
      summary: `Alta de la persona «${person.name}»`,
      after: person,
    });
    return person;
  });
}

export async function updatePerson(actorId: string, id: string, raw: unknown) {
  const input = parseInput(personUpdateSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const before = await tx.person.findUnique({ where: { id } });
    if (!before) throw new DomainError("Persona no encontrada.");
    const res = await tx.person.updateMany({
      where: { id, version: input.expectedVersion },
      data: { name: input.name, note: input.note, version: { increment: 1 } },
    });
    if (res.count === 0) throw new StaleVersionError("La persona");
    const after = await tx.person.findUniqueOrThrow({ where: { id } });
    await recordAudit(tx, actor, {
      action: "UPDATE",
      entityType: "Person",
      entityId: id,
      personId: id,
      summary: `Modificación de la persona «${after.name}»`,
      before,
      after,
    });
    return after;
  });
}

/** Desactiva o reactiva; nunca borra: se conservan alias, vigencias e historial. */
export async function setPersonActive(actorId: string, id: string, active: boolean, raw: unknown) {
  const { expectedVersion } = parseInput(personVersionSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const before = await tx.person.findUnique({ where: { id } });
    if (!before) throw new DomainError("Persona no encontrada.");
    const res = await tx.person.updateMany({ where: { id, version: expectedVersion }, data: { isActive: active, version: { increment: 1 } } });
    if (res.count === 0) throw new StaleVersionError("La persona");
    const after = await tx.person.findUniqueOrThrow({ where: { id } });
    await recordAudit(tx, actor, {
      action: active ? "REACTIVATE" : "DEACTIVATE",
      entityType: "Person",
      entityId: id,
      personId: id,
      summary: `${active ? "Reactivación" : "Desactivación"} de la persona «${after.name}»`,
      before,
      after,
    });
    return after;
  });
}

/** Historial administrativo de una persona (solo administradores), paginado. */
export async function listPersonHistory(actorId: string, personId: string, query: { page?: number; pageSize?: number } = {}) {
  await authorize(prisma, actorId, "ADMIN");
  const { page, pageSize, skip, take } = paging({ pageSize: 15, ...query });
  const [rows, total] = await Promise.all([
    prisma.auditEvent.findMany({ where: { personId }, orderBy: [{ at: "desc" }, { id: "desc" }], skip, take }),
    prisma.auditEvent.count({ where: { personId } }),
  ]);
  return pageResult(rows, total, page, pageSize);
}

// ---------------------------------------------------------------- Catálogo mínimo (nivel, equipo, rol PMO)

export async function listCatalog(actorId: string, kind?: CatalogKind, opts: { onlyActive?: boolean } = {}) {
  await authorize(prisma, actorId, "READ");
  return prisma.staffCatalogItem.findMany({
    where: { ...(kind ? { kind } : {}), ...(opts.onlyActive ? { isActive: true } : {}) },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    include: { _count: { select: { terms: true } } },
  });
}

export async function createCatalogItem(actorId: string, raw: unknown) {
  const input = parseInput(catalogItemSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const item = await tx.staffCatalogItem.create({ data: input });
    await recordAudit(tx, actor, {
      action: "CREATE",
      entityType: "StaffCatalogItem",
      entityId: item.id,
      summary: `Alta en el catálogo ${input.kind === "LEVEL" ? "de niveles" : input.kind === "TEAM" ? "de equipos" : "de roles PMO"}: «${item.name}»`,
      after: item,
    });
    return item;
  });
}

/** Desactivar un valor impide nuevas asignaciones; las vigencias existentes se conservan. No hay borrado. */
export async function setCatalogItemActive(actorId: string, id: string, active: boolean, raw: unknown) {
  const { expectedVersion } = parseInput(personVersionSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const before = await tx.staffCatalogItem.findUnique({ where: { id } });
    if (!before) throw new DomainError("Valor de catálogo no encontrado.");
    const res = await tx.staffCatalogItem.updateMany({ where: { id, version: expectedVersion }, data: { isActive: active, version: { increment: 1 } } });
    if (res.count === 0) throw new StaleVersionError("El valor del catálogo");
    const after = await tx.staffCatalogItem.findUniqueOrThrow({ where: { id } });
    await recordAudit(tx, actor, {
      action: active ? "REACTIVATE" : "DEACTIVATE",
      entityType: "StaffCatalogItem",
      entityId: id,
      summary: `${active ? "Reactivación" : "Desactivación"} del valor de catálogo «${after.name}»`,
      before,
      after,
    });
    return after;
  });
}
