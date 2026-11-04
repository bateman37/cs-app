import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { cleanText, searchValueOf } from "@/domain/normalize";
import { toDbDate, fromDbDate, todayMadrid } from "@/domain/vigencia";
import { LINK_LABEL, type LinkSystem } from "@/domain/master-links";
import {
  ALIAS_LABEL, TERM_LABEL, TERM_OPTIONS, changeKey, digitsOnly, editInputSchema, termValueLabel,
  type AliasSystem, type EditChange, type EditError, type EditItem, type EditResult, type TermAttr,
} from "@/domain/master-edit";
import type { Actor } from "@/lib/access";
import { recordAudit } from "./audit";
import { authorize } from "./authorize";
import { DomainError, violatedConstraint } from "./errors";
import { parseInput } from "./parse";

/**
 * Guardado del editor de Clientes (HOTFIX-04 §5). Contrato completo: docs/arquitectura/hotfix04-edicion-en-tablas.md.
 *
 *  - UNA operación atómica por pulsación confirmada: todos los cambios del borrador se aplican o ninguno. La vista previa ejecuta EXACTAMENTE el mismo plan dentro de
 *    una transacción que se deshace (sin escribir nada), de modo que lo que se confirma es lo que se valida y lo que se guarda.
 *  - Estado deseado + valor base: el servidor compara el valor actual con el que el usuario vio. Si otra persona lo cambió, el conflicto se localiza en su celda
 *    (error por clave) y NADA se guarda; el cliente conserva el resto del borrador.
 *  - Idempotente por `operationId` (un doble clic o un reintento no duplica entidades ni auditoría).
 *  - Las claves fuente (Wrike, PAP, ID Zendesk) NO se borran ni se reasignan por parecido: retirar una clave cierra su vigencia hoy (los hechos anteriores conservan su
 *    atribución); añadir una clave ya asignada a otro destino es un conflicto explícito. Cada alta/cierre dispara el reenlace automático de HOTFIX-02 por los disparadores
 *    de la base: no hay que volver a Cargas.
 */

type Tx = Prisma.TransactionClient;
const CONTEXT = "Edición en la tabla de Clientes (HOTFIX-04)";
const ALIAS_SPEC: Record<AliasSystem, { system: "WRIKE" | "PAP" | "ZENDESK"; kind: "PROJECT_NAME" | "ORG_ID" }> = {
  WRIKE: { system: "WRIKE", kind: "PROJECT_NAME" },
  PAP: { system: "PAP", kind: "PROJECT_NAME" },
  ZENDESK_ID: { system: "ZENDESK", kind: "ORG_ID" },
};

class Rollback extends Error {
  constructor(public readonly result: EditResult) {
    super("rollback");
  }
}

/** Huella estable del borrador (el orden no la altera). */
export function draftDigest(changes: readonly EditChange[]): string {
  const canon = [...changes].map((c) => ({ k: changeKey(c), c })).sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)).map((x) => x.c);
  return createHash("sha256").update(JSON.stringify(canon)).digest("hex").slice(0, 32);
}

type Ctx = {
  tx: Tx;
  actor: Actor;
  today: string;
  items: EditItem[];
  errors: EditError[];
  created: EditResult["created"];
  /** Entidades creadas en esta operación por su tempId. */
  temp: Map<string, { id: string; kind: "group" | "client"; name: string }>;
};

const fail = (c: Ctx, key: string, message: string, kind: EditError["kind"] = "VALIDATION") => void c.errors.push({ key, message, kind });
const item = (c: Ctx, i: Omit<EditItem, "notes"> & { notes?: string[] }) => void c.items.push({ ...i, notes: i.notes ?? [] });
const list = (xs: string[]) => (xs.length === 0 ? "Sin informar" : xs.join(" · "));

async function groupLabel(tx: Tx, id: string): Promise<{ name: string; label: string } | null> {
  const g = await tx.clientGroup.findUnique({ where: { id }, select: { name: true } });
  return g ? { name: g.name, label: `Grupo «${g.name}»` } : null;
}
async function clientLabel(tx: Tx, id: string): Promise<{ name: string; groupId: string | null; label: string } | null> {
  const x = await tx.client.findUnique({ where: { id }, select: { name: true, groupId: true, group: { select: { name: true } } } });
  return x ? { name: x.name, groupId: x.groupId, label: `Cliente «${x.name}»${x.group ? ` (Grupo «${x.group.name}»)` : ""}` } : null;
}
async function scopeInfo(tx: Tx, scope: "group" | "client", id: string) {
  if (scope === "group") {
    const g = await groupLabel(tx, id);
    return g ? { label: g.label, groupId: id as string | null, clientId: null as string | null, name: g.name } : null;
  }
  const c = await clientLabel(tx, id);
  return c ? { label: c.label, groupId: c.groupId, clientId: id as string | null, name: c.name } : null;
}
const fkOf = (scope: "group" | "client", id: string) => (scope === "group" ? { groupId: id } : { clientId: id });

