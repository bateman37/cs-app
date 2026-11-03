import { link, copyFile } from "node:fs/promises";
import { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/access";
import { z } from "zod";
import { cleanText } from "@/domain/normalize";
import { CATEGORY_LABEL, Dec, FINANCE_PROFILE_ID, sumDec, type FinanceCategory } from "@/domain/finance";
import {
  HISTORIC_CHILD_ORIGIN,
  HISTORIC_PROFILE_ID,
  HISTORIC_PROFILE_LABEL,
  HISTORIC_RULES,
  HISTORIC_SCOPE_KEY,
  mapHistoricHeaders,
  parseHistoricRow,
  planHistoric,
  type HistContext,
  type HistPlan,
  type HistRowIn,
  type HistTyped,
} from "@/domain/finance-history";
import { USERS_BASE_YEAR } from "@/domain/usuarios";
import { recordAudit } from "@/server/audit";
import { getSettings } from "@/server/economics/settings";
import { applyHistoricUsersBase, historicYearsOfGroup, type UsersBaseOutcome } from "@/server/usuarios-base";
import type { ActivationContext, Db, HeaderMatch, ImportProfile, Json, ParsedRow } from "../uploads/profile";
import { NonRetryableError } from "../uploads/queue";
import { filePath, newStorageId } from "../uploads/storage";
import type { Cell } from "../uploads/readers/types";
import { ensureScope } from "./review";
import { financeMasterStamp, reresolveRows } from "./resolve";

type Tx = Prisma.TransactionClient;

/**
 * Histórico económico y usuarios (HOTFIX-01 §6-§7). ARQUITECTURA (documentada en docs/importaciones/historico-economico.md):
 *  - UN lote «libro» (perfil `historico-economico`, solo el archivo): conserva el XLSX original, su SHA-256 y todas las filas en el staging.
 *    Es la unidad de confirmación: «Confirmar y activar» aplica TODOS los años y categorías del libro en UNA transacción, o ninguno.
 *  - Al activar se crean lotes hijos COMPLETED por año+categoría con el motor financiero existente (FinanceBatch/FinanceRow/FinanceScope,
 *    sustitución de ámbito año+categoría con puntero atómico). Cada hijo guarda el checksum del original y el identificador del lote libro:
 *    el archivo no se duplica ni se inventa una ruta (el hijo enlaza al mismo contenido con un identificador real del almacén).
 *  - Idempotente: un conjunto con idéntico contenido al vigente no genera otro lote. Años/categorías ausentes del libro no se tocan.
 *  - Usuarios: la columna H se registra por Grupo y categoría (HistoricUserBase) y la matriz del Grupo se inicializa sin pisar valores.
 */

// ---------------------------------------------------------------- Lectura del libro

function matchHeaders(row: string[]): HeaderMatch {
  const m = mapHistoricHeaders(row);
  if (!m.ok) return { ok: false, message: m.message };
  return { ok: true, schemaVersion: HISTORIC_RULES, context: m.context, notes: m.notes };
}

function parseRow(cells: Cell[], context?: unknown): ParsedRow {
  const r = parseHistoricRow(cells, context as HistContext);
  if (r.kind === "EMPTY") return { typed: { key: "" }, issues: [], control: { kind: "EMPTY" } };
  if (r.kind === "ERROR") return { typed: { key: "", error: true, label: r.label }, issues: r.issues };
  return {
    typed: r.typed as unknown as Record<string, Json>,
    issues: r.issues,
    // Un mismo Grupo+año+categoría con contenido contradictorio bloquea todas sus filas; idénticas cuentan una vez.
    entityKey: `${r.typed.year}|${r.typed.category}|${r.typed.key}`,
    derived: { kind: "HIST", grupo: r.label, amountOriginal: r.amountOriginal },
  };
}

/** Filas válidas y únicas del staging, listas para planificar (la misma lectura sirve al resumen, a la activación y a las pruebas). */
export async function loadHistoricRows(db: Db, batchId: string): Promise<HistRowIn[]> {
  const rows = await db.$queryRaw<{ sourceRow: number; typed: HistTyped; derived: { grupo?: string; amountOriginal?: string } }[]>(Prisma.sql`
    SELECT "sourceRow", typed, derived FROM "UploadStagedRow"
    WHERE "batchId" = ${batchId} AND classification = 'VALID' AND "duplicateInFile" = false AND derived->>'kind' = 'HIST' ORDER BY position`);
  return rows.map((r) => ({ typed: r.typed, label: r.derived?.grupo ?? r.typed.key, sourceRow: r.sourceRow, amountOriginal: r.derived?.amountOriginal ?? r.typed.amount }));
}

// ---------------------------------------------------------------- Resolución de Grupos con el maestro

type Ident = { groupId: string; from: Date | null; to: Date | null };
export type KeyState = "RESUELTO" | "AMBIGUO" | "FUERA_DE_VIGENCIA" | "AUSENTE";

async function identitiesOf(db: Db, keys: string[]): Promise<Map<string, Ident[]>> {
  const out = new Map<string, Ident[]>();
  if (keys.length === 0) return out;
  const ids = await db.externalIdentity.findMany({
    where: { system: "BC", kind: "GROUP_KEY", isActive: true, searchValue: { in: keys }, groupId: { not: null } },
    select: { searchValue: true, groupId: true, validFrom: true, validTo: true },
  });
  for (const i of ids) out.set(i.searchValue, [...(out.get(i.searchValue) ?? []), { groupId: i.groupId as string, from: i.validFrom, to: i.validTo }]);
  return out;
}

/** Misma regla de atribución que el motor financiero: todas las equivalencias BC activas cuya vigencia intersecta el año. */
export function stateOfKey(idents: Ident[] | undefined, year: number): { state: KeyState; groupId: string | null } {
  if (!idents || idents.length === 0) return { state: "AUSENTE", groupId: null };
  const from = Date.UTC(year, 0, 1);
  const to = Date.UTC(year + 1, 0, 1);
  const valid = idents.filter((i) => (i.from === null || i.from.getTime() < to) && (i.to === null || i.to.getTime() > from));
  const groups = [...new Set(valid.map((i) => i.groupId))];
  if (groups.length === 0) return { state: "FUERA_DE_VIGENCIA", groupId: null };
  if (groups.length > 1) return { state: "AMBIGUO", groupId: null };
  return { state: "RESUELTO", groupId: groups[0] };
}

// ---------------------------------------------------------------- Estado vigente y huella de ámbitos

type ScopeKey = { year: number; category: FinanceCategory };

async function scopeStamp(db: Db, scopes: ScopeKey[]): Promise<string> {
  const parts: string[] = [];
  for (const s of scopes) {
    const r = await db.financeScope.findUnique({ where: { year_category: { year: s.year, category: s.category } } });
    parts.push(`${s.year}|${s.category}|${r?.activeBatchId ?? "-"}|${r?.version ?? 0}`);
  }
  return parts.join(";");
}

type CurrentScope = { batchId: string; name: string; origin: string; rows: number; total: string; contentHash: string | null; version: number };

async function currentScope(db: Db, s: ScopeKey): Promise<CurrentScope | null> {
  const sc = await db.financeScope.findUnique({ where: { year_category: { year: s.year, category: s.category } } });
  if (!sc?.activeBatchId) return null;
  const [b, fb, agg] = await Promise.all([
    db.uploadBatch.findUnique({ where: { id: sc.activeBatchId }, select: { originalName: true } }),
    db.financeBatch.findUnique({ where: { batchId: sc.activeBatchId }, select: { origin: true, controls: true } }),
    db.$queryRaw<{ n: bigint; total: string }[]>(Prisma.sql`SELECT count(*) AS n, coalesce(sum(income), 0)::text AS total FROM "FinanceRow" WHERE "batchId" = ${sc.activeBatchId}`),
  ]);
  const hist = (fb?.controls as { historic?: { contentHash?: string } } | null)?.historic;
  return { batchId: sc.activeBatchId, name: b?.originalName ?? sc.activeBatchId, origin: fb?.origin ?? "UPLOAD", rows: Number(agg[0]?.n ?? 0), total: Dec.parse(agg[0]?.total ?? "0")?.toString() ?? "0", contentHash: hist?.contentHash ?? null, version: sc.version };
}

// ---------------------------------------------------------------- Resumen (análisis) antes de confirmar

export type HistoricScopeSummary = {
  year: number;
  category: FinanceCategory;
  rows: number;
  /** Σ de B (importe anual) de las filas del libro. */
  total: string;
  /** Σ de E (referencia mensual): informativa, no se suma al ingreso. */
  referenceTotal: string;
  rowsWithB6: number;
  rowsWithServerError: number;
  current: CurrentScope | null;
  outcome: "NUEVO" | "SUSTITUYE" | "SIN_CAMBIOS";
  /** Nuevo total − total vigente (solo si sustituye). */
  difference: string | null;
  groupsResolved: number;
  groupsAmbiguous: number;
  groupsUnassigned: number;
  groupsToCreate: number;
};

export type HistoricAnalysis = {
  batchId: string;
  status: string;
  rowsRead: number;
  rowsValid: number;
  rowsError: number;
  rowsDuplicate: number;
  scopes: HistoricScopeSummary[];
  total: string;
  groups: { distinct: number; inMaster: number; toCreate: { key: string; label: string }[]; ambiguous: string[]; outOfValidity: string[]; nameClash: string[] };
  users: {
    groupsWithValues: number;
    values: number;
    unique: number;
    discrepancies: { key: string; label: string; entries: { category: FinanceCategory; value: number; cell: string; fromFormula: boolean }[] }[];
    fromFormula: string[];
  };
  controls: { b6Cells: string[]; serverErrorCells: string[]; sheet: string | null };
  blockers: string[];
  stamp: { prepared: string | null; current: string; stale: boolean };
};

export function plannedScopes(plan: HistPlan): ScopeKey[] {
  return plan.scopes.map((s) => ({ year: s.year, category: s.category }));
}

export async function computeHistoricAnalysis(db: Db, batchId: string): Promise<HistoricAnalysis | null> {
  const batch = await db.uploadBatch.findUnique({
    where: { id: batchId },
    select: { id: true, status: true, metadata: true, rowsReceived: true, rowsError: true, rowsDuplicate: true, summary: true },
  });
  if (!batch) return null;
  const rows = await loadHistoricRows(db, batchId);
  const plan = planHistoric(rows);
  const keys = plan.groups.map((g) => g.key);
  const idents = await identitiesOf(db, keys);

  // Grupos ausentes del maestro (se crearán como «procedencia histórica») y choques de nombre con un Grupo sin equivalencia BC.
  const missing = plan.groups.filter((g) => !idents.has(g.key));
  const clashRows = missing.length === 0 ? [] : await db.$queryRaw<{ name: string }[]>(Prisma.sql`SELECT name FROM "ClientGroup" WHERE lower(name) = ANY(${missing.map((m) => m.key)})`);
  const clashKeys = new Set(clashRows.map((r) => cleanText(r.name).toLowerCase()));
  const toCreate = missing.filter((m) => !clashKeys.has(m.key)).map((m) => ({ key: m.key, label: m.label }));
  const nameClash = missing.filter((m) => clashKeys.has(m.key)).map((m) => m.label);

  const scopes: HistoricScopeSummary[] = [];
  const ambiguous = new Set<string>();
  const outOfValidity = new Set<string>();
  for (const s of plan.scopes) {
    const cur = await currentScope(db, s);
    let resolved = 0;
    let amb = 0;
    let un = 0;
    let create = 0;
    for (const r of s.rows) {
      const st = stateOfKey(idents.get(r.typed.key), s.year);
      if (st.state === "RESUELTO") resolved++;
      else if (st.state === "AMBIGUO") {
        amb++;
        ambiguous.add(r.label);
      } else if (st.state === "AUSENTE") create++;
      else {
        un++;
        outOfValidity.add(r.label);
      }
    }
    const outcome: HistoricScopeSummary["outcome"] = !cur ? "NUEVO" : cur.contentHash === s.contentHash ? "SIN_CAMBIOS" : "SUSTITUYE";
    scopes.push({
      year: s.year,
      category: s.category,
      rows: s.rows.length,
      total: s.total.toString(),
      referenceTotal: s.referenceTotal.toString(),
      rowsWithB6: s.rowsWithB6,
      rowsWithServerError: s.rowsWithServerError,
      current: cur,
      outcome,
      difference: cur && outcome === "SUSTITUYE" ? s.total.sub(Dec.parse(cur.total) as Dec).toString() : null,
      groupsResolved: resolved,
      groupsAmbiguous: amb,
      groupsUnassigned: un,
      groupsToCreate: create,
    });
  }

  const meta = (batch.metadata ?? {}) as { __hist?: { stamp?: string } };
  const current = await scopeStamp(db, plannedScopes(plan));
  const prepared = meta.__hist?.stamp ?? null;
  const open = !["COMPLETED", "REVERTED", "REJECTED", "CANCELLED", "FAILED"].includes(batch.status);
  const stale = open && prepared !== null && prepared !== current;
  const blockers: string[] = [];
  if (batch.rowsError > 0) blockers.push(`Hay ${batch.rowsError} fila(s) con errores obligatorios: corrija el archivo, súbalo de nuevo y cancele este lote.`);
  if (plan.rowsTotal === 0) blockers.push("El archivo no contiene ninguna fila económica válida.");
  if (nameClash.length > 0) blockers.push(`${nameClash.length} grupo(s) del libro existen en el maestro con ese nombre pero sin equivalencia BC (${nameClash.slice(0, 5).join(", ")}${nameClash.length > 5 ? "…" : ""}): añada la equivalencia BC en el maestro y reprocese; no se crea un duplicado.`);
  if (stale) blockers.push("Los conjuntos financieros afectados cambiaron desde que se preparó este resumen (otra carga los sustituyó o revirtió): pulse «Reprocesar» para actualizar el impacto antes de confirmar.");

  const bUsers = plan.users;
  const summary = (batch.summary ?? {}) as { sheet?: string };
  return {
    batchId,
    status: batch.status,
    rowsRead: batch.rowsReceived,
    rowsValid: plan.rowsTotal,
    rowsError: batch.rowsError,
    rowsDuplicate: batch.rowsDuplicate,
    scopes,
    total: sumDec(plan.scopes.map((s) => s.total)).toString(),
    groups: { distinct: plan.groups.length, inMaster: plan.groups.length - missing.length, toCreate, ambiguous: [...ambiguous], outOfValidity: [...outOfValidity], nameClash },
    users: {
      groupsWithValues: bUsers.length,
      values: bUsers.reduce((n, g) => n + g.entries.length, 0),
      unique: bUsers.filter((g) => g.status === "UNICA").length,
      discrepancies: bUsers.filter((g) => g.status === "DISCREPANCIA").map((g) => ({ key: g.key, label: g.label, entries: g.entries.map((e) => ({ category: e.category, value: e.value, cell: e.cell, fromFormula: e.fromFormula })) })),
      fromFormula: bUsers.flatMap((g) => g.entries.filter((e) => e.fromFormula).map((e) => e.cell)),
    },
    controls: {
      b6Cells: plan.scopes.flatMap((s) => s.rows.filter((r) => r.typed.monthlyRefKind === "B6").map((r) => `E${r.sourceRow}`)),
      serverErrorCells: plan.scopes.flatMap((s) => s.rows.filter((r) => r.typed.serverStatus === "ERROR").map((r) => `G${r.sourceRow}`)),
      sheet: summary.sheet ?? null,
    },
    blockers,
    stamp: { prepared, current, stale },
  };
}

// ---------------------------------------------------------------- Posproceso, puerta y activación

async function postPrepare(tx: Tx, batchId: string): Promise<void> {
  const plan = planHistoric(await loadHistoricRows(tx, batchId));
  const stamp = await scopeStamp(tx, plannedScopes(plan));
  const b = await tx.uploadBatch.findUniqueOrThrow({ where: { id: batchId }, select: { metadata: true } });
  const metadata = { ...((b.metadata ?? {}) as Record<string, unknown>), __hist: { stamp, ruleVersion: HISTORIC_RULES } };
  await tx.uploadBatch.update({ where: { id: batchId }, data: { metadata: metadata as Prisma.InputJsonValue } });
}

async function confirmGate(db: Db, batchId: string): Promise<string | undefined> {
  const a = await computeHistoricAnalysis(db, batchId);
  if (!a) return "El lote no tiene datos preparados.";
  return a.blockers.length > 0 ? a.blockers.join(" ") : undefined;
}

async function checkActivation(tx: Tx, ctx: ActivationContext): Promise<string | null> {
  const a = await computeHistoricAnalysis(tx, ctx.batchId);
  if (!a) return "El lote no tiene datos preparados.";
  // El resumen revisado debe seguir siendo cierto: si algún conjunto cambió desde la preparación (o hay un bloqueo), no se aplica nada.
  return a.blockers.length > 0 ? `No se activó: ${a.blockers.join(" ")}` : null;
}

export type HistoricScopeResult = { year: number; category: FinanceCategory; outcome: "NUEVO" | "SUSTITUIDO" | "SIN_CAMBIOS"; batchId: string; rows: number; total: string; replacedBatchId: string | null; previousTotal: string | null };
export type HistoricResult = {
  scopes: HistoricScopeResult[];
  groupsCreated: { groupId: string; label: string }[];
  users: { initialized: number; conflicts: number; alreadyDecided: number; skippedUnresolved: number };
};

/** Enlaza el archivo original bajo un identificador propio del lote hijo (mismo contenido y checksum; sin rutas inventadas). */
async function shareOriginal(parentStorageId: string, childStorageId: string): Promise<void> {
  const src = filePath(parentStorageId);
  const dst = filePath(childStorageId);
  try {
    await link(src, dst);
  } catch {
    await copyFile(src, dst);
  }
}

async function ensureGroups(tx: Tx, actor: Actor, parent: { id: string }, plan: HistPlan): Promise<{ groupId: string; label: string }[]> {
  const idents = await identitiesOf(tx, plan.groups.map((g) => g.key));
  const created: { groupId: string; label: string }[] = [];
  for (const g of plan.groups) {
    if (idents.has(g.key)) continue;
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`histgroup|${g.key}`}, 0))`);
    if ((await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM "ClientGroup" WHERE lower(name) = ${g.key}`))[0].n > 0n) {
      throw new NonRetryableError(`«${g.label}» ya existe en el maestro sin equivalencia BC: no se crea un duplicado.`);
    }
    const group = await tx.clientGroup.create({ data: { name: g.label, bcDenomination: g.label } });
    await tx.externalIdentity.create({
      data: { system: "BC", kind: "GROUP_KEY", rawValue: g.label, searchValue: g.key, groupId: group.id, note: "Grupo Cliente de procedencia histórica (precarga del histórico económico)" },
    });
    await tx.historicGroupOrigin.create({
      data: { groupId: group.id, sourceBatchId: parent.id, originalLabel: g.label, note: "Procedencia histórica: sin Cliente Zendesk, IDs, implantaciones ni usuarios inventados; su estado comercial actual no se deduce de su ausencia en CLIENTES." },
    });
    await recordAudit(tx, actor, {
      action: "CREATE",
      entityType: "ClientGroup",
      entityId: group.id,
      groupId: group.id,
      batchId: parent.id,
      summary: `Grupo Cliente «${g.label}» creado como procedencia histórica por la precarga del histórico económico (sin Cliente, IDs, implantaciones ni usuarios inventados)`,
      after: { name: g.label, origen: "HISTORICO" },
    });
    created.push({ groupId: group.id, label: g.label });
  }
  return created;
}

