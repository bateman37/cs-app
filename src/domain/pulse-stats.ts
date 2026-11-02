/**
 * Estadística, bandas y normalización de Pulse Rent (CSAPP-07 §5-§7), sin dependencias de servidor. Todo en decimales exactos (`Dec`):
 * ningún importe ni ratio pasa por `Number`. Reglas: docs/producto/pulse-rent.md (PUL 02-05) y docs/calculos/catalogo.md (CAL 37-44).
 */
import { Dec } from "./finance";

// ---------------------------------------------------------------- Percentiles (compatibles con PERCENTILE.INC)

/** Orden numérico ascendente estable (nunca léxico). */
export const sortDec = (values: readonly Dec[]): Dec[] => [...values].sort((a, b) => a.cmp(b));

/**
 * Percentil inclusivo continuo: posición `(N−1)×q` sobre la muestra ordenada, interpolación lineal entre adyacentes.
 * `q` se da como fracción exacta num/den (p. ej. 1/4) para que la posición sea racional exacta. Muestra vacía → null.
 */
export function percentileInc(sorted: readonly Dec[], num: number, den: number): Dec | null {
  const n = sorted.length;
  if (n === 0) return null;
  if (den <= 0 || num < 0 || num > den) throw new Error("Percentil fuera de [0,1].");
  if (n === 1) return sorted[0];
  const pos = BigInt(n - 1) * BigInt(num); // posición = pos / den
  const lo = Number(pos / BigInt(den));
  const rem = Number(pos % BigInt(den));
  if (rem === 0 || lo >= n - 1) return sorted[Math.min(lo, n - 1)];
  const a = sorted[lo];
  const b = sorted[lo + 1];
  // a + (b − a) × rem/den con un único redondeo.
  return a.add(b.sub(a).ratio(rem, den));
}

export const STAT_POINTS = [
  { key: "p10", num: 10, den: 100 },
  { key: "p25", num: 25, den: 100 },
  { key: "p50", num: 50, den: 100 },
  { key: "p75", num: 75, den: 100 },
  { key: "p90", num: 90, den: 100 },
] as const;

export type Distribution = {
  /** Entidades con valor válido (cero confirmado participa; null no). */
  n: number;
  excluded: number;
  excludedReasons: { reason: string; count: number }[];
  mean: string | null;
  median: string | null;
  p10: string | null;
  p25: string | null;
  p75: string | null;
  p90: string | null;
  min: string | null;
  max: string | null;
  /** Todas las observaciones valen lo mismo: no se inventa dispersión. */
  constant: boolean;
  /** N pequeño (1 o 2): estadísticas deterministas con advertencia descriptiva; sin mínimo arbitrario para cambiar bandas. */
  warning: string | null;
};

export type Observation = { value: Dec | null; reason?: string | null };

/** Distribución de una columna sobre TODA la cohorte de referencia (antes de paginar). Una observación por identidad canónica. */
export function distribution(observations: readonly Observation[]): Distribution {
  const valid = observations.filter((o): o is { value: Dec; reason?: string | null } => o.value !== null).map((o) => o.value);
  const reasons = new Map<string, number>();
  for (const o of observations) if (o.value === null) reasons.set(o.reason ?? "sin valor", (reasons.get(o.reason ?? "sin valor") ?? 0) + 1);
  const excludedReasons = [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, "es"));
  const empty: Distribution = { n: 0, excluded: observations.length, excludedReasons, mean: null, median: null, p10: null, p25: null, p75: null, p90: null, min: null, max: null, constant: false, warning: "Sin referencia: ninguna entidad con valor válido." };
  if (valid.length === 0) return empty;
  const sorted = sortDec(valid);
  const pt = (k: (typeof STAT_POINTS)[number]) => percentileInc(sorted, k.num, k.den)?.toString() ?? null;
  const sum = sorted.reduce((s, v) => s.add(v), Dec.ZERO);
  const constant = sorted[0].cmp(sorted[sorted.length - 1]) === 0;
  return {
    n: sorted.length,
    excluded: observations.length - sorted.length,
    excludedReasons,
    mean: sum.divInt(sorted.length).toString(),
    median: pt(STAT_POINTS[2]),
    p10: pt(STAT_POINTS[0]),
    p25: pt(STAT_POINTS[1]),
    p75: pt(STAT_POINTS[3]),
    p90: pt(STAT_POINTS[4]),
    min: sorted[0].toString(),
    max: sorted[sorted.length - 1].toString(),
    constant,
    warning:
      sorted.length === 1
        ? "Una sola entidad en la referencia: los percentiles coinciden con su valor; no hay dispersión que describir."
        : constant
          ? "Todas las entidades de la referencia tienen el mismo valor: los cortes coinciden."
          : sorted.length < 5
            ? `Referencia de solo ${sorted.length} entidades: percentiles descriptivos, sin mínimo de muestra impuesto.`
            : null,
  };
}

