/**
 * Reglas puras de la matriz de usuarios contratados (los que pagan): año editable, vista previa
 * de cambios, copia del año anterior y exposición en usuarios mes. Sin dependencias de servidor.
 *
 * Un mes sin dato es «sin informar» (null); un 0 es un cero confirmado. Nunca se mezclan.
 */
import { isIsoDate } from "./vigencia";

/** Año de la base de usuarios del libro histórico (HOTFIX-01 §7). Solo la usa la precarga: no es un bloqueo ni un ancla de la edición. */
export const USERS_BASE_YEAR = 2025;
/** Años posteriores que la precarga inicializa desde la base (no se siembran años futuros). */
export const USERS_SEED_YEARS = [2026] as const;
export const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const MONTH_NAMES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"] as const;
export const MONTH_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"] as const;

export type ValueKind = "INITIAL" | "COPIED" | "PROPAGATED" | "ADJUSTED" | "ESTIMATED";
export const KIND_LABEL: Record<ValueKind, string> = {
  INITIAL: "Carga inicial (base 2025)",
  COPIED: "Base copiada",
  PROPAGATED: "Propagado",
  ADJUSTED: "Ajuste explícito",
  ESTIMATED: "Estimado a partir de 2025",
};
/** Procedencia legible de un valor estimado (se muestra en vistas y CSV: no es un dato observado ese año). */
export const ESTIMATED_SOURCE = "Estimado a partir de 2025";

export type MonthState = { value: number; kind: ValueKind; isLocked: boolean; source?: string };
/** Índice 0 = enero. null = sin informar. */
export type YearState = (MonthState | null)[];

export type ScopeRef = { type: "group" | "client" | "implementation"; id: string };

/** Año natural en curso en Europe/Madrid (el reloj es inyectable solo desde el servidor y las pruebas). */
export function currentYear(now: Date = new Date()): number {
  const y = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric" }).format(now);
  return Number(y);
}

/**
 * Años de edición ordinaria: el año en curso y el anterior (Europe/Madrid, reloj del servidor; nunca el año que envía el cliente).
 * Sustituye a «solo el año en curso» y al bloqueo permanente de 2025 (HOTFIX-01 §7).
 */
export function editableYears(now: Date = new Date()): [number, number] {
  const cy = currentYear(now);
  return [cy - 1, cy];
}

export function editability(year: number, now: Date = new Date()): { editable: boolean; reason: string | null } {
  const cy = currentYear(now);
  if (year === cy || year === cy - 1) return { editable: true, reason: null };
  if (year < cy) {
    return { editable: false, reason: `${year} queda fuera de la ventana de edición (solo se editan ${cy - 1} y ${cy}): se consulta, no se modifica.` };
  }
  return { editable: false, reason: `${year} es un año futuro: solo se editan ${cy - 1} y ${cy}.` };
}

/** Valor entero ≥ 0 o null si no es válido (no admite vacío, decimales, negativos ni texto). */
export function parseUserCount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isInteger(raw) && raw >= 0 && raw <= 10_000_000 ? raw : null;
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!/^\d{1,8}$/.test(t)) return null;
  return Number(t);
}

export function emptyYear(): YearState {
  return Array.from({ length: 12 }, () => null);
}

export type PlanRow = {
  month: number;
  before: MonthState | null;
  after: MonthState | null;
  /** changed: cambia; protected: ajuste explícito/bloqueado/ya informado preservado; unchanged: sin cambio. */
  status: "changed" | "protected" | "unchanged";
};

export type Plan = { rows: PlanRow[]; changedCount: number; protectedMonths: number[] };

function finish(rows: PlanRow[]): Plan {
  return {
    rows,
    changedCount: rows.filter((r) => r.status === "changed").length,
    protectedMonths: rows.filter((r) => r.status === "protected").map((r) => r.month),
  };
}

const same = (a: MonthState | null, b: MonthState | null) =>
  a === b || (a !== null && b !== null && a.value === b.value && a.kind === b.kind);

/** «Editar un mes»: cambia exclusivamente ese mes y lo marca como ajuste explícito. */
export function planSetMonth(state: YearState, month: number, value: number): Plan {
  const rows = MONTHS.map((m): PlanRow => {
    const before = state[m - 1];
    if (m !== month) return { month: m, before, after: before, status: "unchanged" };
    const after: MonthState = { value, kind: "ADJUSTED", isLocked: false };
    return { month: m, before, after, status: same(before, after) ? "unchanged" : "changed" };
  });
  return finish(rows);
}

/**
 * «Aplicar desde este mes»: el mes elegido (decisión explícita → ajuste) y los posteriores del año
 * (propagado), preservando los que ya sean ajuste explícito o estén bloqueados.
 */
export function planApplyFrom(state: YearState, month: number, value: number): Plan {
  const rows = MONTHS.map((m): PlanRow => {
    const before = state[m - 1];
    if (m < month) return { month: m, before, after: before, status: "unchanged" };
    if (m > month && before && (before.kind === "ADJUSTED" || before.isLocked)) {
      return { month: m, before, after: before, status: "protected" };
    }
    const after: MonthState = { value, kind: m === month ? "ADJUSTED" : "PROPAGATED", isLocked: false };
    return { month: m, before, after, status: same(before, after) ? "unchanged" : "changed" };
  });
  return finish(rows);
}

