/**
 * Contrato de consulta compartido de Comparativa y Análisis Cliente (CSAPP-06 §4). Se valida en servidor, se conserva en la URL y se puede
 * recargar y navegar atrás/adelante. Todo valor sale de listas permitidas o de fechas/enteros/ID acotados; un valor no válido se sustituye
 * por el predeterminado y se informa (`invalid`), nunca se interpola en SQL.
 */
import { z } from "zod";
import { COMPLEXITY_VALUES, HOSTING_VALUES, SUPPORT_VALUES } from "./catalogs";
import { isIsoDate, todayMadrid } from "./vigencia";

export const SERVICE_VALUES = ["SOPORTE", "ADMIN_DELEGADA", "OTROS", "TOTAL"] as const;
export const MODE_VALUES = ["CUTOFF", "FULL_MONTH"] as const;
export const STATUS_VALUES = ["todos", "activos", "inactivos"] as const;
export const COVERAGE_VALUES = ["todas", "completa", "parcial", "sin_datos"] as const;
export const PERIOD_BLOCKS = ["mes", "anterior", "cum", "anioant", "cumant"] as const;
export type PeriodBlock = (typeof PERIOD_BLOCKS)[number];
export const BLOCK_PERIOD: Record<PeriodBlock, "month" | "prevMonth" | "cum" | "prevYear" | "prevCum"> = {
  mes: "month",
  anterior: "prevMonth",
  cum: "cum",
  anioant: "prevYear",
  cumant: "prevCum",
};
export const TAB_VALUES = ["resumen", "dedicacion", "pap", "tickets", "datos"] as const;
export const ENTITY_TYPES = ["group", "client", "implementation"] as const;
export const PAGE_SIZES = [25, 50, 100, 200] as const;
export const REF_PERIODS = ["mes", "cum"] as const;
export const SELECT_NONE = "SIN_INFORMAR";
export const SELECT_MIXED = "HETEROGENEO";

const METRICS = ["hours", "revenue", "perDay", "devTarget", "devPortfolio", "stock", "avgUsers", "tariff"] as const;
const PERIOD_ORDER = ["month", "prevMonth", "cum", "prevYear", "prevCum"] as const;
/** Columnas de orden permitidas (lista cerrada): nombre, estado y cada métrica de cada periodo. */
export const SORT_KEYS = ["name", "support", ...PERIOD_ORDER.flatMap((p) => METRICS.map((m) => `${p}.${m}`))] as readonly string[];

export type AnalysisQuery = {
  date: string;
  mode: (typeof MODE_VALUES)[number];
  service: (typeof SERVICE_VALUES)[number];
  revision: number | null;
  q: string;
  support: string[];
  hosting: string[];
  complexity: string[];
  product: string;
  status: (typeof STATUS_VALUES)[number];
  coverage: (typeof COVERAGE_VALUES)[number];
  sort: string;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
  blocks: PeriodBlock[];
  ref: (typeof REF_PERIODS)[number];
  tab: (typeof TAB_VALUES)[number];
  /** Sello de datos de la lectura desde la que se abrió este enlace (detecta datos cambiados). */
  stamp: string;
};

export type RawParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();
const list = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : (v ?? "").split(",")).map((s) => s.trim()).filter(Boolean);

export const DEFAULT_QUERY = (now: Date = new Date()): AnalysisQuery => ({
  date: todayMadrid(now),
  mode: "CUTOFF",
  service: "SOPORTE",
  revision: null,
  q: "",
  support: [],
  hosting: [],
  complexity: [],
  product: "",
  status: "activos",
  coverage: "todas",
  sort: "name",
  dir: "asc",
  page: 1,
  pageSize: 50,
  blocks: ["mes", "cum"],
  ref: "mes",
  tab: "resumen",
  stamp: "",
});

const pick = <T extends string>(allowed: readonly T[], value: string, fallback: T): { v: T; bad: boolean } =>
  value === "" ? { v: fallback, bad: false } : allowed.includes(value as T) ? { v: value as T, bad: false } : { v: fallback, bad: true };

