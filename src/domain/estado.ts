/**
 * Estado comercial ACTUAL de Grupos y Clientes como filtro común (HOTFIX-03 §7). No es un borrado ni un estado histórico deducido de fechas de actividad:
 * reutiliza `isActive` de Grupo y Cliente. Semántica única:
 *  - Cliente activo efectivo: su propio estado activo Y su Grupo no desactivado (sin Grupo, solo su propio estado).
 *  - Grupo activo efectivo: Grupo no desactivado Y al menos un Cliente externo activo; o, sin Clientes externos, su estado propio. Con todos sus Clientes
 *    externos inactivos el Grupo es inactivo para las listas (conserva su estado explícito).
 *  - Un Grupo con hijos activos e inactivos figura en «Activos»; sus cifras económicas siguen siendo las del Grupo COMPLETO.
 */
export const ESTADO_VALUES = ["activos", "inactivos", "todos"] as const;
export type Estado = (typeof ESTADO_VALUES)[number];
export const DEFAULT_ESTADO: Estado = "activos";
export const ESTADO_LABEL: Record<Estado, string> = { activos: "Activos", inactivos: "Inactivos", todos: "Todos" };

/** Valor no válido o ausente → predeterminado (Activos). */
export function parseEstado(raw: string | string[] | undefined): Estado {
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase() ?? "";
  return (ESTADO_VALUES as readonly string[]).includes(v) ? (v as Estado) : DEFAULT_ESTADO;
}

export const clientEffectiveActive = (client: { isActive: boolean }, group: { isActive: boolean } | null): boolean => client.isActive && (group === null || group.isActive);

/** `externalClients`: solo los Clientes externos (no internos) del Grupo. */
export function groupEffectiveActive(group: { isActive: boolean }, externalClients: readonly { isActive: boolean }[]): boolean {
  if (!group.isActive) return false;
  return externalClients.length === 0 ? true : externalClients.some((c) => c.isActive);
}

export const matchesEstado = (effectiveActive: boolean, estado: Estado): boolean => estado === "todos" || (estado === "activos") === effectiveActive;
