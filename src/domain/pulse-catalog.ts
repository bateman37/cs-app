/**
 * Catálogo explícito de métricas de Pulse Rent y configuración tipada (CSAPP-07 §4, §7, §8). IDs estables; nada de fórmulas introducidas
 * por el administrador ni dependencia de etiquetas de pantalla. Reglas: docs/producto/pulse-rent.md (PUL 01-05), docs/calculos/catalogo.md.
 */
import { z } from "zod";
import type { Direction, Normalization } from "./pulse-stats";

// ---------------------------------------------------------------- Perfiles canónicos

export const PROFILE_KEYS = ["CS_N1", "CS_N2", "PMO_N3", "IT_N3", "PLATAFORMA_N4"] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];
export const PROFILE_LABEL: Record<ProfileKey, string> = { CS_N1: "CS N1", CS_N2: "CS N2", PMO_N3: "PMO N3", IT_N3: "IT N3", PLATAFORMA_N4: "Plataforma N4" };

/** Selector canónico de un perfil: IDs del catálogo de personal (equipo/nivel) o pertenencia a PMO. Nunca texto de etiquetas. */
export const profileSelectorSchema = z.object({
  teamId: z.string().max(40).nullable(),
  levelId: z.string().max(40).nullable(),
  pmo: z.boolean().nullable(),
});
export type ProfileSelector = z.infer<typeof profileSelectorSchema>;

// ---------------------------------------------------------------- Familias y especificación de cada métrica

export const FAMILIES = ["horas_cs", "horas_pmo", "horas_it", "economia", "pap", "escalados", "contexto"] as const;
export type Family = (typeof FAMILIES)[number];
export const FAMILY_LABEL: Record<Family, string> = {
  horas_cs: "Horas CS (N1 y N2)",
  horas_pmo: "Horas PMO N3",
  horas_it: "Horas IT N3 y Plataforma N4",
  economia: "Economía",
  pap: "PAP",
  escalados: "Tickets y escalados",
  contexto: "Contexto",
};

export type HoursClass = "total" | "incident" | "other" | "unclassified";
export type PapKind = "evolutive_observed" | "evolutive_nonbillable" | "corrective_project" | "corrective_standard" | "client_origin" | "corrective_total" | "total";
export type MetricSpec =
  | { t: "hours"; profile: ProfileKey; cls: HoursClass }
  | { t: "hours_total" }
  | { t: "users_stock" }
  | { t: "income_per_user" }
  | { t: "pap"; kind: PapKind }
  | { t: "n2_to_n3" }
  | { t: "n3_tickets" }
  | { t: "n3_pct_all" }
  | { t: "per_day" }
  | { t: "per_day_prev_year" }
  | { t: "dev_target" }
  | { t: "dev_portfolio" };

export type MetricKind = "hours" | "events" | "money" | "ratio" | "stock";
export type PulseMetric = {
  id: string;
  label: string;
  family: Family;
  source: string;
  scopes: ("group" | "client" | "implementation")[];
  /** Periodo en el que se calcula: el seleccionado, o el año anterior completo (explícito). */
  period: "selected" | "prevYear";
  kind: MetricKind;
  /** Unidad del valor BRUTO. */
  unit: string;
  numerator: string;
  denominator: string;
  /** Variantes de normalización ofrecidas; la primera normalizada es la predeterminada. */
  variants: Normalization[];
  direction: Direction;
  spec: MetricSpec;
};

const ALL_SCOPES: PulseMetric["scopes"] = ["group", "client", "implementation"];
const HOURS_VARIANTS: Normalization[] = ["per_user_year", "per_user", "raw"];
const EVENT_VARIANTS: Normalization[] = ["per_100_year", "per_100", "raw"];
const HOURS_SRC = "Tiempos Zendesk (hasta 2024; CS/IT/Plataforma) y Wrike (PMO desde 2025), elegibles, dentro del perímetro del servicio";

