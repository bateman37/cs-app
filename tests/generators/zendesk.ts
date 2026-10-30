import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TICKET_HEADERS, TIME_HEADERS } from "../../src/domain/zendesk";
import type { PrismaClient } from "../../src/generated/prisma/client";
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

// ---------------------------------------------------------------- Volumen (generación por streaming, sin datos reales)

const ORG_BASE = 100_000;

/** `count` tickets sintéticos con tags, causas y estados variados (≈ origen: unas 114 000 filas, ~20 000 organizaciones). */
export function* volumeTickets(count: number, opts: { orgs?: number } = {}): Generator<TicketRow> {
  const orgs = opts.orgs ?? 20_000;
  const statuses = ["closed", "closed", "closed", "closed", "solved", "open", "pending", "hold"];
  const causes = ["incidente_estándar_plataforma", "incidente_configuración_plataforma", "Sistemas del Cliente", "Uso Indebido", "incidente_infraestructura", null];
  const tags = ['["team_n2"]', '["team_n3_pmo","team_it"]', '["team_plataforma"]', "[]", '["team_plataformavsw","team_n2"]'];
  for (let i = 0; i < count; i++) {
    yield ticket({
      ticket_id: String(1_000_000 + i),
      organization_id: i % 97 === 0 ? null : String(ORG_BASE + (i % orgs)),
      entorno: i % 11 === 0 ? "Producción · Admin Delegada" : "Producción",
      causa: causes[i % causes.length],
      tags: tags[i % tags.length],
      creada: { date: excelSerial("2020-01-01") + (i % 2000) },
      type: i % 9 === 0 ? "problem" : "incident",
      status: statuses[i % statuses.length],
    });
  }
}

/** `count` tiempos sintéticos distintos (huellas únicas), repartidos en varios años, personas y tickets. */
export function* volumeTimes(count: number, opts: { tickets?: number; people?: number } = {}): Generator<TimeRow> {
  const tickets = opts.tickets ?? 114_000;
  const people = opts.people ?? 300;
  for (let i = 0; i < count; i++) {
    const minute = i % 1440;
    yield timeRow({
      ticket_id: String(1_000_000 + (i % tickets)),
      user_id: String(50_000 + (i % people)),
      user_name: `Persona ${i % people}`,
      date: { date: excelSerial("2022-01-03") + Math.floor(i / 160) },
      hour: { date: minute / 1440 },
      logged_hours: i % 4,
      logged_minutes: (i * 7) % 60,
      id: i % 5 === 0 ? null : String(i + 1),
    });
  }
}

/** Maestros sintéticos a escala: una organización y un Cliente por cada `orgs`, y `people` personas con ID y pertenencia a PMO. */
export async function seedVolumeMasters(prisma: PrismaClient, opts: { orgs?: number; people?: number } = {}) {
  const orgs = opts.orgs ?? 20_000;
  const people = opts.people ?? 300;
  const clients = Array.from({ length: orgs }, (_, i) => ({ id: `vc${i}`, name: `Cliente sintético ${i}`, updatedAt: new Date() }));
  for (let i = 0; i < clients.length; i += 5000) await prisma.client.createMany({ data: clients.slice(i, i + 5000) });
  await prisma.externalIdentity.createMany({
    data: clients.map((c, i) => ({ system: "ZENDESK" as const, kind: "ORG_ID" as const, rawValue: String(ORG_BASE + i), searchValue: String(ORG_BASE + i), clientId: c.id, updatedAt: new Date() })),
  });
  const persons = Array.from({ length: people }, (_, i) => ({ id: `vp${i}`, name: `Persona sintética ${i}`, updatedAt: new Date() }));
  await prisma.person.createMany({ data: persons });
  await prisma.personAlias.createMany({
    data: persons.map((p, i) => ({ personId: p.id, system: "ZENDESK" as const, kind: "ID" as const, rawValue: String(50_000 + i), searchValue: String(50_000 + i), updatedAt: new Date() })),
  });
  await prisma.personTerm.createMany({ data: persons.map((p, i) => ({ personId: p.id, attribute: "PMO_MEMBER" as const, flag: i % 10 === 0, updatedAt: new Date() })) });
}
