import { Prisma } from "@/generated/prisma/client";
import { buildPlan, type Plan, type PlanRow, type RowTyped } from "@/domain/precarga-maestros";
import type { Db } from "../uploads/profile";

type StagedRow = { position: number; sheet: string | null; sourceRow: number; typed: unknown; classification: string; issues: unknown };

/**
 * Filas del lote que alimentan el plan: las válidas sin duplicado exacto del archivo y las excluidas (entradas de prueba o marcadores,
 * con su motivo). Las filas con error y los duplicados exactos no aportan nada al plan (la procedencia de los duplicados queda en el staging).
 */
export async function loadPlanRows(db: Db, batchId: string): Promise<PlanRow[]> {
  const rows = await db.$queryRaw<StagedRow[]>(Prisma.sql`
    SELECT position, sheet, "sourceRow", typed, classification::text AS classification, issues
    FROM "UploadStagedRow"
    WHERE "batchId" = ${batchId} AND typed IS NOT NULL
      AND ((classification = 'VALID' AND NOT "duplicateInFile") OR classification = 'EXCLUDED')
    ORDER BY position`);
  return rows.map((r) => {
    const base = { position: r.position, sheet: r.sheet, sourceRow: r.sourceRow, typed: r.typed as RowTyped };
    if (r.classification !== "EXCLUDED") return base;
    const first = ((r.issues as { code: string; message: string }[] | null) ?? [])[0];
    return { ...base, excluded: { code: first?.code ?? "EXCLUIDA", message: first?.message ?? "Fila excluida de la precarga." } };
  });
}

export async function loadPlan(db: Db, batchId: string): Promise<Plan> {
  return buildPlan(await loadPlanRows(db, batchId));
}
