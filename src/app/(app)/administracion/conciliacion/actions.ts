"use server";

import type { FormState } from "@/components/form-kit";
import { runAdminAction } from "@/app/action-utils";
import { runReconciliation } from "@/server/reconciliation/service";

/** Solo Administrador (rol vigente leído de la base). Ejecutar solo LEE y registra el informe; no modifica fuentes ni configuración. */
export async function runReconciliationAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAdminAction(fd, (a, raw) => runReconciliation(a, { scope: raw.scope || "group", sel: raw.sel ?? "", desde: raw.desde ?? "", hasta: raw.hasta ?? "", servicio: raw.servicio || "TOTAL" }), {
    ok: "Comprobación ejecutada y registrada.", paths: ["/administracion/conciliacion"], redirectTo: (r) => `/administracion/conciliacion?informe=${r.id}`,
  });
}
