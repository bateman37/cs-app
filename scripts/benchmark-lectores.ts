import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readRows } from "../src/server/uploads/readers";
import { writeCsv } from "../tests/generators/csv";
import { writeXlsx } from "../tests/generators/xlsx";

/**
 * Medición de los lectores con un archivo sintético representativo (nunca datos reales).
 * Uso:  npx tsx scripts/benchmark-lectores.ts --formato csv --filas 1000000
 *       npx tsx scripts/benchmark-lectores.ts            (ejecuta CSV y XLSX en procesos separados)
 * Cada medición corre en su propio proceso para que el pico de memoria (RSS) sea fiable.
 */
function arg(name: string, def?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function* rows(n: number): Generator<string[]> {
  yield ["id", "organizacion", "persona", "fecha", "importe", "comentario"];
  for (let i = 1; i <= n; i++) {
    yield [String(1000000000 + i), `Organización ${i % 500}`, `Persona ${i % 80}`, `2026-0${(i % 9) + 1}-${String((i % 27) + 1).padStart(2, "0")}`, String((i % 9973) / 7), `Texto, con coma y "comillas" ${i}`];
  }
}

async function medir() {
  const formato = arg("formato", "csv") as "csv" | "xlsx";
  const n = Number(arg("filas", "1000000"));
  const dir = await mkdtemp(path.join(tmpdir(), "csapp-bench-"));
  const file = path.join(dir, `bench.${formato}`);
  try {
    if (formato === "csv") await writeCsv(file, rows(n));
    else await writeXlsx(file, { sheets: [{ name: "Datos", rows: rows(n) }] });
    const bytes = (await stat(file)).size;
    global.gc?.();
    const base = process.memoryUsage().rss;
    let peak = base;
    const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 50);
    const t0 = process.hrtime.bigint();
    let count = 0;
    for await (const r of readRows(file, {
      format: formato,
      limits: { maxFileBytes: 4e9, maxUncompressedBytes: 8e9, maxCompressionRatio: 1000, maxRows: 1e9, maxSharedStringsBytes: 5e8 },
    })) { if (r.cells.length) count++; }
    const secs = Number(process.hrtime.bigint() - t0) / 1e9;
    clearInterval(timer);
    peak = Math.max(peak, process.memoryUsage().rss);
    console.log(JSON.stringify({
      formato, filasLeidas: count, tamanoMB: +(bytes / 1048576).toFixed(1), segundos: +secs.toFixed(2),
      filasPorSegundo: Math.round(count / secs), rssInicialMB: +(base / 1048576).toFixed(0), rssPicoMB: +(peak / 1048576).toFixed(0),
      node: process.version,
    }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

if (arg("formato")) {
  medir().catch((e) => { console.error(e); process.exit(1); });
} else {
  const filasCsv = arg("filas-csv", "1000000");
  const filasXlsx = arg("filas-xlsx", "500000");
  for (const [f, n] of [["csv", filasCsv], ["xlsx", filasXlsx]]) {
    console.log(execFileSync(process.execPath, ["--expose-gc", "--import", "tsx", import.meta.filename, "--formato", f, "--filas", n], { encoding: "utf8" }).trim());
  }
}
