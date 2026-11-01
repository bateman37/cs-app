import { z } from "zod";
import {
  ATTRIBUTES,
  FIXED_VALUES,
  KIND_LABEL,
  KINDS,
  MILESTONE_TYPES,
  SYSTEM_LABEL,
  SYSTEM_RULES,
  GROUP_TARGET_KINDS,
  SYSTEMS,
  TARGET_LABEL,
  type TargetType,
} from "./catalogs";
import { cleanText, isDigits } from "./normalize";
import { isCoherent, isIsoDate } from "./vigencia";

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

const optId = () =>
  z
    .string()
    .optional()
    .transform((v) => (v ?? "").trim())
    .transform((v) => (v === "" ? null : v));

const checkbox = () =>
  z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "on" || v === "true");

const date = (label: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v ?? "").trim())
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || isIsoDate(v), `${label}: fecha no válida.`);

const version = z.coerce.number({ error: "Versión no válida." }).int().min(1);

export const groupSchema = z.object({
  name: req("Nombre"),
  bcDenomination: opt("Denominación BC"),
});

export const clientSchema = z.object({
  name: req("Nombre"),
  groupId: optId(),
  isInternal: checkbox(),
});

export const implementationSchema = z.object({
  name: req("Nombre"),
  key: opt("Clave", 100),
});

export const productSchema = z.object({ name: req("Nombre", 100) });

export const versionedSchema = z.object({ expectedVersion: version });

const targetType = z.enum(["group", "client", "implementation"], { error: "Destino no válido." });

export const identitySchema = z
  .object({
    system: z.enum(SYSTEMS, { error: "Seleccione un sistema." }),
    kind: z.enum(KINDS, { error: "Seleccione el tipo de identidad." }),
    rawValue: req("Valor", 300),
    targetType,
    targetId: req("Destino", 100),
    validFrom: date("Vigente desde"),
    validTo: date("Vigente hasta"),
    note: opt("Nota"),
  })
  .superRefine((v, ctx) => {
    const rules = SYSTEM_RULES[v.system];
    if (!rules.kinds.includes(v.kind)) {
      ctx.addIssue({
        code: "custom",
        path: ["kind"],
        message: `${SYSTEM_LABEL[v.system]} no admite «${KIND_LABEL[v.kind]}». Admite: ${rules.kinds.map((k) => KIND_LABEL[k]).join(", ")}.`,
      });
    }
    if (!rules.targets.includes(v.targetType as TargetType)) {
      ctx.addIssue({
        code: "custom",
        path: ["targetType"],
        message: `${SYSTEM_LABEL[v.system]} solo se asigna a: ${rules.targets.map((t) => TARGET_LABEL[t]).join(" o ")}.`,
      });
    }
    if (v.targetType === "group" && (v.system === "WRIKE" || v.system === "PAP") && !GROUP_TARGET_KINDS.includes(v.kind)) {
      ctx.addIssue({
        code: "custom",
        path: ["targetType"],
        message: `Un Grupo Cliente solo se asigna desde una identidad de proyecto de ${SYSTEM_LABEL[v.system]} (ID o nombre de proyecto), no desde «${KIND_LABEL[v.kind]}».`,
      });
    }
    if (v.system === "ZENDESK" && v.kind === "ORG_ID" && !isDigits(v.rawValue.trim())) {
      ctx.addIssue({ code: "custom", path: ["rawValue"], message: "El ID de organización Zendesk debe ser un número entero (solo dígitos)." });
    }
    if (!isCoherent({ from: v.validFrom, to: v.validTo })) {
      ctx.addIssue({ code: "custom", path: ["validTo"], message: "«Vigente hasta» debe ser posterior a «Vigente desde»." });
    }
  });

export const identityUpdateSchema = z
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

const attribute = z.enum(ATTRIBUTES, { error: "Seleccione el dato de servicio." });

const termBase = {
  attribute,
  value: req("Valor", 200),
  targetType,
  targetId: req("Ámbito", 100),
  note: opt("Nota"),
};

function checkCatalog(v: { attribute: (typeof ATTRIBUTES)[number]; value: string }, ctx: z.RefinementCtx) {
  if (v.attribute !== "PRODUCT" && !FIXED_VALUES[v.attribute].includes(v.value)) {
    ctx.addIssue({ code: "custom", path: ["value"], message: "Valor no válido para este dato." });
  }
}

/** Cambio con fecha efectiva: el valor anterior se conserva hasta esa fecha. */
export const termChangeSchema = z
  .object({ ...termBase, effectiveFrom: date("Fecha efectiva"), unknownStart: checkbox() })
  .superRefine((v, ctx) => {
    checkCatalog(v, ctx);
    if (!v.effectiveFrom && !v.unknownStart) {
      ctx.addIssue({ code: "custom", path: ["effectiveFrom"], message: "Indique la fecha efectiva o marque que la fecha de inicio se desconoce." });
    }
    if (v.effectiveFrom && v.unknownStart) {
      ctx.addIssue({ code: "custom", path: ["effectiveFrom"], message: "Indique la fecha efectiva o marque que se desconoce, no ambas." });
    }
  });

/** Tramo histórico explícito (desde/hasta). */
export const termPeriodSchema = z
  .object({ ...termBase, validFrom: date("Desde"), validTo: date("Hasta") })
  .superRefine((v, ctx) => {
    checkCatalog(v, ctx);
    if (!isCoherent({ from: v.validFrom, to: v.validTo })) {
      ctx.addIssue({ code: "custom", path: ["validTo"], message: "«Hasta» debe ser posterior a «Desde»." });
    }
  });

export const termUpdateSchema = z
  .object({
    value: req("Valor", 200),
    validFrom: date("Desde"),
    validTo: date("Hasta"),
    note: opt("Nota"),
    expectedVersion: version,
  })
  .superRefine((v, ctx) => {
    if (!isCoherent({ from: v.validFrom, to: v.validTo })) {
      ctx.addIssue({ code: "custom", path: ["validTo"], message: "«Hasta» debe ser posterior a «Desde»." });
    }
  });

export const milestoneSchema = z.object({
  type: z.enum(MILESTONE_TYPES, { error: "Seleccione el tipo de hito." }),
  date: date("Fecha").refine((v) => v !== null, "Fecha: es obligatoria."),
  note: opt("Nota"),
  targetType,
  targetId: req("Ámbito", 100),
});

export const milestoneUpdateSchema = z.object({
  type: z.enum(MILESTONE_TYPES, { error: "Seleccione el tipo de hito." }),
  date: date("Fecha").refine((v) => v !== null, "Fecha: es obligatoria."),
  note: opt("Nota"),
  expectedVersion: version,
});
