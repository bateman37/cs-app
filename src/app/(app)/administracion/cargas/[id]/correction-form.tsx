"use client";

import { ActionForm, SubmitButton } from "@/components/form-kit";
import { decideCorrectionAction } from "../actions";

/** Confirmación expresa de ESTA sustitución concreta: el servidor valida el registro, su revisión y la versión del lote. */
export function ReplaceForm({
  batchId,
  fingerprint,
  targetId,
  targetRevision,
  batchVersion,
}: {
  batchId: string;
  fingerprint: string;
  targetId: string;
  targetRevision: number;
  batchVersion: number;
}) {
  return (
    <ActionForm
      action={decideCorrectionAction}
      className="form"
      id="form-sustitucion"
      hidden={{ id: batchId, fingerprint, decision: "CORRECTION", targetEntryId: targetId, expectedEntryRevision: targetRevision, expectedBatchVersion: batchVersion }}
    >
      <div className="field field-check">
        <input id="confirmReplace" name="confirmReplace" type="checkbox" />
        <label htmlFor="confirmReplace">Confirmo que esta fila sustituye a este registro concreto (se crea una revisión; no se suman ambas duraciones).</label>
      </div>
      <div className="form-actions">
        <SubmitButton pending="Guardando…">Confirmar sustitución</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** «Es otro trabajo» y «retirar la decisión»: cada botón es una función de servidor con el identificador del lote. */
export function DecisionButtons({ batchId, fingerprint, batchVersion, hasDecision }: { batchId: string; fingerprint: string; batchVersion: number; hasDecision: boolean }) {
  return (
    <ul className="row-actions" style={{ listStyle: "none", padding: 0 }} aria-label="Otras decisiones sobre la fila">
      <li>
        <ActionForm action={decideCorrectionAction} className="inline-form" hidden={{ id: batchId, fingerprint, decision: "DIFFERENT", expectedBatchVersion: batchVersion }}>
          <SubmitButton variant="secondary" pending="Guardando…">Es otro trabajo</SubmitButton>
        </ActionForm>
      </li>
      {hasDecision ? (
        <li>
          <ActionForm action={decideCorrectionAction} className="inline-form" hidden={{ id: batchId, fingerprint, decision: "CLEAR", expectedBatchVersion: batchVersion }}>
            <SubmitButton variant="secondary" pending="Guardando…">Retirar la decisión</SubmitButton>
          </ActionForm>
        </li>
      ) : null}
    </ul>
  );
}