const CLS_LABEL: Record<HoursClass, string> = { total: "total", incident: "incidente Vincle confirmado", other: "otro soporte clasificado", unclassified: "sin clasificar / pendiente" };
function hoursMetric(id: string, profile: ProfileKey, cls: HoursClass, family: Family): PulseMetric {
  return {
    id, label: `${/* etiqueta estable sin depender de la configuración */ PROFILE_LABEL[profile]} · horas ${CLS_LABEL[cls]}`, family, source: HOURS_SRC, scopes: ALL_SCOPES, period: "selected", kind: "hours", unit: "horas",
    numerator: `horas de ${PROFILE_LABEL[profile]} (${CLS_LABEL[cls]}) del periodo`, denominator: "usuarios mes (UM)", variants: HOURS_VARIANTS, direction: "LOWER", spec: { t: "hours", profile, cls },
  };
}
function papMetric(id: string, label: string, kind: PapKind, numerator: string): PulseMetric {
  return { id, label, family: "pap", source: "PAP (lista + ID, revisión vigente, fecha de producción)", scopes: ALL_SCOPES, period: "selected", kind: "events", unit: "PAP únicos", numerator, denominator: "usuarios mes (UM)", variants: EVENT_VARIANTS, direction: "LOWER", spec: { t: "pap", kind } };
}

