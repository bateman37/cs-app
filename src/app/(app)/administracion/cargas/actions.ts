"use server";

import type { FormState } from "@/components/form-kit";
import { runAdminAction } from "@/app/action-utils";
import { cancelUpload, confirmUpload, reprocessUpload, revertUpload } from "@/server/uploads/batches";
import { decideTimeCorrection } from "@/server/zendesk/corrections";
import { reviewWorkItemLink } from "@/server/bugs/summary";

const BASE = "/administracion/cargas";
type S = FormState;

/**
 * Las acciones nunca reciben un estado: solo el identificador del lote (y la versión visible para detectar
 * una confirmación sobre datos que cambiaron). El servicio valida la transición con compare-and-set.
 */
export async function confirmUploadAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(
    fd,
    (a, raw) => confirmUpload(a, raw.id, { expectedVersion: Number(raw.expectedVersion) }),
    { ok: "Carga confirmada: pasa a la cola de activación. El trabajador la activará en unos instantes.", paths: [BASE, `${BASE}/${fd.get("id")}`] },
  );
}

export async function cancelUploadAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(
    fd,
    async (a, raw) => {
      const r = await cancelUpload(a, raw.id);
      return r;
    },
    { ok: "Cancelación registrada. Si el lote se estaba preparando, se detendrá entre bloques.", paths: [BASE, `${BASE}/${fd.get("id")}`] },
  );
}

/**
 * Decisión explícita sobre una fila de tiempo (solo con el lote listo): corrige un registro activo concreto (con la revisión vista y la
 * confirmación expresa), es otro trabajo o se retira. El servidor valida fuente, lote, fila, estado, objetivo y versión.
 */
export async function decideCorrectionAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(
    fd,
    (a, raw) =>
      decideTimeCorrection(a, raw.id, {
        fingerprint: raw.fingerprint,
        decision: raw.decision,
        targetEntryId: raw.targetEntryId || undefined,
        expectedEntryRevision: raw.expectedEntryRevision || undefined,
        expectedBatchVersion: raw.expectedBatchVersion || undefined,
        confirmReplace: raw.confirmReplace === "on" || raw.confirmReplace === "true",
      }),
    { ok: "Decisión guardada y auditada.", paths: [`${BASE}/${fd.get("id")}`] },
  );
}

/** Revisión explícita de un vínculo Work Item–ticket (detalle administrativo). */
export async function reviewLinkAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(
    fd,
    (a, raw) => reviewWorkItemLink(a, { linkId: raw.linkId, decision: raw.decision, expectedVersion: raw.expectedVersion, note: raw.note || undefined }),
    { ok: "Revisión del vínculo guardada y auditada.", paths: [`${BASE}/${fd.get("id")}`, `${BASE}/${fd.get("id")}/elementos/${fd.get("workItemId")}`] },
  );
}

export async function reprocessUploadAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => reprocessUpload(a, raw.id), {
    ok: "Reproceso en cola: se reutiliza el archivo original.",
    paths: [BASE, `${BASE}/${fd.get("id")}`],
  });
}

export async function revertUploadAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => revertUpload(a, raw.id), {
    ok: "Reversión en cola: el trabajador la aplicará de forma atómica.",
    paths: [BASE, `${BASE}/${fd.get("id")}`],
  });
}
