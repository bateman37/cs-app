import { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/access";
import { cleanText, searchValueOf } from "@/domain/normalize";
import { aliasSearchValue, type AliasKind, type PersonSystem } from "@/domain/personal";
import {
  looksLikeEmail,
  norm,
  type ClientPlan,
  type PersonPlan,
  type Plan,
  type RolePlan,
} from "@/domain/precarga-maestros";
import { recordAudit } from "../audit";
import { authorize } from "../authorize";
import { DomainError } from "../errors";
import type { ActivationContext, Db } from "../uploads/profile";
import { loadPlan } from "./rows";

type Tx = Prisma.TransactionClient;

/**
 * Aplicación idempotente de la precarga de maestros. Reglas comunes:
 *  - crea lo ausente y reutiliza lo inequívoco (identidad EXACTA: el ID de Zendesk, el alias normalizado en espacios y mayúsculas, el nombre
 *    sin distinguir mayúsculas dentro de su ámbito único); nunca borra ni recrea;
 *  - preserva lo editado después: un maestro inactivo no se reactiva, una equivalencia desactivada no se vuelve a crear, un dato de servicio o un
 *    tramo de persona que ya existe (de cualquier vigencia) no se toca;
 *  - los datos nuevos nacen con vigencia inicial DESCONOCIDA (`validFrom = null`): no acreditan toda la historia ni sustituyen una migración CLOUD
 *    o una pertenencia PMO histórica ya conocidas;
 *  - un conflicto (alias activo de otro destino, nombre en uso...) no se resuelve por semejanza: se omite y se deja constancia en el informe.
 */

export type Report = {
  created: Record<string, number>;
  reused: Record<string, number>;
  preserved: Record<string, number>;
  notes: { code: string; message: string }[];
};

export type Env = { tx: Tx; actor: Actor; batchId: string; report: Report };

export const newReport = (): Report => ({ created: {}, reused: {}, preserved: {}, notes: [] });
const bump = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1;
};
export function note(env: Env, code: string, message: string) {
  if (env.report.notes.length < 400) env.report.notes.push({ code, message });
}

const P = "Precarga de maestros: ";
const NOTE = "Precarga de maestros (hojas de carga); vigencia inicial desconocida, por revisar.";

type Ids = { groupId?: string | null; clientId?: string | null; personId?: string | null };

async function auditCreate(env: Env, entityType: string, entityId: string, summary: string, after: unknown, ids: Ids = {}) {
  await recordAudit(env.tx, env.actor, { action: "CREATE", entityType, entityId, batchId: env.batchId, ...ids, summary: P + summary, after });
}

// ---------------------------------------------------------------- Grupos, Clientes, implantaciones, equivalencias, datos de servicio

type Ref = { id: string; active: boolean };
type Target = { type: "group" | "client" | "implementation"; id: string };

export async function ensureIdentity(
  env: Env,
  spec: { system: "BC" | "ZENDESK" | "WRIKE" | "PAP"; kind: "GROUP_KEY" | "ORG_ID" | "PROJECT_NAME"; raw: string; target: Target; ids: Ids; label: string },
): Promise<"created" | "reused" | "conflict" | "inactive"> {
  const { tx } = env;
  const raw = cleanText(spec.raw);
  const searchValue = searchValueOf(spec.kind, raw);
  const existing = await tx.externalIdentity.findMany({ where: { system: spec.system, kind: spec.kind, searchValue } });
  const sameTarget = (e: (typeof existing)[number]) =>
    spec.target.type === "group" ? e.groupId === spec.target.id : spec.target.type === "client" ? e.clientId === spec.target.id : e.implementationId === spec.target.id;
  if (existing.some(sameTarget)) {
    bump(env.report.reused, `identidades.${spec.system}`);
    return "reused";
  }
  if (existing.some((e) => e.isActive)) {
    note(env, "IDENTIDAD_EN_CONFLICTO", `«${raw}» (${spec.system}) ya está asignada a otro destino activo; no se reasigna (${spec.label}).`);
    return "conflict";
  }
  if (existing.length > 0) {
    note(env, "IDENTIDAD_DESACTIVADA", `«${raw}» (${spec.system}) estaba desactivada en el maestro; no se reactiva ni se vuelve a crear (${spec.label}).`);
    return "inactive";
  }
  const fk = spec.target.type === "group" ? { groupId: spec.target.id } : spec.target.type === "client" ? { clientId: spec.target.id } : { implementationId: spec.target.id };
  const created = await tx.externalIdentity.create({
    data: { system: spec.system, kind: spec.kind, rawValue: raw, searchValue, validFrom: null, validTo: null, note: NOTE, ...fk },
  });
  bump(env.report.created, `identidades.${spec.system}`);
  await auditCreate(env, "ExternalIdentity", created.id, `equivalencia ${spec.system} «${raw}» asignada a ${spec.label}`, created, spec.ids);
  return "created";
}

