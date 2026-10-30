/**
 * Reglas puras de Zendesk (tickets y tiempos): sin dependencias de servidor ni de base de datos.
 * Contratos: docs/importaciones/zendesk-tickets.md (ZDT) y zendesk-tiempo.md (ZTM).
 */
import { cleanText } from "./normalize";

// ---------------------------------------------------------------- Constantes de reglas

/** Fecha de corte PMO: desde esta fecha de trabajo, el tiempo de PMO viene de Wrike (ZTM 03). */
export const PMO_CUTOFF = "2025-01-01";

export const TICKET_TYPES = ["incident", "problem", "task", "question"] as const;
export const TICKET_STATUSES = ["new", "open", "pending", "hold", "solved", "closed"] as const;
/** Estados no resueltos (backlog activo); solved y closed quedan fuera y separados (ZDT 03). */
export const UNRESOLVED_STATUSES = ["new", "open", "pending", "hold"] as const;

/** Tag exacto → destino. Un ticket con PMO e IT cuenta una vez en la unión N3 (ZDT 07-08). */
export const TAG_DESTINATION: Record<string, string> = {
  team_n2: "CS_N2",
  team_n3_pmo: "PMO_N3",
  team_it: "IT_N3",
  team_plataforma: "VFS_N4",
  team_plataformavfs: "VFS_N4",
  team_plataformaarq: "ARQ_VFS_N4",
  team_plataformavsw: "VSW_N4",
};
export const DESTINATION_LABEL: Record<string, string> = {
  CS_N2: "CS N2",
  PMO_N3: "PMO N3",
  IT_N3: "IT N3",
  VFS_N4: "VFS N4",
  ARQ_VFS_N4: "Arquitectura VFS N4",
  VSW_N4: "VSW N4",
};

/** Causas exactas del «Incidente Vincle» histórico; infraestructura solo con alojamiento CLOUD (ZDT 07). */
export const INCIDENT_APP_CAUSES = [
  "incidente_configuración_plataforma",
  "incidente_customización_plataforma",
  "incidente_estándar_plataforma",
  "incidente_integración/procesos",
] as const;
export const INCIDENT_INFRA_CAUSE = "incidente_infraestructura";
/** Causa que afecta al estándar del producto (sexto numerador, solo identificación en 03). */
export const STANDARD_CAUSE = "incidente_estándar_plataforma";

/** El libro busca esta cadena, sin distinguir mayúsculas, en «Entorno y Tipología» (indicador Admin delegada). */
export const ADMIN_DELEGADA_NEEDLE = "delegada";

export const TICKET_HEADERS = [
  "ticket_id",
  "organization_id",
  "Entorno y Tipología",
  "CausaRaiz(Agr)",
  "tags",
  "fecha_creación",
  "type",
  "status",
] as const;

export const TIME_HEADERS = [
  "ticket_id",
  "user_id",
  "user_name",
  "date",
  "hour",
  "logged_hours",
  "logged_minutes",
  "Día de la semana",
  "Segmentador app time",
  "id",
  "type",
] as const;

export const ZENDESK_TICKETS_PROFILE = "zendesk-tickets";
export const ZENDESK_TIME_PROFILE = "zendesk-tiempo";
export const TICKETS_RULES = "zd-tickets-v1";
export const TIME_RULES = `zd-time-v1;corte-pmo=${PMO_CUTOFF}`;

// ---------------------------------------------------------------- Cabeceras

export type HeaderMapping<K extends string> =
  | { ok: true; index: Record<K, number>; extras: string[] }
  | { ok: false; message: string; missing: string[]; duplicated: string[] };

/** Normalización limitada: Unicode NFC, espacios (incluido NBSP) colapsados y sin distinguir mayúsculas. No quita acentos. */
export function normalizeHeader(value: string): string {
  return value
    .replace(/^﻿/, "")
    .normalize("NFC")
    .replace(/[\s ​]+/g, " ")
    .trim()
    .toLowerCase();
}

