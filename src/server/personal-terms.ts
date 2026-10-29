import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import {
  PERSON_ATTRIBUTE_LABEL,
  personTermChangeSchema,
  personTermPeriodSchema,
  personTermUpdateSchema,
  pmoTrueAt,
  resolveTermsAt,
  type PersonAttribute,
  type ResolvedPerson,
  type TermSnapshot,
} from "@/domain/personal";
import { contains, describeInterval, formatDate, fromDbDate, isIsoDate, overlaps, toDbDate, todayMadrid, type Interval } from "@/domain/vigencia";
import { authorize } from "./authorize";
import { recordAudit } from "./audit";
import { adminTransaction } from "./tx";
import { DomainError, StaleVersionError } from "./errors";
import { parseInput } from "./parse";
import type { Actor } from "@/lib/access";

type TermRow = Prisma.PersonTermGetPayload<{ include: { catalogItem: { select: { name: true } } } }>;

const interval = (r: { validFrom: Date | null; validTo: Date | null }): Interval => ({ from: fromDbDate(r.validFrom), to: fromDbDate(r.validTo) });
const show = (r: Pick<TermRow, "attribute" | "flag" | "catalogItem">) =>
  r.attribute === "PMO_MEMBER" ? (r.flag ? "Sí" : "No") : (r.catalogItem?.name ?? "—");
const sameValue = (r: Pick<TermRow, "flag" | "catalogItemId">, v: { flag: boolean | null; catalogItemId: string | null }) =>
  r.flag === v.flag && r.catalogItemId === v.catalogItemId;
const asSnapshot = (r: Pick<TermRow, "attribute" | "flag" | "validFrom" | "validTo">) => ({ attribute: r.attribute, flag: r.flag, validFrom: fromDbDate(r.validFrom), validTo: fromDbDate(r.validTo) });

async function loadPerson(tx: Prisma.TransactionClient, personId: string, requireActive: boolean) {
  const person = await tx.person.findUnique({ where: { id: personId } });
  if (!person) throw new DomainError("Persona no encontrada.");
  if (requireActive && !person.isActive) {
    throw new DomainError(`La persona «${person.name}» está inactiva: no admite nuevos datos hasta reactivarla.`);
  }
  return person;
}

/** Valor de entrada → fila: catálogo activo del tipo correcto (nunca inferido por nombre) o Sí/No. */
async function resolveValue(tx: Prisma.TransactionClient, attribute: PersonAttribute, value: string) {
  if (attribute === "PMO_MEMBER") return { flag: value === "true", catalogItemId: null as string | null };
  const item = await tx.staffCatalogItem.findUnique({ where: { id: value } });
  if (!item || item.kind !== attribute) {
    throw new DomainError("Revise los campos marcados.", { value: `Seleccione un valor del catálogo de ${PERSON_ATTRIBUTE_LABEL[attribute].toLowerCase()}.` });
  }
  if (!item.isActive) throw new DomainError(`El valor «${item.name}» está inactivo: no admite nuevas asignaciones.`, { value: "Valor de catálogo inactivo." });
  return { flag: null as boolean | null, catalogItemId: item.id };
}

const withCatalog = { catalogItem: { select: { name: true } } } satisfies Prisma.PersonTermInclude;

async function termRows(tx: Prisma.TransactionClient, personId: string, attribute: PersonAttribute) {
  return tx.personTerm.findMany({
    where: { personId, attribute },
    include: withCatalog,
    orderBy: { validFrom: { sort: "asc", nulls: "first" } },
  });
}

/** El rol PMO solo se registra si a su fecha de inicio pertenece a PMO. */
async function assertPmoForRole(tx: Prisma.TransactionClient, personId: string, from: string | null) {
  const all = await tx.personTerm.findMany({ where: { personId, attribute: "PMO_MEMBER" } });
  if (!pmoTrueAt(all.map(asSnapshot), from)) {
    throw new DomainError(
      from
        ? `La persona no pertenece a PMO el ${formatDate(from)}: indique primero la pertenencia a PMO y después el rol.`
        : "Indique primero la pertenencia a PMO (con inicio desconocido) y después el rol.",
      { value: "Indique primero la pertenencia a PMO." },
    );
  }
}

