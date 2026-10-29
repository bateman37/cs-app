import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AccessError } from "@/lib/access";
import { requireAdminActor } from "@/lib/session";
import { DomainError } from "@/server/errors";
import type { FormState } from "@/components/form-kit";

export function rawFrom(formData: FormData): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string" && !k.startsWith("$ACTION")) raw[k] = v;
  }
  return raw;
}

/** «tipo:id» → targetType/targetId, para los selectores de ámbito. */
export function withScope(raw: Record<string, string>): Record<string, string> {
  const [type, ...rest] = (raw.scope ?? "").split(":");
  return { ...raw, targetType: type ?? "", targetId: rest.join(":") };
}

type Options<R> = {
  ok: string;
  paths?: string[];
  redirectTo?: (result: R) => string;
};

/**
 * Ejecuta una acción de administración: permiso en servidor, validación, mensajes
 * comprensibles y, si procede, redirección tras guardar. Nunca expone detalles internos.
 */
export async function runAdminAction<R>(
  formData: FormData,
  work: (actorId: string, raw: Record<string, string>) => Promise<R>,
  options: Options<R>,
): Promise<FormState> {
  const raw = rawFrom(formData);
  let target: string | null = null;
  try {
    const actor = await requireAdminActor();
    const result = await work(actor.id, raw);
    for (const p of options.paths ?? []) revalidatePath(p);
    if (options.redirectTo) target = options.redirectTo(result);
    else return { status: "ok", message: options.ok, nonce: Date.now() };
  } catch (error) {
    return toErrorState(error, raw);
  }
  redirect(target);
}

export function toErrorState(error: unknown, raw: Record<string, string>): FormState {
  const values = { ...raw };
  delete values.expectedVersion;
  if (error instanceof DomainError) {
    return { status: "error", message: error.message, fieldErrors: error.fields, values: raw, nonce: Date.now() };
  }
  if (error instanceof AccessError) {
    return { status: "error", message: error.message, nonce: Date.now(), values: raw };
  }
  console.error("Error inesperado en una acción de administración", error instanceof Error ? error.name : "desconocido");
  return {
    status: "error",
    message: "No se ha podido guardar por un error interno. Inténtelo de nuevo; si persiste, avise al administrador del sistema.",
    values: raw,
    nonce: Date.now(),
  };
}
