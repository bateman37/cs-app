/** Estados de enlace de la tabla de trabajo de Clientes y Grupos (HOTFIX-03 §4): sin dependencias de servidor, utilizables desde componentes cliente. */
export const LINK_SYSTEMS = ["WRIKE", "ZENDESK", "PAP", "SUPPORT", "HOSTING"] as const;
export type LinkSystem = (typeof LINK_SYSTEMS)[number];
export const LINK_LABEL: Record<LinkSystem, string> = { WRIKE: "Wrike", ZENDESK: "Zendesk", PAP: "PAP", SUPPORT: "Soporte", HOSTING: "Servidor" };
export type LinkState = "CONFIGURED" | "MISSING" | "NOT_APPLICABLE" | "CONFLICT";
export const LINK_STATE_LABEL: Record<LinkState, string> = { CONFIGURED: "Configurado", MISSING: "Sin informar", NOT_APPLICABLE: "No aplica", CONFLICT: "En conflicto" };
