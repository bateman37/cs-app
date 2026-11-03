import type { Kind } from "./catalogs";

/** Colapsa espacios repetidos y recorta extremos. No altera acentos, puntuación ni palabras. */
export function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Nombre normalizado de forma ÚNICA (HOTFIX-02 §3): Unicode NFC, espacios incluidos los no separables recortados y colapsados. Conserva
 * mayúsculas, acentos, puntuación y palabras (el original se guarda aparte). Es el gemelo exacto de la función SQL `csapp_norm_name`
 * (sin el paso de minúsculas): escritura, búsqueda, SQL de derivación y reproceso comparan con la misma regla.
 */
export function normalizeName(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Clave de comparación de un NOMBRE (sin distinguir caja): la que se guarda en `searchValue` y la que calcula `csapp_norm_name` en SQL. */
export function nameKey(value: string): string {
  return normalizeName(value).toLowerCase();
}

/**
 * Valor de búsqueda de una equivalencia. Los IDs se comparan exactos (texto, sin
 * convertir a número). Los nombres solo se comparan sin distinguir mayúsculas y
 * espacios repetidos: no se quitan acentos ni puntuación ni partes del nombre.
 */
export function searchValueOf(kind: Kind, raw: string): string {
  const clean = cleanText(raw);
  return kind === "ORG_ID" || kind === "PROJECT_ID" ? clean : nameKey(clean);
}

/** Los IDs numéricos de Zendesk se guardan como texto y deben ser enteros decimales. */
export function isDigits(value: string): boolean {
  return /^\d{1,30}$/.test(value);
}