/**
 * Un alias (Wrike/PAP) que el libro asigna a VARIOS Grupos no crea equivalencia: se guardan los Grupos candidatos para que el propio registro (ticket
 * vinculado y su organización) pueda resolverlo cuando identifique un único candidato compatible. Idempotente; no sustituye una equivalencia ya existente.
 */
export async function ensureCandidates(env: Env, system: "WRIKE" | "PAP", raw: string, groupIds: string[]): Promise<void> {
  const { tx } = env;
  const clean = cleanText(raw);
  const searchValue = searchValueOf("PROJECT_NAME", clean);
  if ((await tx.externalIdentity.count({ where: { system, kind: "PROJECT_NAME", searchValue, isActive: true } })) > 0) return;
  for (const groupId of groupIds) {
    const key = { system_kind_searchValue_groupId: { system, kind: "PROJECT_NAME" as const, searchValue, groupId } };
    if (await tx.aliasCandidate.findUnique({ where: key, select: { id: true } })) continue;
    await tx.aliasCandidate.create({ data: { system, kind: "PROJECT_NAME", rawValue: clean, searchValue, groupId, batchId: env.batchId } });
    bump(env.report.created, `candidatos.${system}`);
  }
}

export async function ensureGroup(env: Env, name: string): Promise<Ref> {
  const { tx } = env;
  const clean = cleanText(name);
  const key = norm(clean);
  const ident = await tx.externalIdentity.findFirst({
    where: { system: "BC", kind: "GROUP_KEY", searchValue: key, isActive: true, groupId: { not: null } },
    include: { group: true },
  });
  let ref: Ref;
  if (ident?.group) {
    bump(env.report.reused, "grupos");
    ref = { id: ident.group.id, active: ident.group.isActive };
  } else {
    const byName = await tx.$queryRaw<{ id: string; isActive: boolean }[]>(Prisma.sql`SELECT id, "isActive" FROM "ClientGroup" WHERE lower("name") = lower(${clean})`);
    if (byName[0]) {
      bump(env.report.reused, "grupos");
      ref = { id: byName[0].id, active: byName[0].isActive };
    } else {
      const g = await tx.clientGroup.create({ data: { name: clean, bcDenomination: clean } });
      bump(env.report.created, "grupos");
      await auditCreate(env, "ClientGroup", g.id, `alta del Grupo Cliente «${g.name}»`, g, { groupId: g.id });
      ref = { id: g.id, active: true };
    }
  }
  if (!ref.active) {
    note(env, "GRUPO_INACTIVO", `El Grupo «${clean}» está inactivo en el maestro: no se reactiva ni se le asignan Clientes ni equivalencias nuevas.`);
    return ref;
  }
  // Equivalencia BC (la que usa finanzas): denominación → Grupo.
  await ensureIdentity(env, { system: "BC", kind: "GROUP_KEY", raw: clean, target: { type: "group", id: ref.id }, ids: { groupId: ref.id }, label: `Grupo «${clean}»` });
  return ref;
}

