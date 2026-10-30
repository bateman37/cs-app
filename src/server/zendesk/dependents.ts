import { Prisma } from "@/generated/prisma/client";
import { rederiveWorkItemLinks } from "../bugs/links";
import { rederiveWrikeEntries } from "../wrike/derive";

type Tx = Prisma.TransactionClient;

/**
 * Recálculo de lo que depende de los tickets (llegada, cambio o reversión de un lote de tickets): imputaciones Wrike (ticket
 * confirmado, cliente, causa) y vínculos Work Item–ticket. Se ejecuta DENTRO de la transacción del motor, que ya tomó el bloqueo
 * de ámbito y el bloqueo de derivación (siempre en ese orden), de modo que no hay recálculos recursivos ni carreras: ningún
 * recálculo dispara otro.
 */
export async function rederiveDependents(tx: Tx, ticketIds: Prisma.Sql, batchId: string | null): Promise<number> {
  const wrike = await rederiveWrikeEntries(tx, Prisma.sql`e."drvTicketId" IN (${ticketIds})`, batchId);
  const links = await rederiveWorkItemLinks(tx, Prisma.sql`l."ticketId" IN (${ticketIds})`);
  return wrike + links;
}
