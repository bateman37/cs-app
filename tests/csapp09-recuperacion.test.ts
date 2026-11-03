import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { parseQualityQuery } from "@/domain/quality-query";
import { revertUpload } from "@/server/uploads/batches";
import { computeQuality } from "@/server/quality/engine";
import { readSnapshot } from "@/server/analytics/snapshot";
import { readDataStamp } from "@/server/analytics/stamp";
import { batch, drain, freshEnvironment, removeUploadDir, useUploadDir } from "./cargas-helpers";
import { excelSerial, ticket, ticketsBuffer } from "./generators/zendesk";
import { addClient, addGroup, addOrgEquivalence, importZd, TICKETS } from "./zendesk-helpers";
import { setUsers } from "./economia-helpers";
import { declare } from "./calidad-helpers";

/**
 * CSAPP-09 §8 con el importador REAL (trabajador en proceso): revertir un lote de tickets retira su sustento de observación Y de cobertura; una revisión
 * sustentada por otro lote válido sigue disponible; Calidad no conserva el cero acreditado por el lote revertido y el sello de datos cambia. Las
 * recuperaciones con el trabajador compilado y SIGKILL están en `tests/cargas-trabajador.test.ts`, `tests/finanzas-trabajador.test.ts` y
 * `tests/csapp09-exportacion-trabajador.test.ts`.
 */
const NOW = new Date("2026-11-02T09:00:00Z");
let dir: string;
let admin: { id: string };
beforeAll(() => { dir = useUploadDir(); });
afterAll(() => removeUploadDir(dir));
beforeEach(async () => { ({ admin } = await freshEnvironment()); });

describe("reversión de un lote de tickets y su cobertura", () => {
  it("retira observación y cobertura del lote revertido, conserva la revisión sustentada por otro lote y el cero deja de estar acreditado", async () => {
    const g = await addGroup("Atlas");
    const c = await addClient({ name: "Atlas 1", groupId: g.id });
    await addOrgEquivalence(c.id, "9001");
    await setUsers(admin.id, { groupId: g.id }, 2026, Array(12).fill(100));
    // Lote A: un ticket de febrero (nada en octubre) con extracción 31/10; declaración de cobertura completa → el flujo de octubre es un CERO SUSTENTADO.
    const rows = [ticket({ ticket_id: "1001", organization_id: "9001", creada: { date: excelSerial("2026-02-05") }, status: "solved", tags: "[]", causa: "incidente_uso_indebido" })];
    const a = await importZd(admin.id, TICKETS, await ticketsBuffer(rows), { declared: { extraccion: "2026-10-31" } });
    await declare(admin.id, a.id, { statusScope: "ALL_STATUSES", from: "2026-01-01", to: "2026-10-31" });
    // Lote B con el MISMO contenido del ticket (misma revisión) y otra extracción: sustenta la revisión por su cuenta.
    const b = await importZd(admin.id, TICKETS, await ticketsBuffer(rows), { declared: { extraccion: "2026-11-01" } });
    const Q = parseQualityQuery({ fecha: "2026-10-31", modo: "FULL_MONTH", sel: g.id }, NOW).query;
    const flow = async () => (await readSnapshot(admin.id, (tx) => computeQuality(tx, Q, { now: NOW }))).rows.find((r) => r.id === g.id)!.evaluation.indicators.N3_ESCALATIONS;
    expect(await flow()).toMatchObject({ value: "0" }); // cero sustentado por la cobertura del lote A
    const stampBefore = (await readSnapshot(admin.id, (tx) => readDataStamp(tx))).stamp;

    await revertUpload(admin.id, a.id);
    await drain();
    expect((await batch(a.id)).status).toBe("REVERTED");
    // La observación de A desaparece; la de B y la revisión compartida permanecen; el ticket sigue vigente.
    expect(await prisma.zdTicketObservation.count({ where: { batchId: a.id } })).toBe(0);
    expect(await prisma.zdTicketObservation.count({ where: { batchId: b.id } })).toBe(1);
    expect(await prisma.zdTicketRevision.count()).toBe(1);
    expect(await prisma.zdTicket.count()).toBe(1);
    // La cobertura declarada sobre el lote revertido ya no cuenta: el cero NO se conserva como acreditado (sin valor, con motivo).
    const after = await flow();
    expect(after.value).toBeNull();
    expect(after.reason).toMatch(/no sustentado|sin cobertura/i);
    expect((await readSnapshot(admin.id, (tx) => readDataStamp(tx))).stamp).not.toBe(stampBefore); // el sello detecta la reversión

    // Revertir también B: el ticket queda sin sustento y desaparece; nada ajeno se borra.
    await revertUpload(admin.id, b.id);
    await drain();
    expect(await prisma.zdTicket.count()).toBe(0);
    expect(await prisma.client.count()).toBe(1);
  });
});