/** Copia mes a mes del año anterior solo donde el destino está sin informar y el origen informado. */
export function planCopyFromPrevious(target: YearState, previous: YearState, previousYear: number): Plan {
  const rows = MONTHS.map((m): PlanRow => {
    const before = target[m - 1];
    const src = previous[m - 1];
    if (before) return { month: m, before, after: before, status: "protected" };
    if (!src) return { month: m, before: null, after: null, status: "unchanged" };
    const mm = String(m).padStart(2, "0");
    return {
      month: m,
      before: null,
      after: { value: src.value, kind: "COPIED", isLocked: false, source: `Copia de ${previousYear}-${mm}` },
      status: "changed",
    };
  });
  return finish(rows);
}

/** «Copiar diciembre anterior»: el valor de diciembre del año anterior se copia a los meses sin informar; nunca pisa un valor existente. */
export function planCopyDecember(target: YearState, previous: YearState, previousYear: number): Plan {
  const dec = previous[11];
  const rows = MONTHS.map((m): PlanRow => {
    const before = target[m - 1];
    if (before) return { month: m, before, after: before, status: "protected" };
    if (!dec) return { month: m, before: null, after: null, status: "unchanged" };
    return { month: m, before: null, after: { value: dec.value, kind: "COPIED", isLocked: false, source: `Copia de diciembre ${previousYear}` }, status: "changed" };
  });
  return finish(rows);
}

export type HistoricStatus = "new" | "unchanged" | "conflict";

/** Valor inicial uniforme: doce valores iguales sobre un año vacío; idempotente con el mismo valor. Ya no bloquea las filas (la ventana de años decide). */
export function planInitializeHistoric(state: YearState, value: number, year: number = USERS_BASE_YEAR): { status: HistoricStatus; plan: Plan; message?: string } {
  const informed = state.filter((s) => s !== null) as MonthState[];
  const mk = (): Plan =>
    finish(
      MONTHS.map((m) => {
        const before = state[m - 1];
        const after: MonthState = { value, kind: "INITIAL", isLocked: false };
        return { month: m, before, after, status: same(before, after) ? "unchanged" : "changed" } as PlanRow;
      }),
    );
  if (informed.length === 0) return { status: "new", plan: mk() };
  const identical = informed.length === 12 && informed.every((s) => s.kind === "INITIAL" && s.value === value);
  if (identical) return { status: "unchanged", plan: mk() };
  const current = [...new Set(informed.map((s) => s.value))].join(", ");
  return {
    status: "conflict",
    plan: finish(MONTHS.map((m) => ({ month: m, before: state[m - 1], after: state[m - 1], status: "protected" as const }))),
    message:
      `${year} ya tiene datos (${informed.length} de 12 meses informados, valores ${current}) ` +
      `y no coinciden con la inicialización pedida (${value}). No se sobrescribe: edite los meses o use «Aplicar desde este mes».`,
  };
}

// ----------------------------------------------------------------------- Exposición

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export type ExposureMonth = {
  year: number;
  month: number;
  /** Fracción del mes incluida en el periodo (días incluidos / días reales). */
  weight: number;
  value: number | null;
};

export type Exposure = {
  /** Usuarios mes del periodo; null si falta algún mes requerido (cobertura incompleta). */
  userMonths: number | null;
  /** Suma de los meses con dato (informativa; no sustituye a userMonths). */
  knownUserMonths: number;
  complete: boolean;
  requiredMonths: ExposureMonth[];
  missingMonths: { year: number; month: number }[];
};

/**
 * Exposición en usuarios mes de un periodo [from, to] (fechas inclusivas, pueden cruzar años).
 * Cada mes pesa días incluidos / días reales; un mes completo pesa 1. Sin redondeos.
 */
export function computeExposure(lookup: (year: number, month: number) => number | null, from: string, to: string): Exposure {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new Error("Periodo no válido.");
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const requiredMonths: ExposureMonth[] = [];
  let y = fy;
  let m = fm;
  for (;;) {
    const dim = daysInMonth(y, m);
    const first = y === fy && m === fm ? fd : 1;
    const last = y === ty && m === tm ? td : dim;
    requiredMonths.push({ year: y, month: m, weight: (last - first + 1) / dim, value: lookup(y, m) });
    if (y === ty && m === tm) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  const missingMonths = requiredMonths.filter((r) => r.value === null).map((r) => ({ year: r.year, month: r.month }));
  const known = requiredMonths.reduce((s, r) => s + (r.value === null ? 0 : r.value * r.weight), 0);
  const complete = missingMonths.length === 0;
  return { userMonths: complete ? known : null, knownUserMonths: known, complete, requiredMonths, missingMonths };
}

export type CellStatus = "sin informar" | "cero confirmado" | "informado";
export function statusOf(value: number | null): CellStatus {
  return value === null ? "sin informar" : value === 0 ? "cero confirmado" : "informado";
}
