import path from "node:path";
import { MB } from "@/server/uploads/config";

/**
 * Configuración técnica de las exportaciones completas (CSAPP-09 §6). Valores INICIALES técnicos, no una política de conservación de fuentes:
 * sirven para acotar disco, memoria y concurrencia; se leen del entorno en cada uso (web y trabajador).
 */
function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function exportConfig() {
  return {
    /** Almacén PRIVADO de exportaciones, separado del de originales (`CSAPP_UPLOAD_DIR`) y fuera de `public/` y de Git. */
    dir: path.resolve(/*turbopackIgnore: true*/ process.env.CSAPP_EXPORT_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "almacen-exportaciones")),
    /** Vida útil de un artefacto terminado (horas); caducar limpia solo artefactos y materialización. */
    ttlHours: num("CSAPP_EXPORT_TTL_HOURS", 24),
    /** Trabajos activos (en cola/preparando/generando) por persona. */
    maxActivePerUser: num("CSAPP_EXPORT_MAX_ACTIVE_PER_USER", 2),
    /** Trabajos activos en total (la supervisión de Administración los muestra). */
    maxActiveTotal: num("CSAPP_EXPORT_MAX_ACTIVE_TOTAL", 6),
    /** Filas máximas materializables por trabajo (suma de sus archivos). */
    maxRows: num("CSAPP_EXPORT_MAX_ROWS", 20_000_000),
    /** Tamaño máximo de un archivo (bytes). */
    maxFileBytes: num("CSAPP_EXPORT_MAX_FILE_BYTES", 2048 * MB),
    /** Filas de datos por archivo: por debajo del límite de una hoja de Excel (1 048 576 con la cabecera); más allá se parte de forma determinista. */
    partRows: Math.min(num("CSAPP_EXPORT_PART_ROWS", 1_000_000), 1_048_575),
    /** Bloque de lectura/escritura (contrapresión): memoria proporcional al bloque, no al archivo. */
    pageRows: num("CSAPP_EXPORT_PAGE_ROWS", 5000),
    /** Espacio libre mínimo antes de generar (bytes). */
    minFreeBytes: num("CSAPP_EXPORT_MIN_FREE_BYTES", 256 * MB),
    /** Tiempo máximo de la lectura coherente de preparación. */
    materializeTimeoutMs: num("CSAPP_EXPORT_MATERIALIZE_TIMEOUT_MS", 60 * 60_000),
  };
}

export const FORMAT_VERSION = "csv-v1";
export const ENGINE_VERSION = "eco-v2+calidad-v2";