// ------------------------------------------------------------------------------------------------ Identidades (claves fuente)

type IdentityRow = Awaited<ReturnType<Tx["externalIdentity"]["findMany"]>>[number];
const isCurrent = (r: Pick<IdentityRow, "isActive" | "validFrom" | "validTo">, today: string) =>
  r.isActive && (r.validFrom === null || (fromDbDate(r.validFrom) as string) <= today) && (r.validTo === null || today < (fromDbDate(r.validTo) as string));

async function currentIdentities(tx: Tx, scope: "group" | "client", id: string, alias: AliasSystem, today: string): Promise<IdentityRow[]> {
  const { system, kind } = ALIAS_SPEC[alias];
  const rows = await tx.externalIdentity.findMany({ where: { system, kind, ...fkOf(scope, id) }, orderBy: [{ rawValue: "asc" }, { id: "asc" }] });
  return rows.filter((r) => isCurrent(r, today));
}

async function targetName(tx: Tx, r: Pick<IdentityRow, "groupId" | "clientId" | "implementationId">): Promise<string> {
  if (r.groupId) return (await groupLabel(tx, r.groupId))?.label ?? "otro Grupo";
  if (r.clientId) return (await clientLabel(tx, r.clientId))?.label ?? "otro Cliente";
  if (r.implementationId) {
    const i = await tx.implementation.findUnique({ where: { id: r.implementationId }, select: { name: true, client: { select: { name: true } } } });
    return i ? `implantación «${i.client.name} › ${i.name}»` : "otra implantación";
  }
  return "otro destino";
}

/** Impacto informativo de retirar una clave: hechos que la usan y que conservan su atribución hasta hoy. */
async function usageNote(tx: Tx, alias: AliasSystem, scope: "group" | "client", id: string, row: IdentityRow): Promise<string | null> {
  try {
    if (alias === "WRIKE") {
      const col = scope === "group" ? Prisma.sql`"drvGroupId"` : Prisma.sql`"drvClientId"`;
      const r = await tx.$queryRaw<{ n: bigint; m: string | null }[]>(Prisma.sql`
        SELECT count(*) AS n, (COALESCE(sum(minutes), 0) / 60)::numeric(14,2)::text AS m FROM "WrikeTimeEntry"
        WHERE ${col} = ${id} AND lower(regexp_replace(btrim("projectName"), '\\s+', ' ', 'g')) = ${row.searchValue}`);
      const n = Number(r[0]?.n ?? 0);
      return n > 0 ? `${n} registros de horas de Wrike (${r[0].m} h) con la clave «${row.rawValue}» conservan su atribución hasta hoy; desde hoy deja de aplicarse.` : null;
    }
    if (alias === "ZENDESK_ID") {
      const r = await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`
        SELECT count(*) AS n FROM "ZdTicket" t JOIN "ZdTicketRevision" v ON v.id = t."currentRevisionId" WHERE v."organizationId" = ${row.searchValue}`);
      const n = Number(r[0]?.n ?? 0);
      return n > 0 ? `${n} tickets de la organización ${row.rawValue} conservan su atribución hasta hoy; los nuevos con ese ID dejarán de atribuirse a este Cliente.` : null;
    }
  } catch {
    return null;
  }
  return null;
}

