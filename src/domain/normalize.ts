import type { Kind } from "./catalogs";

/** Colapsa espacios repetidos y recorta extremos. No altera acentos, puntuación ni palabras. */
export function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Valor de búsqueda de una equivalencia. Los IDs se comparan exactos (texto, sin
 * convertir a número). Los nombres solo se comparan sin distinguir mayúsculas y
 * espacios repetidos: no se quitan acentos ni puntuación ni partes del nombre.
 */
export function searchValueOf(kind: Kind, raw: string): string {
  const clean = cleanText(raw);
  return kind === "ORG_ID" || kind === "PROJECT_ID" ? clean : clean.toLowerCase();
}

/** Los IDs numéricos de Zendesk se guardan como texto y deben ser enteros decimales. */
export function isDigits(value: string): boolean {
  return /^\d{1,30}$/.test(value);
}
