import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { defaultPulseConfig, pulseConfigSchema, validatePulseConfig, type PulseConfig } from "@/domain/pulse-catalog";
import { defaultQualityConfig, readQualityPayload, validateQualityConfig, type QualityConfig } from "@/domain/quality-config";
import { recordAudit } from "@/server/audit";
import { authorize } from "@/server/authorize";
import { DomainError, StaleVersionError } from "@/server/errors";
import { adminTransaction } from "@/server/tx";

/**
 * Configuración versionada de Pulse Rent y Calidad (CSAPP-07 §8). Tres acciones distintas: guardar borrador, simular (sin escribir) y
 * activar. Las revisiones son inmutables (disparador en la base); volver a una anterior crea una NUEVA revisión identificada. Una consulta
 * GET nunca cambia parámetros: si no hay revisión persistida se usa la configuración inicial EN MEMORIA (revisión 1, `persisted: false`) y
 * la primera activación la persiste antes de crear la siguiente.
 */
export const FAMILIES = ["PULSE", "QUALITY"] as const;
export type ConfigFamily = (typeof FAMILIES)[number];
export const FAMILY_NAME: Record<ConfigFamily, string> = { PULSE: "Pulse Rent", QUALITY: "Calidad" };
type Db = Prisma.TransactionClient | typeof prisma;

type PayloadOf = { PULSE: PulseConfig; QUALITY: QualityConfig };
export type Revision<F extends ConfigFamily> = {
  family: F;
  revisionNo: number;
  payload: PayloadOf[F];
  reason: string | null;
  kind: "INITIAL" | "ACTIVATION" | "ROLLBACK";
  restoredFromRevisionNo: number | null;
  activatedAt: string | null;
  activatedByEmail: string | null;
  /** Falso = revisión inicial por defecto aún no persistida (nadie la ha activado). */
  persisted: boolean;
};

export const defaultPayload = <F extends ConfigFamily>(family: F): PayloadOf[F] => (family === "PULSE" ? defaultPulseConfig() : defaultQualityConfig()) as PayloadOf[F];

/** Valida estructura (zod) y semántica. Devuelve la carga normalizada o los problemas; nunca acepta JSON arbitrario. */
export function parsePayload<F extends ConfigFamily>(family: F, raw: unknown): { ok: true; payload: PayloadOf[F]; issues: { path: string; message: string }[] } | { ok: false; issues: { path: string; message: string }[] } {
  if (family === "QUALITY") {
    // v2 directamente o v1 mediante el adaptador documentado (el JSON almacenado no se modifica).
    const q = readQualityPayload(raw);
    if (!q.ok) return { ok: false, issues: q.issues };
    return { ok: true, payload: q.payload as PayloadOf[F], issues: validateQualityConfig(q.payload) };
  }
  const r = pulseConfigSchema.safeParse(raw);
  if (!r.success) return { ok: false, issues: r.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: `Estructura no válida en «${i.path.join(".") || "raíz"}»: ${i.message}` })) };
  const payload = r.data as PayloadOf[F];
  return { ok: true, payload, issues: validatePulseConfig(payload as PulseConfig) };
}

type Row = { revisionNo: number; payload: Prisma.JsonValue; reason: string | null; kind: string; restoredFromRevisionNo: number | null; activatedAt: Date; activatedBy: { email: string } | null };
function shape<F extends ConfigFamily>(family: F, r: Row): Revision<F> {
  const parsed = parsePayload(family, r.payload);
  if (!parsed.ok) throw new DomainError(`La revisión ${r.revisionNo} de ${FAMILY_NAME[family]} no cumple el contrato vigente.`);
  return { family, revisionNo: r.revisionNo, payload: parsed.payload, reason: r.reason, kind: r.kind as Revision<F>["kind"], restoredFromRevisionNo: r.restoredFromRevisionNo, activatedAt: r.activatedAt.toISOString(), activatedByEmail: r.activatedBy?.email ?? null, persisted: true };
}
const virtualInitial = <F extends ConfigFamily>(family: F): Revision<F> => ({ family, revisionNo: 1, payload: defaultPayload(family), reason: "Configuración inicial (sin activaciones): pesos iguales confirmados; el resto sin calibrar o propuesto.", kind: "INITIAL", restoredFromRevisionNo: null, activatedAt: null, activatedByEmail: null, persisted: false });

/** Revisión activa (la de mayor número) o la indicada. Solo lectura. */
export async function getActive<F extends ConfigFamily>(db: Db, family: F, revisionNo?: number): Promise<Revision<F>> {
  const r = await db.configRevision.findFirst({ where: { family, ...(revisionNo === undefined ? {} : { revisionNo }) }, orderBy: { revisionNo: "desc" }, include: { activatedBy: { select: { email: true } } } });
  if (!r) {
    if (revisionNo === undefined || revisionNo === 1) return virtualInitial(family);
    throw new DomainError(`No existe la revisión ${revisionNo} de ${FAMILY_NAME[family]}.`);
  }
  return shape(family, r as Row);
}