async function applyAliases(c: Ctx, ch: Extract<EditChange, { op: "aliases" }>): Promise<void> {
  const key = changeKey(ch);
  const { tx, actor, today } = c;
  const info = await scopeInfo(tx, ch.scope, ch.id);
  if (!info) return fail(c, key, "El Grupo o el Cliente ya no existe.", "CONFLICT");
  const { system, kind } = ALIAS_SPEC[ch.system];
  if (ch.system === "ZENDESK_ID" && ch.scope === "group") return fail(c, key, "El ID de organización Zendesk pertenece a un Cliente: añada un Cliente al Grupo.");
  const norm = (v: string) => searchValueOf(kind, cleanText(v));
  const after: { raw: string; sv: string }[] = [];
  for (const v of ch.after) {
    const raw = cleanText(v);
    if (raw === "") continue;
    if (raw.length > 300) return fail(c, key, "Cada valor admite como máximo 300 caracteres.");
    if (ch.system === "ZENDESK_ID" && !digitsOnly(raw)) return fail(c, key, "El ID de organización Zendesk debe ser un entero exacto (solo dígitos, sin decimales ni notación científica).");
    if (!after.some((a) => a.sv === norm(raw))) after.push({ raw, sv: norm(raw) });
  }
  if (ch.system === "ZENDESK_ID" && after.length > 1) return fail(c, key, "Un Cliente tiene un único ID de organización Zendesk en esta tabla; para otro ID cree otro Cliente.");
  const current = await currentIdentities(tx, ch.scope, ch.id, ch.system, today);
  const curSv = new Set(current.map((r) => r.searchValue));
  const afterSv = new Set(after.map((a) => a.sv));
  const beforeSv = new Set(ch.before.map(norm).filter(Boolean));
  const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
  if (same(curSv, afterSv)) return; // ya está así: sin cambios
  if (!same(curSv, beforeSv)) return fail(c, key, `Otra persona ha cambiado este campo: ahora es «${list(current.map((r) => r.rawValue))}». Revise el valor y vuelva a guardar; no se ha guardado nada.`, "CONFLICT");

  const notes: string[] = [];
  const removes = current.filter((r) => !afterSv.has(r.searchValue));
  const adds = after.filter((a) => !curSv.has(a.sv));
  const ctxIds = { groupId: info.groupId, clientId: info.clientId };

  for (const r of removes) {
    const future = r.validFrom !== null && (fromDbDate(r.validFrom) as string) >= today;
    const upd = await tx.externalIdentity.update({ where: { id: r.id }, data: future ? { isActive: false, version: { increment: 1 } } : { validTo: toDbDate(today), version: { increment: 1 } } });
    await recordAudit(tx, actor, {
      action: future ? "DEACTIVATE" : "UPDATE", entityType: "ExternalIdentity", entityId: r.id, ...ctxIds,
      summary: `${CONTEXT}: se retira la clave ${ALIAS_LABEL[ch.system]} «${r.rawValue}» de ${info.label}${future ? "" : " (vigencia cerrada hoy; lo anterior conserva su atribución)"}`,
      before: r, after: upd,
    });
    const u = await usageNote(tx, ch.system, ch.scope, ch.id, r);
    notes.push(`Se retira «${r.rawValue}»${future ? "" : ": su vigencia termina hoy y no se borra nada"}.`);
    if (u) notes.push(u);
  }

  for (const a of adds) {
    const all = await tx.externalIdentity.findMany({ where: { system, kind, searchValue: a.sv } });
    const mine = all.filter((r) => (ch.scope === "group" ? r.groupId === ch.id : r.clientId === ch.id));
    const others = all.filter((r) => r.isActive && !mine.includes(r));
    const activeOthers = others.filter((r) => r.validTo === null || (fromDbDate(r.validTo) as string) > today);
    if (activeOthers.length > 0) {
      const who = await targetName(tx, activeOthers[0]);
      return fail(c, key, `«${a.raw}» (${ALIAS_LABEL[ch.system]}) ya está asignada a ${who}. No se reasigna por parecido: retírela allí o elija otro valor.`, "CONFLICT");
    }
    // Vigencia de la clave nueva: desconocida (sin inicio) salvo que otra asignación cerrada la ocupe, en cuyo caso empieza al terminar esa.
    const closedEnds = others.map((r) => fromDbDate(r.validTo)).filter((x): x is string => x !== null);
    const from = closedEnds.length > 0 ? closedEnds.sort().at(-1)! : null;
    const reopen = mine.find((r) => !r.isActive || (r.validTo !== null && (fromDbDate(r.validTo) as string) <= today));
    if (reopen) {
      const upd = await tx.externalIdentity.update({ where: { id: reopen.id }, data: { isActive: true, validTo: null, rawValue: a.raw, version: { increment: 1 } } });
      await recordAudit(tx, actor, { action: "REACTIVATE", entityType: "ExternalIdentity", entityId: reopen.id, ...ctxIds, summary: `${CONTEXT}: se recupera la clave ${ALIAS_LABEL[ch.system]} «${a.raw}» de ${info.label}`, before: reopen, after: upd });
    } else {
      const fk = ch.scope === "group" ? { groupId: ch.id } : { clientId: ch.id };
      const row = await tx.externalIdentity.create({ data: { system, kind, rawValue: a.raw, searchValue: a.sv, validFrom: toDbDate(from), validTo: null, note: CONTEXT, ...fk } });
      await recordAudit(tx, actor, { action: "CREATE", entityType: "ExternalIdentity", entityId: row.id, ...ctxIds, summary: `${CONTEXT}: clave ${ALIAS_LABEL[ch.system]} «${a.raw}» asignada a ${info.label}`, after: row });
    }
    notes.push(`Se añade «${a.raw}»: lo ya cargado con esa clave se atribuye automáticamente.`);
  }
  item(c, { key, entity: info.label, field: ALIAS_LABEL[ch.system], before: list(current.map((r) => r.rawValue)), after: list(after.map((a) => a.raw)), notes });
}

// ------------------------------------------------------------------------------------------------ Datos de servicio

