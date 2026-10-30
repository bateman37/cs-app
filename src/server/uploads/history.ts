import { prisma } from "@/lib/db";
import { authorize } from "@/server/authorize";
import { pageResult, paging } from "@/server/common";

/** Historial de auditoría de un lote (altas, confirmaciones, activaciones...). Solo Administrador. */
export async function listUploadHistory(actorId: string, batchId: string, query: { page?: number; pageSize?: number } = {}) {
  await authorize(prisma, actorId, "ADMIN");
  const { page, pageSize, skip, take } = paging({ pageSize: 10, ...query });
  const [rows, total] = await Promise.all([
    prisma.auditEvent.findMany({ where: { batchId }, orderBy: [{ at: "desc" }, { id: "desc" }], skip, take }),
    prisma.auditEvent.count({ where: { batchId } }),
  ]);
  return pageResult(rows, total, page, pageSize);
}
