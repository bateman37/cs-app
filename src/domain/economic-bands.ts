/**
 * Bandas económicas de rentabilidad (HOTFIX-03 §9). Las bandas se expresan como FACTORES del objetivo T vigente (no como cortes absolutos), de modo que
 * cambiar T desplaza los cortes. Valores iniciales (editables en Configuración → Economía): 0,60 · 0,80 · 1,00 · 1,20 → con T = 550: 330 · 440 · 550 · 660.
 *  < 0,60 T rojo · [0,60 T, 0,80 T) naranja · [0,80 T, T) amarillo · [T, 1,20 T) verde · ≥ 1,20 T verde intenso. El valor exacto del corte pertenece a la banda superior.
 * Ausente es neutro; provisional se distingue y nunca tiene apariencia de dato completo.
 */
import { Dec } from "./finance";

export const BAND_IDS = ["red", "orange", "yellow", "green", "green-strong"] as const;
export type BandId = (typeof BAND_IDS)[number];
export const BAND_LABEL: Record<BandId, string> = { red: "Rojo: muy por debajo del objetivo", orange: "Naranja: por debajo del objetivo", yellow: "Amarillo: cerca del objetivo", green: "Verde: cumple el objetivo", "green-strong": "Verde intenso: supera el objetivo con holgura" };
export const BAND_SHORT: Record<BandId, string> = { red: "Rojo", orange: "Naranja", yellow: "Amarillo", green: "Verde", "green-strong": "Verde intenso" };
export const DEFAULT_BAND_FACTORS = ["0.6", "0.8", "1", "1.2"] as const;
export type BandFactors = readonly [string, string, string, string];

/** Valida cuatro factores: números positivos estrictamente crecientes y el tercero igual a 1 (verde empieza en el objetivo). */
export function validateBandFactors(raw: unknown): { ok: true; factors: BandFactors } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length !== 4) return { ok: false, error: "Indique los cuatro cortes de las bandas." };
  const parsed = raw.map((x) => Dec.parse(String(x ?? "").trim().replace(",", ".")));
  if (parsed.some((d) => d === null)) return { ok: false, error: "Cada corte debe ser un número." };
  const d = parsed as Dec[];
  if (d.some((x) => x.sign() <= 0)) return { ok: false, error: "Los cortes deben ser mayores que cero." };
  for (let i = 1; i < 4; i++) if (d[i].cmp(d[i - 1]) <= 0) return { ok: false, error: "Los cortes deben ir de menor a mayor, sin repetirse." };
  if (d[2].cmp(Dec.int(1)) !== 0) return { ok: false, error: "El tercer corte es el propio objetivo (1,00): el verde empieza al alcanzarlo." };
  return { ok: true, factors: d.map((x) => x.toString()) as unknown as BandFactors };
}

export function cutsFor(target: string, factors: BandFactors = DEFAULT_BAND_FACTORS): string[] {
  const t = Dec.parse(target) as Dec;
  return factors.map((f) => t.mul(Dec.parse(f) as Dec).toString());
}

/** Banda de un ratio €/jornada. `null` si el valor no existe (neutro). La comparación es decimal exacta: 550 es verde y 549,99 amarillo. */
export function economicBand(ratio: string | null | undefined, target: string, factors: BandFactors = DEFAULT_BAND_FACTORS): BandId | null {
  if (ratio === null || ratio === undefined) return null;
  const v = Dec.parse(ratio);
  if (v === null) return null;
  const cuts = cutsFor(target, factors).map((c) => Dec.parse(c) as Dec);
  if (v.cmp(cuts[0]) < 0) return "red";
  if (v.cmp(cuts[1]) < 0) return "orange";
  if (v.cmp(cuts[2]) < 0) return "yellow";
  if (v.cmp(cuts[3]) < 0) return "green";
  return "green-strong";
}

export type BandState = { band: BandId | null; provisional: boolean };
