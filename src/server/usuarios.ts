import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { matrixChangeSchema, matrixCopySchema, matrixInitSchema } from "@/domain/usuarios-schemas";
import {
  HISTORIC_YEAR,
  MONTH_NAMES,
  MONTHS,
  computeExposure,
  currentYear,
  editability,
  emptyYear,
  planApplyFrom,
  planCopyFromPrevious,
  planInitializeHistoric,
  planSetMonth,
  statusOf,
  type Exposure,
  type MonthState,
  type Plan,
  type ScopeRef,
  type YearState,
} from "@/domain/usuarios";
import { isIsoDate } from "@/domain/vigencia";
import type { Actor } from "@/lib/access";
import { authorize } from "./authorize";
import { recordAudit } from "./audit";
import { adminTransaction } from "./tx";
import { DomainError, StaleVersionError } from "./errors";
import { pageResult, paging, resolveTarget, type ResolvedTarget, type ScopeFk } from "./common";
import { parseInput } from "./parse";

/** Reloj inyectable solo desde servidor/pruebas; nunca viene del navegador. */
export type ClockOpts = { now?: Date };

type Db = Prisma.TransactionClient;

type LoadedYear = {
  matrixId: string | null;
  version: number;
  state: YearState;
  rows: { month: number; value: number; kind: MonthState["kind"]; isLocked: boolean; source: string; revision: number; updatedAt: Date; updatedBy: { name: string; email: string } }[];
};

const scopeCol = (fk: ScopeFk) => (fk.groupId ? "groupId" : fk.clientId ? "clientId" : "implementationId");
const scopeIdOf = (fk: ScopeFk) => (fk.groupId ?? fk.clientId ?? fk.implementationId) as string;

async function loadYear(db: Db, fk: ScopeFk, year: number): Promise<LoadedYear> {
  const m = await db.userMatrix.findFirst({
    where: { ...fk, year },
    include: { months: { include: { updatedBy: { select: { name: true, email: true } } }, orderBy: { month: "asc" } } },
  });
  const state = emptyYear();
  if (!m) return { matrixId: null, version: 0, state, rows: [] };
  for (const r of m.months) state[r.month - 1] = { value: r.value, kind: r.kind, isLocked: r.isLocked, source: r.source };
  return {
    matrixId: m.id,
    version: m.version,
    state,
    rows: m.months.map((r) => ({
      month: r.month, value: r.value, kind: r.kind, isLocked: r.isLocked, source: r.source,
      revision: r.revision, updatedAt: r.updatedAt, updatedBy: r.updatedBy,
    })),
  };
}

/**
 * Crea la cabecera si no existe (sin error ante creación concurrente) y la bloquea hasta el final de
 * la transacción: serializa las ediciones del mismo ámbito y año.
 */
