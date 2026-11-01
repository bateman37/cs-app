"use client";

import { ActionForm, SubmitButton, TextField } from "@/components/form-kit";
import { decideFinanceAction, reviewFinanceImpactAction, revokeFinanceDecisionAction } from "../actions";

/** Decisión financiera: solo viaja el identificador del lote, el tipo, la clave y el motivo; el servidor valida todo. */
export function DecisionForm({
  batchId, version, kind, keyValue, label, reasonRequired = false, groups, help,
}: { batchId: string; version: number; kind: string; keyValue?: string; label: string; reasonRequired?: boolean; groups?: { id: string; name: string }[]; help?: string }) {
  return (
    <ActionForm action={decideFinanceAction} className="form" hidden={{ id: batchId, expectedVersion: version, kind, key: keyValue ?? "" }}>
      {groups ? (
        <div className="field">
          <label htmlFor={`g-${kind}-${keyValue}`}>Grupo Cliente del año</label>
          <select id={`g-${kind}-${keyValue}`} name="groupId" defaultValue="">
            <option value="">Seleccione…</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
      ) : null}
      <TextField name="reason" label={reasonRequired ? "Motivo (obligatorio)" : "Motivo (opcional)"} maxLength={500} help={help} />
      <div className="form-actions"><SubmitButton variant="secondary">{label}</SubmitButton></div>
    </ActionForm>
  );
}

export function RevokeForm({ batchId, version, kind, keyValue }: { batchId: string; version: number; kind: string; keyValue: string }) {
  return (
    <ActionForm action={revokeFinanceDecisionAction} className="inline-form" hidden={{ id: batchId, expectedVersion: version, kind, key: keyValue }}>
      <SubmitButton variant="danger" pending="Retirando…">Retirar decisión</SubmitButton>
    </ActionForm>
  );
}

export function ReviewForm({ batchId, version, upToDate }: { batchId: string; version: number; upToDate: boolean }) {
  return (
    <ActionForm action={reviewFinanceImpactAction} className="inline-form" hidden={{ id: batchId, expectedVersion: version }}>
      <SubmitButton variant="primary" pending="Revisando…">{upToDate ? "Actualizar la revisión del impacto" : "Revisar el impacto frente al conjunto vigente"}</SubmitButton>
    </ActionForm>
  );
}
