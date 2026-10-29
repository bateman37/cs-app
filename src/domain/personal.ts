import { z } from "zod";
import { cleanText, isDigits } from "./normalize";
import { contains, isCoherent, isIsoDate } from "./vigencia";

/** Sistemas en los que una persona puede tener alias, ID o correo. */
export const PERSON_SYSTEMS = ["PAP", "ZENDESK", "WRIKE"] as const;
export type PersonSystem = (typeof PERSON_SYSTEMS)[number];
export const PERSON_SYSTEM_LABEL: Record<PersonSystem, string> = { PAP: "PAP", ZENDESK: "Zendesk", WRIKE: "Wrike" };

export const ALIAS_KINDS = ["NAME", "ID", "EMAIL"] as const;
export type AliasKind = (typeof ALIAS_KINDS)[number];
export const ALIAS_KIND_LABEL: Record<AliasKind, string> = { NAME: "Nombre / alias", ID: "ID", EMAIL: "Correo" };

/** Tipos válidos por sistema (mismo contrato que el CHECK de la base). */
export const ALIAS_RULES: Record<PersonSystem, readonly AliasKind[]> = {
  PAP: ["NAME", "ID", "EMAIL"],
  ZENDESK: ["ID", "NAME"],
  WRIKE: ["ID", "NAME"],
};

export const PERSON_ATTRIBUTES = ["LEVEL", "TEAM", "PMO_MEMBER", "PMO_ROLE"] as const;
export type PersonAttribute = (typeof PERSON_ATTRIBUTES)[number];
export const PERSON_ATTRIBUTE_LABEL: Record<PersonAttribute, string> = {
  LEVEL: "Nivel",
  TEAM: "Equipo",
  PMO_MEMBER: "Pertenece a PMO",
  PMO_ROLE: "Rol PMO",
};

export const CATALOG_KINDS = ["LEVEL", "TEAM", "PMO_ROLE"] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];
export const CATALOG_KIND_LABEL: Record<CatalogKind, string> = { LEVEL: "Nivel", TEAM: "Equipo", PMO_ROLE: "Rol PMO" };

/** Valor de búsqueda de un alias: IDs exactos (texto); nombres y correos sin distinguir mayúsculas. No se quitan acentos. */
export function aliasSearchValue(kind: AliasKind, raw: string): string {
  const clean = cleanText(raw);
  return kind === "ID" ? clean : clean.toLowerCase();
}

// ---------------------------------------------------------------- Resolución temporal (pura)

export type TermSnapshot = {
  attribute: PersonAttribute;
  catalogItemId: string | null;
  catalogName: string | null;
  flag: boolean | null;
  validFrom: string | null;
  validTo: string | null;
};

export type ResolvedPerson = {
  team: { id: string; name: string } | null;
  level: { id: string; name: string } | null;
  /** null = sin informar. */
  pmoMember: boolean | null;
  /** Solo se devuelve si pmoMember === true. */
  pmoRole: { id: string; name: string } | null;
  /** Dato vigente con fecha inicial desconocida: pendiente de revisión. */
  flags: { attribute: PersonAttribute; reason: "INITIAL_DATE_UNKNOWN" }[];
};

/** Resuelve nivel, equipo, pertenencia PMO y rol a una fecha; el rol no se muestra si no pertenece a PMO. */
export function resolveTermsAt(terms: TermSnapshot[], date: string): ResolvedPerson {
  const at = (a: PersonAttribute) => terms.find((t) => t.attribute === a && contains({ from: t.validFrom, to: t.validTo }, date)) ?? null;
  const item = (t: TermSnapshot | null) => (t && t.catalogItemId ? { id: t.catalogItemId, name: t.catalogName ?? "" } : null);
  const team = at("TEAM");
  const level = at("LEVEL");
  const pmo = at("PMO_MEMBER");
  const role = at("PMO_ROLE");
  const pmoMember = pmo ? pmo.flag : null;
  const flags = [team, level, pmo, role]
    .filter((t): t is TermSnapshot => t !== null && t.validFrom === null && !(t.attribute === "PMO_ROLE" && pmoMember !== true))
    .map((t) => ({ attribute: t.attribute, reason: "INITIAL_DATE_UNKNOWN" as const }));
  return {
    team: item(team),
    level: item(level),
    pmoMember,
    pmoRole: pmoMember === true ? item(role) : null,
    flags,
  };
}

/** ¿Pertenece a PMO en esa fecha? Con fecha nula se exige un tramo de inicio desconocido. */
export function pmoTrueAt(
  terms: { attribute: PersonAttribute; flag: boolean | null; validFrom: string | null; validTo: string | null }[],
  date: string | null,
): boolean {
  const pmo = terms.filter((t) => t.attribute === "PMO_MEMBER" && t.flag === true);
  if (date === null) return pmo.some((t) => t.validFrom === null);
  return pmo.some((t) => contains({ from: t.validFrom, to: t.validTo }, date));
}

// ---------------------------------------------------------------- Esquemas de validación

const req = (label: string, max = 200) =>
  z
    .string({ error: `${label}: es obligatorio.` })
    .transform(cleanText)
    .pipe(z.string().min(1, `${label}: es obligatorio.`).max(max, `${label}: máximo ${max} caracteres.`));

