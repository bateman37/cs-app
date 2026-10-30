/**
 * Estados del lote de carga y acciones válidas por estado (sin dependencias de servidor).
 * El cliente nunca fuerza un estado: las acciones son servicios que validan estas transiciones
 * con compare-and-set sobre la base de datos.
 */
export const UPLOAD_STATUSES = [
  "RECEIVING",
  "QUEUED",
  "PREPARING",
  "READY",
  "ACTIVATION_QUEUED",
  "ACTIVATING",
  "COMPLETED",
  "REJECTED",
  "FAILED",
  "CANCELLED",
  "REVERTED",
] as const;
export type UploadStatusName = (typeof UPLOAD_STATUSES)[number];

export const STATUS_LABEL: Record<UploadStatusName, string> = {
  RECEIVING: "Recibiendo archivo",
  QUEUED: "En cola",
  PREPARING: "Validando y preparando",
  READY: "Listo para revisar",
  ACTIVATION_QUEUED: "Confirmado, en cola de activación",
  ACTIVATING: "Activando",
  COMPLETED: "Completado",
  REJECTED: "Rechazado",
  FAILED: "Con error",
  CANCELLED: "Cancelado",
  REVERTED: "Revertido",
};

export const TERMINAL_STATUSES: readonly UploadStatusName[] = ["COMPLETED", "REJECTED", "FAILED", "CANCELLED", "REVERTED"];

/** Estados en los que el lote puede cancelarse (antes de comenzar la activación). */
export const CANCELLABLE: readonly UploadStatusName[] = ["RECEIVING", "QUEUED", "PREPARING", "READY", "ACTIVATION_QUEUED"];
export const REPROCESSABLE: readonly UploadStatusName[] = ["READY", "REJECTED", "FAILED"];

export type UploadAction = "confirm" | "cancel" | "reprocess" | "revert";

export type ActionAvailability = { allowed: boolean; reason?: string };

/** Acciones permitidas por estado, con el motivo cuando no lo están. */
export function availableActions(
  status: UploadStatusName,
  opts: { supportsRevert?: boolean; isCurrentOfScope?: boolean } = {},
): Record<UploadAction, ActionAvailability> {
  const no = (reason: string): ActionAvailability => ({ allowed: false, reason });
  const yes: ActionAvailability = { allowed: true };
  return {
    confirm:
      status === "READY"
        ? yes
        : no(
            status === "ACTIVATION_QUEUED" || status === "ACTIVATING" || status === "COMPLETED"
              ? "El lote ya está confirmado."
              : "Solo se puede confirmar un lote listo para revisar.",
          ),
    cancel: CANCELLABLE.includes(status)
      ? yes
      : status === "ACTIVATING"
        ? no(
            "La activación aplica los cambios en una única transacción atómica: no se cancela con una petición. Si falla, se deshace por completo y los datos activos anteriores quedan intactos.",
          )
        : no("El lote ya no admite cancelación."),
    reprocess: REPROCESSABLE.includes(status)
      ? yes
      : no("Solo se puede reprocesar un lote listo, rechazado o con error. Para uno completado use «Revertir»."),
    revert:
      status !== "COMPLETED"
        ? no("Solo se puede revertir un lote completado.")
        : opts.supportsRevert === false
          ? no("El perfil de esta fuente no admite revertir.")
          : opts.isCurrentOfScope === false
            ? no("Este lote ya fue sustituido por otro del mismo ámbito: revierta primero el posterior.")
            : yes,
  };
}

/** Definiciones de los contadores de la ficha (mismo texto en la interfaz y la documentación). */
export const COUNTER_DEFINITIONS = {
  rowsReceived: "Filas de datos leídas del archivo (sin contar vacías ni la cabecera).",
  rowsError: "Filas con al menos un error: no se activan.",
  rowsValid: "Recibidas menos con error. Incluye duplicadas, excluidas, revisadas y nuevas.",
  rowsDuplicate: "Filas idénticas a otra anterior del mismo archivo o ya aportadas por un lote vigente: se materializan una vez.",
  rowsExcluded: "Filas válidas fuera del cálculo por una relación no resuelta; conservan el bruto y el motivo.",
  rowsReviewed: "Filas cuya clave de entidad ya existe con contenido distinto (revisiones).",
  rowsWarning: "Filas con al menos un aviso.",
  rowsImported: "Filas materializadas en los datos activos. Solo tienen valor después de activar.",
} as const;