/** 23 métricas de partida (M01-M23), seis variantes IT N3 / Plataforma N4 (M24-M29) y las métricas adicionales seleccionables (M30+). */
export const PULSE_METRICS: readonly PulseMetric[] = [
  hoursMetric("M01", "CS_N1", "total", "horas_cs"),
  hoursMetric("M02", "CS_N1", "incident", "horas_cs"),
  hoursMetric("M03", "CS_N1", "other", "horas_cs"),
  hoursMetric("M04", "CS_N2", "total", "horas_cs"),
  hoursMetric("M05", "CS_N2", "incident", "horas_cs"),
  hoursMetric("M06", "CS_N2", "other", "horas_cs"),
  hoursMetric("M07", "PMO_N3", "total", "horas_pmo"),
  hoursMetric("M08", "PMO_N3", "incident", "horas_pmo"),
  hoursMetric("M09", "PMO_N3", "other", "horas_pmo"),
  {
    id: "M10", label: "Ingreso anual de soporte por usuario", family: "economia", source: "Facturación SOPORTE (anual/12 × días/días reales) y usuarios mensuales", scopes: ["group"], period: "selected", kind: "money", unit: "€",
    numerator: "ingreso del periodo", denominator: "usuarios mes (UM)", variants: ["per_user_year", "per_user"], direction: "HIGHER", spec: { t: "income_per_user" },
  },
  papMetric("M11", "PAP evolutivos no facturables", "evolutive_nonbillable", "PAP evolutivos con evidencia positiva de no facturación"),
  papMetric("M12", "PAP correctivos de proyecto", "corrective_project", "PAP con causa correctiva de proyecto (personalización, configuración/datos, procesos, infraestructura)"),
  papMetric("M13", "PAP correctivos estándar", "corrective_standard", "PAP con causa correctiva del estándar"),
  papMetric("M14", "PAP correctivos de origen cliente", "client_origin", "PAP con causa correctiva de origen cliente"),
  {
    id: "M15", label: "Porcentaje de tickets N2 que pasan a N3", family: "escalados", source: "Tickets Zendesk (destinos por tag exacto; creación del ticket)", scopes: ["group", "client"], period: "selected", kind: "ratio", unit: "%",
    numerator: "tickets únicos con N2 y N3", denominator: "tickets únicos con N2", variants: ["raw"], direction: "LOWER", spec: { t: "n2_to_n3" },
  },
  {
    id: "M16", label: "Horas totales del periodo (CUM por defecto)", family: "contexto", source: HOURS_SRC, scopes: ALL_SCOPES, period: "selected", kind: "hours", unit: "horas",
    numerator: "horas elegibles del perímetro del servicio", denominator: "—", variants: ["raw"], direction: "NONE", spec: { t: "hours_total" },
  },
  {
    id: "M17", label: "Usuarios contratados al corte", family: "contexto", source: "Matriz de usuarios mensuales", scopes: ALL_SCOPES, period: "selected", kind: "stock", unit: "usuarios",
    numerator: "usuarios del mes del corte (stock, sin sumar ni prorratear)", denominator: "—", variants: ["raw"], direction: "NONE", spec: { t: "users_stock" },
  },
  {
    id: "M18", label: "€/jornada del periodo", family: "economia", source: "Motor económico (ΣR / ΣH × jornada)", scopes: ["group"], period: "selected", kind: "money", unit: "€/jornada",
    numerator: "ingreso imputado del periodo", denominator: "horas del perímetro ÷ jornada", variants: ["raw"], direction: "HIGHER", spec: { t: "per_day" },
  },
  {
    id: "M19", label: "Desviación contra objetivo", family: "economia", source: "Motor económico", scopes: ["group"], period: "selected", kind: "ratio", unit: "fracción",
    numerator: "objetivo − €/jornada", denominator: "objetivo", variants: ["raw"], direction: "LOWER", spec: { t: "dev_target" },
  },
  {
    id: "M20", label: "Desviación contra cartera de referencia", family: "economia", source: "Motor económico y referencia económica", scopes: ["group"], period: "selected", kind: "ratio", unit: "fracción",
    numerator: "€/jornada de la cartera de referencia − €/jornada del grupo", denominator: "€/jornada de la cartera de referencia", variants: ["raw"], direction: "LOWER", spec: { t: "dev_portfolio" },
  },
  {
    id: "M21", label: "€/jornada del año anterior completo", family: "economia", source: "Motor económico (año natural anterior completo, periodo explícito)", scopes: ["group"], period: "prevYear", kind: "money", unit: "€/jornada",
    numerator: "ingreso del año anterior", denominator: "horas del año anterior ÷ jornada", variants: ["raw"], direction: "HIGHER", spec: { t: "per_day_prev_year" },
  },
  {
    id: "M22", label: "Horas totales por usuario", family: "contexto", source: HOURS_SRC, scopes: ALL_SCOPES, period: "selected", kind: "hours", unit: "horas",
    numerator: "horas elegibles del perímetro del servicio", denominator: "usuarios mes (UM)", variants: HOURS_VARIANTS, direction: "LOWER", spec: { t: "hours_total" },
  },
  papMetric("M23", "PAP únicos por usuario", "total", "PAP únicos (lista + ID) con fecha de producción en el periodo"),
  hoursMetric("M24", "IT_N3", "total", "horas_it"),
  hoursMetric("M25", "IT_N3", "incident", "horas_it"),
  hoursMetric("M26", "IT_N3", "other", "horas_it"),
  hoursMetric("M27", "PLATAFORMA_N4", "total", "horas_it"),
  hoursMetric("M28", "PLATAFORMA_N4", "incident", "horas_it"),
  hoursMetric("M29", "PLATAFORMA_N4", "other", "horas_it"),
  {
    id: "M30", label: "Tickets escalados a N3 (PMO o IT) por exposición", family: "escalados", source: "Tickets Zendesk (unión de ticket_id con destino PMO N3 o IT N3; mes de creación)", scopes: ["group", "client"], period: "selected", kind: "events", unit: "tickets",
    numerator: "tickets únicos con destino N3 (PMO o IT)", denominator: "usuarios mes (UM)", variants: EVENT_VARIANTS, direction: "LOWER", spec: { t: "n3_tickets" },
  },
  {
    id: "M31", label: "Porcentaje de tickets que llegan a N3", family: "escalados", source: "Tickets Zendesk (destinos por tag exacto)", scopes: ["group", "client"], period: "selected", kind: "ratio", unit: "%",
    numerator: "tickets únicos con destino N3", denominator: "tickets únicos creados en el periodo (todos)", variants: ["raw"], direction: "LOWER", spec: { t: "n3_pct_all" },
  },
  hoursMetric("M32", "CS_N1", "unclassified", "horas_cs"),
  hoursMetric("M33", "CS_N2", "unclassified", "horas_cs"),
  hoursMetric("M34", "PMO_N3", "unclassified", "horas_pmo"),
  hoursMetric("M35", "IT_N3", "unclassified", "horas_it"),
  hoursMetric("M36", "PLATAFORMA_N4", "unclassified", "horas_it"),
  papMetric("M37", "PAP evolutivos observados (sin evidencia de facturación)", "evolutive_observed", "PAP con causa evolutiva; no se afirma que sean no facturables"),
  papMetric("M38", "PAP correctivos únicos (cualquier causa correctiva)", "corrective_total", "PAP con al menos una causa correctiva (un PAP cuenta una vez)"),
];

export const METRIC_BY_ID = new Map(PULSE_METRICS.map((m) => [m.id, m]));
/** Selección predeterminada de columnas: las nueve de horas por perfil con N1/N2/PMO, economía y contexto. */
export const DEFAULT_METRIC_IDS = ["M01", "M04", "M07", "M10", "M12", "M13", "M14", "M15", "M16", "M17", "M18", "M19", "M20", "M22", "M23"] as const;

