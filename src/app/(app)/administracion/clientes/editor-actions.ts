"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { AccessError } from "@/lib/access";
import { requireAdminActor } from "@/lib/session";
import { DomainError } from "@/server/errors";
import { applyMasterEdit, previewMasterEdit } from "@/server/master-edit";
import type { EditResult } from "@/domain/master-edit";

/**
 * Acciones del editor de Clientes (HOTFIX-04 §5). La vista previa NO escribe (transacción deshecha); el guardado solo se ejecuta tras la confirmación del
 * usuario y aplica el borrador completo de forma atómica. Sesión y rol Administrador se validan SIEMPRE en servidor: un Consulta no puede forzarlas.
 */
export type EditorActionResult = { status: "ok"; result: EditResult } | { status: "error"; message: string };

async function guard(work: (actorId: string) => Promise<EditResult>): Promise<EditorActionResult> {
  try {
    const actor = await requireAdminActor();
    return { status: "ok", result: await work(actor.id) };
  } catch (error) {
    if (error instanceof DomainError || error instanceof AccessError) return { status: "error", message: error.message };
    console.error("Error inesperado en el editor de Clientes", error instanceof Error ? error.name : "desconocido");
    return { status: "error", message: "No se ha podido completar la operación por un error interno. No se ha guardado nada; inténtelo de nuevo y, si persiste, avise al administrador del sistema." };
  }
}

export async function previewClientesEditAction(input: unknown): Promise<EditorActionResult> {
  return guard((id) => previewMasterEdit(id, input));
}

export async function saveClientesEditAction(input: unknown): Promise<EditorActionResult> {
  const out = await guard((id) => applyMasterEdit(id, input));
  if (out.status === "ok" && out.result.ok) {
    revalidatePath("/administracion/clientes");
    revalidatePath("/administracion", "layout");
  }
  return out;
}
