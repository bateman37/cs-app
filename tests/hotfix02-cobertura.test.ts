import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { todayMadrid } from "@/domain/vigencia";
import { BROAD_EXPORT_CONTRACT, CONTRACT_COVERAGE_FROM, chooseSnapshot, coverageOf } from "@/domain/quality-coverage";
import { declareCoverage, loadDeclarations, loadTicketBatches } from "@/server/quality/coverage";
import { freshEnvironment, removeUploadDir, useUploadDir } from "./cargas-helpers";
import { importZd, TICKETS, TIEMPO } from "./zendesk-helpers";
import { ticketsBuffer, timesBuffer, ticket, timeRow, excelSerial } from "./generators/zendesk";
import { fakeBatch } from "./economia-helpers";

/**
 * HOTFIX-02 §10: la cobertura de Calidad se conecta con el contrato de carga amplia de HOTFIX-01. Sin declaraciones manuales por lote, las magnitudes y los
 * ceros respaldados por el contrato se ven; la procedencia es trazable; el inicio NO se infiere de MIN(fecha); una declaración explícita más precisa prevalece;
 * lo heredado sin contrato sigue desconocido; y un stock recibido hoy nunca se presenta como fotografía de un periodo anterior.
 */
let dir: string;
let admin: { id: string };
beforeAll(() => { dir = useUploadDir(); });
afterAll(() => removeUploadDir(dir));
beforeEach(async () => { ({ admin } = await freshEnvironment()); });

const today = () => todayMadrid(new Date());

describe("cobertura por contrato de carga amplia", () => {
  it("un lote completado sin declaración manual hereda el contrato (todos los clientes, todos los estados) con procedencia trazable; el inicio no sale de MIN(fecha)", async () => {
    // La primera fecha observada (2024-03-05) NO delimita el inicio de la cobertura: el contrato lo da la fuente completa.
    const b = await importZd(admin.id, TICKETS, await ticketsBuffer([ticket({ ticket_id: "7001", creada: { date: excelSerial("2024-03-05") } })]));
    const decls = await loadDeclarations(prisma);
    const mine = decls.filter((d) => d.batchId === b.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ source: "tickets", provenance: "SOURCE_CONTRACT", population: "ALL_CLIENTS", statusScope: BROAD_EXPORT_CONTRACT.tickets.statusScope, coveredFrom: null, coveredTo: today() });
    // Un periodo ANTERIOR a la primera fecha observada queda cubierto por contrato (un cero allí es real), con su procedencia.
    const c = coverageOf("tickets", decls, "2023-01-01", "2023-01-31");
    expect(c).toMatchObject({ state: "COMPLETE", provenance: "SOURCE_CONTRACT" });
    expect(c.covered[0].from).toBe(CONTRACT_COVERAGE_FROM);
    // Más allá de la extracción/recepción no hay cobertura: no se afirma un futuro.
    expect(coverageOf("tickets", decls, "2099-01-01", "2099-01-31").state).toBe("PARTIAL");
  });

  it("una declaración explícita (limitación o cobertura más precisa) prevalece sobre el contrato y no se rellena como completa", async () => {
    const b = await importZd(admin.id, TICKETS, await ticketsBuffer([ticket({ ticket_id: "7002" })]));
    await declareCoverage(admin.id, { batchId: b.id, population: "PARTIAL", statusScope: "UNRESOLVED_ONLY", coveredFrom: "", coveredTo: "", extractedOn: "", reason: "Solo una selección de clientes", expectedVersion: 0 });
    const decls = await loadDeclarations(prisma);
    expect(decls.filter((d) => d.batchId === b.id)).toHaveLength(1);
    expect(decls.find((d) => d.batchId === b.id)).toMatchObject({ population: "PARTIAL", provenance: "DECLARED" });
    expect(coverageOf("tickets", decls, "2024-01-01", "2024-01-31").state).toBe("PARTIAL");
  });

  it("lo heredado (base anterior a HOTFIX-01) sin declaración sigue DESCONOCIDO: el contrato no se aplica retroactivamente a lotes que no lo cumplían", async () => {
    await fakeBatch(admin.id, "zendesk-tickets"); // legacyBase = true
    const decls = await loadDeclarations(prisma);
    expect(decls).toHaveLength(0);
    expect(coverageOf("tickets", decls, "2024-01-01", "2024-01-31")).toMatchObject({ state: "UNKNOWN", provenance: "NONE" });
  });

  it("en tiempos solo cuenta la instantánea activa de la fuente: la sustituida no aporta cobertura", async () => {
    const first = await importZd(admin.id, TIEMPO, await timesBuffer([timeRow({ ticket_id: "7003" })]));
    const second = await importZd(admin.id, TIEMPO, await timesBuffer([timeRow({ ticket_id: "7004" })]));
    const decls = (await loadDeclarations(prisma)).filter((d) => d.source === "zd_time");
    expect(decls.map((d) => d.batchId)).toEqual([second.id]);
    expect(decls.some((d) => d.batchId === first.id)).toBe(false);
    expect(coverageOf("zd_time", decls, "2024-01-01", "2024-12-31")).toMatchObject({ state: "COMPLETE", provenance: "SOURCE_CONTRACT" });
  });
});

describe("backlog: stock observado y fecha de recepción", () => {
  it("el export recibido hoy sustenta el stock del día de recepción como observación operativa; nunca el estado de un corte anterior", async () => {
    const b = await importZd(admin.id, TICKETS, await ticketsBuffer([ticket({ ticket_id: "7005", status: "open", creada: { date: excelSerial("2024-03-05") } })]));
    const batches = await loadTicketBatches(prisma);
    const info = batches.find((x) => x.batchId === b.id)!;
    expect(info).toMatchObject({ population: "ALL_CLIENTS", provenance: "SOURCE_CONTRACT", observationKind: "RECEIVED", extractionKnown: false, observedOn: today() });
    const snap = (cut: string) => chooseSnapshot(cut, batches.map((x) => ({ batchId: x.batchId, observedOn: x.observedOn, extractionKnown: x.extractionKnown, population: x.population, statusScope: x.statusScope })), { mode: "EXACT", maxDays: null });
    expect(snap(today()).kind).toBe("EXACT");
    const old = snap("2024-06-30");
    expect(old.kind).toBe("NONE"); // el status cargado hoy no reconstruye junio de 2024
    expect(old.kind === "NONE" ? old.earlier : "x").toBeNull();
    // Sin observación utilizable para el corte de hoy (p. ej. un corte posterior) con política «última anterior»: se ofrece la observada, con su fecha, como provisional.
    const later = chooseSnapshot("2099-01-10", batches.map((x) => ({ batchId: x.batchId, observedOn: x.observedOn, extractionKnown: x.extractionKnown, population: x.population, statusScope: x.statusScope })), { mode: "EXACT", maxDays: null });
    expect(later.kind).toBe("NONE");
    expect(later.kind === "NONE" ? later.earlier?.batchId : null).toBe(b.id);
  });
});
