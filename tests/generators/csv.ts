import { createWriteStream } from "node:fs";
import { once } from "node:events";

const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Escribe un CSV en streaming (respeta contrapresión) a partir de filas; para pruebas de volumen. */
export async function writeCsv(path: string, rows: Iterable<string[]>, opts: { bom?: boolean; eol?: string } = {}): Promise<void> {
  const out = createWriteStream(path);
  const eol = opts.eol ?? "\n";
  if (opts.bom) out.write("﻿");
  let buf = "";
  for (const row of rows) {
    buf += row.map(q).join(",") + eol;
    if (buf.length > 1 << 16) {
      if (!out.write(buf)) await once(out, "drain");
      buf = "";
    }
  }
  out.end(buf);
  await once(out, "finish");
}
