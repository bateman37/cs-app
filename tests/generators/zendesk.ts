import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TICKET_HEADERS, TIME_HEADERS } from "../../src/domain/zendesk";
import { writeXlsx, type XlsxOptions } from "./xlsx";

/**
 * Generadores sintéticos de los dos XLSX de Zendesk (sin datos reales; reproducibles). Se escriben por streaming,
 * de modo que sirven tanto para pruebas pequeñas como para volumen.
 */

/** Serial de Excel de una fecha ISO (calendario 1900 con su error de 1900 o calendario 1904). */
export function excelSerial(iso: string, date1904 = false): number {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return Math.round((ms - base) / 86_400_000);
}

export type Cell = string | number | { date: number } | null;

export type TicketRow = {
  ticket_id: string | number;
  organization_id: string | number | null;
  entorno: string | null;
  causa: string | null;
  tags: string;
  creada: string | { date: number };
  type: string;
  status: string;
};

export function ticket(over: Partial<TicketRow> = {}): TicketRow {
  return {
    ticket_id: "1001",
    organization_id: "9001",
    entorno: "Producción · Facturación",
    causa: "incidente_estándar_plataforma",
    tags: '["team_n2"]',
    creada: { date: excelSerial("2024-03-05") },
    type: "incident",
    status: "open",
    ...over,
  };
}

export type TimeRow = {
  ticket_id: string | number;
  user_id: string | number | null;
  user_name: string | null;
  date: string | { date: number };
  hour: Cell;
  logged_hours: number | string | null;
  logged_minutes: number | string | null;
  dia: string | null;
  segmentador: string | null;
  id: string | number | null;
  type: string | null;
};

export function timeRow(over: Partial<TimeRow> = {}): TimeRow {
  return {
    ticket_id: "1001",
    user_id: "5001",
    user_name: "Ana Prueba",
    date: { date: excelSerial("2024-03-06") },
    hour: { date: 0.3506944444444444 },
    logged_hours: 1,
    logged_minutes: 30,
    dia: "miércoles",
    segmentador: "Soporte",
    id: null,
    type: "ticket",
    ...over,
  };
}

const ticketCells = (r: TicketRow): Cell[] => [r.ticket_id as Cell, r.organization_id as Cell, r.entorno, r.causa, r.tags, r.creada as Cell, r.type, r.status];
const timeCells = (r: TimeRow): Cell[] => [
  r.ticket_id as Cell, r.user_id as Cell, r.user_name, r.date as Cell, r.hour, r.logged_hours as Cell, r.logged_minutes as Cell, r.dia, r.segmentador, r.id as Cell, r.type,
];

export type BuildOptions = Pick<XlsxOptions, "date1904" | "dimension" | "sharedStrings"> & {
  /** Orden de las columnas (índices de la cabecera canónica). */
  order?: number[];
  headers?: string[];
  extraColumn?: boolean;
  sheetName?: string;
  /** Hojas adicionales (nombre y filas ya construidas con su cabecera). */
  extraSheets?: { name: string; rows: Cell[][] }[];
};

function permute<T>(arr: T[], order?: number[]): T[] {
  return order ? order.map((i) => arr[i]) : arr;
}

function* rowsOf<T>(rows: Iterable<T>, header: string[], cells: (r: T) => Cell[], opts: BuildOptions): Generator<Cell[]> {
  yield permute(opts.headers ?? header, opts.order).concat(opts.extraColumn ? ["columna_extra"] : []);
  for (const r of rows) yield permute(cells(r), opts.order).concat(opts.extraColumn ? ["x"] : []);
}

export async function writeTickets(file: string, rows: Iterable<TicketRow>, opts: BuildOptions = {}) {
  await writeXlsx(file, {
    date1904: opts.date1904,
    dimension: opts.dimension,
    sharedStrings: opts.sharedStrings,
    sheets: [
      { name: opts.sheetName ?? "Tickets", rows: rowsOf(rows, [...TICKET_HEADERS], ticketCells, opts) },
      ...(opts.extraSheets ?? []).map((s) => ({ name: s.name, rows: s.rows })),
    ],
  });
}

export async function writeTimes(file: string, rows: Iterable<TimeRow>, opts: BuildOptions = {}) {
  await writeXlsx(file, {
    date1904: opts.date1904,
    dimension: opts.dimension,
    sharedStrings: opts.sharedStrings,
    sheets: [
      { name: opts.sheetName ?? "Tiempos", rows: rowsOf(rows, [...TIME_HEADERS], timeCells, opts) },
      ...(opts.extraSheets ?? []).map((s) => ({ name: s.name, rows: s.rows })),
    ],
  });
}

/** Archivo temporal propio de una prueba: se borra con `done()`. */
export function tempXlsx() {
  const dir = mkdtempSync(path.join(tmpdir(), "csapp-zd-"));
  let n = 0;
  return {
    next: () => path.join(dir, `libro-${++n}.xlsx`),
    read: (file: string) => readFileSync(file),
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export async function ticketsBuffer(rows: TicketRow[], opts: BuildOptions = {}): Promise<Buffer> {
  const t = tempXlsx();
  try {
    const f = t.next();
    await writeTickets(f, rows, opts);
    return t.read(f);
  } finally {
    t.done();
  }
}

export async function timesBuffer(rows: TimeRow[], opts: BuildOptions = {}): Promise<Buffer> {
  const t = tempXlsx();
  try {
    const f = t.next();
    await writeTimes(f, rows, opts);
    return t.read(f);
  } finally {
    t.done();
  }
}
