"use client";

import { ActionForm, SubmitButton } from "@/components/form-kit";
import { reviewLinkAction } from "../actions";

/** Revisión explícita de un vínculo Work Item–ticket con control de versión (auditada en servidor). */
export function LinkReviewForm({ batchId, workItemId, linkId, version, current }: { batchId: string; workItemId: string; linkId: string; version: number; current: string | null }) {
  const one = (decision: string, label: string) => (
    <li key={decision}>
      <ActionForm action={reviewLinkAction} className="inline-form" hidden={{ id: batchId, workItemId, linkId, expectedVersion: version, decision }}>
        <SubmitButton variant="secondary" pending="Guardando…">{label}</SubmitButton>
      </ActionForm>
    </li>
  );
  return (
    <ul className="row-actions" style={{ listStyle: "none", padding: 0 }} aria-label="Revisión del vínculo">
      {current !== "CONFIRMED" ? one("CONFIRMED", "Confirmar vínculo") : null}
      {current !== "REJECTED" ? one("REJECTED", "Rechazar vínculo") : null}
      {current ? one("CLEAR", "Retirar decisión") : null}
    </ul>
  );
}
