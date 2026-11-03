import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { cleanText } from "@/domain/normalize";
import {
  PRECARGA_PROFILE_ID,
  SUPPORT_LABEL,
  fold,
  norm,
  type PersonPlan,
  type Plan,
} from "@/domain/precarga-maestros";
import { reviewCandidates } from "@/domain/precarga-maestros-revision";
import type { ReviewKind } from "@/domain/precarga-maestros";
import { prisma } from "@/lib/db";
import { authorize } from "../authorize";
import { DomainError } from "../errors";
import { recordAudit } from "../audit";
import { adminTransaction } from "../tx";
import type { Db } from "../uploads/profile";
import { getProfile } from "../uploads/registry";
import {
  aliasSpecs,
  ensureIdentity,
  ensurePersonAliases,
  ensureRoleFor,
  ensureTerm,
  findPersonsByAliases,
  mergePersons,
  newReport,
  personsByWrikeName,
  type Env,
} from "./apply";
import { loadPlan } from "./rows";


export type ReviewOption = { decision: string; value?: string; label: string };
export type ReviewState = "PENDING" | "RESOLVED" | "DECIDED" | "APPLIED" | "INFO";
export type ReviewItem = {
  key: string;
  kind: ReviewKind;
  state: ReviewState;
  title: string;
  message: string;
  positions: number[];
  decidable: boolean;
  options: ReviewOption[];
  /** Texto original que se asignaría (alias Wrike/PAP, persona de PERSONAL PMO). */
  raw?: string;
  decision?: { decision: string; value: string | null; reason: string; by: string; at: Date; otherBatch: boolean };
};

export type ReviewResult = {
  items: ReviewItem[];
  counts: { pending: number; resolved: number; decided: number; applied: number; info: number };
  plan: { groups: number; clients: number; wrike: number; pap: number; persons: number; roles: number; excluded: number };
};

const afterColon = (key: string) => key.slice(key.indexOf(":") + 1);

async function groupByName(db: Db, name: string): Promise<{ id: string; name: string } | null> {
  const key = norm(name);
  const ident = await db.externalIdentity.findFirst({ where: { system: "BC", kind: "GROUP_KEY", searchValue: key, isActive: true, groupId: { not: null } }, include: { group: true } });
  if (ident?.group?.isActive) return { id: ident.group.id, name: ident.group.name };
  const rows = await db.$queryRaw<{ id: string; name: string; isActive: boolean }[]>(Prisma.sql`SELECT id, name, "isActive" FROM "ClientGroup" WHERE lower("name") = lower(${cleanText(name)})`);
  return rows[0]?.isActive ? { id: rows[0].id, name: rows[0].name } : null;
}

async function clientIdByZendeskId(db: Db, zdId: string): Promise<string | null> {
  const i = await db.externalIdentity.findFirst({ where: { system: "ZENDESK", kind: "ORG_ID", searchValue: zdId, isActive: true, clientId: { not: null } }, select: { clientId: true } });
  return i?.clientId ?? null;
}

/** Tokens de un nombre comparado de forma aproximada (solo para PROPONER candidatos de enlace; nunca confirma). */
const tokens = (s: string) => fold(s).split(" ").filter(Boolean);
function extendsName(a: string[], b: string[]): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 2 && short.every((t, i) => long[i] === t);
}

/**
 * Estado actual de las revisiones de un lote de precarga: el plan del archivo frente a los maestros VIVOS (una revisión se resuelve cuando el
 * maestro ya contiene la asignación, venga de una decisión o de una edición manual) y las decisiones ligadas al checksum del archivo.
 */