// ---------------------------------------------------------------- Bandas de Pulse Rent (PUL 03)

export const BAND_KEYS = ["verde_intenso", "verde_claro", "amarillo", "naranja", "rojo"] as const;
export type Band = (typeof BAND_KEYS)[number];
export const BAND_LABEL: Record<Band, string> = {
  verde_intenso: "Verde intenso",
  verde_claro: "Verde claro",
  amarillo: "Amarillo",
  naranja: "Naranja",
  rojo: "Rojo",
};
/** Direction: LOWER = menor valor es mejor (magnitudes de carga); HIGHER = mayor es mejor (tarifa, €/jornada); NONE = sin juicio. */
export type Direction = "LOWER" | "HIGHER" | "NONE";
export type BandResult = { band: Band | null; reason: string | null; rule: string };

export type Cuts = { p10: Dec; p25: Dec; p75: Dec; p90: Dec };

/**
 * Banda de un valor contra los cortes de su referencia. Se evalúa en el orden del contrato cuando los cortes coinciden; sin epsilon ni
 * anchuras artificiales.
 *  LOWER:  x<=P10 verde intenso · P10<x<=P25 verde claro · P25<x<=P75 amarillo · P75<x<=P90 naranja · x>P90 rojo.
 *  HIGHER: x<P10 rojo · P10<=x<P25 naranja · P25<=x<P75 amarillo · P75<=x<P90 verde claro · x>=P90 verde intenso.
 */
export function bandOf(x: Dec | null, dir: Direction, cuts: Cuts | null): BandResult {
  const rule = dir === "LOWER" ? "menor = mejor: ≤P10 · ≤P25 · ≤P75 · ≤P90 · >P90" : dir === "HIGHER" ? "mayor = mejor: <P10 · <P25 · <P75 · <P90 · ≥P90" : "sin juicio favorable/desfavorable";
  if (dir === "NONE") return { band: null, reason: "Esta magnitud se muestra sin juicio favorable/desfavorable (contexto).", rule };
  if (x === null) return { band: null, reason: "Valor no calculable: no se colorea.", rule };
  if (cuts === null) return { band: null, reason: "Sin referencia: no hay cortes para esta columna.", rule };
  if (dir === "LOWER") {
    if (x.cmp(cuts.p10) <= 0) return { band: "verde_intenso", reason: null, rule };
    if (x.cmp(cuts.p25) <= 0) return { band: "verde_claro", reason: null, rule };
    if (x.cmp(cuts.p75) <= 0) return { band: "amarillo", reason: null, rule };
    if (x.cmp(cuts.p90) <= 0) return { band: "naranja", reason: null, rule };
    return { band: "rojo", reason: null, rule };
  }
  if (x.cmp(cuts.p10) < 0) return { band: "rojo", reason: null, rule };
  if (x.cmp(cuts.p25) < 0) return { band: "naranja", reason: null, rule };
  if (x.cmp(cuts.p75) < 0) return { band: "amarillo", reason: null, rule };
  if (x.cmp(cuts.p90) < 0) return { band: "verde_claro", reason: null, rule };
  return { band: "verde_intenso", reason: null, rule };
}

export function cutsOf(d: Distribution): Cuts | null {
  if (d.n === 0 || d.p10 === null || d.p25 === null || d.p75 === null || d.p90 === null) return null;
  return { p10: Dec.parse(d.p10) as Dec, p25: Dec.parse(d.p25) as Dec, p75: Dec.parse(d.p75) as Dec, p90: Dec.parse(d.p90) as Dec };
}

// ---------------------------------------------------------------- Normalización (PUL 02)

/** Exposición en usuarios mes: cada mes pesa días incluidos / días reales. `users` null = mes sin informar (no se rellena con cero). */
export type MonthExposure = { users: number | null; days: number; daysInMonth: number };
export type Exposure = {
  /** UM: usuarios mes. null si algún mes no está informado. */
  userMonths: Dec | null;
  /** Exposición temporal en meses (Σ días/días del mes). */
  months: Dec;
  /** Usuarios medios = UM / meses (no es el stock final). */
  averageUsers: Dec | null;
  missingMonths: number;
};

export function exposureOf(months: readonly MonthExposure[]): Exposure {
  let um = Dec.ZERO;
  let w = Dec.ZERO;
  let missing = 0;
  for (const m of months) {
    w = w.add(Dec.int(1).ratio(m.days, m.daysInMonth));
    if (m.users === null) missing++;
    else um = um.add(Dec.int(m.users).ratio(m.days, m.daysInMonth));
  }
  const userMonths = missing === 0 ? um : null;
  return { userMonths, months: w, averageUsers: userMonths !== null && !w.isZero() ? userMonths.div(w) : null, missingMonths: missing };
}