async function lockHeader(tx: Db, fk: ScopeFk, year: number): Promise<{ id: string; version: number; created: boolean }> {
  const col = scopeCol(fk);
  const inserted = await tx.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO "UserMatrix" ("id", "${col}", "year", "version", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 1, now(), now()) ON CONFLICT DO NOTHING RETURNING "id"`,
    randomUUID(),
    scopeIdOf(fk),
    year,
  );
  if (inserted.length > 0) return { id: inserted[0].id, version: 1, created: true };
  const rows = await tx.$queryRawUnsafe<{ id: string; version: number }[]>(
    `SELECT "id", "version" FROM "UserMatrix" WHERE "${col}" = $1 AND "year" = $2 FOR UPDATE`,
    scopeIdOf(fk),
    year,
  );
  if (rows.length === 0) throw new StaleVersionError("La matriz de usuarios");
  return { id: rows[0].id, version: rows[0].version, created: false };
}

const brief = (s: MonthState | null) => (s ? { value: s.value, kind: s.kind, isLocked: s.isLocked } : null);

type Applied = { month: number; before: ReturnType<typeof brief>; after: ReturnType<typeof brief> };

async function applyPlan(
  tx: Db,
  actor: Actor,
  matrixId: string,
  plan: Plan,
  defaultSource: (month: number, isTarget: boolean) => string,
  targetMonth: number | null,
): Promise<Applied[]> {
  const applied: Applied[] = [];
  for (const r of plan.rows) {
    if (r.status !== "changed" || !r.after) continue;
    const source = r.after.source ?? defaultSource(r.month, r.month === targetMonth);
    if (r.before) {
      await tx.userMatrixMonth.update({
        where: { matrixId_month: { matrixId, month: r.month } },
        data: { value: r.after.value, kind: r.after.kind, isLocked: r.after.isLocked, source, updatedById: actor.id, revision: { increment: 1 } },
      });
    } else {
      await tx.userMatrixMonth.create({
        data: { matrixId, month: r.month, value: r.after.value, kind: r.after.kind, isLocked: r.after.isLocked, source, updatedById: actor.id },
      });
    }
    applied.push({ month: r.month, before: brief(r.before), after: brief(r.after) });
  }
  return applied;
}

/** Control de versión de la cabecera: cabecera nueva solo con versión esperada 0; si no, debe coincidir. */
async function checkAndBump(tx: Db, h: { id: string; version: number; created: boolean }, expected: number) {
  if (h.created) {
    if (expected !== 0) throw new StaleVersionError("La matriz de usuarios");
    return;
  }
  if (h.version !== expected) throw new StaleVersionError("La matriz de usuarios");
  await tx.userMatrix.update({ where: { id: h.id }, data: { version: { increment: 1 } } });
}

function assertEditableYear(year: number, now?: Date) {
  const ed = editability(year, now);
  if (!ed.editable) throw new DomainError(ed.reason as string, { year: ed.reason as string });
}

function buildChangePlan(input: ReturnType<typeof parseChange>, state: YearState): Plan {
  if (state[input.month - 1]?.isLocked) {
    throw new DomainError(`${MONTH_NAMES[input.month - 1]} está bloqueado (carga inicial histórica) y no se edita en la operación ordinaria.`, { month: "Mes bloqueado." });
  }
  return input.op === "SET_MONTH" ? planSetMonth(state, input.month, input.value) : planApplyFrom(state, input.month, input.value);
}

function parseChange(raw: unknown) {
  return parseInput(matrixChangeSchema, raw);
}

function describe(target: ResolvedTarget, year: number) {
  return `usuarios contratados ${year} de ${target.name}`;
}

export type ChangePreview = {
  year: number;
  op: "SET_MONTH" | "APPLY_FROM";
  month: number;
  value: number;
  version: number;
  scopeName: string;
  plan: Plan;
};

/** Vista previa de un cambio (antes/después y meses protegidos); no escribe nada. */
export async function previewMatrixChange(actorId: string, raw: unknown, opts: ClockOpts = {}): Promise<ChangePreview> {
  const input = parseChange(raw);
  await authorize(prisma, actorId, "ADMIN");
  assertEditableYear(input.year, opts.now);
  const target = await resolveTarget(prisma, input.targetType, input.targetId, { requireActive: true });
  const loaded = await loadYear(prisma, target.fk, input.year);
  const plan = buildChangePlan(input, loaded.state);
  return { year: input.year, op: input.op, month: input.month, value: input.value, version: loaded.version, scopeName: target.name, plan };
}

/**
 * Confirma un cambio de matriz de forma atómica: recalcula en la transacción con la matriz bloqueada
 * (la autoridad es el servidor, no la vista previa), comprueba la versión y audita los meses afectados.
 */
export async function confirmMatrixChange(actorId: string, raw: unknown, opts: ClockOpts = {}) {
  const input = parseChange(raw);
  return adminTransaction(actorId, async (tx, actor) => {
    assertEditableYear(input.year, opts.now);
    const target = await resolveTarget(tx, input.targetType, input.targetId, { requireActive: true });
    const h = await lockHeader(tx, target.fk, input.year);
    await checkAndBump(tx, h, input.expectedVersion);
    const loaded = await loadYear(tx, target.fk, input.year);
    const plan = buildChangePlan(input, loaded.state);
    if (plan.changedCount === 0) throw new DomainError("No hay cambios que guardar: los meses afectados ya tienen ese valor.");
    const mm = String(input.month).padStart(2, "0");
    const applied = await applyPlan(
      tx,
      actor,
      h.id,
      plan,
      (m, isTarget) =>
        input.op === "SET_MONTH" ? "Ajuste explícito del mes" : isTarget ? `Aplicado desde ${input.year}-${mm}` : `Propagado desde ${input.year}-${mm}`,
      input.month,
    );
    await recordAudit(tx, actor, {
      action: "UPDATE",
      entityType: "UserMatrix",
      entityId: h.id,
      groupId: target.groupId,
      clientId: target.clientId,
      summary:
        input.op === "SET_MONTH"
          ? `${describe(target, input.year)}: ${MONTH_NAMES[input.month - 1]} = ${input.value} (ajuste explícito)`
          : `${describe(target, input.year)}: ${input.value} desde ${MONTH_NAMES[input.month - 1]} (${applied.length} meses; ${plan.protectedMonths.length} protegidos)`,
      before: { version: h.created ? 0 : h.version, months: applied.map((a) => ({ month: a.month, ...(a.before ?? { value: null }) })) },
      after: { version: h.created ? 1 : h.version + 1, months: applied.map((a) => ({ month: a.month, ...(a.after ?? { value: null }) })) },
    });
    return { matrixId: h.id, version: h.created ? 1 : h.version + 1, changed: applied.map((a) => a.month), protectedMonths: plan.protectedMonths };
  });
}

// ----------------------------------------------------------------------- Inicialización 2025

export type HistoricPreview = { status: "new" | "unchanged" | "conflict"; plan: Plan; message?: string; scopeName: string };

export async function previewInitializeHistoric(actorId: string, raw: unknown): Promise<HistoricPreview> {
  const input = parseInput(matrixInitSchema, raw);
  await authorize(prisma, actorId, "ADMIN");
  const target = await resolveTarget(prisma, input.targetType, input.targetId, { requireActive: true });
  const loaded = await loadYear(prisma, target.fk, HISTORIC_YEAR);
  return { ...planInitializeHistoric(loaded.state, input.value), scopeName: target.name };
}

/**
 * Inicializa el histórico fijo 2025 de un ámbito vacío con doce meses iguales y bloqueados.
 * Idempotente con el mismo valor; ante cualquier dato incompatible no sobrescribe nada.
 * No es una reapertura ni depende del reloj: es la excepción acotada de la carga inicial.
 */
export async function initializeHistoric(actorId: string, raw: unknown) {
  const input = parseInput(matrixInitSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const target = await resolveTarget(tx, input.targetType, input.targetId, { requireActive: true });
    const h = await lockHeader(tx, target.fk, HISTORIC_YEAR);
    const loaded = await loadYear(tx, target.fk, HISTORIC_YEAR);
    const result = planInitializeHistoric(loaded.state, input.value);
    if (result.status === "conflict") throw new DomainError(result.message as string, { value: "Discrepancia con el histórico existente." });
    if (result.status === "unchanged") return { status: "unchanged" as const, matrixId: h.id };
    if (!h.created) await tx.userMatrix.update({ where: { id: h.id }, data: { version: { increment: 1 } } });
    const applied = await applyPlan(tx, actor, h.id, result.plan, () => input.source, null);
    await recordAudit(tx, actor, {
      action: "INITIALIZE",
      entityType: "UserMatrix",
      entityId: h.id,
      groupId: target.groupId,
      clientId: target.clientId,
      summary: `Inicialización del histórico ${HISTORIC_YEAR} de ${target.name}: ${input.value} usuarios los doce meses (${input.source})`,
      before: { months: [] },
      after: { months: applied.map((a) => ({ month: a.month, ...(a.after ?? {}) })) },
    });
    return { status: "created" as const, matrixId: h.id };
  });
}

// ----------------------------------------------------------------------- Copia del año anterior

export type CopyPreview = { year: number; version: number; plan: Plan; canApply: boolean; message: string | null; scopeName: string };

function copyMessage(previous: YearState, plan: Plan, previousYear: number): string | null {
  if (!previous.some((s) => s !== null)) return `No hay datos de ${previousYear} para este ámbito: no hay nada que copiar. Configure el año manualmente.`;
  if (plan.changedCount === 0) return "Todos los meses con origen ya tienen valor: no se pisa nada y no hay nada que copiar.";
  return null;
}

export async function previewCopyFromPreviousYear(actorId: string, raw: unknown, opts: ClockOpts = {}): Promise<CopyPreview> {
  const input = parseInput(matrixCopySchema, raw);
  await authorize(prisma, actorId, "ADMIN");
  assertEditableYear(input.year, opts.now);
  const target = await resolveTarget(prisma, input.targetType, input.targetId, { requireActive: true });
  const [cur, prev] = await Promise.all([loadYear(prisma, target.fk, input.year), loadYear(prisma, target.fk, input.year - 1)]);
  const plan = planCopyFromPrevious(cur.state, prev.state, input.year - 1);
  const message = copyMessage(prev.state, plan, input.year - 1);
  return { year: input.year, version: cur.version, plan, canApply: plan.changedCount > 0, message, scopeName: target.name };
}

/** Copia el año anterior mes a mes solo en meses sin informar del año en curso; nunca pisa valores. */
export async function copyFromPreviousYear(actorId: string, raw: unknown, opts: ClockOpts = {}) {
  const input = parseInput(matrixCopySchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    assertEditableYear(input.year, opts.now);
    const target = await resolveTarget(tx, input.targetType, input.targetId, { requireActive: true });
    const prev = await loadYear(tx, target.fk, input.year - 1);
    const h = await lockHeader(tx, target.fk, input.year);
    const cur = await loadYear(tx, target.fk, input.year);
    const plan = planCopyFromPrevious(cur.state, prev.state, input.year - 1);
    const message = copyMessage(prev.state, plan, input.year - 1);
    if (message) throw new DomainError(message);
    await checkAndBump(tx, h, input.expectedVersion);
    const applied = await applyPlan(tx, actor, h.id, plan, () => "Base copiada", null);
    await recordAudit(tx, actor, {
      action: "INITIALIZE",
      entityType: "UserMatrix",
      entityId: h.id,
      groupId: target.groupId,
      clientId: target.clientId,
      summary: `${describe(target, input.year)}: base copiada de ${input.year - 1} (${applied.length} meses; ${plan.protectedMonths.length} ya informados se conservan)`,
      before: { months: applied.map((a) => ({ month: a.month, value: null })) },
      after: { months: applied.map((a) => ({ month: a.month, ...(a.after ?? {}) })) },
    });
    return { matrixId: h.id, copied: applied.map((a) => a.month) };
  });
}

// ----------------------------------------------------------------------- Consultas

export type MonthView = {
  month: number;
  value: number | null;
  status: ReturnType<typeof statusOf>;
  kind: MonthState["kind"] | null;
  isLocked: boolean;
  source: string | null;
  revision: number | null;
  updatedBy: string | null;
  updatedAt: Date | null;
};

export async function getMatrix(actorId: string, scope: ScopeRef, year: number, opts: ClockOpts = {}) {
  await authorize(prisma, actorId, "READ");
  const target = await resolveTarget(prisma, scope.type, scope.id, { requireActive: false });
  const loaded = await loadYear(prisma, target.fk, year);
  const ed = editability(year, opts.now);
  const months: MonthView[] = MONTHS.map((m) => {
    const r = loaded.rows.find((x) => x.month === m);
    return {
      month: m,
      value: r ? r.value : null,
      status: statusOf(r ? r.value : null),
      kind: r ? r.kind : null,
      isLocked: r ? r.isLocked : false,
      source: r ? r.source : null,
      revision: r ? r.revision : null,
      updatedBy: r ? `${r.updatedBy.name} <${r.updatedBy.email}>` : null,
      updatedAt: r ? r.updatedAt : null,
    };
  });
  return {
    scope: { ...scope, name: target.name, isActive: target.isActive },
    year,
    version: loaded.version,
    months,
    editable: ed.editable && target.isActive,
    reason: ed.reason ?? (target.isActive ? null : "El ámbito está inactivo: no admite cambios hasta reactivarlo."),
  };
}

export type MatrixListQuery = {
  year: number;
  scopeType: ScopeRef["type"];
  q?: string;
  status?: "active" | "inactive" | "all";
  page?: number;
  pageSize?: number;
};

/** Entidades del ámbito con sus doce valores del año (null = sin informar). */
export async function listMatrices(actorId: string, query: MatrixListQuery) {
  await authorize(prisma, actorId, "READ");
  const q = (query.q ?? "").trim();
  const active = query.status === "inactive" ? { isActive: false } : query.status === "all" ? {} : { isActive: true };
  const { page, pageSize, skip, take } = paging(query);
  let entities: { id: string; name: string; context: string | null; isActive: boolean }[];
  let total: number;
  if (query.scopeType === "group") {
    const where: Prisma.ClientGroupWhereInput = { ...active, ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) };
    const [rows, n] = await Promise.all([
      prisma.clientGroup.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip, take }),
      prisma.clientGroup.count({ where }),
    ]);
    entities = rows.map((r) => ({ id: r.id, name: r.name, context: null, isActive: r.isActive }));
    total = n;
  } else if (query.scopeType === "client") {
    const where: Prisma.ClientWhereInput = {
      ...active,
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { group: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    };
    const [rows, n] = await Promise.all([
      prisma.client.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip, take, include: { group: { select: { name: true } } } }),
      prisma.client.count({ where }),
    ]);
    entities = rows.map((r) => ({ id: r.id, name: r.name, context: r.group?.name ?? null, isActive: r.isActive }));
    total = n;
  } else {
    const where: Prisma.ImplementationWhereInput = {
      ...active,
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { client: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    };
    const [rows, n] = await Promise.all([
      prisma.implementation.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip, take, include: { client: { select: { name: true } } } }),
      prisma.implementation.count({ where }),
    ]);
    entities = rows.map((r) => ({ id: r.id, name: r.name, context: r.client.name, isActive: r.isActive }));
    total = n;
  }
  const col = query.scopeType === "group" ? "groupId" : query.scopeType === "client" ? "clientId" : "implementationId";
  const matrices = entities.length
    ? await prisma.userMatrix.findMany({ where: { year: query.year, [col]: { in: entities.map((e) => e.id) } }, include: { months: true } })
    : [];
  const rows = entities.map((e) => {
    const m = matrices.find((x) => (x as Record<string, unknown>)[col] === e.id);
    const values: (number | null)[] = MONTHS.map((n) => m?.months.find((r) => r.month === n)?.value ?? null);
    const kinds = MONTHS.map((n) => m?.months.find((r) => r.month === n)?.kind ?? null);
    const locked = MONTHS.map((n) => m?.months.find((r) => r.month === n)?.isLocked ?? false);
    return { ...e, version: m?.version ?? 0, values, kinds, locked };
  });
  return pageResult(rows, total, page, pageSize);
}

async function lookupFor(actorId: string, scope: ScopeRef, years: number[]) {
  await authorize(prisma, actorId, "READ");
  const target = await resolveTarget(prisma, scope.type, scope.id, { requireActive: false });
  const matrices = await prisma.userMatrix.findMany({ where: { ...target.fk, year: { in: years } }, include: { months: true } });
  return (year: number, month: number): number | null => {
    const m = matrices.find((x) => x.year === year);
    const r = m?.months.find((x) => x.month === month);
    return r ? r.value : null;
  };
}

/** Usuarios contratados de un mes (stock). null = sin informar; 0 = cero confirmado. */
export async function usersAtMonth(actorId: string, scope: ScopeRef, year: number, month: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new DomainError("Mes no válido.");
  const value = (await lookupFor(actorId, scope, [year]))(year, month);
  return { year, month, value, status: statusOf(value) };
}

/** Stock al corte: el valor del mes de la fecha de corte; no se prorratea ni se suma. */
export async function usersAtCutoff(actorId: string, scope: ScopeRef, date: string) {
  if (!isIsoDate(date)) throw new DomainError("Fecha de corte no válida.");
  const [y, m] = date.split("-").map(Number);
  return { cutoff: date, ...(await usersAtMonth(actorId, scope, y, m)) };
}

/** Exposición del periodo en usuarios mes (flujo). Cobertura incompleta se informa, no se ignora. */
export async function userMonthsExposure(actorId: string, scope: ScopeRef, period: { from: string; to: string }): Promise<Exposure> {
  if (!isIsoDate(period.from) || !isIsoDate(period.to) || period.from > period.to) throw new DomainError("Periodo no válido.");
  const fy = Number(period.from.slice(0, 4));
  const ty = Number(period.to.slice(0, 4));
  const years: number[] = [];
  for (let y = fy; y <= ty; y++) years.push(y);
  const lookup = await lookupFor(actorId, scope, years);
  return computeExposure(lookup, period.from, period.to);
}

export { currentYear, HISTORIC_YEAR };
