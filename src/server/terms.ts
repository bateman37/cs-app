import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { termChangeSchema, termPeriodSchema, termUpdateSchema } from "@/domain/schemas";
import { ATTRIBUTE_LABEL, VALUE_LABEL, type Attribute } from "@/domain/catalogs";
import {
  contains,
  describeInterval,
  formatDate,
  fromDbDate,
  overlaps,
  pickAt,
  toDbDate,
  todayMadrid,
  type Interval,
} from "@/domain/vigencia";
import { recordAudit } from "./audit";
import { adminTransaction } from "./tx";
import { DomainError, StaleVersionError } from "./errors";
import { resolveTarget, type ResolvedTarget } from "./common";
import { parseInput } from "./parse";

const label = (attr: Attribute, value: string) => `${ATTRIBUTE_LABEL[attr]} ${VALUE_LABEL[value] ?? value}`;
const interval = (r: { validFrom: Date | null; validTo: Date | null }): Interval => ({
  from: fromDbDate(r.validFrom),
  to: fromDbDate(r.validTo),
});

async function assertProduct(tx: Prisma.TransactionClient, value: string): Promise<string> {
  const p = await tx.product.findFirst({ where: { name: { equals: value, mode: "insensitive" } } });
  if (!p) throw new DomainError("El producto no está en el catálogo.", { value: "Seleccione un producto del catálogo." });
  if (!p.isActive) throw new DomainError(`El producto «${p.name}» está inactivo: no admite nuevas asignaciones.`, { value: "Producto inactivo." });
  return p.name;
}

async function termRows(tx: Prisma.TransactionClient, attribute: Attribute, target: ResolvedTarget) {
  return tx.serviceTerm.findMany({
    where: { attribute, ...target.fk },
    orderBy: { validFrom: { sort: "asc", nulls: "first" } },
  });
}

/**
 * Cambio con fecha efectiva. Conserva el valor anterior hasta esa fecha y aplica el nuevo
 * desde ella (hasta el siguiente tramo conocido, si lo hay). Si la fecha es anterior a hoy
 * se anota como cambio retroactivo en la auditoría.
 */
export async function changeTerm(actorId: string, raw: unknown) {
  const input = parseInput(termChangeSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const target = await resolveTarget(tx, input.targetType, input.targetId, { requireActive: true });
    const value = input.attribute === "PRODUCT" ? await assertProduct(tx, input.value) : input.value;
    const rows = await termRows(tx, input.attribute, target);
    const D = input.effectiveFrom;
    let newTo: string | null = null;
    let closing: (typeof rows)[number] | undefined;

    if (D === null) {
      if (rows.length > 0) {
        throw new DomainError("Este dato ya tiene tramos registrados: indique una fecha efectiva.", {
          effectiveFrom: "Indique la fecha efectiva del cambio.",
        });
      }
    } else {
      if (rows.some((r) => fromDbDate(r.validFrom) === D)) {
        throw new DomainError(
          `Ya existe un tramo de ${ATTRIBUTE_LABEL[input.attribute].toLowerCase()} que empieza el ${formatDate(D)}. Edítelo en lugar de crear otro.`,
          { effectiveFrom: "Ya hay un tramo con esa fecha de inicio." },
        );
      }
      closing = rows.find((r) => contains(interval(r), D));
      if (closing && closing.value === value) {
        throw new DomainError(
          `El valor ya es ${VALUE_LABEL[value] ?? value} en esa fecha (tramo ${describeInterval(interval(closing))}); no hay nada que cambiar.`,
          { value: "Es el mismo valor que ya está vigente en esa fecha." },
        );
      }
      const next = rows.find((r) => r.validFrom !== null && (fromDbDate(r.validFrom) as string) > D);
      newTo = closing ? fromDbDate(closing.validTo) : next ? fromDbDate(next.validFrom) : null;
    }

    let closedBefore: unknown;
    let closedAfter: unknown;
    if (closing && D) {
      const res = await tx.serviceTerm.updateMany({
        where: { id: closing.id, version: closing.version },
        data: { validTo: toDbDate(D), version: { increment: 1 } },
      });
      if (res.count === 0) throw new StaleVersionError("El dato de servicio");
      closedBefore = closing;
      closedAfter = await tx.serviceTerm.findUniqueOrThrow({ where: { id: closing.id } });
    }
    const created = await tx.serviceTerm.create({
      data: {
        attribute: input.attribute,
        value,
        validFrom: toDbDate(D),
        validTo: toDbDate(newTo),
        note: input.note,
        ...target.fk,
      },
    });
    const retro = D !== null && D < todayMadrid();
    if (closing && closedAfter) {
      await recordAudit(tx, actor, {
        action: "UPDATE",
        entityType: "ServiceTerm",
        entityId: closing.id,
        groupId: target.groupId,
        clientId: target.clientId,
        summary: `${ATTRIBUTE_LABEL[input.attribute]} de ${target.name}: se cierra el tramo ${label(input.attribute, closing.value)} el ${formatDate(D)}`,
        before: closedBefore,
        after: closedAfter,
      });
    }
    await recordAudit(tx, actor, {
      action: "CREATE",
      entityType: "ServiceTerm",
      entityId: created.id,
      groupId: target.groupId,
      clientId: target.clientId,
      summary:
        `${ATTRIBUTE_LABEL[input.attribute]} de ${target.name}: ${VALUE_LABEL[value] ?? value} ` +
        (D ? `desde ${formatDate(D)}` : "(fecha de inicio desconocida)") +
        (retro ? " — cambio retroactivo" : ""),
      after: created,
    });
    return created;
  });
}

