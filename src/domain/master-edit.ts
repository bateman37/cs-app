import { z } from "zod";
import { LINK_SYSTEMS } from "./master-links";

/**
 * Contrato del editor de la tabla de Clientes (HOTFIX-04 §4–5). Sin dependencias de servidor de datos: lo usan el componente cliente (borrador) y el servicio.
 * Un cambio describe el ESTADO DESEADO de un campo canónico con el valor base que el usuario vio (`before`): el servidor lo compara con la base de datos y localiza
 * el conflicto en la celda si otra persona lo cambió. Un campo compartido (p. ej. el nombre del Grupo en varias filas) es UN solo cambio.
 */
export const SUPPORT_OPTIONS = [["GOLD", "Gold"], ["PLATINUM", "Platinum"], ["SILVER_RECURRENTE", "Silver Recurrente"], ["SILVER_ON_DEMAND", "Silver On Demand"]] as const;
export const HOSTING_OPTIONS = [["CLOUD", "CLOUD"], ["OP", "OP"]] as const;
export const COMPLEXITY_OPTIONS = [["BASIC", "Basic"], ["MEDIUM", "Medium"], ["ENTERPRISE", "Enterprise"]] as const;
export const TERM_OPTIONS = { SUPPORT: SUPPORT_OPTIONS, HOSTING: HOSTING_OPTIONS, COMPLEXITY: COMPLEXITY_OPTIONS } as const;
export const TERM_LABEL = { SUPPORT: "Nivel de Servicio", HOSTING: "Servidor", COMPLEXITY: "Tipo (complejidad)" } as const;
export type TermAttr = keyof typeof TERM_OPTIONS;
export const termValueLabel = (a: TermAttr, v: string | null) => (v ? (TERM_OPTIONS[a].find(([k]) => k === v)?.[1] ?? v) : "Sin informar");

export const ALIAS_SYSTEMS = ["WRIKE", "PAP", "ZENDESK_ID"] as const;
export type AliasSystem = (typeof ALIAS_SYSTEMS)[number];
export const ALIAS_LABEL: Record<AliasSystem, string> = { WRIKE: "Wrike", PAP: "PAP", ZENDESK_ID: "ID de organización Zendesk" };

const id = z.string().min(1).max(100);
const entity = z.enum(["group", "client"]);
const text = z.string().max(400);

export const changeSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("name"), entity, id, before: text, after: text }),
  z.object({ op: z.literal("active"), entity, id, before: z.boolean(), after: z.boolean() }),
  z.object({ op: z.literal("aliases"), scope: entity, id, system: z.enum(ALIAS_SYSTEMS), before: z.array(text).max(50), after: z.array(text).max(50) }),
  z.object({ op: z.literal("term"), scope: entity, id, attribute: z.enum(["SUPPORT", "HOSTING", "COMPLEXITY"]), before: z.string().max(40).nullable(), after: z.string().max(40) }),
  z.object({ op: z.literal("na"), scope: entity, id, system: z.enum(LINK_SYSTEMS), before: z.boolean(), after: z.boolean() }),
  z.object({ op: z.literal("newGroup"), tempId: id, name: text, bcDenomination: text.nullable(), active: z.boolean() }),
  z.object({
    op: z.literal("newClient"), tempId: id, group: z.object({ id: z.string().max(100).optional(), tempId: z.string().max(100).optional() }),
    name: text, zdId: text, support: z.string().max(40), hosting: z.string().max(40), complexity: z.string().max(40), wrike: z.array(text).max(50), pap: z.array(text).max(50),
  }),
]);
export type EditChange = z.infer<typeof changeSchema>;

export const editInputSchema = z.object({
  operationId: z.string().min(8).max(80),
  changes: z.array(changeSchema).min(1, "No hay cambios que guardar.").max(500),
  /** Huella del borrador que se revisó en la confirmación (la devuelve la vista previa). */
  digest: z.string().max(100).optional(),
});
export type EditInput = z.infer<typeof editInputSchema>;

/** Clave canónica del campo que modifica un cambio (también la de sus errores): la misma para todas las filas que lo muestran. */
export function changeKey(c: EditChange): string {
  switch (c.op) {
    case "name": return `${c.entity === "group" ? "g" : "c"}:${c.id}:name`;
    case "active": return `${c.entity === "group" ? "g" : "c"}:${c.id}:active`;
    case "aliases": return `${c.scope === "group" ? "g" : "c"}:${c.id}:${c.system}`;
    case "term": return `${c.scope === "group" ? "g" : "c"}:${c.id}:${c.attribute}`;
    case "na": return `${c.scope === "group" ? "g" : "c"}:${c.id}:NA:${c.system}`;
    case "newGroup": return `new:${c.tempId}`;
    case "newClient": return `new:${c.tempId}`;
  }
}

export type EditItem = {
  key: string;
  /** Entidad y ámbito: «Cliente «X» (Grupo «Y»)». */
  entity: string;
  field: string;
  before: string;
  after: string;
  /** Efectos secundarios que el usuario debe ver antes de confirmar (claves cerradas, hechos que conservan su atribución, claves conservadas…). */
  notes: string[];
};
export type EditError = { key: string; message: string; kind: "VALIDATION" | "CONFLICT" };
export type EditResult = {
  ok: boolean;
  digest: string;
  items: EditItem[];
  errors: EditError[];
  /** tempId → ID real, solo tras guardar. */
  created: Record<string, { id: string; kind: "group" | "client" }>;
  alreadyApplied?: boolean;
};

export const digitsOnly = (v: string) => /^\d{1,30}$/.test(v);
