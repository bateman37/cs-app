import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { authorize } from "./authorize";
import type { Actor } from "@/lib/access";
import { DomainError, violatedConstraint } from "./errors";

/** Mensajes de las restricciones de integridad más habituales. */
const CONSTRAINT_MESSAGES: Record<string, { message: string; field?: string }> = {
  ClientGroup_name_ci_key: { message: "Ya existe un Grupo Cliente con ese nombre.", field: "name" },
  Client_group_name_ci_key: { message: "Ya existe un Cliente con ese nombre en el mismo grupo (o sin grupo).", field: "name" },
  Implementation_client_name_ci_key: { message: "Este Cliente ya tiene una implantación con ese nombre.", field: "name" },
  Implementation_client_key_ci_key: { message: "Este Cliente ya tiene una implantación con esa clave.", field: "key" },
  ExternalIdentity_no_overlap: {
    message: "Otra operación simultánea ha asignado esta misma identidad con una vigencia solapada. Recargue y revise las equivalencias; no se ha guardado nada.",
  },
  ServiceTerm_no_overlap: {
    message: "Otra operación simultánea ha modificado las vigencias de este dato. Recargue y revise; no se ha guardado nada.",
  },
  Product_name_ci_key: { message: "Ya existe un producto con ese nombre.", field: "name" },
};

/**
 * Ejecuta una operación de escritura de administrador en una transacción única:
 * comprueba el permiso con la base, aplica el cambio y su auditoría, y traduce
 * los incumplimientos de integridad en mensajes comprensibles.
 */
export async function adminTransaction<T>(
  actorId: string,
  work: (tx: Prisma.TransactionClient, actor: Actor) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const actor = await authorize(tx, actorId, "ADMIN");
        return work(tx, actor);
      },
      { maxWait: 5000, timeout: 15000 },
    );
  } catch (error) {
    if (error instanceof DomainError) throw error;
    const v = violatedConstraint(error);
    if (v?.constraint && CONSTRAINT_MESSAGES[v.constraint]) {
      const { message, field } = CONSTRAINT_MESSAGES[v.constraint];
      throw new DomainError(message, field ? { [field]: message } : {});
    }
    throw error;
  }
}
