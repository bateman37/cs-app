import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { uncalibratedQualityConfig as defaultQualityConfig } from "@/domain/quality-config";
import { readSnapshot } from "@/server/analytics/snapshot";
import { readDataStamp } from "@/server/analytics/stamp";
import { activateDraft, saveDraft } from "@/server/pulse/config";
import { resetDatabase, makeUsers, useUncalibratedQuality } from "./helpers";
import { addClient, addGroup, addZd, setUsers, serviceAssignment } from "./economia-helpers";
import { batchOf, declare, seedBugLink, seedTicket } from "./calidad-helpers";

/**
 * CSAPP-09 §7: el sello es un DETECTOR de cambios (no certificado ni archivo). Cada mutación que afecta a un resultado debe cambiarlo;
 * una lectura repetida sin cambios devuelve el mismo. Las mutaciones reproducen lo que hacen las rutas reales (observación nueva sin cambio de
 * contenido, reversión, edición manual de vínculo, vigencia, usuarios, servicio, feedback, cobertura, configuración).
 */
let admin: { id: string };
beforeEach(async () => {
  await resetDatabase();
  ({ admin } = await makeUsers());
  await useUncalibratedQuality(admin.id);
});
const stamp = async () => readSnapshot(admin.id, (tx) => readDataStamp(tx));

describe("auditoría del sello de datos", () => {
  it("una lectura repetida sin cambios es estable y cada mutación relevante lo cambia", async () => {
    const g = await addGroup("Atlas");
    const c = await addClient("Atlas 1", g.id);
    await prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: "701", searchValue: "701", clientId: c.id } });
    await setUsers(admin.id, { groupId: g.id }, 2026, Array(12).fill(100));
    const term = await prisma.serviceTerm.create({ data: { attribute: "HOSTING", value: "OP", groupId: g.id } });
    const tb = await batchOf(admin.id, "zendesk-tickets", "2026-10-31");
    const t = await seedTicket(tb.id, { id: "S1", org: "701", type: "problem", created: "2026-10-05", observedOn: "2026-10-20" });
    const link = await seedBugLink(tb.id, { bugId: "9", ticket: "S1", clientId: c.id, groupId: g.id });
    const bugBatch = await batchOf(admin.id, "bugs-vfs");
    const zd = await batchOf(admin.id, "zendesk-tiempo");
    await addZd({ batchId: zd.id, date: "2026-10-05", minutes: 60, groupId: g.id, clientId: c.id });
    const base = await stamp();
    expect((await stamp()).stamp).toBe(base.stamp);

    const mutations: [string, () => Promise<unknown>][] = [
      // Tickets
      ["observación de ticket nueva SIN cambio de contenido (misma revisión)", () => prisma.zdTicketObservation.create({ data: { ticketId: t.ticketId, batchId: bugBatch.id, revisionId: t.revId, observedOn: new Date("2026-10-31T00:00:00Z"), observedKind: "DECLARED", receivedAt: new Date() } })],
      ["puntero de observación vigente del ticket", async () => {
        const o = await prisma.zdTicketObservation.findFirstOrThrow({ where: { ticketId: t.ticketId }, orderBy: { id: "desc" } });
        await prisma.zdTicket.update({ where: { ticketId: t.ticketId }, data: { currentObservationId: o.id } });
      }],
      // Work Items
      ["observación de Work Item nueva SIN cambio de contenido", async () => {
        const w = await prisma.workItem.findFirstOrThrow();
        await prisma.workItemObservation.create({ data: { workItemId: w.id, batchId: bugBatch.id, revisionId: w.currentRevisionId as bigint, observedOn: new Date("2026-10-30T00:00:00Z"), observedKind: "DECLARED", receivedAt: new Date() } });
      }],
      ["puntero de observación vigente del Work Item", async () => {
        const o = await prisma.workItemObservation.findFirstOrThrow({ orderBy: { id: "desc" } });
        await prisma.workItem.updateMany({ data: { currentObservationId: o.id } });
      }],
      ["evidencia nueva de un vínculo (otro lote lo sustenta)", () => prisma.workItemLinkEvidence.create({ data: { linkId: link.id, batchId: bugBatch.id, source: "CLIENTS_URL", rawRef: "https://x/1", observedOn: new Date("2026-10-31T00:00:00Z") } })],
      ["retirada de la evidencia de un vínculo (reversión de lote)", () => prisma.workItemLinkEvidence.deleteMany({ where: { batchId: bugBatch.id } })],
      ["edición manual del vínculo", () => prisma.workItemLink.update({ where: { id: link.id }, data: { manualState: "REJECTED", version: { increment: 1 } } })],
      ["estado derivado del vínculo tras un reproceso", () => prisma.workItemLink.update({ where: { id: link.id }, data: { drvState: "NO_CLIENT", drvAt: new Date(Date.now() + 5000) } })],
      // Maestros, usuarios, servicios
      ["vigencia de un servicio", () => prisma.serviceTerm.update({ where: { id: term.id }, data: { validTo: new Date("2026-06-01T00:00:00Z"), version: { increment: 1 } } })],
      ["usuarios de un mes", () => prisma.userMatrixMonth.updateMany({ where: { month: 3 }, data: { value: 101, revision: { increment: 1 } } })],
      ["asignación de servicio", () => serviceAssignment({ matchKind: "ENTORNO", matchValue: "Soporte", service: "SOPORTE" })],
      // Tiempos
      ["tiempo (derivado recalculado)", () => prisma.zdTimeEntry.updateMany({ data: { drvVersion: { increment: 1 }, minutes: 61 as never } })],
      // Health y cobertura
      ["feedback de Health", () => prisma.healthFeedback.create({ data: { groupId: g.id, year: 2026, month: 10, state: "POSITIVE", updatedById: admin.id } })],
      ["declaración de cobertura", () => declare(admin.id, tb.id, { statusScope: "ALL_STATUSES" })],
      // Lotes (reversión)
      ["reversión de un lote", () => prisma.uploadBatch.update({ where: { id: tb.id }, data: { status: "REVERTED" } })],
      // Configuración
      ["activación de configuración de Calidad", async () => {
        const d = await saveDraft(admin.id, "QUALITY", defaultQualityConfig(), { expectedVersion: null });
        await activateDraft(admin.id, "QUALITY", { expectedRevisionNo: 1, expectedDraftVersion: d.version, reason: "auditoría del sello" });
      }],
    ];
    let prev = base.stamp;
    const failures: string[] = [];
    for (const [label, mutate] of mutations) {
      await mutate();
      const now = (await stamp()).stamp;
      if (now === prev) failures.push(label);
      prev = now;
    }
    expect(failures, `mutaciones que NO cambian el sello:\n${failures.join("\n")}`).toEqual([]);
  });
});
