import { commonFiltersToParams, type CommonFilters } from "@/domain/filtros-comunes";
import type { AnalysisQuery } from "@/domain/analytics-query";
import { todayMadrid } from "@/domain/vigencia";
import type { EntityRef } from "@/server/analytics/operational";
import { qs } from "@/lib/format";

export const BASE = "/analisis-cliente";
/** Parámetros de Comparativa que se conservan al volver (lista permitida: sin redirecciones externas ni filtros ocultos heredados). */
export const BACK_KEYS = ["fecha", "modo", "soporte", "servidor", "orden", "dir", "pagina", "ref"];

/** Contexto de navegación de la ficha: periodo, filtros comunes Soporte/Servidor y parámetros de Comparativa a restituir. */
export type Nav = { query: AnalysisQuery; filters: CommonFilters; back: string };

/** Periodo explícito solo cuando difiere del valor inicial (enlaces cortos). */
export function periodParams(q: Pick<AnalysisQuery, "date" | "mode">, today = todayMadrid()): Record<string, string> {
  const out: Record<string, string> = {};
  if (q.date !== today) out.fecha = q.date;
  if (q.mode !== "CUTOFF") out.modo = q.mode;
  return out;
}

export const refParams = (ref: EntityRef) => ({ ambito: ref.type, id: ref.id });

/** Enlace a la ficha (o a su detalle con `extra`): conserva periodo, Soporte/Servidor y el retorno a Comparativa. No arrastra filtros obsoletos. */
export function fichaUrl(nav: Nav, ref: EntityRef, extra: Record<string, string | number | undefined> = {}): string {
  return `${BASE}${qs({ ...refParams(ref), ...periodParams(nav.query), ...commonFiltersToParams(nav.filters), volver: nav.back || undefined, ...extra })}`;
}

/** Vuelta a Comparativa con el periodo y los filtros ACTUALES de la ficha (más orden/página originales). */
export function backUrl(nav: Nav): string {
  const kept = Object.fromEntries(new URLSearchParams(nav.back));
  delete kept.fecha; delete kept.modo; delete kept.soporte; delete kept.servidor;
  return `/comparativa${qs({ ...kept, ...periodParams(nav.query), ...commonFiltersToParams(nav.filters) })}`;
}
