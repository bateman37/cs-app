/**
 * Rutas de Clientes (HOTFIX-04 §9). El editor canónico es `/administracion/clientes`; las listas anteriores (`/grupos`, `/clientes`) y sus parámetros
 * se traducen a él. Función pura (sin servidor): la usan las redirecciones, los «Volver» de las fichas y las pruebas.
 */
export const EDITOR_HREF = "/administracion/clientes";

export type LegacyParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim();

/** Estado de la lista antigua (`status`: active|inactive|all) → `estado` del editor (activos|inactivos|todos). Activos es el predeterminado y no se escribe. */
const ESTADO: Record<string, string> = { inactive: "inactivos", all: "todos" };

/**
 * Traduce los parámetros soportados de las listas antiguas: q→q, status→estado, groupId→grupo (Clientes), pending=1→pendientes=1.
 * Se ignoran sort/dir/page/internal (el editor es una sola tabla). Nunca devuelve parámetros desconocidos: no hay bucle ni reflexión de entrada ajena.
 */
export function translateLegacyParams(raw: LegacyParams): string {
  const u = new URLSearchParams();
  const q = one(raw.q).slice(0, 100);
  if (q) u.set("q", q);
  const estado = ESTADO[one(raw.status)];
  if (estado) u.set("estado", estado);
  const grupo = one(raw.groupId) || one(raw.grupo);
  if (grupo && grupo !== "none") u.set("grupo", grupo.slice(0, 100));
  if (one(raw.pending) === "1" || one(raw.pendientes) === "1") u.set("pendientes", "1");
  const nuevo = one(raw.nuevo);
  if (nuevo === "grupo" || nuevo === "cliente") u.set("nuevo", nuevo);
  const s = u.toString();
  return s ? `?${s}` : "";
}

export const editorHref = (raw: LegacyParams = {}) => `${EDITOR_HREF}${translateLegacyParams(raw)}`;
