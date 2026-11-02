import { Dec } from "@/domain/finance";

/** Tipos y ayudantes de comprobación compartidos por la conciliación (niveles 1-3) y el puente de Comparativa/Análisis Cliente/Pulse (nivel 4). */
export type CheckStatus = "OK" | "DIFERENCIA" | "INFORMATIVO" | "NO_DISPONIBLE";
export type Check = {
  id: string; level: 1 | 2 | 3 | 4; title: string; status: CheckStatus; additive: boolean; unit: string;
  expected: string | null; observed: string | null; difference: string | null; tolerance: string;
  identities: string[]; exclusions: { reason: string; count: number; amount: string | null }[]; sources: string[]; notes: string[];
};
export const ZERO = Dec.ZERO;
export const d = (v: string | null | undefined) => (v === null || v === undefined ? ZERO : (Dec.parse(String(v)) as Dec));
export const mk = (c: Partial<Check> & Pick<Check, "id" | "level" | "title" | "unit">): Check => ({ status: "INFORMATIVO", additive: true, expected: null, observed: null, difference: null, tolerance: "0", identities: [], exclusions: [], sources: [], notes: [], ...c });
export function compare(c: Check, expected: Dec | null, observed: Dec | null, tol: Dec = ZERO): Check {
  if (expected === null || observed === null) return { ...c, status: "NO_DISPONIBLE", expected: expected?.toString() ?? null, observed: observed?.toString() ?? null };
  const diff = observed.sub(expected);
  const abs = diff.sign() < 0 ? diff.neg() : diff;
  return { ...c, expected: expected.toString(), observed: observed.toString(), difference: diff.toString(), tolerance: tol.toString(), status: abs.cmp(tol) <= 0 ? "OK" : "DIFERENCIA" };
}