async function applyTerm(c: Ctx, ch: Extract<EditChange, { op: "term" }>): Promise<void> {
  const key = changeKey(ch);
  const { tx, actor, today } = c;
  const info = await scopeInfo(tx, ch.scope, ch.id);
  if (!info) return fail(c, key, "El Grupo o el Cliente ya no existe.", "CONFLICT");
  const attr = ch.attribute as TermAttr;
  if (!TERM_OPTIONS[attr].some(([v]) => v === ch.after)) return fail(c, key, `${TERM_LABEL[attr]}: elija uno de los valores de la lista.`);
  const rows = await tx.serviceTerm.findMany({ where: { attribute: attr, ...fkOf(ch.scope, ch.id) } });
  const live = rows.filter((r) => (r.validFrom === null || (fromDbDate(r.validFrom) as string) <= today) && (r.validTo === null || today < (fromDbDate(r.validTo) as string)));
  if (live.length > 1) return fail(c, key, "Hay valores distintos vigentes a la vez: resuélvalo en la ficha (gestión excepcional).", "CONFLICT");
  const cur = live[0]?.value ?? null;
  if (cur === ch.after) return;
  if (cur !== ch.before) return fail(c, key, `Otra persona ha cambiado este campo: ahora es «${termValueLabel(attr, cur)}». Revise y vuelva a guardar; no se ha guardado nada.`, "CONFLICT");
  const ids = { groupId: info.groupId, clientId: info.clientId };
  const notes: string[] = [];
  if (live[0]) {
    const upd = await tx.serviceTerm.update({ where: { id: live[0].id }, data: { value: ch.after, version: { increment: 1 } } });
    await recordAudit(tx, actor, { action: "UPDATE", entityType: "ServiceTerm", entityId: live[0].id, ...ids, summary: `${CONTEXT}: ${TERM_LABEL[attr]} de ${info.label}: ${termValueLabel(attr, cur)} → ${termValueLabel(attr, ch.after)} (corrección del tramo vigente)`, before: live[0], after: upd });
    if (rows.length > 1) notes.push("Se corrige el tramo vigente; el historial de vigencias anterior se conserva.");
  } else if (rows.length > 0) {
    return fail(c, key, "Este dato tiene tramos de vigencia pero ninguno vigente hoy: gestione sus fechas en la ficha (gestión excepcional).");
  } else {
    const row = await tx.serviceTerm.create({ data: { attribute: attr, value: ch.after, validFrom: null, validTo: null, note: `${CONTEXT}; fecha de inicio desconocida`, ...fkOf(ch.scope, ch.id) } });
    await recordAudit(tx, actor, { action: "CREATE", entityType: "ServiceTerm", entityId: row.id, ...ids, summary: `${CONTEXT}: ${TERM_LABEL[attr]} de ${info.label}: ${termValueLabel(attr, ch.after)} (fecha de inicio desconocida)`, after: row });
  }
  item(c, { key, entity: info.label, field: TERM_LABEL[attr], before: termValueLabel(attr, cur), after: termValueLabel(attr, ch.after), notes });
}

// ------------------------------------------------------------------------------------------------ Nombre, estado, «No aplica»

