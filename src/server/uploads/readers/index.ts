import { readCsv } from "./csv";
import { readXlsx } from "./xlsx";
import type { ReaderOptions, SourceRow } from "./types";

export * from "./types";
export { serialToIso } from "./dates";

/** Lee un XLSX o CSV por filas, con memoria acotada. El formato lo declara el perfil; el contenido se verifica al leer. */
export function readRows(path: string, opts: ReaderOptions): AsyncGenerator<SourceRow> {
  return opts.format === "csv" ? readCsv(path, opts) : readXlsx(path, opts);
}
