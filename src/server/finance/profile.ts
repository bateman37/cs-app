import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { cleanText } from "@/domain/normalize";
import {
  CATEGORY_LABEL,
  CATEGORY_OF_PROFILE,
  FINANCE_CATEGORIES,
  FINANCE_PROFILE_ID,
  FINANCE_RULES,
  HEADERS,
  checkFooter,
  groupSearchKey,
  isValidFinanceYear,
  parseAmountCell,
  type FinanceCategory,
} from "@/domain/finance";
import { mapHeaders } from "@/domain/zendesk";
import { getSettings } from "@/server/economics/settings";
import type { ActivationContext, HeaderMatch, ImportProfile, Issue, ParsedRow } from "../uploads/profile";
import type { Cell } from "../uploads/readers/types";
import { evaluateGate, ensureScope } from "./review";
import { financeMasterStamp, reresolveRows, resolutionCtes } from "./resolve";

type Tx = Prisma.TransactionClient;
type Ctx = { index: { group: number; income: number; diff: number } };

const err = (code: string, message: string, column?: string): Issue => ({ severity: "error", code, message, column });

const TOTAL_LABEL = /^(total|totales|total general|gran total|suma total)$/;
const SUBTOTAL_LABEL = /^sub ?total/;
const fold = (s: string) => cleanText(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function matchHeaders(row: string[]): HeaderMatch {
  const m = mapHeaders(row, [HEADERS.group, HEADERS.income, HEADERS.diff]);
  if (!m.ok) {
    return { ok: false, message: `El archivo no corresponde a una facturación anual (Grupo cliente, Vta Potencial, Diferencia): ${m.message}.` };
  }
  const notes = m.extras.length > 0 ? [`Columnas adicionales conservadas y no utilizadas: ${m.extras.join(", ")}.`] : [];
  return {
    ok: true,
    schemaVersion: "v1-grupo-vta-diferencia",
    context: { index: { group: m.index[HEADERS.group], income: m.index[HEADERS.income], diff: m.index[HEADERS.diff] } } satisfies Ctx,
    notes,
  };
}

/**
 * Una fila de datos. Clasifica por contenido: importe económico; fila Total; marca del pie «Filtros aplicados»; texto sin importes
 * (candidata a línea del pie o a fila sin importes, la decide la posición en postPrepare); y errores (fila sin grupo con importes,
 * subtotal intermedio, importe ilegible o fórmula sin valor almacenado). Nunca evalúa fórmulas ni lee enlaces.
 */
function parseRow(cells: Cell[], context?: unknown): ParsedRow {
  const { index } = context as Ctx;
  const issues: Issue[] = [];
  const label = cleanText(cells[index.group]?.v ?? "");
  const income = parseAmountCell(cells[index.income]);
  const diff = parseAmountCell(cells[index.diff]);
  if (!income.ok) issues.push(err(income.code, `Vta Potencial: ${income.reason}.`, HEADERS.income));
  if (!diff.ok) issues.push(err(diff.code, `Diferencia: ${diff.reason}.`, HEADERS.diff));
  const vta = income.ok && income.kind === "value" ? income.text : null;
  const dif = diff.ok && diff.kind === "value" ? diff.text : null;
  const derived = {
    grupo: label,
    vtaOriginal: income.ok && income.kind === "value" ? income.original : null,
    difOriginal: diff.ok && diff.kind === "value" ? diff.original : null,
  };
  const noAmounts = income.ok && income.kind === "empty" && diff.ok && diff.kind === "empty";
  const f = fold(label);

  if (label === "") {
    if (noAmounts) return { typed: { key: "", vta: null, dif: null }, issues, control: { kind: "EMPTY" } };
    issues.push(err("FILA_SIN_GRUPO", "La fila tiene importes pero no «Grupo cliente»: es una línea desconocida o un subtotal intermedio y no se ignora.", HEADERS.group));
    return { typed: { key: "", vta, dif }, issues };
  }
  if (/^filtros aplicados/.test(f)) return { typed: { key: "", vta: null, dif: null }, issues, control: { kind: "FOOTER_MARK" }, derived };
  if (TOTAL_LABEL.test(f)) return { typed: { key: "", vta, dif }, issues, control: { kind: "TOTAL" }, derived };
  if (SUBTOTAL_LABEL.test(f)) {
    issues.push(err("SUBTOTAL_INTERMEDIO", "Subtotal intermedio: no es un cliente ni el Total del archivo y no se ignora.", HEADERS.group));
    return { typed: { key: "", vta, dif }, issues };
  }
  const key = groupSearchKey(label);
  return {
    typed: { key, vta, dif },
    issues,
    // La huella usa la clave normalizada y los importes canónicos: «ACME» y «acme » con los mismos importes son el mismo registro.
    // Clave de entidad: un mismo grupo de origen con importes contradictorios bloquea (conflict_all); idénticos cuentan una vez.
    entityKey: key,
    derived: { kind: noAmounts ? "TEXT" : "ECON", ...derived },
  };
}

// ---------------------------------------------------------------- Posproceso (posición de controles, pie, totales)

async function postPrepare(tx: Tx, batchId: string, category: FinanceCategory): Promise<void> {
  const b = await tx.uploadBatch.findUniqueOrThrow({ where: { id: batchId }, select: { metadata: true, declaredExtractionDate: true } });
  const meta = (b.metadata ?? {}) as { anio?: number | string };
  const year = Number(meta.anio);

  // 1. Todo lo posterior a «Filtros aplicados» es pie: se conserva como evidencia y no es cliente ni error.
  await tx.$executeRaw(Prisma.sql`
    UPDATE "UploadStagedRow" r SET classification = 'EXCLUDED', fingerprint = NULL, "entityKey" = NULL, "duplicateInFile" = false, disposition = NULL,
      issues = NULL, "hasWarning" = false, derived = '{"kind":"FOOTER_LINE"}'::jsonb
    WHERE r."batchId" = ${batchId} AND r.position > (
      SELECT min(position) FROM "UploadStagedRow" WHERE "batchId" = ${batchId} AND derived->>'kind' = 'FOOTER_MARK')`);
  // 2. Una fila económica o de texto posterior al Total, sin pie que la explique, es una línea desconocida (no se ignora).
  const unknown = [{ severity: "error", code: "LINEA_TRAS_TOTAL", message: "Línea posterior al Total que no es un pie «Filtros aplicados»: línea desconocida o subtotal intermedio." }];
  await tx.$executeRaw(Prisma.sql`
    UPDATE "UploadStagedRow" r SET classification = 'ERROR', fingerprint = NULL, "entityKey" = NULL, "duplicateInFile" = false, disposition = NULL,
      issues = COALESCE(r.issues, '[]'::jsonb) || ${JSON.stringify(unknown)}::jsonb, "hasWarning" = false
    WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' AND r.derived->>'kind' IN ('ECON', 'TEXT') AND r.position > (
      SELECT min(position) FROM "UploadStagedRow" WHERE "batchId" = ${batchId} AND derived->>'kind' = 'TOTAL')`);

  // 3. Controles: filtros del pie, totales declarados.
  const footerRows = await tx.$queryRaw<{ raw: unknown }[]>(Prisma.sql`
    SELECT raw FROM "UploadStagedRow" WHERE "batchId" = ${batchId} AND derived->>'kind' IN ('FOOTER_MARK', 'FOOTER_LINE') ORDER BY position`);
  const lines = footerRows.map((r) => (r.raw as [string, string][]).map((c) => (Array.isArray(c) ? c[0] : "")).filter((v) => v.trim() !== "").join(" "));
  const footer = checkFooter(lines, category);
  const totals = await tx.$queryRaw<{ position: number; vta: string | null; dif: string | null }[]>(Prisma.sql`
    SELECT position, typed->>'vta' AS vta, typed->>'dif' AS dif FROM "UploadStagedRow"
    WHERE "batchId" = ${batchId} AND derived->>'kind' = 'TOTAL' AND classification = 'EXCLUDED' ORDER BY position`);
  const distinct = [...new Map(totals.map((t) => [`${t.vta}|${t.dif}`, t])).values()];
  const sheetRow = await tx.$queryRaw<{ sheet: string | null }[]>(Prisma.sql`SELECT sheet FROM "UploadStagedRow" WHERE "batchId" = ${batchId} ORDER BY position LIMIT 1`);
  const settings = await getSettings(tx);
  const controls = {
    sheet: sheetRow[0]?.sheet ?? null,
    footer,
    totals: totals.map((t) => ({ position: t.position, vta: t.vta, dif: t.dif })),
    totalCount: totals.length,
    distinctTotals: distinct.length,
  };
  const single = distinct.length === 1 ? distinct[0] : null;
  const stamp = await financeMasterStamp(tx);

  await tx.$executeRaw(Prisma.sql`DELETE FROM "FinanceRow" WHERE "batchId" = ${batchId}`);
  await tx.$executeRaw(Prisma.sql`DELETE FROM "FinanceBatch" WHERE "batchId" = ${batchId}`);
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "FinanceBatch" ("batchId", year, category, origin, "extractionDate", controls, "controlIncome", "controlDiff", tolerance, "settingsRevisionId", "derivedStamp")
    VALUES (${batchId}, ${year}::int, ${category}, 'UPLOAD', ${b.declaredExtractionDate}::date, ${JSON.stringify(controls)}::jsonb,
      ${single?.vta ?? null}::numeric, ${single?.dif ?? null}::numeric, ${settings.reconciliationTolerance}::numeric, ${settings.revisionId}::bigint, ${stamp})`);
}

// ---------------------------------------------------------------- Activación, reversión y recálculo

const U_STAGED = (batchId: string) => Prisma.sql`
  SELECT r.position::text AS ref, r.typed->>'key' AS key FROM "UploadStagedRow" r
  WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' AND r."duplicateInFile" = false AND r.derived->>'kind' IN ('ECON', 'TEXT')`;

async function activate(tx: Tx, ctx: ActivationContext) {
  const fb = await tx.financeBatch.findUniqueOrThrow({ where: { batchId: ctx.batchId } });
  await ensureScope(tx, fb.year, fb.category);
  const zero = (await tx.financeDecision.count({ where: { batchId: ctx.batchId, kind: "EMPTY_AS_ZERO" } })) > 0;
  await tx.$executeRaw(Prisma.sql`DELETE FROM "FinanceRow" WHERE "batchId" = ${ctx.batchId}`);
  const inserted = await tx.$executeRaw(Prisma.sql`
    WITH ${resolutionCtes(U_STAGED(ctx.batchId), ctx.batchId, fb.year)}
    INSERT INTO "FinanceRow" ("batchId", position, "sourceRow", "groupLabel", "sourceKey", fingerprint, occurrences, "incomeOriginal", income, "incomeDerivedZero",
      "differenceOriginal", difference, "groupId", resolution, "resolutionDetail")
    SELECT ${ctx.batchId}, s.position, s."sourceRow", COALESCE(s.derived->>'grupo', s.typed->>'key'), s.typed->>'key', s.fingerprint,
      (SELECT count(*) FROM "UploadStagedRow" d WHERE d."batchId" = s."batchId" AND d.fingerprint = s.fingerprint AND d.classification = 'VALID')::int,
      s.derived->>'vtaOriginal', COALESCE((s.typed->>'vta')::numeric, CASE WHEN ${zero} THEN 0::numeric END),
      (s.typed->>'vta') IS NULL AND ${zero}, s.derived->>'difOriginal', (s.typed->>'dif')::numeric,
      res.group_id, res.resolution, res.detail
    FROM "UploadStagedRow" s JOIN res ON res.ref = s.position::text
    WHERE s."batchId" = ${ctx.batchId}`);
  const stamp = await financeMasterStamp(tx);
  await tx.financeBatch.update({ where: { batchId: ctx.batchId }, data: { derivedStamp: stamp, derivedAt: new Date() } });
  // Un único cambio de puntero deja vigente el conjunto nuevo; el anterior permanece íntegro como evidencia y para la recuperación.
  await tx.$executeRaw(Prisma.sql`UPDATE "FinanceScope" SET "activeBatchId" = ${ctx.batchId}, version = version + 1, "updatedAt" = now() WHERE year = ${fb.year} AND category = ${fb.category}`);
  return { inserted, revised: 0 };
}

async function revert(tx: Tx, ctx: ActivationContext) {
  const fb = await tx.financeBatch.findUniqueOrThrow({ where: { batchId: ctx.batchId } });
  await ensureScope(tx, fb.year, fb.category);
  // Restaura el predecesor completo (su conjunto sigue guardado) o la ausencia de fuente si era el primero; nunca un conjunto vacío «confirmado».
  await tx.$executeRaw(Prisma.sql`
    UPDATE "FinanceScope" SET "activeBatchId" = ${ctx.previousBatchId}, version = version + 1, "updatedAt" = now()
    WHERE year = ${fb.year} AND category = ${fb.category} AND "activeBatchId" = ${ctx.batchId}`);
}

/** Recalcula solo la atribución de un lote completado con los maestros actuales; no toca dinero, año, filtros ni fecha de extracción. */
async function rederive(tx: Tx, ctx: ActivationContext) {
  const fb = await tx.financeBatch.findUniqueOrThrow({ where: { batchId: ctx.batchId } });
  const updated = await reresolveRows(tx, ctx.batchId, fb.year);
  const stamp = await financeMasterStamp(tx);
  await tx.financeBatch.update({ where: { batchId: ctx.batchId }, data: { derivedStamp: stamp, derivedAt: new Date(), derivedVersion: { increment: 1 } } });
  return { updated };
}

// ---------------------------------------------------------------- Perfiles

const yearList = () => {
  const now = new Date().getUTCFullYear();
  const out: { value: string; label: string }[] = [];
  for (let y = now + 1; y >= 2018; y--) out.push({ value: String(y), label: String(y) });
  return out;
};

const metadataSchema = z
  .object({
    anio: z.coerce
      .number({ error: "Indique el año del conjunto." })
      .int("Indique el año como un número entero.")
      .refine((y) => isValidFinanceYear(y), "Año no válido."),
    conjuntoCompleto: z.literal("si", { error: "Confirme que el archivo es el conjunto anual completo de esta categoría." }),
    hoja: z.string().trim().max(120).optional(),
  })
  .strict();

function makeProfile(category: FinanceCategory): ImportProfile {
  const label = `Facturación · ${CATEGORY_LABEL[category].toLowerCase()}`;
  return {
    id: FINANCE_PROFILE_ID[category],
    label,
    description:
      `Conjunto anual completo de ${CATEGORY_LABEL[category]} (Grupo cliente, Vta Potencial, Diferencia). Cada carga sustituye por completo el año y la categoría seleccionados; ` +
      `no es incremental. El año se indica aquí (el pie «Año Actual» no lo informa).`,
    version: 1,
    formats: ["xlsx"],
    policy: "REPLACE_SCOPE",
    get metadataFields() {
      return [
        { name: "anio", label: "Año del conjunto", type: "select" as const, required: true, options: yearList() },
        { name: "conjuntoCompleto", label: "Declaro que el archivo contiene el conjunto anual completo de esta categoría", type: "checkbox" as const, required: true },
        { name: "hoja", label: "Hoja del libro (solo si hay varias compatibles)", type: "text" as const, required: false },
      ];
    },
    metadataSchema: metadataSchema as unknown as z.ZodType<Record<string, unknown>>,
    scopeKey: (m) => String(m.anio),
    sheetFromMetadata: (m) => (typeof m.hoja === "string" && m.hoja.trim() ? m.hoja.trim() : undefined),
    selectsSheet: true,
    entityConflictPolicy: "conflict_all",
    blocksConfirmOnErrors: true,
    matchHeaders,
    parseRow,
    async rulesFingerprint(db) {
      return `${FINANCE_RULES}|${await financeMasterStamp(db)}`;
    },
    postPrepare: (tx, batchId) => postPrepare(tx, batchId, category),
    activate,
    revert,
    rederive,
    async confirmGate(db, batchId) {
      const g = await evaluateGate(db, batchId);
      return g.blockers.length > 0 ? g.blockers.join(" ") : undefined;
    },
    async checkActivation(tx, ctx) {
      return (await evaluateGate(tx, ctx.batchId, { activation: true })).bounce ?? null;
    },
  };
}

export const FINANCE_PROFILES: ImportProfile[] = FINANCE_CATEGORIES.map(makeProfile);
export { CATEGORY_OF_PROFILE };
