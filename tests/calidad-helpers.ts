import { prisma } from "@/lib/db";
import { randomUUID } from "node:crypto";
import { tkey } from "./economia-helpers";
import { declareCoverage } from "@/server/quality/coverage";

const d = (v: string) => new Date(`${v}T00:00:00Z`);

export async function batchOf(adminId: string, profileId: string, extract: string | null = null, status: "COMPLETED" | "REVERTED" = "COMPLETED") {
  return prisma.uploadBatch.create({ data: { profileId, profileVersion: 1, status, originalName: `${profileId}.xlsx`, storageId: `s-${randomUUID()}`, fileFormat: "xlsx", createdById: adminId, declaredExtractionDate: extract ? d(extract) : null } });
}

/** Ticket con revisión y observación en un lote (la observación es la que sustenta la fotografía). */
export async function seedTicket(batchId: string, o: { id: string; org?: string | null; type?: string; status?: string; created: string; cause?: string | null; entorno?: string | null; destinations?: string[]; observedOn?: string; current?: boolean; statusKnown?: boolean }) {
  const id = tkey(o.id);
  const existing = await prisma.zdTicket.findUnique({ where: { ticketId: id } });
  if (!existing) await prisma.zdTicket.create({ data: { ticketId: id, firstBatchId: batchId } });
  const n = await prisma.zdTicketRevision.count({ where: { ticketId: id } });
  const rev = await prisma.zdTicketRevision.create({
    data: { ticketId: id, fingerprint: `fp-${id}-${n}-${o.status ?? "open"}`, revisionNo: n + 1, organizationId: o.org ?? null, causaRaiz: o.cause ?? null, entorno: o.entorno ?? null, destinations: o.destinations ?? [], tags: [], createdOn: d(o.created), ticketType: o.type ?? "incident", status: o.status ?? "open", typeKnown: true, statusKnown: o.statusKnown ?? true, batchId },
  });
  if (o.observedOn) await prisma.zdTicketObservation.create({ data: { ticketId: id, batchId, revisionId: rev.id, observedOn: d(o.observedOn), observedKind: "DECLARED", receivedAt: new Date() } });
  if (o.current !== false) await prisma.zdTicket.update({ where: { ticketId: id }, data: { currentRevisionId: rev.id } });
  return { ticketId: id, revId: rev.id };
}

export async function declare(adminId: string, batchId: string, o: Partial<{ population: string; statusScope: string; from: string; to: string; extractedOn: string; expectedVersion: number }> = {}, profileHint?: string) {
  const prof = profileHint ?? (await prisma.uploadBatch.findUniqueOrThrow({ where: { id: batchId } })).profileId;
  return declareCoverage(adminId, {
    batchId, population: o.population ?? "ALL_CLIENTS", statusScope: o.statusScope ?? (prof === "zendesk-tickets" ? "ALL_STATUSES" : "NOT_APPLICABLE"), coveredFrom: o.from ?? "2026-01-01", coveredTo: o.to ?? "2026-10-31",
    extractedOn: o.extractedOn ?? "", reason: "Declaración de prueba", expectedVersion: o.expectedVersion ?? 0,
  }, { now: new Date("2026-11-02T09:00:00Z") });
}

export async function seedPap(batchId: string, o: { id: string; groupId: string; clientId: string; date: string | null; state: "CORRECTIVE" | "NON_CORRECTIVE" | "UNKNOWN"; causes?: { category: string; origin?: string }[]; result?: string; listKey?: string }) {
  const it = await prisma.papItem.create({ data: { listKey: o.listKey ?? "L1", papId: o.id, firstBatchId: batchId, drvScope: "CLIENT", drvGroupId: o.groupId, drvClientId: o.clientId } });
  const rev = await prisma.papRevision.create({ data: { itemId: it.id, fingerprint: `pf-${it.id}`, revisionNo: 1, title: `PAP ${o.id}`, result: o.result ?? "OK", productionDate: o.date ? d(o.date) : null, correctiveState: o.state, data: {}, batchId } });
  await prisma.papItem.update({ where: { id: it.id }, data: { currentRevisionId: rev.id } });
  let i = 0;
  for (const c of o.causes ?? []) await prisma.papCause.create({ data: { revisionId: rev.id, rawToken: `t${i}`, normalized: `n${i++}`, category: c.category, origin: c.origin ?? null } });
}

export async function seedBugLink(batchId: string, o: { bugId: string; product?: string; ticket: string; isBug?: boolean; manual?: "CONFIRMED" | "REJECTED" | null; state?: string; evidence?: boolean; clientId?: string; groupId?: string }) {
  const wi = await prisma.workItem.create({ data: { product: o.product ?? "VFS", scopeKey: "S", workItemId: o.bugId, firstBatchId: batchId } });
  const rev = await prisma.workItemRevision.create({ data: { workItemId: wi.id, fingerprint: `wf-${wi.id}`, revisionNo: 1, itemType: o.isBug === false ? "Task" : "Bug_", isBug: o.isBug ?? true, title: `Bug ${o.bugId}`, state: "Active", stateCategory: "ACTIVE", stateKnown: true, batchId } });
  await prisma.workItem.update({ where: { id: wi.id }, data: { currentRevisionId: rev.id } });
  await prisma.workItemObservation.create({ data: { workItemId: wi.id, batchId, revisionId: rev.id, observedOn: d("2026-10-01"), observedKind: "DECLARED", receivedAt: new Date() } });
  const link = await prisma.workItemLink.create({ data: { workItemId: wi.id, ticketId: tkey(o.ticket), manualState: o.manual ?? null, drvState: o.state ?? "RESOLVED_EXTERNAL", drvTicketType: "problem", drvClientId: o.clientId ?? null, drvGroupId: o.groupId ?? null } });
  if (o.evidence !== false) await prisma.workItemLinkEvidence.create({ data: { linkId: link.id, batchId, source: "ZENDESK_TICKET_ID", rawRef: tkey(o.ticket), observedOn: d("2026-10-01") } });
  return link;
}

/** Declara cobertura completa (todos los clientes y estados) de las cuatro fuentes para un rango: cuatro lotes completados sintéticos y sus declaraciones. */
export async function declareAllSources(adminId: string, from = "2020-01-01", to = "2026-12-31") {
  for (const profile of ["zendesk-tickets", "zendesk-tiempo", "wrike", "pap"]) {
    const b = await batchOf(adminId, profile, profile === "zendesk-tickets" ? to : null);
    await declare(adminId, b.id, { from, to: to > "2026-11-02" ? "2026-11-02" : to }, profile);
  }
}
