import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  CATEGORY_LABEL,
  ECONOMIC_ENGINE_VERSION,
  ECONOMIC_METHOD,
  FINANCE_CATEGORIES,
  Dec,
  buildPeriods,
  deviationHoursParts,
  deviationPortfolioParts,
  deviationTargetParts,
  effectiveCut,
  eurosPerDay,
  monthsBetween,
  parseYmd,
  proratedMonthIncome,
  sumDec,
  targetHours,
  tariffRun,
  ymdToIso,
  lastDayOfMonth,
  type CutMode,
  type FinanceCategory,
  type Formula,
  type Period,
  type ResultStatus,
} from "@/domain/finance";
import { aggregatePortfolio, type PortfolioPeriodResult } from "@/domain/portfolio";
import { isIsoDate, todayMadrid } from "@/domain/vigencia";
import { authorize } from "@/server/authorize";
import { DomainError } from "@/server/errors";
import { financeMasterStamp } from "@/server/finance/resolve";
import { readDataStamp, type DataStamp } from "@/server/analytics/stamp";
import { getSettings, type EconomicSettings } from "./settings";

type Tx = Prisma.TransactionClient;

/**
 * Motor económico común (CSAPP-05 §8-§9, corregido en CSAPP-06). Las pantallas (Comparativa, Análisis Cliente, detalle y CSV) lo consumen;
 * no reconstruyen fórmulas, SQL ni lecturas del Excel. Una ejecución lee un estado coherente: una única transacción de lectura
 * REPEATABLE READ (instantánea de hechos financieros, tiempos, usuarios, atribuciones y configuración) y devuelve la referencia de lo leído.
 * `economicsInTx` permite que servicios que añaden consultas auxiliares compartan esa MISMA instantánea (no usan el `prisma` global).
 * Todos los importes y horas viajan como texto decimal exacto.
 */

export const SERVICES = ["SOPORTE", "ADMIN_DELEGADA", "OTROS", "TOTAL"] as const;
export type ServiceSelection = (typeof SERVICES)[number];
export const PERIOD_KEYS = ["month", "prevMonth", "cum", "prevYear", "prevCum"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export type EconomicScope =
  | { type: "groups"; ids: string[] | "ALL" }
  | { type: "client"; id: string }
  | { type: "implementation"; id: string }
  /** Conjuntos de Clientes / implantaciones (Pulse Rent): cada uno con sus usuarios propios y sin ingreso propio. */
  | { type: "clients"; ids: string[] }
  | { type: "implementations"; ids: string[] };

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
  /** Devuelve todas las entidades (la cartera ya se calculó con todas); el servicio analítico ordena y pagina. */
  unpaged?: boolean;
  /** Entidad para la que se preparan las series mensuales (año seleccionado y comparable anterior). Sin ella no se calculan series por entidad. */
  detailFor?: string;
  /** Años anteriores (< año del corte) de los que `detailFor` devuelve el año completo y el CUM comparable (gráficos anuales de la ficha). */
  historyYears?: number[];
};

export type Amount = { value: string | null; status: ResultStatus; reason: string | null; known: string; validated: boolean };

export type PeriodSeries = {
  key: string;
  label: string;
  from: string;
  to: string;
  /** Mes en curso / corte aún no cerrado por el reloj. */
  provisional: boolean;
  /** El último mes del periodo no está incluido entero (corte a mitad de mes). */
  partial: boolean;
  /** Los derivados usados no están pendientes de reproceso. Si es falso se conserva la magnitud, pero no se presenta como validada. */
  validated: boolean;
  revenue: Amount;
  incomeByCategory: Partial<Record<FinanceCategory, { value: string | null; state: string; reason: string | null }>>;
  hours: {
    /** Horas elegibles del perímetro del servicio seleccionado. */
    inPerimeter: string;
    /** Minutos exactos del perímetro (las horas se derivan al presentar). */
    perimeterMinutes: string;
    eligible: string;
    byService: Record<"SOPORTE" | "ADMIN_DELEGADA" | "OTROS" | "SIN_CLASIFICAR" | "CONFLICTO", string>;
    excluded: string;
    pendingEligibility: string;
  };
  users: { stock: { value: number | null; status: string }; userMonths: string | null; averageUsers: string | null; complete: boolean; missingMonths: { year: number; month: number }[]; /** Meses del periodo cuyo valor es «Estimado a partir de 2025» (no observado). */ estimatedMonths: { year: number; month: number }[] };
  perDay: Formula;
  targetHours: Formula;
  deviationVsTarget: Formula;
  deviationVsPortfolio: Formula | null;
  /** (horas reales − horas objetivo) / horas objetivo. Distinta de la desviación de €/jornada. */
  deviationHours: Formula;
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
  /** Serie mensual del año seleccionado (hasta el corte); solo para `detailFor`. */
  monthly: PeriodSeries[];
  /** Serie mensual del año anterior COMPARABLE (mismos meses, último mes cortado según el modo); solo para `detailFor`. */
  prevMonthly: PeriodSeries[];
  /** Año completo y CUM comparable (mismo corte del año) de cada año de `historyYears`, con las mismas fórmulas; solo para `detailFor`. */
  history: { year: number; full: PeriodSeries; cum: PeriodSeries }[];
};

