"use server";

import type { FormState } from "@/components/form-kit";
import { runAdminAction } from "@/app/action-utils";
import { cancelUpload, confirmUpload, reprocessUpload, revertUpload } from "@/server/uploads/batches";
import { decideTimeCorrection } from "@/server/zendesk/corrections";

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

/** Decisión explícita sobre una posible corrección de un registro de tiempo (solo con el lote listo). */
export async function decideCorrectionAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(
    fd,
    (a, raw) =>
      decideTimeCorrection(a, raw.id, {
        fingerprint: raw.fingerprint,
        decision: raw.decision,
        targetEntryId: raw.targetEntryId || undefined,
      }),
    { ok: "Decisión guardada y auditada.", paths: [`${BASE}/${fd.get("id")}`] },
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
