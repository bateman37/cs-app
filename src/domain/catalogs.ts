export const SUPPORT_VALUES = ["GOLD", "PLATINUM", "SILVER_ON_DEMAND", "SILVER_RECURRENTE"] as const;
export const HOSTING_VALUES = ["CLOUD", "OP"] as const;
export const COMPLEXITY_VALUES = ["BASIC", "MEDIUM", "ENTERPRISE"] as const;

export const ATTRIBUTES = ["SUPPORT", "HOSTING", "COMPLEXITY", "PRODUCT"] as const;
export type Attribute = (typeof ATTRIBUTES)[number];

export const ATTRIBUTE_LABEL: Record<Attribute, string> = {
  SUPPORT: "Soporte",
  HOSTING: "Servidor",
  COMPLEXITY: "Complejidad",
  PRODUCT: "Producto",
};

export const VALUE_LABEL: Record<string, string> = {
  GOLD: "Gold",
  PLATINUM: "Platinum",
  SILVER_ON_DEMAND: "Silver On Demand",
  SILVER_RECURRENTE: "Silver Recurrente",
  CLOUD: "CLOUD",
  OP: "OP",
  BASIC: "Basic",
  MEDIUM: "Medium",
  ENTERPRISE: "Enterprise",
};

/** Valores permitidos de cada atributo; PRODUCT sale del catálogo de productos. */
export const FIXED_VALUES: Record<Exclude<Attribute, "PRODUCT">, readonly string[]> = {
  SUPPORT: SUPPORT_VALUES,
  HOSTING: HOSTING_VALUES,
  COMPLEXITY: COMPLEXITY_VALUES,
};

export const SYSTEMS = ["BC", "ZENDESK", "WRIKE", "PAP"] as const;
export type System = (typeof SYSTEMS)[number];
export const SYSTEM_LABEL: Record<System, string> = {
  BC: "BC",
  ZENDESK: "Zendesk",
  WRIKE: "Wrike",
  PAP: "PAP",
};

export const KINDS = ["GROUP_KEY", "ORG_ID", "ORG_NAME", "PROJECT_ID", "PROJECT_NAME"] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABEL: Record<Kind, string> = {
  GROUP_KEY: "Denominación / clave del grupo",
  ORG_ID: "ID de organización",
  ORG_NAME: "Nombre de organización",
  PROJECT_ID: "ID de proyecto",
  PROJECT_NAME: "Nombre de proyecto",
};

export type TargetType = "group" | "client" | "implementation";

/** Tipos y destinos válidos por sistema (mismo contrato que el CHECK de la base). */
export const SYSTEM_RULES: Record<System, { kinds: readonly Kind[]; targets: readonly TargetType[] }> = {
  BC: { kinds: ["GROUP_KEY"], targets: ["group"] },
  ZENDESK: { kinds: ["ORG_ID", "ORG_NAME"], targets: ["client"] },
  WRIKE: { kinds: ["PROJECT_ID", "PROJECT_NAME"], targets: ["client", "implementation"] },
  PAP: { kinds: ["ORG_ID", "ORG_NAME", "PROJECT_ID", "PROJECT_NAME"], targets: ["client", "implementation"] },
};

export const MILESTONE_TYPES = ["START", "CLOUD_MIGRATION", "MAJOR_VERSION"] as const;
export type MilestoneTypeValue = (typeof MILESTONE_TYPES)[number];
export const MILESTONE_LABEL: Record<MilestoneTypeValue, string> = {
  START: "Arranque",
  CLOUD_MIGRATION: "Migración cloud",
  MAJOR_VERSION: "Cambio mayor de versión",
};

export const TARGET_LABEL: Record<TargetType, string> = {
  group: "Grupo Cliente",
  client: "Cliente",
  implementation: "Implantación",
};

/** Opciones de valor de un dato de servicio; el catálogo de productos se pasa aparte. */
export function valueOptions(attribute: Attribute, products: string[]) {
  return attribute === "PRODUCT"
    ? products.map((p) => ({ value: p, label: p }))
    : FIXED_VALUES[attribute].map((v) => ({ value: v, label: VALUE_LABEL[v] ?? v }));
}
