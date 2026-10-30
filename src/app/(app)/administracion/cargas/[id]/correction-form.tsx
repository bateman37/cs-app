"use client";

import { ActionForm, SubmitButton } from "@/components/form-kit";
import { decideCorrectionAction } from "../actions";

type Match = { id: string; hours: string; hourText: string | null };

/** Decisión explícita sobre una fila con posible corrección: cada botón es una función de servidor con el identificador del lote. */
export function CorrectionForm({ batchId, fingerprint, matches, decision }: { batchId: string; fingerprint: string; matches: Match[]; decision: string | null }) {
  return (
    <ul className="row-actions" style={{ listStyle: "none", padding: 0 }} aria-label="Decisión sobre la posible corrección">
      {matches.map((m) => (
        <li key={m.id}>
          <ActionForm action={decideCorrectionAction} className="inline-form" hidden={{ id: batchId, fingerprint, decision: "CORRECTION", targetEntryId: m.id }}>
            <SubmitButton variant="secondary" pending="Guardando…">Corrige el registro de {Number(m.hours).toLocaleString("es-ES", { maximumFractionDigits: 4 })} h{m.hourText ? ` (${m.hourText})` : ""}</SubmitButton>
          </ActionForm>
        </li>
      ))}
      <li>
        <ActionForm action={decideCorrectionAction} className="inline-form" hidden={{ id: batchId, fingerprint, decision: "DIFFERENT" }}>
          <SubmitButton variant="secondary" pending="Guardando…">Es otro trabajo</SubmitButton>
        </ActionForm>
      </li>
      {decision ? (
        <li>
          <ActionForm action={decideCorrectionAction} className="inline-form" hidden={{ id: batchId, fingerprint, decision: "CLEAR" }}>
            <SubmitButton variant="secondary" pending="Guardando…">Dejar sin decidir</SubmitButton>
          </ActionForm>
        </li>
      ) : null}
    </ul>
  );
}