export async function computeReview(db: Db, batch: { id: string; checksum: string | null }): Promise<ReviewResult> {
  const plan = await loadPlan(db, batch.id);
  const candidates = reviewCandidates(plan);
  const decisions = batch.checksum
    ? await db.masterLoadDecision.findMany({ where: { checksum: batch.checksum, reviewKey: { in: candidates.map((c) => c.key) } }, orderBy: { decidedAt: "desc" } })
    : [];
  const decisionOf = (key: string) => {
    const mine = decisions.find((d) => d.reviewKey === key && d.batchId === batch.id);
    const d = mine ?? decisions.find((x) => x.reviewKey === key);
    return d ? { decision: d.decision, value: (d.payload as { value?: string }).value ?? null, reason: d.reason, by: d.decidedByEmail, at: d.decidedAt, otherBatch: d.batchId !== batch.id } : undefined;
  };
  const items: ReviewItem[] = [];
  const planPersons = new Map(plan.persons.map((p) => [p.id, p]));

  for (const c of candidates) {
    const base: ReviewItem = { key: c.key, kind: c.kind, state: c.state === "pending" ? "PENDING" : c.state === "applied" ? "APPLIED" : "INFO", title: c.title, message: c.message, positions: c.positions, decidable: false, options: [] };
    if (c.kind === "SUPPORT" || c.kind === "HOSTING") {
      const zdId = afterColon(c.key);
      const attr = c.kind;
      const client = plan.clients.find((x) => x.zdId === zdId);
      const clientId = await clientIdByZendeskId(db, zdId);
      const values = (c.kind === "SUPPORT" ? client?.support.candidates : client?.hosting.candidates) ?? [];
      if (clientId) {
        const has = await db.serviceTerm.count({ where: { clientId, attribute: attr } });
        if (has > 0) base.state = "RESOLVED";
        else {
          base.decidable = true;
          base.options = [
            ...values.map((v) => ({ decision: "ASSIGN", value: v, label: `${SUPPORT_LABEL[v] ?? v} (vigencia inicial desconocida)` })),
            { decision: "DISMISS", label: "Dejar pendiente (no asignar ninguno)" },
          ];
        }
      }
    } else if (c.kind === "WRIKE_ALIAS" || c.kind === "PAP_ALIAS") {
      const sv = afterColon(c.key);
      const system = c.kind === "WRIKE_ALIAS" ? "WRIKE" : "PAP";
      const alias = c.kind === "WRIKE_ALIAS" ? plan.wrike.find((w) => w.key === sv) : plan.pap.find((p) => p.key === sv);
      base.raw = alias?.raw;
      const existing = await db.externalIdentity.count({ where: { system, kind: "PROJECT_NAME", searchValue: sv, isActive: true } });
      if (existing > 0) base.state = "RESOLVED";
      else {
        const opts: ReviewOption[] = [];
        for (const gk of alias?.groupKeys ?? []) {
          const name = plan.groups.find((g) => g.key === gk)?.name ?? gk;
          const g = await groupByName(db, name);
          if (g) opts.push({ decision: "ASSIGN", value: g.id, label: `Asignar al Grupo «${g.name}»` });
        }
        if (opts.length > 0) {
          base.decidable = true;
          base.options = [...opts, { decision: "DISMISS", label: "Dejar sin asignar" }];
        }
      }
    } else if (c.kind === "PERSON_VARIANT") {
      const ids = plan.variants.find((v) => `PERSON_VARIANT:${v.key}` === c.key)?.ids ?? [];
      const resolved = new Map<string, string>();
      for (const pid of ids) {
        const p = planPersons.get(pid) as PersonPlan;
        const found = await findPersonsByAliases(db, aliasSpecs(p));
        if (found.length === 1) resolved.set(found[0], p.name);
      }
      if (resolved.size === 1) base.state = "RESOLVED";
      else if (resolved.size >= 2) {
        base.decidable = true;
        base.options = [
          ...[...resolved.entries()].map(([id, name]) => ({ decision: "MERGE", value: id, label: `Son la misma persona: conservar «${name}» y fusionar las demás en ella` })),
          { decision: "KEEP_SEPARATE", label: "Son personas distintas (mantener separadas)" },
        ];
      }
    }
    const d = decisionOf(c.key);
    if (d && base.state === "PENDING") {
      base.state = "DECIDED";
      base.decision = d;
    } else if (d) base.decision = d;
    items.push(base);
  }

  // Roles de PERSONAL PMO sin persona con ese alias Wrike exacto: se propone un candidato por nombre extendido; el enlace es una decisión.
  const people = plan.roles.length ? await db.personAlias.findMany({ where: { system: "WRIKE", kind: "NAME", isActive: true, person: { isActive: true } }, select: { rawValue: true, person: { select: { id: true, name: true } } } }) : [];
  for (const r of plan.roles) {
    const found = await personsByWrikeName(db, r.raw);
    if (found.length !== 0) continue;
    const mine = tokens(r.raw);
    const cand = new Map<string, string>();
    for (const a of people) if (extendsName(mine, tokens(a.rawValue))) cand.set(a.person.id, a.person.name);
    const key = `PMO_ROLE:${r.key}`;
    const known = !!r.perfil.value;
    const options: ReviewOption[] = known
      ? [
          ...[...cand.entries()].map(([id, name]) => ({ decision: "LINK", value: id, label: `Es «${name}»: añadir este alias Wrike y asignar el rol ${r.perfil.value}` })),
          { decision: "CREATE", label: `Persona PMO nueva «${r.raw}» con el rol ${r.perfil.value} (sin nivel ni equipo)` },
          { decision: "DISMISS", label: "Dejar sin enlazar" },
        ]
      : [];
    const item: ReviewItem = {
      key, kind: "PMO_ROLE", state: "PENDING", title: `Rol PMO de «${r.raw}»`, positions: [r.position], decidable: known, options, raw: r.raw,
      message: cand.size > 0
        ? `Ningún alias Wrike coincide exactamente. Posible nombre extendido de ${[...cand.values()].map((n) => `«${n}»`).join(", ")}: confirme el enlace, no se une automáticamente ni se duplica.`
        : "Ningún alias Wrike coincide exactamente y no hay candidato claro: puede añadirse como persona PMO nueva con lo conocido, sin adivinar el nivel.",
    };
    const d = decisionOf(key);
    if (d) {
      item.state = "DECIDED";
      item.decision = d;
    }
    items.push(item);
  }

  const n = (s: ReviewState) => items.filter((i) => i.state === s).length;
  return {
    items,
    counts: { pending: n("PENDING"), resolved: n("RESOLVED"), decided: n("DECIDED"), applied: n("APPLIED"), info: n("INFO") },
    plan: { groups: plan.groups.length, clients: plan.clients.length, wrike: plan.wrike.length, pap: plan.pap.length, persons: plan.persons.length, roles: plan.roles.length, excluded: plan.excluded.length },
  };
}