export type PortfolioPeriod = PortfolioPeriodResult;

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
    /** Sello del estado completo leído (por dominio): MAX(drvVersion) por sí solo no identifica el estado. */
    dataStamp: DataStamp;
    pendingRecalc: { finance: boolean; bcFallback: { wrike: number; pap: number }; reason: string | null };
    /** Estado de validación de los derivados: con reproceso pendiente las magnitudes se conservan pero no están validadas. */
    validation: { state: "VALIDATED" | "PENDING_RECALC"; staleFinance: { year: number; category: FinanceCategory }[]; timeAttribution: boolean };
  };
};

const ZERO = Dec.ZERO;
const H = (minutes: Dec) => minutes.divInt(60).toString();

type FormulaExtra = Partial<Pick<Formula, "code" | "operands" | "expression" | "validated">>;
function formula(value: Dec | null, num: Dec | null, den: Dec | null, unit: string, status: ResultStatus, reason: string | null, extra: FormulaExtra = {}): Formula {
  return { value: value?.toString() ?? null, numerator: num?.toString() ?? null, denominator: den?.toString() ?? null, unit, status, reason, ...extra };
}
const na = (unit: string, status: ResultStatus, reason: string, code: string): Formula => ({ value: null, numerator: null, denominator: null, unit, status, reason, code });

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

export const CLASS_OF_SQL = Prisma.sql`CASE a.eligibility WHEN 'ELIGIBLE' THEN 'ELIGIBLE' WHEN 'PENDING_ELIGIBILITY' THEN 'PENDING' ELSE 'EXCLUDED' END`;

// ---------------------------------------------------------------- Lectura

type MinutesCell = Partial<Record<"ELIGIBLE" | "PENDING" | "EXCLUDED", Dec>>;
type HoursIndex = Map<string, Map<string, Map<string, MinutesCell>>>; // periodKey → entityId → service → clase

export async function runEconomics(actorId: string, input: EconomicInput): Promise<EconomicResult> {
  await authorize(prisma, actorId, "READ");
  // Una única transacción de lectura consistente: un cambio concurrente no mezcla el ingreso de un lote con su predecesor.
  return prisma.$transaction((tx) => economicsInTx(tx, input), { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 120_000 });
}

