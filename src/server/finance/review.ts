import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { CATEGORY_LABEL, Dec, sumDec, type FinanceCategory } from "@/domain/finance";
import { recordAudit } from "@/server/audit";
import { authorize } from "@/server/authorize";
import { DomainError, StaleVersionError } from "@/server/errors";
import { adminTransaction } from "@/server/tx";
import { getSettings } from "@/server/economics/settings";
import type { Db } from "../uploads/profile";
import { resolutionCtes } from "./resolve";

type Tx = Prisma.TransactionClient;

/**
 * Revisión de un lote financiero (CSAPP-05 §5-§6): controles, conciliación, resolución BC, decisiones, impacto de la sustitución y
 * bloqueos de confirmación. Todo se calcula en servidor por SQL de conjuntos sobre el staging; el navegador no decide nada.
 * Los importes viajan como texto decimal exacto; nunca pasan por `Number`.
 */

export const DECISION_KINDS = [
  "EMPTY_AS_ZERO",
  "YEAR_ASSIGNMENT",
  "ACCEPT_UNASSIGNED",
  "ACCEPT_COLLISION",
  "ACK_UNVERIFIED_FOOTER",
  "ACK_NO_TOTAL",
  "ACK_RETROCESO",
] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

export const DECISION_LABEL: Record<DecisionKind, string> = {
  EMPTY_AS_ZERO: "Tratar las Vta Potencial vacías como cero en este lote",
  YEAR_ASSIGNMENT: "Asignación anual explícita de un grupo de origen",
  ACCEPT_UNASSIGNED: "Activar con importes sin asignar (cobertura parcial)",
  ACCEPT_COLLISION: "Varias denominaciones del mismo grupo son ingresos distintos",
  ACK_UNVERIFIED_FOOTER: "Declaro la categoría/filtros y la cobertura completa (pie no verificable)",
  ACK_NO_TOTAL: "He revisado la ausencia del control Total",
  ACK_RETROCESO: "Reconozco que la extracción declarada es anterior a la del conjunto activo",
};

export type Blocker = { code: string; message: string };

export type FinanceAnalysis = {
  batchId: string;
  status: string;
  version: number;
  profileId: string;
  year: number;
  category: FinanceCategory;
  origin: string;
  declaredExtraction: string | null;
  tolerance: string;
  controls: {
    sheet: string | null;
    footer: { lines: string[]; hasMarker: boolean; status: "ok" | "mismatch" | "unverifiable"; message: string; explicitYear: number | null; currentYearFilter: boolean; matched: string[] };
    totals: { position: number; vta: string | null; dif: string | null }[];
    totalCount: number;
    distinctTotals: number;
  };
  counts: { economic: number; duplicates: number; control: number; errors: number; emptyIncome: number; canonicalGroups: number };
  sums: { gross: string; duplicates: string; unique: string; uniqueDiff: string; attributed: string; unassigned: string };
  reconciliation: {
    totalPresent: boolean;
    controlIncome: string | null;
    difference: string | null;
    reconciled: boolean | null;
    diffControl: { sum: string; total: string; difference: string } | null;
  };
  resolution: { resolved: number; decision: number; ambiguous: number; unresolved: number; unresolvedRows: number };
  ambiguousList: { key: string; label: string; income: string | null; candidates: { groupId: string; groupName: string; intervals: { from: string | null; to: string | null }[] }[] }[];
  unresolvedList: { key: string; label: string; income: string | null }[];
  collisions: { groupId: string; groupName: string; keys: { key: string; label: string; income: string | null }[] }[];
  impact: {
    activeBatchId: string | null;
    activeBatchName: string | null;
    activeExtraction: string | null;
    previousTotal: string | null;
    newTotal: string;
    variation: string | null;
    previousGroups: number;
    newGroups: number;
    groups: { added: number; modified: number; retired: number; unchanged: number };
    sourceRows: { previous: number; next: number };
  };
  decisions: { kind: DecisionKind; key: string; value: unknown; reason: string | null; decidedAt: string; decidedByEmail: string }[];
  blockers: Blocker[];
  review: { reviewedAt: string | null; reviewedByEmail: string | null; reviewedScopeVersion: number | null; currentScopeVersion: number; reviewedActiveBatchId: string | null; upToDate: boolean };
  scope: { version: number; activeBatchId: string | null };
};