/** Al salir de PMO en la fecha D, el rol vigente ese día se cierra en D (se conserva en la historia). */
async function closeRoleOnLeavingPmo(tx: Prisma.TransactionClient, actor: Actor, person: { id: string; name: string }, D: string | null) {
  if (!D) return;
  const roles = await termRows(tx, person.id, "PMO_ROLE");
  const role = roles.find((r) => contains(interval(r), D) && (r.validFrom === null || (fromDbDate(r.validFrom) as string) < D));
  if (!role) return;
  const res = await tx.personTerm.updateMany({ where: { id: role.id, version: role.version }, data: { validTo: toDbDate(D), version: { increment: 1 } } });
  if (res.count === 0) throw new StaleVersionError("El rol PMO");
  const after = await tx.personTerm.findUniqueOrThrow({ where: { id: role.id } });
  await recordAudit(tx, actor, {
    action: "UPDATE",
    entityType: "PersonTerm",
    entityId: role.id,
    personId: person.id,
    summary: `Rol PMO de ${person.name}: se cierra «${show(role)}» el ${formatDate(D)} por salida de PMO`,
    before: role,
    after,
  });
}

/**
 * Cambio con fecha efectiva: conserva el valor anterior hasta esa fecha y aplica el nuevo desde ella
 * (hasta el siguiente tramo conocido, si lo hay). Misma mecánica que los datos de servicio de clientes.
 */
export async function changeTerm(actorId: string, personId: string, raw: unknown) {
  const input = parseInput(personTermChangeSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const person = await loadPerson(tx, personId, true);
    const value = await resolveValue(tx, input.attribute, input.value);
    const D = input.effectiveFrom;
    if (input.attribute === "PMO_ROLE") await assertPmoForRole(tx, personId, D);
    const rows = await termRows(tx, personId, input.attribute);
    const label = PERSON_ATTRIBUTE_LABEL[input.attribute];
    let newTo: string | null = null;
    let closing: TermRow | undefined;

    if (D === null) {
      if (rows.length > 0) {
        throw new DomainError("Este dato ya tiene tramos registrados: indique una fecha efectiva.", { effectiveFrom: "Indique la fecha efectiva del cambio." });
      }
    } else {
      if (rows.some((r) => fromDbDate(r.validFrom) === D)) {
        throw new DomainError(`Ya existe un tramo de ${label.toLowerCase()} que empieza el ${formatDate(D)}. Edítelo en lugar de crear otro.`, {
          effectiveFrom: "Ya hay un tramo con esa fecha de inicio.",
        });
      }
      closing = rows.find((r) => contains(interval(r), D));
      if (closing && sameValue(closing, value)) {
        throw new DomainError(`El valor ya es «${show(closing)}» en esa fecha (tramo ${describeInterval(interval(closing))}); no hay nada que cambiar.`, {
          value: "Es el mismo valor que ya está vigente en esa fecha.",
        });
      }
      const next = rows.find((r) => r.validFrom !== null && (fromDbDate(r.validFrom) as string) > D);
      newTo = closing ? fromDbDate(closing.validTo) : next ? fromDbDate(next.validFrom) : null;
    }

    let closedAfter: unknown;
    if (closing && D) {
      const res = await tx.personTerm.updateMany({ where: { id: closing.id, version: closing.version }, data: { validTo: toDbDate(D), version: { increment: 1 } } });
      if (res.count === 0) throw new StaleVersionError("El dato de la persona");
      closedAfter = await tx.personTerm.findUniqueOrThrow({ where: { id: closing.id } });
    }
    const created = await tx.personTerm.create({
      data: { personId, attribute: input.attribute, ...value, validFrom: toDbDate(D), validTo: toDbDate(newTo), note: input.note },
    });
    const retro = D !== null && D < todayMadrid();
    if (closing && closedAfter) {
      await recordAudit(tx, actor, {
        action: "UPDATE",
        entityType: "PersonTerm",
        entityId: closing.id,
        personId,
        summary: `${label} de ${person.name}: se cierra el tramo «${show(closing)}» el ${formatDate(D)}`,
        before: closing,
        after: closedAfter,
      });
    }
    const createdView = { ...created, catalogItem: value.catalogItemId ? { name: (await tx.staffCatalogItem.findUniqueOrThrow({ where: { id: value.catalogItemId } })).name } : null };
    await recordAudit(tx, actor, {
      action: "CREATE",
      entityType: "PersonTerm",
      entityId: created.id,
      personId,
      summary: `${label} de ${person.name}: «${show(createdView)}» ` + (D ? `desde ${formatDate(D)}` : "(fecha de inicio desconocida)") + (retro ? " — cambio retroactivo" : ""),
      after: created,
    });
    if (input.attribute === "PMO_MEMBER" && value.flag === false) await closeRoleOnLeavingPmo(tx, actor, person, D);
    return created;
  });
}

