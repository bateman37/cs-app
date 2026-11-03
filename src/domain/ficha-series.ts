import { Dec, eurosPerDay } from "./finance";

/**
 * Series y comparación interanual de la ficha de Análisis Cliente (HOTFIX-02 §8). Funciones PURAS sobre las series del motor económico
 * (`EntityResult.monthly` / `prevMonthly` / `history`): el gráfico, el tooltip y la tabla equivalente salen de ESTE mismo conjunto de filas y
 * ninguna fórmula económica se repite aquí (los ratios mensuales los calcula el motor; el CUM por mes se recalcula con `eurosPerDay`, el mismo
 * operador del motor, sobre Σingresos y Σminutos: nunca suma ni promedia ratios mensuales).
 *
 * Reglas:
 *  - Variación de magnitudes = (actual − anterior) / abs(anterior) cuando el anterior es distinto de cero. Anterior cero o ausente NO produce
 *    infinito ni 0 %: el estado lo indica (`BASE_CERO`, `SIN_ANTERIOR`, `SIN_ACTUAL`).
 *  - Los porcentajes (fracciones) se comparan en PUNTOS PORCENTUALES: (actual − anterior) × 100; no hay variación relativa.
 *  - Los meses posteriores al corte son futuros: celdas vacías (null), nunca ceros.
 *  - El mes del corte es parcial si el corte está a mitad de mes y se compara con el mismo día equivalente del año anterior (lo decide el motor:
 *    `prevMonthly`); `curTo`/`prevTo` documentan hasta qué fecha llega cada lado.
 */

export const MONTH_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;
export const MONTH_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"] as const;

type Fm = { value: string | null; reason: string | null; code?: string | null; status?: string };
/** Forma mínima de un mes del motor (`PeriodSeries` la satisface estructuralmente). */
export type MonthSrc = {
  label: string;
  from: string;
  to: string;
  provisional: boolean;
  partial: boolean;
  revenue: { value: string | null; reason: string | null };
  hours: { inPerimeter: string; perimeterMinutes: string };
  perDay: Fm;
  deviationVsTarget: Fm;
  targetHours?: Fm;
};

export type Cell = { v: string | null; reason: string | null };
export const cell = (v: string | null | undefined, reason: string | null = null): Cell => ({ v: v ?? null, reason: v === null || v === undefined ? reason : null });

export type CmpState = "OK" | "BASE_CERO" | "SIN_ANTERIOR" | "SIN_ACTUAL" | "SIN_DATOS";
export type Cmp = {
  state: CmpState;
  /** Magnitudes: actual − anterior. Fracciones: puntos porcentuales ((actual − anterior) × 100). */
  diff: string | null;
  /** Variación relativa de magnitudes (fracción). Siempre null en fracciones y con base cero/ausente. */
  pct: string | null;
};

const dec = (v: string | null): Dec | null => (v === null ? null : Dec.parse(v));

export function compareValues(cur: string | null, prev: string | null, kind: "magnitude" | "fraction"): Cmp {
  const c = dec(cur);
  const p = dec(prev);
  if (c === null && p === null) return { state: "SIN_DATOS", diff: null, pct: null };
  if (c === null) return { state: "SIN_ACTUAL", diff: null, pct: null };
  if (p === null) return { state: "SIN_ANTERIOR", diff: null, pct: null };
  const d = c.sub(p);
  if (kind === "fraction") return { state: "OK", diff: d.mulInt(100).toString(), pct: null };
  if (p.isZero()) return { state: "BASE_CERO", diff: d.toString(), pct: null };
  return { state: "OK", diff: d.toString(), pct: d.div(p.abs()).toString() };
}

export const CMP_TEXT: Record<Exclude<CmpState, "OK">, string> = {
  BASE_CERO: "Año anterior en cero: la variación relativa no se define (no se inventa infinito ni 0 %).",
  SIN_ANTERIOR: "Sin dato del año anterior en este mes.",
  SIN_ACTUAL: "Sin dato del año actual en este mes.",
  SIN_DATOS: "Sin dato en ninguno de los dos años.",
};