/** Ejecuta el motor dentro de la transacción de lectura del llamador (que ya autorizó y fijó REPEATABLE READ). */
export async function economicsInTx(tx: Tx, input: EconomicInput): Promise<EconomicResult> {
  const now = input.now ?? new Date();
  const date = input.date ?? todayMadrid(now);
  if (!isIsoDate(date)) throw new DomainError("Fecha de análisis no válida (AAAA-MM-DD).");
  const mode: CutMode = input.mode ?? "CUTOFF";
  if (!SERVICES.includes(input.service)) throw new DomainError("Servicio económico no válido.");
  return compute(tx, input, date, mode, now);
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
  const cutP = parseYmd(cut);
  const cutY = cutP.y;

  // 1. Entidades del ámbito (todas, antes de paginar: la cartera usa el conjunto filtrado completo).
  const ents = await loadEntities(tx, input.scope);
  const groupIds = [...new Set(ents.map((e) => e.groupId).filter((g): g is string => Boolean(g)))];
  const focus = input.detailFor ? ents.find((e) => e.id === input.detailFor) ?? null : null;

  // 2. Hechos financieros vigentes de los años implicados (una consulta por conjuntos).
  const historyYears = [...new Set((input.historyYears ?? []).filter((y) => Number.isInteger(y) && y < cutY && y >= 2000))].sort((a, b) => a - b);
  const years = [...new Set([cutY, cutY - 1, ...historyYears])];
  const finance = await loadFinance(tx, years, groupIds);

  // 3. Horas: una pasada por TimeActivity con un join de periodos (sin consulta por grupo/mes). Las series mensuales solo de la entidad en foco.
  const monthlyPeriods: { key: string; from: string; to: string; y: number; m: number }[] = [];
  const prevMonthlyPeriods: { key: string; from: string; to: string; y: number; m: number }[] = [];
  for (let m = 1; m <= cutP.m; m++) {
    monthlyPeriods.push({ key: `m${m}`, y: cutY, m, from: ymdToIso({ y: cutY, m, d: 1 }), to: m === cutP.m ? cut : ymdToIso({ y: cutY, m, d: lastDayOfMonth(cutY, m) }) });
    prevMonthlyPeriods.push({ key: `p${m}`, y: cutY - 1, m, from: ymdToIso({ y: cutY - 1, m, d: 1 }), to: m === cutP.m ? periods.prevCum.to : ymdToIso({ y: cutY - 1, m, d: lastDayOfMonth(cutY - 1, m) }) });
  }
  const periodRows = PERIOD_KEYS.map((k) => ({ key: k as string, from: periods[k].from, to: periods[k].to }));
  // Años históricos: el año completo y el CUM comparable con el MISMO corte (mismas reglas de mes completo/febrero que buildPeriods).
  const historyDefs = historyYears.map((y) => {
    const eq = buildPeriods(ymdToIso({ y, m: cutP.m, d: Math.min(cutP.d, lastDayOfMonth(y, cutP.m)) }), mode, today);
    return { year: y, full: { key: `hf${y}`, from: `${y}-01-01`, to: `${y}-12-31` }, cum: { key: `hc${y}`, from: eq.cum.from, to: eq.cum.to } };
  });
  const hours = await loadHours(tx, input.scope, ents, periodRows, input.filters);
  const monthlyHours = focus ? await loadHours(tx, input.scope, [focus], [...monthlyPeriods, ...prevMonthlyPeriods, ...historyDefs.flatMap((h) => [h.full, h.cum])], input.filters) : (new Map() as HoursIndex);
  const unattributed = await loadUnattributed(tx, periods.cum);

  // 4. Usuarios: un único acceso a la matriz de todas las entidades y años.
  const usersLookup = await loadUsers(tx, ents, [cutY, cutY - 1]);

  // 5. Metadatos con vigencia a la fecha de corte y tramos de plan del periodo valorado (sin multiplicar filas por tramos).
  const meta = await loadMetadata(tx, ents, cut);
  const plans = await loadPlanTerms(tx, ents, periods.prevYear.from, cut);

  // 6. Estado de validación: derivados pendientes de reproceso (se conservan las magnitudes, sin presentarlas como validadas).
  const stampNow = await financeMasterStamp(tx);
  const staleScopes = finance.scopes.filter((s) => s.batchId !== null && s.derivedStamp !== null && s.derivedStamp !== stampNow);
  const staleKey = new Set(staleScopes.map((s) => `${s.year}|${s.category}`));
  const fb = await bcFallbackImpact(tx);
  const timeAttributionStale = fb.wrike > 0;

  const partialFilter = Boolean(input.filters && (input.filters.teamId || input.filters.levelId || input.filters.projectName));
  const services: FinanceCategory[] = input.service === "TOTAL" ? [...FINANCE_CATEGORIES] : [input.service];

  type P = { from: string; to: string; label: string; provisional: boolean; months?: Period["months"] };
  const build = (e: Ent, key: string, p: P, kind: "period" | "monthly", idx: HoursIndex): PeriodSeries => {
    const months = p.months ?? monthsBetween(p.from, p.to);
    const lastMo = months[months.length - 1];
    const partial = lastMo.days < lastMo.daysInMonth;
    // Ingreso: solo al nivel Grupo Cliente.
    const incomeByCategory: PeriodSeries["incomeByCategory"] = {};
    let revenue: Amount;
    let validated = !timeAttributionStale;
    if (e.type !== "group") {
      revenue = { value: null, status: "NOT_COMPUTABLE", reason: "Ingreso agrupado en Grupo Cliente: sin ingreso propio ni ratio atribuido a este nivel.", known: "0", validated: true };
    } else {
      const parts: Dec[] = [];
      let missing = 0;
      let stale = false;
      for (const cat of services) {
        let sum = ZERO;
        let state = "AVAILABLE";
        let reason: string | null = null;
        for (const mo of months) {
          if (staleKey.has(`${mo.y}|${cat}`)) stale = true;
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
      if (stale) validated = false;
      revenue =
        missing === 0
          ? { value: known.toString(), status: "AVAILABLE", reason: stale ? "Atribución financiera pendiente de reproceso (maestros BC cambiados): magnitud conservada, no validada." : null, known: known.toString(), validated: !stale }
          : { value: null, status: missing === services.length ? "NO_SOURCE" : "PARTIAL", reason: `Falta el conjunto financiero de ${services.filter((c) => incomeByCategory[c]?.state !== "AVAILABLE").map((c) => CATEGORY_LABEL[c]).join(", ")} del periodo.`, known: known.toString(), validated: !stale };
    }
    // Horas del periodo.
    const cell = idx.get(key)?.get(e.id);
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
    const estimatedMonths: { year: number; month: number }[] = [];
    let userMonthsDec = ZERO;
    let weightDec = ZERO;
    for (const mo of months) {
      const v = lookup.at(mo.y, mo.m);
      weightDec = weightDec.add(Dec.int(1).ratio(mo.days, mo.daysInMonth));
      if (v === null) missingMonths.push({ year: mo.y, month: mo.m });
      else if (lookup.estimated(mo.y, mo.m)) estimatedMonths.push({ year: mo.y, month: mo.m });
      if (v !== null) userMonthsDec = userMonthsDec.add(Dec.int(v).ratio(mo.days, mo.daysInMonth));
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
      estimatedMonths,
    };

    // Plan del PERIODO valorado (no el actual): un cambio de plan posterior no habilita retrospectivamente otro método.
    const planSet = e.type === "group" ? plans.valuesIn(e.id, p.from, p.to) : new Set<string>();
    const hasSod = planSet.has("SILVER_ON_DEMAND");
    const mixedPlan = hasSod && planSet.size > 1;
    const monthlyMetric = kind === "monthly" || key === "month" || key === "prevMonth";
    const eco08 = monthlyMetric && hasSod;
    const eco08Reason = mixedPlan
      ? "El periodo mezcla tramos de plan Silver On Demand y otro plan, sin método aprobado: ECO 08 pendiente; se informa el límite y se muestran ingreso y horas conocidos."
      : "ECO 08 pendiente: la rentabilidad mensual recurrente de Silver On Demand no está activada; use el análisis anual o CUM. Ingreso y horas conocidos se muestran.";

    // Ratios (la falta de usuarios NO impide €/jornada).
    let perDay: Formula;
    const unit = "€/jornada";
    const minutesPerimeter = perimeter;
    const uncertain = input.service !== "TOTAL" && unknownService.sign() > 0;
    const uncertainPending = pending.sign() > 0;
    if (e.type !== "group") perDay = na(unit, "NOT_COMPUTABLE", "Ingreso agrupado en Grupo Cliente: el ratio se calcula al nivel del grupo.", "NOT_GROUP_LEVEL");
    else if (partialFilter) perDay = na(unit, "NOT_COMPUTABLE", "El filtro recorta solo las horas: sin el ingreso de ese subconjunto no hay rentabilidad; se usa el perímetro económico completo.", "HOURS_FILTER");
    else if (eco08) perDay = na(unit, "NOT_COMPUTABLE", eco08Reason, mixedPlan ? "PLAN_MIXED" : "SILVER_ON_DEMAND");
    else if (revenue.value === null) perDay = na(unit, revenue.status, revenue.reason ?? "Sin ingreso.", "INCOME_UNKNOWN");
    else if (uncertain) {
      perDay = formula(null, Dec.parse(revenue.value), minutesPerimeter.divInt(60), unit, "PARTIAL", `Hay ${H(unknownService)} h elegibles sin servicio o con servicios en conflicto en este ámbito y periodo: podrían cambiar el perímetro; no se presenta el ratio como completo.`, { code: "PERIMETER_PARTIAL" });
    } else if (uncertainPending) {
      perDay = formula(null, Dec.parse(revenue.value), minutesPerimeter.divInt(60), unit, "PARTIAL", `Hay ${H(pending)} h con elegibilidad pendiente (PMO desconocido) que podrían entrar en el perímetro.`, { code: "PERIMETER_PARTIAL" });
    } else {
      const r = Dec.parse(revenue.value) as Dec;
      const ed = eurosPerDay(r, minutesPerimeter, dayHours);
      if (ed.ratio === null) {
        perDay = formula(null, r, ed.hours, unit, "NOT_COMPUTABLE", r.sign() > 0 ? "Ingreso positivo con cero horas: no hay ratio (nunca infinito). El ingreso permanece en la cartera." : "Sin horas en el periodo: ratio no calculable.", { code: r.sign() > 0 ? "ZERO_HOURS" : "NO_HOURS" });
      } else perDay = formula(ed.ratio, r, ed.hours, unit, "AVAILABLE", null, { expression: "R / H × jornada" });
    }
    const th: Formula =
      revenue.value !== null && e.type === "group"
        ? formula(targetHours(Dec.parse(revenue.value) as Dec, target, dayHours), Dec.parse(revenue.value), target, "horas", "AVAILABLE", null, { expression: "R / objetivo × jornada", operands: { jornada: dayHours.toString() } })
        : na("horas", e.type !== "group" ? "NOT_COMPUTABLE" : revenue.status, e.type !== "group" ? "Sin ingreso propio: no hay horas objetivo a este nivel (el ingreso está agrupado en el Grupo Cliente)." : (revenue.reason ?? "Sin ingreso."), e.type !== "group" ? "NOT_GROUP_LEVEL" : "INCOME_UNKNOWN");
    let dev: Formula;
    if (perDay.value !== null) {
      const d = deviationTargetParts(target, Dec.parse(perDay.value) as Dec);
      dev = formula(d.value, d.numerator, d.denominator, "fracción", "AVAILABLE", "Positivo = rendimiento por debajo del objetivo.", { operands: { objetivo: target.toString(), ratio: perDay.value }, expression: "(objetivo − ratio) / objetivo" });
    } else dev = { ...na("fracción", perDay.status, perDay.reason ?? "Sin ratio.", perDay.code ?? "NO_RATIO"), operands: { objetivo: target.toString(), ratio: null } };
    // Desviación de horas: (reales − objetivo) / objetivo; depende del mismo perímetro y de las mismas restricciones que el ratio.
    let devHours: Formula;
    const realH = minutesPerimeter.divInt(60);
    if (th.value === null) devHours = na("fracción", th.status, th.reason ?? "Sin horas objetivo.", th.code ?? "NO_TARGET_HOURS");
    else if (partialFilter || eco08 || uncertain || uncertainPending) {
      devHours = { ...formula(null, null, Dec.parse(th.value), "fracción", "PARTIAL", partialFilter ? "El filtro recorta solo las horas: no es comparable con las horas objetivo del ingreso completo." : eco08 ? eco08Reason : "Perímetro de horas incompleto (servicio sin clasificar, en conflicto o elegibilidad pendiente).", { code: partialFilter ? "HOURS_FILTER" : eco08 ? (mixedPlan ? "PLAN_MIXED" : "SILVER_ON_DEMAND") : "PERIMETER_PARTIAL" }), operands: { horasReales: realH.toString(), horasObjetivo: th.value } };
    } else {
      const d = deviationHoursParts(realH, Dec.parse(th.value) as Dec);
      devHours = d
        ? formula(d.value, d.numerator, d.denominator, "fracción", "AVAILABLE", "Positivo = más horas que las objetivo (por encima de lo que el ingreso sostiene).", { operands: { horasReales: realH.toString(), horasObjetivo: th.value }, expression: "(horas reales − horas objetivo) / horas objetivo" })
        : { ...na("fracción", "NOT_COMPUTABLE", "Las horas objetivo son cero (ingreso cero): la desviación relativa no se calcula.", "ZERO_TARGET_HOURS"), operands: { horasReales: realH.toString(), horasObjetivo: th.value } };
    }
    // Tarifa anual por usuario (TAR RUN) = 12 × R_periodo / usuarios mes expuestos.
    let tariff: Formula;
    const fullYear = months.length === 12 && months.every((mo) => mo.days === mo.daysInMonth);
    if (e.type !== "group" || revenue.value === null) tariff = na("€/usuario·año", e.type !== "group" ? "NOT_COMPUTABLE" : revenue.status, e.type !== "group" ? "Sin ingreso propio en este nivel." : (revenue.reason ?? "Sin ingreso."), e.type !== "group" ? "NOT_GROUP_LEVEL" : "INCOME_UNKNOWN");
    else if (!users.complete || users.userMonths === null) tariff = na("€/usuario·año", "NOT_COMPUTABLE", "Usuarios del periodo incompletos o sin informar: la tarifa por usuario no es calculable (el ratio €/jornada sí).", "USERS_MISSING");
    else if (hasSod && !fullYear) tariff = na("€/usuario·año", "NOT_COMPUTABLE", "ECO 08 pendiente: no se anualiza por defecto un Silver On Demand en un periodo parcial (equivalente anual no aprobado). Con doce meses completos sí se calcula.", "SILVER_ON_DEMAND");
    else {
      const t = tariffRun(Dec.parse(revenue.value) as Dec, Dec.parse(users.userMonths) as Dec);
      tariff = t
        ? formula(t.value, t.numerator, t.denominator, "€/usuario·año", "AVAILABLE", [fullYear ? null : "Equivalente anual del periodo parcial: 12 × R / usuarios mes expuestos (no es una tarifa contractual).", estimatedMonths.length > 0 ? `Denominador estimado a partir de 2025 en ${estimatedMonths.length} mes(es) del periodo: no es un dato observado ese año.` : null].filter(Boolean).join(" ") || null, { expression: "12 × R / usuarios mes expuestos", operands: { ingresoPeriodo: revenue.value, usuariosMes: users.userMonths } })
        : na("€/usuario·año", "NOT_COMPUTABLE", "Usuarios mes cero: no se divide.", "USERS_ZERO");
    }
    const v = validated;
    const mark = (f: Formula): Formula => ({ ...f, validated: v });
    return {
      key,
      label: p.label,
      from: p.from,
      to: p.to,
      provisional: p.provisional,
      partial,
      validated: v,
      revenue: { ...revenue, validated: v },
      incomeByCategory,
      hours: {
        inPerimeter: H(minutesPerimeter),
        perimeterMinutes: minutesPerimeter.toString(),
        eligible: H(eligibleAll),
        byService: Object.fromEntries(svcs.map((s) => [s, H(elig[s])])) as PeriodSeries["hours"]["byService"],
        excluded: H(excluded),
        pendingEligibility: H(pending),
      },
      users,
      perDay: mark(perDay),
      targetHours: mark(th),
      deviationVsTarget: mark(dev),
      deviationVsPortfolio: null,
      deviationHours: mark(devHours),
      perUserPerYear: mark(tariff),
    };
  };

  const results: EntityResult[] = ents.map((e) => {
    const m = meta.get(e.id) ?? { support: "SIN_INFORMAR", hosting: "SIN_INFORMAR" };
    const per = Object.fromEntries(PERIOD_KEYS.map((k) => [k, build(e, k, periods[k], "period", hours)])) as Record<PeriodKey, PeriodSeries>;
    const isFocus = focus?.id === e.id;
    const monthly = isFocus ? monthlyPeriods.map((mp) => build(e, mp.key, { from: mp.from, to: mp.to, label: `${mp.y}-${String(mp.m).padStart(2, "0")}`, provisional: mp.m === cutP.m && periods.cum.provisional }, "monthly", monthlyHours)) : [];
    const prevMonthly = isFocus ? prevMonthlyPeriods.map((mp) => build(e, mp.key, { from: mp.from, to: mp.to, label: `${mp.y}-${String(mp.m).padStart(2, "0")}`, provisional: false }, "monthly", monthlyHours)) : [];
    const history = isFocus
      ? historyDefs.map((h) => ({
          year: h.year,
          full: build(e, h.full.key, { from: h.full.from, to: h.full.to, label: `Año ${h.year} completo`, provisional: false }, "period", monthlyHours),
          cum: build(e, h.cum.key, { from: h.cum.from, to: h.cum.to, label: `CUM ${h.year}`, provisional: false }, "period", monthlyHours),
        }))
      : [];
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
      prevMonthly,
      history,
    };
  });

  // 7. Cartera: ratio ponderado del conjunto filtrado COMPLETO (antes de paginar), nunca la media de ratios. Hereda las restricciones de las filas.
  let portfolio: EconomicResult["portfolio"] = null;
  if (input.scope.type === "groups") {
    portfolio = {} as Record<PeriodKey, PortfolioPeriod>;
    for (const k of PERIOD_KEYS) {
      portfolio[k] = aggregatePortfolio(
        results.map((r) => {
          const p = r.periods[k];
          return { id: r.id, revenue: p.revenue.value === null ? null : (Dec.parse(p.revenue.value) as Dec), minutes: Dec.parse(p.hours.perimeterMinutes) as Dec, status: p.perDay.status, code: p.perDay.code ?? null };
        }),
        target,
        dayHours,
      );
    }
    for (const r of results) {
      for (const k of PERIOD_KEYS) {
        const pr = portfolio[k].perDay;
        const own = r.periods[k].perDay;
        const dv = (f: Formula) => ({ ...f, validated: r.periods[k].validated });
        if (pr.value && own.value) {
          const d = deviationPortfolioParts(Dec.parse(pr.value) as Dec, Dec.parse(own.value) as Dec);
          r.periods[k].deviationVsPortfolio = d
            ? dv(formula(d.value, d.numerator, d.denominator, "fracción", "AVAILABLE", "Positivo = por debajo de la cartera filtrada.", { operands: { cartera: pr.value, grupo: own.value }, expression: "(cartera − grupo) / cartera" }))
            : dv({ ...na("fracción", "NOT_COMPUTABLE", "La cartera tiene ratio cero: no se divide.", "ZERO_PORTFOLIO"), operands: { cartera: pr.value, grupo: own.value } });
        } else if (!pr.value) {
          r.periods[k].deviationVsPortfolio = dv({ ...na("fracción", pr.status === "AVAILABLE" ? "NOT_COMPUTABLE" : pr.status, `La cartera filtrada no se publica como completa: ${pr.reason ?? "sin ratio."}`, pr.code ?? "PORTFOLIO_PARTIAL"), operands: { cartera: null, grupo: own.value } });
        } else {
          r.periods[k].deviationVsPortfolio = dv({ ...na("fracción", "NOT_COMPUTABLE", "El grupo no tiene ratio propio calculable.", own.code ?? "NO_RATIO"), operands: { cartera: pr.value, grupo: null } });
        }
      }
    }
  }

  // Referencia reproducible.
  const timeRef = (await tx.$queryRaw<{ z: number; w: number }[]>(Prisma.sql`
    SELECT (SELECT COALESCE(max("drvVersion"), 0) FROM "ZdTimeEntry")::int AS z, (SELECT COALESCE(max("drvVersion"), 0) FROM "WrikeTimeEntry")::int AS w`))[0];
  const dataStamp = await readDataStamp(tx);
  const pageSize = Math.min(Math.max(input.pageSize ?? 50, 1), 500);
  const page = Math.max(input.page ?? 1, 1);
  const stale = staleScopes.length > 0;

  return {
    input: { service: input.service, date, cut, mode, scopeType: input.scope.type },
    settings,
    recalculatedWithOlderSettings: settings.revisionNo !== latest.revisionNo,
    periodsDefinition: periods,
    entities: input.unpaged ? results : results.slice((page - 1) * pageSize, page * pageSize),
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
      dataStamp,
      pendingRecalc: {
        finance: stale,
        bcFallback: fb,
        reason: stale
          ? "Los maestros BC cambiaron desde la atribución de algún lote financiero: reprocese esos lotes para recalcular su atribución. Las magnitudes afectadas se conservan pero no están validadas."
          : fb.wrike + fb.pap > 0
            ? "Hay tiempos o PAP atribuidos por el antiguo atajo de clave BC: la atribución anterior se conserva como evidencia pero no está validada; cree equivalencias Wrike/PAP a Grupo y reprocese."
            : null,
      },
      validation: { state: stale || timeAttributionStale ? "PENDING_RECALC" : "VALIDATED", staleFinance: staleScopes.map((s) => ({ year: s.year, category: s.category })), timeAttribution: timeAttributionStale },
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
  if (scope.type === "clients") {
    const rows = await tx.client.findMany({ where: { id: { in: scope.ids } }, include: { group: { select: { id: true, name: true } } }, orderBy: [{ name: "asc" }, { id: "asc" }] });
    return rows.map((c) => ({ id: c.id, type: "client" as const, name: c.name, groupId: c.group?.id ?? null, groupName: c.group?.name ?? null }));
  }
  if (scope.type === "implementations") {
    const rows = await tx.implementation.findMany({ where: { id: { in: scope.ids } }, include: { client: { include: { group: { select: { id: true, name: true } } } } }, orderBy: [{ name: "asc" }, { id: "asc" }] });
    return rows.map((i) => ({ id: i.id, type: "implementation" as const, name: `${i.client.name} › ${i.name}`, groupId: i.client.group?.id ?? null, groupName: i.client.group?.name ?? null }));
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
  const colName = scope.type === "groups" ? "groupId" : scope.type === "client" || scope.type === "clients" ? "clientId" : "implementationId";
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
  const est = new Map<string, Set<string>>(); // entityId → "y-m" de valores «Estimado a partir de 2025"
  for (const t of ["group", "client", "implementation"] as const) {
    const list = byType[t];
    if (list.length === 0) continue;
    const c = col(list[0]);
    const rows = await tx.$queryRaw<{ id: string; year: number; month: number; value: number; estimated: boolean }[]>(Prisma.sql`
      SELECT m.${Prisma.raw(`"${c}"`)} AS id, m.year, mm.month, mm.value, (mm.kind::text = 'ESTIMATED') AS estimated FROM "UserMatrix" m JOIN "UserMatrixMonth" mm ON mm."matrixId" = m.id
      WHERE m.year = ANY(${years}) AND m.${Prisma.raw(`"${c}"`)} = ANY(${list.map((e) => e.id)})`);
    for (const r of rows) {
      const mp = maps.get(r.id) ?? new Map<string, number>();
      mp.set(`${r.year}-${r.month}`, r.value);
      maps.set(r.id, mp);
      if (r.estimated) est.set(r.id, (est.get(r.id) ?? new Set<string>()).add(`${r.year}-${r.month}`));
    }
  }
  return (entityId: string) => {
    const mp = maps.get(entityId);
    return { at: (y: number, m: number): number | null => mp?.get(`${y}-${m}`) ?? null, estimated: (y: number, m: number): boolean => est.get(entityId)?.has(`${y}-${m}`) ?? false };
  };
}

/**
 * Tramos de plan de soporte de los Grupos Cliente que solapan el rango consultado (una sola lectura). `valuesIn` devuelve los planes
 * vigentes DURANTE un periodo: un cambio actual de plan no habilita retrospectivamente otro método. Un grupo con tramos propios usa
 * esos; sin ellos, los de sus Clientes.
 */
async function loadPlanTerms(tx: Tx, ents: Ent[], from: string, to: string) {
  const groupIds = ents.filter((e) => e.type === "group").map((e) => e.id);
  type T = { ent: string; level: string; value: string; vf: string | null; vt: string | null };
  const rows = groupIds.length
    ? await tx.$queryRaw<T[]>(Prisma.sql`
        SELECT COALESCE(t."groupId", c."groupId") AS ent, CASE WHEN t."groupId" IS NOT NULL THEN 'group' ELSE 'client' END AS level, t.value,
          to_char(t."validFrom", 'YYYY-MM-DD') AS vf, to_char(t."validTo", 'YYYY-MM-DD') AS vt
        FROM "ServiceTerm" t LEFT JOIN "Client" c ON c.id = t."clientId"
        WHERE t.attribute = 'SUPPORT' AND (t."validFrom" IS NULL OR t."validFrom" <= ${to}::date) AND (t."validTo" IS NULL OR ${from}::date < t."validTo")
          AND (t."groupId" = ANY(${groupIds}) OR c."groupId" = ANY(${groupIds}))`)
    : [];
  const byGroup = new Map<string, T[]>();
  for (const r of rows) byGroup.set(r.ent, [...(byGroup.get(r.ent) ?? []), r]);
  return {
    valuesIn(groupId: string, pFrom: string, pTo: string): Set<string> {
      const hit = (byGroup.get(groupId) ?? []).filter((t) => (t.vf === null || t.vf <= pTo) && (t.vt === null || pFrom < t.vt));
      const own = hit.filter((t) => t.level === "group");
      return new Set((own.length > 0 ? own : hit).map((t) => t.value));
    },
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