// ---------------------------------------------------------------- Consulta para la ficha (solo Administrador)

export async function getPrecargaReview(actorId: string, batchId: string): Promise<ReviewResult | null> {
  await authorize(prisma, actorId, "ADMIN");
  const batch = await prisma.uploadBatch.findUnique({ where: { id: batchId }, select: { id: true, checksum: true, profileId: true, status: true, rowsReceived: true } });
  if (!batch || batch.profileId !== PRECARGA_PROFILE_ID || batch.rowsReceived === 0) return null;
  if (!["READY", "ACTIVATION_QUEUED", "ACTIVATING", "COMPLETED"].includes(batch.status)) return null;
  return computeReview(prisma, batch);
}

/**
 * Hechos ya cargados que pueden depender de los maestros que acaba de resolver esta carga: lotes completados de fuentes con recálculo
 * (REDERIVE) anteriores al último cambio de maestros. El recálculo se pide, lote a lote, con «Reprocesar» en su propia ficha: no se reimportan
 * originales y las cifras antiguas no se dan por validadas.
 */
export async function reprocessNeeded(actorId: string, batchId: string): Promise<{ id: string; originalName: string; profileId: string; finishedAt: Date | null }[]> {
  await authorize(prisma, actorId, "ADMIN");
  const batch = await prisma.uploadBatch.findUnique({ where: { id: batchId }, select: { status: true, finishedAt: true, summary: true } });
  if (!batch || batch.status !== "COMPLETED" || !batch.finishedAt) return [];
  const rep = ((batch.summary ?? {}) as { precarga?: { created?: Record<string, number> } }).precarga;
  const decided = await prisma.masterLoadDecision.findMany({ where: { batchId }, select: { decidedAt: true }, orderBy: { decidedAt: "desc" }, take: 1 });
  const changedAt = decided[0] && decided[0].decidedAt > batch.finishedAt ? decided[0].decidedAt : batch.finishedAt;
  const changed = Object.values(rep?.created ?? {}).some((n) => n > 0) || decided.length > 0;
  if (!changed) return [];
  const rows = await prisma.uploadBatch.findMany({
    where: { status: "COMPLETED", profileId: { not: PRECARGA_PROFILE_ID }, finishedAt: { lt: changedAt }, supersededByBatchId: null },
    select: { id: true, originalName: true, profileId: true, finishedAt: true },
    orderBy: { finishedAt: "desc" },
    take: 100,
  });
  const out: typeof rows = [];
  for (const r of rows) if ((await getProfile(r.profileId))?.rederive) out.push(r);
  return out;
}

