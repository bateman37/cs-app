import { prisma } from "@/lib/db";
import { provisionAccount } from "@/server/accounts";
import { guardedTruncateAll, resolveTestTarget } from "@/lib/test-guard";

/** Vacía la base de pruebas aprobada; la conexión efectiva se comprueba (current_database()) antes de cualquier TRUNCATE. */
export async function resetDatabase() {
  await guardedTruncateAll(prisma, resolveTestTarget());
}

export async function makeUsers() {
  await provisionAccount({ email: "admin@test.local", name: "Admin Test", password: "clave-de-prueba-123", role: "ADMIN" });
  await provisionAccount({ email: "lectura@test.local", name: "Lectura Test", password: "clave-de-prueba-456", role: "CONSULTA" });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } });
  const reader = await prisma.user.findUniqueOrThrow({ where: { email: "lectura@test.local" } });
  return { admin, reader };
}

export async function counts() {
  const [groups, clients, impls, identities, terms, milestones, audits] = await Promise.all([
    prisma.clientGroup.count(),
    prisma.client.count(),
    prisma.implementation.count(),
    prisma.externalIdentity.count(),
    prisma.serviceTerm.count(),
    prisma.milestone.count(),
    prisma.auditEvent.count(),
  ]);
  return { groups, clients, impls, identities, terms, milestones, audits };
}

/** Persiste la revisión 1 de Calidad con la configuración «de fábrica» anterior a HOTFIX-03 (todo sin calibrar): las pruebas del evaluador que verifican el comportamiento «sin calibrar» la usan de forma explícita. */
export async function useUncalibratedQuality(adminId: string) {
  const { uncalibratedQualityConfig } = await import("@/domain/quality-config");
  await prisma.configRevision.create({ data: { family: "QUALITY", revisionNo: 1, payload: uncalibratedQualityConfig() as never, reason: "Prueba: configuración sin calibrar (anterior a HOTFIX-03)", kind: "INITIAL", activatedById: adminId } });
}
