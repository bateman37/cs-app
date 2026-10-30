import { prisma } from "@/lib/db";
import { confirmUpload } from "@/server/uploads/batches";
import { batch, drain, uploadText } from "./cargas-helpers";

export const WRIKE = "wrike";
export const PAP = "pap";
export const BUGS_VFS = "bugs-vfs";
export const BUGS_VSW = "bugs-vsw";

type Opts = { declared?: object; metadata?: object; name?: string };
const nameOf = (profileId: string) => (profileId === PAP || profileId.startsWith("zendesk") ? "carga.xlsx" : "export.csv");

export async function prepare(actorId: string, profileId: string, file: Buffer, opts: Opts = {}) {
  const { id } = await uploadText(actorId, file, { profileId, name: opts.name ?? nameOf(profileId), declared: opts.declared, metadata: opts.metadata });
  await drain();
  return batch(id);
}

export async function importFile(actorId: string, profileId: string, file: Buffer, opts: Opts = {}) {
  const prepared = await prepare(actorId, profileId, file, opts);
  if (prepared.status !== "READY") throw new Error(`Lote en ${prepared.status}: ${prepared.statusDetail ?? ""}`);
  await confirmUpload(actorId, prepared.id);
  await drain();
  const done = await batch(prepared.id);
  if (done.status !== "COMPLETED") throw new Error(`Activación en ${done.status}`);
  return done;
}

export const importWrike = (a: string, f: Buffer, o: Opts = {}) => importFile(a, WRIKE, f, o);
export const BUG_META = { vista: "AMPLIA" };

export type WrikeE = {
  id: string; taskName: string; workDate: string; minutes: string; revision: number; ticketId: string | null; ticketState: string; method: string;
  personId: string | null; clientId: string | null; groupId: string | null; implId: string | null; bucket: string; eligibility: string; flags: string[]; conflict: boolean; cause: string; roleId: string | null; scope: string | null;
};
export async function wrikeEntries(where = "true") {
  return prisma.$queryRawUnsafe<WrikeE[]>(`SELECT id, "taskName", to_char("workDate",'YYYY-MM-DD') AS "workDate", trim_scale(minutes)::text AS minutes, revision,
      "drvTicketId" AS "ticketId", "drvTicketState" AS "ticketState", "drvTicketMethod" AS method, "drvPersonId" AS "personId", "drvClientId" AS "clientId",
      "drvGroupId" AS "groupId", "drvImplementationId" AS "implId", "drvBucket" AS bucket, "drvEligibility" AS eligibility, "drvFlags" AS flags,
      "drvConflict" AS conflict, "drvCause" AS cause, "drvRoleId" AS "roleId", "drvScopeMethod" AS scope
    FROM "WrikeTimeEntry" WHERE ${where} ORDER BY "workDate", "taskName"`);
}

export async function eligibleHours(where = "true"): Promise<number> {
  const r = await prisma.$queryRawUnsafe<{ h: string | null }[]>(`SELECT (sum(minutes) / 60)::text AS h FROM "TimeActivity" WHERE "isEligible" AND ${where}`);
  return Number(r[0]?.h ?? 0);
}

export async function addWrikePerson(opts: { name: string; alias: string; pmo?: [string | null, string | null, boolean][]; role?: { name: "ANA" | "DEV"; from?: string | null; to?: string | null }[] }) {
  const person = await prisma.person.create({ data: { name: opts.name } });
  await prisma.personAlias.create({ data: { personId: person.id, system: "WRIKE", kind: "NAME", rawValue: opts.alias, searchValue: opts.alias.toLowerCase() } });
  const d = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00Z`) : null);
  for (const [from, to, flag] of opts.pmo ?? []) await prisma.personTerm.create({ data: { personId: person.id, attribute: "PMO_MEMBER", flag, validFrom: d(from), validTo: d(to) } });
  for (const r of opts.role ?? []) {
    const item = (await prisma.staffCatalogItem.findFirst({ where: { kind: "PMO_ROLE", name: r.name } })) ?? (await prisma.staffCatalogItem.create({ data: { kind: "PMO_ROLE", name: r.name } }));
    await prisma.personTerm.create({ data: { personId: person.id, attribute: "PMO_ROLE", catalogItemId: item.id, validFrom: d(r.from), validTo: d(r.to) } });
  }
  return person;
}

/**
 * Equivalencia de proyecto Wrike/PAP. Desde CSAPP-05 un proyecto puede identificar directamente un Grupo Cliente
 * (equivalencia WRIKE/PAP con destino de grupo); la clave BC ya no atribuye proyectos.
 */
export async function addProjectEquivalence(system: "WRIKE" | "PAP", name: string, target: { groupId?: string; clientId?: string; implementationId?: string }, kind: "PROJECT_NAME" | "PROJECT_ID" = "PROJECT_NAME") {
  return prisma.externalIdentity.create({
    data: {
      system, kind, rawValue: name, searchValue: kind === "PROJECT_NAME" ? name.toLowerCase() : name,
      groupId: target.groupId ?? null, clientId: target.clientId ?? null, implementationId: target.implementationId ?? null,
    },
  });
}