/** Alta de un tramo histórico explícito. */
export async function addTermPeriod(actorId: string, raw: unknown) {
  const input = parseInput(termPeriodSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const target = await resolveTarget(tx, input.targetType, input.targetId, { requireActive: true });
    const value = input.attribute === "PRODUCT" ? await assertProduct(tx, input.value) : input.value;
    const rows = await termRows(tx, input.attribute, target);
    const mine: Interval = { from: input.validFrom, to: input.validTo };
    const clash = rows.find((r) => overlaps(mine, interval(r)));
    if (clash) {
      throw new DomainError(
        `El tramo se solapa con ${label(input.attribute, clash.value)} (${describeInterval(interval(clash))}). Ajuste ese tramo o use «cambio con fecha efectiva».`,
        { validFrom: "Vigencia solapada con otro tramo." },
      );
    }
    const created = await tx.serviceTerm.create({
      data: {
        attribute: input.attribute,
        value,
        validFrom: toDbDate(input.validFrom),
        validTo: toDbDate(input.validTo),
        note: input.note,
        ...target.fk,
      },
    });
    await recordAudit(tx, actor, {
      action: "CREATE",
      entityType: "ServiceTerm",
      entityId: created.id,
      groupId: target.groupId,
      clientId: target.clientId,
      summary: `${ATTRIBUTE_LABEL[input.attribute]} de ${target.name}: tramo histórico ${VALUE_LABEL[value] ?? value} (${describeInterval(mine)})`,
      after: created,
    });
    return created;
  });
}

/** Corrección de un tramo existente (valor, fechas o nota). */
export async function updateTerm(actorId: string, id: string, raw: unknown) {
  const input = parseInput(termUpdateSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const before = await tx.serviceTerm.findUnique({ where: { id } });
    if (!before) throw new DomainError("Tramo no encontrado.");
    const type = before.groupId ? "group" : before.clientId ? "client" : "implementation";
    const target = await resolveTarget(tx, type, (before.groupId ?? before.clientId ?? before.implementationId) as string, {
      requireActive: false,
    });
    const value = before.attribute === "PRODUCT" ? await assertProduct(tx, input.value) : input.value;
    if (before.attribute !== "PRODUCT") {
      const ok = {
        SUPPORT: ["GOLD", "PLATINUM", "SILVER_ON_DEMAND", "SILVER_RECURRENTE"],
        HOSTING: ["CLOUD", "OP"],
        COMPLEXITY: ["BASIC", "MEDIUM", "ENTERPRISE"],
      }[before.attribute];
      if (!ok.includes(value)) throw new DomainError("Revise los campos marcados.", { value: "Valor no válido para este dato." });
    }
    const rows = (await termRows(tx, before.attribute, target)).filter((r) => r.id !== id);
    const mine: Interval = { from: input.validFrom, to: input.validTo };
    const clash = rows.find((r) => overlaps(mine, interval(r)));
    if (clash) {
      throw new DomainError(
        `Las fechas se solapan con ${label(before.attribute, clash.value)} (${describeInterval(interval(clash))}).`,
        { validFrom: "Vigencia solapada con otro tramo." },
      );
    }
    const res = await tx.serviceTerm.updateMany({
      where: { id, version: input.expectedVersion },
      data: {
        value,
        validFrom: toDbDate(input.validFrom),
        validTo: toDbDate(input.validTo),
        note: input.note,
        version: { increment: 1 },
      },
    });
    if (res.count === 0) throw new StaleVersionError("El tramo");
    const after = await tx.serviceTerm.findUniqueOrThrow({ where: { id } });
    await recordAudit(tx, actor, {
      action: "UPDATE",
      entityType: "ServiceTerm",
      entityId: id,
      groupId: target.groupId,
      clientId: target.clientId,
      summary: `${ATTRIBUTE_LABEL[before.attribute]} de ${target.name}: corrección de tramo (${describeInterval(mine)})`,
      before,
      after,
    });
    return after;
  });
}

/** Valor vigente de un dato en una fecha (AAAA-MM-DD): fuente única de la lectura puntual. */
export async function valueAt(
  actorId: string,
  scope: { type: "group" | "client" | "implementation"; id: string },
  attribute: Attribute,
  date: string,
): Promise<string | null> {
  const { authorize } = await import("./authorize");
  await authorize(prisma, actorId, "READ");
  const where =
    scope.type === "group" ? { groupId: scope.id } : scope.type === "client" ? { clientId: scope.id } : { implementationId: scope.id };
  const rows = await prisma.serviceTerm.findMany({ where: { attribute, ...where } });
  return pickAt(rows.map((r) => ({ ...interval(r), value: r.value })), date)?.value ?? null;
}