async function activate(tx: Tx, ctx: ActivationContext) {
  const parent = await tx.uploadBatch.findUniqueOrThrow({ where: { id: ctx.batchId } });
  const actorId = parent.confirmedById ?? parent.createdById;
  const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { id: true, email: true, role: true } });
  const plan = planHistoric(await loadHistoricRows(tx, ctx.batchId));
  if (plan.scopes.length === 0) throw new NonRetryableError("El libro no contiene filas económicas válidas.");

  // Serializa con cualquier activación financiera normal de los mismos ámbitos (mismo orden determinista: sin interbloqueos).
  for (const s of plan.scopes) {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${FINANCE_PROFILE_ID[s.category]}|${s.year}`}, 0))`);
  }
  const groupsCreated = await ensureGroups(tx, actor, parent, plan);
  const settings = await getSettings(tx);
  const stamp = await financeMasterStamp(tx);
  const sheet = ((parent.summary ?? {}) as { sheet?: string }).sheet ?? null;

  const results: HistoricScopeResult[] = [];
  for (const s of plan.scopes) {
    const sc = await ensureScope(tx, s.year, s.category);
    const cur = await currentScope(tx, s);
    if (cur && cur.contentHash === s.contentHash) {
      results.push({ year: s.year, category: s.category, outcome: "SIN_CAMBIOS", batchId: cur.batchId, rows: cur.rows, total: cur.total, replacedBatchId: null, previousTotal: null });
      continue;
    }
    const prevId = sc.activeBatchId;
    const childStorage = newStorageId();
    const profileId = FINANCE_PROFILE_ID[s.category];
    const child = await tx.uploadBatch.create({
      data: {
        profileId,
        profileVersion: 1,
        status: "COMPLETED",
        originalName: `${parent.originalName} · histórico ${s.year} ${CATEGORY_LABEL[s.category].toLowerCase()}`,
        storageId: childStorage,
        fileFormat: parent.fileFormat,
        sizeBytes: parent.sizeBytes,
        checksum: parent.checksum,
        metadata: { anio: s.year, origen: HISTORIC_CHILD_ORIGIN, loteOrigenId: parent.id, checksumOrigen: parent.checksum } as Prisma.InputJsonValue,
        scopeKey: String(s.year),
        phase: "Completado",
        rowsReceived: s.rows.length,
        rowsValid: s.rows.length,
        rowsImported: s.rows.length,
        coverageNote: "Histórico sin pie de control: cobertura no confirmada (la ausencia de un grupo no acredita ingreso cero).",
        supersedesBatchId: prevId,
        createdById: parent.createdById,
        confirmedById: actor.id,
        confirmedAt: new Date(),
        finishedAt: new Date(),
      },
    });
    await shareOriginal(parent.storageId, childStorage);
    await tx.financeBatch.create({
      data: {
        batchId: child.id,
        year: s.year,
        category: s.category,
        origin: "HISTORICAL",
        controls: {
          historic: {
            ruleVersion: HISTORIC_RULES,
            sourceBatchId: parent.id,
            sourceChecksum: parent.checksum,
            sheet,
            contentHash: s.contentHash,
            annualTotal: s.total.toString(),
            referenceTotal: s.referenceTotal.toString(),
            referenceNote: "E es una referencia mensual (normalmente B/12): no se suma al ingreso anual.",
            rows: s.rows.map((r, i) => ({
              position: i + 1,
              sourceRow: r.sourceRow,
              label: r.label,
              supportLabel: r.typed.supportLabel,
              subtype: null,
              adminFlag: r.typed.adminFlag,
              monthlyRef: r.typed.monthlyRef,
              monthlyRefKind: r.typed.monthlyRefKind,
              server: r.typed.server,
              serverStatus: r.typed.serverStatus,
              users: r.typed.users,
            })),
          },
        } as unknown as Prisma.InputJsonValue,
        tolerance: settings.reconciliationTolerance,
        settingsRevisionId: BigInt(settings.revisionId),
        derivedStamp: stamp,
      },
    });
    await tx.financeRow.createMany({
      data: s.rows.map((r, i) => ({
        batchId: child.id,
        position: i + 1,
        sourceRow: r.sourceRow,
        groupLabel: r.label,
        sourceKey: r.typed.key,
        fingerprint: `${r.typed.key}|${r.typed.amount}`,
        incomeOriginal: r.amountOriginal,
        income: r.typed.amount,
      })),
    });
    await reresolveRows(tx, child.id, s.year);
    if (prevId) await tx.uploadBatch.updateMany({ where: { id: prevId }, data: { supersededByBatchId: child.id } });
    await tx.$executeRaw(Prisma.sql`UPDATE "FinanceScope" SET "activeBatchId" = ${child.id}, version = version + 1, "updatedAt" = now() WHERE year = ${s.year} AND category = ${s.category}`);
    results.push({ year: s.year, category: s.category, outcome: cur ? "SUSTITUIDO" : "NUEVO", batchId: child.id, rows: s.rows.length, total: s.total.toString(), replacedBatchId: prevId, previousTotal: cur?.total ?? null });
    await recordAudit(tx, actor, {
      action: "ACTIVATE",
      entityType: "UploadBatch",
      entityId: child.id,
      batchId: child.id,
      summary: `Histórico económico ${CATEGORY_LABEL[s.category]} ${s.year} incorporado desde el libro (lote ${parent.id}): ${s.rows.length} filas, ${s.total.toString()} €${cur ? `; sustituye al conjunto vigente (${cur.rows} filas, ${cur.total} €)` : ""}`,
      before: cur ? { batchId: cur.batchId, rows: cur.rows, total: cur.total } : null,
      after: { year: s.year, category: s.category, rows: s.rows.length, total: s.total.toString(), checksumOrigen: parent.checksum },
    });
  }

  // Usuarios (columna H): solo los Grupos con atribución inequívoca en 2025.
  const idents = await identitiesOf(tx, plan.users.map((u) => u.key));
  const inputs = [];
  let skippedUnresolved = 0;
  for (const u of plan.users) {
    const st = stateOfKey(idents.get(u.key), USERS_BASE_YEAR);
    if (st.state !== "RESUELTO" || !st.groupId) {
      skippedUnresolved++;
      continue;
    }
    inputs.push({ groupId: st.groupId, entries: u.entries, historicYears: await historicYearsOfGroup(tx, st.groupId) });
  }
  const outcome: UsersBaseOutcome = await applyHistoricUsersBase(tx, actor, parent.id, inputs);
  const result: HistoricResult = {
    scopes: results,
    groupsCreated,
    users: { initialized: outcome.resolved.length, conflicts: outcome.conflicts.length, alreadyDecided: outcome.alreadyDecided, skippedUnresolved },
  };
  const meta = { ...((parent.metadata ?? {}) as Record<string, unknown>) };
  meta.__hist = { ...((meta.__hist ?? {}) as object), result };
  await tx.uploadBatch.update({ where: { id: parent.id }, data: { metadata: meta as Prisma.InputJsonValue } });
  await recordAudit(tx, actor, {
    action: "ACTIVATE",
    entityType: "UploadBatch",
    entityId: parent.id,
    batchId: parent.id,
    summary: `Histórico económico y usuarios aplicado: ${results.filter((r) => r.outcome !== "SIN_CAMBIOS").length} de ${results.length} conjuntos año+categoría escritos (${results.filter((r) => r.outcome === "SIN_CAMBIOS").length} sin cambios); ${groupsCreated.length} Grupo(s) de procedencia histórica; usuarios 2025: ${outcome.resolved.length} Grupo(s) inicializados, ${outcome.conflicts.length} en discrepancia sin resolver`,
    after: result,
  });
  return { inserted: results.filter((r) => r.outcome !== "SIN_CAMBIOS").reduce((n, r) => n + r.rows, 0), revised: 0 };
}