/** Alta de un tramo histórico explícito. */
export async function addTermPeriod(actorId: string, personId: string, raw: unknown) {
  const input = parseInput(personTermPeriodSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const person = await loadPerson(tx, personId, true);
    const value = await resolveValue(tx, input.attribute, input.value);
    if (input.attribute === "PMO_ROLE") await assertPmoForRole(tx, personId, input.validFrom);
    const rows = await termRows(tx, personId, input.attribute);
    const mine: Interval = { from: input.validFrom, to: input.validTo };
    const clash = rows.find((r) => overlaps(mine, interval(r)));
    if (clash) {
      throw new DomainError(
        `El tramo se solapa con «${show(clash)}» (${describeInterval(interval(clash))}). Ajuste ese tramo o use «cambio con fecha efectiva».`,
        { validFrom: "Vigencia solapada con otro tramo." },
      );
    }
    const created = await tx.personTerm.create({
      data: { personId, attribute: input.attribute, ...value, validFrom: toDbDate(input.validFrom), validTo: toDbDate(input.validTo), note: input.note },
    });
    const name = value.catalogItemId ? (await tx.staffCatalogItem.findUniqueOrThrow({ where: { id: value.catalogItemId } })).name : null;
    await recordAudit(tx, actor, {
      action: "CREATE",
      entityType: "PersonTerm",
      entityId: created.id,
      personId,
      summary: `${PERSON_ATTRIBUTE_LABEL[input.attribute]} de ${person.name}: tramo histórico «${show({ ...created, catalogItem: name ? { name } : null })}» (${describeInterval(mine)})`,
      after: created,
    });
    if (input.attribute === "PMO_MEMBER" && value.flag === false) await closeRoleOnLeavingPmo(tx, actor, person, input.validFrom);
    return created;
  });
}

/** Corrección de un tramo existente (valor, fechas o nota). */
export async function updateTerm(actorId: string, id: string, raw: unknown) {
  const input = parseInput(personTermUpdateSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const before = await tx.personTerm.findUnique({ where: { id }, include: withCatalog });
    if (!before) throw new DomainError("Tramo no encontrado.");
    const person = await loadPerson(tx, before.personId, false);
    if (before.attribute === "PMO_MEMBER" && input.value !== "true" && input.value !== "false") {
      throw new DomainError("Revise los campos marcados.", { value: "Indique Sí o No." });
    }
    const value = await resolveValue(tx, before.attribute, input.value);
    if (before.attribute === "PMO_ROLE") await assertPmoForRole(tx, before.personId, input.validFrom);
    const rows = (await termRows(tx, before.personId, before.attribute)).filter((r) => r.id !== id);
    const mine: Interval = { from: input.validFrom, to: input.validTo };
    const clash = rows.find((r) => overlaps(mine, interval(r)));
    if (clash) {
      throw new DomainError(`Las fechas se solapan con «${show(clash)}» (${describeInterval(interval(clash))}).`, { validFrom: "Vigencia solapada con otro tramo." });
    }
    const res = await tx.personTerm.updateMany({
      where: { id, version: input.expectedVersion },
      data: { ...value, validFrom: toDbDate(input.validFrom), validTo: toDbDate(input.validTo), note: input.note, version: { increment: 1 } },
    });
    if (res.count === 0) throw new StaleVersionError("El tramo");
    const after = await tx.personTerm.findUniqueOrThrow({ where: { id } });
    await recordAudit(tx, actor, {
      action: "UPDATE",
      entityType: "PersonTerm",
      entityId: id,
      personId: before.personId,
      summary: `${PERSON_ATTRIBUTE_LABEL[before.attribute]} de ${person.name}: corrección de tramo (${describeInterval(mine)})`,
      before,
      after,
    });
    if (before.attribute === "PMO_MEMBER" && value.flag === false) await closeRoleOnLeavingPmo(tx, actor, person, input.validFrom);
    return after;
  });
}

/**
 * Nivel, equipo, pertenencia a PMO y rol de una persona en una fecha (AAAA-MM-DD). El rol PMO solo se
 * devuelve si pertenece a PMO. Preparado para atribuir trabajo en CSAPP-03; no selecciona horas.
 */
export async function resolvePersonAt(actorId: string, personId: string, date: string): Promise<ResolvedPerson> {
  await authorize(prisma, actorId, "READ");
  if (!isIsoDate(date)) throw new DomainError("Fecha no válida (AAAA-MM-DD).");
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { id: true } });
  if (!person) throw new DomainError("Persona no encontrada.");
  const rows = await prisma.personTerm.findMany({ where: { personId }, include: withCatalog });
  const snaps: TermSnapshot[] = rows.map((r) => ({
    attribute: r.attribute,
    catalogItemId: r.catalogItemId,
    catalogName: r.catalogItem?.name ?? null,
    flag: r.flag,
    validFrom: fromDbDate(r.validFrom),
    validTo: fromDbDate(r.validTo),
  }));
  return resolveTermsAt(snaps, date);
}