async function applyName(c: Ctx, ch: Extract<EditChange, { op: "name" }>): Promise<void> {
  const key = changeKey(ch);
  const { tx, actor } = c;
  const after = cleanText(ch.after);
  if (after === "") return fail(c, key, "El nombre es obligatorio.");
  if (after.length > 200) return fail(c, key, "Máximo 200 caracteres.");
  if (ch.entity === "group") {
    const g = await tx.clientGroup.findUnique({ where: { id: ch.id } });
    if (!g) return fail(c, key, "El Grupo ya no existe.", "CONFLICT");
    if (g.name === after) return;
    if (g.name !== cleanText(ch.before)) return fail(c, key, `Otra persona ha cambiado el nombre: ahora es «${g.name}». Revise y vuelva a guardar.`, "CONFLICT");
    const dup = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "ClientGroup" WHERE lower("name") = lower(${after}) AND id <> ${g.id}`);
    if (dup.length > 0) return fail(c, key, "Ya existe un Grupo Cliente con ese nombre.");
    const notes: string[] = [];
    // Denominación BC: sigue al nombre solo si coincidía con él; la clave BC del nombre anterior se CONSERVA (los ingresos ya atribuidos no se pierden).
    const syncBc = g.bcDenomination === g.name || g.bcDenomination === null;
    const upd = await tx.clientGroup.update({ where: { id: g.id }, data: { name: after, ...(syncBc ? { bcDenomination: after } : {}), version: { increment: 1 } } });
    const sv = searchValueOf("GROUP_KEY", after);
    const holders = await tx.externalIdentity.findMany({ where: { system: "BC", kind: "GROUP_KEY", searchValue: sv, isActive: true } });
    if (holders.some((h) => h.groupId !== g.id)) {
      const owner = await targetName(tx, holders.find((h) => h.groupId !== g.id)!);
      return fail(c, key, `La denominación BC «${after}» ya identifica a ${owner}: no se reasigna por parecido. Elija otro nombre.`, "CONFLICT");
    }
    if (holders.length === 0) {
      const row = await tx.externalIdentity.create({ data: { system: "BC", kind: "GROUP_KEY", rawValue: after, searchValue: sv, validFrom: null, validTo: null, note: CONTEXT, groupId: g.id } });
      await recordAudit(tx, actor, { action: "CREATE", entityType: "ExternalIdentity", entityId: row.id, groupId: g.id, summary: `${CONTEXT}: clave BC «${after}» asignada al Grupo «${after}»`, after: row });
      notes.push(`Se añade la clave BC «${after}».`);
    }
    notes.push("Las claves BC, Wrike, PAP y Zendesk anteriores siguen vigentes: no se pierde ninguna atribución.");
    await recordAudit(tx, actor, { action: "UPDATE", entityType: "ClientGroup", entityId: g.id, groupId: g.id, summary: `${CONTEXT}: Grupo «${g.name}» → «${after}»`, before: g, after: upd });
    return item(c, { key, entity: `Grupo «${g.name}»`, field: "Grupo Cliente (nombre)", before: g.name, after, notes });
  }
  const cl = await tx.client.findUnique({ where: { id: ch.id } });
  if (!cl) return fail(c, key, "El Cliente ya no existe.", "CONFLICT");
  if (cl.name === after) return;
  if (cl.name !== cleanText(ch.before)) return fail(c, key, `Otra persona ha cambiado el nombre: ahora es «${cl.name}». Revise y vuelva a guardar.`, "CONFLICT");
  const dup = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "Client" WHERE COALESCE("groupId", '') = ${cl.groupId ?? ""} AND lower("name") = lower(${after}) AND id <> ${cl.id}`);
  if (dup.length > 0) return fail(c, key, "Ya existe un Cliente con ese nombre en el mismo Grupo.");
  const upd = await tx.client.update({ where: { id: cl.id }, data: { name: after, version: { increment: 1 } } });
  await recordAudit(tx, actor, { action: "UPDATE", entityType: "Client", entityId: cl.id, groupId: cl.groupId, clientId: cl.id, summary: `${CONTEXT}: Cliente «${cl.name}» → «${after}»`, before: cl, after: upd });
  item(c, { key, entity: (await clientLabel(tx, cl.id))!.label, field: "Zendesk (nombre del Cliente)", before: cl.name, after, notes: ["El ID de organización Zendesk no cambia: la atribución sigue siendo por ID."] });
}

async function applyActive(c: Ctx, ch: Extract<EditChange, { op: "active" }>): Promise<void> {
  const key = changeKey(ch);
  const { tx, actor } = c;
  if (ch.entity === "group") {
    const g = await tx.clientGroup.findUnique({ where: { id: ch.id } });
    if (!g) return fail(c, key, "El Grupo ya no existe.", "CONFLICT");
    if (g.isActive === ch.after) return;
    if (g.isActive !== ch.before) return fail(c, key, `Otra persona ha cambiado el estado: ahora está ${g.isActive ? "activo" : "inactivo"}.`, "CONFLICT");
    const upd = await tx.clientGroup.update({ where: { id: g.id }, data: { isActive: ch.after, version: { increment: 1 } } });
    await recordAudit(tx, actor, { action: ch.after ? "REACTIVATE" : "DEACTIVATE", entityType: "ClientGroup", entityId: g.id, groupId: g.id, summary: `${CONTEXT}: ${ch.after ? "reactivación" : "desactivación"} del Grupo «${g.name}»`, before: g, after: upd });
    return item(c, { key, entity: `Grupo «${g.name}»`, field: "Estado", before: g.isActive ? "Activo" : "Inactivo", after: ch.after ? "Activo" : "Inactivo", notes: ch.after ? [] : ["Se conserva con sus relaciones e historial; deja de ofrecerse en Activos."] });
  }
  const cl = await tx.client.findUnique({ where: { id: ch.id } });
  if (!cl) return fail(c, key, "El Cliente ya no existe.", "CONFLICT");
  if (cl.isActive === ch.after) return;
  if (cl.isActive !== ch.before) return fail(c, key, `Otra persona ha cambiado el estado: ahora está ${cl.isActive ? "activo" : "inactivo"}.`, "CONFLICT");
  const upd = await tx.client.update({ where: { id: cl.id }, data: { isActive: ch.after, version: { increment: 1 } } });
  await recordAudit(tx, actor, { action: ch.after ? "REACTIVATE" : "DEACTIVATE", entityType: "Client", entityId: cl.id, groupId: cl.groupId, clientId: cl.id, summary: `${CONTEXT}: ${ch.after ? "reactivación" : "desactivación"} del Cliente «${cl.name}»`, before: cl, after: upd });
  item(c, { key, entity: (await clientLabel(tx, cl.id))!.label, field: "Estado", before: cl.isActive ? "Activo" : "Inactivo", after: ch.after ? "Activo" : "Inactivo", notes: [] });
}