// ---------------------------------------------------------------- Medidas

export type MeasureKey = "perDay" | "cumPerDay" | "hours" | "revenue" | "pap" | "devTarget";
export type Measure = { key: MeasureKey; title: string; unit: string; kind: "magnitude" | "fraction"; digits: number; direction: string; better: "higher" | "lower" | "neutral" };
export const MEASURES: Record<MeasureKey, Measure> = {
  perDay: { key: "perDay", title: "Rentabilidad mensual", unit: "€/jornada", kind: "magnitude", digits: 0, direction: "Subir = más ingreso por jornada dedicada (mejor)", better: "higher" },
  cumPerDay: { key: "cumPerDay", title: "Rentabilidad CUM", unit: "€/jornada", kind: "magnitude", digits: 0, direction: "Σ ingresos / Σ horas × jornada, acumulado enero–mes (no suma de ratios)", better: "higher" },
  hours: { key: "hours", title: "Horas dedicadas", unit: "h", kind: "magnitude", digits: 1, direction: "Subir = más horas dedicadas (no implica mejor ni peor)", better: "neutral" },
  revenue: { key: "revenue", title: "Ingreso imputado", unit: "€", kind: "magnitude", digits: 0, direction: "Subir = más ingreso imputado (no es factura mensual real)", better: "neutral" },
  pap: { key: "pap", title: "PAP únicos con puesta en producción", unit: "PAP", kind: "magnitude", digits: 0, direction: "Subir = más PAP puestos en producción en el mes", better: "neutral" },
  devTarget: { key: "devTarget", title: "Desviación contra objetivo", unit: "%", kind: "fraction", digits: 1, direction: "Positivo = por debajo del objetivo (peor); la diferencia se expresa en puntos porcentuales", better: "lower" },
};

// ---------------------------------------------------------------- Filas mensuales alineadas enero–diciembre

export type MonthRow = {
  month: number;
  short: string;
  /** Mes posterior al corte: vacío, nunca cero. */
  future: boolean;
  cur: Cell | null;
  prev: Cell | null;
  cmp: Cmp | null;
  /** Hasta qué día llega cada lado (AAAA-MM-DD) y si el lado actual es un mes parcial/provisional. */
  curTo: string | null;
  prevTo: string | null;
  partial: boolean;
  provisional: boolean;
};

/** Alinea los meses del año elegido y del anterior comparable (ambos desde enero) a los 12 meses del calendario. */
export function alignMonths(measure: Measure, cutMonth: number, cur: Cell[], prev: Cell[], curSrc: MonthSrc[], prevSrc: MonthSrc[]): MonthRow[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const future = m > cutMonth;
    if (future) return { month: m, short: MONTH_SHORT[i], future: true, cur: null, prev: null, cmp: null, curTo: null, prevTo: null, partial: false, provisional: false };
    const c = cur[i] ?? { v: null, reason: "Sin dato." };
    const p = prev[i] ?? null;
    return {
      month: m,
      short: MONTH_SHORT[i],
      future: false,
      cur: c,
      prev: p,
      cmp: compareValues(c.v, p?.v ?? null, measure.kind),
      curTo: curSrc[i]?.to ?? null,
      prevTo: prevSrc[i]?.to ?? null,
      partial: curSrc[i]?.partial ?? false,
      provisional: curSrc[i]?.provisional ?? false,
    };
  });
}

/** Celdas de una medida a partir de las series mensuales del motor. */
export function cellsOf(measure: "perDay" | "hours" | "revenue" | "devTarget", srcs: MonthSrc[]): Cell[] {
  return srcs.map((s) => {
    if (measure === "perDay") return cell(s.perDay.value, s.perDay.reason ?? "Sin rentabilidad calculable.");
    if (measure === "hours") return cell(s.hours.inPerimeter);
    if (measure === "revenue") return cell(s.revenue.value, s.revenue.reason ?? "Sin ingreso.");
    return cell(s.deviationVsTarget.value, s.deviationVsTarget.reason ?? "Sin desviación calculable.");
  });
}

