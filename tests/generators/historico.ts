import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeXlsx } from "./xlsx";
import { Dec } from "@/domain/finance";

type Cell = string | number | { raw: string } | { f: string; v?: string } | { e: string; f?: string } | null;

/** Fila SINTÉTICA del libro «DATA FACTURACIÓN» (A..H). Nada de datos reales: los nombres y cifras salen de este código. */
export type HistRow = {
  g: string;
  /** B tal cual (texto exacto: precisión decimal). */
  b: string;
  y: number;
  /** D: plan histórico o «Admin Delegada». */
  d: string;
  /** F: 0/1 (por defecto 1 si D es Admin Delegada). */
  f?: 0 | 1;
  /** E: B/12 por defecto; B/6 como excepción; null = vacía. */
  e?: "B12" | "B6" | null;
  /** G: texto, o "NA" para el error #N/A de una búsqueda externa. */
  server?: string | "NA";
  /** H: número o fórmula con valor almacenado. */
  h?: number | { f: string; v: string } | string;
};

export const HIST_HEADERS = ["Grupo cliente", "Facturación anual", "Año ", "Soporte", "Facturación mes", "Admin Delegada", "Servidor", "Usuarios"];

export async function historicoXlsx(rows: HistRow[], opts: { headers?: string[]; sheetName?: string; extraSheets?: { name: string; rows: (string | number | null)[][] }[] } = {}): Promise<Buffer> {
  const body: Cell[][] = [opts.headers ?? HIST_HEADERS];
  rows.forEach((r, i) => {
    const n = i + 2;
    const admin = r.f ?? (/^admin/i.test(r.d) ? 1 : 0);
    const bd = Dec.parse(r.b) as Dec;
    const e: Cell = r.e === null ? null : r.e === "B6" ? { f: `B${n}/6`, v: bd.divInt(6).toString() } : { f: `B${n}/12`, v: bd.divInt(12).toString() };
    const g: Cell = r.server === "NA" ? { e: "#N/A", f: `VLOOKUP(A${n},[1]CLIENTES!$B:$G,6,0)` } : (r.server ?? "Cloud");
    const h: Cell = r.h === undefined ? null : typeof r.h === "object" ? { f: r.h.f, v: r.h.v } : typeof r.h === "string" ? r.h : r.h;
    body.push([r.g, { raw: r.b }, r.y, r.d, e, { f: `IF(D${n}="Admin Delegada",1,0)`, v: String(admin) }, g, h]);
  });
  const dir = mkdtempSync(path.join(tmpdir(), "csapp-hist-"));
  try {
    const f = path.join(dir, "hist.xlsx");
    await writeXlsx(f, { sheets: [{ name: opts.sheetName ?? "DATA FACTURACIÓN", rows: body }, ...(opts.extraSheets ?? [])] });
    return readFileSync(f);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Libro sintético de referencia: 18 filas en ocho ámbitos año+categoría, Grupos A, B, C (en el maestro) y X, Y (ausentes), dos errores #N/A en G,
 * una excepción E = B/6, usuarios de 2025 con un Grupo en discrepancia (B), una fórmula con valor almacenado (C) y un Grupo con la misma cifra en ambas categorías (A).
 * Los resultados esperados que usan las pruebas están escritos a mano en tests/historico-economico.test.ts, no calculados con el código bajo prueba.
 */
export const SYN: HistRow[] = [
  { g: "Grupo A", b: "1000.10", y: 2022, d: "Gold" }, // fila 2
  { g: "Grupo B", b: "2000.25", y: 2022, d: "Silver" }, // 3
  { g: "Grupo C", b: "3000", y: 2022, d: "Platinum", server: "NA" }, // 4 (G #N/A)
  { g: "Grupo A", b: "500", y: 2022, d: "Admin Delegada" }, // 5
  { g: "Grupo A", b: "1100.10", y: 2023, d: "Gold" }, // 6
  { g: "Grupo B", b: "2100.25", y: 2023, d: "Silver" }, // 7
  { g: "Grupo X", b: "400.5", y: 2023, d: "Gold" }, // 8 (X ausente del maestro)
  { g: "Grupo A", b: "600", y: 2023, d: "Admin Delegada" }, // 9
  { g: "Grupo B", b: "700", y: 2023, d: "Admin Delegada" }, // 10
  { g: "Grupo A", b: "1200.10", y: 2024, d: "Gold" }, // 11
  { g: "Grupo Y", b: "800", y: 2024, d: "Silver", server: "NA" }, // 12 (Y ausente; G #N/A)
  { g: "Grupo A", b: "650", y: 2024, d: "Admin Delegada" }, // 13
  { g: "Grupo A", b: "1300", y: 2025, d: "Gold", h: 100 }, // 14
  { g: "Grupo B", b: "2300.30", y: 2025, d: "Silver", h: 59 }, // 15
  { g: "Grupo C", b: "3300", y: 2025, d: "Platinum", e: "B6", h: { f: "20+20", v: "40" } }, // 16 (E = B/6; H fórmula)
  { g: "Grupo A", b: "800", y: 2025, d: "Admin Delegada", h: 100 }, // 17
  { g: "Grupo B", b: "900", y: 2025, d: "Admin Delegada", h: 87 }, // 18
  { g: "Grupo X", b: "450", y: 2025, d: "Gold" }, // 19
];
