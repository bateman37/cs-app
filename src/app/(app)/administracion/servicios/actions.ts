"use server";

import type { FormState } from "@/components/form-kit";
import { runAdminAction } from "@/app/action-utils";
import { createServiceAssignment, setServiceAssignmentActive, updateServiceAssignment } from "@/server/economics/service-assignments";

const PATHS = ["/administracion/servicios", "/administracion/economia"];

export async function createServiceAssignmentAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAdminAction(fd, (a, raw) => createServiceAssignment(a, raw), { ok: "Asignación de servicio guardada y auditada.", paths: PATHS });
}
export async function updateServiceAssignmentAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAdminAction(fd, (a, raw) => updateServiceAssignment(a, raw.id, raw), { ok: "Asignación modificada y auditada.", paths: PATHS });
}
export async function toggleServiceAssignmentAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAdminAction(fd, (a, raw) => setServiceAssignmentActive(a, raw.id, raw.active === "true", Number(raw.expectedVersion)), { ok: "Estado de la asignación actualizado.", paths: PATHS });
}
