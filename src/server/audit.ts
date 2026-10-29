import type { Prisma } from "@/generated/prisma/client";
import type { AuditAction } from "@/generated/prisma/enums";
import type { Actor } from "@/lib/access";

export type AuditInput = {
  action: AuditAction;
  entityType: string;
  entityId: string;
  groupId?: string | null;
  clientId?: string | null;
  personId?: string | null;
  batchId?: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
};

/** Normaliza un registro a JSON (fechas como texto) para el antes/después. */
export function snapshot(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Registra un evento dentro de la misma transacción que el cambio. */
export async function recordAudit(tx: Prisma.TransactionClient, actor: Actor, e: AuditInput) {
  await tx.auditEvent.create({
    data: {
      actorId: actor.id,
      actorEmail: actor.email,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      groupId: e.groupId ?? null,
      clientId: e.clientId ?? null,
      personId: e.personId ?? null,
      batchId: e.batchId ?? null,
      summary: e.summary,
      before: snapshot(e.before),
      after: snapshot(e.after),
    },
  });
}
