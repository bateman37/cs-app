import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeXlsx } from "./xlsx";

/**
 * Libro SINTÉTICO de «hojas de carga» (nombres inventados; nunca datos reales). Reproduce la ESTRUCTURA del libro real:
 * hojas CLIENTES / PERSONAL PMO / PERSONAL en ese orden, cabeceras repetidas por posición, IDs numéricos largos, filas finales vacías,
 * fórmulas con valor en caché en la columna PMO y los casos de §12.15 (duplicado exacto, variantes, prueba, marcador, incompleto, alias ambiguos...).
 */

type Cell = string | number | null | { raw: string } | { f: string; v?: string };

export const CLIENT_HEADER: Cell[] = [
  "organization_wrike", "GRUPO CLIENTE VINCLE", "organization_id_zendesk", "Organization_name_zendesk", "Nivel_Servicio_acutal", "GRUPO CLIENTE VINCLE",
  "SERVIDOR", "Nivel_Servicio_acutal", "Organization_name_PAP", "GRUPO CLIENTE VINCLE", "TIPO ",
];
export const PERSONAL_HEADER: Cell[] = ["Persona PAP", "Persona Zendesk", "Nivel", "Equipo", "PMO", "Persona Wrike", "Persona Zendesk"];
export const PMO_HEADER: Cell[] = ["Persona", "PERFIL"];

const id = (v: string): Cell => ({ raw: v });
/** A..K de CLIENTES (null = celda vacía). */
export function cliente(a: string | null, b: string | null, c: string, d: string, e: string | null, f: string | null, g: string | null, h: string | null, i: string | null, j: string | null, k: string | null): Cell[] {
  return [a, b, id(c), d, e, f, g, h, i, j, k];
}

export const CLIENT_ROWS: Cell[][] = [
  cliente("ALFA - CS", "ALFA", "360000000101", "Alfa Iberia", "Gold", "ALFA", "OP", "Gold", "ALFA - POS", "ALFA", "Basic"),
  cliente("ALFA - CS", "ALFA", "360000000101", "Alfa Iberia", "Gold", "ALFA", "OP", "Gold", "ALFA - SALES", "ALFA", "Enterprise"),
  cliente("ALFA - CS", "ALFA", "360000000102", "Alfa Portugal", "Gold", "ALFA", "OP", "Gold", "ALFA - SHARED", "ALFA", "Medium"),
  cliente("ALFA - CS", "ALFA", "360000000103", "Alfa Chile", "Gold", "ALFA", "OP", "Gold", "ALFA - SHARED", "ALFA", "Medium"),
  cliente("BETA - CS", "BETA", "19000000000201", "Beta", "Platinum", "BETA", "CLOUD", "Silver On Demand", "BETA - VFS", "BETA", "Medium"),
  cliente("COMPARTIDO - CS", "GAMMA", "360000000301", "Gamma", "Gold", "GAMMA", "OP", "Gold", "MULTI - X", "GAMMA", "Medium"),
  cliente("COMPARTIDO - CS", "DELTA", "360000000401", "Delta", "Gold", "DELTA", "OP", "Gold", "MULTI - X", "DELTA", "Medium"),
  cliente(null, "EPSILON", "360000000501", "Epsilon", "Silver Recurrente", "EPSILON", "OP", "Silver Recurrente", null, "EPSILON", null),
  cliente(null, null, "360000009001", "VINCLE TEST", "", null, null, "", null, null, null),
  cliente(null, null, "360000009002", "Test sandbox", "", null, null, "", null, null, null),
  [null, null, null, null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null, null, null, null],
];

/** A..G de PERSONAL; la columna PMO (E) es una fórmula con valor en caché, como en el libro real. */
function persona(a: string | null, b: string | null, c: string | null, d: string | null, pmo: 0 | 1 | null, f: string | null, g: string | null, row: number): Cell[] {
  const e: Cell = pmo === null ? null : { f: `IF(D${row}<>"PMO",0,1)`, v: String(pmo) };
  return [a, b, c, d, e, f, g];
}

export function personalRows(): Cell[][] {
  const rows: (n: number) => Cell[][] = (start) => [
    persona("ana.uno@x.test", "Ana Uno", "N3", "PMO", 1, "Ana Uno", "Ana Uno", start),
    persona("beto.dos@x.test", "Beto Dos", "N1", "CS", 0, null, "Beto Dos", start + 1),
    persona("cris.tres@x.test", "Cris Tres", "N1", "CS", 0, null, "Cris Tres", start + 2),
    persona("cris.trés@x.test", "Cris Trés", "N1", "CS", 0, null, "Cris Trés", start + 3),
    persona("inc.compl@x.test", "Incompleta Cinco", null, null, 0, null, "Incompleta Cinco", start + 4),
    persona("test.user 1@x.test", "test user 1", null, null, 0, null, "test user 1", start + 5),
    persona("(en.blanco)@x.test", "(en blanco)", null, null, null, null, "(en blanco)", start + 6),
    persona("dev.seis@x.test", "Dev Seis", "N3", "PMO", 1, "Dev Seis", "Dev Seis", start + 7),
    persona("ext.siete@x.test", "Ext Siete", "N3", "PMO", 1, "Ext Siete", "Ext Siete", start + 8),
    persona("beto.dos@x.test", "Beto Dos", "N1", "CS", 0, null, "Beto Dos", start + 9), // duplicado EXACTO de la fila 3
  ];
  return rows(2);
}

export const PMO_ROWS: Cell[][] = [
  ["Ana Uno", "ANA"],
  ["Dev Seis", "DEV"],
  ["Ext Siete Largo", "ANA"],
  ["Sin Persona", "DEV"],
];

export type BookOptions = {
  clientHeader?: Cell[];
  clients?: Cell[][];
  personal?: Cell[][];
  pmo?: Cell[][];
  /** Orden de las hojas (el libro real tiene CLIENTES, PERSONAL PMO, PERSONAL). */
  order?: ("CLIENTES" | "PERSONAL PMO" | "PERSONAL")[];
  /** Hojas a omitir. */
  omit?: ("CLIENTES" | "PERSONAL PMO" | "PERSONAL")[];
};

/** Escribe el libro sintético y devuelve su contenido (el directorio temporal se elimina). */
export async function buildBook(opts: BookOptions = {}): Promise<Buffer> {
  const dir = mkdtempSync(path.join(tmpdir(), "csapp-precarga-"));
  try {
    const file = path.join(dir, "hojas.xlsx");
    const all = {
      CLIENTES: { name: "CLIENTES", rows: [opts.clientHeader ?? CLIENT_HEADER, ...(opts.clients ?? CLIENT_ROWS)] },
      "PERSONAL PMO": { name: "PERSONAL PMO", rows: [PMO_HEADER, ...(opts.pmo ?? PMO_ROWS)] },
      PERSONAL: { name: "PERSONAL", rows: [PERSONAL_HEADER, ...(opts.personal ?? personalRows())] },
    };
    const order = opts.order ?? ["CLIENTES", "PERSONAL PMO", "PERSONAL"];
    await writeXlsx(file, { sheets: order.filter((n) => !opts.omit?.includes(n)).map((n) => all[n]) });
    return readFileSync(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
