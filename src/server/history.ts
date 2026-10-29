import { prisma } from "@/lib/db";
import { authorize } from "./authorize";
import { pageResult, paging } from "./common";

/** Historial administrativo de un grupo o cliente. Solo administradores. */
export async function listHistory(
  actorId: string,
  scope: { groupId: string } | { clientId: string },
  query: { page?: number; pageSize?: number } = {},
) {
  await authorize(prisma, actorId, "ADMIN");
  const { page, pageSize, skip, take } = paging({ pageSize: 15, ...query });
  const where = scope;
  const [rows, total] = await Promise.all([
    prisma.auditEvent.findMany({ where, orderBy: [{ at: "desc" }, { id: "desc" }], skip, take }),
    prisma.auditEvent.count({ where }),
  ]);
  return pageResult(rows, total, page, pageSize);
}
