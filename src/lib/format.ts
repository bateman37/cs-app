const dateTime = new Intl.DateTimeFormat("es-ES", {
  timeZone: "Europe/Madrid",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(d: Date): string {
  return dateTime.format(d);
}

export type SearchParams = Record<string, string | string[] | undefined>;

export function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Construye una cadena de consulta omitiendo valores vacíos. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v) !== "") u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

/** Filtros de lista que se conservan al abrir una ficha y volver. */
export function sanitizeBack(volver: string, allowed: string[]): string {
  const incoming = new URLSearchParams(volver);
  const out = new URLSearchParams();
  for (const k of allowed) {
    const v = incoming.get(k);
    if (v) out.set(k, v);
  }
  return out.toString();
}
