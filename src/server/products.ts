import { prisma } from "@/lib/db";
import { productSchema, versionedSchema } from "@/domain/schemas";
import { authorize } from "./authorize";
import { recordAudit } from "./audit";
import { adminTransaction } from "./tx";
import { DomainError, StaleVersionError } from "./errors";
import { parseInput } from "./parse";

export async function listProducts(actorId: string) {
  await authorize(prisma, actorId, "READ");
  return prisma.product.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] });
}

export async function createProduct(actorId: string, raw: unknown) {
  const input = parseInput(productSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const product = await tx.product.create({ data: input });
    await recordAudit(tx, actor, {
      action: "CREATE",
      entityType: "Product",
      entityId: product.id,
      summary: `Alta del producto «${product.name}» en el catálogo`,
      after: product,
    });
    return product;
  });
}

export async function setProductActive(actorId: string, id: string, active: boolean, raw: unknown) {
  const { expectedVersion } = parseInput(versionedSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const before = await tx.product.findUnique({ where: { id } });
    if (!before) throw new DomainError("Producto no encontrado.");
    const res = await tx.product.updateMany({
      where: { id, version: expectedVersion },
      data: { isActive: active, version: { increment: 1 } },
    });
    if (res.count === 0) throw new StaleVersionError("El producto");
    const after = await tx.product.findUniqueOrThrow({ where: { id } });
    await recordAudit(tx, actor, {
      action: active ? "REACTIVATE" : "DEACTIVATE",
      entityType: "Product",
      entityId: id,
      summary: `${active ? "Reactivación" : "Desactivación"} del producto «${after.name}»`,
      before,
      after,
    });
    return after;
  });
}
