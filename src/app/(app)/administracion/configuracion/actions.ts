"use server";

import type { FormState } from "@/components/form-kit";
import { runAdminAction } from "@/app/action-utils";
import { updateSettings } from "@/server/economics/settings";

export async function updateSettingsAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAdminAction(fd, (a, raw) => updateSettings(a, raw), {
    ok: "Nueva revisión de la configuración económica guardada y auditada.",
    paths: ["/administracion/configuracion", "/administracion/economia"],
  });
}
