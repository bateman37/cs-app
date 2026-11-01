import { AccessError } from "@/lib/access";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { authorize } from "@/server/authorize";
import { DomainError } from "@/server/errors";
import { json } from "@/server/uploads/http";

/** Sesión real y rol vigente (ADMIN o Consulta) leídos de la base. Devuelve el actor o la respuesta de rechazo. Nunca cacheable públicamente. */
export async function apiReader(request: Request): Promise<{ actorId: string } | Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return json({ error: "Debe iniciar sesión." }, 401);
  try {
    const actor = await authorize(prisma, session.user.id, "READ");
    return { actorId: actor.id };
  } catch (e) {
    if (e instanceof AccessError) return json({ error: e.message }, e.code === "UNAUTHENTICATED" ? 401 : 403);
    throw e;
  }
}

export function csvResponse(body: string, filename: string, stamp: string, requestedStamp: string): Response {
  const safe = filename.replace(/[^\w.\-]+/g, "_");
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${safe}"`,
      "cache-control": "private, no-store",
      vary: "Cookie",
      "x-content-type-options": "nosniff",
      "x-referencia-datos": stamp,
      // Si la persona vio otro estado de los datos, el archivo declara que es una lectura nueva (no simula la instantánea antigua).
      ...(requestedStamp && requestedStamp !== stamp ? { "x-referencia-solicitada": requestedStamp, "x-lectura-nueva": "1" } : {}),
    },
  });
}

export function analyticsError(e: unknown): Response {
  if (e instanceof AccessError) return json({ error: e.message }, e.code === "UNAUTHENTICATED" ? 401 : 403);
  if (e instanceof DomainError) return json({ error: e.message }, 400);
  console.error("Error inesperado en la exportación analítica", e instanceof Error ? e.name : "desconocido");
  return json({ error: "No se ha podido generar el archivo por un error interno." }, 500);
}
