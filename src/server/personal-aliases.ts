import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import {
  ALIAS_KIND_LABEL,
  PERSON_SYSTEM_LABEL,
  aliasSchema,
  aliasSearchValue,
  aliasUpdateSchema,
  personVersionSchema,
  type AliasKind,
  type PersonSystem,
} from "@/domain/personal";
import { contains, describeInterval, fromDbDate, isIsoDate, overlaps, toDbDate, type Interval } from "@/domain/vigencia";
import { isDigits } from "@/domain/normalize";
import { authorize } from "./authorize";
import { recordAudit } from "./audit";
import { adminTransaction } from "./tx";
import { DomainError, StaleVersionError } from "./errors";
import { parseInput } from "./parse";

/** Rechaza una vigencia solapada con otro alias activo idéntico, de esta u otra persona, explicando cuál. */
async function assertNoConflict(
  tx: Prisma.TransactionClient,
  alias: { system: PersonSystem; kind: AliasKind; searchValue: string; rawValue: string; interval: Interval; personId: string },
  excludeId?: string,
) {
  const others = await tx.personAlias.findMany({
    where: {
      system: alias.system,
      kind: alias.kind,
      searchValue: alias.searchValue,
      isActive: true,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    include: { person: { select: { name: true } } },
  });
  const clash = others.find((o) => overlaps(alias.interval, { from: fromDbDate(o.validFrom), to: fromDbDate(o.validTo) }));
  if (clash) {
    const who = clash.personId === alias.personId ? "esta misma persona" : `la persona «${clash.person.name}»`;
    throw new DomainError(
      `«${alias.rawValue}» (${PERSON_SYSTEM_LABEL[alias.system]}, ${ALIAS_KIND_LABEL[alias.kind].toLowerCase()}) ya pertenece a ${who} con vigencia ` +
        `${describeInterval({ from: fromDbDate(clash.validFrom), to: fromDbDate(clash.validTo) })}, que se solapa con la indicada. ` +
        `No se reasigna ni se fusionan personas automáticamente: ajuste o cierre esa vigencia, o desactive ese alias, y repita.`,
      { validFrom: "Vigencia solapada con otra asignación del mismo alias." },
    );
  }
}

export async function addAlias(actorId: string, personId: string, raw: unknown) {
  const input = parseInput(aliasSchema, raw);
  const rawValue = input.rawValue.trim();
  const searchValue = aliasSearchValue(input.kind, rawValue);
  return adminTransaction(actorId, async (tx, actor) => {
    const person = await tx.person.findUnique({ where: { id: personId } });
    if (!person) throw new DomainError("Persona no encontrada.");
    if (!person.isActive) throw new DomainError(`La persona «${person.name}» está inactiva: no admite nuevos alias hasta reactivarla.`);
    await assertNoConflict(tx, { system: input.system, kind: input.kind, searchValue, rawValue, personId, interval: { from: input.validFrom, to: input.validTo } });
    const alias = await tx.personAlias.create({
      data: {
        personId,
        system: input.system,
        kind: input.kind,
        rawValue,
        searchValue,
        validFrom: toDbDate(input.validFrom),
        validTo: toDbDate(input.validTo),
        note: input.note,
      },
    });
    await recordAudit(tx, actor, {
      action: "CREATE",
      entityType: "PersonAlias",
      entityId: alias.id,
      personId,
      summary: `Alias ${PERSON_SYSTEM_LABEL[input.system]} (${ALIAS_KIND_LABEL[input.kind].toLowerCase()}) «${rawValue}» asignado a «${person.name}»`,
      after: alias,
    });
    return alias;
  });
}

export async function updateAlias(actorId: string, id: string, raw: unknown) {
  const input = parseInput(aliasUpdateSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const before = await tx.personAlias.findUnique({ where: { id } });
    if (!before) throw new DomainError("Alias no encontrado.");
    const rawValue = input.rawValue.trim();
    if (before.system === "ZENDESK" && before.kind === "ID" && !isDigits(rawValue)) {
      throw new DomainError("Revise los campos marcados.", { rawValue: "El ID de Zendesk debe ser un número entero (solo dígitos)." });
    }
    const searchValue = aliasSearchValue(before.kind, rawValue);
    if (before.isActive) {
      await assertNoConflict(
        tx,
        { system: before.system, kind: before.kind, searchValue, rawValue, personId: before.personId, interval: { from: input.validFrom, to: input.validTo } },
        id,
      );
    }
    const res = await tx.personAlias.updateMany({
      where: { id, version: input.expectedVersion },
      data: { rawValue, searchValue, validFrom: toDbDate(input.validFrom), validTo: toDbDate(input.validTo), note: input.note, version: { increment: 1 } },
    });
    if (res.count === 0) throw new StaleVersionError("El alias");
    const after = await tx.personAlias.findUniqueOrThrow({ where: { id } });
    await recordAudit(tx, actor, {
      action: "UPDATE",
      entityType: "PersonAlias",
      entityId: id,
      personId: before.personId,
      summary: `Modificación del alias ${PERSON_SYSTEM_LABEL[before.system]} «${after.rawValue}»`,
      before,
      after,
    });
    return after;
  });
}