async function childrenOf(db: Db, parentId: string) {
  return db.$queryRaw<{ id: string; year: number; category: string; supersededByBatchId: string | null; supersedesBatchId: string | null }[]>(Prisma.sql`
    SELECT b.id, fb.year, fb.category, b."supersededByBatchId", b."supersedesBatchId"
    FROM "UploadBatch" b JOIN "FinanceBatch" fb ON fb."batchId" = b.id
    WHERE b.metadata->>'loteOrigenId' = ${parentId} AND b.status = 'COMPLETED' ORDER BY fb.year, fb.category`);
}

/**
 * Revierte los conjuntos que ESTE libro escribió (unidad de confirmación): restaura el predecesor de cada año+categoría. Si alguno ya fue sustituido
 * por una carga posterior no se revierte nada (se pide revertir primero la posterior). No borra Grupos de procedencia histórica ni matrices de usuarios
 * (son datos del maestro que pueden tener ajustes manuales).
 */
async function revert(tx: Tx, ctx: ActivationContext) {
  const kids = await childrenOf(tx, ctx.batchId);
  for (const k of kids) {
    if (k.supersededByBatchId) throw new NonRetryableError(`El conjunto ${CATEGORY_LABEL[k.category as FinanceCategory]} ${k.year} de este libro ya fue sustituido por otra carga: revierta primero la posterior.`);
  }
  for (const k of kids) {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${FINANCE_PROFILE_ID[k.category as FinanceCategory]}|${k.year}`}, 0))`);
    await tx.uploadBatch.update({ where: { id: k.id }, data: { status: "REVERTED", phase: "Revertido", supersedesBatchId: null, finishedAt: new Date(), version: { increment: 1 } } });
    if (k.supersedesBatchId) await tx.uploadBatch.update({ where: { id: k.supersedesBatchId }, data: { supersededByBatchId: null } });
    await ensureScope(tx, k.year, k.category);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "FinanceScope" SET "activeBatchId" = ${k.supersedesBatchId}, version = version + 1, "updatedAt" = now()
      WHERE year = ${k.year} AND category = ${k.category} AND "activeBatchId" = ${k.id}`);
  }
}

async function rederive(tx: Tx, ctx: ActivationContext) {
  let updated = 0;
  const stamp = await financeMasterStamp(tx);
  for (const k of await childrenOf(tx, ctx.batchId)) {
    updated += await reresolveRows(tx, k.id, k.year);
    await tx.financeBatch.update({ where: { batchId: k.id }, data: { derivedStamp: stamp, derivedAt: new Date(), derivedVersion: { increment: 1 } } });
  }
  return { updated };
}

export const historicoEconomico: ImportProfile = {
  id: HISTORIC_PROFILE_ID,
  label: HISTORIC_PROFILE_LABEL,
  description:
    "Libro «DATA FACTURACIÓN» con el histórico económico (2022–2025) y los usuarios de 2025. Solo hace falta el archivo: el año, la categoría y la cobertura salen del propio libro. " +
    "Se muestra un resumen por año y categoría con su impacto; «Confirmar y activar» aplica todos los conjuntos del libro o ninguno.",
  note: "Segundo paso de la puesta en marcha, tras los maestros. Repetir la carga no suma ingresos; los años y categorías que el libro no incluye no se tocan.",
  version: 1,
  formats: ["xlsx"],
  policy: "REPLACE_SCOPE",
  metadataFields: [],
  metadataSchema: z.object({}).strict() as unknown as z.ZodType<Record<string, unknown>>,
  scopeKey: () => HISTORIC_SCOPE_KEY,
  selectsSheet: true,
  entityConflictPolicy: "conflict_all",
  blocksConfirmOnErrors: true,
  matchHeaders,
  parseRow,
  async rulesFingerprint(db) {
    return `${HISTORIC_RULES}|${await financeMasterStamp(db)}`;
  },
  postPrepare,
  confirmGate,
  checkActivation,
  activate,
  revert,
  rederive,
};
