/**
 * Reglas puras del perfil PAP (CSAPP-04). Contrato: docs/importaciones/pap.md (PAP) y
 * docs/arquitectura/wrike-pap-bugs-csapp04.md.
 */
import { cleanText } from "./normalize";
import type { UnparsedRef } from "./refs";

export const PAP_PROFILE = "pap";
export const PAP_RULES = "pap-v1";

/** Las 29 cabeceras A–AC, por contenido y en cualquier orden. */
export const PAP_HEADERS = [
  "Fecha de Solicitud",
  "Title",
  "Proyecto",
  "Resultado",
  "Responsable Técnico",
  "Project Manager",
  "Fecha puesta en producción",
  "Hora",
  "Duración",
  "Plataforma",
  "Tipología",
  "Changelog",
  "Urgente",
  "Versión del remoto",
  "Tareas Asociadas al CS",
  "Afectaciones al servicio",
  "¿Requiere formación?",
  "Tickets asociados",
  "CAL's asociados",
  "¿Notificar a Key Account?",
  "Key Account",
  "Seguidores del ticket",
  "Ticket PAP Asociado",
  "Causa raíz",
  "Workaround",
  "Nº de BUG",
  "Motivo incidente",
  "Tipo de elemento",
  "Ruta de acceso",
] as const;

/** Identidad: «ID número:» o «número:» al inicio del título (sin distinguir mayúsculas, tras recortar). */
const TITLE_ID = /^(?:ID\s+)?([0-9]+)\s*:/i;

export function parsePapTitle(title: string): { id: string; rest: string } | null {
  const t = title.replace(/[ ​]/g, " ").trim();
  const m = TITLE_ID.exec(t);
  if (!m) return null;
  const id = m[1].replace(/^0+(?=\d)/, "") || "0";
  return { id, rest: cleanText(t.slice(m[0].length)) };
}

export type CauseCategory = "CORRECTIVE" | "EVOLUTIVE" | "MAINTENANCE" | "OTHER";
export type CorrectiveOrigin = "STANDARD" | "CUSTOMIZATION" | "CONFIG_DATA" | "PROCESSES" | "INFRASTRUCTURE" | "CLIENT_ORIGIN" | "OTHER_CORRECTIVE";

export type Cause = { raw: string; normalized: string; category: CauseCategory; origin: CorrectiveOrigin | null };

export const normalizeToken = (s: string) => cleanText(s).normalize("NFC").toLowerCase();

/**
 * Familia de una causa por palabra clave (no por lista cerrada de etiquetas): cualquier «Correctivo …» es correctivo,
 * también uno nuevo. Una etiqueta desconocida queda OTHER (se conserva y se muestra, no se interpreta como no correctiva).
 */
export function classifyCause(normalized: string): { category: CauseCategory; origin: CorrectiveOrigin | null } {
  if (/\bcorrectiv/.test(normalized)) {
    let origin: CorrectiveOrigin = "OTHER_CORRECTIVE";
    if (/cliente|uso indebido/.test(normalized)) origin = "CLIENT_ORIGIN";
    else if (/est[aá]ndar|standard/.test(normalized)) origin = "STANDARD";
    else if (/personaliz|customiz/.test(normalized)) origin = "CUSTOMIZATION";
    else if (/configuraci|datos/.test(normalized)) origin = "CONFIG_DATA";
    else if (/proceso|integraci/.test(normalized)) origin = "PROCESSES";
    else if (/infraestructura/.test(normalized)) origin = "INFRASTRUCTURE";
    return { category: "CORRECTIVE", origin };
  }
  if (/\bevolutiv/.test(normalized)) return { category: "EVOLUTIVE", origin: null };
  if (/\bmantenimiento/.test(normalized)) return { category: "MAINTENANCE", origin: null };
  return { category: "OTHER", origin: null };
}

