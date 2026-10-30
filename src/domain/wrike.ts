/**
 * Reglas puras del perfil Wrike (CSAPP-04): sin servidor ni base de datos.
 * Contrato: docs/importaciones/wrike.md (WRK) y docs/arquitectura/wrike-pap-bugs-csapp04.md.
 */
import { cleanText } from "./normalize";
import { PMO_CUTOFF, type CellLike, type Parsed } from "./zendesk";

export const WRIKE_PROFILE = "wrike";
export const WRIKE_RULES = `wrike-v1;corte-pmo=${PMO_CUTOFF}`;

export const WRIKE_HEADERS = ["Usuario", "Proyecto", "Nombre de la tarea", "Ticket Zendesk", "Fecha registro", "Dedicación (horas)"] as const;

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = <T>(reason: string): Parsed<T> => ({ ok: false, reason });

/** Multiplica un decimal canónico (texto) por un entero sin pasar por flotantes. */
export function mulDecimal(value: string, factor: number): string {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!m) throw new Error(`Decimal no válido: ${value}`);
  const frac = m[2] ?? "";
  const scaled = BigInt(m[1] + frac) * BigInt(factor);
  const digits = scaled.toString().padStart(frac.length + 1, "0");
  const intPart = digits.slice(0, digits.length - frac.length) || "0";
  const fracPart = digits.slice(digits.length - frac.length).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

/**
 * Horas decimales de Wrike. Admite entero, coma decimal (0,5) o punto decimal (0.5) con una sola marca.
 * No adivina: mezcla de separadores (1.234,5) o una marca con exactamente tres decimales precedida de un
 * entero que pudiera ser un millar (1,500 / 1.500) son ambiguas y se rechazan. Negativos, no.
 */
export function parseWrikeHours(raw: string): Parsed<string> {
  const s = raw.replace(/[ ​]/g, "").trim();
  if (s === "") return fail("está vacía");
  if (/^[+-]/.test(s)) return fail(s.startsWith("-") ? "es negativa: no hay una regla aprobada para ajustes negativos" : "lleva un signo no admitido");
  if (/^\d+$/.test(s)) return ok(s.replace(/^0+(?=\d)/, ""));
  const m = /^(\d+)([.,])(\d+)$/.exec(s);
  if (!m) return fail(`notación no admitida «${s}» (use enteros o decimales con una sola coma o punto)`);
  const [, int, , frac] = m;
  if (frac.length === 3 && int !== "0" && !int.startsWith("0")) {
    return fail(`«${s}» es ambigua (¿decimal o separador de millares?): use un decimal explícito`);
  }
  const intPart = int.replace(/^0+(?=\d)/, "");
  const fracPart = frac.replace(/0+$/, "");
  return ok(fracPart ? `${intPart}.${fracPart}` : intPart);
}

export type TicketField = { state: "NONE" } | { state: "VALID"; id: string } | { state: "INVALID" };

/**
 * Ticket Zendesk explícito. Vacío o cero = sin ticket. Los puntos de millares se normalizan solo aquí y con
 * gramática válida (216.527 → 216527). Cualquier otra notación es inválida: se conserva el original y no se usa.
 */
export function parseTicketField(raw: string): TicketField {
  const s = raw.replace(/[ ​]/g, "").trim();
  if (s === "" || /^0+([.,]0+)?$/.test(s)) return { state: "NONE" };
  if (/^\d+$/.test(s)) return { state: "VALID", id: s.replace(/^0+(?=\d)/, "") };
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return { state: "VALID", id: s.replace(/\./g, "").replace(/^0+(?=\d)/, "") };
  return { state: "INVALID" };
}

export type TicketCandidate = { id: string; method: "URL" | "PREFIX" | "LEADING"; evidence: string };