export async function ensureClient(env: Env, p: Pick<ClientPlan, "zdId" | "name" | "internal">, group: Ref | null): Promise<Ref | null> {
  const { tx } = env;
  const identities = await tx.externalIdentity.findMany({ where: { system: "ZENDESK", kind: "ORG_ID", searchValue: p.zdId }, include: { client: true } });
  const active = identities.find((i) => i.isActive && i.client);
  if (active?.client) {
    bump(env.report.reused, "clientes");
    if (!active.client.isActive) note(env, "CLIENTE_INACTIVO", `El Cliente «${active.client.name}» (ID ${p.zdId}) está inactivo en el maestro: no se reactiva.`);
    if (group && active.client.groupId !== group.id) {
      note(env, "CLIENTE_OTRO_GRUPO", `El Cliente «${active.client.name}» (ID ${p.zdId}) ya existe con otro Grupo que el del libro: se conserva el del maestro.`);
    }
    return { id: active.client.id, active: active.client.isActive };
  }
  if (identities.length > 0) {
    note(env, "IDENTIDAD_DESACTIVADA", `El ID de Zendesk ${p.zdId} estaba desactivado en el maestro: no se reactiva ni se vuelve a crear el Cliente «${p.name}».`);
    return null;
  }
  if (group && !group.active) {
    note(env, "GRUPO_INACTIVO", `El Cliente «${p.name}» (ID ${p.zdId}) no se crea: su Grupo está inactivo.`);
    return null;
  }
  const clean = cleanText(p.name);
  const byName = await tx.$queryRaw<{ id: string; isActive: boolean }[]>(
    Prisma.sql`SELECT id, "isActive" FROM "Client" WHERE COALESCE("groupId", '') = ${group?.id ?? ""} AND lower("name") = lower(${clean})`,
  );
  let ref: Ref;
  if (byName[0]) {
    const others = await tx.externalIdentity.count({ where: { clientId: byName[0].id, system: "ZENDESK", kind: "ORG_ID" } });
    if (others > 0) {
      note(env, "NOMBRE_CLIENTE_EN_USO", `Ya existe un Cliente «${clean}» en ese Grupo con otro ID de Zendesk: el ID ${p.zdId} no se asigna.`);
      return null;
    }
    if (!byName[0].isActive) {
      note(env, "CLIENTE_INACTIVO", `El Cliente «${clean}» existente está inactivo: no se reactiva ni se le asigna el ID ${p.zdId}.`);
      return null;
    }
    bump(env.report.reused, "clientes");
    ref = { id: byName[0].id, active: true };
  } else {
    const c = await tx.client.create({ data: { name: clean, groupId: group?.id ?? null, isInternal: p.internal } });
    bump(env.report.created, "clientes");
    await auditCreate(env, "Client", c.id, `alta del Cliente «${c.name}»${p.internal ? " (organización interna)" : ""}`, c, { groupId: c.groupId, clientId: c.id });
    ref = { id: c.id, active: true };
  }
  await ensureIdentity(env, {
    system: "ZENDESK", kind: "ORG_ID", raw: p.zdId, target: { type: "client", id: ref.id }, ids: { groupId: group?.id ?? null, clientId: ref.id }, label: `Cliente «${clean}»`,
  });
  return ref;
}

export async function ensureImplementation(env: Env, client: { id: string; name: string; groupId: string | null }, name: string): Promise<Ref | null> {
  const { tx } = env;
  const clean = cleanText(name);
  const found = await tx.$queryRaw<{ id: string; isActive: boolean }[]>(Prisma.sql`SELECT id, "isActive" FROM "Implementation" WHERE "clientId" = ${client.id} AND lower("name") = lower(${clean})`);
  if (found[0]) {
    bump(env.report.reused, "implantaciones");
    if (!found[0].isActive) {
      note(env, "IMPLANTACION_INACTIVA", `La implantación «${clean}» está inactiva en el maestro: no se reactiva.`);
      return null;
    }
    return { id: found[0].id, active: true };
  }
  const impl = await tx.implementation.create({ data: { clientId: client.id, name: clean } });
  bump(env.report.created, "implantaciones");
  await auditCreate(env, "Implementation", impl.id, `alta de la implantación «${clean}» del Cliente «${client.name}»`, impl, { groupId: client.groupId, clientId: client.id });
  return { id: impl.id, active: true };
}

