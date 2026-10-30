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
  expectedVersion,
});

export type MatrixChangeInput = z.output<typeof matrixChangeSchema>;