const text = (v: unknown): string | null => (v === null || v === undefined ? null : (Dec.parse(String(v))?.toString() ?? String(v)));
const n = (v: unknown) => Number(v ?? 0);

export async function ensureScope(tx: Tx, year: number, category: string) {
  await tx.$executeRaw(Prisma.sql`INSERT INTO "FinanceScope" (year, category) VALUES (${year}, ${category}) ON CONFLICT (year, category) DO NOTHING`);
  const r = await tx.$queryRaw<{ version: number; activeBatchId: string | null }[]>(Prisma.sql`
    SELECT version, "activeBatchId" FROM "FinanceScope" WHERE year = ${year} AND category = ${category} FOR UPDATE`);
  return r[0];
}

async function readScope(db: Db, year: number, category: string) {
  const r = await db.$queryRaw<{ version: number; activeBatchId: string | null }[]>(Prisma.sql`
    SELECT version, "activeBatchId" FROM "FinanceScope" WHERE year = ${year} AND category = ${category}`);
  return r[0] ?? { version: 0, activeBatchId: null };
}

const UNIQUE_ECON = (batchId: string) => Prisma.sql`
  SELECT r.position::text AS ref, r.typed->>'key' AS key FROM "UploadStagedRow" r
  WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' AND r."duplicateInFile" = false AND r.derived->>'kind' IN ('ECON', 'TEXT')`;