// ---------------------------------------------------------------- Referencias estadísticas versionadas

export const REFERENCE_PLANS = ["GOLD", "PLATINUM", "SILVER_ON_DEMAND", "SILVER_RECURRENTE"] as const;
export const referenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{2,40}$/),
  label: z.string().min(1).max(80),
  /** `ALL` = todo el conjunto con datos; `CRITERIA` = grupos que cumplen los criterios. */
  kind: z.enum(["ALL", "CRITERIA"]),
  /** Valores permitidos de cada atributo (vacío = sin restricción). Homogéneo = un único valor vigente, no mezcla ni desconocido. */
  plans: z.array(z.enum(["GOLD", "PLATINUM", "SILVER_ON_DEMAND", "SILVER_RECURRENTE"])).max(4),
  hostings: z.array(z.enum(["CLOUD", "OP"])).max(2),
  complexities: z.array(z.enum(["BASIC", "MEDIUM", "ENTERPRISE"])).max(3),
  product: z.string().max(100).nullable(),
  homogeneous: z.boolean(),
  /** `NO_SILVER`: plan conocido y distinto de Silver (no «cualquier desconocido»). */
  excludeSilver: z.boolean(),
  /** Confirmada (inicial) o personalizada por el Administrador. */
  origin: z.enum(["CONFIRMADA", "PERSONALIZADA"]),
});
export type PulseReference = z.infer<typeof referenceSchema>;

const ref = (id: string, label: string, over: Partial<PulseReference>): PulseReference => ({ id, label, kind: "CRITERIA", plans: [], hostings: [], complexities: [], product: null, homogeneous: false, excludeSilver: false, origin: "CONFIRMADA", ...over });
export const DEFAULT_REFERENCES: PulseReference[] = [
  ref("todos", "Todo el conjunto", { kind: "ALL" }),
  ref("sin_silver", "Sin Silver (plan conocido, no Silver)", { excludeSilver: true }),
  ref("gold_op", "Gold OP", { plans: ["GOLD"], hostings: ["OP"], homogeneous: true }),
  ref("gold_cloud", "Gold CLOUD", { plans: ["GOLD"], hostings: ["CLOUD"], homogeneous: true }),
  ref("platinum_op", "Platinum OP", { plans: ["PLATINUM"], hostings: ["OP"], homogeneous: true }),
  ref("platinum_cloud", "Platinum CLOUD", { plans: ["PLATINUM"], hostings: ["CLOUD"], homogeneous: true }),
];

export type CriteriaCell = { values: string[]; heterogeneous: boolean; source: "group" | "clients" | "none"; clientsWith: number; clientsTotal: number };
export type CriteriaMeta = { support: CriteriaCell; hosting: CriteriaCell; complexity: CriteriaCell; product: CriteriaCell & { contains: string[] } };

export type Membership = { member: boolean; reason: string | null };

const complete = (c: CriteriaCell) => c.source === "group" || (c.source === "clients" && c.clientsTotal > 0 && c.clientsWith >= c.clientsTotal);

/**
 * ¿Pertenece el grupo a la referencia? Los presets homogéneos NO incorporan grupos con mezcla, planes/alojamientos desconocidos o cobertura
 * insuficiente; el motivo se conserva. No usa el predicado «contiene algún Gold» de Comparativa.
 */
export function referenceMembership(r: PulseReference, meta: CriteriaMeta): Membership {
  if (r.kind === "ALL") return { member: true, reason: null };
  const check = (label: string, cell: CriteriaCell, allowed: readonly string[]): Membership | null => {
    if (allowed.length === 0) return null;
    if (cell.values.length === 0) return { member: false, reason: `${label} sin informar` };
    if (r.homogeneous) {
      if (cell.heterogeneous || cell.values.length > 1) return { member: false, reason: `${label} mezclado (${cell.values.join(" + ")})` };
      if (!complete(cell)) return { member: false, reason: `${label} con cobertura insuficiente (${cell.clientsWith}/${cell.clientsTotal} clientes)` };
    }
    return cell.values.every((v) => allowed.includes(v)) ? null : { member: false, reason: `${label} fuera de la referencia (${cell.values.join(" + ")})` };
  };
  if (r.excludeSilver) {
    if (meta.support.values.length === 0) return { member: false, reason: "plan desconocido: «sin Silver» exige plan conocido" };
    if (meta.support.values.some((v) => v.startsWith("SILVER"))) return { member: false, reason: `plan con Silver (${meta.support.values.join(" + ")})` };
  }
  for (const [label, cell, allowed] of [["plan", meta.support, r.plans], ["servidor", meta.hosting, r.hostings], ["complejidad", meta.complexity, r.complexities]] as const) {
    const miss = check(label, cell, allowed);
    if (miss) return miss;
  }
  if (r.product !== null && r.product !== "") {
    if (!meta.product.contains.includes(r.product)) return { member: false, reason: `producto distinto de ${r.product}` };
  }
  return { member: true, reason: null };
}

