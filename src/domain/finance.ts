/**
 * Dominio financiero de CSAPP-05 (sin dependencias de servidor): decimales exactos, categorías, comprobación del pie,
 * aritmética de periodos y fórmulas económicas. Las reglas están en docs/importaciones/facturacion.md (FAC 01-08) y
 * docs/calculos/catalogo.md (CAL 17-30). Nunca se usa `Number` para sumar, normalizar importes ni calcular ratios.
 */
import { cleanText } from "./normalize";
import { daysInMonth } from "./usuarios";
import { isIsoDate } from "./vigencia";

// ---------------------------------------------------------------- Decimales exactos

/** Escala fija de los importes (coincide con NUMERIC(38,20) de las columnas financieras). */
export const DEC_SCALE = 20;
const ONE = 10n ** BigInt(DEC_SCALE);

/**
 * Decimal exacto con escala fija de 20 posiciones, respaldado por BigInt. Admite texto con notación científica.
 * Si el origen trae más de 20 decimales se redondea (mitad hacia fuera) a la escala documentada; el texto original se conserva aparte.
 */
export class Dec {
  private constructor(readonly units: bigint) {}

  static readonly ZERO = new Dec(0n);

  static fromUnits(units: bigint): Dec {
    return new Dec(units);
  }

  static int(n: number | bigint): Dec {
    return new Dec(BigInt(n) * ONE);
  }

  /** Texto decimal («-12.50», «1.5E-3», «1234») → Dec; null si no es un número legible. La coma no se admite aquí. */
  static parse(raw: string): Dec | null {
    const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw.trim());
    if (!m) return null;
    const [, sign, ip = "", fp = "", ex] = m;
    if (ip === "" && fp === "") return null;
    const exp = ex ? Number(ex) : 0;
    if (!Number.isFinite(exp) || Math.abs(exp) > 60) return null;
    let digits = ip + fp;
    let pointPos = ip.length + exp; // posición de la coma decimal dentro de `digits`
    if (pointPos < 0) {
      digits = "0".repeat(-pointPos) + digits;
      pointPos = 0;
    } else if (pointPos > digits.length) {
      digits = digits + "0".repeat(pointPos - digits.length);
    }
    const intPart = digits.slice(0, pointPos) || "0";
    let frac = digits.slice(pointPos);
    let carry = 0n;
    if (frac.length > DEC_SCALE) {
      carry = frac.charCodeAt(DEC_SCALE) >= 53 ? 1n : 0n;
      frac = frac.slice(0, DEC_SCALE);
    }
    frac = frac.padEnd(DEC_SCALE, "0");
    const units = BigInt(intPart) * ONE + BigInt(frac) + carry;
    return new Dec(sign === "-" ? -units : units);
  }

  add(o: Dec): Dec {
    return new Dec(this.units + o.units);
  }
  sub(o: Dec): Dec {
    return new Dec(this.units - o.units);
  }
  neg(): Dec {
    return new Dec(-this.units);
  }
  abs(): Dec {
    return new Dec(this.units < 0n ? -this.units : this.units);
  }
  mul(o: Dec): Dec {
    return new Dec(roundDiv(this.units * o.units, ONE));
  }
  /** Multiplica por un entero exacto. */
  mulInt(n: number | bigint): Dec {
    return new Dec(this.units * BigInt(n));
  }
  /** Divide por un entero exacto (un solo redondeo). */
  divInt(n: number | bigint): Dec {
    return new Dec(roundDiv(this.units, BigInt(n)));
  }
  /** Divide por otro Dec (un solo redondeo); el divisor no puede ser cero. */
  div(o: Dec): Dec {
    if (o.units === 0n) throw new Error("División por cero.");
    return new Dec(roundDiv(this.units * ONE, o.units));
  }
  /** (this × num) / den con un único redondeo (num y den enteros). */
  ratio(num: number | bigint, den: number | bigint): Dec {
    return new Dec(roundDiv(this.units * BigInt(num), BigInt(den)));
  }
  cmp(o: Dec): -1 | 0 | 1 {
    return this.units < o.units ? -1 : this.units > o.units ? 1 : 0;
  }
  isZero(): boolean {
    return this.units === 0n;
  }
  sign(): -1 | 0 | 1 {
    return this.units < 0n ? -1 : this.units > 0n ? 1 : 0;
  }

  /** Serialización explícita y canónica: sin ceros de más ni notación científica («1000», «0.5», «-12.25»). */
  toString(): string {
    const neg = this.units < 0n;
    const abs = neg ? -this.units : this.units;
    const i = abs / ONE;
    const f = (abs % ONE).toString().padStart(DEC_SCALE, "0").replace(/0+$/, "");
    return `${neg ? "-" : ""}${i}${f ? `.${f}` : ""}`;
  }

  /** Redondeo solo para presentar (mitad hacia fuera). */
  toFixed(digits: number): string {
    if (digits < 0 || digits > DEC_SCALE) throw new Error("Decimales no válidos.");
    const unit = 10n ** BigInt(DEC_SCALE - digits);
    const neg = this.units < 0n;
    const abs = neg ? -this.units : this.units;
    const q = roundDiv(abs, unit);
    const s = q.toString().padStart(digits + 1, "0");
    const out = digits === 0 ? s : `${s.slice(0, -digits)}.${s.slice(-digits)}`;
    return neg && q !== 0n ? `-${out}` : out;
  }
}

