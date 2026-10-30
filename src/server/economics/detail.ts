import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { Dec } from "@/domain/finance";
import { isIsoDate } from "@/domain/vigencia";
import { authorize } from "@/server/authorize";
import { DomainError } from "@/server/errors";
import { pageResult, paging } from "@/server/common";
import { SERVICE_EVIDENCE_SQL } from "./engine";

/** Detalle paginado de ingresos y horas de un Grupo Cliente, con sus lotes (solo Administrador: enlaza a Cargas). */
export async function listIncomeDetail(actorId: string, q: { groupId: string; page?: number; pageSize?: number }) {
  await authorize(prisma, actorId, "ADMIN");
  const { page, pageSize, skip, take } = paging({ pageSize: 25, ...q });
  const rows = await prisma.$queryRaw<
    { year: number; category: string; batchId: string; name: string; extraction: string | null; label: string; income: string; derivedZero: boolean; difference: string | null; resolution: string; origin: string; scopeVersion: number }[]
  >(Prisma.sql`
    SELECT s.year, s.category, s."activeBatchId" AS "batchId", b."originalName" AS name, to_char(fb."extractionDate", 'YYYY-MM-DD') AS extraction, r."groupLabel" AS label,
      r.income::text AS income, r."incomeDerivedZero" AS "derivedZero", r.difference::text AS difference, r.resolution, fb.origin, s.version AS "scopeVersion"
    FROM "FinanceScope" s JOIN "FinanceRow" r ON r."batchId" = s."activeBatchId" JOIN "FinanceBatch" fb ON fb."batchId" = r."batchId" JOIN "UploadBatch" b ON b.id = r."batchId"
    WHERE r."groupId" = ${q.groupId} ORDER BY s.year DESC, s.category, r.id LIMIT ${take} OFFSET ${skip}`);
  const total = Number((await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM "FinanceScope" s JOIN "FinanceRow" r ON r."batchId" = s."activeBatchId" WHERE r."groupId" = ${q.groupId}`))[0].n);
  return pageResult(rows.map((r) => ({ ...r, income: Dec.parse(r.income)?.toString() ?? r.income, difference: r.difference === null ? null : (Dec.parse(r.difference)?.toString() ?? r.difference) })), total, page, pageSize);
}

export async function listHoursDetail(actorId: string, q: { groupId: string; from: string; to: string; eligibleOnly?: boolean; page?: number; pageSize?: number }) {
  await authorize(prisma, actorId, "ADMIN");
  if (!isIsoDate(q.from) || !isIsoDate(q.to) || q.from > q.to) throw new DomainError("Periodo no válido.");
  const { page, pageSize, skip, take } = paging({ pageSize: 25, ...q });
  const elig = q.eligibleOnly ? Prisma.sql`AND a."isEligible"` : Prisma.empty;
  const rows = await prisma.$queryRaw<
    { source: string; entryId: string; workDate: string; hours: string; ticketId: string | null; eligibility: string; bucket: string; clientId: string | null; service: string; origins: string[] | null }[]
  >(Prisma.sql`
    SELECT a.source, a."entryId", to_char(a."workDate", 'YYYY-MM-DD') AS "workDate", (a.minutes / 60)::text AS hours, a."ticketId", a.eligibility, a.bucket, a."clientId",
      (SELECT CASE count(DISTINCT ev.service) WHEN 0 THEN 'SIN_CLASIFICAR' WHEN 1 THEN min(ev.service) ELSE 'CONFLICTO' END FROM (${SERVICE_EVIDENCE_SQL}) ev) AS service,
      (SELECT array_agg(DISTINCT ev.origin) FROM (${SERVICE_EVIDENCE_SQL}) ev) AS origins
    FROM "TimeActivity" a
    WHERE a."groupId" = ${q.groupId} AND a."workDate" BETWEEN ${q.from}::date AND ${q.to}::date ${elig}
    ORDER BY a."workDate", a.source, a."entryId" LIMIT ${take} OFFSET ${skip}`);
  const tot = (await prisma.$queryRaw<{ n: bigint; minutes: string | null }[]>(Prisma.sql`
    SELECT count(*) AS n, sum(a.minutes)::text AS minutes FROM "TimeActivity" a
    WHERE a."groupId" = ${q.groupId} AND a."workDate" BETWEEN ${q.from}::date AND ${q.to}::date ${elig}`))[0];
  return {
    ...pageResult(rows.map((r) => ({ ...r, hours: Dec.parse(r.hours)?.toString() ?? r.hours })), Number(tot.n), page, pageSize),
    totalHours: (Dec.parse(tot.minutes ?? "0") ?? Dec.ZERO).divInt(60).toString(),
  };
}
