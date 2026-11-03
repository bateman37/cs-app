import type { IndicatorKey } from "./quality-config";

/**
 * Nombres completos de los seis accesos de Calidad (HOTFIX-02 §9). Son SOLO de presentación del panel: la configuración y Administración conservan
 * `INDICATOR_NAME`; las claves, definiciones y pesos no cambian.
 */
export const KPI_ACCESS_NAME: Record<IndicatorKey, string> = {
  HEALTH: "Client Health",
  DEDICATION: "Dedicación",
  PAP_CORRECTIVE: "PAP correctivos",
  N3_ESCALATIONS: "Escalados a N3",
  INCIDENTS_PROBLEMS: "Incidentes y problemas",
  BUGS_STANDARD: "Bugs y afectaciones",
};

/** Qué cuenta cada acceso (una línea, bajo el nombre). */
export const KPI_ACCESS_HINT: Record<IndicatorKey, string> = {
  HEALTH: "feedback del mes",
  DEDICATION: "horas elegibles",
  PAP_CORRECTIVE: "PAP únicos del mes",
  N3_ESCALATIONS: "tickets únicos",
  INCIDENTS_PROBLEMS: "altas del mes",
  BUGS_STANDARD: "problemas afectados",
};

/** Unidad corta del conteo observado de cada acceso. */
export const KPI_OBSERVED_UNIT: Record<IndicatorKey, string> = {
  HEALTH: "",
  DEDICATION: "h",
  PAP_CORRECTIVE: "PAP",
  N3_ESCALATIONS: "tickets",
  INCIDENTS_PROBLEMS: "tickets",
  BUGS_STANDARD: "tickets",
};

/** Unidad corta del ratio de cada indicador (la completa está en el cálculo). */
export const KPI_RATE_UNIT: Record<IndicatorKey, string> = {
  HEALTH: "",
  DEDICATION: "h/usuario·mes",
  PAP_CORRECTIVE: "/100 u·mes",
  N3_ESCALATIONS: "/100 u·mes",
  INCIDENTS_PROBLEMS: "/100 u·mes",
  BUGS_STANDARD: "/100 u·mes",
};
