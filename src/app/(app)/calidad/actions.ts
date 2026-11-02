"use server";

import type { FormState } from "@/components/form-kit";
import { runAdminAction } from "@/app/action-utils";
import { saveHealthCell } from "@/server/quality/health";
import { addQualityNote } from "@/server/quality/notes";

/** Las acciones de Calidad son SOLO de Administrador: el permiso se comprueba en servidor (rol vigente leído de la base), no se confía en ocultar botones. */
export async function saveHealthCellAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAdminAction(fd, (a, raw) => saveHealthCell(a, raw), { ok: "Celda de Client Health guardada y auditada.", paths: ["/calidad", "/analisis-cliente"] });
}
export async function addNoteAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAdminAction(fd, (a, raw) => addQualityNote(a, raw), { ok: "Nota de revisión guardada.", paths: ["/calidad"] });
}