// ---------------------------------------------------------------- Decisiones

const decisionSchema = z.object({
  key: z.string().trim().min(1, "Falta la revisión.").max(500),
  decision: z.enum(["ASSIGN", "DISMISS", "MERGE", "KEEP_SEPARATE", "LINK", "CREATE"], { error: "Decisión no válida." }),
  value: z.string().trim().max(200).optional(),
  reason: z.string({ error: "El motivo es obligatorio." }).transform(cleanText).pipe(z.string().min(3, "Indique el motivo de la decisión (mínimo 3 caracteres).").max(500, "Motivo demasiado largo (máximo 500).")),
});

/**
 * Decisión del administrador sobre una revisión de una precarga ya completada. Guarda autor y motivo, se aplica al maestro en la misma
 * transacción (con auditoría) y es idempotente: repetir la misma decisión no cambia nada; una revisión ya resuelta en el maestro no se vuelve a tocar.
 */
export async function decidePrecargaReview(actorId: string, batchId: string, raw: unknown): Promise<{ idempotent: boolean }> {
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError(parsed.error.issues.map((i) => i.message).join(" "));
  const input = parsed.data;
  return adminTransaction(actorId, async (tx, actor) => {
    const locked = await tx.$queryRaw<{ id: string; status: string; checksum: string | null; profileId: string }[]>(
      Prisma.sql`SELECT id, status::text AS status, checksum, "profileId" FROM "UploadBatch" WHERE id = ${batchId} FOR UPDATE`,
    );
    const batch = locked[0];
    if (!batch || batch.profileId !== PRECARGA_PROFILE_ID) throw new DomainError("Carga de precarga de maestros no encontrada.");
    if (batch.status !== "COMPLETED" || !batch.checksum) throw new DomainError("Las revisiones se deciden cuando la carga está completada.");
    const review = await computeReview(tx, batch);
    const item = review.items.find((i) => i.key === input.key);
    if (!item) throw new DomainError("Esa revisión no existe en este archivo.");
    if (item.decision && (item.decision.decision !== input.decision || (item.decision.value ?? "") !== (input.value ?? ""))) {
      throw new DomainError("Esta revisión ya tiene otra decisión registrada; los cambios posteriores se hacen en el maestro correspondiente.");
    }
    if (item.decision) return { idempotent: true };
    if (item.state === "RESOLVED") throw new DomainError("Esta revisión ya está resuelta en los maestros: no hay nada que decidir.");
    if (!item.decidable) throw new DomainError("Esta revisión no admite decisión desde aquí (corrija el dato en su maestro o en el archivo).");
    const opt = item.options.find((o) => o.decision === input.decision && (o.value ?? "") === (input.value ?? ""));
    if (!opt) throw new DomainError("La opción elegida no es una de las propuestas para esta revisión.");

    const env: Env = { tx, actor, batchId, report: newReport() };
    await applyDecision(env, item, input.decision, input.value);
    await tx.masterLoadDecision.create({
      data: {
        batchId, checksum: batch.checksum, reviewKey: item.key, kind: item.kind, decision: input.decision, payload: { value: input.value ?? null, label: opt.label },
        reason: input.reason, decidedById: actor.id, decidedByEmail: actor.email,
      },
    });
    await recordAudit(tx, actor, {
      action: "UPDATE", entityType: "MasterLoadDecision", entityId: `${batchId}:${item.key}`.slice(0, 190), batchId,
      summary: `Precarga de maestros: decisión «${opt.label}» sobre «${item.title}». Motivo: ${input.reason}`,
      after: { revision: item.key, decision: input.decision, valor: input.value ?? null, notas: env.report.notes.map((n) => n.code) },
    });
    return { idempotent: false };
  });
}