/** Multiselección separada por «;#»: conserva los tokens originales y su normalización; el orden no duplica. */
export function parseCauses(raw: string): Cause[] {
  const out = new Map<string, Cause>();
  for (const part of raw.split(";#")) {
    const token = cleanText(part);
    if (token === "") continue;
    const normalized = normalizeToken(token);
    if (!out.has(normalized)) out.set(normalized, { raw: token, normalized, ...classifyCause(normalized) });
  }
  return [...out.values()].sort((a, b) => (a.normalized < b.normalized ? -1 : 1));
}

/** Correctivo si cualquier causa lo es; sin causas informadas es desconocido (no «no correctivo» confirmado). */
export function correctiveState(causes: Cause[]): "CORRECTIVE" | "NON_CORRECTIVE" | "UNKNOWN" {
  if (causes.length === 0) return "UNKNOWN";
  if (causes.some((c) => c.category === "CORRECTIVE")) return "CORRECTIVE";
  if (causes.every((c) => c.category !== "OTHER")) return "NON_CORRECTIVE";
  return "UNKNOWN";
}

export type BugRef = { id: string; product: "VFS" | "VSW" | null; raw: string; reason: string | null };

/** Producto de una URL de DevOps según CSAPP_DEVOPS_PRODUCTS («VFS=ProyectoA,ProyectoB;VSW=ProyectoC»). Sin configuración, ninguno. */
export function devopsProductMap(env: string | undefined = process.env.CSAPP_DEVOPS_PRODUCTS): { product: "VFS" | "VSW"; projects: string[] }[] {
  const out: { product: "VFS" | "VSW"; projects: string[] }[] = [];
  for (const part of (env ?? "").split(";")) {
    const [k, v] = part.split("=");
    const product = k?.trim().toUpperCase();
    if ((product === "VFS" || product === "VSW") && v) out.push({ product, projects: v.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean) });
  }
  return out;
}

/**
 * Nº de BUG: conserva el texto y propone una referencia a Work Item solo cuando ID y producto son explícitos
 * («VFS 123», «VSW-123», URL de DevOps de un proyecto configurado). Un número suelto, o una URL de un proyecto sin
 * producto configurado, queda pendiente con su motivo: un número coincidente en VFS y VSW no decide el producto y
 * tampoco se deduce por tener cargada una sola fuente.
 */
export function parseBugRefs(raw: string, map = devopsProductMap()): { refs: BugRef[]; unparsed: UnparsedRef[] } {
  const refs = new Map<string, BugRef>();
  const unparsed: UnparsedRef[] = [];
  for (const part of raw.split(/;#|[;,|\r\n]+/)) {
    const seg = cleanText(part);
    if (seg === "") continue;
    const url = /^https?:\/\/(?:dev\.azure\.com\/[^/]+|[^/]+\.visualstudio\.com)\/([^/]+)\/(?:[^/]+\/)?_workitems\/edit\/(\d{1,12})/i.exec(seg);
    let ref: BugRef | null = null;
    if (url) {
      const project = decodeURIComponent(url[1]).toLowerCase();
      const hit = map.find((m) => m.projects.includes(project));
      ref = { id: url[2], product: hit?.product ?? null, raw: seg, reason: hit ? null : "producto sin determinar: el proyecto de la URL no está configurado" };
    } else {
      const prefixed = /^(VFS|VSW)\s*[-#:]?\s*#?(\d{1,12})$/i.exec(seg);
      const bare = /^#?(\d{1,12})$/.exec(seg);
      if (prefixed) ref = { id: prefixed[2], product: prefixed[1].toUpperCase() as "VFS" | "VSW", raw: seg, reason: null };
      else if (bare) ref = { id: bare[1], product: null, raw: seg, reason: "producto sin determinar: un número suelto no identifica VFS o VSW" };
    }
    if (!ref) {
      unparsed.push({ text: seg.slice(0, 300), reason: "texto no interpretable como Work Item" });
      continue;
    }
    ref.id = ref.id.replace(/^0+(?=\d)/, "") || "0";
    refs.set(`${ref.product ?? "?"}|${ref.id}`, ref);
  }
  return { refs: [...refs.values()], unparsed };
}
