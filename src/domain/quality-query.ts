/**
 * Contrato de consulta de Calidad (CSAPP-08 §3, rediseñado en HOTFIX-02 §6 y §9). Se valida en servidor y se conserva en la URL.
 *
 * Filtros de negocio: SOLO Soporte y Servidor (`soporte`, `servidor`; multiselección, OR dentro de cada uno y AND entre ambos, en el MISMO Cliente).
 * Selección de nivel: Grupo/Cliente (`ambito`). Periodo: `fecha` + `modo` (la barra pequeña puede enviar `mes`, que se convierte en `fecha`).
 * Navegación: `kpi` = apartado del indicador y `sel` = objeto (Grupo/Cliente) cuyo detalle se abre; sin `kpi` ni `sel` es el Resumen de clientes.
 *
 * Todo parámetro retirado (búsqueda BC, servicio económico, complejidad, producto, estado, cobertura, tamaño de página, color, revisiones de pestaña…) se IGNORA:
 * no recorta datos en secreto y la página redirige a la dirección canónica sin ellos (`obsolete`). Lo no válido vuelve al valor inicial (`invalid`).
 */
import { DEFAULT_QUERY, parseAnalysisQuery, type AnalysisQuery, type RawParams } from "./analytics-query";
import { INDICATOR_KEYS, DIAGNOSIS_FAMILIES, type IndicatorKey } from "./quality-config";
import { EMPTY_FILTERS, commonFiltersToParams, parseCommonFilters, type CommonFilters } from "./filtros-comunes";
import { lastDayOfMonth, parseYmd, ymdToIso } from "./finance";

export const QSCOPES = ["group", "client"] as const;
export const QSCOPE_NAME = { group: "Grupo Cliente", client: "Cliente" } as const;
/** Ordenar el resumen: por nombre o resultado global (las cabeceras de los seis indicadores NAVEGAN, no ordenan). El resto de claves existe para enlaces antiguos. */
export const QUALITY_SORTS = ["name", "global", ...INDICATOR_KEYS] as readonly string[];
/** Tamaño fijo de página (sin selector expuesto). */
export const QUALITY_PAGE_SIZE = 100;

/** Parámetros retirados de la vista normal: se ignoran y se limpian de la URL. */
export const OBSOLETE_PARAMS = ["q", "servicio", "alojamiento", "complejidad", "producto", "estado", "cobertura", "tam", "color", "vista", "det", "revision", "pestana", "bloques", "ref"] as const;

export type QualityQuery = {
  base: AnalysisQuery;
  /** Segmentadores comunes Soporte/Servidor. */
  filters: CommonFilters;
  scope: (typeof QSCOPES)[number];
  /** Apartado de indicador abierto («» = Resumen de clientes). */
  kpi: IndicatorKey | "";
  /** Objeto cuyo detalle se abre: Grupo o Cliente según `scope`. */
  sel: string;
  sort: string;
  /** Año de la matriz de Client Health. */
  year: number;
  qrev: number | null;
  prev: number | null;
  /** «borrador»: simulación sobre datos de la base con el borrador de Administración (solo ADMIN, no publicado). */
  sim: "" | "borrador";
  /** Familia de diagnóstico abierta dentro de un apartado. */
  fam: string;
};

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();
const pick = <T extends string>(allowed: readonly T[], v: string, d: T): { v: T; bad: boolean } => (v === "" ? { v: d, bad: false } : allowed.includes(v as T) ? { v: v as T, bad: false } : { v: d, bad: true });
const ID = /^[A-Za-z0-9_-]{1,40}$/;

export const DEFAULT_QUALITY_QUERY = (now: Date = new Date()): QualityQuery => {
  const base = { ...DEFAULT_QUERY(now), pageSize: QUALITY_PAGE_SIZE };
  return { base, filters: EMPTY_FILTERS, scope: "group", kpi: "", sel: "", sort: "name", year: Number(base.date.slice(0, 4)), qrev: null, prev: null, sim: "", fam: "" };
};

/** `mes` (AAAA-MM) + modo → fecha de análisis. Mes completo: cualquier día del mes; a fecha de hoy: el día de hoy (o su equivalente acotado al mes elegido). */
export function monthToDate(month: string, mode: "CUTOFF" | "FULL_MONTH", today: string): string | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  if (mode === "FULL_MONTH") return ymdToIso({ y, m, d: 1 });
  const t = parseYmd(today);
  if (t.y === y && t.m === m) return today;
  return ymdToIso({ y, m, d: Math.min(t.d, lastDayOfMonth(y, m)) });
}