/** Calcula la revisión completa del lote. `toleranceOverride` permite comprobar el resultado con otra tolerancia (obsolescencia). */
export async function computeAnalysis(db: Db, batchId: string, opts: { toleranceOverride?: string } = {}): Promise<FinanceAnalysis | null> {
  const batch = await db.uploadBatch.findUnique({
    where: { id: batchId },
    select: { id: true, status: true, version: true, profileId: true, declaredExtractionDate: true, financeBatch: true },
  });
  const fb = batch?.financeBatch;
  if (!batch || !fb) return null;
  const year = fb.year;
  const category = fb.category as FinanceCategory;
  const tolerance = Dec.parse(opts.toleranceOverride ?? fb.tolerance.toFixed()) ?? Dec.ZERO;
  const controls = fb.controls as FinanceAnalysis["controls"];

  const [cnt] = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT
      count(*) FILTER (WHERE classification = 'VALID' AND derived->>'kind' IN ('ECON','TEXT') AND NOT "duplicateInFile") AS econ,
      count(*) FILTER (WHERE classification = 'VALID' AND derived->>'kind' IN ('ECON','TEXT') AND "duplicateInFile") AS dups,
      count(*) FILTER (WHERE classification = 'EXCLUDED') AS control,
      count(*) FILTER (WHERE classification = 'ERROR') AS errors,
      count(*) FILTER (WHERE classification = 'VALID' AND derived->>'kind' IN ('ECON','TEXT') AND NOT "duplicateInFile" AND typed->>'vta' IS NULL) AS empties,
      coalesce(sum((typed->>'vta')::numeric) FILTER (WHERE classification = 'VALID' AND derived->>'kind' IN ('ECON','TEXT')), 0)::text AS gross,
      coalesce(sum((typed->>'vta')::numeric) FILTER (WHERE classification = 'VALID' AND derived->>'kind' IN ('ECON','TEXT') AND "duplicateInFile"), 0)::text AS dupsum,
      coalesce(sum((typed->>'vta')::numeric) FILTER (WHERE classification = 'VALID' AND derived->>'kind' IN ('ECON','TEXT') AND NOT "duplicateInFile"), 0)::text AS uniq,
      coalesce(sum((typed->>'dif')::numeric) FILTER (WHERE classification = 'VALID' AND derived->>'kind' IN ('ECON','TEXT') AND NOT "duplicateInFile"), 0)::text AS uniqdiff,
      count(*) FILTER (WHERE classification = 'VALID' AND derived->>'kind' IN ('ECON','TEXT') AND NOT "duplicateInFile" AND typed->>'dif' IS NOT NULL) AS diffrows
    FROM "UploadStagedRow" WHERE "batchId" = ${batchId}`);

  const resRows = await db.$queryRaw<
    { ref: string; key: string; label: string; vta: string | null; group_id: string | null; resolution: string; detail: { identities: { groupId: string; from: string | null; to: string | null }[] }; group_name: string | null }[]
  >(Prisma.sql`
    WITH ${resolutionCtes(UNIQUE_ECON(batchId), batchId, year)}
    SELECT res.ref, res.key, s.derived->>'grupo' AS label, (s.typed->>'vta')::text AS vta, res.group_id, res.resolution, res.detail, g.name AS group_name
    FROM res JOIN "UploadStagedRow" s ON s."batchId" = ${batchId} AND s.position::text = res.ref
    LEFT JOIN "ClientGroup" g ON g.id = res.group_id
    ORDER BY s.position`);

  const income = (r: { vta: string | null }) => (r.vta === null ? null : text(r.vta));
  const amountOf = (r: { vta: string | null }) => Dec.parse(r.vta ?? "0") ?? Dec.ZERO;
  const attributed = sumDec(resRows.filter((r) => r.group_id).map(amountOf));
  const unassigned = sumDec(resRows.filter((r) => !r.group_id).map(amountOf));
  const unresolvedAll = resRows.filter((r) => r.resolution === "UNRESOLVED");
  const ambiguousAll = resRows.filter((r) => r.resolution === "AMBIGUOUS");

  const groupNames = new Map<string, string>();
  const need = [...new Set(ambiguousAll.flatMap((r) => r.detail.identities.map((i) => i.groupId)))];
  if (need.length > 0) {
    for (const g of await db.clientGroup.findMany({ where: { id: { in: need } }, select: { id: true, name: true } })) groupNames.set(g.id, g.name);
  }
  const ambiguousList = ambiguousAll.slice(0, 100).map((r) => {
    const byGroup = new Map<string, { from: string | null; to: string | null }[]>();
    for (const i of r.detail.identities) byGroup.set(i.groupId, [...(byGroup.get(i.groupId) ?? []), { from: i.from, to: i.to }]);
    return {
      key: r.key,
      label: r.label,
      income: income(r),
      candidates: [...byGroup.entries()].map(([groupId, intervals]) => ({ groupId, groupName: groupNames.get(groupId) ?? groupId, intervals })),
    };
  });

  // Colisiones: varias denominaciones distintas que terminan en el mismo grupo canónico.
  const byGroup = new Map<string, typeof resRows>();
  for (const r of resRows) if (r.group_id) byGroup.set(r.group_id, [...(byGroup.get(r.group_id) ?? []), r]);
  const collisions = [...byGroup.entries()]
    .filter(([, rows]) => new Set(rows.map((r) => r.key)).size > 1)
    .map(([groupId, rows]) => ({ groupId, groupName: rows[0].group_name ?? groupId, keys: rows.map((r) => ({ key: r.key, label: r.label, income: income(r) })) }));

  // Reconciliación contra Total (nunca se importa el Total como un ingreso ni se usa para ajustar los detalles).
  const single = controls.distinctTotals === 1 ? controls.totals[0] : null;
  const uniqueSum = Dec.parse(String(cnt.uniq)) ?? Dec.ZERO;
  const totalDec = single?.vta ? Dec.parse(single.vta) : null;
  const diffTotalDec = single?.dif ? Dec.parse(single.dif) : null;
  const difference = totalDec ? uniqueSum.sub(totalDec) : null;
  const reconciled = totalDec && difference ? difference.abs().cmp(tolerance) <= 0 : null;
  const uniqueDiffSum = Dec.parse(String(cnt.uniqdiff)) ?? Dec.ZERO;

  // Impacto frente al conjunto vigente (conjuntos canónicos: grupo resuelto o clave de origen sin asignar).
  const scope = await readScope(db, year, category);
  const impact = await impactOf(db, batchId, year, category, scope.activeBatchId);

  const decisionsRaw = await db.financeDecision.findMany({ where: { batchId }, include: { decidedBy: { select: { email: true } } }, orderBy: { id: "asc" } });
  const decisions = decisionsRaw.map((d) => ({
    kind: d.kind as DecisionKind,
    key: d.key,
    value: d.value,
    reason: d.reason,
    decidedAt: d.decidedAt.toISOString(),
    decidedByEmail: d.decidedBy.email,
  }));
  const dec = (k: DecisionKind, key = "") => decisions.find((d) => d.kind === k && d.key === key);

  const blockers: Blocker[] = [];
  const nEcon = n(cnt.econ);
  const empties = n(cnt.empties);
  const fmt = (v: string | Dec | null) => (v === null ? "—" : (typeof v === "string" ? Dec.parse(v) : v)?.toFixed(2) ?? "—");
  if (n(cnt.errors) > 0) blockers.push({ code: "ERRORS", message: `Hay ${n(cnt.errors)} fila(s) con errores obligatorios: corrija el archivo, súbalo de nuevo y cancele este lote.` });
  if (nEcon === 0) blockers.push({ code: "EMPTY_SET", message: "El archivo no contiene ninguna fila económica (solo Total/pie o vacío): no se acepta como orden de borrado del conjunto." });
  if (controls.footer.status === "mismatch") blockers.push({ code: "FOOTER_MISMATCH", message: `Categoría equivocada: ${controls.footer.message}` });
  if (controls.footer.explicitYear !== null && controls.footer.explicitYear !== year) {
    blockers.push({ code: "YEAR_MISMATCH", message: `El pie declara el año ${controls.footer.explicitYear}, distinto del año seleccionado (${year}).` });
  }
  if (controls.footer.status === "unverifiable" && !dec("ACK_UNVERIFIED_FOOTER")) {
    blockers.push({ code: "FOOTER_UNVERIFIED", message: `No se pudo verificar la categoría/filtros: ${controls.footer.message} Declare expresamente la categoría, los filtros y la cobertura completa.` });
  }
  if (controls.distinctTotals > 1) blockers.push({ code: "TOTALS_INCOMPATIBLE", message: `El archivo contiene ${controls.distinctTotals} totales incompatibles: corrija el archivo.` });
  if (controls.totalCount === 0 && !dec("ACK_NO_TOTAL")) {
    blockers.push({ code: "NO_TOTAL", message: "El archivo no tiene fila Total: no se puede conciliar. Registre que ha revisado la ausencia de este control." });
  }
  if (totalDec && reconciled === false && difference) {
    blockers.push({ code: "RECONCILIATION", message: `La suma de filas únicas (${fmt(uniqueSum)} €) no concilia con el Total (${fmt(totalDec)} €): diferencia ${fmt(difference)} € > tolerancia ${fmt(tolerance)} €.` });
  }
  if (empties > 0) {
    const d = dec("EMPTY_AS_ZERO");
    if (!d) blockers.push({ code: "EMPTY_INCOME", message: `${empties} fila(s) con Vta Potencial vacía: sin decisión se conservan como desconocidas y no se activa un conjunto económico incompleto. Decida tratarlas como cero (exige Total conciliado) o corrija el archivo.` });
    else if (!totalDec || reconciled !== true) blockers.push({ code: "EMPTY_ZERO_INVALID", message: "La decisión de tratar los vacíos como cero exige un Total presente y conciliado." });
    else if ((d.value as { rows?: number } | null)?.rows !== empties) blockers.push({ code: "EMPTY_ZERO_STALE", message: "La decisión de vacíos como cero ya no coincide con las filas afectadas: vuelva a tomarla." });
  }
  if (ambiguousAll.length > 0) {
    blockers.push({ code: "AMBIGUOUS", message: `${ambiguousAll.length} grupo(s) de origen apuntan a Grupos Cliente distintos dentro del año: indique la asignación anual explícita o corrija la fuente.` });
  }
  const unCollided = collisions.filter((c) => !dec("ACCEPT_COLLISION", c.groupId));
  if (unCollided.length > 0) blockers.push({ code: "COLLISION", message: `${unCollided.length} grupo(s) canónicos reciben varias denominaciones de origen: revise la colisión y confirme si son ingresos distintos.` });
  if (unresolvedAll.length > 0) {
    const d = dec("ACCEPT_UNASSIGNED");
    const v = d?.value as { rows?: number; amount?: string } | null;
    if (!d || v?.rows !== unresolvedAll.length || v?.amount !== unassigned.toString()) {
      blockers.push({
        code: "UNASSIGNED",
        message: `${unresolvedAll.length} fila(s) sin Grupo Cliente (${fmt(sumDec(unresolvedAll.map(amountOf)))} €): complete el maestro y reprocese, o acepte expresamente que queden fuera de los informes atribuidos (cobertura parcial).`,
      });
    }
  }
  const activeExt = impact.activeExtraction;
  if (activeExt && batch.declaredExtractionDate && batch.declaredExtractionDate.toISOString().slice(0, 10) < activeExt && !dec("ACK_RETROCESO")) {
    blockers.push({ code: "RETROCESO", message: `La extracción declarada (${batch.declaredExtractionDate.toISOString().slice(0, 10)}) es anterior a la del conjunto activo (${activeExt}): reconozca el retroceso.` });
  }
  const upToDate = fb.reviewedScopeVersion !== null && fb.reviewedScopeVersion === scope.version && (fb.reviewedActiveBatchId ?? null) === scope.activeBatchId;
  const review = {
    reviewedAt: fb.reviewedAt?.toISOString() ?? null,
    reviewedByEmail: null as string | null,
    reviewedScopeVersion: fb.reviewedScopeVersion,
    currentScopeVersion: scope.version,
    reviewedActiveBatchId: fb.reviewedActiveBatchId,
    upToDate,
  };
  if (fb.reviewedById) review.reviewedByEmail = (await db.user.findUnique({ where: { id: fb.reviewedById }, select: { email: true } }))?.email ?? null;
  if (!upToDate) {
    blockers.push({
      code: "REVIEW",
      message: fb.reviewedScopeVersion === null
        ? "Revise el impacto de la sustitución antes de confirmar."
        : "El conjunto vigente cambió desde que revisó el impacto (otra carga lo sustituyó o lo revirtió): actualice el impacto y confirme de nuevo.",
    });
  }

  return {
    batchId,
    status: batch.status,
    version: batch.version,
    profileId: batch.profileId,
    year,
    category,
    origin: fb.origin,
    declaredExtraction: batch.declaredExtractionDate?.toISOString().slice(0, 10) ?? null,
    tolerance: tolerance.toString(),
    controls,
    counts: { economic: nEcon, duplicates: n(cnt.dups), control: n(cnt.control), errors: n(cnt.errors), emptyIncome: empties, canonicalGroups: impact.newGroups },
    sums: {
      gross: text(cnt.gross) ?? "0",
      duplicates: text(cnt.dupsum) ?? "0",
      unique: uniqueSum.toString(),
      uniqueDiff: uniqueDiffSum.toString(),
      attributed: attributed.toString(),
      unassigned: unassigned.toString(),
    },
    reconciliation: {
      totalPresent: totalDec !== null,
      controlIncome: totalDec?.toString() ?? null,
      difference: difference?.toString() ?? null,
      reconciled,
      diffControl: diffTotalDec ? { sum: uniqueDiffSum.toString(), total: diffTotalDec.toString(), difference: uniqueDiffSum.sub(diffTotalDec).toString() } : null,
    },
    resolution: {
      resolved: resRows.filter((r) => r.resolution === "RESOLVED").length,
      decision: resRows.filter((r) => r.resolution === "DECISION").length,
      ambiguous: ambiguousAll.length,
      unresolved: unresolvedAll.length,
      unresolvedRows: unresolvedAll.length,
    },
    ambiguousList,
    unresolvedList: unresolvedAll.slice(0, 100).map((r) => ({ key: r.key, label: r.label, income: income(r) })),
    collisions,
    impact,
    decisions,
    blockers,
    review,
    scope: { version: scope.version, activeBatchId: scope.activeBatchId },
  };
}

async function impactOf(db: Db, batchId: string, year: number, category: string, activeBatchId: string | null): Promise<FinanceAnalysis["impact"]> {
  const [agg] = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    WITH ${resolutionCtes(UNIQUE_ECON(batchId), batchId, year)},
    nw AS (
      SELECT COALESCE(res.group_id, 'u:' || res.key) AS ck, sum(COALESCE((s.typed->>'vta')::numeric, 0)) AS amount, count(*) AS src
      FROM res JOIN "UploadStagedRow" s ON s."batchId" = ${batchId} AND s.position::text = res.ref GROUP BY 1),
    od AS (
      SELECT COALESCE("groupId", 'u:' || "sourceKey") AS ck, sum(income) AS amount, count(*) AS src
      FROM "FinanceRow" WHERE "batchId" = ${activeBatchId} GROUP BY 1)
    SELECT
      (SELECT coalesce(sum(amount), 0)::text FROM nw) AS new_total, (SELECT count(*) FROM nw) AS new_groups, (SELECT coalesce(sum(src), 0) FROM nw) AS new_src,
      (SELECT coalesce(sum(amount), 0)::text FROM od) AS old_total, (SELECT count(*) FROM od) AS old_groups, (SELECT coalesce(sum(src), 0) FROM od) AS old_src,
      (SELECT count(*) FROM nw WHERE NOT EXISTS (SELECT 1 FROM od WHERE od.ck = nw.ck)) AS added,
      (SELECT count(*) FROM od WHERE NOT EXISTS (SELECT 1 FROM nw WHERE nw.ck = od.ck)) AS retired,
      (SELECT count(*) FROM nw JOIN od ON od.ck = nw.ck WHERE od.amount IS DISTINCT FROM nw.amount) AS modified,
      (SELECT count(*) FROM nw JOIN od ON od.ck = nw.ck WHERE od.amount IS NOT DISTINCT FROM nw.amount) AS unchanged`);
  const active = activeBatchId
    ? await db.uploadBatch.findUnique({ where: { id: activeBatchId }, select: { originalName: true, declaredExtractionDate: true } })
    : null;
  const newTotal = Dec.parse(String(agg.new_total)) ?? Dec.ZERO;
  const prev = activeBatchId ? (Dec.parse(String(agg.old_total)) ?? Dec.ZERO) : null;
  return {
    activeBatchId,
    activeBatchName: active?.originalName ?? null,
    activeExtraction: active?.declaredExtractionDate?.toISOString().slice(0, 10) ?? null,
    previousTotal: prev?.toString() ?? null,
    newTotal: newTotal.toString(),
    variation: prev ? newTotal.sub(prev).toString() : null,
    previousGroups: n(agg.old_groups),
    newGroups: n(agg.new_groups),
    groups: { added: n(agg.added), modified: n(agg.modified), retired: n(agg.retired), unchanged: n(agg.unchanged) },
    sourceRows: { previous: n(agg.old_src), next: n(agg.new_src) },
  };
}

