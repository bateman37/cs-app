import { Prisma } from "@/generated/prisma/client";
import { Dec, FINANCE_CATEGORIES, CATEGORY_LABEL, buildPeriods, effectiveCut, monthsBetween, proratedMonthIncome, lastDayOfMonth, parseYmd, ymdToIso, sumDec, type FinanceCategory } from "@/domain/finance";
import { todayMadrid } from "@/domain/vigencia";
import type { AnalysisQuery } from "@/domain/analytics-query";
import { SERVICE_EVIDENCE_SQL, SERVICE_OF_SQL, type ServiceSelection } from "@/server/economics/engine";
import { DomainError } from "@/server/errors";
import { readDataStamp, type DataStamp } from "./stamp";
import { listBugs, listPap, listTickets, type BugRow, type EntityRef, type PapRow, type PeriodRange, type TicketRow } from "./operational";
import { readSnapshot } from "./snapshot";

/**
 * Lectura de negocio autorizada para el DETALLE de cada cifra (CSAPP-06 §9). ADMIN y Consulta leen estas funciones; NO exponen el archivo
 * original, las acciones de carga ni las decisiones. Cada una usa los mismos predicados que el resumen (periodo, servicio, elegibilidad) y
 * calcula los totales sobre TODAS las filas filtradas, no sobre la página. Las funciones de `economics/detail.ts` siguen siendo solo ADMIN.
 */
export const PERIOD_LABELS = ["month", "prevMonth", "cum", "prevYear", "prevCum"] as const;

/** Periodo pedido: una clave de CAL 17 o un mes concreto (AAAA-MM) del año seleccionado o del comparable, cortado según el modo. */
export function resolvePeriod(query: AnalysisQuery, key: string, now: Date = new Date()): PeriodRange & { label: string } {
  const periods = buildPeriods(query.date, query.mode, todayMadrid(now));
  if ((PERIOD_LABELS as readonly string[]).includes(key)) {
    const p = periods[key as (typeof PERIOD_LABELS)[number]];
    return { key, from: p.from, to: p.to, label: p.label };
  }
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) throw new DomainError("Periodo no válido.");
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const cut = effectiveCut(query.date, query.mode);
  const c = parseYmd(cut);
  const prevCut = parseYmd(periods.prevCum.to);
  const lastDay = y === c.y && mo === c.m ? c.d : y === c.y - 1 && mo === prevCut.m && mo === c.m ? prevCut.d : lastDayOfMonth(y, mo);
  if ((y !== c.y && y !== c.y - 1) || mo < 1 || mo > 12 || (y === c.y && mo > c.m) || (y === c.y - 1 && mo > c.m)) throw new DomainError("Mes fuera del periodo analizado.");
  return { key, from: ymdToIso({ y, m: mo, d: 1 }), to: ymdToIso({ y, m: mo, d: lastDay }), label: key };
}

const col = (r: EntityRef) => Prisma.raw(r.type === "group" ? 'a."groupId"' : r.type === "client" ? 'a."clientId"' : 'a."implementationId"');

// ---------------------------------------------------------------- Ingreso

export type IncomeDetail = {
  period: PeriodRange & { label: string };
  service: ServiceSelection;
  /** Contribución imputada por año y categoría: anual/12 × días incluidos / días del mes, SUMADA sobre los meses (no doce veces el anual). */
  contributions: { year: number; category: FinanceCategory; label: string; annualSource: string | null; state: string; monthsFactor: string; contribution: string | null; origin: string | null; extraction: string | null; version: number; batchId: string | null }[];
  totalContribution: string | null;
  complete: boolean;
  lines: { year: number; category: string; label: string; annual: string; difference: string | null; resolution: string }[];
  linesTotal: number;
  page: number;
  pageSize: number;
  reference: DataStamp;
  note: string;
};