export async function ensureTerm(
  env: Env,
  scope: { type: "client" | "implementation"; id: string; label: string; ids: Ids },
  attribute: "SUPPORT" | "HOSTING" | "COMPLEXITY",
  value: string,
  forced = false,
): Promise<"created" | "preserved"> {
  const { tx } = env;
  const fk = scope.type === "client" ? { clientId: scope.id } : { implementationId: scope.id };
  const existing = await tx.serviceTerm.findMany({ where: { attribute, ...fk } });
  if (existing.length > 0) {
    bump(env.report.preserved, `datosServicio.${attribute}`);
    if (!existing.some((e) => e.value === value)) note(env, "DATO_DISTINTO_EN_MAESTRO", `${attribute} de ${scope.label}: el maestro ya tiene otro valor; se conserva (el del libro era ${value}).`);
    return "preserved";
  }
  const term = await tx.serviceTerm.create({
    data: { attribute, value, validFrom: null, validTo: null, note: forced ? "Decisión del administrador sobre la precarga; vigencia inicial desconocida, por revisar." : NOTE, ...fk },
  });
  bump(env.report.created, `datosServicio.${attribute}`);
  await auditCreate(env, "ServiceTerm", term.id, `${attribute} de ${scope.label}: ${value} (fecha de inicio desconocida)`, term, scope.ids);
  return "created";
}

// ---------------------------------------------------------------- Personal

export type AliasSpec = { system: PersonSystem; kind: AliasKind; raw: string };

/** Alias que aporta una persona del libro: PAP (correo si lo parece, si no nombre), UN solo alias Zendesk (la columna G repite la B) y Wrike. */
export function aliasSpecs(p: Pick<PersonPlan, "papAliases" | "zendeskAliases" | "wrikeAliases">): AliasSpec[] {
  const out: AliasSpec[] = [];
  for (const a of p.papAliases) out.push({ system: "PAP", kind: looksLikeEmail(a) ? "EMAIL" : "NAME", raw: a });
  if (p.zendeskAliases[0]) out.push({ system: "ZENDESK", kind: "NAME", raw: p.zendeskAliases[0] });
  for (const a of p.wrikeAliases) out.push({ system: "WRIKE", kind: "NAME", raw: a });
  return out;
}

/** Personas activas que ya tienen alguno de esos alias activos (coincidencia exacta normalizada; nunca por semejanza). */
export async function findPersonsByAliases(db: Db, specs: AliasSpec[]): Promise<string[]> {
  const ids = new Set<string>();
  for (const s of specs) {
    const rows = await db.personAlias.findMany({ where: { system: s.system, kind: s.kind, searchValue: aliasSearchValue(s.kind, s.raw), isActive: true }, select: { personId: true } });
    for (const r of rows) ids.add(r.personId);
  }
  return [...ids];
}

async function ensureCatalog(env: Env, kind: "LEVEL" | "TEAM" | "PMO_ROLE", name: string): Promise<string | null> {
  const { tx } = env;
  const found = await tx.$queryRaw<{ id: string; isActive: boolean }[]>(Prisma.sql`SELECT id, "isActive" FROM "StaffCatalogItem" WHERE kind = ${kind}::"StaffCatalogKind" AND lower("name") = lower(${name})`);
  if (found[0]) {
    if (!found[0].isActive) {
      note(env, "CATALOGO_INACTIVO", `El valor de catálogo «${name}» (${kind}) está inactivo: no se asigna.`);
      return null;
    }
    return found[0].id;
  }
  const item = await tx.staffCatalogItem.create({ data: { kind, name } });
  bump(env.report.created, `catalogo.${kind}`);
  await auditCreate(env, "StaffCatalogItem", item.id, `alta en el catálogo (${kind}): «${name}»`, item);
  return item.id;
}