/** Hosts Zendesk reconocidos para URLs de tickets (configurable por CSAPP_ZENDESK_HOSTS, separados por coma). */
export function zendeskHosts(env: string | undefined = process.env.CSAPP_ZENDESK_HOSTS): string[] {
  const list = (env ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return list.length > 0 ? list : ["vincle.zendesk.com"];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Patrón de URL de ticket Zendesk (/agent/tickets/ID o /hc/idioma/requests/ID) para los hosts dados. */
export function zendeskUrlPattern(hosts: string[]): RegExp {
  return new RegExp(`https?://(?:${hosts.map(escapeRe).join("|")})(?::\\d+)?/(?:agent/tickets/|hc/[a-z]{2}(?:-[a-z]{2})?/requests/)(\\d{1,15})(?![\\d])`, "gi");
}

/** Palabras que, antes de «#NNN», indican otro tipo de identificador (bug, work item...), nunca un ticket. */
const NON_TICKET_WORDS = new Set(["bug", "bugs", "pbi", "wi", "workitem", "task", "tarea", "issue", "pr", "us", "hu", "defect", "defecto", "devops", "azure", "jira", "id", "cal", "pap", "mr", "pull", "request", "feature", "story", "epic", "incidencia", "version", "versión", "v", "build", "release", "rev", "revision"]);

/**
 * Candidatos de ticket en el nombre de la tarea, solo con contexto inequívoco:
 *  - URL Zendesk de los hosts configurados;
 *  - prefijo «ticket/tkt/zendesk/zd» seguido del número, o «#NNN» no precedido de bug/pbi/work item...;
 *  - un ID inicial delimitado de 5 a 9 dígitos que no sea una fecha ni parte de una versión.
 * Devuelve los IDs distintos, cada uno con su método y evidencia. Nunca elige entre varios.
 */
export function extractTicketCandidates(name: string, hosts: string[] = zendeskHosts()): TicketCandidate[] {
  const found = new Map<string, TicketCandidate>();
  const add = (id: string, method: TicketCandidate["method"], evidence: string) => {
    const norm = id.replace(/^0+(?=\d)/, "");
    if (norm !== "0" && !found.has(norm)) found.set(norm, { id: norm, method, evidence: cleanText(evidence).slice(0, 200) });
  };
  const text = name.replace(/[ ​]/g, " ");

  for (const m of text.matchAll(zendeskUrlPattern(hosts))) add(m[1], "URL", m[0]);

  for (const m of text.matchAll(/\b(?:ticket|tkt|zendesk|zd)\s*(?:id)?\s*[:#-]?\s*#?\s*(\d{3,12})\b(?![./-]\d)/gi)) add(m[1], "PREFIX", m[0]);

  for (const m of text.matchAll(/(?:^|[^\w#&])#(\d{3,12})\b(?![./-]\d)/g)) {
    const before = text.slice(0, (m.index ?? 0) + (m[0].startsWith("#") ? 0 : 1));
    const words = before.toLowerCase().match(/([\p{L}\p{N}]+)\W*$/u);
    const prev = words?.[1] ?? "";
    const prev2 = /([\p{L}\p{N}]+)\W+[\p{L}\p{N}]+\W*$/u.exec(before.toLowerCase())?.[1] ?? "";
    if (NON_TICKET_WORDS.has(prev) || (prev === "id" && NON_TICKET_WORDS.has(prev2))) continue;
    add(m[1], "PREFIX", m[0].trim());
  }

  const lead = /^\s*(\d{5,9})(?=\s*(?:$|[\s:)\]\-–—,;]))/.exec(text);
  if (lead) {
    const after = text.slice(lead[0].length);
    const id = lead[1];
    const isCompactDate = /^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/.test(id);
    if (!isCompactDate && !/^-\d/.test(after)) add(id, "LEADING", lead[0]);
  }
  return [...found.values()];
}

export type TicketRefState = "EXPLICIT" | "NAME" | "AMBIGUOUS" | "EXPLICIT_INVALID" | "NONE";

/**
 * Prioridad de ticket (WRK 04): campo explícito válido; solo si falta o es cero, el único candidato inequívoco
 * del nombre; varios candidatos no se resuelven (ni el primero ni el mayor). No consulta el catálogo: ese
 * paso (confirmado/pendiente) lo hace la derivación contra los tickets cargados.
 */
export function resolveTicketRef(field: TicketField, candidates: TicketCandidate[]): { state: TicketRefState; ticketId: string | null; contradiction: boolean } {
  if (field.state === "VALID") {
    return { state: "EXPLICIT", ticketId: field.id, contradiction: candidates.some((c) => c.id !== field.id) };
  }
  if (field.state === "INVALID") return { state: "EXPLICIT_INVALID", ticketId: null, contradiction: false };
  if (candidates.length === 1) return { state: "NAME", ticketId: candidates[0].id, contradiction: false };
  if (candidates.length > 1) return { state: "AMBIGUOUS", ticketId: null, contradiction: false };
  return { state: "NONE", ticketId: null, contradiction: false };
}

/** Una fila sin usuario, sin fecha y con dedicación cero es una tarea sin imputación (WRK 03). */
export function isUnimputedTask(user: string | null, dateRaw: string, hours: string | null): boolean {
  return user === null && dateRaw.trim() === "" && hours !== null && Number(hours) === 0;
}

export const cell = (c: CellLike | undefined) => cleanText(c?.v ?? "");

// ---------------------------------------------------------------- Partición contable de Wrike

export const WRIKE_BUCKETS = [
  "DUPLICATE_FILE",
  "DUPLICATE_EXISTING",
  "PENDING_DECISION",
  "BEFORE_CUTOFF",
  "NOT_PMO",
  "PENDING_ELIGIBILITY",
  "SCOPE_CONFLICT",
  "NO_SCOPE",
  "GROUP_ONLY",
  "CLIENT",
] as const;
export type WrikeBucket = (typeof WRIKE_BUCKETS)[number];

export const WRIKE_BUCKET_LABEL: Record<WrikeBucket, string> = {
  DUPLICATE_FILE: "Duplicadas dentro del archivo (se materializan una vez)",
  DUPLICATE_EXISTING: "Duplicadas de lotes ya importados (se materializan una vez)",
  PENDING_DECISION: "Pendientes de decidir: corrección propuesta de un registro existente",
  BEFORE_CUTOFF: "Anteriores al 01/01/2025: no sustituyen el histórico Zendesk (conservadas)",
  NOT_PMO: "Desde 01/01/2025, persona no PMO: fuera del tiempo PMO elegible (conservadas)",
  PENDING_ELIGIBILITY: "Elegibilidad pendiente: persona o pertenencia PMO desconocida desde 01/01/2025",
  SCOPE_CONFLICT: "Elegibles con conflicto entre ticket y proyecto (se conserva el conflicto)",
  NO_SCOPE: "Elegibles sin Grupo ni Cliente identificado",
  GROUP_ONLY: "Elegibles atribuidas solo al Grupo Cliente",
  CLIENT: "Elegibles atribuidas a un Cliente",
};

export const WRIKE_BUCKET_ACTION: Record<WrikeBucket, string> = {
  DUPLICATE_FILE: "Ninguna: el registro ya cuenta una vez.",
  DUPLICATE_EXISTING: "Ninguna: el registro ya estaba importado.",
  PENDING_DECISION: "Decida en esta ficha si corrige un registro concreto o es otro trabajo.",
  BEFORE_CUTOFF: "Ninguna: el histórico anterior a 2025 viene de Zendesk.",
  NOT_PMO: "Ninguna: no es tiempo PMO elegible desde 2025.",
  PENDING_ELIGIBILITY: "Añada el alias/ID de Wrike de la persona y su pertenencia a PMO en Personal y use Reprocesar.",
  SCOPE_CONFLICT: "Revise la equivalencia del proyecto o el ticket; las horas se conservan sin elegir cliente.",
  NO_SCOPE: "Añada la equivalencia del proyecto Wrike en Maestros (o cargue el ticket) y use Reprocesar.",
  GROUP_ONLY: "Ninguna: la dedicación de grupo no se reparte entre Clientes sin evidencia.",
  CLIENT: "Ninguna.",
};

export const WRIKE_FLAG_LABEL: Record<string, string> = {
  NO_TICKET: "Sin ticket",
  TICKET_PENDING: "Ticket citado todavía no cargado (referencia pendiente)",
  TICKET_AMBIGUOUS: "Varios candidatos de ticket en el nombre: ninguno elegido",
  TICKET_BY_NAME: "Ticket extraído del nombre (inferido)",
  TICKET_EXPLICIT_INVALID: "Ticket explícito con notación no válida (conservado, sin usar)",
  NAME_CONTRADICTS_EXPLICIT: "El nombre cita otro ticket distinto del campo explícito (prevalece el campo)",
  NO_PERSON: "Usuario sin persona resuelta",
  NO_ROLE: "Sin rol PMO (ANA/DEV) informado",
  NO_PROJECT: "Proyecto sin equivalencia",
  CAUSE_UNCLASSIFIED: "Causa no clasificada (sin ticket confirmado o sin causa)",
  INTERNAL: "Cliente interno",
  NO_GROUP: "Cliente sin Grupo Cliente",
};
