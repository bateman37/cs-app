import { z } from "zod";
import { cleanText } from "./normalize";
import { parseUserCount } from "./usuarios";

const targetType = z.enum(["group", "client", "implementation"], { error: "Ámbito no válido." });
const targetId = z.string({ error: "Ámbito no válido." }).min(1, "Ámbito no válido.");
const monthNumber = z.coerce.number({ error: "Mes no válido." }).int("Mes no válido.").min(1, "Mes no válido.").max(12, "Mes no válido.");
const yearNumber = z.coerce.number({ error: "Año no válido." }).int("Año no válido.").min(2000, "Año no válido.").max(2100, "Año no válido.");
const userCount = z
  .union([z.string(), z.number()], { error: "Indique un número entero de usuarios." })
  .refine((v) => parseUserCount(v) !== null, "Indique un número entero de usuarios, 0 o mayor (sin decimales).")
  .transform((v) => parseUserCount(v) as number);
const expectedVersion = z.coerce.number({ error: "Versión no válida." }).int().min(0).default(0);

export const matrixChangeSchema = z.object({
  targetType,
  targetId,
  year: yearNumber,
  op: z.enum(["SET_MONTH", "APPLY_FROM"], { error: "Operación no válida." }),
  month: monthNumber,
  value: userCount,
  /** 0 = la matriz de ese año aún no existe. */
  expectedVersion,
});

export const matrixInitSchema = z.object({
  targetType,
  targetId,
  year: yearNumber,
  value: userCount,
  source: z
    .string({ error: "Procedencia: es obligatoria." })
    .transform(cleanText)
    .pipe(z.string().min(1, "Procedencia: es obligatoria.").max(200, "Procedencia: máximo 200 caracteres.")),
});

export const matrixCopySchema = z.object({
  targetType,
  targetId,
  year: yearNumber,
  /** SAME_MONTH: cada mes del año anterior a su mes; DECEMBER: el diciembre anterior a todos los meses sin informar. */
  mode: z.enum(["SAME_MONTH", "DECEMBER"], { error: "Modo de copia no válido." }).default("SAME_MONTH"),
  expectedVersion,
});

/** Elección explícita de la base 2025 de un Grupo con valores distintos por categoría (o valor indicado a mano). */
export const usersBaseResolveSchema = z.object({
  groupId: z.string({ error: "Grupo no válido." }).min(1, "Grupo no válido."),
  category: z.enum(["SOPORTE", "ADMIN_DELEGADA"], { error: "Categoría no válida." }).optional(),
  value: userCount.optional(),
  reason: z.string().transform(cleanText).pipe(z.string().max(300, "Motivo: máximo 300 caracteres.")).optional(),
});

export type MatrixChangeInput = z.output<typeof matrixChangeSchema>;

const stepSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SET"), month: monthNumber, value: z.union([z.number().int().min(0).max(10_000_000), z.null()], { error: "Indique un número entero de usuarios, 0 o mayor, o deje la celda vacía." }) }),
  z.object({ type: z.literal("APPLY_FROM"), month: monthNumber, value: z.number({ error: "Indique un número entero de usuarios." }).int("Indique un número entero de usuarios.").min(0, "Indique un número entero de usuarios, 0 o mayor.").max(10_000_000) }),
  z.object({ type: z.literal("COPY"), mode: z.enum(["SAME_MONTH", "DECEMBER"]) }),
]);

/** Guardado por lote de la matriz de usuarios contratados (HOTFIX-04 §6): varias celdas y varias filas en UNA operación atómica con una versión esperada por matriz. */
export const matrixBatchSchema = z.object({
  operationId: z.string().min(8).max(80),
  year: yearNumber,
  matrices: z.array(z.object({ targetType, targetId, expectedVersion, steps: z.array(stepSchema).min(1).max(60) })).min(1, "No hay cambios que guardar.").max(300),
  digest: z.string().max(100).optional(),
});
export type MatrixBatchInput = z.output<typeof matrixBatchSchema>;
