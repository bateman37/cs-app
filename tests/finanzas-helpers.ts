import { prisma } from "@/lib/db";
import { confirmUpload } from "@/server/uploads/batches";
import { computeAnalysis, decideFinance, reviewFinanceImpact } from "@/server/finance/review";
import { FINANCE_PROFILE_ID, type FinanceCategory } from "@/domain/finance";
import { batch, drain, uploadText } from "./cargas-helpers";
import { financeXlsx, type FinOpts, type FinRow } from "./generators/finance";

export const META = (anio: number, extra: object = {}) => ({ anio, conjuntoCompleto: "si", ...extra });

export async function prepareFin(actorId: string, cat: FinanceCategory, year: number, rows: FinRow[], opts: FinOpts & { declared?: object; metadata?: object; name?: string } = {}) {
  const file = await financeXlsx(rows, { category: cat, ...opts });
  const { id } = await uploadText(actorId, file, { profileId: FINANCE_PROFILE_ID[cat], name: opts.name ?? "facturacion.xlsx", metadata: opts.metadata ?? META(year), declared: opts.declared });
  await drain();
  return batch(id);
}

/** Prepara, revisa el impacto y confirma/activa. Falla si el lote no termina COMPLETED. */
export async function importFin(actorId: string, cat: FinanceCategory, year: number, rows: FinRow[], opts: FinOpts & { declared?: object; metadata?: object; decide?: (id: string) => Promise<void>; unassigned?: boolean } = {}) {
  // Salvo que la prueba pida lo contrario, cada grupo de origen se da de alta en el maestro (una equivalencia BC por clave) para que resuelva.
  if (!opts.unassigned) {
    for (const r of rows) {
      const key = (r.grupo ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!key) continue;
      if (await prisma.externalIdentity.count({ where: { system: "BC", kind: "GROUP_KEY", searchValue: key } })) continue;
      const g = await prisma.clientGroup.create({ data: { name: `G ${key}` } });
      await prisma.externalIdentity.create({ data: { system: "BC", kind: "GROUP_KEY", rawValue: key, searchValue: key, groupId: g.id } });
    }
  }
  const prepared = await prepareFin(actorId, cat, year, rows, opts);
  if (prepared.status !== "READY") throw new Error(`Lote en ${prepared.status}: ${prepared.statusDetail ?? ""}`);
  if (opts.decide) await opts.decide(prepared.id);
  await reviewFinanceImpact(actorId, prepared.id);
  const cur = await batch(prepared.id);
  await confirmUpload(actorId, prepared.id, { expectedVersion: cur.version });
  await drain();
  const done = await batch(prepared.id);
  if (done.status !== "COMPLETED") throw new Error(`Activación en ${done.status}: ${done.statusDetail ?? done.phase ?? ""}`);
  return done;
}

export async function activeRows(cat: FinanceCategory, year: number) {
  return prisma.$queryRaw<{ label: string; income: string; groupId: string | null; difference: string | null; derivedZero: boolean; original: string | null }[]>`
    SELECT r."groupLabel" AS label, r.income::text AS income, r."groupId", r.difference::text AS difference, r."incomeDerivedZero" AS "derivedZero", r."incomeOriginal" AS original
    FROM "FinanceScope" s JOIN "FinanceRow" r ON r."batchId" = s."activeBatchId" WHERE s.year = ${year} AND s.category = ${cat} ORDER BY r."groupLabel"`;
}

export async function scopeOf(cat: FinanceCategory, year: number) {
  return (await prisma.financeScope.findUnique({ where: { year_category: { year, category: cat } } })) ?? null;
}

export async function activeTotal(cat: FinanceCategory, year: number): Promise<string | null> {
  const r = await prisma.$queryRaw<{ t: string | null }[]>`
    SELECT trim_scale(sum(r.income))::text AS t FROM "FinanceScope" s JOIN "FinanceRow" r ON r."batchId" = s."activeBatchId" WHERE s.year = ${year} AND s.category = ${cat}`;
  return r[0]?.t ?? null;
}

export { computeAnalysis, decideFinance, reviewFinanceImpact };
