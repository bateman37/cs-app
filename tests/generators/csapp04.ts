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

// ---------------------------------------------------------------- Volumen (generación por streaming; órdenes de magnitud de las fuentes reales)

/** Filas Wrike sintéticas: horas con coma decimal, tickets explícitos (con puntos de millares), candidatos en el nombre y tareas sin imputación. */
export function* volumeWrike(count: number, opts: { tickets?: number; people?: number; projects?: number; unimputed?: number } = {}): Generator<string[]> {
  const tickets = opts.tickets ?? 8000;
  const people = opts.people ?? 40;
  const projects = opts.projects ?? 150;
  const unimputed = opts.unimputed ?? Math.round(count * 0.02);
  yield [...WRIKE_HEADERS];
  for (let i = 0; i < count; i++) {
    if (i < unimputed) {
      yield ["", `Proyecto ${i % projects}`, `Tarea sin imputación ${i}`, "0", "", "0"];
      continue;
    }
    const t = 1_000_000 + (i % tickets);
    const explicit = i % 7 === 0 ? String(t).replace(/(\d)(?=(\d{3})+$)/, "$1.") : i % 11 === 0 ? "0" : "";
    const name = i % 5 === 0 ? `Revisión #${t} de módulo, fase ${i % 9}` : i % 13 === 0 ? `Bug #${t} y versión 2.3.${i % 999}` : `Tarea de soporte "${i % 97}", línea ${i}`;
    const day = new Date(Date.UTC(2024, 5, 1) + (i % 700) * 86400000);
    const hours = `${(i % 7)},${["0", "25", "5", "75"][i % 4]}`.replace(/,0$/, "");
    yield [`persona.${i % people}`, `Proyecto ${i % projects}`, name, explicit, `${String(day.getUTCDate()).padStart(2, "0")}/${String(day.getUTCMonth() + 1).padStart(2, "0")}/${day.getUTCFullYear()}`, hours];
  }
}

const CAUSES = ["Correctivo (Estándar)", "Correctivo (Origen cliente)", "Evolutivo", "Mantenimiento", "Correctivo (Personalización);#Evolutivo", "Evolutivo;#Correctivo (Infraestructura)", ""];

/** PAP sintéticos con IDs únicos, varias causas, listas de tickets y Nº de BUG con y sin producto. */
export function* volumePap(count: number, opts: { tickets?: number; projects?: number } = {}): Generator<(string | number | { date: number } | null)[]> {
  const tickets = opts.tickets ?? 8000;
  const projects = opts.projects ?? 150;
  yield [...PAP_HEADERS];
  for (let i = 0; i < count; i++) {
    const t = 1_000_000 + (i % tickets);
    const row: PapRow = {
      Title: `${i % 2 === 0 ? "ID " : ""}${i + 1}: Pase ${i}${i % 3 === 0 ? " PAP" : ""}`,
      Proyecto: `Proyecto ${i % projects}`,
      Resultado: ["OK", "Rollback", "Cancelado", "Hotfix", "Iniciado"][i % 5],
      "Fecha de Solicitud": i % 40 === 0 ? null : { date: serial("2024-01-01") + (i % 700) },
      "Fecha puesta en producción": i % 50 === 0 ? null : { date: serial("2024-01-05") + (i % 700) },
      Duración: `${i % 5} horas`,
      "Causa raíz": CAUSES[i % CAUSES.length] || null,
      "Tickets asociados": i % 4 === 0 ? `#${t}; ${t + 1}` : i % 9 === 0 ? "ver nota del 10/05/2024" : null,
      "Ticket PAP Asociado": i % 6 === 0 ? `https://vincle.zendesk.com/agent/tickets/${t}` : null,
      "Nº de BUG": i % 8 === 0 ? String(1000 + (i % 200)) : i % 10 === 0 ? `VFS ${1000 + (i % 80)}` : null,
      "CAL's asociados": i % 12 === 0 ? `CAL-${i}` : null,
    };
    yield PAP_HEADERS.map((h) => row[h] ?? null);
  }
}

/** Work Items sintéticos de un producto: mezcla de tipos, estados y vínculos explícitos/por URL. */
export function* volumeBugs(product: "VFS" | "VSW", count: number, opts: { tickets?: number } = {}): Generator<string[]> {
  const tickets = opts.tickets ?? 8000;
  const headers = [...(product === "VFS" ? VFS_HEADERS : VSW_HEADERS)];
  yield headers;
  const states = ["New", "New", "In Progress", "PR", "Done (Ready for Release)", "Selected", "Blocked"];
  for (let i = 0; i < count; i++) {
    const t = 1_000_000 + (i % tickets);
    const over: BugRow = {
      ID: String(1000 + i),
      "Work Item Type": i % 9 === 0 ? "Request" : i % 23 === 0 ? "Enhancement" : "Bug_",
      State: states[i % states.length],
      "Created Date": `${(i % 27) + 1}/${(i % 12) + 1}/${2025 + (i % 2)} 09:${String(i % 60).padStart(2, "0")}:00`,
      "Zendesk Ticket ID": i % 3 === 0 ? String(t) : "",
      Clients: product === "VSW" && i % 4 === 0 ? `<a href="https://vincle.zendesk.com/agent/tickets/${t + 1}">Cliente</a> <a href="#">@Ana</a>` : "",
    };
    const base = product === "VFS" ? vfsBug(over) : vswBug(over);
    yield headers.map((h) => base[h] ?? "");
  }
}

export const serialOf = serial;
