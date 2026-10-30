/**
 * Reglas puras de los perfiles de bugs de producto VFS y VSW (CSAPP-04). Contrato: docs/importaciones/bugs-producto.md (BUG).
 */
import { cleanText } from "./normalize";
import type { Parsed } from "./zendesk";

export const BUG_PROFILES = { VFS: "bugs-vfs", VSW: "bugs-vsw" } as const;
export type BugProduct = keyof typeof BUG_PROFILES;
export const BUG_RULES = "bugs-v1";

export const VFS_HEADERS = ["Work Item Type", "ID", "Title", "Created By", "Created Date", "Assigned To", "State", "Area Path", "Tags", "Comment Count", "Changed Date", "Reported by", "Zendesk Ticket ID"] as const;
export const VSW_HEADERS = ["ID", "Work Item Type", "Title", "Assigned To", "State", "Tags", "Created By", "Created Date", "Zendesk Ticket ID", "Clients"] as const;
/** Mínimo común que exige cualquier perfil de bugs; el resto de campos se conservan si existen. */
export const BUG_REQUIRED = { VFS: ["Work Item Type", "ID", "Title", "State", "Created Date"], VSW: ["ID", "Work Item Type", "Title", "State", "Created Date"] } as const;

/** Solo Work Item Type = Bug_ participa en defectos; Request o Enhancement con «BUG» en el título no. */
export const isBugType = (type: string) => cleanText(type).toLowerCase() === "bug_";

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = <T>(reason: string): Parsed<T> => ({ ok: false, reason });

/**
 * Fecha/hora local de DevOps «d/M/yyyy HH:mm:ss» (la hora puede tener una cifra; los segundos son opcionales). El valor no
 * lleva zona: se conserva la hora local como texto AAAA-MM-DDTHH:mm:ss, sin inventar un instante UTC.
 */
export function parseLocalDateTime(raw: string): Parsed<{ local: string; date: string }> {
  const s = raw.replace(/[ ​]/g, " ").trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!m) return fail("formato no admitido (use d/M/aaaa HH:mm:ss)");
  const [d, mo, y, h, mi, se] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return fail("la fecha no existe en el calendario");
  if (h > 23 || mi > 59 || se > 59) return fail("la hora no es válida");
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const date = `${p(y, 4)}-${p(mo)}-${p(d)}`;
  return ok({ date, local: `${date}T${p(h)}:${p(mi)}:${p(se)}` });
}

/** Etapas de estado conocidas; un estado nuevo requiere revisión y nunca se clasifica por parecido (ni «Done…» como cerrado). */
export const STATE_CATALOG: Record<string, { category: string; label: string }> = {
  new: { category: "NEW", label: "New" },
  selected: { category: "SELECTED", label: "Selected" },
  "in progress": { category: "IN_PROGRESS", label: "In Progress" },
  blocked: { category: "BLOCKED", label: "Blocked" },
  pr: { category: "PR_PENDING", label: "PR: desarrollo terminado en su rama, pendiente de crear la pull request" },
  "done (ready for release)": { category: "READY_FOR_RELEASE", label: "Done (Ready for Release): pendiente de entrega; no acredita despliegue al cliente" },
};

/** Estados terminales explícitos: solo los configurados (CSAPP_BUG_TERMINAL_STATES, separados por «;»). Por defecto, ninguno. */
export function terminalStates(env: string | undefined = process.env.CSAPP_BUG_TERMINAL_STATES): string[] {
  return (env ?? "").split(";").map((s) => cleanText(s).toLowerCase()).filter(Boolean);
}

export function classifyState(state: string, terminal = terminalStates()): { category: string; known: boolean } {
  const s = cleanText(state).toLowerCase();
  if (STATE_CATALOG[s]) return { category: STATE_CATALOG[s].category, known: true };
  if (terminal.includes(s)) return { category: "TERMINAL", known: true };
  return { category: "PENDING_REVIEW", known: false };
}

/** Etiquetas de DevOps separadas por «;»: conjunto ordenado, sin duplicados. */
export function parseTags(raw: string): string[] {
  return [...new Set(raw.split(";").map(cleanText).filter(Boolean))].sort();
}

export const VIEW_KINDS = [
  { value: "ABIERTOS", label: "Solo elementos abiertos" },
  { value: "INTERVALO", label: "Vista por intervalo de fechas" },
  { value: "AMPLIA", label: "Vista amplia (abiertos y cerrados)" },
  { value: "OTRA", label: "Otra (indicar en cobertura)" },
] as const;
export const VIEW_LABEL: Record<string, string> = Object.fromEntries(VIEW_KINDS.map((v) => [v.value, v.label]));

/** Estados de un vínculo Work Item–ticket. */
export const LINK_STATE_LABEL: Record<string, string> = {
  PENDING_TICKET: "Ticket todavía no cargado (referencia pendiente)",
  CENTRAL_INTERNAL: "Ticket central interno (no identifica a los clientes afectados)",
  RESOLVED_EXTERNAL: "Ticket de Cliente resuelto",
  NO_CLIENT: "Ticket sin Cliente resuelto",
};