export async function ensurePersonAliases(env: Env, person: { id: string; name: string }, specs: AliasSpec[]) {
  const { tx } = env;
  for (const s of specs) {
    const raw = cleanText(s.raw);
    const searchValue = aliasSearchValue(s.kind, raw);
    const existing = await tx.personAlias.findMany({ where: { system: s.system, kind: s.kind, searchValue } });
    if (existing.some((e) => e.personId === person.id)) {
      bump(env.report.reused, "alias");
      continue;
    }
    if (existing.some((e) => e.isActive)) {
      note(env, "ALIAS_DE_OTRA_PERSONA", `El alias ${s.system} «${raw}» ya pertenece a otra persona activa: no se reasigna ni se fusionan personas.`);
      continue;
    }
    if (existing.length > 0) {
      note(env, "ALIAS_DESACTIVADO", `El alias ${s.system} «${raw}» estaba desactivado: no se reactiva ni se vuelve a crear.`);
      continue;
    }
    const alias = await tx.personAlias.create({ data: { personId: person.id, system: s.system, kind: s.kind, rawValue: raw, searchValue, validFrom: null, validTo: null, note: NOTE } });
    bump(env.report.created, "alias");
    await auditCreate(env, "PersonAlias", alias.id, `alias ${s.system} «${raw}» asignado a «${person.name}»`, alias, { personId: person.id });
  }
}

async function ensurePersonTerm(
  env: Env,
  person: { id: string; name: string },
  attribute: "LEVEL" | "TEAM" | "PMO_MEMBER" | "PMO_ROLE",
  v: { catalogItemId: string | null; flag: boolean | null; validFrom?: Date | null },
): Promise<"created" | "preserved"> {
  const { tx } = env;
  const existing = await tx.personTerm.findMany({ where: { personId: person.id, attribute } });
  if (existing.length > 0) {
    bump(env.report.preserved, `tramosPersona.${attribute}`);
    if (!existing.some((e) => e.catalogItemId === v.catalogItemId && e.flag === v.flag)) {
      note(env, "TRAMO_DISTINTO_EN_MAESTRO", `${attribute} de «${person.name}»: el maestro ya tiene otro valor; se conserva el del maestro.`);
    }
    return "preserved";
  }
  const term = await tx.personTerm.create({ data: { personId: person.id, attribute, catalogItemId: v.catalogItemId, flag: v.flag, validFrom: v.validFrom ?? null, validTo: null, note: NOTE } });
  bump(env.report.created, `tramosPersona.${attribute}`);
  await auditCreate(env, "PersonTerm", term.id, `${attribute} de «${person.name}» (fecha de inicio desconocida)`, term, { personId: person.id });
  return "created";
}

/** Devuelve la persona (creada o reutilizada) o null si no se puede cargar sin adivinar (conflicto de identidad o persona inactiva). */
export async function ensurePerson(env: Env, p: PersonPlan): Promise<{ id: string; name: string } | null> {
  const { tx } = env;
  const specs = aliasSpecs(p);
  const matched = await findPersonsByAliases(tx, specs);
  if (matched.length > 1) {
    note(env, "PERSONA_CONFLICTO", `Los alias de «${p.name}» pertenecen a personas distintas del maestro: no se carga ni se fusiona; revise las personas.`);
    return null;
  }
  let person: { id: string; name: string; isActive: boolean } | null = null;
  if (matched.length === 1) {
    person = await tx.person.findUniqueOrThrow({ where: { id: matched[0] }, select: { id: true, name: true, isActive: true } });
    bump(env.report.reused, "personas");
  } else {
    const byName = await tx.$queryRaw<{ id: string; name: string; isActive: boolean }[]>(Prisma.sql`SELECT id, name, "isActive" FROM "Person" WHERE lower("name") = lower(${p.name})`);
    if (byName[0]) {
      person = byName[0];
      bump(env.report.reused, "personas");
    } else {
      const created = await tx.person.create({ data: { name: p.name, note: NOTE } });
      bump(env.report.created, "personas");
      await auditCreate(env, "Person", created.id, `alta de la persona «${created.name}»`, created, { personId: created.id });
      person = { id: created.id, name: created.name, isActive: true };
    }
  }
  if (!person.isActive) {
    note(env, "PERSONA_INACTIVA", `La persona «${person.name}» está inactiva en el maestro: no se reactiva ni se le añaden datos.`);
    return null;
  }
  await ensurePersonAliases(env, person, specs);
  // Equipo y nivel: del catálogo real de la fuente; un valor ausente o dudoso no se inventa.
  if (p.team.value) {
    const id = await ensureCatalog(env, "TEAM", p.team.value);
    if (id) await ensurePersonTerm(env, person, "TEAM", { catalogItemId: id, flag: null });
  }
  if (p.level.value) {
    const id = await ensureCatalog(env, "LEVEL", p.level.value);
    if (id) await ensurePersonTerm(env, person, "LEVEL", { catalogItemId: id, flag: null });
  }
  if (p.pmo.value !== null) await ensurePersonTerm(env, person, "PMO_MEMBER", { catalogItemId: null, flag: p.pmo.value });
  return { id: person.id, name: person.name };
}

