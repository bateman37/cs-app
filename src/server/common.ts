import type { Prisma } from "@/generated/prisma/client";
import type { TargetType } from "@/domain/catalogs";
import { TARGET_LABEL } from "@/domain/catalogs";
import { DomainError } from "./errors";

export type ListQuery = {
  q?: string;
  status?: "active" | "inactive" | "all";
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export type ListResult<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export function paging(q: { page?: number; pageSize?: number }) {
  const pageSize = Math.min(Math.max(q.pageSize ?? 20, 5), 100);
  const page = Math.max(q.page ?? 1, 1);
  return { pageSize, page, skip: (page - 1) * pageSize, take: pageSize };
}

export function pageResult<T>(rows: T[], total: number, page: number, pageSize: number): ListResult<T> {
  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export function statusWhere(status: ListQuery["status"]): { isActive?: boolean } {
  if (status === "inactive") return { isActive: false };
  if (status === "all") return {};
  return { isActive: true };
}

export type ScopeFk = { groupId?: string; clientId?: string; implementationId?: string };

export type ResolvedTarget = {
  type: TargetType;
  id: string;
  name: string;
  isActive: boolean;
  fk: ScopeFk;
  /** Contexto de auditoría para mostrar el evento en la ficha de grupo y de cliente. */
  groupId: string | null;
  clientId: string | null;
};

/** Localiza el ámbito (grupo, cliente o implantación); si se exige, debe estar activo. */
export async function resolveTarget(
  tx: Prisma.TransactionClient,
  type: TargetType,
  id: string,
  opts: { requireActive: boolean },
): Promise<ResolvedTarget> {
  let found: ResolvedTarget | null = null;
  if (type === "group") {
    const g = await tx.clientGroup.findUnique({ where: { id } });
    if (g) found = { type, id, name: g.name, isActive: g.isActive, fk: { groupId: id }, groupId: id, clientId: null };
  } else if (type === "client") {
    const c = await tx.client.findUnique({ where: { id } });
    if (c) found = { type, id, name: c.name, isActive: c.isActive, fk: { clientId: id }, groupId: c.groupId, clientId: id };
  } else {
    const i = await tx.implementation.findUnique({ where: { id }, include: { client: true } });
    if (i) {
      found = {
        type,
        id,
        name: `${i.client.name} › ${i.name}`,
        isActive: i.isActive && i.client.isActive,
        fk: { implementationId: id },
        groupId: i.client.groupId,
        clientId: i.clientId,
      };
    }
  }
  if (!found) throw new DomainError(`${TARGET_LABEL[type]} no encontrado.`);
  if (opts.requireActive && !found.isActive) {
    throw new DomainError(`${TARGET_LABEL[type]} «${found.name}» está inactivo: no admite nuevas asignaciones hasta reactivarlo.`);
  }
  return found;
}

/** Actualización con control de versión; falla si otra persona cambió el registro antes. */
export function versionGuard(expected: number) {
  return { version: expected };
}
