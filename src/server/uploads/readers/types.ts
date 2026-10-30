/**
 * Contrato común de lectura por bloques de XLSX y CSV. Los lectores emiten filas una a una
 * (memoria acotada); nunca devuelven el archivo completo. Cada celda conserva su texto original.
 */
export type CellKind = "text" | "number" | "date" | "bool" | "error" | "empty";

/**
 * `v` es el valor original como texto: un número conserva su representación exacta del archivo.
 * `d` solo existe en celdas de fecha (XLSX): fecha ISO AAAA-MM-DD (o AAAA-MM-DDTHH:MM:SS si lleva
 * hora) interpretada con el calendario del libro; el valor original sigue en `v`.
 */
export type Cell = { v: string; k: CellKind; d?: string };

export type SourceRow = {
  /** Nombre de la hoja (XLSX) o null (CSV). */
  sheet: string | null;
  /** Número de fila dentro de su hoja/archivo, empezando en 1 (informativo). */
  rowNumber: number;
  cells: Cell[];
};

export type ReaderLimits = {
  /** Tamaño máximo del archivo en disco. */
  maxFileBytes: number;
  /** Suma máxima de bytes descomprimidos (XLSX) declarados por el contenedor ZIP. */
  maxUncompressedBytes: number;
  /** Relación máxima descomprimido/comprimido por entrada (protección frente a bombas ZIP). */
  maxCompressionRatio: number;
  /** Máximo de filas leídas. */
  maxRows: number;
  /** Máximo de bytes de la tabla de cadenas compartidas (XLSX) que se carga en memoria. */
  maxSharedStringsBytes: number;
};

export type ReaderOptions = {
  format: "csv" | "xlsx";
  limits: ReaderLimits;
  /** CSV: delimitador; por defecto «,». */
  delimiter?: string;
  /** XLSX: nombre de la hoja a leer; por defecto todas las hojas visibles en orden. */
  sheet?: string;
  /** XLSX: solo la primera fila de cada hoja (inspección de cabeceras sin leer el contenido). */
  headerOnly?: boolean;
};

/** Error de lectura con mensaje seguro de mostrar (archivo corrupto, límite superado...). */
export class ReaderError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "FORMAT"
      | "CORRUPT"
      | "LIMIT_FILE"
      | "LIMIT_UNCOMPRESSED"
      | "LIMIT_RATIO"
      | "LIMIT_ROWS"
      | "LIMIT_STRINGS"
      | "UNSUPPORTED",
  ) {
    super(message);
    this.name = "ReaderError";
  }
}
