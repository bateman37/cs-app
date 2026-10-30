/**
 * Referencias a tickets Zendesk en texto libre (PAP, bugs, Wrike): solo formatos explícitos, nunca «cualquier dígito».
 * Sin servidor ni base de datos.
 */
import { cleanText } from "./normalize";
import { zendeskHosts, zendeskUrlPattern } from "./wrike";

export type TicketRef = { id: string; raw: string; via: "URL" | "ID" | "HASH" | "LABEL" };
export type UnparsedRef = { text: string; reason: string };

/** IDs de tickets en URLs reconocidas de los hosts Zendesk configurados. Deduplica; ignora href=# y menciones. */
export function extractZendeskUrlIds(text: string, hosts: string[] = zendeskHosts()): TicketRef[] {
  const seen = new Map<string, TicketRef>();
  for (const m of text.matchAll(zendeskUrlPattern(hosts))) {
    const id = m[1].replace(/^0+(?=\d)/, "");
    if (id !== "0" && !seen.has(id)) seen.set(id, { id, raw: m[0], via: "URL" });
  }
  return [...seen.values()];
}

const SEPARATORS = /;#|[;,|\r\n]+/;

/**
 * Lista de tickets de un campo (Tickets asociados / Ticket PAP Asociado / Zendesk Ticket ID). Separadores declarados:
 * «;#», «;», «,», «|» y salto de línea. Cada segmento debe ser una URL Zendesk reconocida, «#ID», un ID de 3 a 12
 * dígitos o «ticket ID»; varios números separados solo por espacios valen únicamente si todos son IDs puros.
 * Lo demás se conserva como texto no interpretable con su motivo. Los pares se deduplican.
 */
export function parseTicketRefList(raw: string, hosts: string[] = zendeskHosts()): { refs: TicketRef[]; unparsed: UnparsedRef[] } {
  const refs = new Map<string, TicketRef>();
  const unparsed: UnparsedRef[] = [];
  const put = (id: string, rawText: string, via: TicketRef["via"]) => {
    const norm = id.replace(/^0+(?=\d)/, "");
    if (norm === "0") return;
    if (!refs.has(norm)) refs.set(norm, { id: norm, raw: cleanText(rawText), via });
  };
  for (const part of raw.split(SEPARATORS)) {
    const seg = cleanText(part);
    if (seg === "") continue;
    const urls = extractZendeskUrlIds(seg, hosts);
    if (urls.length > 0) {
      for (const u of urls) put(u.id, u.raw, "URL");
      continue;
    }
    let m = /^#?(\d{3,12})$/.exec(seg);
    if (m) {
      put(m[1], seg, seg.startsWith("#") ? "HASH" : "ID");
      continue;
    }
    m = /^(?:ticket|tkt)\s*(?:id)?\s*[:#-]?\s*#?(\d{3,12})$/i.exec(seg);
    if (m) {
      put(m[1], seg, "LABEL");
      continue;
    }
    const tokens = seg.split(" ");
    if (tokens.length > 1 && tokens.every((t) => /^#?\d{3,12}$/.test(t))) {
      for (const t of tokens) put(t.replace("#", ""), t, t.startsWith("#") ? "HASH" : "ID");
      continue;
    }
    unparsed.push({ text: seg.slice(0, 300), reason: /https?:\/\//i.test(seg) ? "URL no reconocida como ticket Zendesk" : "texto no interpretable como ID de ticket" });
  }
  return { refs: [...refs.values()], unparsed };
}
