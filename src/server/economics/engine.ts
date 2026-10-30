import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  CATEGORY_LABEL,
  ECONOMIC_ENGINE_VERSION,
  ECONOMIC_METHOD,
  FINANCE_CATEGORIES,
  Dec,
  buildPeriods,
  deviationVsPortfolio,
  deviationVsTarget,
  effectiveCut,
  eurosPerDay,
  monthsBetween,
  parseYmd,
  proratedMonthIncome,
  sumDec,
  targetHours,
  ymdToIso,
  lastDayOfMonth,
  type CutMode,
  type FinanceCategory,
  type Formula,
  type Period,
  type ResultStatus,
} from "@/domain/finance";
import { isIsoDate, todayMadrid } from "@/domain/vigencia";
import { authorize } from "@/server/authorize";
import { DomainError } from "@/server/errors";
import { financeMasterStamp } from "@/server/finance/resolve";
import { getSettings, type EconomicSettings } from "./settings";

type Tx = Prisma.TransactionClient;

/**
 * Motor económico común (CSAPP-05 §8-§9). Las pantallas futuras (Comparativa, Análisis Cliente) lo consumen; no reconstruyen
 * fórmulas, SQL ni lecturas del Excel. Una ejecución lee un estado coherente: una única transacción de lectura REPEATABLE READ
 * (instantánea de hechos financieros, tiempos, usuarios, atribuciones y configuración) y devuelve la referencia de lo leído.
 * Todos los importes y horas viajan como texto decimal exacto.
 */

