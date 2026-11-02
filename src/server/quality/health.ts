import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { cleanComment, healthCellSchema, isFutureMonth, validateFeedbackDate, HEALTH_DB_LABEL, type HealthDbState } from "@/domain/quality-health";
import { todayMadrid } from "@/domain/vigencia";
import { recordAudit } from "@/server/audit";
import { authorize } from "@/server/authorize";
import { DomainError, StaleVersionError } from "@/server/errors";
import { parseInput } from "@/server/parse";
import { adminTransaction } from "@/server/tx";
import { readSnapshot } from "@/server/analytics/snapshot";
import { readDataStamp } from "@/server/analytics/stamp";

/**
 * Client Health mensual (CSAPP-08 §4). Edición atómica de UNA celda (ámbito + entidad + año + mes) con `expectedVersion`, historial y auditoría
 * antes/después; limpiar una celda conserva el historial (state NONE = «sin feedback», no puntuación cero). No crea cuentas ni personas, no
 * arrastra el mes anterior, no prellena y no propaga entre grupo y Cliente. Solo ADMIN escribe; la lectura es de ADMIN y Consulta.
 */
export type HealthCell = {
  scope: "group" | "client";
  entityId: string;
  year: number;
  month: number;
  state: HealthDbState;
  comment: string | null;
  feedbackOn: string | null;
  version: number;
  recordedAt: string;
  updatedAt: string;
  updatedByEmail: string | null;
};

type Row = { id: bigint; groupId: string | null; clientId: string | null; year: number; month: number; state: string; comment: string | null; feedbackOn: Date | null; version: number; createdAt: Date; updatedAt: Date; updatedBy: { email: string } | null };
const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const toCell = (r: Row): HealthCell => ({
  scope: r.groupId ? "group" : "client",
  entityId: (r.groupId ?? r.clientId) as string,
  year: r.year, month: r.month, state: r.state as HealthDbState, comment: r.comment, feedbackOn: iso(r.feedbackOn), version: r.version,
  recordedAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), updatedByEmail: r.updatedBy?.email ?? null,
});

export async function saveHealthCell(actorId: string, raw: unknown, opts: { now?: Date } = {}): Promise<HealthCell> {
  const input = parseInput(healthCellSchema, raw);
  const today = todayMadrid(opts.now ?? new Date());
  if (isFutureMonth(input.year, input.month, today)) throw new DomainError("No se registra feedback de un mes que aún no ha empezado.", { month: "Mes futuro." });
  const date = validateFeedbackDate(input.state === "NONE" ? "" : input.feedbackOn, input.year, input.month, today);
  if (!date.ok) throw new DomainError(date.message, { feedbackOn: date.message });
  const comment = input.state === "NONE" ? null : cleanComment(input.comment);
  return adminTransaction(actorId, async (tx, actor) => {
    // El destino debe existir; un Cliente interno no es un cliente externo.
    const target: { id: string; name: string; isInternal: boolean; groupId: string | null } | null =
      input.scope === "group"
        ? await tx.clientGroup.findUnique({ where: { id: input.entityId }, select: { id: true, name: true } }).then((g) => (g ? { ...g, isInternal: false, groupId: g.id } : null))
        : await tx.client.findUnique({ where: { id: input.entityId }, select: { id: true, name: true, isInternal: true, groupId: true } });
    if (!target) throw new DomainError("El Grupo Cliente o Cliente no existe.");
    if (target.isInternal) throw new DomainError("Una organización interna no es un cliente externo: no admite Client Health.");
    const where = input.scope === "group" ? { groupId: input.entityId } : { clientId: input.entityId };
    const key = { ...where, year: input.year, month: input.month };
    const cur = await tx.healthFeedback.findFirst({ where: key });
    const seen = cur?.version ?? 0;
    if (seen !== input.expectedVersion) throw new StaleVersionError("La celda de Client Health");
    const label = `${input.scope === "group" ? "Grupo" : "Cliente"} ${target.name} · ${String(input.month).padStart(2, "0")}/${input.year}`;
    const audit = { entityType: "HealthFeedback", groupId: input.scope === "group" ? input.entityId : target.groupId, clientId: input.scope === "client" ? input.entityId : null };
    if (cur === null) {
      if (input.state === "NONE") throw new DomainError("La celda ya está sin feedback: no hay nada que limpiar.");
      const created = await tx.healthFeedback.create({ data: { ...key, state: input.state, comment, feedbackOn: date.value ? new Date(`${date.value}T00:00:00Z`) : null, updatedById: actor.id }, include: { updatedBy: { select: { email: true } } } });
      await tx.healthFeedbackEvent.create({ data: { feedbackId: created.id, version: 1, action: "CREATE", state: input.state, comment, feedbackOn: created.feedbackOn, byId: actor.id } });
      await recordAudit(tx, actor, { ...audit, action: "CREATE", entityId: String(created.id), summary: `Client Health ${label}: ${HEALTH_DB_LABEL[input.state]}`, after: toCell(created as Row) });
      return toCell(created as Row);
    }
    if (cur.state === input.state && cur.comment === comment && (iso(cur.feedbackOn) ?? null) === date.value) throw new DomainError("No hay cambios que guardar en esta celda.");
    const clearing = input.state === "NONE";
    const updated = await tx.healthFeedback.update({
      where: { id: cur.id },
      data: { state: input.state, comment, feedbackOn: date.value ? new Date(`${date.value}T00:00:00Z`) : null, version: { increment: 1 }, updatedById: actor.id },
      include: { updatedBy: { select: { email: true } } },
    });
    await tx.healthFeedbackEvent.create({
      data: { feedbackId: cur.id, version: updated.version, action: clearing ? "CLEAR" : "UPDATE", state: input.state, comment, feedbackOn: updated.feedbackOn, prevState: cur.state, prevComment: cur.comment, prevFeedbackOn: cur.feedbackOn, byId: actor.id },
    });
    await recordAudit(tx, actor, {
      ...audit, action: "UPDATE", entityId: String(cur.id),
      summary: clearing ? `Client Health ${label}: celda limpiada (sin feedback; historial conservado)` : `Client Health ${label}: ${HEALTH_DB_LABEL[cur.state as HealthDbState]} → ${HEALTH_DB_LABEL[input.state]}`,
      before: { state: cur.state, comment: cur.comment, feedbackOn: iso(cur.feedbackOn), version: cur.version }, after: toCell(updated as Row),
    });
    return toCell(updated as Row);
  });
}

