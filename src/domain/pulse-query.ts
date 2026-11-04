/**
 * Contrato de consulta de Pulse Rent (CSAPP-07 §5-§7). Se valida en servidor y vive en la URL. Se separan TRES conceptos:
 *  1. filas visibles (búsqueda, filtros de presentación, orden, página, columnas) — `rows`;
 *  2. referencia estadística (población de cada distribución) — `ref`/`custom`;
 *  3. referencia económica (cartera ponderada de la desviación) — `refEco`.
 * Ocultar, buscar, paginar u ordenar NO cambia la referencia; «usar filtros visibles como referencia» es una acción explícita que COPIA los criterios.
 */
import { DEFAULT_QUERY, parseAnalysisQuery, type AnalysisQuery, type RawParams } from "./analytics-query";
import { DEFAULT_METRIC_IDS, METRIC_BY_ID } from "./pulse-catalog";
import { NORMALIZATIONS, type Normalization } from "./pulse-stats";
import { COMPLEXITY_VALUES, HOSTING_VALUES, SUPPORT_VALUES } from "./catalogs";

export const SCOPES = ["group", "client", "implementation"] as const;
export type PulseScope = (typeof SCOPES)[number];
export const SCOPE_LABEL: Record<PulseScope, string> = { group: "Grupo Cliente", client: "Cliente", implementation: "Implantación" };
export const PULSE_PERIODS = ["mes", "anterior", "cum", "anioant", "cumant"] as const;
export type PulsePeriod = (typeof PULSE_PERIODS)[number];
export const PERIOD_LABEL: Record<PulsePeriod, string> = { mes: "Mes seleccionado", anterior: "Mes anterior", cum: "CUM actual", anioant: "Año anterior completo", cumant: "CUM anterior comparable" };
export const PERIOD_KEY: Record<PulsePeriod, "month" | "prevMonth" | "cum" | "prevYear" | "prevCum"> = { mes: "month", anterior: "prevMonth", cum: "cum", anioant: "prevYear", cumant: "prevCum" };
/** Modo de normalización de la pantalla: aplica a TODA la columna y a su referencia. */
export const NORM_MODES = ["anual", "periodo", "bruto"] as const;
export type NormMode = (typeof NORM_MODES)[number];
export const NORM_MODE_LABEL: Record<NormMode, string> = { anual: "Equivalente anual", periodo: "Del periodo (por mes)", bruto: "Bruto" };
export const NORM_OF: Record<NormMode, Normalization> = { anual: "per_user_year", periodo: "per_user", bruto: "raw" };
export const PULSE_PAGE_SIZES = [25, 50, 100, 200] as const;

export type CustomReference = { plans: string[]; hostings: string[]; complexities: string[]; product: string; homogeneous: boolean };

export type PulseQuery = {
  /** Contrato temporal, servicio, filtros de FILAS y paginación de 06 reutilizados. */
  base: AnalysisQuery;
  scope: PulseScope;
  period: PulsePeriod;
  norm: NormMode;
  ref: string;
  refEco: string;
  custom: CustomReference;
  pulseRevision: number | null;
  metrics: string[];
  sort: string;
  col: string;
  sel: string;
  /** Activa la equivalencia histórica de horas (modo separado, solo con corte de mes completo). */
  historic: boolean;
};

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();
const list = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : (v ?? "").split(",")).map((s) => s.trim()).filter(Boolean);
const pick = <T extends string>(allowed: readonly T[], v: string, d: T): { v: T; bad: boolean } => (v === "" ? { v: d, bad: false } : allowed.includes(v as T) ? { v: v as T, bad: false } : { v: d, bad: true });
const ID = /^[A-Za-z0-9_-]{1,40}$/;

export const DEFAULT_PULSE_QUERY = (now: Date = new Date()): PulseQuery => ({
  base: { ...DEFAULT_QUERY(now), pageSize: 50 },
  scope: "group",
  period: "cum",
  norm: "anual",
  ref: "",
  refEco: "",
  custom: { plans: [], hostings: [], complexities: [], product: "", homogeneous: false },
  pulseRevision: null,
  metrics: [...DEFAULT_METRIC_IDS],
  sort: "name",
  col: "",
  sel: "",
  historic: false,
});

