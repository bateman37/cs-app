"use server";

import type { FormState } from "@/components/form-kit";
import { runAdminAction } from "@/app/action-utils";
import { decidePrecargaReview } from "@/server/precarga/review";

const BASE = "/administracion/cargas";

/**
 * Decisión sobre una revisión de la precarga de maestros. Solo viajan el lote, la clave de la revisión, la opción elegida y el motivo;
 * el servidor revalida el rol, que la opción sea una de las propuestas y que la revisión siga pendiente.
 */
export async function decideMastersReviewAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAdminAction(
    fd,
    (a, raw) => {
      const [decision, ...rest] = (raw.option ?? "").split("|");
      return decidePrecargaReview(a, raw.id, { key: raw.key, decision, value: rest.join("|") || undefined, reason: raw.reason });
    },
    { ok: "Decisión guardada y auditada.", paths: [BASE, `${BASE}/${fd.get("id")}`] },
  );
}