export type HealthMatrixQuery = { scope: "group" | "client"; year: number; q: string; page: number; pageSize: number };
export type HealthMatrixRow = { id: string; name: string; parent: string | null; cells: Record<number, HealthCell | null> };
export type HealthMatrix = { query: HealthMatrixQuery; total: number; page: number; pageCount: number; rows: HealthMatrixRow[]; canEdit: boolean; /** Solo con `all`: sello de datos y fecha de la lectura coherente que sustenta la matriz completa. */ stamp: string; readAt: string };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Matriz enero–diciembre de un año y ámbito, con búsqueda y paginación de ENTIDADES (las doce celdas viajan con cada fila). Lectura coherente. */
export async function getHealthMatrix(actorId: string, q: HealthMatrixQuery, opts: { all?: boolean } = {}): Promise<HealthMatrix> {
  return readSnapshot(actorId, async (tx) => {
    const actor = await authorize(tx, actorId, "READ");
    const needle = fold(q.q);
    const ents =
      q.scope === "group"
        ? (await tx.clientGroup.findMany({ select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] })).map((g) => ({ id: g.id, name: g.name, parent: null as string | null }))
        : (await tx.client.findMany({ where: { isInternal: false }, select: { id: true, name: true, group: { select: { name: true } } }, orderBy: [{ name: "asc" }, { id: "asc" }] })).map((c) => ({ id: c.id, name: c.name, parent: c.group?.name ?? null }));
    const filtered = needle === "" ? ents : ents.filter((e) => fold(e.name).includes(needle) || fold(e.parent ?? "").includes(needle));
    // `all`: la matriz COMPLETA en esta misma instantánea (CSV); sin llamadas paginadas independientes que mezclen estados distintos.
    const pageCount = opts.all ? 1 : Math.max(1, Math.ceil(filtered.length / q.pageSize));
    const page = opts.all ? 1 : Math.min(Math.max(1, q.page), pageCount);
    const slice = opts.all ? filtered : filtered.slice((page - 1) * q.pageSize, page * q.pageSize);
    const ids = slice.map((e) => e.id);
    const rows = ids.length === 0 ? [] : await tx.healthFeedback.findMany({ where: { year: q.year, ...(q.scope === "group" ? { groupId: { in: ids } } : { clientId: { in: ids } }) }, include: { updatedBy: { select: { email: true } } } });
    const by = new Map<string, Map<number, HealthCell>>();
    for (const r of rows) {
      const c = toCell(r as Row);
      const m = by.get(c.entityId) ?? new Map<number, HealthCell>();
      m.set(c.month, c);
      by.set(c.entityId, m);
    }
    const stamp = opts.all ? (await readDataStamp(tx)).stamp : "";
    const readAt = opts.all ? (await tx.$queryRaw<{ t: Date }[]>(Prisma.sql`SELECT now() AS t`))[0].t.toISOString() : "";
    return { query: q, stamp, readAt, total: filtered.length, page, pageCount, canEdit: actor.role === "ADMIN", rows: slice.map((e) => ({ ...e, cells: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, by.get(e.id)?.get(i + 1) ?? null])) })) };
  });
}

export type HealthHistoryRow = { version: number; action: string; state: HealthDbState; comment: string | null; feedbackOn: string | null; prevState: string | null; at: string; by: string };
export async function getHealthHistory(actorId: string, scope: "group" | "client", entityId: string, year: number, month: number): Promise<HealthHistoryRow[]> {
  await authorize(prisma, actorId, "READ");
  const cell = await prisma.healthFeedback.findFirst({ where: { ...(scope === "group" ? { groupId: entityId } : { clientId: entityId }), year, month } });
  if (!cell) return [];
  const ev = await prisma.healthFeedbackEvent.findMany({ where: { feedbackId: cell.id }, orderBy: { version: "asc" }, include: { by: { select: { email: true } } } });
  return ev.map((e) => ({ version: e.version, action: e.action, state: e.state as HealthDbState, comment: e.comment, feedbackOn: iso(e.feedbackOn), prevState: e.prevState, at: e.at.toISOString(), by: e.by.email }));
}

/** Estados de Client Health de un conjunto de entidades en un mes: base de la evaluación mensual (sin arrastre ni herencia entre ámbitos). */
export async function loadHealthForMonth(tx: Prisma.TransactionClient, scope: "group" | "client", ids: string[], year: number, month: number) {
  if (ids.length === 0) return new Map<string, { state: HealthDbState; feedbackOn: string | null; recordedAt: string; version: number; comment: string | null }>();
  const rows = await tx.healthFeedback.findMany({ where: { year, month, ...(scope === "group" ? { groupId: { in: ids } } : { clientId: { in: ids } }) } });
  return new Map(rows.map((r) => [(r.groupId ?? r.clientId) as string, { state: r.state as HealthDbState, feedbackOn: iso(r.feedbackOn), recordedAt: r.createdAt.toISOString(), version: r.version, comment: r.comment }]));
}