async function applyNa(c: Ctx, ch: Extract<EditChange, { op: "na" }>): Promise<void> {
  const key = changeKey(ch);
  const { tx, actor } = c;
  const info = await scopeInfo(tx, ch.scope, ch.id);
  if (!info) return fail(c, key, "El Grupo o el Cliente ya no existe.", "CONFLICT");
  const where = { ...fkOf(ch.scope, ch.id), system: ch.system };
  const existing = await tx.masterLinkDecision.findFirst({ where });
  if (Boolean(existing) === ch.after) return;
  if (Boolean(existing) !== ch.before) return fail(c, key, "Otra persona ha cambiado esta decisión «No aplica».", "CONFLICT");
  if (ch.after) await tx.masterLinkDecision.create({ data: { ...fkOf(ch.scope, ch.id), system: ch.system, decidedById: actor.id } });
  else await tx.masterLinkDecision.delete({ where: { id: existing!.id } });
  await recordAudit(tx, actor, { action: "UPDATE", entityType: "MasterLinkDecision", entityId: ch.id, groupId: info.groupId, clientId: info.clientId, summary: `${CONTEXT}: ${ch.after ? "«No aplica»" : "retirado «No aplica»"}: ${LINK_LABEL[ch.system as LinkSystem]} en ${info.label}`, before: { notApplicable: Boolean(existing) }, after: { notApplicable: ch.after } });
  item(c, { key, entity: info.label, field: `${LINK_LABEL[ch.system as LinkSystem]}: «No aplica»`, before: existing ? "No aplica" : "Sin decisión", after: ch.after ? "No aplica" : "Sin decisión", notes: ch.after ? ["Es una decisión explícita: un vacío nunca se rellena solo."] : [] });
}

// ------------------------------------------------------------------------------------------------ Altas

