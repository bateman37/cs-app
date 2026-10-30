import { PAP_HEADERS } from "@/domain/pap";
import { VFS_HEADERS, VSW_HEADERS } from "@/domain/bugs";
import { WRIKE_HEADERS } from "@/domain/wrike";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeXlsx, type XlsxOptions } from "./xlsx";

/** Generadores sintéticos pequeños de los cuatro perfiles de CSAPP-04 (sin fuentes reales). */

const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const csvText = (rows: string[][], opts: { bom?: boolean; eol?: string } = {}) => (opts.bom === false ? "" : "﻿") + rows.map((r) => r.map(q).join(",")).join(opts.eol ?? "\r\n") + (opts.eol ?? "\r\n");

// ---------------------------------------------------------------- Wrike

export type WrikeRow = { usuario: string; proyecto: string; tarea: string; ticket: string; fecha: string; horas: string };
export const wrikeRow = (over: Partial<WrikeRow> = {}): WrikeRow => ({
  usuario: "ana.wrike",
  proyecto: "Proyecto Alfa",
  tarea: "Tarea de soporte",
  ticket: "",
  fecha: "15/01/2025",
  horas: "1",
  ...over,
});
export function wrikeCsv(rows: WrikeRow[], opts: { order?: number[]; headers?: string[]; bom?: boolean } = {}): Buffer {
  const headers = opts.headers ?? [...WRIKE_HEADERS];
  const cells = (r: WrikeRow) => [r.usuario, r.proyecto, r.tarea, r.ticket, r.fecha, r.horas];
  const perm = <T>(a: T[]) => (opts.order ? opts.order.map((i) => a[i]) : a);
  return Buffer.from(csvText([perm(headers), ...rows.map((r) => perm(cells(r)))], { bom: opts.bom }));
}

// ---------------------------------------------------------------- Bugs

export type BugRow = Record<string, string>;
export function vfsBug(over: BugRow = {}): BugRow {
  return {
    "Work Item Type": "Bug_", ID: "1001", Title: "Fallo en VFS", "Created By": "Pedro", "Created Date": "5/3/2025 9:07:01", "Assigned To": "Luis", State: "New",
    "Area Path": "VFS\\Core", Tags: "a; b", "Comment Count": "2", "Changed Date": "6/3/2025 10:00:00", "Reported by": "Soporte", "Zendesk Ticket ID": "", ...over,
  };
}
export function vswBug(over: BugRow = {}): BugRow {
  return {
    ID: "1001", "Work Item Type": "Bug_", Title: "Fallo en VSW", "Assigned To": "Luis", State: "New", Tags: "x", "Created By": "Pedro", "Created Date": "5/3/2025 9:07:01",
    "Zendesk Ticket ID": "", Clients: "", ...over,
  };
}
export function bugsCsv(product: "VFS" | "VSW", rows: BugRow[], opts: { extra?: boolean } = {}): Buffer {
  const headers = [...(product === "VFS" ? VFS_HEADERS : VSW_HEADERS)];
  return Buffer.from(csvText([[...headers, ...(opts.extra ? ["Extra"] : [])], ...rows.map((r) => [...headers.map((h) => r[h] ?? ""), ...(opts.extra ? ["x"] : [])])]));
}

// ---------------------------------------------------------------- PAP

export type PapRow = Record<string, string | number | { date: number } | null>;
export function papRow(over: PapRow = {}): PapRow {
  return {
    Title: "ID 42: PAP texto", Proyecto: "Proyecto PAP", Resultado: "OK", "Fecha puesta en producción": { date: serial("2025-02-10") },
    "Causa raíz": "Evolutivo", ...over,
  };
}
const serial = (iso: string) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000);
export const papDate = (iso: string) => ({ date: serial(iso) });

export async function papBuffer(rows: PapRow[], opts: Pick<XlsxOptions, "date1904"> & { sheetName?: string } = {}): Promise<Buffer> {
  const dir = mkdtempSync(path.join(tmpdir(), "csapp-pap-"));
  try {
    const f = path.join(dir, "pap.xlsx");
    await writeXlsx(f, {
      date1904: opts.date1904,
      sheets: [{ name: opts.sheetName ?? "CARGA PAP", rows: [[...PAP_HEADERS], ...rows.map((r) => PAP_HEADERS.map((h) => r[h] ?? null))] }],
    });
    return readFileSync(f);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
