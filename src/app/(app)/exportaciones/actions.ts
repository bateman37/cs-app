"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/form-kit";
import { rawFrom, toErrorState } from "@/app/action-utils";
import { getCurrentUser } from "@/lib/session";
import { AccessError } from "@/lib/access";
import { cancelExport, createExport, retryExport } from "@/server/exports/service";

/**
 * Acciones de exportación completa. Las pueden ejecutar Administrador y Consulta (el detalle que ya pueden leer); el servicio vuelve a comprobar sesión,
 * rol vigente y PROPIETARIO en la base en cada operación: nada se fía de qué botones se muestran.
 */
async function actorOrThrow(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new AccessError("UNAUTHENTICATED");
  return user.id;
}
async function run(fd: FormData, work: (actorId: string, raw: Record<string, string>) => Promise<unknown>, ok: string): Promise<FormState> {
  const raw = rawFrom(fd);
  try {
    await work(await actorOrThrow(), raw);
    revalidatePath("/", "layout");
    return { status: "ok", message: ok, nonce: Date.now() };
  } catch (e) {
    return toErrorState(e, raw);
  }
}
export async function requestExportAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(fd, (a, raw) => createExport(a, { dataset: raw.dataset ?? "", scope: raw.scope || "group", sel: raw.sel ?? "", desde: raw.desde ?? "", hasta: raw.hasta ?? "", servicio: raw.servicio || "TOTAL" }), "Exportación solicitada. Se genera en segundo plano: puede salir de esta pantalla y volver; su estado aparece debajo.");
}
export async function cancelExportAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(fd, (a, raw) => cancelExport(a, raw.id ?? ""), "Cancelación solicitada: se resuelve en la siguiente frontera segura.");
}
export async function retryExportAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(fd, (a, raw) => retryExport(a, raw.id ?? ""), "Exportación en cola de nuevo.");
}