async function createGroupDraft(c: Ctx, ch: Extract<EditChange, { op: "newGroup" }>): Promise<void> {
  const key = changeKey(ch);
  const { tx, actor } = c;
  const name = cleanText(ch.name);
  if (name === "") return fail(c, `${key}:name`, "El nombre del Grupo es obligatorio.");
  if (name.length > 200) return fail(c, `${key}:name`, "Máximo 200 caracteres.");
  const bc = cleanText(ch.bcDenomination ?? "") || name;
  const dup = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "ClientGroup" WHERE lower("name") = lower(${name})`);
  if (dup.length > 0) return fail(c, `${key}:name`, "Ya existe un Grupo Cliente con ese nombre; edite esa fila en lugar de crear otra.");
  const sv = searchValueOf("GROUP_KEY", bc);
  const holder = await tx.externalIdentity.findFirst({ where: { system: "BC", kind: "GROUP_KEY", searchValue: sv, isActive: true } });
  if (holder) return fail(c, `${key}:bc`, `La denominación BC «${bc}» ya identifica a ${await targetName(tx, holder)}.`, "CONFLICT");
  const g = await tx.clientGroup.create({ data: { name, bcDenomination: bc, isActive: ch.active } });
  await recordAudit(tx, actor, { action: "CREATE", entityType: "ClientGroup", entityId: g.id, groupId: g.id, summary: `${CONTEXT}: alta del Grupo Cliente «${name}»`, after: g });
  const row = await tx.externalIdentity.create({ data: { system: "BC", kind: "GROUP_KEY", rawValue: bc, searchValue: sv, validFrom: null, validTo: null, note: CONTEXT, groupId: g.id } });
  await recordAudit(tx, actor, { action: "CREATE", entityType: "ExternalIdentity", entityId: row.id, groupId: g.id, summary: `${CONTEXT}: clave BC «${bc}» asignada al Grupo «${name}»`, after: row });
  c.temp.set(ch.tempId, { id: g.id, kind: "group", name });
  c.created[ch.tempId] = { id: g.id, kind: "group" };
  item(c, { key, entity: `Grupo «${name}»`, field: "Nuevo Grupo", before: "—", after: `${name}${bc !== name ? ` (BC «${bc}»)` : ""} · ${ch.active ? "Activo" : "Inactivo"}`, notes: ["Se crea sin Clientes: aparece como fila pendiente de completar."] });
}

async function createClientDraft(c: Ctx, ch: Extract<EditChange, { op: "newClient" }>): Promise<void> {
  const key = changeKey(ch);
  const { tx, actor } = c;
  const name = cleanText(ch.name);
  const groupRef = ch.group.tempId ? c.temp.get(ch.group.tempId) : ch.group.id ? { id: ch.group.id } : undefined;
  if (!groupRef) return fail(c, `${key}:group`, "Elija el Grupo del Cliente (existente o nuevo).");
  const group = await tx.clientGroup.findUnique({ where: { id: groupRef.id }, select: { id: true, name: true, isActive: true } });
  if (!group) return fail(c, `${key}:group`, "El Grupo elegido ya no existe.", "CONFLICT");
  if (!group.isActive) return fail(c, `${key}:group`, "El Grupo está inactivo: no admite nuevos Clientes hasta reactivarlo.");
  if (name === "") return fail(c, `${key}:name`, "El nombre del Cliente (organización Zendesk) es obligatorio.");
  if (name.length > 200) return fail(c, `${key}:name`, "Máximo 200 caracteres.");
  const zdId = cleanText(ch.zdId);
  if (zdId !== "" && !digitsOnly(zdId)) return fail(c, `${key}:zdId`, "El ID de organización Zendesk debe ser un entero exacto (solo dígitos, sin decimales ni notación científica).");
  for (const [attr, v] of [["SUPPORT", ch.support], ["HOSTING", ch.hosting], ["COMPLEXITY", ch.complexity]] as const) {
    if (v !== "" && !TERM_OPTIONS[attr].some(([k]) => k === v)) return fail(c, `${key}:${attr}`, `${TERM_LABEL[attr]}: elija uno de los valores de la lista.`);
  }
  if (zdId !== "") {
    const owner = await tx.externalIdentity.findFirst({ where: { system: "ZENDESK", kind: "ORG_ID", searchValue: zdId, isActive: true }, include: { client: { select: { id: true, name: true, group: { select: { name: true } } } } } });
    if (owner) return fail(c, `${key}:zdId`, `El ID ${zdId} ya pertenece al Cliente «${owner.client?.name ?? "otro"}»${owner.client?.group ? ` (Grupo «${owner.client.group.name}»)` : ""}. No se crea un segundo Cliente para el mismo ID: edite esa fila.`, "CONFLICT");
  }
  const dup = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "Client" WHERE "groupId" = ${group.id} AND lower("name") = lower(${name})`);
  if (dup.length > 0) return fail(c, `${key}:name`, "Ya existe un Cliente con ese nombre en el mismo Grupo.");
  const cl = await tx.client.create({ data: { name, groupId: group.id } });
  await recordAudit(tx, actor, { action: "CREATE", entityType: "Client", entityId: cl.id, groupId: group.id, clientId: cl.id, summary: `${CONTEXT}: alta del Cliente «${name}» en el Grupo «${group.name}»`, after: cl });
  const notes: string[] = [];
  if (zdId !== "") {
    const closed = await tx.externalIdentity.findMany({ where: { system: "ZENDESK", kind: "ORG_ID", searchValue: zdId } });
    const from = closed.map((r) => fromDbDate(r.validTo)).filter((x): x is string => x !== null).sort().at(-1) ?? null;
    const row = await tx.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: zdId, searchValue: zdId, validFrom: toDbDate(from), validTo: null, note: CONTEXT, clientId: cl.id } });
    await recordAudit(tx, actor, { action: "CREATE", entityType: "ExternalIdentity", entityId: row.id, groupId: group.id, clientId: cl.id, summary: `${CONTEXT}: ID de organización Zendesk ${zdId} asignado al Cliente «${name}»`, after: row });
    notes.push(`ID Zendesk ${zdId}: los tickets ya cargados con ese ID se atribuyen automáticamente.`);
  } else notes.push("Sin ID de organización Zendesk: los tickets no se atribuirán hasta informarlo.");
  for (const [attr, v] of [["SUPPORT", ch.support], ["HOSTING", ch.hosting], ["COMPLEXITY", ch.complexity]] as const) {
    if (v === "") continue;
    const row = await tx.serviceTerm.create({ data: { attribute: attr, value: v, validFrom: null, validTo: null, note: `${CONTEXT}; fecha de inicio desconocida`, clientId: cl.id } });
    await recordAudit(tx, actor, { action: "CREATE", entityType: "ServiceTerm", entityId: row.id, groupId: group.id, clientId: cl.id, summary: `${CONTEXT}: ${TERM_LABEL[attr]} de «${name}»: ${termValueLabel(attr, v)}`, after: row });
  }
  // Wrike de un Cliente nuevo se suma a las claves del GRUPO (equivalencia de ámbito Grupo, compartida por sus Clientes, como en el libro); el PAP es propio del Cliente
  // (identifica al hijo). Ninguna clave se reparte entre varios Clientes ni se fabrica el producto Wrike×Zendesk×PAP.
  const wantedWrike = ch.wrike.map(cleanText).filter(Boolean);
  if (wantedWrike.length > 0) {
    const cur = await currentIdentities(tx, "group", group.id, "WRIKE", c.today);
    const merged = [...cur.map((r) => r.rawValue), ...wantedWrike.filter((v) => !cur.some((r) => r.searchValue === searchValueOf("PROJECT_NAME", v)))];
    const sub: Extract<EditChange, { op: "aliases" }> = { op: "aliases", scope: "group", id: group.id, system: "WRIKE", before: cur.map((r) => r.rawValue), after: merged };
    const before = c.items.length;
    await applyAliases(c, sub);
    if (c.items.length > before) notes.push(`Wrike (del Grupo): ${wantedWrike.join(" · ")}.`);
    for (const e of c.errors) if (e.key === changeKey(sub)) e.key = `${key}:WRIKE`;
  }
  const wantedPap = ch.pap.map(cleanText).filter(Boolean);
  if (wantedPap.length > 0) {
    const sub: Extract<EditChange, { op: "aliases" }> = { op: "aliases", scope: "client", id: cl.id, system: "PAP", before: [], after: wantedPap };
    const before = c.items.length;
    await applyAliases(c, sub);
    if (c.items.length > before) notes.push(`PAP: ${wantedPap.join(" · ")}.`);
    for (const e of c.errors) if (e.key === changeKey(sub)) e.key = `${key}:PAP`;
  }
  c.temp.set(ch.tempId, { id: cl.id, kind: "client", name });
  c.created[ch.tempId] = { id: cl.id, kind: "client" };
  item(c, { key, entity: `Cliente «${name}» (Grupo «${group.name}»)`, field: "Nuevo Cliente", before: "—", after: `${name}${zdId ? ` · ID ${zdId}` : ""}`, notes });
}

