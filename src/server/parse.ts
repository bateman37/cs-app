import type { z } from "zod";
import { DomainError } from "./errors";

/** Valida datos de formulario y devuelve errores por campo en castellano. */
export function parseInput<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "_");
    if (!fields[key]) fields[key] = issue.message;
  }
  throw new DomainError("Revise los campos marcados: hay datos que no son válidos.", fields);
}