/**
 * Puerta de confirmación y de activación. `blockers` impiden confirmar. En la activación (`activation: true`) se comprueba
 * además, dentro de la transacción con el ámbito bloqueado, que el conjunto revisado sigue siendo el vigente y que un cambio de
 * tolerancia no ha modificado el resultado de la validación; si no, `bounce` explica por qué el lote vuelve a «listo».
 */
export async function evaluateGate(db: Db, batchId: string, opts: { activation?: boolean } = {}): Promise<{ blockers: string[]; bounce?: string; analysis: FinanceAnalysis | null }> {
  const a = await computeAnalysis(db, batchId);
  if (!a) return { blockers: ["El lote no tiene datos financieros preparados."], analysis: null };
  const blockers = a.blockers.map((b) => b.message);
  if (!opts.activation) return { blockers, analysis: a };
  const reasons = a.blockers.filter((b) => b.code !== "ERRORS" || a.counts.errors > 0).map((b) => b.message);
  const current = await getSettings(db);
  if (Dec.parse(current.reconciliationTolerance)?.toString() !== a.tolerance) {
    const again = await computeAnalysis(db, batchId, { toleranceOverride: current.reconciliationTolerance });
    if (again && again.reconciliation.reconciled !== a.reconciliation.reconciled) {
      reasons.unshift("la tolerancia de conciliación cambió desde la preparación y el resultado de la validación es distinto: revise de nuevo.");
    }
  }
  return { blockers, bounce: reasons.length > 0 ? `No se activó: ${reasons.join(" ")}` : undefined, analysis: a };
}

