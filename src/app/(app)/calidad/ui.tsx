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

// ---------------------------------------------------------------- Presentación compacta del Resumen de clientes (HOTFIX-02 §9)

const ST: Record<Color, { cls: string; sym: string; text: string }> = {
  red: { cls: "ql-st-red", sym: "■", text: "Rojo" },
  yellow: { cls: "ql-st-yellow", sym: "▲", text: "Amarillo" },
  green: { cls: "ql-st-green", sym: "●", text: "Verde" },
};
/** Etiqueta de estado: color + símbolo + texto (nunca solo color). */
export function StateTag({ color, text }: { color: Color; text?: string }) {
  const s = ST[color];
  return <span className={`ql-st ${s.cls}`}><span aria-hidden="true">{s.sym} </span>{text ?? s.text}</span>;
}
export const NeutralTag = ({ children, partial, title }: { children: ReactNode; partial?: boolean; title?: string }) => <span className={`ql-st ${partial ? "ql-st-partial" : "ql-st-grey"}`} title={title}>{children}</span>;

export type CellInfo = { main: string | null; color: Color | null; label: string; kind: "COLOR" | "UNCALIBRATED" | "PARTIAL" | "NODATA" | "BLANK" | "ZERO"; observed: string | null };
/** Motivo corto de un valor ausente, parcial o sin calibrar (texto accesible de la celda). */
export const reasonOf = (i: IndicatorOutcome): string => i.reason || STATUS_TEXT[i.status] || i.status;

/**
 * Qué muestra una celda del resumen. Un cero confirmado, un valor parcial, una celda sin calibrar, un dato ausente y un feedback en blanco son
 * distintos y ninguno produce un verde: el color solo existe si el evaluador lo calculó con umbral configurado.
 */
export function cellInfo(i: IndicatorOutcome, observed: string | null): CellInfo {
  if (i.key === "HEALTH") {
    if (i.availability === "BLANK" || i.value === null) return { main: null, color: null, label: "Sin informar", kind: "BLANK", observed: null };
    const cat = HEALTH_LABEL[i.value as HealthState] ?? "—";
    return i.color ? { main: cat, color: i.color, label: "", kind: "COLOR", observed: null } : { main: cat, color: null, label: "Sin calibrar", kind: "UNCALIBRATED", observed: null };
  }
  const obsNum = observed !== null && Number(observed) !== 0 ? observed : null;
  if (i.value === null) return { main: null, color: null, label: i.status === "SIN_DATO" ? "Sin dato" : (STATUS_TEXT[i.status] ?? i.status), kind: "NODATA", observed: obsNum };
  if (i.status === "PARCIAL") return { main: i.value, color: i.color, label: "Parcial", kind: "PARTIAL", observed: obsNum };
  if (i.color) return { main: i.value, color: i.color, label: "", kind: "COLOR", observed: null };
  const zero = Number(i.value) === 0 && i.availability === "AVAILABLE";
  return { main: i.value, color: null, label: zero ? "0 confirmado" : "Sin calibrar", kind: zero ? "ZERO" : "UNCALIBRATED", observed: null };
}