/** Códigos que invalidan la rentabilidad de un tramo (perímetro incompleto o recorte solo de horas): contaminan también el acumulado. */
const BLOCKING = new Set(["PERIMETER_PARTIAL", "HOURS_FILTER", "NOT_GROUP_LEVEL"]);

/**
 * CUM por mes (enero–mes k): Σ ingresos / Σ horas × jornada con el operador del motor. El acumulado se interrumpe en el primer mes sin ingreso
 * conocido o con perímetro incompleto (un acumulado con huecos no es comparable); Silver On Demand no bloquea (el motor permite CUM).
 */
export function cumulativeCells(srcs: MonthSrc[], dayHours: Dec): Cell[] {
  let revenue: Dec | null = Dec.ZERO;
  let minutes = Dec.ZERO;
  let broken: string | null = null;
  return srcs.map((s) => {
    minutes = minutes.add(Dec.parse(s.hours.perimeterMinutes) ?? Dec.ZERO);
    if (broken === null) {
      if (BLOCKING.has(s.perDay.code ?? "")) broken = s.perDay.reason ?? "Perímetro de horas incompleto.";
      else if (s.revenue.value === null) broken = s.revenue.reason ?? "Ingreso desconocido en algún mes del acumulado.";
      else revenue = (revenue as Dec).add(Dec.parse(s.revenue.value) ?? Dec.ZERO);
    }
    if (broken !== null || revenue === null) return { v: null, reason: broken ?? "Sin ingreso." };
    const r = eurosPerDay(revenue, minutes, dayHours);
    return r.ratio === null ? { v: null, reason: "Sin horas en el acumulado: no hay ratio (nunca infinito)." } : { v: r.ratio.toString(), reason: null };
  });
}

// ---------------------------------------------------------------- Series anuales

export type AnnualCell = { revenue: Cell; hours: Cell; perDay: Cell; to: string };
export type AnnualPoint = { year: number; full: AnnualCell | null; cum: AnnualCell | null; currentYear: boolean };

type PeriodLike = { to: string; revenue: { value: string | null; reason: string | null }; hours: { inPerimeter: string }; perDay: { value: string | null; reason: string | null } };
const annualCell = (p: PeriodLike): AnnualCell => ({ revenue: cell(p.revenue.value, p.revenue.reason ?? "Sin ingreso."), hours: cell(p.hours.inPerimeter), perDay: cell(p.perDay.value, p.perDay.reason ?? "Sin rentabilidad calculable."), to: p.to });

/** Un punto por año disponible: año completo y CUM comparable. El año del corte solo tiene CUM (el año completo aún no existe). */
export function annualPoints(history: { year: number; full: PeriodLike; cum: PeriodLike }[], currentYear: number, current: PeriodLike): AnnualPoint[] {
  return [
    ...[...history].sort((a, b) => a.year - b.year).map((h) => ({ year: h.year, full: annualCell(h.full), cum: annualCell(h.cum), currentYear: false })),
    { year: currentYear, full: null, cum: annualCell(current), currentYear: true },
  ];
}

/** Descarta años iniciales sin ningún dato (ni ingreso, ni horas): «años disponibles». Conserva huecos intermedios. */
export function trimEmptyYears(points: AnnualPoint[]): AnnualPoint[] {
  const has = (c: AnnualCell | null) => c !== null && (c.revenue.v !== null || (c.hours.v !== null && !Dec.parse(c.hours.v)?.isZero()));
  const first = points.findIndex((p) => has(p.full) || has(p.cum));
  return first < 0 ? points.filter((p) => p.currentYear) : points.slice(first);
}