export const SERVICES = ["SOPORTE", "ADMIN_DELEGADA", "OTROS", "TOTAL"] as const;
export type ServiceSelection = (typeof SERVICES)[number];
export const PERIOD_KEYS = ["month", "prevMonth", "cum", "prevYear", "prevCum"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export type EconomicScope =
  | { type: "groups"; ids: string[] | "ALL" }
  | { type: "client"; id: string }
  | { type: "implementation"; id: string };

export type EconomicInput = {
  scope: EconomicScope;
  service: ServiceSelection;
  /** Fecha de análisis AAAA-MM-DD (por defecto, hoy en Europe/Madrid). */
  date?: string;
  mode?: CutMode;
  /** Revisión de la configuración (por defecto, la última activa). Una anterior es un recálculo identificado. */
  settingsRevision?: number;
  /** Reloj inyectable (pruebas). */
  now?: Date;
  /** Filtros que recortan SOLO las horas: con ellos no existe una rentabilidad del subconjunto (se devuelve la limitación). */
  filters?: { teamId?: string; levelId?: string; projectName?: string };
  page?: number;
  pageSize?: number;
};

export type Amount = { value: string | null; status: ResultStatus; reason: string | null; known: string };

export type PeriodSeries = {
  key: string;
  label: string;
  from: string;
  to: string;
  provisional: boolean;
  revenue: Amount;
  incomeByCategory: Partial<Record<FinanceCategory, { value: string | null; state: string; reason: string | null }>>;
  hours: {
    /** Horas elegibles del perímetro del servicio seleccionado. */
    inPerimeter: string;
    eligible: string;
    byService: Record<"SOPORTE" | "ADMIN_DELEGADA" | "OTROS" | "SIN_CLASIFICAR" | "CONFLICTO", string>;
    excluded: string;
    pendingEligibility: string;
  };
  users: { stock: { value: number | null; status: string }; userMonths: string | null; averageUsers: string | null; complete: boolean; missingMonths: { year: number; month: number }[] };
  perDay: Formula;
  targetHours: Formula;
  deviationVsTarget: Formula;
  deviationVsPortfolio: Formula | null;
  perUserPerYear: Formula;
};

export type EntityResult = {
  id: string;
  type: "group" | "client" | "implementation";
  name: string;
  groupId: string | null;
  groupName: string | null;
  /** «Ingreso agrupado en Grupo Cliente» para un Cliente/implantación (sin ratio propio atribuido). */
  incomeNote: string | null;
  metadata: { support: string; hosting: string };
  eco08: boolean;
  periods: Record<PeriodKey, PeriodSeries>;
  /** Serie mensual del año seleccionado (hasta el corte). */
  monthly: PeriodSeries[];
};

export type PortfolioPeriod = {
  revenue: string | null;
  hours: string;
  perDay: Formula;
  groupsWithIncome: number;
  groupsUnknownIncome: number;
  groupsNotComputable: { count: number; incomeAtStake: string };
  deviationVsTarget: Formula;
};

export type EconomicResult = {
  input: { service: ServiceSelection; date: string; cut: string; mode: CutMode; scopeType: string };
  settings: EconomicSettings;
  recalculatedWithOlderSettings: boolean;
  periodsDefinition: Record<PeriodKey, Period>;
  entities: EntityResult[];
  totalEntities: number;
  portfolio: Record<PeriodKey, PortfolioPeriod> | null;
  /** Horas elegibles del periodo CUM sin Grupo Cliente (internos, conflictos y sin ticket): conciliables, no inflan clientes. */
  unattributed: { eligibleHours: string; byBucket: Record<string, string> } | null;
  reference: {
    engineVersion: string;
    method: string;
    readIsolation: string;
    readAt: string;
    finance: { year: number; category: FinanceCategory; batchId: string | null; version: number; extractionDate: string | null; origin: string | null; unassigned: number; coverage: string }[];
    time: { zendeskMaxDerivationVersion: number; wrikeMaxDerivationVersion: number };
    pendingRecalc: { finance: boolean; bcFallback: { wrike: number; pap: number }; reason: string | null };
  };
};

const ZERO = Dec.ZERO;
const H = (minutes: Dec) => minutes.divInt(60).toString();

function formula(value: Dec | null, num: Dec | null, den: Dec | null, unit: string, status: ResultStatus, reason: string | null): Formula {
  return { value: value?.toString() ?? null, numerator: num?.toString() ?? null, denominator: den?.toString() ?? null, unit, status, reason };
}
const na = (unit: string, status: ResultStatus, reason: string): Formula => ({ value: null, numerator: null, denominator: null, unit, status, reason });

// ---------------------------------------------------------------- SQL de servicio (compartido con el detalle)

/** Servicio económico de una actividad: evidencias (administración delegada del ticket, valor exacto de Entorno y Tipología, proyecto Wrike asignado). */
export const SERVICE_EVIDENCE_SQL = Prisma.sql`
  SELECT 'ADMIN_DELEGADA'::text AS service, 'TICKET_ADMIN_DELEGADA'::text AS origin WHERE a."ticketAdminDelegada" IS TRUE
  UNION ALL
  SELECT sa.service, 'ENTORNO' FROM "ServiceAssignment" sa
   WHERE sa."isActive" AND sa."matchKind" = 'ENTORNO' AND a."ticketEntorno" IS NOT NULL AND sa."searchValue" = lower(a."ticketEntorno")
     AND (sa."validFrom" IS NULL OR sa."validFrom" <= a."workDate") AND (sa."validTo" IS NULL OR a."workDate" < sa."validTo")
  UNION ALL
  SELECT sa.service, 'WRIKE_PROJECT' FROM "ServiceAssignment" sa
   WHERE sa."isActive" AND sa."matchKind" = 'WRIKE_PROJECT' AND a.source = 'WRIKE' AND a."projectName" IS NOT NULL AND sa."searchValue" = lower(a."projectName")
     AND (sa."validFrom" IS NULL OR sa."validFrom" <= a."workDate") AND (sa."validTo" IS NULL OR a."workDate" < sa."validTo")`;

export const SERVICE_OF_SQL = Prisma.sql`(
  SELECT CASE count(DISTINCT ev.service) WHEN 0 THEN 'SIN_CLASIFICAR' WHEN 1 THEN min(ev.service) ELSE 'CONFLICTO' END
  FROM (${SERVICE_EVIDENCE_SQL}) ev)`;

const CLASS_OF_SQL = Prisma.sql`CASE a.eligibility WHEN 'ELIGIBLE' THEN 'ELIGIBLE' WHEN 'PENDING_ELIGIBILITY' THEN 'PENDING' ELSE 'EXCLUDED' END`;

// ---------------------------------------------------------------- Lectura

type MinutesCell = Partial<Record<"ELIGIBLE" | "PENDING" | "EXCLUDED", Dec>>;
type HoursIndex = Map<string, Map<string, Map<string, MinutesCell>>>; // periodKey → entityId → service → clase

export async function runEconomics(actorId: string, input: EconomicInput): Promise<EconomicResult> {
  await authorize(prisma, actorId, "READ");
  const now = input.now ?? new Date();
  const date = input.date ?? todayMadrid(now);
  if (!isIsoDate(date)) throw new DomainError("Fecha de análisis no válida (AAAA-MM-DD).");
  const mode: CutMode = input.mode ?? "CUTOFF";
  if (!SERVICES.includes(input.service)) throw new DomainError("Servicio económico no válido.");
  // Una única transacción de lectura consistente: un cambio concurrente no mezcla el ingreso de un lote con su predecesor.
  return prisma.$transaction((tx) => compute(tx, input, date, mode, now), { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 120_000 });
}

async function compute(tx: Tx, input: EconomicInput, date: string, mode: CutMode, now: Date): Promise<EconomicResult> {
  const readAt = (await tx.$queryRaw<{ t: Date }[]>(Prisma.sql`SELECT now() AS t`))[0].t.toISOString();
  const latest = await getSettings(tx);
  const settings = input.settingsRevision !== undefined ? await getSettings(tx, input.settingsRevision) : latest;
  const target = Dec.parse(settings.targetEurosPerDay) as Dec;
  const dayHours = Dec.parse(settings.dayHours) as Dec;
  const today = todayMadrid(now);
  const cut = effectiveCut(date, mode);
  const periods = buildPeriods(date, mode, today);
  const cutY = parseYmd(cut).y;

  // 1. Entidades del ámbito (todas, antes de paginar: la cartera usa el conjunto filtrado completo).
  const ents = await loadEntities(tx, input.scope);
  const groupIds = [...new Set(ents.map((e) => e.groupId).filter((g): g is string => Boolean(g)))];

  // 2. Hechos financieros vigentes de los años implicados (una consulta por conjuntos).
  const years = [cutY, cutY - 1];
  const finance = await loadFinance(tx, years, groupIds);

  // 3. Horas: una pasada por TimeActivity con un join de periodos (sin consulta por grupo/mes).
  const monthlyPeriods: { key: string; from: string; to: string }[] = [];
  for (let m = 1; m <= parseYmd(cut).m; m++) {
    monthlyPeriods.push({ key: `m${m}`, from: ymdToIso({ y: cutY, m, d: 1 }), to: m === parseYmd(cut).m ? cut : ymdToIso({ y: cutY, m, d: lastDayOfMonth(cutY, m) }) });
  }
  const periodRows = [...PERIOD_KEYS.map((k) => ({ key: k as string, from: periods[k].from, to: periods[k].to })), ...monthlyPeriods];
  const hours = await loadHours(tx, input.scope, ents, periodRows, input.filters);
  const unattributed = await loadUnattributed(tx, periods.cum);

  // 4. Usuarios: un único acceso a la matriz de todas las entidades y años.
  const usersLookup = await loadUsers(tx, ents, [cutY, cutY - 1]);

  // 5. Metadatos con vigencia a la fecha de corte (sin multiplicar filas por tramos).
  const meta = await loadMetadata(tx, ents, cut);

  const partialFilter = Boolean(input.filters && (input.filters.teamId || input.filters.levelId || input.filters.projectName));
  const services: FinanceCategory[] = input.service === "TOTAL" ? [...FINANCE_CATEGORIES] : [input.service];

  const build = (e: Ent, key: string, p: { from: string; to: string; label: string; provisional: boolean; months?: Period["months"] }, isMonthly: boolean): PeriodSeries => {
    const months = p.months ?? monthsBetween(p.from, p.to);
    // Ingreso: solo al nivel Grupo Cliente.
    const incomeByCategory: PeriodSeries["incomeByCategory"] = {};
    let revenue: Amount;
    if (e.type !== "group") {
      revenue = { value: null, status: "NOT_COMPUTABLE", reason: "Ingreso agrupado en Grupo Cliente: sin ingreso propio ni ratio atribuido a este nivel.", known: "0" };
    } else {
      const parts: Dec[] = [];
      let missing = 0;
      for (const cat of services) {
        let sum = ZERO;
        let state = "AVAILABLE";
        let reason: string | null = null;
        for (const mo of months) {
          const f = finance.income(e.id, mo.y, cat);
          if (f.state !== "AVAILABLE") {
            state = f.state;
            reason = f.reason;
            continue;
          }
          sum = sum.add(proratedMonthIncome(f.value as Dec, mo.days, mo.daysInMonth));
        }
        incomeByCategory[cat] = { value: state === "AVAILABLE" ? sum.toString() : null, state, reason };
        if (state !== "AVAILABLE") missing++;
        parts.push(sum);
      }
      const known = sumDec(parts);
      revenue =
        missing === 0
          ? { value: known.toString(), status: "AVAILABLE", reason: null, known: known.toString() }
          : { value: null, status: missing === services.length ? "NO_SOURCE" : "PARTIAL", reason: `Falta el conjunto financiero de ${services.filter((c) => incomeByCategory[c]?.state !== "AVAILABLE").map((c) => CATEGORY_LABEL[c]).join(", ")} del periodo.`, known: known.toString() };
    }
    // Horas del periodo.
    const cell = hours.get(key)?.get(e.id);
    const get = (svc: string, cls: "ELIGIBLE" | "PENDING" | "EXCLUDED") => cell?.get(svc)?.[cls] ?? ZERO;
    const svcs = ["SOPORTE", "ADMIN_DELEGADA", "OTROS", "SIN_CLASIFICAR", "CONFLICTO"] as const;
    const elig: Record<string, Dec> = Object.fromEntries(svcs.map((s) => [s, get(s, "ELIGIBLE")]));
    const eligibleAll = sumDec(Object.values(elig));
    const pending = sumDec(svcs.map((s) => get(s, "PENDING")));
    const excluded = sumDec(svcs.map((s) => get(s, "EXCLUDED")));
    const perimeter = input.service === "TOTAL" ? eligibleAll : elig[input.service];
    const unknownService = elig.SIN_CLASIFICAR.add(elig.CONFLICTO);

    // Usuarios: stock al corte (no se prorratea) y exposición del periodo (flujo) en usuarios mes exactos; un mes sin informar la deja incompleta.
    const lookup = usersLookup(e.id);
    const missingMonths: { year: number; month: number }[] = [];
    let userMonthsDec = ZERO;
    let weightDec = ZERO;
    for (const mo of months) {
      const v = lookup.at(mo.y, mo.m);
      weightDec = weightDec.add(Dec.int(1).ratio(mo.days, mo.daysInMonth));
      if (v === null) missingMonths.push({ year: mo.y, month: mo.m });
      else userMonthsDec = userMonthsDec.add(Dec.int(v).ratio(mo.days, mo.daysInMonth));
    }
    const complete = missingMonths.length === 0;
    const cutParts = parseYmd(p.to);
    const stockV = lookup.at(cutParts.y, cutParts.m);
    const users: PeriodSeries["users"] = {
      stock: { value: stockV, status: stockV === null ? "sin informar" : stockV === 0 ? "cero confirmado" : "informado" },
      userMonths: complete ? userMonthsDec.toString() : null,
      averageUsers: complete && !weightDec.isZero() ? userMonthsDec.div(weightDec).toString() : null,
      complete,
      missingMonths,
    };

    // Ratios (la falta de usuarios NO impide €/jornada).
    let perDay: Formula;
    const unit = "€/jornada";
    const eco08 = (isMonthly || key === "month" || key === "prevMonth") && meta.get(e.id)?.support === "SILVER_ON_DEMAND";
    const minutesPerimeter = perimeter;
    if (e.type !== "group") perDay = na(unit, "NOT_COMPUTABLE", "Ingreso agrupado en Grupo Cliente: el ratio se calcula al nivel del grupo.");
    else if (partialFilter) perDay = na(unit, "NOT_COMPUTABLE", "El filtro recorta solo las horas: sin el ingreso de ese subconjunto no hay rentabilidad; se usa el perímetro económico completo.");
    else if (eco08) perDay = na(unit, "NOT_COMPUTABLE", "ECO 08 pendiente: la rentabilidad mensual recurrente de Silver On Demand no está activada; use el análisis anual.");
    else if (revenue.value === null) perDay = na(unit, revenue.status, revenue.reason ?? "Sin ingreso.");
    else if (input.service !== "TOTAL" && unknownService.sign() > 0) {
      perDay = formula(null, Dec.parse(revenue.value), minutesPerimeter.divInt(60), unit, "PARTIAL", `Hay ${H(unknownService)} h elegibles sin servicio o con servicios en conflicto en este ámbito y periodo: podrían cambiar el perímetro; no se presenta el ratio como completo.`);
    } else if (pending.sign() > 0) {
      perDay = formula(null, Dec.parse(revenue.value), minutesPerimeter.divInt(60), unit, "PARTIAL", `Hay ${H(pending)} h con elegibilidad pendiente (PMO desconocido) que podrían entrar en el perímetro.`);
    } else {
      const r = Dec.parse(revenue.value) as Dec;
      const ed = eurosPerDay(r, minutesPerimeter, dayHours);
      if (ed.ratio === null) perDay = formula(null, r, ed.hours, unit, "NOT_COMPUTABLE", r.sign() > 0 ? "Ingreso positivo con cero horas: no hay ratio (nunca infinito)." : "Sin horas en el periodo: ratio no calculable.");
      else perDay = formula(ed.ratio, r, ed.hours, unit, "AVAILABLE", null);
    }
    const th: Formula =
      revenue.value !== null && e.type === "group" ? formula(targetHours(Dec.parse(revenue.value) as Dec, target, dayHours), Dec.parse(revenue.value), target, "horas", "AVAILABLE", null) : na("horas", revenue.status === "AVAILABLE" ? "NOT_COMPUTABLE" : revenue.status, revenue.reason ?? "Sin ingreso.");
    const dev: Formula =
      perDay.value !== null
        ? formula(deviationVsTarget(target, Dec.parse(perDay.value) as Dec), target, Dec.parse(perDay.value), "fracción", "AVAILABLE", "Positivo = rendimiento por debajo del objetivo.")
        : na("fracción", perDay.status, perDay.reason ?? "Sin ratio.");
    // Tarifa anual por usuario: usuarios medios de los doce meses; en periodo parcial, equivalente anual identificado.
    let tariff: Formula;
    if (e.type !== "group" || revenue.value === null) tariff = na("€/usuario·año", e.type !== "group" ? "NOT_COMPUTABLE" : revenue.status, "Sin ingreso del grupo.");
    else if (!users.complete || users.averageUsers === null) tariff = na("€/usuario·año", "NOT_COMPUTABLE", "Usuarios del periodo incompletos o sin informar: la tarifa por usuario no es calculable (el ratio €/jornada sí).");
    else if (Dec.parse(users.averageUsers)?.isZero()) tariff = na("€/usuario·año", "NOT_COMPUTABLE", "Usuarios medios cero: no se divide.");
    else {
      const days = months.reduce((s, mo) => s + mo.days, 0);
      const full = months.length === 12 && months.every((mo) => mo.days === mo.daysInMonth);
      const annualEq = full ? (Dec.parse(revenue.value) as Dec) : (Dec.parse(revenue.value) as Dec).ratio(365, Math.max(days, 1));
      tariff = formula(annualEq.div(Dec.parse(users.averageUsers) as Dec), annualEq, Dec.parse(users.averageUsers), "€/usuario·año", "AVAILABLE", full ? null : "Equivalente anual del periodo parcial (no es una tarifa contractual).");
    }
    return {
      key,
      label: p.label,
      from: p.from,
      to: p.to,
      provisional: p.provisional,
      revenue,
      incomeByCategory,
      hours: {
        inPerimeter: H(minutesPerimeter),
        eligible: H(eligibleAll),
        byService: Object.fromEntries(svcs.map((s) => [s, H(elig[s])])) as PeriodSeries["hours"]["byService"],
        excluded: H(excluded),
        pendingEligibility: H(pending),
      },
      users,
      perDay,
      targetHours: th,
      deviationVsTarget: dev,
      deviationVsPortfolio: null,
      perUserPerYear: tariff,
    };
  };

  const results: EntityResult[] = ents.map((e) => {
    const m = meta.get(e.id) ?? { support: "SIN_INFORMAR", hosting: "SIN_INFORMAR" };
    const per = Object.fromEntries(PERIOD_KEYS.map((k) => [k, build(e, k, periods[k], false)])) as Record<PeriodKey, PeriodSeries>;
    const monthly = monthlyPeriods.map((mp) => build(e, mp.key, { from: mp.from, to: mp.to, label: `Mes ${mp.key.slice(1)}`, provisional: false }, true));
    return {
      id: e.id,
      type: e.type,
      name: e.name,
      groupId: e.groupId,
      groupName: e.groupName,
      incomeNote: e.type === "group" ? null : `Ingreso agrupado en el Grupo Cliente «${e.groupName ?? "sin grupo"}»`,
      metadata: m,
      eco08: m.support === "SILVER_ON_DEMAND",
      periods: per,
      monthly,
    };
  });

  // 6. Cartera: ratio ponderado del conjunto filtrado COMPLETO (antes de paginar), nunca la media de ratios.
  let portfolio: EconomicResult["portfolio"] = null;
  if (input.scope.type === "groups") {
    portfolio = {} as Record<PeriodKey, PortfolioPeriod>;
    for (const k of PERIOD_KEYS) {
      let rev = ZERO;
      let min = ZERO;
      let withIncome = 0;
      let unknown = 0;
      let nc = 0;
      let ncIncome = ZERO;
      for (const r of results) {
        const p = r.periods[k];
        if (p.revenue.value === null) {
          unknown++;
          continue;
        }
        withIncome++;
        rev = rev.add(Dec.parse(p.revenue.value) as Dec);
        const mins = (Dec.parse(p.hours.inPerimeter) as Dec).mulInt(60);
        min = min.add(mins);
        if (p.perDay.status !== "AVAILABLE") {
          nc++;
          ncIncome = ncIncome.add(Dec.parse(p.revenue.value) as Dec);
        }
      }
      const ed = min.isZero() ? null : eurosPerDay(rev, min, dayHours);
      const perDay = withIncome === 0 ? na("€/jornada", "NO_SOURCE", "Ningún grupo del conjunto tiene ingreso conocido.") : ed?.ratio ? formula(ed.ratio, rev, ed.hours, "€/jornada", "AVAILABLE", null) : na("€/jornada", "NOT_COMPUTABLE", "Sin horas en el conjunto filtrado.");
      portfolio[k] = {
        revenue: withIncome === 0 ? null : rev.toString(),
        hours: H(min),
        perDay,
        groupsWithIncome: withIncome,
        groupsUnknownIncome: unknown,
        groupsNotComputable: { count: nc, incomeAtStake: ncIncome.toString() },
        deviationVsTarget: perDay.value ? formula(deviationVsTarget(target, Dec.parse(perDay.value) as Dec), target, Dec.parse(perDay.value), "fracción", "AVAILABLE", "Positivo = por debajo del objetivo.") : na("fracción", perDay.status, perDay.reason ?? ""),
      };
    }
    for (const r of results) {
      for (const k of PERIOD_KEYS) {
        const pr = portfolio[k].perDay.value;
        const own = r.periods[k].perDay.value;
        r.periods[k].deviationVsPortfolio =
          pr && own
            ? (() => {
                const d = deviationVsPortfolio(Dec.parse(pr) as Dec, Dec.parse(own) as Dec);
                return d ? formula(d, Dec.parse(pr), Dec.parse(own), "fracción", "AVAILABLE", null) : na("fracción", "NOT_COMPUTABLE", "La cartera tiene ratio cero: no se divide.");
              })()
            : na("fracción", "NOT_COMPUTABLE", pr ? "El grupo no tiene ratio propio calculable." : "La cartera no tiene ratio.");
      }
    }
  }

  // Referencia reproducible.
  const stampNow = await financeMasterStamp(tx);
  const stale = finance.scopes.some((s) => s.batchId !== null && s.derivedStamp !== null && s.derivedStamp !== stampNow);
  const fb = await bcFallbackImpact(tx);
  const timeRef = (await tx.$queryRaw<{ z: number; w: number }[]>(Prisma.sql`
    SELECT (SELECT COALESCE(max("drvVersion"), 0) FROM "ZdTimeEntry")::int AS z, (SELECT COALESCE(max("drvVersion"), 0) FROM "WrikeTimeEntry")::int AS w`))[0];
  const pageSize = Math.min(Math.max(input.pageSize ?? 50, 1), 500);
  const page = Math.max(input.page ?? 1, 1);

  return {
    input: { service: input.service, date, cut, mode, scopeType: input.scope.type },
    settings,
    recalculatedWithOlderSettings: settings.revisionNo !== latest.revisionNo,
    periodsDefinition: periods,
    entities: results.slice((page - 1) * pageSize, page * pageSize),
    totalEntities: results.length,
    portfolio,
    unattributed,
    reference: {
      engineVersion: ECONOMIC_ENGINE_VERSION,
      method: ECONOMIC_METHOD,
      readIsolation: "REPEATABLE READ (una transacción de lectura)",
      readAt,
      finance: finance.scopes.map((x) => ({ year: x.year, category: x.category, batchId: x.batchId, version: x.version, extractionDate: x.extractionDate, origin: x.origin, unassigned: x.unassigned, coverage: x.coverage })),
      time: { zendeskMaxDerivationVersion: timeRef.z, wrikeMaxDerivationVersion: timeRef.w },
      pendingRecalc: {
        finance: stale,
        bcFallback: fb,
        reason: stale
          ? "Los maestros BC cambiaron desde la atribución de algún lote financiero: reprocese esos lotes para recalcular su atribución."
          : fb.wrike + fb.pap > 0
            ? "Hay tiempos o PAP atribuidos por el antiguo atajo de clave BC: la atribución anterior se conserva como evidencia pero no está validada; cree equivalencias Wrike/PAP a Grupo y reprocese."
            : null,
      },
    },
  };
}

// ---------------------------------------------------------------- Cargas de datos por conjuntos

type Ent = { id: string; type: "group" | "client" | "implementation"; name: string; groupId: string | null; groupName: string | null };

async function loadEntities(tx: Tx, scope: EconomicScope): Promise<Ent[]> {
  if (scope.type === "groups") {
    const rows = await tx.clientGroup.findMany({
      where: scope.ids === "ALL" ? {} : { id: { in: scope.ids } },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return rows.map((g) => ({ id: g.id, type: "group" as const, name: g.name, groupId: g.id, groupName: g.name }));
  }
  if (scope.type === "client") {
    const c = await tx.client.findUnique({ where: { id: scope.id }, include: { group: { select: { id: true, name: true } } } });
    if (!c) throw new DomainError("Cliente no encontrado.");
    return [{ id: c.id, type: "client", name: c.name, groupId: c.group?.id ?? null, groupName: c.group?.name ?? null }];
  }
  const i = await tx.implementation.findUnique({ where: { id: scope.id }, include: { client: { include: { group: { select: { id: true, name: true } } } } } });
  if (!i) throw new DomainError("Implantación no encontrada.");
  return [{ id: i.id, type: "implementation", name: `${i.client.name} › ${i.name}`, groupId: i.client.group?.id ?? null, groupName: i.client.group?.name ?? null }];
}

type FinanceScopeRef = EconomicResult["reference"]["finance"][number] & { derivedStamp: string | null };
type Finance = {
  scopes: FinanceScopeRef[];
  income(groupId: string, year: number, cat: FinanceCategory): { state: "AVAILABLE"; value: Dec } | { state: "NO_SOURCE"; value: null; reason: string };
};

async function loadFinance(tx: Tx, years: number[], groupIds: string[]): Promise<Finance> {
  const scopes = await tx.$queryRaw<
    { year: number; category: FinanceCategory; batchId: string | null; version: number; extractionDate: string | null; origin: string | null; unassigned: bigint; derivedStamp: string | null }[]
  >(Prisma.sql`
    SELECT s.year, s.category, s."activeBatchId" AS "batchId", s.version, to_char(fb."extractionDate", 'YYYY-MM-DD') AS "extractionDate", fb.origin, fb."derivedStamp",
      (SELECT count(*) FROM "FinanceRow" r WHERE r."batchId" = s."activeBatchId" AND r."groupId" IS NULL) AS unassigned
    FROM "FinanceScope" s LEFT JOIN "FinanceBatch" fb ON fb."batchId" = s."activeBatchId"
    WHERE s.year = ANY(${years})`);
  const sums = groupIds.length
    ? await tx.$queryRaw<{ year: number; category: FinanceCategory; groupId: string; income: string }[]>(Prisma.sql`
        SELECT s.year, s.category, r."groupId", sum(r.income)::text AS income
        FROM "FinanceScope" s JOIN "FinanceRow" r ON r."batchId" = s."activeBatchId"
        WHERE s.year = ANY(${years}) AND r."groupId" = ANY(${groupIds}) GROUP BY 1, 2, 3`)
    : [];
  const incomeMap = new Map(sums.map((s) => [`${s.year}|${s.category}|${s.groupId}`, Dec.parse(s.income) as Dec]));
  const scopeMap = new Map(scopes.map((s) => [`${s.year}|${s.category}`, s]));
  return {
    scopes: FINANCE_CATEGORIES.flatMap((category) =>
      years.map((year) => {
        const s = scopeMap.get(`${year}|${category}`);
        const unassigned = Number(s?.unassigned ?? 0);
        const coverage = !s || !s.batchId ? "SIN_FUENTE" : s.origin === "HISTORICAL" ? "NO_CONFIRMADA" : unassigned > 0 ? "PARCIAL" : "COMPLETA";
        return { year, category, batchId: s?.batchId ?? null, version: s?.version ?? 0, extractionDate: s?.extractionDate ?? null, origin: s?.origin ?? null, unassigned, coverage, derivedStamp: s?.derivedStamp ?? null };
      }),
    ),
    income(groupId, year, cat) {
      const s = scopeMap.get(`${year}|${cat}`);
      if (!s || !s.batchId) return { state: "NO_SOURCE", value: null, reason: `Sin conjunto financiero activo de ${CATEGORY_LABEL[cat]} ${year}: el ingreso es desconocido, no cero.` };
      const v = incomeMap.get(`${year}|${cat}|${groupId}`);
      if (v) return { state: "AVAILABLE", value: v };
      const unassigned = Number(s.unassigned);
      if (s.origin === "HISTORICAL") return { state: "NO_SOURCE", value: null, reason: `Conjunto histórico de ${CATEGORY_LABEL[cat]} ${year} sin cobertura confirmada: la ausencia del grupo no acredita ingreso cero.` };
      if (unassigned > 0) return { state: "NO_SOURCE", value: null, reason: `El conjunto de ${CATEGORY_LABEL[cat]} ${year} tiene ${unassigned} línea(s) sin asignar a un grupo: la ausencia de este grupo no acredita ingreso cero.` };
      return { state: "AVAILABLE", value: ZERO }; // ausente en un conjunto anual completo, validado y atribuido: cero confirmado
    },
  };
}

async function loadHours(
  tx: Tx,
  scope: EconomicScope,
  ents: Ent[],
  periodRows: { key: string; from: string; to: string }[],
  filters: EconomicInput["filters"],
): Promise<HoursIndex> {
  const out: HoursIndex = new Map();
  if (ents.length === 0) return out;
  const colName = scope.type === "groups" ? "groupId" : scope.type === "client" ? "clientId" : "implementationId";
  const colRaw = Prisma.raw(`a."${colName}"`);
  const ids = ents.map((e) => e.id);
  const minFrom = periodRows.reduce((m, p) => (p.from < m ? p.from : m), periodRows[0].from);
  const maxTo = periodRows.reduce((m, p) => (p.to > m ? p.to : m), periodRows[0].to);
  const vals = Prisma.join(periodRows.map((p) => Prisma.sql`(${p.key}::text, ${p.from}::date, ${p.to}::date)`));
  const rows = await tx.$queryRaw<{ period: string; entity: string; service: string; cls: "ELIGIBLE" | "PENDING" | "EXCLUDED"; minutes: string }[]>(Prisma.sql`
    WITH periods(key, pfrom, pto) AS (VALUES ${vals}),
    a0 AS (
      SELECT t.* FROM "TimeActivity" t
      WHERE t."workDate" BETWEEN ${minFrom}::date AND ${maxTo}::date AND t.${Prisma.raw(`"${colName}"`)} = ANY(${ids})
        ${filters?.teamId ? Prisma.sql`AND t."teamId" = ${filters.teamId}` : Prisma.empty}
        ${filters?.levelId ? Prisma.sql`AND t."levelId" = ${filters.levelId}` : Prisma.empty}
        ${filters?.projectName ? Prisma.sql`AND t."projectName" = ${filters.projectName}` : Prisma.empty}),
    a AS (SELECT a.*, ${SERVICE_OF_SQL} AS svc FROM a0 a)
    SELECT p.key AS period, ${colRaw} AS entity, a.svc AS service, ${CLASS_OF_SQL} AS cls, sum(a.minutes)::text AS minutes
    FROM a JOIN periods p ON a."workDate" BETWEEN p.pfrom AND p.pto
    GROUP BY 1, 2, 3, 4`);
  for (const r of rows) {
    const byEntity = out.get(r.period) ?? new Map<string, Map<string, MinutesCell>>();
    const bySvc = byEntity.get(r.entity) ?? new Map<string, MinutesCell>();
    const cell = bySvc.get(r.service) ?? {};
    cell[r.cls] = (cell[r.cls] ?? ZERO).add(Dec.parse(r.minutes) as Dec);
    bySvc.set(r.service, cell);
    byEntity.set(r.entity, bySvc);
    out.set(r.period, byEntity);
  }
  return out;
}

async function loadUnattributed(tx: Tx, p: Period): Promise<EconomicResult["unattributed"]> {
  const rows = await tx.$queryRaw<{ bucket: string; minutes: string }[]>(Prisma.sql`
    SELECT a.bucket, sum(a.minutes)::text AS minutes FROM "TimeActivity" a
    WHERE a."workDate" BETWEEN ${p.from}::date AND ${p.to}::date AND a."isEligible" AND a."groupId" IS NULL GROUP BY 1`);
  const total = sumDec(rows.map((r) => Dec.parse(r.minutes) as Dec));
  return { eligibleHours: H(total), byBucket: Object.fromEntries(rows.map((r) => [r.bucket, H(Dec.parse(r.minutes) as Dec)])) };
}

async function loadUsers(tx: Tx, ents: Ent[], years: number[]) {
  const col = (e: Ent) => (e.type === "group" ? "groupId" : e.type === "client" ? "clientId" : "implementationId");
  const byType = { group: ents.filter((e) => e.type === "group"), client: ents.filter((e) => e.type === "client"), implementation: ents.filter((e) => e.type === "implementation") };
  const maps = new Map<string, Map<string, number>>(); // entityId → "y-m" → valor
  for (const t of ["group", "client", "implementation"] as const) {
    const list = byType[t];
    if (list.length === 0) continue;
    const c = col(list[0]);
    const rows = await tx.$queryRaw<{ id: string; year: number; month: number; value: number }[]>(Prisma.sql`
      SELECT m.${Prisma.raw(`"${c}"`)} AS id, m.year, mm.month, mm.value FROM "UserMatrix" m JOIN "UserMatrixMonth" mm ON mm."matrixId" = m.id
      WHERE m.year = ANY(${years}) AND m.${Prisma.raw(`"${c}"`)} = ANY(${list.map((e) => e.id)})`);
    for (const r of rows) {
      const mp = maps.get(r.id) ?? new Map<string, number>();
      mp.set(`${r.year}-${r.month}`, r.value);
      maps.set(r.id, mp);
    }
  }
  return (entityId: string) => {
    const mp = maps.get(entityId);
    return { at: (y: number, m: number): number | null => mp?.get(`${y}-${m}`) ?? null };
  };
}

/** Plan y alojamiento vigentes a la fecha de corte. Un grupo heterogéneo (hijos distintos) no toma el valor de un primer hijo. */
async function loadMetadata(tx: Tx, ents: Ent[], cut: string) {
  const out = new Map<string, { support: string; hosting: string }>();
  if (ents.length === 0) return out;
  const groupIds = ents.filter((e) => e.type === "group").map((e) => e.id);
  const clientIds = ents.filter((e) => e.type === "client").map((e) => e.id);
  const implIds = ents.filter((e) => e.type === "implementation").map((e) => e.id);
  const rows = await tx.$queryRaw<{ ent: string; attribute: string; value: string; level: string }[]>(Prisma.sql`
    SELECT COALESCE(t."groupId", t."clientId", t."implementationId") AS ent, t.attribute::text AS attribute, t.value,
      CASE WHEN t."groupId" IS NOT NULL THEN 'group' WHEN t."clientId" IS NOT NULL THEN 'client' ELSE 'impl' END AS level
    FROM "ServiceTerm" t
    WHERE t.attribute IN ('SUPPORT', 'HOSTING') AND (t."validFrom" IS NULL OR t."validFrom" <= ${cut}::date) AND (t."validTo" IS NULL OR ${cut}::date < t."validTo")
      AND (t."groupId" = ANY(${groupIds}) OR t."clientId" = ANY(${clientIds}) OR t."implementationId" = ANY(${implIds})
           OR t."clientId" IN (SELECT c.id FROM "Client" c WHERE c."groupId" = ANY(${groupIds})))`);
  const clientGroup = groupIds.length
    ? new Map((await tx.client.findMany({ where: { groupId: { in: groupIds } }, select: { id: true, groupId: true } })).map((c) => [c.id, c.groupId as string]))
    : new Map<string, string>();
  for (const e of ents) {
    const get = (attr: string): string => {
      const own = rows.filter((r) => r.attribute === attr && r.ent === e.id && ((e.type === "group" && r.level === "group") || (e.type !== "group")));
      if (own.length > 0) return own[0].value;
      if (e.type === "group") {
        const kids = new Set(rows.filter((r) => r.attribute === attr && r.level === "client" && clientGroup.get(r.ent) === e.id).map((r) => r.value));
        if (kids.size === 1) return [...kids][0];
        if (kids.size > 1) return "HETEROGENEO";
      }
      return "SIN_INFORMAR";
    };
    out.set(e.id, { support: get("SUPPORT"), hosting: get("HOSTING") });
  }
  return out;
}

/** Tiempos y PAP cuya atribución dependía del antiguo atajo de clave BC (retirado en CSAPP-05). */
export async function bcFallbackImpact(db: Tx | typeof prisma): Promise<{ wrike: number; pap: number }> {
  const r = await db.$queryRaw<{ w: bigint; p: bigint }[]>(Prisma.sql`
    SELECT
      (SELECT count(*) FROM "WrikeTimeEntry" e WHERE e."projectName" IS NOT NULL AND e."drvScopeMethod" IN ('PROJECT', 'PROJECT_TICKET') AND e."drvGroupId" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "ExternalIdentity" w WHERE w.system = 'WRIKE' AND w.kind IN ('PROJECT_NAME', 'PROJECT_ID') AND w."isActive" AND w."searchValue" IN (lower(e."projectName"), e."projectName"))
         AND EXISTS (SELECT 1 FROM "ExternalIdentity" b WHERE b.system = 'BC' AND b.kind = 'GROUP_KEY' AND b."isActive" AND b."searchValue" = lower(e."projectName"))) AS w,
      (SELECT count(*) FROM "PapItem" t JOIN "PapRevision" v ON v.id = t."currentRevisionId" WHERE v.project IS NOT NULL AND t."drvScope" = 'GROUP_ONLY'
         AND NOT EXISTS (SELECT 1 FROM "ExternalIdentity" w WHERE w.system = 'PAP' AND w.kind IN ('PROJECT_NAME', 'PROJECT_ID') AND w."isActive" AND w."searchValue" IN (lower(v.project), v.project))
         AND EXISTS (SELECT 1 FROM "ExternalIdentity" b WHERE b.system = 'BC' AND b.kind = 'GROUP_KEY' AND b."isActive" AND b."searchValue" = lower(v.project))) AS p`);
  return { wrike: Number(r[0].w), pap: Number(r[0].p) };
}