export async function incomeDetail(actorId: string, query: AnalysisQuery, groupId: string, periodKey: string, page: number, pageSize = 25): Promise<IncomeDetail> {
  const period = resolvePeriod(query, periodKey);
  return readSnapshot(actorId, async (tx) => {
    const cats: FinanceCategory[] = query.service === "TOTAL" ? [...FINANCE_CATEGORIES] : [query.service];
    const months = monthsBetween(period.from, period.to);
    const years = [...new Set(months.map((m) => m.y))];
    const scopes = await tx.$queryRaw<{ year: number; category: FinanceCategory; batchId: string | null; version: number; origin: string | null; extraction: string | null; total: string | null; unassigned: bigint }[]>(Prisma.sql`
      SELECT s.year, s.category, s."activeBatchId" AS "batchId", s.version, fb.origin, to_char(fb."extractionDate", 'YYYY-MM-DD') AS extraction,
        (SELECT sum(r.income)::text FROM "FinanceRow" r WHERE r."batchId" = s."activeBatchId" AND r."groupId" = ${groupId}) AS total,
        (SELECT count(*) FROM "FinanceRow" r WHERE r."batchId" = s."activeBatchId" AND r."groupId" IS NULL) AS unassigned
      FROM "FinanceScope" s LEFT JOIN "FinanceBatch" fb ON fb."batchId" = s."activeBatchId" WHERE s.year = ANY(${years})`);
    const contributions: IncomeDetail["contributions"] = [];
    const parts: Dec[] = [];
    let complete = true;
    for (const cat of cats) {
      for (const y of years) {
        const s = scopes.find((x) => x.year === y && x.category === cat);
        const inYear = months.filter((m) => m.y === y);
        const factor = sumDec(inYear.map((m) => Dec.int(1).ratio(m.days, m.daysInMonth)));
        let state = "AVAILABLE";
        let contribution: Dec | null = null;
        if (!s || !s.batchId) { state = "SIN_FUENTE"; complete = false; }
        else if (s.total === null) {
          if (s.origin === "HISTORICAL" || Number(s.unassigned) > 0) { state = "NO_CONFIRMADO"; complete = false; }
          else contribution = Dec.ZERO;
        } else contribution = sumDec(inYear.map((m) => proratedMonthIncome(Dec.parse(s.total as string) as Dec, m.days, m.daysInMonth)));
        if (contribution !== null) parts.push(contribution);
        contributions.push({ year: y, category: cat, label: CATEGORY_LABEL[cat], annualSource: s?.total ? (Dec.parse(s.total)?.toString() ?? s.total) : null, state, monthsFactor: factor.toString(), contribution: contribution?.toString() ?? null, origin: s?.origin ?? null, extraction: s?.extraction ?? null, version: s?.version ?? 0, batchId: s?.batchId ?? null });
      }
    }
    const [lines, tot] = await Promise.all([
      tx.$queryRaw<{ year: number; category: string; label: string; income: string; difference: string | null; resolution: string }[]>(Prisma.sql`
        SELECT s.year, s.category, r."groupLabel" AS label, r.income::text AS income, r.difference::text AS difference, r.resolution
        FROM "FinanceScope" s JOIN "FinanceRow" r ON r."batchId" = s."activeBatchId"
        WHERE r."groupId" = ${groupId} AND s.year = ANY(${years}) AND s.category = ANY(${cats}) ORDER BY s.year DESC, s.category, r.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
      tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM "FinanceScope" s JOIN "FinanceRow" r ON r."batchId" = s."activeBatchId" WHERE r."groupId" = ${groupId} AND s.year = ANY(${years}) AND s.category = ANY(${cats})`),
    ]);
    return {
      period, service: query.service, contributions, totalContribution: complete ? sumDec(parts).toString() : null, complete,
      lines: lines.map((l) => ({ year: l.year, category: l.category, label: l.label, annual: Dec.parse(l.income)?.toString() ?? l.income, difference: l.difference === null ? null : (Dec.parse(l.difference)?.toString() ?? l.difference), resolution: l.resolution })),
      linesTotal: Number(tot[0].n), page, pageSize, reference: await readDataStamp(tx),
      note: "Ingreso imputado: facturado + potencial anual distribuido linealmente (anual/12 × días incluidos / días del mes). No es la factura mensual real. «Diferencia» se compara con Budget y se muestra aparte.",
    };
  });
}

// ---------------------------------------------------------------- Horas

export const HOURS_MODES = ["incluidas", "excluidas", "pendientes", "sin_clasificar", "otro_servicio"] as const;
export type HoursMode = (typeof HOURS_MODES)[number];
export const HOURS_MODE_LABEL: Record<HoursMode, string> = {
  incluidas: "Incluidas en la cifra (concilian exactamente)",
  excluidas: "Excluidas por la política de elegibilidad (p. ej. PMO de Zendesk desde 2025)",
  pendientes: "Elegibilidad pendiente (PMO desconocido)",
  sin_clasificar: "Elegibles sin servicio o con servicios en conflicto",
  otro_servicio: "Elegibles de otro servicio económico",
};

export type HoursDetail = {
  period: PeriodRange & { label: string };
  mode: HoursMode;
  rows: { source: string; entryId: string; workDate: string; minutes: string; hours: string; person: string | null; team: string | null; level: string | null; role: string | null; ticketId: string | null; project: string | null; service: string; origins: string[]; eligibility: string; bucket: string; reason: string }[];
  /** Totales sobre TODAS las filas filtradas. */
  total: { rows: number; minutes: string; hours: string };
  page: number;
  pageSize: number;
  reference: DataStamp;
};

export function hoursPredicate(mode: HoursMode, service: ServiceSelection): Prisma.Sql {
  const svc = service === "TOTAL" ? Prisma.sql`TRUE` : Prisma.sql`x.svc = ${service}`;
  switch (mode) {
    case "incluidas": return Prisma.sql`x."isEligible" AND ${svc}`;
    case "excluidas": return Prisma.sql`x.eligibility NOT IN ('ELIGIBLE', 'PENDING_ELIGIBILITY')`;
    case "pendientes": return Prisma.sql`x.eligibility = 'PENDING_ELIGIBILITY'`;
    case "sin_clasificar": return Prisma.sql`x."isEligible" AND x.svc IN ('SIN_CLASIFICAR', 'CONFLICTO')`;
    case "otro_servicio": return service === "TOTAL" ? Prisma.sql`FALSE` : Prisma.sql`x."isEligible" AND x.svc NOT IN (${service}, 'SIN_CLASIFICAR', 'CONFLICTO')`;
  }
}

