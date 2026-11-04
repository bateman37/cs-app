import { SUPPORT_VALUES } from "./catalogs";
import { DEFAULT_ESTADO, parseEstado, type Estado } from "./estado";

/**
 * Filtros de negocio comunes de Comparativa y Calidad (HOTFIX-02 §6): SOLO Soporte y Servidor, multiselección sin Ctrl.
 * Sin selección equivale a todos; OR dentro de un mismo filtro y AND entre ambos. Parámetros de URL `soporte` y `servidor`
 * (listas separadas por coma). Cualquier otro parámetro heredado se ignora aquí (no recorta datos en secreto).
 */
export const SERVER_VALUES = ["CLOUD", "OP"] as const;
export type SupportValue = (typeof SUPPORT_VALUES)[number];
export type ServerValue = (typeof SERVER_VALUES)[number];
/** `estado` (HOTFIX-03 §7): Activos (predeterminado) / Inactivos / Todos; no recorta cifras de un Grupo, decide su pertenencia. */
export type CommonFilters = { soporte: SupportValue[]; servidor: ServerValue[]; estado: Estado };

export const EMPTY_FILTERS: CommonFilters = { soporte: [], servidor: [], estado: DEFAULT_ESTADO };

const SUPPORT_SHORT: Record<SupportValue, string> = { GOLD: "Gold", PLATINUM: "Platinum", SILVER_RECURRENTE: "Silver Recurrente", SILVER_ON_DEMAND: "Silver On Demand" };
export const supportChipLabel = (v: SupportValue) => SUPPORT_SHORT[v];

type Raw = Record<string, string | string[] | undefined>;
const list = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : [v ?? ""]).flatMap((x) => x.split(",")).map((x) => x.trim().toUpperCase()).filter(Boolean);

/** Lee y valida los filtros: valores desconocidos se descartan, el orden es el del catálogo y no hay duplicados. */
export function parseCommonFilters(raw: Raw): CommonFilters {
  const s = new Set(list(raw.soporte));
  const v = new Set(list(raw.servidor));
  return {
    soporte: SUPPORT_VALUES.filter((x) => s.has(x)),
    servidor: SERVER_VALUES.filter((x) => v.has(x)),
    estado: parseEstado(raw.estado),
  };
}

/** Parámetros de URL de los filtros (vacíos si no hay selección). */
export function commonFiltersToParams(f: CommonFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.soporte.length) out.soporte = f.soporte.join(",");
  if (f.servidor.length) out.servidor = f.servidor.join(",");
  if (f.estado !== DEFAULT_ESTADO) out.estado = f.estado;
  return out;
}

export const hasCommonFilters = (f: CommonFilters) => f.soporte.length > 0 || f.servidor.length > 0 || f.estado !== DEFAULT_ESTADO;

/** Alterna un valor (clic selecciona, otro clic deselecciona). */
export function toggleFilter(f: CommonFilters, kind: "soporte" | "servidor", value: string): CommonFilters {
  const cur = f[kind] as string[];
  const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
  return parseCommonFilters({ ...commonFiltersToParams(f), [kind]: next.join(",") });
}