export function parseQualityQuery(raw: RawParams, now: Date = new Date()): { query: QualityQuery; invalid: string[]; obsolete: string[] } {
  const obsolete = OBSOLETE_PARAMS.filter((k) => raw[k] !== undefined && one(raw[k]) !== "");
  // Solo se entregan al contrato temporal los parámetros del periodo, la dirección y la página: nada heredado puede filtrar.
  const modeRaw = one(raw.modo);
  const today = DEFAULT_QUERY(now).date;
  const monthDate = one(raw.fecha) === "" && one(raw.mes) !== "" ? monthToDate(one(raw.mes), modeRaw === "FULL_MONTH" ? "FULL_MONTH" : "CUTOFF", today) : null;
  const { query: base0, invalid } = parseAnalysisQuery({ fecha: monthDate ?? raw.fecha, modo: raw.modo, dir: raw.dir, pagina: raw.pagina }, now);
  const d = DEFAULT_QUALITY_QUERY(now);
  const base: AnalysisQuery = { ...base0, service: "SOPORTE", q: "", support: [], hosting: [], complexity: [], product: "", status: "todos", coverage: "todas", sort: "name", pageSize: QUALITY_PAGE_SIZE };
  const flag = (n: string, bad: boolean) => bad && invalid.push(n);
  if (one(raw.mes) !== "" && monthDate === null && one(raw.fecha) === "") invalid.push("mes");
  const scope = pick(QSCOPES, one(raw.ambito), d.scope);
  const sort = pick(QUALITY_SORTS, one(raw.orden), d.sort);
  flag("ambito", scope.bad); flag("orden", sort.bad);
  // Enlaces anteriores `vista=` (Análisis Cliente) llegan al apartado equivalente; no filtran nada.
  const legacyView = one(raw.vista);
  const legacyKpi: IndicatorKey | "" = legacyView === "health" ? "HEALTH" : legacyView === "diagnostico" || legacyView === "backlog" ? "INCIDENTS_PROBLEMS" : "";
  const kpiRaw = one(raw.kpi);
  const kpi = (INDICATOR_KEYS as readonly string[]).includes(kpiRaw) ? (kpiRaw as IndicatorKey) : legacyKpi;
  flag("kpi", kpiRaw !== "" && !(INDICATOR_KEYS as readonly string[]).includes(kpiRaw));
  const sel = one(raw.sel);
  if (sel !== "" && !ID.test(sel)) invalid.push("sel");
  const rev = (name: string): number | null => {
    const v = one(raw[name]);
    if (v === "") return null;
    if (/^\d{1,6}$/.test(v) && Number(v) >= 1) return Number(v);
    invalid.push(name);
    return null;
  };
  const yr = one(raw.anio);
  const year = yr === "" ? Number(base.date.slice(0, 4)) : /^\d{4}$/.test(yr) && Number(yr) >= 2000 && Number(yr) <= 2100 ? Number(yr) : (invalid.push("anio"), Number(base.date.slice(0, 4)));
  const fam = one(raw.fam);
  flag("fam", fam !== "" && !(DIAGNOSIS_FAMILIES as readonly string[]).includes(fam));
  const rawFilters = { soporte: raw.soporte, servidor: raw.servidor };
  const filters = parseCommonFilters(rawFilters);
  const wanted = (v: string | string[] | undefined) => (Array.isArray(v) ? v : [v ?? ""]).flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean).length;
  flag("soporte", wanted(raw.soporte) !== filters.soporte.length);
  flag("servidor", wanted(raw.servidor) !== filters.servidor.length);
  return {
    query: {
      base, filters, scope: scope.v, kpi, sel: ID.test(sel) ? sel : "", sort: sort.v, year, qrev: rev("rcalidad"), prev: rev("rpulse"),
      sim: one(raw.sim) === "borrador" ? "borrador" : "", fam: (DIAGNOSIS_FAMILIES as readonly string[]).includes(fam) ? fam : "",
    },
    invalid,
    obsolete: [...obsolete, ...(raw.mes !== undefined ? ["mes"] : [])],
  };
}

/** Parámetros de URL de una consulta (omite los valores iniciales) para enlaces y vuelta desde el detalle. Nunca emite parámetros retirados. */
export function qualityToParams(q: QualityQuery, now: Date = new Date()): Record<string, string> {
  const d = DEFAULT_QUALITY_QUERY(now);
  const out: Record<string, string> = {};
  const set = (k: string, v: string | number | null, dflt: string | number | null = "") => { if (v !== null && v !== "" && v !== dflt) out[k] = String(v); };
  const b = q.base;
  set("fecha", b.date, d.base.date); set("modo", b.mode, d.base.mode);
  Object.assign(out, commonFiltersToParams(q.filters ?? EMPTY_FILTERS));
  set("dir", b.dir, d.base.dir); set("pagina", b.page, 1);
  set("ambito", q.scope, d.scope); set("kpi", q.kpi); set("sel", q.sel); set("orden", q.sort, d.sort);
  set("anio", q.year, d.year); set("rcalidad", q.qrev); set("rpulse", q.prev); set("sim", q.sim); set("fam", q.fam);
  return out;
}

/** Contexto temporal del análisis: el mes del corte, el corte efectivo (nunca futuro) y si el periodo es provisional. */
export type QualityPeriod = { year: number; month: number; from: string; cut: string; requested: string; monthEnd: string; provisional: boolean; partial: boolean; clamped: boolean; future: boolean; days: number; daysInMonth: number };
export function qualityPeriod(date: string, mode: "CUTOFF" | "FULL_MONTH", today: string): QualityPeriod {
  const { y, m, d } = parseYmd(date);
  const monthEnd = ymdToIso({ y, m, d: lastDayOfMonth(y, m) });
  const wanted = mode === "FULL_MONTH" ? monthEnd : ymdToIso({ y, m, d });
  const clamped = wanted > today;
  const cut = clamped ? today : wanted;
  const c = parseYmd(cut);
  return { year: y, month: m, from: ymdToIso({ y, m, d: 1 }), cut, requested: wanted, monthEnd, provisional: cut >= today || c.d < lastDayOfMonth(y, m), partial: c.d < lastDayOfMonth(y, m), clamped, future: ymdToIso({ y, m, d: 1 }) > today, days: c.d, daysInMonth: lastDayOfMonth(y, m) };
}

/** Último día del mes anterior al de `today` (acceso «último mes cerrado»). */
export function lastClosedMonthEnd(today: string): string {
  const [y, m] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
}