/** Números de revisión activos de las tres familias (manifiesto para el sello de datos y las referencias). */
export async function getManifest(db: Db): Promise<{ economic: number; pulse: number; quality: number }> {
  const rows = await db.$queryRaw<{ f: string; n: number }[]>(Prisma.sql`
    SELECT 'ECONOMIC' AS f, COALESCE(max("revisionNo"), 0)::int AS n FROM "EconomicSettingsRevision"
    UNION ALL SELECT family, max("revisionNo")::int FROM "ConfigRevision" GROUP BY family`);
  const n = (f: string, dflt: number) => rows.find((r) => r.f === f)?.n ?? dflt;
  return { economic: n("ECONOMIC", 1), pulse: n("PULSE", 1), quality: n("QUALITY", 1) };
}

export async function listRevisions<F extends ConfigFamily>(actorId: string, family: F): Promise<Revision<F>[]> {
  await authorize(prisma, actorId, "READ");
  const rows = await prisma.configRevision.findMany({ where: { family }, orderBy: { revisionNo: "desc" }, include: { activatedBy: { select: { email: true } } } });
  return rows.length === 0 ? [virtualInitial(family)] : rows.map((r) => shape(family, r as Row));
}

export type Draft<F extends ConfigFamily> = { family: F; payload: PayloadOf[F]; baseRevisionNo: number; version: number; note: string | null; updatedAt: string; updatedByEmail: string | null };
export async function getDraft<F extends ConfigFamily>(actorId: string, family: F): Promise<Draft<F> | null> {
  await authorize(prisma, actorId, "ADMIN"); // el borrador es información de configuración: solo el Administrador lo ve
  const d = await prisma.configDraft.findUnique({ where: { family }, include: { updatedBy: { select: { email: true } } } });
  if (!d) return null;
  const parsed = parsePayload(family, d.payload);
  if (!parsed.ok) return null;
  return { family, payload: parsed.payload, baseRevisionNo: d.baseRevisionNo, version: d.version, note: d.note, updatedAt: d.updatedAt.toISOString(), updatedByEmail: d.updatedBy?.email ?? null };
}

async function ensureInitial(tx: Prisma.TransactionClient, family: ConfigFamily, actorId: string): Promise<void> {
  const any = await tx.configRevision.findFirst({ where: { family }, select: { id: true } });
  if (any) return;
  await tx.configRevision.create({ data: { family, revisionNo: 1, payload: defaultPayload(family) as unknown as Prisma.InputJsonValue, reason: "Configuración inicial", kind: "INITIAL", activatedById: actorId } });
}

