import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { matrixBatchSchema, matrixChangeSchema, matrixCopySchema, matrixInitSchema } from "@/domain/usuarios-schemas";
import {
  ESTIMATED_SOURCE,
  MONTH_NAMES,
  MONTHS,
  USERS_BASE_YEAR,
  USERS_SEED_YEARS,
  computeExposure,
  currentYear,
  editability,
  emptyYear,
  planApplyFrom,
  planCopyDecember,
  planCopyFromPrevious,
  planInitializeHistoric,
  planSetMonth,
  statusOf,
  applySteps,
  type MatrixStep,
  type Exposure,
  type MonthState,
  type Plan,
  type PlanRow,
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
    // Marca heredada: la migración HOTFIX-01 las limpia y ya no se crean. La ventana de años es la que decide qué es editable.
    throw new DomainError(`${MONTH_NAMES[input.month - 1]} está bloqueado y no se edita en la operación ordinaria.`, { month: "Mes bloqueado." });
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

// ----------------------------------------------------------------------- Guardado por lote (HOTFIX-04 §6)

export type BatchMonth = { month: number; before: number | null; after: number | null; beforeKind: MonthState["kind"] | null; afterKind: MonthState["kind"] | null; status: "changed" | "unchanged" | "protected"; source: string | null };
export type BatchRowPreview = { key: string; targetType: ScopeRef["type"]; targetId: string; scopeName: string; version: number; months: BatchMonth[]; protectedMonths: number[] };
export type BatchError = { key: string; message: string; kind: "VALIDATION" | "CONFLICT" };
export type BatchResult = {
  ok: boolean;
  digest: string;
  year: number;
  rows: BatchRowPreview[];
  errors: BatchError[];
  /** Versión nueva de cada matriz guardada (clave → versión). */
  versions: Record<string, number>;
  alreadyApplied?: boolean;
};

class BatchRollback extends Error {
  constructor(public readonly result: BatchResult) {
    super("rollback");
  }
}

export const batchKey = (type: ScopeRef["type"], id: string) => `${type}:${id}`;

/** Huella estable del lote (el orden de las filas no la altera). */
export function batchDigest(input: { year: number; matrices: readonly { targetType: string; targetId: string; expectedVersion: number; steps: readonly unknown[] }[] }): string {
  const canon = [...input.matrices].sort((a, b) => (`${a.targetType}:${a.targetId}` < `${b.targetType}:${b.targetId}` ? -1 : 1));
  return createHash("sha256").update(JSON.stringify({ y: input.year, m: canon })).digest("hex").slice(0, 32);
}

async function runBatch(actorId: string, raw: unknown, dryRun: boolean, opts: ClockOpts): Promise<BatchResult> {
  const input = parseInput(matrixBatchSchema, raw);
  const digest = batchDigest(input);
  if (!dryRun && input.digest && input.digest !== digest) {
    throw new DomainError("El borrador cambió después de revisarlo. Vuelva a pulsar «Guardar cambios» para revisarlo de nuevo; no se ha guardado nada.");
  }
  assertEditableYear(input.year, opts.now); // reloj del servidor: un año anterior o futuro es solo lectura incluso ante una petición forjada
  const keys = new Set<string>();
  for (const m of input.matrices) {
    const k = batchKey(m.targetType, m.targetId);
    if (keys.has(k)) throw new DomainError("Una misma fila figura dos veces en el borrador: revise y vuelva a guardar.");
    keys.add(k);
  }
  const ordered = [...input.matrices].sort((a, b) => (batchKey(a.targetType, a.targetId) < batchKey(b.targetType, b.targetId) ? -1 : 1));
  try {
    return await prisma.$transaction(
      async (tx) => {
        const actor = await authorize(tx, actorId, "ADMIN");
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('csapp-matrix-batch'))`;
        if (!dryRun) {
          const done = await tx.auditEvent.findFirst({ where: { entityType: "EditOperation", entityId: input.operationId }, select: { id: true } });
          if (done) return { ok: true, digest, year: input.year, rows: [], errors: [], versions: {}, alreadyApplied: true };
        }
        const rows: BatchRowPreview[] = [];
        const errors: BatchError[] = [];
        const versions: Record<string, number> = {};
        for (const m of ordered) {
          const key = batchKey(m.targetType, m.targetId);
          let target: ResolvedTarget;
          try {
            target = await resolveTarget(tx, m.targetType, m.targetId, { requireActive: true });
          } catch (e) {
            errors.push({ key, kind: "VALIDATION", message: e instanceof DomainError ? e.message : "El ámbito ya no existe." });
            continue;
          }
          const steps = m.steps as MatrixStep[];
          const previous = steps.some((s) => s.type === "COPY") ? (await loadYear(tx, target.fk, input.year - 1)).state : emptyYear();
          // Primero sin bloquear: una fila sin cambios netos no crea cabecera ni versión.
          const cur0 = await loadYear(tx, target.fk, input.year);
          const probe = applySteps(cur0.state, steps, { year: input.year, previous });
          if (probe.errors.length > 0) { for (const e of probe.errors) errors.push({ key, kind: "VALIDATION", message: e.message }); continue; }
          if (!probe.rows.some((r) => r.status === "changed")) continue;
          const h = await lockHeader(tx, target.fk, input.year);
          if ((h.created ? 0 : h.version) !== m.expectedVersion) {
            errors.push({ key, kind: "CONFLICT", message: "Otra persona ha modificado esta fila mientras la editaba. Se muestran sus valores actuales; revise su cambio y vuelva a guardar. No se ha guardado nada." });
            continue;
          }
          const cur = await loadYear(tx, target.fk, input.year); // bajo bloqueo
          const out = applySteps(cur.state, steps, { year: input.year, previous });
          if (out.errors.length > 0) { for (const e of out.errors) errors.push({ key, kind: "VALIDATION", message: e.message }); continue; }
          const changed = out.rows.filter((r) => r.status === "changed");
          if (changed.length === 0) continue;
          for (const r of changed) {
            if (r.after) {
              const data = { value: r.after.value, kind: r.after.kind, isLocked: r.after.isLocked, source: r.after.source ?? "Ajuste explícito del mes", updatedById: actor.id };
              if (r.before) await tx.userMatrixMonth.update({ where: { matrixId_month: { matrixId: h.id, month: r.month } }, data: { ...data, revision: { increment: 1 } } });
              else await tx.userMatrixMonth.create({ data: { matrixId: h.id, month: r.month, ...data } });
            } else {
              // «Sin informar» tras confirmar: la fila del mes se retira; el valor anterior queda en la auditoría.
              await tx.userMatrixMonth.delete({ where: { matrixId_month: { matrixId: h.id, month: r.month } } });
            }
          }
          if (!h.created) await tx.userMatrix.update({ where: { id: h.id }, data: { version: { increment: 1 } } });
          const newVersion = h.created ? 1 : h.version + 1;
          versions[key] = newVersion;
          const brief2 = (s: MonthState | null) => (s ? { value: s.value, kind: s.kind, isLocked: s.isLocked } : { value: null });
          await recordAudit(tx, actor, {
            action: "UPDATE", entityType: "UserMatrix", entityId: h.id, groupId: target.groupId, clientId: target.clientId,
            summary: `${describe(target, input.year)}: ${changed.length} ${changed.length === 1 ? "mes" : "meses"} guardados tras confirmación (${changed.map((r) => `${MONTH_NAMES[r.month - 1]} ${r.before ? r.before.value : "sin informar"}→${r.after ? r.after.value : "sin informar"}`).join(", ")})${out.protectedMonths.length ? `; ${out.protectedMonths.length} preservados` : ""}`,
            before: { version: h.created ? 0 : h.version, months: changed.map((r) => ({ month: r.month, ...brief2(r.before) })) },
            after: { version: newVersion, months: changed.map((r) => ({ month: r.month, ...brief2(r.after) })) },
          });
          rows.push({
            key, targetType: m.targetType, targetId: m.targetId, scopeName: target.name, version: h.created ? 0 : h.version, protectedMonths: out.protectedMonths,
            months: out.rows.map((r) => ({ month: r.month, before: r.before?.value ?? null, after: r.after?.value ?? null, beforeKind: r.before?.kind ?? null, afterKind: r.after?.kind ?? null, status: r.status, source: r.after?.source ?? null })),
          });
        }
        const result: BatchResult = { ok: errors.length === 0, digest, year: input.year, rows, errors, versions };
        if (!result.ok || dryRun) throw new BatchRollback(result);
        await recordAudit(tx, actor, { action: "UPDATE", entityType: "EditOperation", entityId: input.operationId, summary: `Usuarios contratados ${input.year}: guardado por lote tras confirmación (${rows.length} ${rows.length === 1 ? "fila" : "filas"})`, after: { digest, year: input.year, rows: rows.map((r) => r.key) } });
        return result;
      },
      { maxWait: 5000, timeout: 30000 },
    );
  } catch (e) {
    if (e instanceof BatchRollback) return e.result;
    throw e;
  }
}

/** Vista previa del guardado por lote: valida y calcula antes→después de cada mes SIN escribir (la transacción se deshace). */
export function previewMatrixBatch(actorId: string, raw: unknown, opts: ClockOpts = {}): Promise<BatchResult> {
  return runBatch(actorId, raw, true, opts);
}
/** Guardado por lote atómico: cada matriz se bloquea y versiona UNA vez; todo o nada. Idempotente por `operationId`. */
export function applyMatrixBatch(actorId: string, raw: unknown, opts: ClockOpts = {}): Promise<BatchResult> {
  return runBatch(actorId, raw, false, opts);
}

// ----------------------------------------------------------------------- Valor inicial uniforme

export type HistoricPreview = { status: "new" | "unchanged" | "conflict"; plan: Plan; message?: string; scopeName: string };

export async function previewInitializeHistoric(actorId: string, raw: unknown, opts: ClockOpts = {}): Promise<HistoricPreview> {
  const input = parseInput(matrixInitSchema, raw);
  await authorize(prisma, actorId, "ADMIN");
  assertEditableYear(input.year, opts.now);
  const target = await resolveTarget(prisma, input.targetType, input.targetId, { requireActive: true });
  const loaded = await loadYear(prisma, target.fk, input.year);
  return { ...planInitializeHistoric(loaded.state, input.value, input.year), scopeName: target.name };
}

/**
 * Valor inicial uniforme de un año editable (año actual o anterior, Europe/Madrid, reloj del servidor) de un ámbito vacío: doce meses iguales
 * (carga inicial). Idempotente con el mismo valor; ante cualquier dato incompatible no sobrescribe nada. Ya no existe una excepción fija de 2025
 * ni un bloqueo por fila: la precarga del libro histórico es la única vía que escribe fuera de la ventana y solo rellena meses sin informar.
 */
export async function initializeHistoric(actorId: string, raw: unknown, opts: ClockOpts = {}) {
  const input = parseInput(matrixInitSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    assertEditableYear(input.year, opts.now);
    const target = await resolveTarget(tx, input.targetType, input.targetId, { requireActive: true });
    const h = await lockHeader(tx, target.fk, input.year);
    const loaded = await loadYear(tx, target.fk, input.year);
    const result = planInitializeHistoric(loaded.state, input.value, input.year);
    if (result.status === "conflict") throw new DomainError(result.message as string, { value: "Discrepancia con los datos existentes." });
    if (result.status === "unchanged") return { status: "unchanged" as const, matrixId: h.id };
    if (!h.created) await tx.userMatrix.update({ where: { id: h.id }, data: { version: { increment: 1 } } });
    const applied = await applyPlan(tx, actor, h.id, result.plan, () => input.source, null);
    await recordAudit(tx, actor, {
      action: "INITIALIZE",
      entityType: "UserMatrix",
      entityId: h.id,
      groupId: target.groupId,
      clientId: target.clientId,
      summary: `Valor inicial de ${input.year} de ${target.name}: ${input.value} usuarios los doce meses (${input.source})`,
      before: { months: [] },
      after: { months: applied.map((a) => ({ month: a.month, ...(a.after ?? {}) })) },
    });
    return { status: "created" as const, matrixId: h.id };
  });
}

// ----------------------------------------------------------------------- Copia del año anterior

export type CopyPreview = { year: number; version: number; plan: Plan; canApply: boolean; message: string | null; scopeName: string };

const planCopy = (mode: "SAME_MONTH" | "DECEMBER", cur: YearState, prev: YearState, previousYear: number) =>
  mode === "DECEMBER" ? planCopyDecember(cur, prev, previousYear) : planCopyFromPrevious(cur, prev, previousYear);

function copyMessage(previous: YearState, plan: Plan, previousYear: number, mode: "SAME_MONTH" | "DECEMBER" = "SAME_MONTH"): string | null {
  if (mode === "DECEMBER" && !previous[11]) return `No hay dato de diciembre de ${previousYear} para este ámbito: no hay nada que copiar.`;
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
  const plan = planCopy(input.mode, cur.state, prev.state, input.year - 1);
  const message = copyMessage(prev.state, plan, input.year - 1, input.mode);
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
    const plan = planCopy(input.mode, cur.state, prev.state, input.year - 1);
    const message = copyMessage(prev.state, plan, input.year - 1, input.mode);
    if (message) throw new DomainError(message);
    await checkAndBump(tx, h, input.expectedVersion);
    const applied = await applyPlan(tx, actor, h.id, plan, () => (input.mode === "DECEMBER" ? `Copia de diciembre ${input.year - 1}` : "Base copiada"), null);
    await recordAudit(tx, actor, {
      action: "INITIALIZE",
      entityType: "UserMatrix",
      entityId: h.id,
      groupId: target.groupId,
      clientId: target.clientId,
      summary: `${describe(target, input.year)}: ${input.mode === "DECEMBER" ? `base copiada de diciembre ${input.year - 1}` : `base copiada de ${input.year - 1}`} (${applied.length} meses; ${plan.protectedMonths.length} ya informados se conservan)`,
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
    const sources = MONTHS.map((n) => m?.months.find((r) => r.month === n)?.source ?? null);
    return { ...e, version: m?.version ?? 0, values, kinds, locked, sources };
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


// ----------------------------------------------------------------------- Base 2025 del libro histórico (HOTFIX-01 §7)

export type SeededYear = { year: number; kind: "INITIAL" | "COPIED" | "ESTIMATED"; months: number[] };

/**
 * Inicializa la matriz de UN Grupo desde su base de usuarios 2025 resuelta: 2025 con el mismo número los doce meses (INITIAL), los años de
 * `USERS_SEED_YEARS` (2026) desde esa base (COPIED) y los años históricos indicados, solo donde el Grupo existe (ESTIMATED, «Estimado a partir de 2025»).
 * Solo rellena meses SIN INFORMAR: nunca pisa un valor ya presente (ajuste, propagado, copia o carga previa) y una recarga no revierte ajustes manuales.
 * No se llama desde la edición ordinaria: es la inicialización autorizada de la precarga/resolución y no deja ninguna marca ni bypass abierto.
 * Solo escribe la matriz del Grupo (nunca Clientes, implantaciones ni Personal).
 */
export async function seedGroupUsersFromBase(tx: Db, actor: Actor, groupId: string, value: number, opts: { baseSource: string; historicYears: number[] }): Promise<SeededYear[]> {
  const fk: ScopeFk = { groupId };
  const targets: { year: number; kind: SeededYear["kind"]; source: (m: number) => string }[] = [
    { year: USERS_BASE_YEAR, kind: "INITIAL", source: () => opts.baseSource },
    ...USERS_SEED_YEARS.map((year) => ({ year, kind: "COPIED" as const, source: (m: number) => `Copia de ${USERS_BASE_YEAR}-${String(m).padStart(2, "0")}` })),
    ...[...new Set(opts.historicYears)].filter((y) => y < USERS_BASE_YEAR).sort().map((year) => ({ year, kind: "ESTIMATED" as const, source: () => ESTIMATED_SOURCE })),
  ];
  const group = await tx.clientGroup.findUnique({ where: { id: groupId }, select: { name: true } });
  const done: SeededYear[] = [];
  for (const t of targets) {
    if (!(await loadYear(tx, fk, t.year)).state.some((m) => m === null)) continue;
    const h = await lockHeader(tx, fk, t.year);
    const loaded = await loadYear(tx, fk, t.year); // bajo bloqueo: lo que otra operación escribiera entretanto se respeta
    const rows: PlanRow[] = MONTHS.map((m) => {
      const before = loaded.state[m - 1];
      if (before) return { month: m, before, after: before, status: "protected" };
      return { month: m, before: null, after: { value, kind: t.kind, isLocked: false, source: t.source(m) }, status: "changed" };
    });
    const plan: Plan = { rows, changedCount: rows.filter((r) => r.status === "changed").length, protectedMonths: rows.filter((r) => r.status === "protected").map((r) => r.month) };
    if (plan.changedCount === 0) continue;
    if (!h.created) await tx.userMatrix.update({ where: { id: h.id }, data: { version: { increment: 1 } } });
    const applied = await applyPlan(tx, actor, h.id, plan, () => opts.baseSource, null);
    await recordAudit(tx, actor, {
      action: "INITIALIZE",
      entityType: "UserMatrix",
      entityId: h.id,
      groupId,
      summary: `Usuarios contratados ${t.year} de ${group?.name ?? groupId} inicializados desde la base ${USERS_BASE_YEAR} (${value}): ${applied.length} meses${t.kind === "ESTIMATED" ? " (estimado, no observado)" : ""}; ${plan.protectedMonths.length} ya informados se conservan`,
      before: { months: [] },
      after: { months: applied.map((a) => ({ month: a.month, ...(a.after ?? {}) })) },
    });
    done.push({ year: t.year, kind: t.kind, months: applied.map((a) => a.month) });
  }
  return done;
}

/** Años distintos con alguna matriz (para el selector de años). */
export async function listMatrixYears(actorId: string): Promise<number[]> {
  await authorize(prisma, actorId, "READ");
  const r = await prisma.userMatrix.findMany({ distinct: ["year"], select: { year: true }, orderBy: { year: "asc" } });
  return r.map((x) => x.year);
}

export { currentYear };
