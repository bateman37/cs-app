import { prisma } from "@/lib/db";
import { randomUUID } from "node:crypto";
import type { FinanceCategory } from "@/domain/finance";

const d = (v: string) => new Date(`${v}T00:00:00Z`);

export async function fakeBatch(adminId: string, profileId = "zendesk-tiempo") {
  return prisma.uploadBatch.create({
    data: { profileId, profileVersion: 1, status: "COMPLETED", originalName: "sintetico.xlsx", storageId: `s-${randomUUID()}`, fileFormat: "xlsx", createdById: adminId },
  });
}

export async function addGroup(name: string) {
  return prisma.clientGroup.create({ data: { name } });
}
export async function addClient(name: string, groupId: string | null, internal = false) {
  return prisma.client.create({ data: { name, groupId, isInternal: internal } });
}

/** Activa un conjunto financiero sintético directamente (lote COMPLETED + FinanceBatch/FinanceRow + puntero); no usa el importador. */
export async function seedFinance(adminId: string, cat: FinanceCategory, year: number, rows: { groupId: string | null; income: string; label?: string }[], opts: { origin?: "UPLOAD" | "HISTORICAL" } = {}) {
  const b = await fakeBatch(adminId, cat === "SOPORTE" ? "facturacion-soporte" : cat === "ADMIN_DELEGADA" ? "facturacion-admin-delegada" : "facturacion-otros");
  await prisma.financeBatch.create({ data: { batchId: b.id, year, category: cat, origin: opts.origin ?? "UPLOAD", tolerance: "0.01", derivedStamp: "x" } });
  let i = 0;
  for (const r of rows) {
    i++;
    await prisma.financeRow.create({
      data: { batchId: b.id, position: i, sourceRow: i + 1, groupLabel: r.label ?? `fila ${i}`, sourceKey: (r.label ?? `fila ${i}`).toLowerCase(), fingerprint: `${b.id}-${i}`, income: r.income, groupId: r.groupId, resolution: r.groupId ? "RESOLVED" : "UNRESOLVED" },
    });
  }
  await prisma.financeScope.upsert({ where: { year_category: { year, category: cat } }, create: { year, category: cat, activeBatchId: b.id, version: 2 }, update: { activeBatchId: b.id, version: { increment: 1 } } });
  return b;
}

const ticketIds = new Map<string, string>();
/** Los ID de ticket son numéricos (restricción de la base): las pruebas usan etiquetas legibles que aquí se convierten. */
export const tkey = (label: string): string => {
  if (!ticketIds.has(label)) ticketIds.set(label, String(910000 + ticketIds.size));
  return ticketIds.get(label) as string;
};

export type Tk = { ticketId: string; entorno?: string | null; adminDelegada?: boolean | null };
export async function addTicket(batchId: string, t: Tk) {
  const id = tkey(t.ticketId);
  await prisma.zdTicket.create({ data: { ticketId: id, firstBatchId: batchId } });
  const rev = await prisma.zdTicketRevision.create({
    data: { ticketId: id, fingerprint: `fp-${id}`, revisionNo: 1, entorno: t.entorno ?? null, createdOn: d("2026-01-01"), ticketType: "incident", status: "open", typeKnown: true, statusKnown: true, adminDelegada: t.adminDelegada ?? null, batchId },
  });
  await prisma.zdTicket.update({ where: { ticketId: id }, data: { currentRevisionId: rev.id } });
}

export type Zd = { batchId: string; date: string; minutes: number | string; groupId?: string | null; clientId?: string | null; ticketId?: string; eligibility?: string; bucket?: string; pmo?: boolean | null; teamId?: string | null };
let seq = 0;
export async function addZd(z: Zd) {
  seq++;
  await prisma.zdTimeEntry.create({
    data: {
      originFingerprint: `zd-${seq}-${randomUUID()}`, firstBatchId: z.batchId, ticketId: z.ticketId ? tkey(z.ticketId) : String(920000 + seq), workDate: d(z.date), loggedHours: 0, loggedMinutes: z.minutes as never,
      minutes: z.minutes as never, fingerprint: `f${seq}`, drvGroupId: z.groupId ?? null, drvClientId: z.clientId ?? null, drvEligibility: z.eligibility ?? "ELIGIBLE", drvBucket: z.bucket ?? "ATTRIBUTABLE",
      drvPmo: z.pmo ?? null, drvTeamId: z.teamId ?? null,
    },
  });
}

export type Wr = { batchId: string; date: string; minutes: number | string; groupId?: string | null; clientId?: string | null; implId?: string | null; project?: string | null; ticketId?: string | null; eligibility?: string; bucket?: string; conflict?: boolean; pmo?: boolean | null };
export async function addWrike(w: Wr) {
  seq++;
  await prisma.wrikeTimeEntry.create({
    data: {
      originFingerprint: `wr-${seq}-${randomUUID()}`, firstBatchId: w.batchId, taskName: `tarea ${seq}`, projectName: w.project ?? null, explicitState: "NONE", workDate: d(w.date), hours: (Number(w.minutes) / 60).toString(), minutes: w.minutes as never,
      fingerprint: `wf${seq}`, drvGroupId: w.groupId ?? null, drvClientId: w.clientId ?? null, drvImplementationId: w.implId ?? null, drvTicketId: w.ticketId ? tkey(w.ticketId) : null,
      drvEligibility: w.eligibility ?? "ELIGIBLE", drvBucket: w.bucket ?? "GROUP_ONLY", drvConflict: w.conflict ?? false, drvPmo: w.pmo ?? null,
    },
  });
}

export async function setUsers(adminId: string, scope: { groupId?: string; clientId?: string; implementationId?: string }, year: number, values: (number | null)[]) {
  const m = await prisma.userMatrix.create({ data: { ...scope, year } });
  for (let i = 0; i < 12; i++) {
    const v = values[i];
    if (v === null || v === undefined) continue;
    await prisma.userMatrixMonth.create({ data: { matrixId: m.id, month: i + 1, value: v, kind: "ADJUSTED", source: "sintético", updatedById: adminId } });
  }
}

export const serviceAssignment = (data: { matchKind: "ENTORNO" | "WRIKE_PROJECT"; matchValue: string; service: FinanceCategory; validFrom?: string; validTo?: string }) =>
  prisma.serviceAssignment.create({ data: { matchKind: data.matchKind, matchValue: data.matchValue, searchValue: data.matchValue.trim().toLowerCase(), service: data.service, validFrom: data.validFrom ? d(data.validFrom) : null, validTo: data.validTo ? d(data.validTo) : null } });
