"use client";

import { ActionForm, SubmitButton } from "@/components/form-kit";
import { decideMastersReviewAction } from "./maestros-actions";

type Option = { decision: string; value?: string; label: string };

/** Decisión sobre una revisión de la precarga: opción propuesta + motivo obligatorio. La opción viaja como texto que el servidor valida contra las propuestas. */
export function MastersDecisionForm({ batchId, itemKey, options }: { batchId: string; itemKey: string; options: Option[] }) {
  const slug = itemKey.replace(/[^a-z0-9]+/gi, "-");
  return (
    <ActionForm action={decideMastersReviewAction} className="form" hidden={{ id: batchId, key: itemKey }}>
      <div className="field">
        <label htmlFor={`opt-${slug}`}>Decisión</label>
        <select id={`opt-${slug}`} name="option" defaultValue="">
          <option value="">Seleccione…</option>
          {options.map((o) => <option key={`${o.decision}|${o.value ?? ""}`} value={`${o.decision}|${o.value ?? ""}`}>{o.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`why-${slug}`}>Motivo (obligatorio)</label>
        <input id={`why-${slug}`} name="reason" type="text" maxLength={500} />
      </div>
      <div className="form-actions"><SubmitButton variant="secondary" pending="Guardando…">Guardar decisión</SubmitButton></div>
    </ActionForm>
  );
}