// ---------------------------------------------------------------- Servicios (decisiones y revisión), solo Administrador

async function lockReadyBatch(tx: Tx, batchId: string, expectedVersion?: number) {
  const b = await tx.$queryRaw<{ status: string; version: number; profileId: string }[]>(Prisma.sql`
    SELECT status::text AS status, version, "profileId" FROM "UploadBatch" WHERE id = ${batchId} FOR UPDATE`);
  if (!b[0]) throw new DomainError("Carga no encontrada.");
  if (!b[0].profileId.startsWith("facturacion-")) throw new DomainError("Este lote no es de facturación.");
  if (b[0].status !== "READY") throw new DomainError(`Solo se puede decidir con el lote listo para revisar (estado actual: ${b[0].status}).`);
  if (expectedVersion !== undefined && b[0].version !== expectedVersion) throw new StaleVersionError("El lote");
  return b[0];
}

async function invalidateReview(tx: Tx, batchId: string) {
  await tx.financeBatch.update({ where: { batchId }, data: { reviewedScopeVersion: null, reviewedActiveBatchId: null, reviewedAt: null, reviewedById: null, reviewSnapshot: Prisma.DbNull } });
}

export type DecisionInput = { kind: string; key?: string; groupId?: string; reason?: string; expectedVersion?: number };

