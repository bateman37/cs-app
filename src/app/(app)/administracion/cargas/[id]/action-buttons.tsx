"use client";

import { ActionForm, SubmitButton } from "@/components/form-kit";
import { cancelUploadAction, confirmUploadAction, reprocessUploadAction, revertUploadAction } from "../actions";

type Av = { allowed: boolean; reason?: string };

/** Acciones por estado: solo se envía el identificador (y la versión); el servicio valida la transición. */
export function ActionButtons({ id, version, actions, completed = false }: { id: string; version: number; actions: { confirm: Av; cancel: Av; reprocess: Av; revert: Av }; completed?: boolean }) {
  const items: { key: keyof typeof actions; label: string; variant: "primary" | "secondary" | "danger"; action: typeof confirmUploadAction; hint: string }[] = [
    { key: "confirm", label: "Confirmar y activar", variant: "primary", action: confirmUploadAction, hint: "Solicita la activación atómica de las filas válidas." },
    { key: "reprocess", label: "Reprocesar", variant: "secondary", action: reprocessUploadAction, hint: completed ? "Recalcula relaciones y atribución con los maestros y fuentes actuales; no relee el archivo ni cambia fechas ni observaciones." : "Vuelve a validar el archivo original ya guardado." },
    { key: "cancel", label: "Cancelar", variant: "danger", action: cancelUploadAction, hint: "Solo antes de que comience la activación." },
    { key: "revert", label: "Revertir", variant: "danger", action: revertUploadAction, hint: "Deshace la aportación de este lote respetando filas compartidas." },
  ];
  return (
    <ul className="row-actions" style={{ listStyle: "none", padding: 0, alignItems: "flex-start" }} aria-label="Acciones del lote">
      {items.map((it) => {
        const av = actions[it.key];
        return (
          <li key={it.key} style={{ maxWidth: "24rem" }}>
            {av.allowed ? (
              <ActionForm action={it.action} className="inline-form" hidden={{ id, expectedVersion: version }}>
                <SubmitButton variant={it.variant} pending="Enviando…">{it.label}</SubmitButton>
                <small className="muted">{it.hint}</small>
              </ActionForm>
            ) : (
              <>
                <button type="button" className={`btn btn-${it.variant}`} disabled aria-disabled="true" title={av.reason}>{it.label}</button>
                <small className="muted" style={{ display: "block" }}>{av.reason}</small>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
