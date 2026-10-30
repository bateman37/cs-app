import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeXlsx, type XlsxOptions } from "./xlsx";
import { FILTER_VOCAB, type FinanceCategory } from "@/domain/finance";

type Cell = string | number | { raw: string } | { f: string; v?: string } | null;
export type FinRow = { grupo: string | null; vta?: Cell; dif?: Cell; extra?: Cell };

export const standardFooter = (cat: FinanceCategory): string[] => [
  "Filtros aplicados:",
  `DESC_L4 es ${FILTER_VOCAB[cat].map((t) => t.replace(/\b\w/g, (c) => c.toUpperCase())).join(", ")}`,
  "Año Actual es Año Actual",
];

export type FinOpts = {
  category?: FinanceCategory;
  /** Total declarado (Vta Potencial y Diferencia); false = sin fila Total. */
  total?: { vta: Cell; dif?: Cell } | false;
  /** Líneas del pie; false = sin pie. */
  footer?: string[] | false;
  headers?: string[];
  /** Orden de las tres columnas dentro del libro (permutación de [0,1,2]). */
  order?: number[];
  extraColumn?: boolean;
  sheetName?: string;
  extraSheets?: { name: string; rows: (string | number | null)[][] }[];
  /** Filas añadidas tal cual tras el Total (líneas desconocidas). */
  afterTotal?: Cell[][];
  date1904?: XlsxOptions["date1904"];
};

/** Suma exacta de importes en texto (para totales de prueba) sin pasar por flotantes: enteros con hasta 6 decimales. */
export function exactSum(values: string[]): string {
  let units = 0n;
  for (const v of values) {
    const [i, f = ""] = v.split(".");
    units += BigInt(i) * 1_000_000n + (i.startsWith("-") ? -1n : 1n) * BigInt(f.padEnd(6, "0").slice(0, 6) || "0");
  }
  const neg = units < 0n;
  const a = neg ? -units : units;
  const frac = (a % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${a / 1_000_000n}${frac ? `.${frac}` : ""}`;
}

export async function financeXlsx(rows: FinRow[], opts: FinOpts = {}): Promise<Buffer> {
  const cat = opts.category ?? "SOPORTE";
  const headers = opts.headers ?? ["Grupo cliente", "Vta Potencial", "Diferencia"];
  const order = opts.order ?? [0, 1, 2];
  const place = (cells: [Cell, Cell, Cell]): Cell[] => {
    const out: Cell[] = [];
    order.forEach((src, pos) => (out[pos] = cells[src]));
    if (opts.extraColumn) out.push(cells[0] === null ? null : "extra");
    return out;
  };
  const body: Cell[][] = [place([headers[0], headers[1], headers[2]])];
  if (opts.extraColumn) body[0].push("Comentario");
  for (const r of rows) body.push(place([r.grupo, r.vta ?? null, r.dif ?? null]));
  if (opts.total !== false && opts.total) body.push(place(["Total", opts.total.vta, opts.total.dif ?? null]));
  for (const l of opts.afterTotal ?? []) body.push(l);
  if (opts.footer !== false) for (const l of opts.footer ?? standardFooter(cat)) body.push([l]);
  const dir = mkdtempSync(path.join(tmpdir(), "csapp-fin-"));
  try {
    const f = path.join(dir, "fin.xlsx");
    await writeXlsx(f, {
      date1904: opts.date1904,
      sheets: [{ name: opts.sheetName ?? "Hoja1", rows: body }, ...(opts.extraSheets ?? []).map((s) => ({ name: s.name, rows: s.rows }))],
    });
    return readFileSync(f);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