const lock = (tx: Prisma.TransactionClient, family: ConfigFamily) => tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`csapp-config-${family}`}, 0))`);

function mustBeValid<F extends ConfigFamily>(family: F, raw: unknown): PayloadOf[F] {
  const p = parsePayload(family, raw);
  if (!p.ok) throw new DomainError("La configuración no es válida.", { payload: p.issues[0].message });
  if (p.issues.length > 0) throw new DomainError(p.issues[0].message, Object.fromEntries(p.issues.slice(0, 8).map((i) => [i.path, i.message])));
  const out = p.payload as PayloadOf[F];
  // Las notas del adaptador son solo de lectura: una revisión nueva se guarda como v2 limpia.
  if (family === "QUALITY") delete (out as QualityConfig).adapter;
  return out;
}

/** Guarda el borrador (solo ADMIN). No cambia lo activo. `expectedVersion` null = no hay borrador previo. */
export async function saveDraft<F extends ConfigFamily>(actorId: string, family: F, raw: unknown, input: { expectedVersion: number | null; note?: string | null }): Promise<Draft<F>> {
  await authorize(prisma, actorId, "ADMIN");
  const payload = mustBeValid(family, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    await lock(tx, family);
    const latest = await getActive(tx, family);
    const cur = await tx.configDraft.findUnique({ where: { family } });
    if (cur === null && input.expectedVersion !== null) throw new StaleVersionError("El borrador");
    if (cur !== null && cur.version !== input.expectedVersion) throw new StaleVersionError("El borrador");
    const note = (input.note ?? "").trim().slice(0, 500) || null;
    const data = { payload: payload as unknown as Prisma.InputJsonValue, baseRevisionNo: latest.revisionNo, note, updatedById: actor.id };
    const d = cur === null ? await tx.configDraft.create({ data: { family, ...data } }) : await tx.configDraft.update({ where: { family }, data: { ...data, version: { increment: 1 } } });
    await recordAudit(tx, actor, { action: "UPDATE", entityType: `ConfigDraft:${family}`, entityId: family, summary: `Borrador de ${FAMILY_NAME[family]} guardado (versión ${d.version}, sobre la revisión activa ${latest.revisionNo}); no cambia lo activo`, before: cur?.payload ?? null, after: payload });
    return { family, payload, baseRevisionNo: d.baseRevisionNo, version: d.version, note: d.note, updatedAt: d.updatedAt.toISOString(), updatedByEmail: actor.email };
  });
}

export async function discardDraft(actorId: string, family: ConfigFamily): Promise<void> {
  await adminTransaction(actorId, async (tx, actor) => {
    await lock(tx, family);
    const cur = await tx.configDraft.findUnique({ where: { family } });
    if (!cur) return;
    await tx.configDraft.delete({ where: { family } });
    await recordAudit(tx, actor, { action: "CANCEL", entityType: `ConfigDraft:${family}`, entityId: family, summary: `Borrador de ${FAMILY_NAME[family]} descartado`, before: cur.payload });
  });
}

/**
 * Activa el borrador como nueva revisión (solo ADMIN, atómico). Exige que lo activo siga siendo la base (`expectedRevisionNo`) y que el borrador
 * no haya cambiado (`expectedDraftVersion`); valida todo lo necesario de la sección. No hay aprobación externa: el Administrador elige.
 */
export async function activateDraft<F extends ConfigFamily>(actorId: string, family: F, input: { expectedRevisionNo: number; expectedDraftVersion: number; reason: string }): Promise<Revision<F>> {
  await authorize(prisma, actorId, "ADMIN");
  const reason = input.reason.trim().slice(0, 500);
  if (reason === "") throw new DomainError("Indique el motivo de la activación.", { reason: "Obligatorio." });
  return adminTransaction(actorId, async (tx, actor) => {
    await lock(tx, family);
    await ensureInitial(tx, family, actor.id);
    const latest = await tx.configRevision.findFirstOrThrow({ where: { family }, orderBy: { revisionNo: "desc" } });
    if (latest.revisionNo !== input.expectedRevisionNo) throw new StaleVersionError(`La configuración de ${FAMILY_NAME[family]}`);
    const draft = await tx.configDraft.findUnique({ where: { family } });
    if (!draft) throw new DomainError("No hay un borrador que activar: guarde primero un borrador.");
    if (draft.version !== input.expectedDraftVersion) throw new StaleVersionError("El borrador");
    const payload = mustBeValid(family, draft.payload);
    const created = await tx.configRevision.create({
      data: { family, revisionNo: latest.revisionNo + 1, payload: payload as unknown as Prisma.InputJsonValue, reason, kind: "ACTIVATION", activatedById: actor.id },
      include: { activatedBy: { select: { email: true } } },
    });
    await tx.configDraft.delete({ where: { family } });
    await recordAudit(tx, actor, { action: "ACTIVATE", entityType: `Config:${family}`, entityId: String(created.revisionNo), summary: `${FAMILY_NAME[family]}: revisión ${created.revisionNo} activada (anterior: ${latest.revisionNo}). Motivo: ${reason}`, before: { revisionNo: latest.revisionNo, payload: latest.payload }, after: { revisionNo: created.revisionNo, payload } });
    return shape(family, created as Row);
  });
}

/** Volver a una revisión anterior: crea una NUEVA activación identificada (ROLLBACK); la historia no se modifica. */
export async function rollbackTo<F extends ConfigFamily>(actorId: string, family: F, input: { toRevisionNo: number; expectedRevisionNo: number; reason: string }): Promise<Revision<F>> {
  await authorize(prisma, actorId, "ADMIN");
  const reason = input.reason.trim().slice(0, 500);
  if (reason === "") throw new DomainError("Indique el motivo de la reversión.", { reason: "Obligatorio." });
  return adminTransaction(actorId, async (tx, actor) => {
    await lock(tx, family);
    await ensureInitial(tx, family, actor.id);
    const latest = await tx.configRevision.findFirstOrThrow({ where: { family }, orderBy: { revisionNo: "desc" } });
    if (latest.revisionNo !== input.expectedRevisionNo) throw new StaleVersionError(`La configuración de ${FAMILY_NAME[family]}`);
    const target = await tx.configRevision.findUnique({ where: { family_revisionNo: { family, revisionNo: input.toRevisionNo } } });
    if (!target) throw new DomainError(`No existe la revisión ${input.toRevisionNo}.`);
    if (target.revisionNo === latest.revisionNo) throw new DomainError("Esa ya es la revisión activa.");
    const payload = mustBeValid(family, target.payload);
    const created = await tx.configRevision.create({
      data: { family, revisionNo: latest.revisionNo + 1, payload: payload as unknown as Prisma.InputJsonValue, reason, kind: "ROLLBACK", restoredFromRevisionNo: target.revisionNo, activatedById: actor.id },
      include: { activatedBy: { select: { email: true } } },
    });
    await recordAudit(tx, actor, { action: "REVERT", entityType: `Config:${family}`, entityId: String(created.revisionNo), summary: `${FAMILY_NAME[family]}: revisión ${created.revisionNo} = vuelta a la ${target.revisionNo} (anterior activa: ${latest.revisionNo}). Motivo: ${reason}`, before: { revisionNo: latest.revisionNo }, after: { revisionNo: created.revisionNo, restoredFrom: target.revisionNo } });
    return shape(family, created as Row);
  });
}