async function applyDecision(env: Env, item: ReviewItem, decision: string, value: string | undefined) {
  const { tx } = env;
  if (decision === "DISMISS" || decision === "KEEP_SEPARATE") return;
  if (item.kind === "SUPPORT" || item.kind === "HOSTING") {
    const zdId = afterColon(item.key);
    const clientId = await clientIdByZendeskId(tx, zdId);
    const client = clientId ? await tx.client.findUnique({ where: { id: clientId } }) : null;
    if (!client || !client.isActive || !value) throw new DomainError("El Cliente de esta revisión no existe o está inactivo.");
    await ensureTerm(env, { type: "client", id: client.id, label: `Cliente «${client.name}»`, ids: { groupId: client.groupId, clientId: client.id } }, item.kind, value, true);
    return;
  }
  if (item.kind === "WRIKE_ALIAS" || item.kind === "PAP_ALIAS") {
    const group = value ? await tx.clientGroup.findUnique({ where: { id: value } }) : null;
    if (!group || !group.isActive || !item.raw) throw new DomainError("El Grupo elegido no existe o está inactivo.");
    const r = await ensureIdentity(env, { system: item.kind === "WRIKE_ALIAS" ? "WRIKE" : "PAP", kind: "PROJECT_NAME", raw: item.raw, target: { type: "group", id: group.id }, ids: { groupId: group.id }, label: `Grupo «${group.name}»` });
    if (r === "conflict" || r === "inactive") throw new DomainError(env.report.notes.at(-1)?.message ?? "La equivalencia no se puede asignar.");
    return;
  }
  if (item.kind === "PERSON_VARIANT") {
    if (!value) throw new DomainError("Falta la persona que se conserva.");
    const ids = item.options.filter((o) => o.decision === "MERGE" && o.value && o.value !== value).map((o) => o.value as string);
    for (const drop of ids) await mergePersons(env, value, drop);
    return;
  }
  if (item.kind === "PMO_ROLE") {
    const plan: Plan = await loadPlan(tx, env.batchId);
    const role = plan.roles.find((r) => `PMO_ROLE:${r.key}` === item.key);
    if (!role?.perfil.value) throw new DomainError("El perfil de esta fila no es ANA/DEV: el rol sigue desconocido.");
    let person: { id: string; name: string; isActive: boolean } | null = null;
    if (decision === "LINK") {
      person = value ? await tx.person.findUnique({ where: { id: value }, select: { id: true, name: true, isActive: true } }) : null;
      if (!person || !person.isActive) throw new DomainError("La persona elegida no existe o está inactiva.");
    } else {
      const exists = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "Person" WHERE lower("name") = lower(${role.raw})`);
      if (exists[0]) throw new DomainError("Ya existe una persona con ese nombre: use «enlazar» con ella.");
      const created = await tx.person.create({ data: { name: role.raw, note: "Precarga de maestros: persona PMO añadida tras revisión; sin nivel ni equipo conocidos." } });
      await recordAudit(tx, env.actor, { action: "CREATE", entityType: "Person", entityId: created.id, personId: created.id, batchId: env.batchId, summary: `Precarga de maestros: alta de la persona PMO «${created.name}» tras revisión`, after: created });
      person = { id: created.id, name: created.name, isActive: true };
    }
    await ensurePersonAliases(env, person, [{ system: "WRIKE", kind: "NAME", raw: role.raw }]);
    const linked = await personsByWrikeName(tx, role.raw);
    if (linked.length !== 1 || linked[0].id !== person.id) throw new DomainError(env.report.notes.at(-1)?.message ?? "El alias Wrike no se pudo asignar a esa persona.");
    const pmoTerms = await tx.personTerm.findMany({ where: { personId: person.id, attribute: "PMO_MEMBER" } });
    if (pmoTerms.length === 0) {
      const t = await tx.personTerm.create({ data: { personId: person.id, attribute: "PMO_MEMBER", flag: true, validFrom: null, validTo: null, note: "Precarga de maestros: pertenencia a PMO por decisión del administrador; vigencia inicial desconocida, por revisar." } });
      await recordAudit(tx, env.actor, { action: "CREATE", entityType: "PersonTerm", entityId: t.id, personId: person.id, batchId: env.batchId, summary: `Precarga de maestros: «${person.name}» pertenece a PMO (fecha de inicio desconocida)`, after: t });
    } else if (!pmoTerms.some((t) => t.flag === true)) {
      throw new DomainError(`«${person.name}» figura sin pertenecer a PMO: corrija primero su pertenencia en Personal (no se pisa una pertenencia conocida).`);
    }
    const out = await ensureRoleFor(env, person, role.perfil.value);
    if (out === "no-pmo" || out === "inactive-role") throw new DomainError(env.report.notes.at(-1)?.message ?? "No se pudo asignar el rol.");
  }
}
