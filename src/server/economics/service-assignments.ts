import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { cleanText } from "@/domain/normalize";
import { fromDbDate, isCoherent, isIsoDate, overlaps, toDbDate, describeInterval } from "@/domain/vigencia";
import { FINANCE_CATEGORIES, CATEGORY_LABEL, Dec } from "@/domain/finance";
import { recordAudit } from "@/server/audit";
import { authorize } from "@/server/authorize";
import { DomainError, StaleVersionError } from "@/server/errors";
import { pageResult, paging } from "@/server/common";
import { adminTransaction } from "@/server/tx";
import { parseInput } from "@/server/parse";

/**
 * Asignación mínima y auditable de servicio económico (CSAPP-05 §7): por valor exacto de «Entorno y Tipología» de los tickets y/o por
 * proyecto de Wrike, con vigencia [desde, hasta). Sin editor genérico de reglas ni semillas inventadas. Dos evidencias incompatibles
 * dan CONFLICTO en el motor; este módulo solo guarda las asignaciones y muestra su impacto antes de guardarlas.
 */
export const KINDS = ["ENTORNO", "WRIKE_PROJECT"] as const;
export type AssignmentKind = (typeof KINDS)[number];
export const KIND_LABEL: Record<AssignmentKind, string> = { ENTORNO: "Entorno y Tipología (ticket)", WRIKE_PROJECT: "Proyecto de Wrike" };

const date = (label: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : v))
    .refine((v) => v === null || isIsoDate(v), `${label}: fecha no válida (AAAA-MM-DD).`);

const base = {
  matchValue: z.string({ error: "Valor: es obligatorio." }).transform(cleanText).refine((v) => v.length > 0 && v.length <= 300, "Valor: es obligatorio (máximo 300 caracteres)."),
  service: z.enum(FINANCE_CATEGORIES, { error: "Seleccione el servicio." }),
  validFrom: date("Vigente desde"),
  validTo: date("Vigente hasta"),
  note: z.string().trim().max(500).transform((v) => v || null).optional(),
};
const createSchema = z
  .object({ matchKind: z.enum(KINDS, { error: "Seleccione el tipo de coincidencia." }), ...base })
  .refine((v) => isCoherent({ from: v.validFrom, to: v.validTo }), { path: ["validTo"], message: "«Vigente hasta» debe ser posterior a «Vigente desde»." });
const updateSchema = z
  .object({ ...base, expectedVersion: z.coerce.number().int().min(1) })
  .refine((v) => isCoherent({ from: v.validFrom, to: v.validTo }), { path: ["validTo"], message: "«Vigente hasta» debe ser posterior a «Vigente desde»." });

const searchOf = (v: string) => cleanText(v).toLowerCase();

async function assertNoOverlap(tx: Prisma.TransactionClient, kind: string, searchValue: string, interval: { from: string | null; to: string | null }, excludeId?: string) {
  const others = await tx.serviceAssignment.findMany({ where: { matchKind: kind, searchValue, isActive: true, ...(excludeId ? { NOT: { id: excludeId } } : {}) } });
  const clash = others.find((o) => overlaps(interval, { from: fromDbDate(o.validFrom), to: fromDbDate(o.validTo) }));
  if (clash) {
    throw new DomainError(
      `«${clash.matchValue}» ya está asignado a ${CATEGORY_LABEL[clash.service as keyof typeof CATEGORY_LABEL]} con vigencia ${describeInterval({ from: fromDbDate(clash.validFrom), to: fromDbDate(clash.validTo) })}, que se solapa. Ajuste esa vigencia o desactívela; no se reasigna automáticamente.`,
      { validFrom: "Vigencia solapada con otra asignación del mismo valor." },
    );
  }
}

export async function createServiceAssignment(actorId: string, raw: unknown) {
  await authorize(prisma, actorId, "ADMIN"); // el permiso se comprueba antes que los datos
  const input = parseInput(createSchema, raw);
  const search = searchOf(input.matchValue);
  return adminTransaction(actorId, async (tx, actor) => {
    await assertNoOverlap(tx, input.matchKind, search, { from: input.validFrom, to: input.validTo });
    const row = await tx.serviceAssignment.create({
      data: { matchKind: input.matchKind, matchValue: input.matchValue, searchValue: search, service: input.service, validFrom: toDbDate(input.validFrom), validTo: toDbDate(input.validTo), note: input.note ?? null },
    });
    await recordAudit(tx, actor, {
      action: "CREATE",
      entityType: "ServiceAssignment",
      entityId: row.id,
      summary: `Servicio económico ${CATEGORY_LABEL[input.service]} asignado a ${KIND_LABEL[input.matchKind]} «${input.matchValue}»`,
      after: row,
    });
    return row;
  });
}

