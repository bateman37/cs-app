import { createHash } from "node:crypto";
import type { Json } from "./profile";

/**
 * JSON canónico: claves ordenadas, sin espacios; undefined se trata como ausente.
 * Los valores ya vienen tipados y normalizados por el perfil (fechas ISO, decimales como texto
 * sin ceros a la derecha, textos sin espacios repetidos).
 */
export function canonicalJson(value: Json | undefined): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

/**
 * Huella de una fila fuente: SHA-256 del JSON canónico de TODOS sus campos fuente tipados, antes de
 * enriquecer con maestros o cálculos. No incluye lote, posición de fila ni nombre de archivo.
 * Es una identidad distinta del checksum del archivo y de la clave de entidad revisable.
 */
export function rowFingerprint(typed: Record<string, Json>): string {
  return createHash("sha256").update(canonicalJson(typed)).digest("hex");
}
