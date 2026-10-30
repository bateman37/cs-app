import { Prisma } from "@/generated/prisma/client";
import { writeStamp } from "../zendesk/preview";

type Tx = Prisma.TransactionClient;

/** Huella de los datos de los que dependen los vínculos de un lote de bugs (tickets y equivalencias); «Reprocesar» la renueva. */
export async function refreshBugsPreview(tx: Tx, batchId: string) {
  await writeStamp(tx, batchId, "bugs");
}
