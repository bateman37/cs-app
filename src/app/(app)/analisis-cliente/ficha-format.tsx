import { BAND_LABEL, economicBand, type BandFactors } from "@/domain/economic-bands";
import type { ReactNode } from "react";
import { Dec, type Formula } from "@/domain/finance";
import { CMP_TEXT, type Cell, type Cmp, type Measure, type MonthRow } from "@/domain/ficha-series";
import { formatDecimalEs, formatPercentEs } from "@/lib/money";
import { Na } from "./ficha-client";

/** Formato de presentación de la ficha. Solo da formato a decimales EXACTOS del servidor y de las series compartidas; no calcula cifras de negocio. */
export const num = (v: string | null | undefined, d = 2): string => (v === null || v === undefined ? "—" : formatDecimalEs(v, d));
export const signOf = (v: string | null | undefined): -1 | 0 | 1 => (v === null || v === undefined ? 0 : (Dec.parse(v)?.sign() ?? 0));
export const signed = (v: string | null | undefined, d = 2): string => (v === null || v === undefined ? "—" : `${signOf(v) > 0 ? "+" : ""}${formatDecimalEs(v, d)}`);
export const pctFrac = (v: string | null | undefined, d = 1): string => (v === null || v === undefined ? "—" : formatPercentEs(v, d));
export const sPct = (v: string | null | undefined, d = 1): string => (v === null || v === undefined ? "—" : `${signOf(v) > 0 ? "+" : ""}${formatPercentEs(v, d)}`);
export const dm = (iso: string | null | undefined): string => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
export const dmy = (iso: string | null | undefined): string => (iso ? iso.split("-").reverse().join("/") : "—");
/** Miles con un decimal («54,1 k»), para etiquetas sobre barras. Sin cifras de negocio nuevas: solo cambia la escala visual del decimal exacto. */
export const kilo = (v: string | null | undefined): string | null => {
  const d = v === null || v === undefined ? null : Dec.parse(v);
  return d === null ? null : `${formatDecimalEs(d.divInt(1000).toString(), Math.abs(Number(d.toString())) >= 100000 ? 0 : 1)} k`;
};
/** Coordenada numérica de un decimal exacto (SOLO para dibujar). */
export const coord = (v: string | null | undefined): number | null => (v === null || v === undefined ? null : Number.parseFloat(v));

/** Valor o «—» con motivo accesible. */
export function V({ c, d = 2, suffix = "" }: { c: Cell | null | undefined; d?: number; suffix?: string }): ReactNode {
  if (!c) return <>—</>;
  return c.v === null ? <Na reason={c.reason} /> : <>{formatDecimalEs(c.v, d)}{suffix}</>;
}

/** Desviación contra un objetivo (positivo = peor): color más signo textual, nunca solo color. */
export function Dev({ f, d = 1 }: { f: Pick<Formula, "value" | "reason"> | null | undefined; d?: number }): ReactNode {
  if (!f || f.value === null) return <Na reason={f?.reason} />;
  const s = signOf(f.value);
  return <span className={s > 0 ? "fc-bad" : s < 0 ? "fc-good" : undefined} title={s > 0 ? "Positivo = por debajo del objetivo / por encima de las horas objetivo" : undefined}>{sPct(f.value, d)}</span>;
}

/** `band` (HOTFIX-03 §9): la misma escala económica que Comparativa para el €/jornada; provisional con asterisco y texto accesible. */
export function Amt({ f, d = 2, band }: { f: Pick<Formula, "value" | "reason"> & Partial<Pick<Formula, "provisional" | "imputed">> | null | undefined; d?: number; band?: { target: string; factors: BandFactors } }): ReactNode {
  if (!f || f.value === null) return <Na reason={f?.reason} />;
  const b = band ? economicBand(f.value, band.target, band.factors) : null;
  const label = [b ? BAND_LABEL[b] : null, f.provisional ? `Cifra provisional: ${f.reason ?? ""}` : null, f.imputed ? "Imputación económica anual prorrateada" : null].filter(Boolean).join(". ");
  if (!b && !f.provisional) return <>{formatDecimalEs(f.value, d)}</>;
  return <span className={`${b ? `band band-${b}` : ""}${f.provisional ? " prov-val" : ""}`.trim()} title={label} aria-label={`${formatDecimalEs(f.value, d)}. ${label}`}>{formatDecimalEs(f.value, d)}{f.provisional ? "*" : ""}</span>;
}

export function cmpDiffText(m: Measure, c: Cmp | null): string {
  if (!c || c.diff === null) return "—";
  return m.kind === "fraction" ? `${signed(c.diff, 1)} pp` : `${signed(c.diff, 2)} ${m.unit}`;
}
export function cmpPctText(m: Measure, c: Cmp | null): string {
  if (!c) return "—";
  if (m.kind === "fraction") return "(puntos porcentuales)";
  if (c.pct !== null) return sPct(c.pct, 1);
  return c.state === "OK" ? "—" : CMP_TEXT[c.state as Exclude<typeof c.state, "OK">];
}

/** Filas del tooltip/tabla de una medida en un mes (mismo conjunto de datos). */
export function monthRowsText(m: Measure, r: MonthRow, y: number, py: number, d = 2): [string, string][] {
  const u = m.kind === "fraction" ? "" : ` ${m.unit}`;
  const fmt = (c: Cell | null, dd: number) => (c === null || c.v === null ? "sin dato" : m.kind === "fraction" ? pctFrac(c.v, dd) : `${formatDecimalEs(c.v, dd)}${u}`);
  const out: [string, string][] = [
    [`${y}${r.partial ? ` (hasta ${dm(r.curTo)})` : ""}`, fmt(r.cur, d)],
    [`${py}${r.partial ? ` (hasta ${dm(r.prevTo)})` : ""}`, fmt(r.prev, d)],
    ["Diferencia", cmpDiffText(m, r.cmp)],
  ];
  if (m.kind === "magnitude") out.push(["Variación", cmpPctText(m, r.cmp)]);
  return out;
}
