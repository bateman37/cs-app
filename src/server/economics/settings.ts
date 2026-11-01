import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/server/uploads/profile";
import { prisma } from "@/lib/db";
import { Dec } from "@/domain/finance";
import { recordAudit } from "@/server/audit";
import { authorize } from "@/server/authorize";
import { DomainError, StaleVersionError } from "@/server/errors";
import { adminTransaction } from "@/server/tx";

/**
 * Configuración económica mínima (CSAPP-05): objetivo €/jornada, horas de jornada y tolerancia de conciliación.
 * Cada cambio es una revisión inmutable con autor y fecha; nunca se sobrescribe una revisión anterior. Los parámetros
 * de negocio no se leen de variables de entorno. La tolerancia de 0,01 € es técnica y propuesta (CAL 08).
 */
export type EconomicSettings = {
  revisionId: string;
  revisionNo: number;
  targetEurosPerDay: string;
  dayHours: string;
  reconciliationTolerance: string;
  reason: string | null;
  activatedAt: string;
  activatedByEmail: string | null;
};

export const INITIAL_SETTINGS = { targetEurosPerDay: "550", dayHours: "8", reconciliationTolerance: "0.01" } as const;

type Row = {
  id: bigint;
  revisionNo: number;
  targetEurosPerDay: Prisma.Decimal;
  dayHours: Prisma.Decimal;
  reconciliationTolerance: Prisma.Decimal;
  reason: string | null;
  activatedAt: Date;
  activatedBy: { email: string } | null;
};

const dec = (d: Prisma.Decimal) => Dec.parse(d.toFixed())?.toString() ?? d.toString();

function shape(r: Row): EconomicSettings {
  return {
    revisionId: r.id.toString(),
    revisionNo: r.revisionNo,
    targetEurosPerDay: dec(r.targetEurosPerDay),
    dayHours: dec(r.dayHours),
    reconciliationTolerance: dec(r.reconciliationTolerance),
    reason: r.reason,
    activatedAt: r.activatedAt.toISOString(),
    activatedByEmail: r.activatedBy?.email ?? null,
  };
}

/** Garantiza la revisión 1 (la migración la crea; esto la repone si una base de pruebas se vació). Idempotente y sin carreras. */
export async function ensureInitialSettings(db: Db): Promise<void> {
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "EconomicSettingsRevision" ("revisionNo", "targetEurosPerDay", "dayHours", "reconciliationTolerance", "reason")
    SELECT 1, ${INITIAL_SETTINGS.targetEurosPerDay}::numeric, ${INITIAL_SETTINGS.dayHours}::numeric, ${INITIAL_SETTINGS.reconciliationTolerance}::numeric,
      'Configuración inicial: objetivo 550 €/jornada y jornada de 8 h confirmados; tolerancia de conciliación 0,01 € técnica y propuesta.'
    WHERE NOT EXISTS (SELECT 1 FROM "EconomicSettingsRevision")
    ON CONFLICT ("revisionNo") DO NOTHING`);
}

/** Última revisión activa, o la revisión indicada (para recalcular con parámetros anteriores de forma identificada). */
export async function getSettings(db: Db, revisionNo?: number): Promise<EconomicSettings> {
  await ensureInitialSettings(db);
  const r = await db.economicSettingsRevision.findFirst({
    where: revisionNo === undefined ? {} : { revisionNo },
    orderBy: { revisionNo: "desc" },
    include: { activatedBy: { select: { email: true } } },
  });
  if (!r) throw new DomainError(`No existe la revisión ${revisionNo} de la configuración económica.`);
  return shape(r);
}

export async function listSettingsRevisions(actorId: string): Promise<EconomicSettings[]> {
  await authorize(prisma, actorId, "READ");
  await ensureInitialSettings(prisma);
  const rows = await prisma.economicSettingsRevision.findMany({ orderBy: { revisionNo: "desc" }, include: { activatedBy: { select: { email: true } } } });
  return rows.map(shape);
}

const fieldDec = (raw: unknown, label: string, opts: { positive: boolean; max: string }) => {
  const text = String(raw ?? "").trim().replace(",", ".");
  const d = Dec.parse(text);
  if (d === null) throw new DomainError("Revise los campos marcados.", { [label]: "Indique un número (decimales con coma o punto)." });
  if (opts.positive ? d.sign() <= 0 : d.sign() < 0) throw new DomainError("Revise los campos marcados.", { [label]: opts.positive ? "Debe ser mayor que cero." : "No puede ser negativo." });
  if (d.cmp(Dec.parse(opts.max) as Dec) > 0) throw new DomainError("Revise los campos marcados.", { [label]: `No puede superar ${opts.max}.` });
  return d.toString();
};

/** Nueva revisión (solo Administrador). `expectedRevisionNo` detecta una edición obsoleta; la anterior no se modifica. */
export async function updateSettings(actorId: string, raw: Record<string, unknown>): Promise<EconomicSettings> {
  await authorize(prisma, actorId, "ADMIN"); // el permiso se comprueba antes que los datos
  const target = fieldDec(raw.targetEurosPerDay, "targetEurosPerDay", { positive: true, max: "1000000" });
  const dayHours = fieldDec(raw.dayHours, "dayHours", { positive: true, max: "24" });
  const tolerance = fieldDec(raw.reconciliationTolerance, "reconciliationTolerance", { positive: false, max: "1000" });
  const expected = Number(raw.expectedRevisionNo);
  if (!Number.isInteger(expected) || expected < 1) throw new DomainError("Falta la revisión que está editando; recargue la página.");
  const reason = String(raw.reason ?? "").trim().slice(0, 500) || null;
  return adminTransaction(actorId, async (tx, actor) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('csapp-economic-settings', 0))`);
    await ensureInitialSettings(tx);
    const latest = await tx.economicSettingsRevision.findFirstOrThrow({ orderBy: { revisionNo: "desc" } });
    if (latest.revisionNo !== expected) throw new StaleVersionError("La configuración económica");
    const same =
      Dec.parse(latest.targetEurosPerDay.toFixed())?.toString() === target &&
      Dec.parse(latest.dayHours.toFixed())?.toString() === dayHours &&
      Dec.parse(latest.reconciliationTolerance.toFixed())?.toString() === tolerance;
    if (same) throw new DomainError("Los valores indicados son los de la revisión vigente: no hay nada que cambiar.");
    const created = await tx.economicSettingsRevision.create({
      data: { revisionNo: latest.revisionNo + 1, targetEurosPerDay: target, dayHours, reconciliationTolerance: tolerance, reason, activatedById: actor.id },
      include: { activatedBy: { select: { email: true } } },
    });
    await recordAudit(tx, actor, {
      action: "UPDATE",
      entityType: "EconomicSettings",
      entityId: String(created.revisionNo),
      summary: `Configuración económica: revisión ${created.revisionNo} (objetivo ${target} €/jornada, jornada ${dayHours} h, tolerancia ${tolerance} €); anterior: revisión ${latest.revisionNo}`,
      before: { revisionNo: latest.revisionNo, targetEurosPerDay: latest.targetEurosPerDay.toString(), dayHours: latest.dayHours.toString(), reconciliationTolerance: latest.reconciliationTolerance.toString() },
      after: { revisionNo: created.revisionNo, targetEurosPerDay: target, dayHours, reconciliationTolerance: tolerance, reason },
    });
    return shape(created);
  });
}
