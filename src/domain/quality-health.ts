/**
 * Client Health mensual (CSAPP-08 §4), reglas puras. Estados: POSITIVE | NEGATIVE | MIXED | NONE (celda limpiada = sin feedback).
 * El dato pertenece al MES elegido y puede haberse registrado después; si solo se conoce el mes, la fecha dentro del mes no se informa y el uso es
 * mensual/provisional. No se registra feedback con fecha concreta futura, no hay arrastre del mes anterior ni prellenado en verde.
 */
import { z } from "zod";
import { isIsoDate } from "./vigencia";
import type { HealthState } from "./quality-config";

export const HEALTH_DB_STATES = ["POSITIVE", "NEGATIVE", "MIXED", "NONE"] as const;
export type HealthDbState = (typeof HEALTH_DB_STATES)[number];
export const HEALTH_DB_LABEL: Record<HealthDbState, string> = { POSITIVE: "Positivo", NEGATIVE: "Negativo", MIXED: "Mixto", NONE: "Sin feedback" };
const TO_DOMAIN: Record<Exclude<HealthDbState, "NONE">, HealthState> = { POSITIVE: "positive", NEGATIVE: "negative", MIXED: "mixed" };
export const healthStateOf = (s: HealthDbState | null | undefined): HealthState | null => (s && s !== "NONE" ? TO_DOMAIN[s] : null);

export const COMMENT_MAX = 2000;

export const healthCellSchema = z.object({
  scope: z.enum(["group", "client"]),
  entityId: z.string().min(1).max(60),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  state: z.enum(HEALTH_DB_STATES),
  comment: z.string().max(COMMENT_MAX, `Máximo ${COMMENT_MAX} caracteres.`).optional().default(""),
  feedbackOn: z.string().optional().default(""),
  /** Versión que la persona vio (0 = celda sin registro). Evita que dos ediciones concurrentes se pisen. */
  expectedVersion: z.coerce.number().int().min(0).max(1_000_000),
});
export type HealthCellInput = z.infer<typeof healthCellSchema>;

/** Los comentarios son TEXTO: se guardan tal cual (sin interpretar HTML) y se normalizan los saltos de línea y espacios extremos. */
export const cleanComment = (s: string): string | null => {
  const t = s.replace(/\r\n?/g, "\n").trim();
  return t === "" ? null : t;
};

/** Fecha concreta del feedback: debe ser válida, no futura (hoy Europe/Madrid) y caer dentro del mes representado (vacía = no informada). */
export function validateFeedbackDate(raw: string, year: number, month: number, today: string): { ok: true; value: string | null } | { ok: false; message: string } {
  const t = raw.trim();
  if (t === "") return { ok: true, value: null };
  if (!isIsoDate(t)) return { ok: false, message: "Fecha no válida (AAAA-MM-DD)." };
  if (t > today) return { ok: false, message: "No se registra feedback ocurrido en una fecha futura como si ya hubiese sucedido." };
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  if (!t.startsWith(`${ym}-`)) return { ok: false, message: `La fecha debe estar dentro del mes representado (${ym}); si fue de otro mes, registre la celda de ese mes.` };
  return { ok: true, value: t };
}

/** Un mes futuro (posterior al mes en curso) no admite feedback: aún no ha sucedido. */
export const isFutureMonth = (year: number, month: number, today: string): boolean => `${year}-${String(month).padStart(2, "0")}` > today.slice(0, 7);

export type HealthUse = {
  /** El registro se guardó después de terminar el mes representado. */
  registeredLater: boolean;
  /** Fecha concreta posterior al corte diario: no se usa antes de ella. */
  notYetAtCut: boolean;
  precision: "DIA" | "MES";
  note: string;
};

/**
 * Uso temporal de una celda con respecto a un corte (CSAPP-08 §4): con fecha concreta posterior al corte no se usa; sin fecha dentro del mes se declara
 * el carácter mensual/provisional (no se afirma precisión diaria). El registro retroactivo se identifica (la corrección produce nueva referencia de cálculo).
 */
export function healthUse(cell: { year: number; month: number; feedbackOn: string | null; recordedOn: string }, cut: string): HealthUse {
  const ym = `${cell.year}-${String(cell.month).padStart(2, "0")}`;
  const registeredLater = cell.recordedOn.slice(0, 7) > ym;
  const notYetAtCut = cell.feedbackOn !== null && cell.feedbackOn > cut;
  const precision = cell.feedbackOn === null ? "MES" : "DIA";
  const note = notYetAtCut
    ? `Feedback del ${cell.feedbackOn}, posterior al corte ${cut}: no se usa antes de su fecha.`
    : cell.feedbackOn === null
      ? `Fecha dentro del mes no informada: se usa como dato mensual provisional (no hay precisión diaria).${registeredLater ? " Registrado después de terminar el mes." : ""}`
      : `Feedback del ${cell.feedbackOn}.${registeredLater ? " Registrado después de terminar el mes." : ""}`;
  return { registeredLater, notYetAtCut, precision, note };
}
