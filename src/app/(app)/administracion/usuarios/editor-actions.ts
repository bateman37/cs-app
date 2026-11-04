"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { AccessError } from "@/lib/access";
import { requireAdminActor } from "@/lib/session";
import { DomainError } from "@/server/errors";
import { applyMatrixBatch, previewMatrixBatch, type BatchResult } from "@/server/usuarios";

/**
 * Acciones del editor de la matriz de usuarios contratados (HOTFIX-04 §6). La vista previa no escribe; el guardado solo se ejecuta tras la confirmación y es un lote
 * atómico (una versión por matriz). El año editable, la sesión y el rol Administrador se comprueban SIEMPRE en servidor con su reloj Europe/Madrid.
 */
export type UsuariosActionResult = { status: "ok"; result: BatchResult } | { status: "error"; message: string };

async function guard(work: (actorId: string) => Promise<BatchResult>): Promise<UsuariosActionResult> {
  try {
    const actor = await requireAdminActor();
    return { status: "ok", result: await work(actor.id) };
  } catch (error) {
    if (error instanceof DomainError || error instanceof AccessError) return { status: "error", message: error.message };
    console.error("Error inesperado en el editor de usuarios contratados", error instanceof Error ? error.name : "desconocido");
    return { status: "error", message: "No se ha podido completar la operación por un error interno. No se ha guardado nada; inténtelo de nuevo y, si persiste, avise al administrador del sistema." };
  }
}

export async function previewUsuariosBatchAction(input: unknown): Promise<UsuariosActionResult> {
  return guard((id) => previewMatrixBatch(id, input));
}

export async function saveUsuariosBatchAction(input: unknown): Promise<UsuariosActionResult> {
  const out = await guard((id) => applyMatrixBatch(id, input));
  if (out.status === "ok" && out.result.ok) {
    revalidatePath("/administracion/usuarios");
    revalidatePath("/comparativa");
  }
  return out;
}
