import { Prisma } from "@/generated/prisma/client";
import { ticketViewSql } from "@/server/zendesk/derive";

type Tx = Prisma.TransactionClient;

/**
 * Informe de relaciones (HOTFIX-02 §3 y §4): SOLO conteos y cantidades, nunca nombres ni IDs. Clasifica la atribución de cada fuente en
 * coincidencias exactas, enriquecidas (el propio registro aporta Cliente/Grupo compatible), solo Grupo, ambiguas y sin correspondencia, y guarda
 * los totales de fuente que deben conciliar antes y después (filas, minutos, PAP únicos, tickets e ingresos): pasar de «sin asignar» a un Grupo
 * no cambia la cantidad fuente y no puede quedar sumada en dos sitios.
 */
export type Totals = {
  zendeskRows: number; zendeskMinutes: string; wrikeRows: number; wrikeMinutes: string; papItems: number; tickets: number; financeRows: number; financeIncome: string;
};
export type Cls = { exact: number; enriched: number; groupOnly: number; ambiguous: number; unmatched: number; other: number };
export type Weighted = { rows: number; minutes: string };
export type RelationReport = {
  totals: Totals;
  classification: {
    wrike: Record<keyof Cls, Weighted>;
    pap: Cls;
    zendeskByBucket: Record<string, Weighted>;
    tickets: Record<string, number>;
    finance: Record<string, { rows: number; income: string }>;
  };
  before?: Totals;
  updated?: Record<string, number>;
  generation?: number;
  finishedAt?: string;
};

const n = (v: unknown) => Number(v ?? 0);
const s = (v: unknown) => (v === null || v === undefined ? "0" : String(v));

export async function relationReport(tx: Tx): Promise<RelationReport> {
  const [t] = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT
      (SELECT count(*) FROM "ZdTimeEntry") AS "zdRows", (SELECT COALESCE(sum(minutes), 0) FROM "ZdTimeEntry") AS "zdMin",
      (SELECT count(*) FROM "WrikeTimeEntry") AS "wrRows", (SELECT COALESCE(sum(minutes), 0) FROM "WrikeTimeEntry") AS "wrMin",
      (SELECT count(*) FROM "PapItem") AS "pap", (SELECT count(*) FROM "ZdTicket") AS "tickets",
      (SELECT count(*) FROM "FinanceRow") AS "finRows", (SELECT COALESCE(sum(income), 0) FROM "FinanceRow") AS "finIncome"`);
  const totals: Totals = {
    zendeskRows: n(t.zdRows), zendeskMinutes: s(t.zdMin), wrikeRows: n(t.wrRows), wrikeMinutes: s(t.wrMin), papItems: n(t.pap), tickets: n(t.tickets), financeRows: n(t.finRows), financeIncome: s(t.finIncome),
  };

  const wrike = await tx.$queryRaw<{ k: string; rows: bigint; minutes: unknown }[]>(Prisma.sql`
    SELECT CASE
        WHEN 'ALIAS_AMBIGUOUS' = ANY(e."drvFlags") OR e."drvConflict" THEN 'ambiguous'
        WHEN e."drvEligibility" <> 'ELIGIBLE' THEN 'other'
        WHEN e."drvClientId" IS NOT NULL AND e."drvScopeMethod" IN ('TICKET', 'PROJECT_TICKET') THEN 'enriched'
        WHEN e."drvClientId" IS NOT NULL THEN 'exact'
        WHEN e."drvGroupId" IS NOT NULL THEN 'groupOnly'
        ELSE 'unmatched' END AS k,
      count(*) AS rows, COALESCE(sum(e.minutes), 0) AS minutes
    FROM "ActiveWrikeTimeEntry" e GROUP BY 1`);
  const zeroW = (): Weighted => ({ rows: 0, minutes: "0" });
  const wr: Record<keyof Cls, Weighted> = { exact: zeroW(), enriched: zeroW(), groupOnly: zeroW(), ambiguous: zeroW(), unmatched: zeroW(), other: zeroW() };
  for (const r of wrike) wr[r.k as keyof Cls] = { rows: n(r.rows), minutes: s(r.minutes) };

  const papRows = await tx.$queryRaw<{ k: string; n: bigint }[]>(Prisma.sql`
    SELECT CASE WHEN t."drvScope" = 'AMBIGUOUS' THEN 'ambiguous'
                WHEN t."drvVia" = 'TICKET_ALIAS' THEN 'enriched'
                WHEN t."drvScope" IN ('IMPLEMENTATION', 'CLIENT') THEN 'exact'
                WHEN t."drvScope" = 'GROUP_ONLY' THEN 'groupOnly'
                WHEN t."drvScope" IN ('UNMAPPED', 'NO_PROJECT') THEN 'unmatched'
                ELSE 'other' END AS k, count(*) AS n
    FROM "PapItem" t WHERE t."currentRevisionId" IS NOT NULL GROUP BY 1`);
  const pap: Cls = { exact: 0, enriched: 0, groupOnly: 0, ambiguous: 0, unmatched: 0, other: 0 };
  for (const r of papRows) pap[r.k as keyof Cls] = n(r.n);

  const zd = await tx.$queryRaw<{ k: string; rows: bigint; minutes: unknown }[]>(Prisma.sql`
    SELECT e."drvBucket" AS k, count(*) AS rows, COALESCE(sum(e.minutes), 0) AS minutes FROM "ActiveZdTimeEntry" e GROUP BY 1`);
  const zendeskByBucket = Object.fromEntries(zd.map((r) => [r.k, { rows: n(r.rows), minutes: s(r.minutes) }]));

  const tk = await tx.$queryRaw<{ k: string; n: bigint }[]>(Prisma.sql`
    SELECT v.org_state AS k, count(*) AS n FROM (${ticketViewSql(Prisma.sql`
      SELECT t."ticketId" AS key, NULL::jsonb AS payload, rev."organizationId" AS org_id, rev."createdOn" AS created_on, rev."causaRaiz" AS cause, true AS type_known, true AS status_known
      FROM "ZdTicket" t JOIN "ZdTicketRevision" rev ON rev.id = t."currentRevisionId"`)}) v GROUP BY 1`);
  const tickets = Object.fromEntries(tk.map((r) => [r.k, n(r.n)]));

  const fin = await tx.$queryRaw<{ k: string; rows: bigint; income: unknown }[]>(Prisma.sql`
    SELECT f.resolution AS k, count(*) AS rows, COALESCE(sum(f.income), 0) AS income
    FROM "FinanceRow" f JOIN "FinanceScope" sc ON sc."activeBatchId" = f."batchId" GROUP BY 1`);
  const finance = Object.fromEntries(fin.map((r) => [r.k, { rows: n(r.rows), income: s(r.income) }]));

  return { totals, classification: { wrike: wr, pap, zendeskByBucket, tickets, finance } };
}

/** Conciliación antes/después: la cantidad fuente no puede cambiar al mover un hecho de «sin asignar» a un Grupo. Si no concilia, la transacción se deshace. */
export function assertConciliation(before: RelationReport, after: RelationReport): void {
  const a = before.totals;
  const b = after.totals;
  const diffs = (Object.keys(a) as (keyof Totals)[]).filter((k) => String(a[k]) !== String(b[k]));
  if (diffs.length > 0) throw new Error(`La actualización de relaciones no concilia con la fuente (${diffs.join(", ")}): se deshace sin publicar nada.`);
}
