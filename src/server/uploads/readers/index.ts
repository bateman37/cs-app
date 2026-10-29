// TEMPORAL (rama del motor): lector CSV mínimo para poder probar el motor. El lector definitivo
// de XLSX/CSV lo aporta otra entrega y sustituye este archivo al fusionar.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { parse } from "csv-parse";
import { ReaderError, type Cell, type ReaderOptions, type SourceRow } from "./types";

export async function* readRows(path: string, opts: ReaderOptions): AsyncGenerator<SourceRow> {
  if (opts.format !== "csv") throw new ReaderError("Formato no soportado por el lector temporal.", "UNSUPPORTED");
  const size = (await stat(path)).size;
  if (size > opts.limits.maxFileBytes) throw new ReaderError("El archivo supera el tamaño máximo.", "LIMIT_FILE");
  const parser = createReadStream(path).pipe(
    parse({ bom: true, delimiter: opts.delimiter ?? ",", relax_column_count: true, skip_empty_lines: false }),
  );
  let n = 0;
  for await (const rec of parser as AsyncIterable<string[]>) {
    n++;
    if (n > opts.limits.maxRows) throw new ReaderError("Demasiadas filas.", "LIMIT_ROWS");
    const cells: Cell[] = rec.map((v) => ({ v, k: v === "" ? "empty" : "text" }));
    yield { sheet: null, rowNumber: n, cells };
  }
}
