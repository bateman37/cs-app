import { prisma } from "@/lib/db";
import { confirmUpload } from "@/server/uploads/batches";
import { decideTimeCorrection } from "@/server/zendesk/corrections";
import { batch, drain, uploadText } from "./cargas-helpers";

export const TICKETS = "zendesk-tickets";
export const TIEMPO = "zendesk-tiempo";

export async function uploadZd(
  actorId: string,
  profileId: string,
  file: Buffer,
  opts: { declared?: object; metadata?: object; name?: string } = {},
) {
  return uploadText(actorId, file, { profileId, name: opts.name ?? "export.xlsx", declared: opts.declared, metadata: opts.metadata });
}

/** Sube, prepara con el trabajador en proceso y devuelve el lote preparado. */
export async function prepareZd(actorId: string, profileId: string, file: Buffer, opts: { declared?: object; metadata?: object } = {}) {
  const { id } = await uploadZd(actorId, profileId, file, opts);
  await drain();
  return batch(id);
}

/** Sube, prepara, confirma y activa. Falla si el lote no termina COMPLETED. */
export async function importZd(actorId: string, profileId: string, file: Buffer, opts: { declared?: object; metadata?: object } = {}) {
  const prepared = await prepareZd(actorId, profileId, file, opts);
  if (prepared.status !== "READY") throw new Error(`Lote en ${prepared.status}: ${prepared.statusDetail ?? ""}`);
  await confirmUpload(actorId, prepared.id);
  await drain();
  const done = await batch(prepared.id);
  if (done.status !== "COMPLETED") throw new Error(`Activación en ${done.status}`);
  return done;
}

export async function ticketCurrent(ticketId: string) {
  const rows = await prisma.$queryRaw<
    { status: string; causa: string | null; org: string | null; rev: number; tags: string[]; observedOn: string; revisions: bigint; observations: bigint }[]
  >`SELECT r.status, r."causaRaiz" AS causa, r."organizationId" AS org, r."revisionNo" AS rev, r.tags,
      to_char(o."observedOn", 'YYYY-MM-DD') AS "observedOn",
      (SELECT count(*) FROM "ZdTicketRevision" x WHERE x."ticketId" = t."ticketId") AS revisions,
      (SELECT count(*) FROM "ZdTicketObservation" x WHERE x."ticketId" = t."ticketId") AS observations
    FROM "ZdTicket" t JOIN "ZdTicketRevision" r ON r.id = t."currentRevisionId" JOIN "ZdTicketObservation" o ON o.id = t."currentObservationId"
    WHERE t."ticketId" = ${ticketId}`;
  return rows[0] ? { ...rows[0], revisions: Number(rows[0].revisions), observations: Number(rows[0].observations) } : null;
}

export async function entries(where = "true") {
  return prisma.$queryRawUnsafe<
    { id: string; ticketId: string; userId: string | null; workDate: string; minutes: string; bucket: string; flags: string[]; personId: string | null; clientId: string | null; revision: number; sourceId: string | null }[]
  >(`SELECT id, "ticketId", "userId", to_char("workDate",'YYYY-MM-DD') AS "workDate", minutes::text AS minutes, "drvBucket" AS bucket, "drvFlags" AS flags,
        "drvPersonId" AS "personId", "drvClientId" AS "clientId", revision, "sourceId"
     FROM "ZdTimeEntry" WHERE ${where} ORDER BY "workDate", "ticketId", "userId", "hourText", "sourceId"`);
}

export async function sumHours(where = "true"): Promise<number> {
  const r = await prisma.$queryRawUnsafe<{ h: string | null }[]>(`SELECT (sum(minutes) / 60)::text AS h FROM "ZdTimeEntry" WHERE ${where}`);
  return Number(r[0]?.h ?? 0);
}

export async function count(table: string, where = "true"): Promise<number> {
  const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}" WHERE ${where}`);
  return Number(r[0].n);
}

// ---------------------------------------------------------------- Maestros sintéticos (inserción directa; las restricciones de la base aplican)

const d = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00Z`) : null);

export async function addGroup(name: string) {
  return prisma.clientGroup.create({ data: { name } });
}

export async function addClient(opts: { name: string; orgId?: string; internal?: boolean; groupId?: string | null; from?: string; to?: string }) {
  const client = await prisma.client.create({ data: { name: opts.name, isInternal: opts.internal ?? false, groupId: opts.groupId ?? null } });
  if (opts.orgId) {
    await prisma.externalIdentity.create({
      data: { system: "ZENDESK", kind: "ORG_ID", rawValue: opts.orgId, searchValue: opts.orgId, clientId: client.id, validFrom: d(opts.from), validTo: d(opts.to) },
    });
  }
  return client;
}

export async function addOrgEquivalence(clientId: string, orgId: string) {
  return prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: orgId, searchValue: orgId, clientId } });
}

export async function addHosting(clientId: string, value: "CLOUD" | "OP", from: string | null, to: string | null) {
  return prisma.serviceTerm.create({ data: { attribute: "HOSTING", value, clientId, validFrom: d(from), validTo: d(to) } });
}

export async function addPerson(opts: {
  name: string;
  zdId?: string;
  zdName?: string;
  /** Tramos de pertenencia a PMO: [desde, hasta, pertenece]. Sin tramos = sin informar. */
  pmo?: [string | null, string | null, boolean][];
}) {
  const person = await prisma.person.create({ data: { name: opts.name } });
  if (opts.zdId) {
    await prisma.personAlias.create({ data: { personId: person.id, system: "ZENDESK", kind: "ID", rawValue: opts.zdId, searchValue: opts.zdId } });
  }
  if (opts.zdName) {
    await prisma.personAlias.create({
      data: { personId: person.id, system: "ZENDESK", kind: "NAME", rawValue: opts.zdName, searchValue: opts.zdName.toLowerCase() },
    });
  }
  for (const [from, to, flag] of opts.pmo ?? []) {
    await prisma.personTerm.create({ data: { personId: person.id, attribute: "PMO_MEMBER", flag, validFrom: d(from), validTo: d(to) } });
  }
  return person;
}

export async function addPersonAlias(personId: string, kind: "ID" | "NAME", raw: string) {
  return prisma.personAlias.create({
    data: { personId, system: "ZENDESK", kind, rawValue: raw, searchValue: kind === "ID" ? raw : raw.toLowerCase() },
  });
}

/** Decisión «corrige este registro» con la revisión vista y la confirmación expresa de la sustitución concreta. */
export async function decideCorrection(actorId: string, batchId: string, fingerprint: string, targetEntryId: string, extra: Record<string, unknown> = {}) {
  const e = await prisma.zdTimeEntry.findUniqueOrThrow({ where: { id: targetEntryId } });
  return decideTimeCorrection(actorId, batchId, { fingerprint, decision: "CORRECTION", targetEntryId, expectedEntryRevision: e.revision, confirmReplace: true, ...extra });
}
