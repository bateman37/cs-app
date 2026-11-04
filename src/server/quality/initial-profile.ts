import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { INITIAL_PROFILE_NOTE, defaultQualityConfig, isLegacyUncalibrated, readQualityPayload } from "@/domain/quality-config";

/**
 * Instalación idempotente de la configuración inicial de Calidad (HOTFIX-03 §12). Reglas:
 *  - Sin ninguna revisión de Calidad: se crea la revisión 1 con el perfil inicial (procedencia técnica `SYSTEM_INITIAL`, sin autor humano).
 *  - La revisión activa es la inicial «de fábrica» sin calibrar (nadie la calibró): se crea una revisión NUEVA con el perfil inicial. La anterior no se toca (inmutable).
 *  - La revisión activa es manual (calibrada por el Administrador) o ya es la inicial HOTFIX-03: no se hace nada. Un borrador existente se conserva intacto;
 *    su revisión base anterior queda visible en Administración (la comparación `baseRevisionNo` frente a la activa).
 *  - No se crean usuarios de acceso ni eventos de auditoría con un actor inventado: la procedencia queda en la propia revisión (tipo y motivo).
 */
export type InstallResult = { status: "INSTALLED" | "UP_TO_DATE" | "KEPT_MANUAL" | "INVALID_ACTIVE"; revisionNo: number | null; detail: string };

export const INITIAL_REASON_PREFIX = "Configuración inicial HOTFIX-03";

export async function installInitialQualityProfile(db: typeof prisma = prisma): Promise<InstallResult> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('csapp-config-QUALITY', 0))`);
    const latest = await tx.configRevision.findFirst({ where: { family: "QUALITY" }, orderBy: { revisionNo: "desc" } });
    const create = async (revisionNo: number, why: string) => {
      const payload = defaultQualityConfig();
      await tx.configRevision.create({ data: { family: "QUALITY", revisionNo, payload: payload as unknown as Prisma.InputJsonValue, reason: `${INITIAL_REASON_PREFIX}: ${INITIAL_PROFILE_NOTE} ${why}`.slice(0, 1000), kind: "SYSTEM_INITIAL", activatedById: null } });
    };
    if (!latest) {
      await create(1, "Instalación nueva.");
      return { status: "INSTALLED", revisionNo: 1, detail: "Revisión 1 creada con el perfil inicial." };
    }
    if (latest.kind === "SYSTEM_INITIAL" && (latest.reason ?? "").startsWith(INITIAL_REASON_PREFIX)) return { status: "UP_TO_DATE", revisionNo: latest.revisionNo, detail: "El perfil inicial ya está instalado." };
    const parsed = readQualityPayload(latest.payload);
    if (!parsed.ok) return { status: "INVALID_ACTIVE", revisionNo: latest.revisionNo, detail: "La revisión activa no cumple el contrato vigente: no se sobrescribe; revise Administración › Configuración › Calidad." };
    if (!isLegacyUncalibrated(parsed.payload)) return { status: "KEPT_MANUAL", revisionNo: latest.revisionNo, detail: "Hay una calibración activa distinta de la inicial anterior: se conserva sin cambios." };
    await create(latest.revisionNo + 1, `Sustituye a la revisión ${latest.revisionNo}, que seguía sin calibrar.`);
    return { status: "INSTALLED", revisionNo: latest.revisionNo + 1, detail: `Revisión ${latest.revisionNo + 1} creada; la ${latest.revisionNo} se conserva.` };
  });
}
