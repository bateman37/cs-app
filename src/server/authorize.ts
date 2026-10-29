import { AccessError, type Actor } from "@/lib/access";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Comprobación de permisos centralizada. Se ejecuta contra la base en cada
 * operación (rol y estado vigentes), no se fía del objeto recibido.
 */
export async function authorize(db: Db, actorId: string, need: "READ" | "ADMIN"): Promise<Actor> {
  const user = await db.user.findUnique({
    where: { id: actorId },
    select: { id: true, email: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) throw new AccessError("UNAUTHENTICATED");
  if (need === "ADMIN" && user.role !== "ADMIN") throw new AccessError("FORBIDDEN");
  return { id: user.id, email: user.email, role: user.role };
}
