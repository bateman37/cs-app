/**
 * Contrato de consulta de Calidad (CSAPP-08 §3): validado en servidor y conservado en la URL. Reutiliza el contrato temporal y de filtros de FILAS de 06
 * (Grupo/Cliente, producto/soporte/alojamiento/complejidad vigentes, estado, orden, paginación). El resultado global principal es MENSUAL: mes elegido hasta
 * el corte efectivo (hoy en Europe/Madrid por defecto). Lo no válido vuelve al valor inicial y se lista en `invalid`; nada se interpola en SQL.
 */
import { DEFAULT_QUERY, parseAnalysisQuery, type AnalysisQuery, type RawParams } from "./analytics-query";
import { INDICATOR_KEYS } from "./quality-config";
import { DIAGNOSIS_FAMILIES } from "./quality-config";
import { lastDayOfMonth, parseYmd, ymdToIso } from "./finance";

export const QUALITY_VIEWS = ["cartera", "health", "diagnostico", "backlog"] as const;
export type QualityView = (typeof QUALITY_VIEWS)[number];
export const VIEW_LABEL: Record<QualityView, string> = { cartera: "Cartera", health: "Client Health", diagnostico: "Diagnóstico por origen", backlog: "Backlog por antigüedad" };
export const COLOR_FILTERS = ["", "green", "yellow", "red", "sin_global", "sin_calibrar", "datos_pendientes"] as const;
export type ColorFilter = (typeof COLOR_FILTERS)[number];
export const COLOR_FILTER_LABEL: Record<ColorFilter, string> = {
  "": "Todos", green: "Global verde", yellow: "Global amarillo", red: "Global rojo", sin_global: "Sin global calculable", sin_calibrar: "Pendientes de calibración", datos_pendientes: "Pendientes de datos",
};
export const QUALITY_SORTS = ["name", "global", ...INDICATOR_KEYS] as readonly string[];
export const QSCOPES = ["group", "client"] as const;
export const QSCOPE_NAME = { group: "Grupo Cliente", client: "Cliente" } as const;

export type QualityQuery = {
  base: AnalysisQuery;
  scope: (typeof QSCOPES)[number];
  view: QualityView;
  sel: string;
  color: ColorFilter;
  sort: string;
  /** Año de la matriz de Client Health. */
  year: number;
  qrev: number | null;
  prev: number | null;
  /** «borrador»: simulación sobre datos de la base con el borrador de Administración (solo ADMIN, no publicado). */
  sim: "" | "borrador";
  /** Detalle abierto: indicador o diagnóstico. */
  det: string;
  fam: string;
};

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();
const pick = <T extends string>(allowed: readonly T[], v: string, d: T): { v: T; bad: boolean } => (v === "" ? { v: d, bad: false } : allowed.includes(v as T) ? { v: v as T, bad: false } : { v: d, bad: true });
const ID = /^[A-Za-z0-9_-]{1,40}$/;

export const DEFAULT_QUALITY_QUERY = (now: Date = new Date()): QualityQuery => {
  const base = DEFAULT_QUERY(now);
  return { base, scope: "group", view: "cartera", sel: "", color: "", sort: "name", year: Number(base.date.slice(0, 4)), qrev: null, prev: null, sim: "", det: "", fam: "" };
};

export function parseQualityQuery(raw: RawParams, now: Date = new Date()): { query: QualityQuery; invalid: string[] } {
  const { query: base0, invalid } = parseAnalysisQuery({ ...raw, orden: undefined, pestana: undefined }, now);
  const d = DEFAULT_QUALITY_QUERY(now);
  const base: AnalysisQuery = { ...base0, service: raw.servicio === undefined ? "SOPORTE" : base0.service, sort: "name" };
  const flag = (n: string, bad: boolean) => bad && invalid.push(n);
  const scope = pick(QSCOPES, one(raw.ambito), d.scope);
  const view = pick(QUALITY_VIEWS, one(raw.vista), d.view);
  const color = pick(COLOR_FILTERS, one(raw.color), d.color);
  const sort = pick(QUALITY_SORTS, one(raw.orden), d.sort);
  flag("ambito", scope.bad); flag("vista", view.bad); flag("color", color.bad); flag("orden", sort.bad);
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
  const det = one(raw.det);
  const fam = one(raw.fam);
  flag("det", det !== "" && !(INDICATOR_KEYS as readonly string[]).includes(det) && det !== "GLOBAL");
  flag("fam", fam !== "" && !(DIAGNOSIS_FAMILIES as readonly string[]).includes(fam));
  return {
    query: {
      base, scope: scope.v, view: view.v, sel: ID.test(sel) ? sel : "", color: color.v, sort: sort.v, year, qrev: rev("rcalidad"), prev: rev("rpulse"),
      sim: one(raw.sim) === "borrador" ? "borrador" : "",
      det: (INDICATOR_KEYS as readonly string[]).includes(det) || det === "GLOBAL" ? det : "", fam: (DIAGNOSIS_FAMILIES as readonly string[]).includes(fam) ? fam : "",
    },
    invalid,
  };
}

/** Parámetros de URL de una consulta (omite los valores iniciales) para enlaces y vuelta desde la ficha. */
export function qualityToParams(q: QualityQuery, now: Date = new Date()): Record<string, string> {
  const d = DEFAULT_QUALITY_QUERY(now);
  const out: Record<string, string> = {};
  const set = (k: string, v: string | number | null, dflt: string | number | null = "") => { if (v !== null && v !== "" && v !== dflt) out[k] = String(v); };
  const b = q.base;
  set("fecha", b.date, d.base.date); set("modo", b.mode, d.base.mode); set("servicio", b.service, d.base.service); set("q", b.q);
  set("soporte", b.support.join(",")); set("alojamiento", b.hosting.join(",")); set("complejidad", b.complexity.join(",")); set("producto", b.product);
  set("estado", b.status, d.base.status); set("dir", b.dir, d.base.dir); set("pagina", b.page, 1); set("tam", b.pageSize, d.base.pageSize);
  set("ambito", q.scope, d.scope); set("vista", q.view, d.view); set("sel", q.sel); set("color", q.color); set("orden", q.sort, d.sort);
  set("anio", q.year, d.year); set("rcalidad", q.qrev); set("rpulse", q.prev); set("sim", q.sim); set("det", q.det); set("fam", q.fam);
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
