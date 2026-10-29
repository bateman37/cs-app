import { AccessError } from "@/lib/access";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { authorize } from "@/server/authorize";
import { DomainError } from "@/server/errors";
import { UploadBusyError, UploadLimitError } from "./batches";

/** Respuesta JSON privada (nunca cacheable). */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
}

/** Defensa CSRF de las rutas con cookie: el origen debe ser el de la aplicación. */
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(getEnv().BETTER_AUTH_URL).origin;
  } catch {
    return false;
  }
}

/** Sesión real y rol vigente leídos de la base. Devuelve el actor o la respuesta de rechazo. */
export async function apiAdmin(request: Request, opts: { checkOrigin: boolean }): Promise<{ actorId: string } | Response> {
  if (opts.checkOrigin && !originAllowed(request)) return json({ error: "Origen no permitido." }, 403);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return json({ error: "Debe iniciar sesión." }, 401);
  try {
    const actor = await authorize(prisma, session.user.id, "ADMIN");
    return { actorId: actor.id };
  } catch (e) {
    if (e instanceof AccessError) return json({ error: e.message }, e.code === "UNAUTHENTICATED" ? 401 : 403);
    throw e;
  }
}

export function errorResponse(e: unknown): Response {
  if (e instanceof AccessError) return json({ error: e.message }, e.code === "UNAUTHENTICATED" ? 401 : 403);
  if (e instanceof UploadLimitError) return json({ error: e.message }, 413);
  if (e instanceof UploadBusyError) return json({ error: e.message }, 429);
  if (e instanceof DomainError) return json({ error: e.message, campos: e.fields }, 400);
  console.error("Error inesperado en la API de cargas", e instanceof Error ? e.name : "desconocido");
  return json({ error: "No se ha podido completar la operación por un error interno." }, 500);
}
