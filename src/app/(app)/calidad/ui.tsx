import type { ReactNode } from "react";
import { COLOR_LABEL, HEALTH_LABEL, UNIT_LABEL, type Color, type HealthState, type IndicatorOutcome } from "@/domain/quality-config";
import { formatDecimalEs } from "@/lib/money";

/** Verde/amarillo/rojo NUNCA solo por color: siempre con texto (y símbolo). */
const CLS: Record<Color, string> = { green: "band-verde_claro", yellow: "band-amarillo", red: "band-rojo" };
const SYM: Record<Color, string> = { green: "●", yellow: "▲", red: "■" };
export function ColorBadge({ color, alert }: { color: Color | null; alert?: boolean }) {
  if (color) return <span className={`band ${CLS[color]}`}><span aria-hidden="true">{SYM[color]} </span>{COLOR_LABEL[color]}</span>;
  return alert ? <span className="band band-rojo" title="Señal roja conocida con datos incompletos"><span aria-hidden="true">■ </span>Alerta roja parcial</span> : null;
}

export const STATUS_TEXT: Record<string, string> = {
  OK: "calculado", SIN_CALIBRAR: "sin calibrar", SIN_REGLA: "sin regla", SIN_REFERENCIA: "sin referencia", DATO_INVALIDO: "no calculable", REGLA_INVALIDA: "regla no aplicable",
  BLANCO: "sin feedback", CATEGORIA: "categoría", SIN_DATO: "sin dato", PARCIAL: "parcial", INCOMPLETO: "incompleto", COMPOSICION_SIN_ELEGIR: "composición sin elegir",
};

export const num = (v: string | null | undefined, d = 2): string => (v === null || v === undefined ? "—" : formatDecimalEs(v, Number.isInteger(Number(v)) ? 0 : d));

/** Un cero confirmado, un valor parcial, una celda en blanco y una fuente ausente se ven distintos (texto distinto, no solo color). */
export function KpiCell({ i }: { i: IndicatorOutcome }): ReactNode {
  const unit = UNIT_LABEL[i.unit];
  if (i.key === "HEALTH") {
    if (i.availability === "BLANK") return <span className="badge badge-off">En blanco (sin feedback)</span>;
    const cat = HEALTH_LABEL[i.value as HealthState] ?? "—";
    return i.color ? <><ColorBadge color={i.color} /> <small>{cat}</small></> : <><span className="badge badge-warn">{cat} · sin calibrar</span></>;
  }
  const z = i.value !== null && Number(i.value) === 0;
  return (
    <>
      {i.value !== null ? <strong>{num(i.value)}</strong> : <span className="muted">—</span>}
      {i.value !== null && i.key !== "INCIDENTS_PROBLEMS" ? <small> {unit}</small> : null}
      <br />
      {i.color || i.alert ? <ColorBadge color={i.color} alert={i.alert} /> : null}
      {" "}
      {z && i.availability === "AVAILABLE" ? <span className="badge badge-ok">cero confirmado</span> : null}
      {!i.color && !i.alert ? <span className={`badge ${i.status === "PARCIAL" ? "badge-warn" : "badge-off"}`} title={i.reason}>{STATUS_TEXT[i.status] ?? i.status}</span> : null}
    </>
  );
}