// ------------------------------------------------------------------------------------------------ Orquestación

const PHASE: Record<EditChange["op"], number> = { newGroup: 0, newClient: 1, name: 2, active: 3, aliases: 4, term: 5, na: 6 };

async function execute(c: Ctx, changes: EditChange[]): Promise<void> {
  const keys = new Set<string>();
  for (const ch of changes) {
    const k = changeKey(ch);
    if (keys.has(k)) return fail(c, k, "El mismo campo figura dos veces en el borrador: revise y vuelva a guardar.");
    keys.add(k);
  }
  for (const ch of [...changes].sort((a, b) => PHASE[a.op] - PHASE[b.op])) {
    switch (ch.op) {
      case "newGroup": await createGroupDraft(c, ch); break;
      case "newClient": await createClientDraft(c, ch); break;
      case "name": await applyName(c, ch); break;
      case "active": await applyActive(c, ch); break;
      case "aliases": await applyAliases(c, ch); break;
      case "term": await applyTerm(c, ch); break;
      case "na": await applyNa(c, ch); break;
    }
  }
}

async function findOperation(tx: Tx, operationId: string) {
  return tx.auditEvent.findFirst({ where: { entityType: "EditOperation", entityId: operationId }, select: { after: true } });
}

async function run(actorId: string, raw: unknown, dryRun: boolean): Promise<EditResult> {
  const input = parseInput(editInputSchema, raw);
  const digest = draftDigest(input.changes);
  if (!dryRun && input.digest && input.digest !== digest) {
    throw new DomainError("El borrador cambió después de revisarlo. Vuelva a pulsar «Guardar cambios» para revisarlo de nuevo; no se ha guardado nada.");
  }
  try {
    return await prisma.$transaction(
      async (tx) => {
        const actor = await authorize(tx, actorId, "ADMIN");
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('csapp-master-edit'))`;
        if (!dryRun) {
          const done = await findOperation(tx, input.operationId);
          if (done) {
            const a = (done.after ?? {}) as { created?: EditResult["created"] };
            return { ok: true, digest, items: [], errors: [], created: a.created ?? {}, alreadyApplied: true };
          }
        }
        const c: Ctx = { tx, actor, today: todayMadrid(), items: [], errors: [], created: {}, temp: new Map() };
        await execute(c, input.changes);
        const result: EditResult = { ok: c.errors.length === 0, digest, items: c.items, errors: c.errors, created: c.created };
        if (!result.ok || dryRun) throw new Rollback(result);
        if (result.items.length > 0) {
          await recordAudit(tx, actor, { action: "UPDATE", entityType: "EditOperation", entityId: input.operationId, summary: `${CONTEXT}: ${result.items.length} cambios guardados tras confirmación`, after: { digest, created: result.created, items: result.items.map((i) => ({ key: i.key, field: i.field, before: i.before, after: i.after })) } });
        }
        return result;
      },
      { maxWait: 5000, timeout: 30000 },
    );
  } catch (e) {
    if (e instanceof Rollback) return e.result;
    const v = violatedConstraint(e);
    if (v) {
      return { ok: false, digest, items: [], errors: [{ key: "", kind: "CONFLICT", message: "Otra operación simultánea ha modificado estos datos (restricción de integridad). Recargue y revise; no se ha guardado nada." }], created: {} };
    }
    throw e;
  }
}

/** Valida y calcula la confirmación (antes → después, efectos y conflictos) SIN escribir nada. */
export function previewMasterEdit(actorId: string, raw: unknown): Promise<EditResult> {
  return run(actorId, raw, true);
}
/** Aplica el borrador completo de forma atómica (o nada). Idempotente por `operationId`. */
export function applyMasterEdit(actorId: string, raw: unknown): Promise<EditResult> {
  return run(actorId, raw, false);
}