// ---------------------------------------------------------------- Configuración Pulse (carga útil de revisión)

export const pulseConfigSchema = z.object({
  schema: z.literal("pulse-config-v1"),
  references: z.array(referenceSchema).min(1).max(30),
  /** Dirección por métrica (solo cambios respecto al catálogo; una personalización se identifica como tal). */
  directions: z.record(z.string().max(8), z.enum(["LOWER", "HIGHER", "NONE"])),
  /** Selección canónica de perfiles (equipos/niveles del catálogo de personal). Sin configurar = «perfil sin configurar». */
  profiles: z.partialRecord(z.enum(PROFILE_KEYS), z.array(profileSelectorSchema).max(20)),
  /** Referencia estadística por defecto de la pantalla. */
  defaultReference: z.string().max(40),
});
export type PulseConfig = z.infer<typeof pulseConfigSchema>;

export function defaultPulseConfig(): PulseConfig {
  return { schema: "pulse-config-v1", references: DEFAULT_REFERENCES.map((r) => ({ ...r })), directions: {}, profiles: {}, defaultReference: "todos" };
}

export type ConfigIssue = { path: string; message: string };
export function validatePulseConfig(cfg: PulseConfig): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  const ids = new Set<string>();
  for (const r of cfg.references) {
    if (ids.has(r.id)) out.push({ path: `references.${r.id}`, message: `Referencia duplicada: ${r.id}.` });
    ids.add(r.id);
    if (r.kind === "CRITERIA" && !r.excludeSilver && r.plans.length + r.hostings.length + r.complexities.length === 0 && !r.product) {
      out.push({ path: `references.${r.id}`, message: `La referencia «${r.label}» no tiene criterios: use «Todo el conjunto» o defina al menos uno.` });
    }
  }
  if (!ids.has("todos")) out.push({ path: "references", message: "Debe existir la referencia «todos»." });
  if (!ids.has(cfg.defaultReference)) out.push({ path: "defaultReference", message: "La referencia predeterminada no existe." });
  for (const [m, d] of Object.entries(cfg.directions)) {
    if (!METRIC_BY_ID.has(m)) out.push({ path: `directions.${m}`, message: `Métrica desconocida: ${m}.` });
    else if (d !== "NONE" && METRIC_BY_ID.get(m)!.kind === "stock") out.push({ path: `directions.${m}`, message: "El stock de usuarios es contexto: no admite juicio favorable/desfavorable por defecto." });
  }
  for (const [p, sels] of Object.entries(cfg.profiles)) {
    sels.forEach((s, i) => {
      if (s.teamId === null && s.levelId === null && s.pmo === null) out.push({ path: `profiles.${p}.${i}`, message: "Un selector sin equipo, nivel ni PMO capturaría a todo el personal." });
    });
  }
  return out;
}

export const directionOf = (m: PulseMetric, cfg: PulseConfig): { direction: Direction; custom: boolean } => {
  const o = cfg.directions[m.id];
  return o && o !== m.direction ? { direction: o, custom: true } : { direction: m.direction, custom: false };
};

/** Valores permitidos de normalización de una métrica en el modo pedido: «por usuario» (anual equivalente) por defecto, o bruto. */
export function variantFor(m: PulseMetric, wanted: Normalization): Normalization {
  if (m.variants.includes(wanted)) return wanted;
  if (m.kind === "hours" && (wanted === "per_100" || wanted === "per_100_year")) return wanted === "per_100" ? "per_user" : "per_user_year";
  if (m.kind === "events" && (wanted === "per_user" || wanted === "per_user_year")) return wanted === "per_user" ? "per_100" : "per_100_year";
  return m.variants.includes("raw") ? "raw" : m.variants[0];
}