export const NORMALIZATIONS = ["raw", "per_user", "per_user_year", "per_100", "per_100_year"] as const;
export type Normalization = (typeof NORMALIZATIONS)[number];
export const NORMALIZATION_LABEL: Record<Normalization, string> = {
  raw: "Bruto del periodo",
  per_user: "Por usuario y mes",
  per_user_year: "Equivalente anual por usuario",
  per_100: "Por 100 usuarios y mes",
  per_100_year: "Equivalente anual por 100 usuarios",
};
export const NORMALIZATION_FORMULA: Record<Normalization, string> = {
  raw: "valor del periodo (sin normalizar)",
  per_user: "H / UM",
  per_user_year: "12 × H / UM",
  per_100: "100 × eventos / UM",
  per_100_year: "1200 × eventos / UM",
};

export type NormalizedValue = { value: Dec | null; reason: string | null; numerator: Dec | null; denominator: Dec | null };

/**
 * Normaliza una magnitud de FLUJO (horas o eventos únicos ya registrados) por usuarios mes. Las horas/eventos del corte parcial NO se
 * prorratean: solo la exposición. Sin usuarios (UM ausente o cero) no hay ratio; el bruto sigue disponible.
 */
export function normalize(raw: Dec | null, norm: Normalization, ex: Pick<Exposure, "userMonths">): NormalizedValue {
  if (raw === null) return { value: null, reason: "Valor bruto no calculable.", numerator: null, denominator: null };
  if (norm === "raw") return { value: raw, reason: null, numerator: raw, denominator: null };
  if (ex.userMonths === null) return { value: null, reason: "Usuarios del periodo incompletos o sin informar: no hay ratio por usuario (el bruto sí).", numerator: raw, denominator: null };
  if (ex.userMonths.isZero()) return { value: null, reason: "Usuarios mes cero: no se divide.", numerator: raw, denominator: ex.userMonths };
  const factor = norm === "per_user" ? 1 : norm === "per_user_year" ? 12 : norm === "per_100" ? 100 : 1200;
  return { value: raw.mulInt(factor).div(ex.userMonths), reason: null, numerator: raw.mulInt(factor), denominator: ex.userMonths };
}

/**
 * Equivalencia HISTÓRICA de horas (modo separado): H_CUM / U_corte / número_mes × 12, con supuesto explícito de usuarios constantes y
 * meses completos. No sustituye la normalización correcta; no se activa en un corte parcial ambiguo.
 */
export function historicalHoursEquivalent(hoursCum: Dec, usersAtCut: number | null, monthNumber: number, partialCut: boolean): NormalizedValue {
  if (partialCut) return { value: null, reason: "Corte parcial ambiguo: la equivalencia histórica supone meses completos.", numerator: hoursCum, denominator: null };
  if (usersAtCut === null) return { value: null, reason: "Sin usuarios al corte.", numerator: hoursCum, denominator: null };
  if (usersAtCut === 0) return { value: null, reason: "Usuarios al corte cero: no se divide.", numerator: hoursCum, denominator: Dec.ZERO };
  const den = Dec.int(usersAtCut).mulInt(monthNumber);
  return { value: hoursCum.mulInt(12).div(den), reason: null, numerator: hoursCum.mulInt(12), denominator: den };
}

/** Tarifa de un año completo = ingreso anual / usuarios medios de los 12 meses (usuarios medios, no stock). */
export function annualTariff(income: Dec, ex: Exposure): NormalizedValue {
  if (ex.averageUsers === null) return { value: null, reason: "Usuarios incompletos: sin usuarios medios.", numerator: income, denominator: null };
  if (ex.averageUsers.isZero()) return { value: null, reason: "Usuarios medios cero: no se divide.", numerator: income, denominator: ex.averageUsers };
  return { value: income.div(ex.averageUsers), reason: null, numerator: income, denominator: ex.averageUsers };
}

// ---------------------------------------------------------------- Cartera económica frente a media de ratios

/** Ratio económico de cartera ΣR/ΣH × jornada. No es la media aritmética de los ratios de cada grupo. */
export function portfolioEuroPerDay(rows: readonly { revenue: Dec; hours: Dec }[], dayHours: Dec): { value: Dec | null; sumRevenue: Dec; sumHours: Dec } {
  const sumRevenue = rows.reduce((s, r) => s.add(r.revenue), Dec.ZERO);
  const sumHours = rows.reduce((s, r) => s.add(r.hours), Dec.ZERO);
  return { value: sumHours.isZero() ? null : sumRevenue.div(sumHours).mul(dayHours), sumRevenue, sumHours };
}
