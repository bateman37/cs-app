import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { CATEGORY_LABEL, FINANCE_PROFILE_ID, type FinanceCategory } from "@/domain/finance";
import { HISTORIC_SHEET, mapHistoricHeaders, planHistoric, type HistPlan, type HistRow } from "@/domain/finance-history";
import { recordAudit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { adminTransaction } from "@/server/tx";
import { getSettings } from "@/server/economics/settings";
import { readerLimits } from "../uploads/config";
import { readRows } from "../uploads/readers";
import { financeMasterStamp, reresolveRows } from "./resolve";

/**
 * Vía asistida e idempotente para financieros anteriores a 2025 desde la hoja «DATA FACTURACIÓN» (CSAPP-05 §11).
 * Simulación por defecto; por ámbito (año + categoría) omite los que ya tienen un conjunto activo; rechaza 2025 en adelante; nunca se
 * ejecuta en migración, arranque ni instalación (solo la invoca el script manual con --aplicar). La procedencia queda como un lote
 * COMPLETED (origen HISTORICAL) visible en Cargas. Una sustitución posterior usa la revisión/confirmación financiera normal.
 */
export type HistoricResult = {
  plan: HistPlan;
  applied: boolean;
  scopes: { year: number; category: FinanceCategory; rows: number; total: string; conflicts: string[]; outcome: "IMPORTABLE" | "IMPORTADO" | "OMITIDO_YA_ACTIVO" | "BLOQUEADO_POR_CONFLICTO" }[];
};

export async function readHistoricRows(path: string, sheet = HISTORIC_SHEET): Promise<{ header: string[]; rows: HistRow[] }> {
  let header: string[] | null = null;
  const rows: HistRow[] = [];
  for await (const r of readRows(path, { format: "xlsx", limits: readerLimits(), sheet })) {
    if (!header) {
      header = r.cells.map((c) => c.v);
      continue;
    }
    rows.push({ sourceRow: r.rowNumber, cells: r.cells });
  }
  if (!header) throw new DomainError(`La hoja «${sheet}» está vacía o no existe.`);
  return { header, rows };
}

export async function importHistoricFinance(actorId: string, input: { header: string[]; rows: HistRow[]; apply?: boolean; fileLabel?: string }): Promise<HistoricResult> {
  const mapped = mapHistoricHeaders(input.header);
  if (!mapped.ok) throw new DomainError(mapped.message);
  const plan = planHistoric(mapped.index, mapped.ignored, input.rows);
  const apply = input.apply === true;
  const out: HistoricResult["scopes"] = [];
  for (const s of plan.scopes) {
    const active = await prisma.financeScope.findUnique({ where: { year_category: { year: s.year, category: s.category } } });
    const base = { year: s.year, category: s.category, rows: s.items.length, total: s.total, conflicts: s.conflicts };
    if (active?.activeBatchId) {
      out.push({ ...base, outcome: "OMITIDO_YA_ACTIVO" });
      continue;
    }
    if (s.conflicts.length > 0) {
      out.push({ ...base, outcome: "BLOQUEADO_POR_CONFLICTO" });
      continue;
    }
    if (!apply) {
      out.push({ ...base, outcome: "IMPORTABLE" });
      continue;
    }
    const done = await adminTransaction(actorId, async (tx, actor) => {
      await tx.$executeRaw(Prisma.sql`INSERT INTO "FinanceScope" (year, category) VALUES (${s.year}, ${s.category}) ON CONFLICT (year, category) DO NOTHING`);
      const cur = await tx.$queryRaw<{ activeBatchId: string | null }[]>(Prisma.sql`SELECT "activeBatchId" FROM "FinanceScope" WHERE year = ${s.year} AND category = ${s.category} FOR UPDATE`);
      if (cur[0]?.activeBatchId) return false; // otra ejecución ganó la carrera: idempotente
      const settings = await getSettings(tx);
      const batch = await tx.uploadBatch.create({
        data: {
          profileId: FINANCE_PROFILE_ID[s.category], profileVersion: 1, status: "COMPLETED", originalName: `${input.fileLabel ?? HISTORIC_SHEET} (histórico asistido ${s.year})`,
          storageId: `historico-${randomUUID()}`, fileFormat: "xlsx", metadata: { anio: s.year, origen: "HISTORICO" }, scopeKey: String(s.year), phase: "Completado",
          rowsReceived: s.items.length, rowsValid: s.items.length, rowsImported: s.items.length, createdById: actor.id, confirmedById: actor.id, confirmedAt: new Date(), finishedAt: new Date(),
          coverageNote: "Histórico asistido sin Total de control: cobertura no confirmada.",
        },
      });
      await tx.financeBatch.create({
        data: {
          batchId: batch.id, year: s.year, category: s.category, origin: "HISTORICAL", controls: { historic: true, sheet: HISTORIC_SHEET, ignoredColumns: plan.ignoredColumns, skippedRows: plan.skipped.length },
          tolerance: settings.reconciliationTolerance, settingsRevisionId: BigInt(settings.revisionId), derivedStamp: await financeMasterStamp(tx),
        },
      });
      let pos = 0;
      for (const i of s.items) {
        pos++;
        await tx.financeRow.create({
          data: { batchId: batch.id, position: pos, sourceRow: i.sourceRow, groupLabel: i.groupLabel, sourceKey: i.sourceKey, fingerprint: `${i.sourceKey}|${i.income}`, income: i.income, incomeOriginal: i.income },
        });
      }
      await reresolveRows(tx, batch.id, s.year);
      await tx.$executeRaw(Prisma.sql`UPDATE "FinanceScope" SET "activeBatchId" = ${batch.id}, version = version + 1, "updatedAt" = now() WHERE year = ${s.year} AND category = ${s.category}`);
      await recordAudit(tx, actor, {
        action: "ACTIVATE", entityType: "UploadBatch", entityId: batch.id, batchId: batch.id,
        summary: `Financiero histórico ${CATEGORY_LABEL[s.category]} ${s.year} incorporado desde «${HISTORIC_SHEET}»: ${s.items.length} grupos, ${s.total} €`,
        after: { year: s.year, category: s.category, filas: s.items.length, total: s.total },
      });
      return true;
    });
    out.push({ ...base, outcome: done ? "IMPORTADO" : "OMITIDO_YA_ACTIVO" });
  }
  return { plan, applied: apply, scopes: out };
}
