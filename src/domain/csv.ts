/**
 * CSV de resúmenes (CSAPP-06 §11): UTF-8 con BOM, separador «;» y decimales con coma (apertura directa en Excel en español), saltos CRLF,
 * comillas dobladas y campos con separador, comillas o saltos entre comillas. Los textos que empiezan por un carácter ejecutable al abrirlos
 * (= + - @ tabulación, retorno) se neutralizan con un apóstrofo; los NÚMEROS (decimales exactos del servidor) no se tocan, de modo que un
 * valor negativo válido sigue siendo un número. Desconocido (celda vacía) y cero («0») son distintos.
 */
export const CSV_SEP = ";";
export const CSV_BOM = "﻿";

export type CsvValue = string | null | undefined | { n: string | null };

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(v: CsvValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (v.n === null) return "";
    // Decimal exacto del servidor: solo cambia el separador decimal; nunca pasa por Number.
    return v.n.replace(".", ",");
  }
  let t = v;
  if (FORMULA_START.test(t)) t = `'${t}`;
  return /[;"\r\n]/.test(t) || t !== v ? `"${t.replace(/"/g, '""')}"` : t;
}

export const csvLine = (cells: readonly CsvValue[]): string => cells.map(csvCell).join(CSV_SEP);

export function csvDocument(header: readonly string[], rows: Iterable<readonly CsvValue[]>): string {
  const out: string[] = [csvLine(header)];
  for (const r of rows) out.push(csvLine(r));
  return `${CSV_BOM}${out.join("\r\n")}\r\n`;
}