const colName = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** Localiza las cabeceras obligatorias por contenido (orden libre), detectando faltantes y duplicadas. */
export function mapHeaders<K extends string>(row: string[], required: readonly K[]): HeaderMapping<K> {
  const norm = row.map(normalizeHeader);
  const index = {} as Record<K, number>;
  const missing: string[] = [];
  const duplicated: string[] = [];
  const used = new Set<number>();
  for (const h of required) {
    const target = normalizeHeader(h);
    const hits = norm.map((n, i) => (n === target ? i : -1)).filter((i) => i >= 0);
    if (hits.length === 0) missing.push(h);
    else if (hits.length > 1) duplicated.push(`«${h}» (columnas ${hits.map(colName).join(", ")})`);
    else {
      index[h] = hits[0];
      used.add(hits[0]);
    }
  }
  if (missing.length > 0 || duplicated.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`faltan las cabeceras obligatorias: ${missing.map((m) => `«${m}»`).join(", ")}`);
    if (duplicated.length > 0) parts.push(`hay cabeceras duplicadas o ambiguas: ${duplicated.join("; ")}`);
    return { ok: false, message: parts.join("; "), missing, duplicated };
  }
  const extras = row.map((h, i) => ({ h: cleanText(h), i })).filter((x) => x.h !== "" && !used.has(x.i)).map((x) => x.h);
  return { ok: true, index, extras };
}

// ---------------------------------------------------------------- Celdas

/** Estructura mínima de una celda del lector (sin importar el módulo de servidor). */
export type CellLike = { v: string; k: string; d?: string };

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };
const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = <T>(reason: string): Parsed<T> => ({ ok: false, reason });

const isBlank = (c: CellLike | undefined) => !c || c.v.trim() === "" || c.k === "empty";
const cleanRaw = (s: string) => s.replace(/[ ​]/g, "").trim();

/**
 * Identificador exacto como texto. Admite enteros en texto o número de Excel; una notación científica solo se
 * acepta si el entero es exacto (≤15 cifras significativas). Nunca pasa por flotantes. Vacío → null.
 */
export function parseExactId(c: CellLike | undefined): Parsed<string | null> {
  if (isBlank(c)) return ok(null);
  const cell = c as CellLike;
  if (cell.k === "date") return fail("la celda tiene formato de fecha, no es un identificador");
  if (cell.k === "bool" || cell.k === "error") return fail("el valor no es un identificador");
  const s = cleanRaw(cell.v);
  if (/^\d+$/.test(s)) return ok(s);
  const dotZero = /^(\d+)\.0+$/.exec(s);
  if (dotZero) return ok(dotZero[1]);
  const exp = /^(\d+)(?:\.(\d+))?[eE]\+?(\d+)$/.exec(s);
  if (exp) {
    const frac = exp[2] ?? "";
    const digits = `${exp[1]}${frac}`.replace(/^0+(?=\d)/, "");
    const significant = digits.replace(/0+$/, "").length;
    const shift = Number(exp[3]) - frac.length;
    if (significant <= 15 && shift >= 0 && shift <= 30) return ok(`${digits}${"0".repeat(shift)}`.replace(/^0+(?=\d)/, ""));
    return fail("notación científica con posible pérdida de precisión: use el identificador completo como texto");
  }
  return fail("no es un identificador numérico");
}

/** Identificador opcional: numérico exacto cuando lo es; en otro caso, el texto tal cual (sin inventar). */
export function parseLooseId(c: CellLike | undefined): string | null {
  if (isBlank(c)) return null;
  const r = parseExactId(c);
  if (r.ok) return r.value;
  return cleanText((c as CellLike).v) || null;
}

/** Decimal exacto como texto canónico (sin ceros sobrantes). Admite notación científica pequeña; sin comas. */
export function parseDecimal(raw: string): string | null {
  const s = cleanRaw(raw);
  const m = /^([+-])?(\d+)?(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m || (m[2] === undefined && !m[3])) return null;
  const sign = m[1] === "-" ? "-" : "";
  let intPart = m[2] ?? "";
  let frac = m[3] ?? "";
  const exp = m[4] ? Number(m[4]) : 0;
  if (!Number.isFinite(exp) || Math.abs(exp) > 30) return null;
  if (exp > 0) {
    const take = frac.slice(0, exp);
    intPart += take.padEnd(exp, "0");
    frac = frac.slice(exp);
  } else if (exp < 0) {
    const pad = intPart.padStart(-exp, "0");
    frac = pad.slice(pad.length + exp) + frac;
    intPart = pad.slice(0, pad.length + exp);
  }
  intPart = intPart.replace(/^0+(?=\d)/, "") || "0";
  frac = frac.replace(/0+$/, "");
  const out = frac ? `${intPart}.${frac}` : intPart;
  return out === "0" ? "0" : `${sign}${out}`;
}