export async function updateServiceAssignment(actorId: string, id: string, raw: unknown) {
  await authorize(prisma, actorId, "ADMIN");
  const input = parseInput(updateSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const before = await tx.serviceAssignment.findUnique({ where: { id } });
    if (!before) throw new DomainError("Asignación no encontrada.");
    const search = searchOf(input.matchValue);
    if (before.isActive) await assertNoOverlap(tx, before.matchKind, search, { from: input.validFrom, to: input.validTo }, id);
    const res = await tx.serviceAssignment.updateMany({
      where: { id, version: input.expectedVersion },
      data: { matchValue: input.matchValue, searchValue: search, service: input.service, validFrom: toDbDate(input.validFrom), validTo: toDbDate(input.validTo), note: input.note ?? null, version: { increment: 1 } },
    });
    if (res.count === 0) throw new StaleVersionError("La asignación");
    const after = await tx.serviceAssignment.findUniqueOrThrow({ where: { id } });
    await recordAudit(tx, actor, { action: "UPDATE", entityType: "ServiceAssignment", entityId: id, summary: `Asignación de servicio «${after.matchValue}» modificada`, before, after });
    return after;
  });
}

export async function setServiceAssignmentActive(actorId: string, id: string, active: boolean, expectedVersion: number) {
  return adminTransaction(actorId, async (tx, actor) => {
    const before = await tx.serviceAssignment.findUnique({ where: { id } });
    if (!before) throw new DomainError("Asignación no encontrada.");
    if (active) await assertNoOverlap(tx, before.matchKind, before.searchValue, { from: fromDbDate(before.validFrom), to: fromDbDate(before.validTo) }, id);
    const res = await tx.serviceAssignment.updateMany({ where: { id, version: expectedVersion }, data: { isActive: active, version: { increment: 1 } } });
    if (res.count === 0) throw new StaleVersionError("La asignación");
    const after = await tx.serviceAssignment.findUniqueOrThrow({ where: { id } });
    await recordAudit(tx, actor, { action: active ? "REACTIVATE" : "DEACTIVATE", entityType: "ServiceAssignment", entityId: id, summary: `${active ? "Reactivación" : "Desactivación"} de la asignación de servicio «${after.matchValue}»`, before, after });
    return after;
  });
}

export async function listServiceAssignments(actorId: string, q: { q?: string; kind?: string; status?: "active" | "inactive" | "all"; page?: number } = {}) {
  await authorize(prisma, actorId, "READ");
  const { page, pageSize, skip, take } = paging({ pageSize: 20, page: q.page });
  const where: Prisma.ServiceAssignmentWhereInput = {
    ...(q.q ? { searchValue: { contains: cleanText(q.q).toLowerCase() } } : {}),
    ...(q.kind && KINDS.includes(q.kind as AssignmentKind) ? { matchKind: q.kind } : {}),
    ...(q.status === "inactive" ? { isActive: false } : q.status === "all" ? {} : { isActive: true }),
  };
  const [rows, total] = await Promise.all([
    prisma.serviceAssignment.findMany({ where, orderBy: [{ matchKind: "asc" }, { searchValue: "asc" }, { validFrom: "asc" }], skip, take }),
    prisma.serviceAssignment.count({ where }),
  ]);
  return pageResult(rows, total, page, pageSize);
}

/** Valores de Entorno y Tipología existentes en tickets (revisión actual), con su número de tickets, para elegir el valor exacto. */
export async function searchEntornoValues(actorId: string, q: string, limit = 15) {
  await authorize(prisma, actorId, "READ");
  const term = `%${cleanText(q).toLowerCase()}%`;
  const rows = await prisma.$queryRaw<{ value: string; tickets: bigint }[]>(Prisma.sql`
    SELECT r.entorno AS value, count(*) AS tickets FROM "ZdTicket" t JOIN "ZdTicketRevision" r ON r.id = t."currentRevisionId"
    WHERE r.entorno IS NOT NULL AND lower(r.entorno) LIKE ${term} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT ${limit}`);
  return rows.map((r) => ({ value: r.value, tickets: Number(r.tickets) }));
}

/** Impacto de una asignación antes de guardarla: actividades y horas que clasificaría y cuántas ya tienen otra evidencia. */
export async function previewServiceAssignmentImpact(actorId: string, raw: unknown) {
  await authorize(prisma, actorId, "READ");
  const input = parseInput(createSchema, raw);
  const search = searchOf(input.matchValue);
  const col = input.matchKind === "ENTORNO" ? Prisma.sql`lower(a."ticketEntorno")` : Prisma.sql`lower(a."projectName")`;
  const src = input.matchKind === "WRIKE_PROJECT" ? Prisma.sql`AND a.source = 'WRIKE'` : Prisma.empty;
  const r = await prisma.$queryRaw<{ n: bigint; minutes: string | null; groups: bigint; conflicting: bigint }[]>(Prisma.sql`
    SELECT count(*) AS n, sum(a.minutes)::text AS minutes, count(DISTINCT a."groupId") AS groups,
      count(*) FILTER (WHERE a."ticketAdminDelegada" IS TRUE AND ${input.service} <> 'ADMIN_DELEGADA') AS conflicting
    FROM "TimeActivity" a
    WHERE ${col} = ${search} ${src}
      AND (${input.validFrom}::date IS NULL OR a."workDate" >= ${input.validFrom}::date) AND (${input.validTo}::date IS NULL OR a."workDate" < ${input.validTo}::date)`);
  const minutes = Dec.parse(r[0].minutes ?? "0") ?? Dec.ZERO;
  return { activities: Number(r[0].n), hours: minutes.divInt(60).toString(), groups: Number(r[0].groups), conflictingWithAdminDelegada: Number(r[0].conflicting) };
}