export async function hoursDetail(actorId: string, query: AnalysisQuery, ref: EntityRef, periodKey: string, mode: HoursMode, page: number, pageSize = 25): Promise<HoursDetail> {
  const period = resolvePeriod(query, periodKey);
  return readSnapshot(actorId, async (tx) => {
    const where = hoursPredicate(mode, query.service);
    const base = Prisma.sql`
      SELECT x.* FROM (SELECT a.*, ${SERVICE_OF_SQL} AS svc FROM "TimeActivity" a
        WHERE ${col(ref)} = ${ref.id} AND a."workDate" BETWEEN ${period.from}::date AND ${period.to}::date) x WHERE ${where}`;
    const [rows, tot] = await Promise.all([
      tx.$queryRaw<{ source: string; entryId: string; workDate: string; minutes: string; person: string | null; team: string | null; level: string | null; role: string | null; ticketId: string | null; project: string | null; svc: string; origins: string[] | null; eligibility: string; bucket: string }[]>(Prisma.sql`
        SELECT a.source, a."entryId", to_char(a."workDate", 'YYYY-MM-DD') AS "workDate", a.minutes::text AS minutes, pe.name AS person, tm.name AS team, lv.name AS level, rl.name AS role,
          a."ticketId", a."projectName" AS project, a.svc, (SELECT array_agg(DISTINCT ev.origin) FROM (${SERVICE_EVIDENCE_SQL}) ev) AS origins,
          a.eligibility, a.bucket
        FROM (${base}) a
        LEFT JOIN "Person" pe ON pe.id = a."personId" LEFT JOIN "StaffCatalogItem" tm ON tm.id = a."teamId"
        LEFT JOIN "StaffCatalogItem" lv ON lv.id = a."levelId" LEFT JOIN "StaffCatalogItem" rl ON rl.id = a."roleId"
        ORDER BY a."workDate", a.source, a."entryId" LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
      tx.$queryRaw<{ n: bigint; minutes: string | null }[]>(Prisma.sql`SELECT count(*) AS n, sum(x.minutes)::text AS minutes FROM (${base}) x`),
    ]);
    const totalMin = Dec.parse(tot[0].minutes ?? "0") ?? Dec.ZERO;
    return {
      period, mode, page, pageSize, reference: await readDataStamp(tx),
      total: { rows: Number(tot[0].n), minutes: totalMin.toString(), hours: totalMin.divInt(60).toString() },
      rows: rows.map((r) => {
        const m = Dec.parse(r.minutes) ?? Dec.ZERO;
        return { source: r.source, entryId: r.entryId, workDate: r.workDate, minutes: m.toString(), hours: m.divInt(60).toString(), person: r.person, team: r.team, level: r.level, role: r.role, ticketId: r.ticketId, project: r.project, service: r.svc, origins: r.origins ?? [], eligibility: r.eligibility, bucket: r.bucket, reason: HOURS_MODE_LABEL[mode] };
      }),
    };
  });
}

// ---------------------------------------------------------------- PAP, tickets y bugs

export type OpsDetail<R> = { period: PeriodRange & { label: string }; supported: boolean; rows: R[]; total: number; page: number; pageSize: number; reference: DataStamp };

export async function papDetail(actorId: string, query: AnalysisQuery, ref: EntityRef, periodKey: string, page: number, pageSize = 25): Promise<OpsDetail<PapRow>> {
  const noDate = periodKey === "sin_fecha";
  const period = noDate ? { key: "sin_fecha", from: "", to: "", label: "Sin fecha de producción" } : resolvePeriod(query, periodKey);
  return readSnapshot(actorId, async (tx) => {
    const r = await listPap(tx, ref, noDate ? null : period, page, pageSize);
    return { period, supported: true, rows: r.rows, total: r.total, page, pageSize, reference: await readDataStamp(tx) };
  });
}
export async function ticketsDetail(actorId: string, query: AnalysisQuery, ref: EntityRef, periodKey: string, page: number, pageSize = 25): Promise<OpsDetail<TicketRow>> {
  const period = resolvePeriod(query, periodKey);
  return readSnapshot(actorId, async (tx) => {
    const r = await listTickets(tx, ref, period, page, pageSize);
    return { period, supported: r.supported, rows: r.rows, total: r.total, page, pageSize, reference: await readDataStamp(tx) };
  });
}
export async function bugsDetail(actorId: string, query: AnalysisQuery, ref: EntityRef, periodKey: string, page: number, pageSize = 25): Promise<OpsDetail<BugRow>> {
  const period = resolvePeriod(query, periodKey);
  return readSnapshot(actorId, async (tx) => {
    const r = await listBugs(tx, ref, period, page, pageSize);
    return { period, supported: r.supported, rows: r.rows, total: r.total, page, pageSize, reference: await readDataStamp(tx) };
  });
}