/** Valida y normaliza. Nunca lanza: lo no válido vuelve al valor inicial y se lista en `invalid`. */
export function parsePulseQuery(raw: RawParams, now: Date = new Date()): { query: PulseQuery; invalid: string[] } {
  const { query: base, invalid } = parseAnalysisQuery({ ...raw, orden: undefined }, now);
  const d = DEFAULT_PULSE_QUERY(now);
  const flag = (n: string, bad: boolean) => bad && invalid.push(n);
  const scope = pick(SCOPES, one(raw.ambito), d.scope);
  const period = pick(PULSE_PERIODS, one(raw.periodo), d.period);
  const norm = pick(NORM_MODES, one(raw.norm), d.norm);
  flag("ambito", scope.bad);
  flag("periodo", period.bad);
  flag("norm", norm.bad);
  const metricsRaw = list(raw.m);
  const metrics = metricsRaw.filter((m) => METRIC_BY_ID.has(m));
  flag("m", metrics.length !== metricsRaw.length);
  const sortRaw = one(raw.orden);
  const sort = sortRaw === "" ? d.sort : sortRaw === "name" || METRIC_BY_ID.has(sortRaw) ? sortRaw : (invalid.push("orden"), d.sort);
  const idOf = (name: string): string => {
    const v = one(raw[name]);
    if (v === "") return "";
    if (ID.test(v)) return v;
    invalid.push(name);
    return "";
  };
  const only = (name: string, allowed: readonly string[]) => {
    const vals = list(raw[name]);
    const ok = [...new Set(vals.filter((v) => allowed.includes(v)))];
    flag(name, ok.length !== vals.length);
    return ok;
  };
  const rev = one(raw.rpulse);
  const pulseRevision = rev === "" ? null : /^\d{1,6}$/.test(rev) && Number(rev) >= 1 ? Number(rev) : null;
  flag("rpulse", rev !== "" && pulseRevision === null);
  const product = one(raw.rproducto).slice(0, 100);
  return {
    query: {
      base,
      scope: scope.v,
      period: period.v,
      norm: norm.v,
      ref: idOf("ref"),
      refEco: idOf("refeco"),
      custom: { plans: only("rsoporte", SUPPORT_VALUES), hostings: only("ralojamiento", HOSTING_VALUES), complexities: only("rcomplejidad", COMPLEXITY_VALUES), product, homogeneous: one(raw.rhomog) === "1" },
      pulseRevision,
      metrics: metrics.length > 0 ? [...new Set(metrics)] : d.metrics,
      sort,
      col: METRIC_BY_ID.has(one(raw.col)) ? one(raw.col) : "",
      sel: idOf("sel"),
      historic: one(raw.historico) === "1",
    },
    invalid,
  };
}

/** Parámetros de URL de una consulta Pulse (omite los valores iniciales). */
export function pulseToParams(q: PulseQuery, now: Date = new Date()): Record<string, string> {
  const d = DEFAULT_PULSE_QUERY(now);
  const out: Record<string, string> = {};
  const b = { ...q.base };
  // Filtros de FILAS, fecha, modo, servicio y paginación.
  if (b.date !== d.base.date) out.fecha = b.date;
  if (b.mode !== d.base.mode) out.modo = b.mode;
  if (b.service !== d.base.service) out.servicio = b.service;
  if (b.revision !== null) out.revision = String(b.revision);
  if (b.q) out.q = b.q;
  if (b.support.length) out.soporte = b.support.join(",");
  if (b.hosting.length) out.alojamiento = b.hosting.join(",");
  if (b.complexity.length) out.complejidad = b.complexity.join(",");
  if (b.product) out.producto = b.product;
  if (b.status !== "activos") out.estado = b.status;
  if (b.coverage !== "todas") out.cobertura = b.coverage;
  if (b.dir !== "asc") out.dir = b.dir;
  if (b.page !== 1) out.pagina = String(b.page);
  if (b.pageSize !== d.base.pageSize) out.tam = String(b.pageSize);
  if (b.stamp) out.sello = b.stamp;
  if (q.scope !== d.scope) out.ambito = q.scope;
  if (q.period !== d.period) out.periodo = q.period;
  if (q.norm !== d.norm) out.norm = q.norm;
  if (q.ref) out.ref = q.ref;
  if (q.refEco) out.refeco = q.refEco;
  if (q.custom.plans.length) out.rsoporte = q.custom.plans.join(",");
  if (q.custom.hostings.length) out.ralojamiento = q.custom.hostings.join(",");
  if (q.custom.complexities.length) out.rcomplejidad = q.custom.complexities.join(",");
  if (q.custom.product) out.rproducto = q.custom.product;
  if (q.custom.homogeneous) out.rhomog = "1";
  if (q.pulseRevision !== null) out.rpulse = String(q.pulseRevision);
  if (q.metrics.join() !== d.metrics.join()) out.m = q.metrics.join(",");
  if (q.sort !== d.sort) out.orden = q.sort;
  if (q.col) out.col = q.col;
  if (q.sel) out.sel = q.sel;
  if (q.historic) out.historico = "1";
  return out;
}

export const NORMALIZATION_SET = NORMALIZATIONS;