/** Personas activas con ese alias Wrike EXACTO (la unión con PERSONAL PMO solo se confirma por alias, nunca por parecido). */
export async function personsByWrikeName(db: Db, raw: string): Promise<{ id: string; name: string }[]> {
  const rows = await db.personAlias.findMany({
    where: { system: "WRIKE", kind: "NAME", searchValue: aliasSearchValue("NAME", raw), isActive: true, person: { isActive: true } },
    select: { person: { select: { id: true, name: true } } },
  });
  const seen = new Map(rows.map((r) => [r.person.id, r.person]));
  return [...seen.values()];
}

/** Rol PMO en la misma persona: solo si pertenece a PMO; el rol ausente sigue desconocido. */
export async function ensureRoleFor(env: Env, person: { id: string; name: string }, role: string): Promise<"created" | "preserved" | "no-pmo" | "inactive-role"> {
  const { tx } = env;
  const pmo = await tx.personTerm.findMany({ where: { personId: person.id, attribute: "PMO_MEMBER", flag: true }, orderBy: { validFrom: { sort: "asc", nulls: "first" } } });
  if (pmo.length === 0) {
    note(env, "ROL_SIN_PERTENENCIA_PMO", `«${person.name}» no figura como miembro de PMO: el rol ${role} solo es vigente si pertenece a PMO; no se asigna.`);
    return "no-pmo";
  }
  const catalogId = await ensureCatalog(env, "PMO_ROLE", role);
  if (!catalogId) return "inactive-role";
  // El rol nace con la misma vigencia inicial que la pertenencia a PMO que lo sustenta (desconocida si esa lo es).
  return ensurePersonTerm(env, person, "PMO_ROLE", { catalogItemId: catalogId, flag: null, validFrom: pmo[0].validFrom });
}

export async function applyRoles(env: Env, plan: Plan) {
  for (const r of plan.roles as RolePlan[]) {
    const found = await personsByWrikeName(env.tx, r.raw);
    if (found.length === 0) {
      bump(env.report.preserved, "roles.sinPersona");
      continue; // queda como revisión (posible nombre extendido) en la ficha del lote
    }
    if (found.length > 1) {
      note(env, "ROL_PERSONA_AMBIGUA", `El alias Wrike «${r.raw}» pertenece a varias personas: no se asigna el rol.`);
      continue;
    }
    if (!r.perfil.value) {
      note(env, "ROL_DESCONOCIDO", `«${r.raw}» enlaza con «${found[0].name}» pero el perfil no es ANA/DEV: el rol sigue desconocido.`);
      continue;
    }
    bump(env.report.reused, "roles.enlazados");
    await ensureRoleFor(env, found[0], r.perfil.value);
  }
}

/**
 * Fusión EXPLÍCITA (decisión del administrador) de una persona en otra: los alias activos pasan a la persona que se conserva, los tramos de un
 * atributo que esa persona aún no tiene se trasladan y la otra queda inactiva con su historia. Nunca se hace por semejanza.
 */