/** Valida y normaliza los parámetros de la URL. Nunca lanza: lo no válido vuelve al valor inicial y se lista en `invalid`. */
export function parseAnalysisQuery(raw: RawParams, now: Date = new Date()): { query: AnalysisQuery; invalid: string[] } {
  const d = DEFAULT_QUERY(now);
  const invalid: string[] = [];
  const flag = (name: string, bad: boolean) => {
    if (bad) invalid.push(name);
  };
  const date = one(raw.fecha);
  flag("fecha", date !== "" && !isIsoDate(date));
  const mode = pick(MODE_VALUES, one(raw.modo), d.mode);
  const service = pick(SERVICE_VALUES, one(raw.servicio), d.service);
  const status = pick(STATUS_VALUES, one(raw.estado), d.status);
  const coverage = pick(COVERAGE_VALUES, one(raw.cobertura), d.coverage);
  const dir = pick(["asc", "desc"] as const, one(raw.dir), d.dir);
  const ref = pick(REF_PERIODS, one(raw.ref), d.ref);
  const tab = pick(TAB_VALUES, one(raw.pestana), d.tab);
  const sort = pick(SORT_KEYS as readonly string[], one(raw.orden), d.sort);
  [mode, service, status, coverage, dir, ref, tab, sort].forEach((x, i) => flag(["modo", "servicio", "estado", "cobertura", "dir", "ref", "pestana", "orden"][i], x.bad));
  const rev = one(raw.revision);
  const revision = rev === "" ? null : /^\d{1,6}$/.test(rev) && Number(rev) >= 1 ? Number(rev) : null;
  flag("revision", rev !== "" && revision === null);
  const pg = one(raw.pagina);
  const page = pg === "" ? 1 : /^\d{1,7}$/.test(pg) && Number(pg) >= 1 ? Number(pg) : 1;
  flag("pagina", pg !== "" && !/^\d{1,7}$/.test(pg));
  const ps = one(raw.tam);
  const size = ps === "" ? d.pageSize : (PAGE_SIZES as readonly number[]).includes(Number(ps)) ? Number(ps) : d.pageSize;
  flag("tam", ps !== "" && !(PAGE_SIZES as readonly number[]).includes(Number(ps)));
  const filterList = (name: string, allowed: readonly string[]) => {
    const vals = list(raw[name]);
    const ok = vals.filter((v) => allowed.includes(v) || v === SELECT_NONE || v === SELECT_MIXED);
    flag(name, ok.length !== vals.length);
    return [...new Set(ok)];
  };
  const blocksRaw = list(raw.bloques);
  const blocks = blocksRaw.filter((b): b is PeriodBlock => (PERIOD_BLOCKS as readonly string[]).includes(b));
  flag("bloques", blocks.length !== blocksRaw.length);
  const q = one(raw.q).slice(0, 100);
  const product = z.string().max(100).safeParse(one(raw.producto));
  const stamp = /^[0-9a-f]{16}$/.test(one(raw.sello)) ? one(raw.sello) : "";
  return {
    query: {
      date: date !== "" && isIsoDate(date) ? date : d.date,
      mode: mode.v,
      service: service.v,
      revision,
      q,
      support: filterList("soporte", SUPPORT_VALUES),
      // HOTFIX-02: el filtro de negocio es «servidor» (CLOUD/OP); `alojamiento` se conserva solo como alias heredado de las vistas aún no migradas.
      hosting: filterList(raw.servidor !== undefined ? "servidor" : "alojamiento", HOSTING_VALUES),
      complexity: filterList("complejidad", COMPLEXITY_VALUES),
      product: product.success ? product.data : "",
      status: status.v,
      coverage: coverage.v,
      sort: sort.v,
      dir: dir.v,
      page,
      pageSize: size,
      blocks: blocks.length > 0 ? PERIOD_BLOCKS.filter((b) => blocks.includes(b)) : d.blocks,
      ref: ref.v,
      tab: tab.v,
      stamp,
    },
    invalid,
  };
}

/** Parámetros de URL de una consulta (omite los valores iniciales para conservar enlaces cortos). Los filtros de cohorte se conservan siempre. */
export function queryToParams(q: AnalysisQuery, now: Date = new Date()): Record<string, string> {
  const d = DEFAULT_QUERY(now);
  const out: Record<string, string> = {};
  if (q.date !== d.date) out.fecha = q.date;
  if (q.mode !== d.mode) out.modo = q.mode;
  if (q.service !== d.service) out.servicio = q.service;
  if (q.revision !== null) out.revision = String(q.revision);
  if (q.q) out.q = q.q;
  if (q.support.length) out.soporte = q.support.join(",");
  if (q.hosting.length) out.servidor = q.hosting.join(",");
  if (q.complexity.length) out.complejidad = q.complexity.join(",");
  if (q.product) out.producto = q.product;
  if (q.status !== d.status) out.estado = q.status;
  if (q.coverage !== d.coverage) out.cobertura = q.coverage;
  if (q.sort !== d.sort) out.orden = q.sort;
  if (q.dir !== d.dir) out.dir = q.dir;
  if (q.page !== 1) out.pagina = String(q.page);
  if (q.pageSize !== d.pageSize) out.tam = String(q.pageSize);
  if (q.blocks.join() !== d.blocks.join()) out.bloques = q.blocks.join(",");
  if (q.ref !== d.ref) out.ref = q.ref;
  if (q.tab !== d.tab) out.pestana = q.tab;
  if (q.stamp) out.sello = q.stamp;
  return out;
}

/** Parámetros que definen la COHORTE de referencia (conjunto filtrado de grupos) y su contexto de cálculo, sin orden ni paginación. */
export function cohortParams(q: AnalysisQuery, now: Date = new Date()): Record<string, string> {
  const p = queryToParams({ ...q, sort: "name", dir: "asc", page: 1, pageSize: 50, blocks: ["mes", "cum"], tab: "resumen", stamp: "" }, now);
  // La fecha y los modos viajan siempre explícitos: la ficha debe reproducir el mismo corte aunque cambie el día.
  return { ...p, fecha: q.date, modo: q.mode, servicio: q.service };
}

export const hasCohortFilters = (q: AnalysisQuery): boolean =>
  q.q !== "" || q.support.length > 0 || q.hosting.length > 0 || q.complexity.length > 0 || q.product !== "" || q.status !== "activos" || q.coverage !== "todas";

/** Identificador de entidad acotado (cuid / uuid): evita valores forjados antes de llegar a SQL. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{8,40}$/;
export const parseEntityRef = (type: string, id: string): { type: (typeof ENTITY_TYPES)[number]; id: string } | null =>
  (ENTITY_TYPES as readonly string[]).includes(type) && ID_PATTERN.test(id) ? { type: type as (typeof ENTITY_TYPES)[number], id } : null;

/** Escapa los comodines de LIKE/ILIKE de una búsqueda del usuario (el valor ya viaja parametrizado). */
export const likePattern = (s: string): string => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