export async function decideFinance(actorId: string, batchId: string, input: DecisionInput) {
  const kind = input.kind as DecisionKind;
  if (!DECISION_KINDS.includes(kind)) throw new DomainError("Decisión no reconocida.");
  const reason = (input.reason ?? "").trim().slice(0, 500);
  return adminTransaction(actorId, async (tx, actor) => {
    await lockReadyBatch(tx, batchId, input.expectedVersion);
    const a = await computeAnalysis(tx, batchId);
    if (!a) throw new DomainError("El lote no tiene datos financieros preparados.");
    let key = "";
    let value: Prisma.InputJsonValue = {};
    const need = (msg: string) => {
      if (!reason) throw new DomainError("Revise los campos marcados.", { reason: msg });
    };
    switch (kind) {
      case "EMPTY_AS_ZERO": {
        need("Indique el motivo de tratar los vacíos como cero.");
        if (a.counts.emptyIncome === 0) throw new DomainError("Este lote no tiene Vta Potencial vacías.");
        if (!a.reconciliation.totalPresent) throw new DomainError("Tratar los vacíos como cero exige que el archivo incluya el Total (no se admite por declarar ausente el control).");
        if (a.reconciliation.reconciled !== true) throw new DomainError("Tratar los vacíos como cero exige que la suma concilie con el Total dentro de la tolerancia.");
        value = { rows: a.counts.emptyIncome };
        break;
      }
      case "YEAR_ASSIGNMENT": {
        need("Indique el motivo de la asignación anual.");
        const item = a.ambiguousList.find((x) => x.key === input.key) ?? null;
        const stillAmbiguous = item ?? (a.decisions.some((d) => d.kind === "YEAR_ASSIGNMENT" && d.key === input.key) ? { candidates: [] } : null);
        if (!item && !stillAmbiguous) throw new DomainError("Ese grupo de origen no requiere asignación anual.");
        const candidates = item?.candidates.map((c) => c.groupId) ?? [];
        if (!input.groupId || (candidates.length > 0 && !candidates.includes(input.groupId))) {
          throw new DomainError("Revise los campos marcados.", { groupId: "Elija uno de los Grupos Cliente que las equivalencias señalan para ese año." });
        }
        key = String(input.key);
        value = { groupId: input.groupId };
        break;
      }
      case "ACCEPT_UNASSIGNED": {
        if (a.resolution.unresolved === 0) throw new DomainError("No hay importes sin asignar en este lote.");
        value = { rows: a.resolution.unresolved, amount: a.sums.unassigned };
        break;
      }
      case "ACCEPT_COLLISION": {
        need("Indique por qué son ingresos distintos.");
        const c = a.collisions.find((x) => x.groupId === input.key);
        if (!c) throw new DomainError("Ese grupo no tiene una colisión pendiente.");
        key = c.groupId;
        value = { keys: c.keys.map((k) => k.key) };
        break;
      }
      case "ACK_UNVERIFIED_FOOTER": {
        need("Indique su declaración de categoría, filtros y cobertura.");
        if (a.controls.footer.status !== "unverifiable") throw new DomainError("El pie ya se ha podido verificar o es incompatible: esta declaración no aplica.");
        break;
      }
      case "ACK_NO_TOTAL": {
        need("Indique cómo ha revisado la ausencia del Total.");
        if (a.controls.totalCount > 0) throw new DomainError("El archivo sí tiene Total.");
        break;
      }
      case "ACK_RETROCESO": {
        if (!a.impact.activeExtraction) throw new DomainError("No hay un conjunto activo con extracción declarada anterior.");
        break;
      }
    }
    await tx.financeDecision.upsert({
      where: { batchId_kind_key: { batchId, kind, key } },
      create: { batchId, kind, key, value, reason: reason || null, decidedById: actor.id },
      update: { value, reason: reason || null, decidedById: actor.id, decidedAt: new Date() },
    });
    await invalidateReview(tx, batchId);
    await tx.uploadBatch.update({ where: { id: batchId }, data: { version: { increment: 1 } } });
    await recordAudit(tx, actor, {
      action: "UPDATE",
      entityType: "FinanceDecision",
      entityId: `${batchId}:${kind}:${key}`,
      batchId,
      summary: `Decisión financiera «${DECISION_LABEL[kind]}»${key ? ` (${key})` : ""} en ${CATEGORY_LABEL[a.category]} ${a.year}${reason ? `: ${reason}` : ""}`,
      after: { kind, key, value, reason },
    });
    return { ok: true as const };
  });
}

