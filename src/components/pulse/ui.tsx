import { BAND_KEYS, BAND_LABEL, type Band } from "@/domain/pulse-stats";
import { formatDecimalEs, formatPercentEs } from "@/lib/money";
import { STATE_LABEL, type Cell, type CellState } from "@/server/pulse/service";

/** Presentación de Pulse Rent: solo formatea el decimal EXACTO del servidor; nunca calcula ni convierte importes a Number. */
export function fmt(value: string | null, unit: string): string {
  if (value === null) return "—";
  if (unit === "fracción") return formatPercentEs(value, 1);
  if (unit === "%") return `${formatDecimalEs(value, 1)} %`;
  if (unit === "usuarios" || unit === "PAP únicos" || unit === "tickets") return formatDecimalEs(value, Number.isInteger(Number(value)) ? 0 : 2);
  return formatDecimalEs(value, 2);
}

export function BandBadge({ band }: { band: Band | null }) {
  return band ? <span className={`band band-${band}`}>{BAND_LABEL[band]}</span> : null;
}

export function StateBadge({ state, reason }: { state: CellState; reason: string | null }) {
  if (state === "OK") return null;
  const cls = state === "ZERO" ? "badge-ok" : state === "PARTIAL" ? "badge-warn" : "badge-off";
  return <span className={`badge ${cls}`} title={reason ?? undefined}>{STATE_LABEL[state]}</span>;
}

export function BandLegend({ direction }: { direction: "LOWER" | "HIGHER" | "NONE" }) {
  const order: Band[] = direction === "HIGHER" ? [...BAND_KEYS].reverse() : [...BAND_KEYS];
  const text: Record<"LOWER" | "HIGHER", Record<Band, string>> = {
    LOWER: { verde_intenso: "x ≤ P10", verde_claro: "P10 < x ≤ P25", amarillo: "P25 < x ≤ P75", naranja: "P75 < x ≤ P90", rojo: "x > P90" },
    HIGHER: { rojo: "x < P10", naranja: "P10 ≤ x < P25", amarillo: "P25 ≤ x < P75", verde_claro: "P75 ≤ x < P90", verde_intenso: "x ≥ P90" },
  };
  if (direction === "NONE") return <p className="hint">Sin juicio favorable/desfavorable: se muestran estadísticos descriptivos, no bandas.</p>;
  return (
    <ul className="band-legend" aria-label="Leyenda de bandas">
      {order.map((b) => <li key={b}><span className={`band band-${b}`}>{BAND_LABEL[b]}</span> {text[direction][b]}</li>)}
    </ul>
  );
}

export const cellText = (c: Cell): string => `${fmt(c.value, c.unit)} ${c.unit}`;
