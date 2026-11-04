import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { authorize } from "@/server/authorize";
import { ensureInitialSettings } from "@/server/economics/settings";

/**
 * Lectura coherente de las pantallas analíticas (CSAPP-06 §10): todo lo que una respuesta muestra (cartera, series, cohortes y desgloses)
 * se lee dentro de UNA transacción REPEATABLE READ de solo lectura, con el cliente de la transacción (los ayudantes no usan el `prisma`
 * global). La transacción no se mantiene abierta mientras la persona decide qué pulsar: se abre, lee y se cierra en cada petición.
 */
export type Tx = Prisma.TransactionClient;

export async function readSnapshot<T>(actorId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  // HOTFIX-04 §8: la reposición de la revisión 1 de la configuración económica es una ESCRITURA y no puede ocurrir dentro de la lectura REPEATABLE READ: dos lecturas
  // simultáneas fallaban con 40001 («could not serialize access…», P2010 en Prisma). Se garantiza antes, fuera de la instantánea (autocommit e idempotente).
  await ensureInitialSettings(prisma);
  return prisma.$transaction(
    async (tx) => {
      // La primera sentencia fija la instantánea; el permiso se comprueba contra la base en ella.
      await authorize(tx, actorId, "READ");
      return fn(tx);
    },
    { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 120_000 },
  );
}

// ---- Gancho de sincronización SOLO para pruebas: no hay forma de registrarlo desde navegador ni en producción.
type Hook = (point: string) => Promise<void>;
let hook: Hook | null = null;
export function setSnapshotTestHook(h: Hook | null): void {
  if (process.env.NODE_ENV !== "test") throw new Error("El gancho de sincronización solo existe en pruebas.");
  hook = h;
}
export async function snapshotPoint(name: string): Promise<void> {
  if (hook && process.env.NODE_ENV === "test") await hook(name);
}
