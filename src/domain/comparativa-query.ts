/**
 * Consulta de la vista normal de Comparativa (HOTFIX-02 §6–7). Solo existen tres filtros de negocio (Soporte, Servidor y Estado comercial) más la barra de periodo
 * (fecha y modo), el orden por cabecera y la página. Cualquier otra clave de la URL —incluidas las antiguas `q`, `servicio`, `complejidad`,
 * `producto`, `estado`, `cobertura`, `revision`, `tam`, `bloques`, `ref`, `pestana`, `alojamiento`— se IGNORA al leer y NO se vuelve a escribir en
 * ningún enlace: un parámetro oculto antiguo no puede recortar datos en secreto. HOTFIX-03: `estado` (Activos/Inactivos/Todos, predeterminado Activos) vuelve a ser un parámetro explícito y válido.
 */
import { parseAnalysisQuery, SORT_KEYS, type AnalysisQuery, type RawParams, PERIOD_BLOCKS } from "./analytics-query";
import { parseCommonFilters, commonFiltersToParams, type CommonFilters } from "./filtros-comunes";
import { todayMadrid } from "./vigencia";

/** Tamaño de página fijo (sin selector). Con ≈46 Grupos reales la cartera cabe en una página; el total siempre es el del filtrado completo. */
export const COMPARATIVA_PAGE_SIZE = 50;

/** Claves que la vista normal conserva en una URL (lista cerrada). */
export const COMPARATIVA_KEYS = ["fecha", "modo", "soporte", "servidor", "estado", "orden", "dir", "pagina"] as const;

const PERIODS = ["month", "prevMonth", "cum", "prevYear", "prevCum"] as const;
const METRICS = ["hours", "revenue", "perDay", "devTarget", "devPortfolio", "stock", "tariff"] as const;
/** Columnas ordenables de la tabla (las de Identificación y cada métrica de cada bloque). */
export const COMPARATIVA_SORTS: readonly string[] = ["name", "support", "hosting", ...PERIODS.flatMap((p) => METRICS.map((m) => `${p}.${m}`))].filter((k) => k === "hosting" || (SORT_KEYS as readonly string[]).includes(k));

export type ComparativaQuery = { query: AnalysisQuery; filters: CommonFilters };

export function parseComparativaQuery(raw: RawParams, now: Date = new Date()): ComparativaQuery {
  const clean: RawParams = {};
  for (const k of ["fecha", "modo", "dir", "pagina"] as const) if (raw[k] !== undefined) clean[k] = raw[k];
  const sort = Array.isArray(raw.orden) ? raw.orden[0] : raw.orden;
  const { query } = parseAnalysisQuery(clean, now);
  const filters = parseCommonFilters(raw);
  const orden = sort && COMPARATIVA_SORTS.includes(sort.trim()) ? sort.trim() : "name";
  return {
    filters,
    query: {
      ...query,
      service: "SOPORTE",
      revision: null,
      q: "",
      support: [...filters.soporte],
      hosting: [...filters.servidor],
      complexity: [],
      product: "",
      status: filters.estado,
      coverage: "todas",
      sort: orden,
      pageSize: COMPARATIVA_PAGE_SIZE,
      blocks: [...PERIOD_BLOCKS],
      ref: "mes",
      tab: "resumen",
      stamp: "",
    },
  };
}

/** Parámetros de URL de la vista normal (omite los valores iniciales). */
export function comparativaParams(q: AnalysisQuery, now: Date = new Date()): Record<string, string> {
  const out: Record<string, string> = {};
  if (q.date !== todayMadrid(now)) out.fecha = q.date;
  if (q.mode !== "CUTOFF") out.modo = q.mode;
  Object.assign(out, commonFiltersToParams({ soporte: q.support as CommonFilters["soporte"], servidor: q.hosting as CommonFilters["servidor"], estado: q.status === "todos" || q.status === "inactivos" ? q.status : "activos" }));
  if (q.sort !== "name") out.orden = q.sort;
  if (q.dir !== "asc") out.dir = q.dir;
  if (q.page !== 1) out.pagina = String(q.page);
  return out;
}
