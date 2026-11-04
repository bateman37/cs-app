"use client";

import { ActionForm, SubmitButton, TextField } from "@/components/form-kit";
import { LINK_STATE_LABEL, type LinkState, type LinkSystem } from "@/domain/master-links";
import { createGroupInlineAction, setLinkDecisionAction } from "./actions";

/** Alta rápida de Grupo en la propia tabla (compacta, con Guardar). */
export function NuevoGrupoInline() {
  return (
    <details className="mt-new">
      <summary className="btn btn-primary">Nuevo grupo</summary>
      <div className="mt-pop">
        <ActionForm action={createGroupInlineAction}>
          <TextField name="name" label="Nombre del Grupo" required maxLength={200} />
          <TextField name="bcDenomination" label="Denominación BC" maxLength={200} help="Opcional. El Grupo se crea activo y aparece como fila pendiente de completar." />
          <div className="form-actions"><SubmitButton>Crear grupo</SubmitButton></div>
        </ActionForm>
      </div>
    </details>
  );
}

const CHIP: Record<LinkState, string> = { CONFIGURED: "mt-ok", MISSING: "mt-miss", NOT_APPLICABLE: "mt-na", CONFLICT: "mt-conf" };
const SYMBOL: Record<LinkState, string> = { CONFIGURED: "✓", MISSING: "○", NOT_APPLICABLE: "–", CONFLICT: "⚠" };

/** Estado de un sistema con la acción rápida «No aplica» / «Retirar No aplica» (solo Administrador). Texto + símbolo: el color no es la única señal. */
export function StateCell({ state, entity, id, system, canEdit, children }: { state: LinkState; entity: "group" | "client"; id: string; system: LinkSystem; canEdit: boolean; children?: React.ReactNode }) {
  return (
    <div className="mt-cell">
      {children ? <div className="mt-vals">{children}</div> : null}
      <span className={`mt-chip ${CHIP[state]}`} title={LINK_STATE_LABEL[state]}><span aria-hidden="true">{SYMBOL[state]} </span>{LINK_STATE_LABEL[state]}</span>
      {canEdit && (state === "MISSING" || state === "NOT_APPLICABLE") ? (
        <ActionForm action={setLinkDecisionAction} className="inline-form" hidden={{ entity, id, system, notApplicable: String(state === "MISSING") }}>
          <SubmitButton variant="secondary" pending="…">{state === "MISSING" ? "No aplica" : "Retirar"}</SubmitButton>
        </ActionForm>
      ) : null}
    </div>
  );
}