function roundDiv(n: bigint, d: bigint): bigint {
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const neg = n < 0n;
  const a = neg ? -n : n;
  let q = a / d;
  if ((a % d) * 2n >= d) q += 1n;
  return neg ? -q : q;
}

/** Suma exacta. */
export function sumDec(values: readonly Dec[]): Dec {
  return values.reduce((s, v) => s.add(v), Dec.ZERO);
}

/** Forma canónica de un importe de origen (para huellas y comparaciones); null si no es un número legible. */
export function canonicalAmount(raw: string): string | null {
  return Dec.parse(raw)?.toString() ?? null;
}

// ---------------------------------------------------------------- Categorías y perfiles

export const FINANCE_CATEGORIES = ["SOPORTE", "ADMIN_DELEGADA", "OTROS"] as const;
export type FinanceCategory = (typeof FINANCE_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<FinanceCategory, string> = {
  SOPORTE: "Soporte",
  ADMIN_DELEGADA: "Administración delegada",
  OTROS: "Otros",
};
export const FINANCE_PROFILE_ID: Record<FinanceCategory, string> = {
  SOPORTE: "facturacion-soporte",
  ADMIN_DELEGADA: "facturacion-admin-delegada",
  OTROS: "facturacion-otros",
};
export const CATEGORY_OF_PROFILE: Record<string, FinanceCategory> = Object.fromEntries(
  FINANCE_CATEGORIES.map((c) => [FINANCE_PROFILE_ID[c], c]),
);

/** Versión de las reglas de importación financiera (se guarda en el lote). */
export const FINANCE_RULES = "fin-v1";
/** Identificador versionado del método de imputación y de las fórmulas del motor. */
export const ECONOMIC_METHOD = "anual/12 × días incluidos / días reales del mes";
export const ECONOMIC_ENGINE_VERSION = "eco-v1";

export const HEADERS = { group: "Grupo cliente", income: "Vta Potencial", diff: "Diferencia" } as const;

/** Selecciones DESC_L4 de referencia por categoría (docs/importaciones/facturacion.md, FAC 01). */
export const FILTER_VOCAB: Record<FinanceCategory, readonly string[]> = {
  SOPORTE: ["plan gold", "plan platinum", "plan silver on demand", "plan silver recurrente", "fee silver recurrente"],
  ADMIN_DELEGADA: ["administración delegada"],
  OTROS: ["gestión activos", "otros"],
};

/** Años admitidos en las cargas comerciales: no se aplica a finanzas la limitación de edición de usuarios al año actual. */
export function isValidFinanceYear(year: number, now: Date = new Date()): boolean {
  return Number.isInteger(year) && year >= 2000 && year <= now.getUTCFullYear() + 1;
}

const fold = (s: string) =>
  cleanText(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export type FooterCheck = {
  /** Filtros originales del pie (texto tal cual, una línea por elemento). */
  lines: string[];
  /** Presente cuando hay una línea «Filtros aplicados». */
  hasMarker: boolean;
  /** Categorías cuyo vocabulario DESC_L4 aparece en el pie. */
  categoriesSeen: FinanceCategory[];
  /** Selecciones reconocidas del vocabulario de la categoría esperada. */
  matched: string[];
  /** «ok»: coincide con la categoría; «mismatch»: contiene otra categoría; «unverifiable»: sin pie o sin selección reconocible. */
  status: "ok" | "mismatch" | "unverifiable";
  /** Año numérico explícito del pie, si lo hay (distinto de «Año Actual es Año Actual»). */
  explicitYear: number | null;
  currentYearFilter: boolean;
  message: string;
};

/**
 * Comprueba el pie «Filtros aplicados» contra la categoría y el año seleccionados. «Año Actual es Año Actual» no informa
 * un año numérico. Un pie ausente o sin selección DESC_L4 reconocible es «no verificable» (exige declaración expresa).
 */
export function checkFooter(lines: readonly string[], category: FinanceCategory): FooterCheck {
  const clean = lines.map((l) => cleanText(l)).filter((l) => l !== "");
  const hasMarker = clean.some((l) => /^filtros aplicados/.test(fold(l)));
  const currentYearFilter = clean.some((l) => /a(n|ñ)o actual es a(n|ñ)o actual/.test(fold(l)));
  let explicitYear: number | null = null;
  for (const l of clean) {
    const f = fold(l);
    if (!/\bano\b/.test(f) || /ano actual es ano actual/.test(f)) continue;
    const y = /\bano\b[^0-9]{0,20}((?:19|20)\d{2})\b/.exec(f);
    if (y) {
      explicitYear = Number(y[1]);
      break;
    }
  }
  // Selección DESC_L4: las líneas que la mencionan o, si no hay ninguna, todo el pie salvo la línea de año.
  const withL4 = clean.filter((l) => /desc_?l4/.test(fold(l)));
  const scan = (withL4.length > 0 ? withL4 : clean.filter((l) => !/\bano\b/.test(fold(l)) && !/^filtros aplicados/.test(fold(l)))).map(fold);
  const seen = new Set<FinanceCategory>();
  const matched: string[] = [];
  for (const cat of FINANCE_CATEGORIES) {
    for (const term of FILTER_VOCAB[cat]) {
      const re = new RegExp(`(^|[^a-z0-9])${fold(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`);
      if (scan.some((l) => re.test(l))) {
        // «otros» solo cuenta como OTROS si el pie lo declara dentro de la selección (no como palabra suelta de otra línea).
        seen.add(cat);
        if (cat === category) matched.push(term);
      }
    }
  }
  const categoriesSeen = [...seen];
  if (!hasMarker && clean.length === 0) {
    return { lines: clean, hasMarker, categoriesSeen, matched, status: "unverifiable", explicitYear, currentYearFilter, message: "El archivo no tiene pie «Filtros aplicados»: no se pudo verificar la categoría ni los filtros." };
  }
  if (categoriesSeen.some((c) => c !== category)) {
    return { lines: clean, hasMarker, categoriesSeen, matched, status: "mismatch", explicitYear, currentYearFilter, message: `Los filtros del pie pertenecen a otra categoría (${categoriesSeen.filter((c) => c !== category).map((c) => CATEGORY_LABEL[c]).join(", ")}).` };
  }
  if (matched.length === 0) {
    return { lines: clean, hasMarker, categoriesSeen, matched, status: "unverifiable", explicitYear, currentYearFilter, message: "El pie no contiene una selección DESC_L4 reconocible para esta categoría: no se pudo verificar." };
  }
  return { lines: clean, hasMarker, categoriesSeen, matched, status: "ok", explicitYear, currentYearFilter, message: "Los filtros del pie coinciden con la categoría." };
}

// ---------------------------------------------------------------- Importes de las celdas

export type AmountParse =
  | { ok: true; kind: "value"; text: string; original: string }
  | { ok: true; kind: "empty" }
  | { ok: false; code: "FORMULA_SIN_VALOR" | "IMPORTE_ILEGIBLE"; reason: string };

/**
 * Importe de una celda: texto exacto de origen → decimal canónico. Una celda con fórmula y sin valor almacenado no se evalúa
 * ni se trata como cero. Admite notación científica y negativos; la coma decimal solo si no hay punto (texto «1234,56»).
 */
export function parseAmountCell(cell: { v: string; k: string; f?: boolean } | undefined): AmountParse {
  if (!cell || (cell.k === "empty" && !cell.f) || (cell.v.trim() === "" && !cell.f)) return { ok: true, kind: "empty" };
  if (cell.f && cell.v.trim() === "") return { ok: false, code: "FORMULA_SIN_VALOR", reason: "es una fórmula sin valor numérico almacenado; no se evalúa ni se trata como cero" };
  if (cell.k === "error") return { ok: false, code: "IMPORTE_ILEGIBLE", reason: `contiene un error de celda (${cell.v})` };
  if (cell.k === "bool" || cell.k === "date") return { ok: false, code: "IMPORTE_ILEGIBLE", reason: "no es un importe numérico" };
  let t = cell.v.replace(/[   ]/g, "").replace(/€/g, "");
  if (cell.k === "text" && /^[+-]?\d+(,\d+)?$/.test(t)) t = t.replace(",", ".");
  const d = Dec.parse(t);
  if (d === null) return { ok: false, code: "IMPORTE_ILEGIBLE", reason: `«${cell.v.trim()}» no es un número` };
  return { ok: true, kind: "value", text: d.toString(), original: cell.v.trim() };
}

// ---------------------------------------------------------------- Normalización del grupo de origen

/** Clave de búsqueda de una denominación de grupo (misma normalización que las equivalencias BC: espacios y mayúsculas). */
export function groupSearchKey(raw: string): string {
  return cleanText(raw).toLowerCase();
}

// ---------------------------------------------------------------- Periodos y prorrateo

export type CutMode = "CUTOFF" | "FULL_MONTH";

export type Ymd = { y: number; m: number; d: number };
export function parseYmd(iso: string): Ymd {
  if (!isIsoDate(iso)) throw new Error(`Fecha no válida: ${iso}`);
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}
export const ymdToIso = ({ y, m, d }: Ymd): string => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function lastDayOfMonth(y: number, m: number): number {
  return daysInMonth(y, m);
}

/** Corte efectivo: en «mes completo» el fin de ese mes; en «a fecha de corte» la fecha tal cual. */
export function effectiveCut(analysisDate: string, mode: CutMode): string {
  const { y, m, d } = parseYmd(analysisDate);
  return ymdToIso({ y, m, d: mode === "FULL_MONTH" ? lastDayOfMonth(y, m) : d });
}

/** Mismo corte un año antes, limitando el día al último de ese mes (29/02/2024 → 28/02/2023). */
export function shiftYearBack(iso: string): string {
  const { y, m, d } = parseYmd(iso);
  return ymdToIso({ y: y - 1, m, d: Math.min(d, lastDayOfMonth(y - 1, m)) });
}

export function previousMonth(y: number, m: number): { y: number; m: number } {
  return m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
}

export type Period = {
  label: string;
  /** Inclusivos (fechas de negocio). */
  from: string;
  to: string;
  /** Mes en curso rotulado provisional: el corte cae antes del fin de mes y el reloj aún no lo ha cerrado. */
  provisional: boolean;
  /** Meses (año, mes) y días incluidos de cada uno, en orden. */
  months: { y: number; m: number; days: number; daysInMonth: number }[];
};

export function monthsBetween(from: string, to: string): Period["months"] {
  const a = parseYmd(from);
  const b = parseYmd(to);
  const out: Period["months"] = [];
  let y = a.y;
  let m = a.m;
  for (;;) {
    const dim = lastDayOfMonth(y, m);
    const first = y === a.y && m === a.m ? a.d : 1;
    const last = y === b.y && m === b.m ? b.d : dim;
    out.push({ y, m, days: last - first + 1, daysInMonth: dim });
    if (y === b.y && m === b.m) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Los seis periodos de CAL 17: mes seleccionado, mes anterior completo, CUM actual, año anterior completo, CUM anterior comparable.
 * El mes seleccionado y el CUM llegan al corte efectivo; el comparable desplaza ese corte un año; el año anterior es completo.
 */
export function buildPeriods(analysisDate: string, mode: CutMode, today: string): Record<"month" | "prevMonth" | "cum" | "prevYear" | "prevCum", Period> {
  const cut = effectiveCut(analysisDate, mode);
  const c = parseYmd(cut);
  const mk = (label: string, from: string, to: string, provisional = false): Period => ({ label, from, to, provisional, months: monthsBetween(from, to) });
  const monthEnd = lastDayOfMonth(c.y, c.m);
  const provisional = c.d < monthEnd || today <= cut; // un mes parcial, o un corte que todavía no ha pasado, es provisional
  const pm = previousMonth(c.y, c.m);
  const prevCut = shiftYearBack(cut);
  return {
    month: mk("Mes seleccionado", ymdToIso({ y: c.y, m: c.m, d: 1 }), cut, provisional),
    prevMonth: mk("Mes anterior completo", ymdToIso({ y: pm.y, m: pm.m, d: 1 }), ymdToIso({ y: pm.y, m: pm.m, d: lastDayOfMonth(pm.y, pm.m) })),
    cum: mk("CUM actual", `${c.y}-01-01`, cut, provisional),
    prevYear: mk("Año anterior completo", `${c.y - 1}-01-01`, `${c.y - 1}-12-31`),
    prevCum: mk("CUM anterior comparable", `${c.y - 1}-01-01`, prevCut),
  };
}

/**
 * Ingreso imputado de un mes: anual/12 × días incluidos / días reales del mes, con un único redondeo.
 * `annual` es el ingreso anual del año de ese mes.
 */
export function proratedMonthIncome(annual: Dec, days: number, dim: number): Dec {
  return annual.ratio(days, 12 * dim);
}

// ---------------------------------------------------------------- Fórmulas (CAL 18-21)

export type ResultStatus = "AVAILABLE" | "PARTIAL" | "NO_SOURCE" | "NOT_COMPUTABLE";

export type Formula = {
  value: string | null;
  numerator: string | null;
  denominator: string | null;
  unit: string;
  status: ResultStatus;
  reason: string | null;
};

/** Euros por jornada dedicada: R / H × jornada, con H = minutos / 60. Con H = 0 no hay ratio (nunca infinito). */
export function eurosPerDay(revenue: Dec, minutes: Dec, dayHours: Dec): { ratio: Dec | null; hours: Dec } {
  const hours = minutes.divInt(60);
  if (minutes.isZero()) return { ratio: null, hours };
  // R / (min/60) × jornada = R × 60 × jornada / min, con un único redondeo.
  return { ratio: revenue.mulInt(60).mul(dayHours).div(minutes), hours };
}

/** Horas objetivo = R / objetivo × jornada. */
export function targetHours(revenue: Dec, target: Dec, dayHours: Dec): Dec {
  return revenue.mul(dayHours).div(target);
}

/** Desviación contra objetivo = (objetivo − €/jornada) / objetivo. Positivo = rendimiento por debajo del objetivo. */
export function deviationVsTarget(target: Dec, perDay: Dec): Dec {
  return target.sub(perDay).div(target);
}

/** Desviación contra cartera = (ratio_cartera − ratio_grupo) / ratio_cartera. Con cartera de ratio cero no es calculable. */
export function deviationVsPortfolio(portfolio: Dec, group: Dec): Dec | null {
  return portfolio.isZero() ? null : portfolio.sub(group).div(portfolio);
}
