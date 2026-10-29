import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { pipeline } from "node:stream";
import { parse } from "csv-parse";
import { ReaderError, type Cell, type ReaderOptions, type SourceRow } from "./types";

/** Primeros bytes: rechaza binarios (XLSX/ZIP, OLE, UTF-16) enviados como CSV. */
async function sniff(path: string) {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const head = buf.subarray(0, bytesRead);
    if (head[0] === 0x50 && head[1] === 0x4b) throw new ReaderError("El archivo es un contenedor ZIP (¿un XLSX?), no un CSV.", "FORMAT");
    if (head[0] === 0xff && head[1] === 0xfe) throw new ReaderError("El CSV está en UTF-16; guárdelo como UTF-8.", "UNSUPPORTED");
    if (head[0] === 0xfe && head[1] === 0xff) throw new ReaderError("El CSV está en UTF-16; guárdelo como UTF-8.", "UNSUPPORTED");
    if (head.includes(0)) throw new ReaderError("El archivo contiene datos binarios; no es un CSV de texto.", "FORMAT");
  } finally {
    await fh.close();
  }
}

/**
 * CSV por bloques (RFC 4180): BOM, comillas, delimitadores y saltos de línea dentro de campos
 * entrecomillados. Memoria acotada: parser en streaming con contrapresión. No interpreta
 * fórmulas, HTML ni enlaces: todo es texto.
 */
export async function* readCsv(path: string, opts: ReaderOptions): AsyncGenerator<SourceRow> {
  const size = (await stat(path)).size;
  if (size > opts.limits.maxFileBytes) {
    throw new ReaderError("El archivo supera el tamaño máximo permitido.", "LIMIT_FILE");
  }
  await sniff(path);
  const parser = parse({
    bom: true,
    delimiter: opts.delimiter ?? ",",
    relax_column_count: true,
    skip_empty_lines: true,
    info: true,
    record_delimiter: ["\r\n", "\n", "\r"],
  });
  pipeline(createReadStream(path), parser, (err) => {
    if (err) parser.destroy(err);
  });
  let rows = 0;
  try {
    for await (const item of parser as AsyncIterable<{ record: string[]; info: { records: number } }>) {
      const cells: Cell[] = item.record.map((v) => ({ v, k: v === "" ? "empty" : "text" }));
      if (cells.every((c) => c.k === "empty")) continue;
      if (++rows > opts.limits.maxRows) throw new ReaderError("El archivo supera el número máximo de filas permitido.", "LIMIT_ROWS");
      yield { sheet: null, rowNumber: item.info.records, cells };
    }
  } catch (e) {
    if (e instanceof ReaderError) throw e;
    throw new ReaderError(`El CSV está mal formado: ${(e as { message?: string }).message ?? "error de lectura"}.`, "CORRUPT");
  }
}
