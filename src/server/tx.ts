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
  Person_name_ci_key: { message: "Ya existe una persona con ese nombre canónico.", field: "name" },
  StaffCatalogItem_kind_name_ci_key: { message: "Ya existe un valor con ese nombre en este catálogo.", field: "name" },
  PersonAlias_no_overlap: {
    message:
      "Otra operación simultánea (o una asignación existente) usa ya este alias/ID con una vigencia solapada en otra persona. Recargue y revise los alias; no se ha guardado nada.",
  },
  PersonTerm_no_overlap: {
    message: "Otra operación simultánea ha modificado las vigencias de este dato de la persona. Recargue y revise; no se ha guardado nada.",
  },
  UserMatrix_group_year_key: { message: "Otra operación simultánea ha creado ya la matriz de este año. Recargue y vuelva a intentarlo; no se ha guardado nada." },
  UserMatrix_client_year_key: { message: "Otra operación simultánea ha creado ya la matriz de este año. Recargue y vuelva a intentarlo; no se ha guardado nada." },
  UserMatrix_implementation_year_key: { message: "Otra operación simultánea ha creado ya la matriz de este año. Recargue y vuelva a intentarlo; no se ha guardado nada." },
  ServiceAssignment_no_overlap: {
    message: "Otra operación simultánea ha asignado este mismo valor con una vigencia solapada. Recargue y revise las asignaciones; no se ha guardado nada.",
  },
  EconomicSettingsRevision_revisionNo_key: {
    message: "Otra persona ha guardado una revisión de la configuración económica mientras editaba. Recargue y vuelva a intentarlo; no se ha guardado nada.",
  },
  UploadJob_open_per_batch_kind_key: { message: "Esta operación ya está en cola para el lote; no se ha duplicado." },
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