export async function mergePersons(env: Env, keepId: string, dropId: string): Promise<void> {
  const { tx } = env;
  if (keepId === dropId) return;
  const [keep, drop] = await Promise.all([tx.person.findUnique({ where: { id: keepId } }), tx.person.findUnique({ where: { id: dropId } })]);
  if (!keep || !drop || !keep.isActive || !drop.isActive) throw new DomainError("Las dos personas deben existir y estar activas para fusionarlas.");
  const aliases = await tx.personAlias.findMany({ where: { personId: dropId, isActive: true } });
  for (const a of aliases) {
    await tx.personAlias.update({ where: { id: a.id }, data: { personId: keepId, version: { increment: 1 } } });
    await recordAudit(tx, env.actor, { action: "UPDATE", entityType: "PersonAlias", entityId: a.id, personId: keepId, batchId: env.batchId, summary: `${P}alias ${a.system} «${a.rawValue}» pasa de «${drop.name}» a «${keep.name}» (fusión decidida)`, before: a, after: { ...a, personId: keepId } });
  }
  const keepAttrs = new Set((await tx.personTerm.findMany({ where: { personId: keepId }, select: { attribute: true } })).map((t) => t.attribute));
  const keepsPmo = (await tx.personTerm.count({ where: { personId: keepId, attribute: "PMO_MEMBER", flag: true } })) > 0;
  const terms = await tx.personTerm.findMany({ where: { personId: dropId } });
  for (const t of terms) {
    if (keepAttrs.has(t.attribute) || (t.attribute === "PMO_ROLE" && !keepsPmo)) continue;
    await tx.personTerm.update({ where: { id: t.id }, data: { personId: keepId, version: { increment: 1 } } });
    await recordAudit(tx, env.actor, { action: "UPDATE", entityType: "PersonTerm", entityId: t.id, personId: keepId, batchId: env.batchId, summary: `${P}${t.attribute} de «${drop.name}» pasa a «${keep.name}» (fusión decidida)`, before: t, after: { ...t, personId: keepId } });
  }
  const after = await tx.person.update({
    where: { id: dropId },
    data: { isActive: false, version: { increment: 1 }, note: `${drop.note ? `${drop.note} ` : ""}Fusionada en «${keep.name}» (precarga de maestros, decisión del administrador).` },
  });
  await recordAudit(tx, env.actor, { action: "DEACTIVATE", entityType: "Person", entityId: dropId, personId: dropId, batchId: env.batchId, summary: `${P}«${drop.name}» se fusiona en «${keep.name}» y queda inactiva`, before: drop, after });
}

// ---------------------------------------------------------------- Informe y activación

async function writeSummary(env: Env) {
  const batch = await env.tx.uploadBatch.findUniqueOrThrow({ where: { id: env.batchId }, select: { summary: true } });
  const prev = (batch.summary ?? {}) as Record<string, unknown>;
  await env.tx.uploadBatch.update({ where: { id: env.batchId }, data: { summary: { ...prev, precarga: env.report } as unknown as Prisma.InputJsonValue } });
}