export async function setAliasActive(actorId: string, id: string, active: boolean, raw: unknown) {
  const { expectedVersion } = parseInput(personVersionSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const before = await tx.personAlias.findUnique({ where: { id } });
    if (!before) throw new DomainError("Alias no encontrado.");
    if (active) {
      await assertNoConflict(
        tx,
        {
          system: before.system,
          kind: before.kind,
          searchValue: before.searchValue,
          rawValue: before.rawValue,
          personId: before.personId,
          interval: { from: fromDbDate(before.validFrom), to: fromDbDate(before.validTo) },
        },
        id,
      );
    }
    const res = await tx.personAlias.updateMany({ where: { id, version: expectedVersion }, data: { isActive: active, version: { increment: 1 } } });
    if (res.count === 0) throw new StaleVersionError("El alias");
    const after = await tx.personAlias.findUniqueOrThrow({ where: { id } });
    await recordAudit(tx, actor, {
      action: active ? "REACTIVATE" : "DEACTIVATE",
      entityType: "PersonAlias",
      entityId: id,
      personId: before.personId,
      summary: `${active ? "Reactivación" : "Desactivación"} del alias ${PERSON_SYSTEM_LABEL[before.system]} «${after.rawValue}»`,
      before,
      after,
    });
    return after;
  });
}

/**
 * Localiza la persona a la que pertenece un alias/ID/correo en una fecha. Solo coincidencia exacta
 * normalizada con un alias activo y vigente: nunca por similitud ni coincidencia parcial. Preparado
 * para que CSAPP-03 atribuya registros; no concede permisos ni crea cuentas.
 */
export async function findPersonByAlias(
  actorId: string,
  query: { system: PersonSystem; kind: AliasKind; value: string; date: string },
): Promise<{ personId: string; name: string; isActive: boolean; aliasId: string } | null> {
  await authorize(prisma, actorId, "READ");
  if (!isIsoDate(query.date)) throw new DomainError("Fecha no válida (AAAA-MM-DD).");
  const searchValue = aliasSearchValue(query.kind, query.value);
  if (!searchValue) return null;
  const rows = await prisma.personAlias.findMany({
    where: { system: query.system, kind: query.kind, searchValue, isActive: true },
    include: { person: { select: { name: true, isActive: true } } },
  });
  const hit = rows.find((r) => contains({ from: fromDbDate(r.validFrom), to: fromDbDate(r.validTo) }, query.date));
  return hit ? { personId: hit.personId, name: hit.person.name, isActive: hit.person.isActive, aliasId: hit.id } : null;
}
