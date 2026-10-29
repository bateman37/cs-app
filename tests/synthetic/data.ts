import { createWriteStream } from "node:fs";
import { once } from "node:events";

export const HEADER = ["id", "nombre", "fecha", "importe", "categoria"];

export type SynRow = [string, string, string, string, string];

/** Fila válida determinista (no usa aleatoriedad: reproducible). */
export function row(i: number, over: Partial<Record<number, string>> = {}): SynRow {
  const base: SynRow = [`ID${i}`, `Nombre ${i}`, "2026-03-15", `${i}.50`, i % 2 ? "alfa" : "beta"];
  for (const [k, v] of Object.entries(over)) base[Number(k)] = v as string;
  return base;
}

const q = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function csvText(rows: string[][], opts: { bom?: boolean } = {}): string {
  return (opts.bom ? "﻿" : "") + [HEADER, ...rows].map((r) => r.map(q).join(",")).join("\n") + "\n";
}

/** Genera un CSV grande en streaming (sin acumular filas en memoria). */
export async function writeLargeCsv(path: string, rows: number): Promise<void> {
  const ws = createWriteStream(path);
  ws.write(HEADER.join(",") + "\n");
  for (let i = 1; i <= rows; i++) {
    if (!ws.write(`ID${i},Nombre ${i},2026-03-15,${i}.50,${i % 2 ? "alfa" : "beta"}\n`)) await once(ws, "drain");
  }
  ws.end();
  await once(ws, "finish");
}