export async function revokeFinanceDecision(actorId: string, batchId: string, kind: string, key: string, expectedVersion?: number) {
  return adminTransaction(actorId, async (tx, actor) => {
    await lockReadyBatch(tx, batchId, expectedVersion);
    const gone = await tx.financeDecision.deleteMany({ where: { batchId, kind, key } });
    if (gone.count === 0) throw new DomainError("Esa decisión ya no existe.");
    await invalidateReview(tx, batchId);
    await tx.uploadBatch.update({ where: { id: batchId }, data: { version: { increment: 1 } } });
    await recordAudit(tx, actor, { action: "UPDATE", entityType: "FinanceDecision", entityId: `${batchId}:${kind}:${key}`, batchId, summary: `Decisión financiera «${kind}» retirada${key ? ` (${key})` : ""}` });
    return { ok: true as const };
  });
}

/** Registra que el Administrador revisó el impacto contra el conjunto vigente (identificador y versión) en este momento. */
export async function reviewFinanceImpact(actorId: string, batchId: string, expectedVersion?: number) {
  return adminTransaction(actorId, async (tx, actor) => {
    const b = await lockReadyBatch(tx, batchId, expectedVersion);
    const fb = await tx.financeBatch.findUniqueOrThrow({ where: { batchId } });
    // El ámbito se lee bloqueado: la versión registrada es exactamente la que se revisó.
    const scope = await ensureScope(tx, fb.year, fb.category);
    const a = await computeAnalysis(tx, batchId);
    if (!a) throw new DomainError("El lote no tiene datos financieros preparados.");
    await tx.financeBatch.update({
      where: { batchId },
      data: {
        reviewedScopeVersion: scope.version,
        reviewedActiveBatchId: scope.activeBatchId,
        reviewedAt: new Date(),
        reviewedById: actor.id,
        reviewSnapshot: JSON.parse(JSON.stringify({ impact: a.impact, sums: a.sums, reconciliation: a.reconciliation })) as Prisma.InputJsonValue,
      },
    });
    await tx.uploadBatch.update({ where: { id: batchId }, data: { version: { increment: 1 }, statusDetail: null } });
    await recordAudit(tx, actor, {
      action: "UPDATE",
      entityType: "FinanceReview",
      entityId: batchId,
      batchId,
      summary: `Impacto revisado de ${CATEGORY_LABEL[a.category]} ${a.year} frente al conjunto vigente ${scope.activeBatchId ?? "(ninguno)"} versión ${scope.version}`,
      after: { scopeVersion: scope.version, activeBatchId: scope.activeBatchId, impact: a.impact },
    });
    void b;
    return { scopeVersion: scope.version };
  });
}

export async function getFinanceAnalysis(actorId: string, batchId: string) {
  await authorize(prisma, actorId, "ADMIN");
  return computeAnalysis(prisma, batchId);
}