/** Activa la precarga: aplica el plan del lote sobre los maestros dentro de la transacción del motor. Idempotente. */
export async function activatePrecarga(tx: Tx, ctx: ActivationContext): Promise<{ inserted: number; revised: number }> {
  const batch = await tx.uploadBatch.findUniqueOrThrow({ where: { id: ctx.batchId }, select: { confirmedById: true } });
  if (!batch.confirmedById) throw new Error("El lote no tiene un administrador que lo confirmara.");
  const actor = await authorize(tx, batch.confirmedById, "ADMIN");
  const plan = await loadPlan(tx, ctx.batchId);
  const env: Env = { tx, actor, batchId: ctx.batchId, report: newReport() };

  // 1. Grupos (46 denominaciones BC en el libro real) con su equivalencia BC.
  const groups = new Map<string, Ref>();
  for (const g of plan.groups) groups.set(g.key, await ensureGroup(env, g.name));

  // 2. Clientes (organización Zendesk), su equivalencia de ID y los datos de servicio informados sin ambigüedad.
  const clients = new Map<string, (Ref & { name: string; groupId: string | null }) | null>();
  for (const c of plan.clients) {
    const group = c.groupKey ? (groups.get(c.groupKey) ?? null) : null;
    const ref = await ensureClient(env, c, group);
    if (!ref) {
      clients.set(c.zdId, null);
      continue;
    }
    const row = await tx.client.findUniqueOrThrow({ where: { id: ref.id }, select: { name: true, groupId: true } });
    clients.set(c.zdId, { ...ref, name: row.name, groupId: row.groupId });
    if (!ref.active) continue;
    const scope = { type: "client" as const, id: ref.id, label: `Cliente «${row.name}»`, ids: { groupId: row.groupId, clientId: ref.id } };
    if (c.support.value) await ensureTerm(env, scope, "SUPPORT", c.support.value);
    if (c.hosting.value) await ensureTerm(env, scope, "HOSTING", c.hosting.value);
  }

  // 3. Alias Wrike: un único Grupo → equivalencia al Grupo (nunca al primer Cliente); varios Grupos → revisión sin asignar.
  for (const w of plan.wrike) {
    if (w.groupKeys.length > 1) {
      await ensureCandidates(env, "WRIKE", w.raw, w.groupKeys.map((k) => groups.get(k)).filter((g): g is Ref => !!g?.active).map((g) => g.id));
      continue;
    }
    if (w.groupKeys.length !== 1) continue;
    const g = groups.get(w.groupKeys[0]);
    if (!g?.active) continue;
    const name = plan.groups.find((x) => x.key === w.groupKeys[0])?.name ?? "";
    await ensureIdentity(env, { system: "WRIKE", kind: "PROJECT_NAME", raw: w.raw, target: { type: "group", id: g.id }, ids: { groupId: g.id }, label: `Grupo «${name}»` });
  }

  // 4. PAP: nombre inequívoco de un único Cliente → implantación (con alias y complejidad); de varios Clientes de un Grupo → Grupo; resto → revisión.
  for (const p of plan.pap) {
    if (p.outcome === "AMBIGUOUS") {
      await ensureCandidates(env, "PAP", p.raw, p.groupKeys.map((k) => groups.get(k)).filter((g): g is Ref => !!g?.active).map((g) => g.id));
      continue;
    }
    if (p.outcome === "IMPLEMENTATION") {
      const client = clients.get(p.clientIds[0]);
      if (!client?.active) {
        note(env, "PAP_SIN_CLIENTE", `El nombre PAP «${p.raw}» no se asigna: su Cliente no se ha cargado o está inactivo.`);
        continue;
      }
      const impl = await ensureImplementation(env, { id: client.id, name: client.name, groupId: client.groupId }, p.raw);
      if (!impl) continue;
      await ensureIdentity(env, {
        system: "PAP", kind: "PROJECT_NAME", raw: p.raw, target: { type: "implementation", id: impl.id }, ids: { groupId: client.groupId, clientId: client.id }, label: `implantación «${cleanText(p.raw)}» de «${client.name}»`,
      });
      if (p.complexity.value) {
        await ensureTerm(env, { type: "implementation", id: impl.id, label: `implantación «${cleanText(p.raw)}»`, ids: { groupId: client.groupId, clientId: client.id } }, "COMPLEXITY", p.complexity.value);
      }
    } else if (p.outcome === "GROUP") {
      const g = groups.get(p.groupKeys[0]);
      if (!g?.active) continue;
      const name = plan.groups.find((x) => x.key === p.groupKeys[0])?.name ?? "";
      await ensureIdentity(env, { system: "PAP", kind: "PROJECT_NAME", raw: p.raw, target: { type: "group", id: g.id }, ids: { groupId: g.id }, label: `Grupo «${name}»` });
    }
  }

  // 5. Personal: primero se consolidan los exactos (el plan ya los unió) y después los roles de PERSONAL PMO.
  for (const p of plan.persons) await ensurePerson(env, p);
  await applyRoles(env, plan);

  await writeSummary(env);
  const rows = await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM "UploadStagedRow" WHERE "batchId" = ${ctx.batchId} AND classification = 'VALID' AND NOT "duplicateInFile"`);
  return { inserted: Number(rows[0]?.n ?? 0), revised: 0 };
}
