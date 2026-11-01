import { queryToParams, type AnalysisQuery } from "@/domain/analytics-query";
import type { EntityRef } from "@/server/analytics/operational";
import { qs } from "@/lib/format";

export const BASE = "/analisis-cliente";
/** Parámetros del contrato que se conservan al volver a Comparativa (lista permitida: sin redirecciones externas). */
export const BACK_KEYS = ["fecha", "modo", "servicio", "revision", "q", "soporte", "alojamiento", "complejidad", "producto", "estado", "cobertura", "orden", "dir", "pagina", "tam", "bloques", "ref"];

export const refParams = (ref: EntityRef) => ({ ambito: ref.type, id: ref.id });
export function fichaHref(q: AnalysisQuery, ref: EntityRef, back: string, extra: Record<string, string | number | undefined> = {}): string {
  return `${BASE}${qs({ ...refParams(ref), ...queryToParams(q), volver: back || undefined, ...extra })}`;
}
export function backHref(back: string): string {
  return `/comparativa${back ? `?${back}` : ""}`;
}