/** Número no negativo de un componente de duración. Vacío o ilegible → error; cero es válido. */
export function parseNonNegativeDecimal(c: CellLike | undefined): Parsed<string> {
  if (isBlank(c)) return fail("está vacío");
  const cell = c as CellLike;
  if (cell.k === "bool" || cell.k === "error") return fail("no es un número");
  if (cell.k === "date") return fail("tiene formato de fecha, no es un número");
  const d = parseDecimal(cell.v);
  if (d === null) return fail("no es un número válido (use punto decimal)");
  if (d.startsWith("-")) return fail("es negativo: no hay una regla aprobada para ajustes negativos");
  return ok(d);
}

function validDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const hms = (h: number, mi: number, s: number) =>
  h > 23 || mi > 59 || s > 59 ? null : `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

/**
 * Fechas de texto de formatos explícitos: AAAA-MM-DD y DD/MM/AAAA (también con guiones o puntos), siempre día primero.
 * Nunca se interpreta como mes primero. Una zona horaria (Z, +02:00) es ambigua para un día de negocio: se rechaza.
 */
export function parseDateText(raw: string): Parsed<{ date: string; time: string | null }> {
  const s = cleanRaw(raw);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  const m = iso ?? dmy;
  if (!m) return fail("formato de fecha no admitido (use AAAA-MM-DD o DD/MM/AAAA)");
  const [y, mo, d] = iso ? [Number(m[1]), Number(m[2]), Number(m[3])] : [Number(m[3]), Number(m[2]), Number(m[1])];
  const date = validDate(y, mo, d);
  if (!date) return fail("la fecha no existe en el calendario");
  let time: string | null = null;
  if (m[4] !== undefined) {
    time = hms(Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
    if (!time) return fail("la hora de la fecha no es válida");
  }
  return ok({ date, time });
}

/** Fecha de una celda: fecha de Excel (calendario 1900/1904 ya resuelto por el lector) o texto explícito. */
export function parseDateCell(c: CellLike | undefined): Parsed<{ date: string; time: string | null }> {
  if (isBlank(c)) return fail("está vacía");
  const cell = c as CellLike;
  if (cell.k === "date" && cell.d) {
    const r = parseDateText(cell.d);
    return r.ok ? r : fail("la fecha de Excel no es válida");
  }
  if (cell.k === "text") return parseDateText(cell.v);
  if (cell.k === "number") return fail("es un número sin formato de fecha: no se interpreta como fecha");
  return fail("no es una fecha");
}

/** Hora del día de un registro (no es duración): fracción de Excel, celda de hora o texto HH:MM[:SS]. */
export function parseHourCell(c: CellLike | undefined): { value: string | null; readable: boolean } {
  if (isBlank(c)) return { value: null, readable: true };
  const cell = c as CellLike;
  if (cell.k === "date" && cell.d) {
    const t = /T(\d{2}:\d{2}:\d{2})$/.exec(cell.d);
    if (t) return { value: t[1], readable: true };
    return cell.v.trim() === "0" ? { value: "00:00:00", readable: true } : { value: cleanText(cell.v), readable: false };
  }
  if (cell.k === "number") {
    const n = Number(cell.v);
    if (Number.isFinite(n) && n >= 0 && n < 1) {
      const secs = Math.round(n * 86400);
      const t = hms(Math.floor(secs / 3600) % 24, Math.floor((secs % 3600) / 60), secs % 60);
      if (t) return { value: t, readable: true };
    }
    return { value: cleanText(cell.v), readable: false };
  }
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(cleanRaw(cell.v));
  if (m) {
    const t = hms(Number(m[1]), Number(m[2]), Number(m[3] ?? 0));
    if (t) return { value: t, readable: true };
  }
  return { value: cleanText(cell.v) || null, readable: false };
}

// ---------------------------------------------------------------- Tags y clasificaciones

/** Tags como array JSON de strings: sin partir por comas ni buscar subcadenas. Devuelve el conjunto ordenado. */
export function parseTags(raw: string): Parsed<string[]> {
  const s = raw.trim();
  if (s === "") return fail("está vacío (debe ser un array JSON, por ejemplo [])");
  let v: unknown;
  try {
    v = JSON.parse(s);
  } catch {
    return fail("no es un array JSON válido");
  }
  if (!Array.isArray(v)) return fail("no es un array JSON");
  if (!v.every((x) => typeof x === "string")) return fail("el array contiene elementos que no son texto");
  return ok([...new Set(v as string[])].sort());
}

/** Destinos de escalado por tags exactos (conjunto, sin duplicados). */
export function destinationsOf(tags: readonly string[]): string[] {
  return [...new Set(tags.map((t) => TAG_DESTINATION[t]).filter((d): d is string => Boolean(d)))].sort();
}

/** Valor conocido del catálogo (sin distinguir mayúsculas), o null si es nuevo: no se convierte en otro. */
export function classifyToken(value: string | null, known: readonly string[]): string | null {
  if (value === null) return null;
  const v = value.trim().toLowerCase();
  return known.includes(v) ? v : null;
}

/** Indicador histórico Admin delegada. null = Entorno y Tipología sin informar (desconocido). */
export function adminDelegadaOf(entorno: string | null): boolean | null {
  return entorno === null ? null : entorno.toLowerCase().includes(ADMIN_DELEGADA_NEEDLE);
}

export type IncidentClass = "INCIDENTE_VINCLE" | "NO_INCIDENTE_VINCLE" | "PENDIENTE";

/** Familia de causa para el filtro Incidente Vincle; el alojamiento es el vigente a la fecha de referencia. */
export function incidentClass(cause: string | null, hosting: "CLOUD" | "OP" | null): IncidentClass {
  if (cause === null) return "PENDIENTE";
  const c = cause.toLowerCase();
  if ((INCIDENT_APP_CAUSES as readonly string[]).includes(c)) return "INCIDENTE_VINCLE";
  if (c === INCIDENT_INFRA_CAUSE) return hosting === "CLOUD" ? "INCIDENTE_VINCLE" : hosting === "OP" ? "NO_INCIDENTE_VINCLE" : "PENDIENTE";
  return "NO_INCIDENTE_VINCLE";
}

// ---------------------------------------------------------------- Tiempos: partición contable

/** Motivo principal de cada fila de tiempo (una sola partición; los demás problemas son indicadores). */
export const TIME_BUCKETS = [
  "DUPLICATE_FILE",
  "DUPLICATE_EXISTING",
  "PENDING_DECISION",
  "EXCLUDED_PMO",
  "PENDING_ELIGIBILITY",
  "NO_TICKET",
  "NO_ORGANIZATION",
  "NO_CLIENT",
  "NO_PERSON",
  "ATTRIBUTABLE",
] as const;
export type TimeBucket = (typeof TIME_BUCKETS)[number];

export const TIME_BUCKET_LABEL: Record<TimeBucket, string> = {
  DUPLICATE_FILE: "Duplicadas dentro del archivo (se materializan una vez)",
  DUPLICATE_EXISTING: "Duplicadas de lotes ya importados (se materializan una vez)",
  PENDING_DECISION: "Pendientes de decidir: posible corrección de un registro existente",
  EXCLUDED_PMO: "Excluidas por fuente: PMO desde 01/01/2025 (corresponde a Wrike)",
  PENDING_ELIGIBILITY: "Elegibilidad pendiente: PMO desconocido desde 01/01/2025",
  NO_TICKET: "Sin ticket conocido",
  NO_ORGANIZATION: "Ticket sin organización informada",
  NO_CLIENT: "Organización sin Cliente equivalente",
  NO_PERSON: "Sin persona resuelta",
  ATTRIBUTABLE: "Atribuibles a un Cliente",
};

export const TIME_BUCKET_ACTION: Record<TimeBucket, string> = {
  DUPLICATE_FILE: "Ninguna: el registro ya cuenta una vez.",
  DUPLICATE_EXISTING: "Ninguna: el registro ya estaba importado.",
  PENDING_DECISION: "Indique si es una corrección de un registro concreto o es otro trabajo (en esta ficha).",
  EXCLUDED_PMO: "Ninguna: se conserva como trazabilidad y no se suma; el tiempo PMO posterior al corte llegará de Wrike.",
  PENDING_ELIGIBILITY: "Complete la pertenencia a PMO de la persona en Personal y use Reprocesar.",
  NO_TICKET: "Cargue los tickets (Tickets Zendesk): se resolverá solo al activarlos.",
  NO_ORGANIZATION: "El ticket no informa organización: no hay Cliente que atribuir.",
  NO_CLIENT: "Añada la equivalencia de la organización a un Cliente en Maestros y use Reprocesar.",
  NO_PERSON: "Añada el ID o alias de Zendesk de la persona en Personal y use Reprocesar.",
  ATTRIBUTABLE: "Ninguna.",
};

/** Fecha de trabajo sujeta al corte PMO (ZTM 03): desde esa fecha, PMO sale de la fuente Zendesk. */
export const isAfterPmoCutoff = (workDate: string) => workDate >= PMO_CUTOFF;