const opt = (label: string, max = 500) =>
  z
    .string()
    .optional()
    .transform((v) => cleanText(v ?? ""))
    .pipe(z.string().max(max, `${label}: máximo ${max} caracteres.`))
    .transform((v) => (v === "" ? null : v));

const date = (label: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v ?? "").trim())
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || isIsoDate(v), `${label}: fecha no válida.`);

const checkbox = () =>
  z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "on" || v === "true");

const version = z.coerce.number({ error: "Versión no válida." }).int().min(1);

export const personSchema = z.object({ name: req("Nombre canónico"), note: opt("Nota") });
export const personUpdateSchema = personSchema.extend({ expectedVersion: version });
export const personVersionSchema = z.object({ expectedVersion: version });

export const aliasSchema = z
  .object({
    system: z.enum(PERSON_SYSTEMS, { error: "Seleccione un sistema." }),
    kind: z.enum(ALIAS_KINDS, { error: "Seleccione el tipo." }),
    rawValue: req("Valor", 300),
    validFrom: date("Vigente desde"),
    validTo: date("Vigente hasta"),
    note: opt("Nota"),
  })
  .superRefine((v, ctx) => {
    if (!ALIAS_RULES[v.system].includes(v.kind)) {
      ctx.addIssue({
        code: "custom",
        path: ["kind"],
        message: `${PERSON_SYSTEM_LABEL[v.system]} no admite «${ALIAS_KIND_LABEL[v.kind]}». Admite: ${ALIAS_RULES[v.system].map((k) => ALIAS_KIND_LABEL[k]).join(", ")}.`,
      });
    }
    if (v.system === "ZENDESK" && v.kind === "ID" && !isDigits(v.rawValue.trim())) {
      ctx.addIssue({ code: "custom", path: ["rawValue"], message: "El ID de Zendesk debe ser un número entero (solo dígitos)." });
    }
    if (v.kind === "EMAIL" && !z.email().safeParse(v.rawValue.trim()).success) {
      ctx.addIssue({ code: "custom", path: ["rawValue"], message: "Correo no válido." });
    }
    if (!isCoherent({ from: v.validFrom, to: v.validTo })) {
      ctx.addIssue({ code: "custom", path: ["validTo"], message: "«Vigente hasta» debe ser posterior a «Vigente desde»." });
    }
  });

export const aliasUpdateSchema = z
  .object({
    rawValue: req("Valor", 300),
    validFrom: date("Vigente desde"),
    validTo: date("Vigente hasta"),
    note: opt("Nota"),
    expectedVersion: version,
  })
  .superRefine((v, ctx) => {
    if (!isCoherent({ from: v.validFrom, to: v.validTo })) {
      ctx.addIssue({ code: "custom", path: ["validTo"], message: "«Vigente hasta» debe ser posterior a «Vigente desde»." });
    }
  });

const attribute = z.enum(PERSON_ATTRIBUTES, { error: "Seleccione el dato." });
const termBase = { attribute, value: req("Valor", 100), note: opt("Nota") };

function pmoValue(v: { attribute: PersonAttribute; value: string }, ctx: z.RefinementCtx) {
  if (v.attribute === "PMO_MEMBER" && v.value !== "true" && v.value !== "false") {
    ctx.addIssue({ code: "custom", path: ["value"], message: "Indique Sí o No." });
  }
}

/** Cambio con fecha efectiva (o primer registro con inicio desconocido). */
export const personTermChangeSchema = z
  .object({ ...termBase, effectiveFrom: date("Fecha efectiva"), unknownStart: checkbox() })
  .superRefine((v, ctx) => {
    if (!v.effectiveFrom && !v.unknownStart) {
      ctx.addIssue({ code: "custom", path: ["effectiveFrom"], message: "Indique la fecha efectiva o marque que la fecha de inicio se desconoce." });
    }
    if (v.effectiveFrom && v.unknownStart) {
      ctx.addIssue({ code: "custom", path: ["effectiveFrom"], message: "Indique la fecha efectiva o marque que se desconoce, no ambas." });
    }
    pmoValue(v, ctx);
  });

export const personTermPeriodSchema = z
  .object({ ...termBase, validFrom: date("Desde"), validTo: date("Hasta") })
  .superRefine((v, ctx) => {
    if (!isCoherent({ from: v.validFrom, to: v.validTo })) {
      ctx.addIssue({ code: "custom", path: ["validTo"], message: "«Hasta» debe ser posterior a «Desde»." });
    }
    pmoValue(v, ctx);
  });

export const personTermUpdateSchema = z
  .object({ value: req("Valor", 100), validFrom: date("Desde"), validTo: date("Hasta"), note: opt("Nota"), expectedVersion: version })
  .superRefine((v, ctx) => {
    if (!isCoherent({ from: v.validFrom, to: v.validTo })) {
      ctx.addIssue({ code: "custom", path: ["validTo"], message: "«Hasta» debe ser posterior a «Desde»." });
    }
  });

export const catalogItemSchema = z.object({
  kind: z.enum(CATALOG_KINDS, { error: "Seleccione el catálogo." }),
  name: req("Nombre", 100),
});
