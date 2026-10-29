import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AccessError, type Actor } from "@/lib/access";

/** Usuario de la sesión actual, con rol y estado leídos de la base (no de la cookie). */
export const getCurrentUser = cache(async (): Promise<(Actor & { name: string }) | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
});

/** Para páginas: sin sesión redirige al acceso. */
export async function requirePageUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Para páginas de gestión: sin sesión redirige; sin permiso, a la portada. */
export async function requirePageAdmin() {
  const user = await requirePageUser();
  if (user.role !== "ADMIN") redirect("/administracion/clientes/grupos");
  return user;
}

/** Para acciones de servidor: lanzan AccessError, que la acción convierte en mensaje. */
export async function requireAdminActor(): Promise<Actor> {
  const user = await getCurrentUser();
  if (!user) throw new AccessError("UNAUTHENTICATED");
  if (user.role !== "ADMIN") throw new AccessError("FORBIDDEN");
  return user;
}
