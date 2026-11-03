import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getSettings, listSettingsRevisions, updateSettings } from "@/server/economics/settings";
import { createServiceAssignment, listServiceAssignments, previewServiceAssignmentImpact, setServiceAssignmentActive, updateServiceAssignment } from "@/server/economics/service-assignments";
import { runEconomics } from "@/server/economics/engine";
import { decideFinance, reviewFinanceImpact, revokeFinanceDecision } from "@/server/finance/review";
import { confirmUpload, receiveUpload, revertUpload } from "@/server/uploads/batches";
import { createIdentity } from "@/server/identities";
import { AccessError } from "@/lib/access";
import { DomainError, StaleVersionError } from "@/server/errors";
import { Readable } from "node:stream";
import { freshEnvironment, removeUploadDir, useUploadDir, drain } from "./cargas-helpers";
import { addGroup, addTicket, addZd, fakeBatch, seedFinance } from "./economia-helpers";
import { prepareFin, importFin, scopeOf } from "./finanzas-helpers";
import { financeXlsx } from "./generators/finance";

let dir: string;
let admin: { id: string };
let reader: { id: string };
beforeAll(() => { dir = useUploadDir(); });
afterAll(() => removeUploadDir(dir));
beforeEach(async () => { ({ admin, reader } = await freshEnvironment()); });

const NOW = new Date("2026-10-30T10:00:00Z");

describe("configuración económica", () => {
  it("empieza con 550 €/jornada, jornada de 8 h y tolerancia 0,01 € (revisión 1, aun si la tabla se vació)", async () => {
    const s = await getSettings(prisma);
    expect(s).toMatchObject({ revisionNo: 1, targetEurosPerDay: "550", dayHours: "8", reconciliationTolerance: "0.01" });
  });
  it("una nueva revisión conserva la anterior, deja autor y auditoría y cambia el resultado del motor con referencia a la versión previa", async () => {
    const g = await addGroup("G");
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "12000" }]);
    const before = await runEconomics(admin.id, { scope: { type: "groups", ids: [g.id] }, service: "SOPORTE", date: "2026-01-31", mode: "FULL_MONTH", now: NOW });
    expect(before.entities[0].periods.month.targetHours.value).toBe("14.54545454545454545455"); // 1000/550 × 8
    const s2 = await updateSettings(admin.id, { targetEurosPerDay: "500", dayHours: "8", reconciliationTolerance: "0.05", reason: "Nuevo objetivo", expectedRevisionNo: 1 });
    expect(s2).toMatchObject({ revisionNo: 2, targetEurosPerDay: "500", activatedByEmail: "admin@test.local" });
    const after = await runEconomics(admin.id, { scope: { type: "groups", ids: [g.id] }, service: "SOPORTE", date: "2026-01-31", mode: "FULL_MONTH", now: NOW });
    expect(after.settings.revisionNo).toBe(2);
    expect(after.entities[0].periods.month.targetHours.value).toBe("16");
    const old = await runEconomics(admin.id, { scope: { type: "groups", ids: [g.id] }, service: "SOPORTE", date: "2026-01-31", mode: "FULL_MONTH", now: NOW, settingsRevision: 1 });
    expect(old.recalculatedWithOlderSettings).toBe(true);
    expect(old.entities[0].periods.month.targetHours.value).toBe(before.entities[0].periods.month.targetHours.value);
    expect((await listSettingsRevisions(admin.id)).map((r) => r.revisionNo)).toEqual([2, 1]);
    expect((await getSettings(prisma, 1)).targetEurosPerDay).toBe("550"); // la revisión 1 no se sobrescribe
    const a = await prisma.auditEvent.findFirstOrThrow({ where: { entityType: "EconomicSettings" } });
    expect(a.summary).toMatch(/revisión 2/);
  });
  it("rechaza la edición obsoleta concurrente y valores no válidos (objetivo/jornada positivos, tolerancia no negativa)", async () => {
    await updateSettings(admin.id, { targetEurosPerDay: "600", dayHours: "8", reconciliationTolerance: "0.01", expectedRevisionNo: 1 });
    await expect(updateSettings(admin.id, { targetEurosPerDay: "700", dayHours: "8", reconciliationTolerance: "0.01", expectedRevisionNo: 1 })).rejects.toBeInstanceOf(StaleVersionError);
    for (const bad of [{ targetEurosPerDay: "0" }, { targetEurosPerDay: "-5" }, { dayHours: "0" }, { dayHours: "25" }, { reconciliationTolerance: "-0.01" }, { targetEurosPerDay: "abc" }]) {
      await expect(updateSettings(admin.id, { targetEurosPerDay: "600", dayHours: "8", reconciliationTolerance: "0.01", expectedRevisionNo: 2, ...bad })).rejects.toBeInstanceOf(DomainError);
    }
    await expect(updateSettings(admin.id, { targetEurosPerDay: "600", dayHours: "8", reconciliationTolerance: "0.01", expectedRevisionNo: 2 })).rejects.toThrow(/nada que cambiar/);
    const racing = await Promise.allSettled([
      updateSettings(admin.id, { targetEurosPerDay: "610", dayHours: "8", reconciliationTolerance: "0.01", expectedRevisionNo: 2 }),
      updateSettings(admin.id, { targetEurosPerDay: "620", dayHours: "8", reconciliationTolerance: "0.01", expectedRevisionNo: 2 }),
    ]);
    expect(racing.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await listSettingsRevisions(admin.id)).length).toBe(3);
  });
  it("la tolerancia capturada al preparar el lote se mantiene; si cambia y altera el resultado de la validación, exige revisar de nuevo", async () => {
    const b = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 10 }], { total: { vta: { raw: "10.03" } } });
    expect((await prisma.financeBatch.findUniqueOrThrow({ where: { batchId: b.id } })).tolerance.toString()).toBe("0.01");
    // con la tolerancia de 0,01 € la diferencia de 0,03 € no concilia: se bloquea
    await expect(decideFinance(admin.id, b.id, { kind: "ACK_NO_TOTAL", reason: "x" })).rejects.toBeInstanceOf(DomainError);
    // un cambio de configuración posterior a la preparación hace que concilie; antes de activar se exige revisión nueva del lote
    await updateSettings(admin.id, { targetEurosPerDay: "550", dayHours: "8", reconciliationTolerance: "0.05", expectedRevisionNo: 1 });
    const { computeAnalysis } = await import("@/server/finance/review");
    expect((await computeAnalysis(prisma, b.id))!.reconciliation.reconciled).toBe(false); // sigue con la tolerancia capturada
    expect((await computeAnalysis(prisma, b.id, { toleranceOverride: "0.05" }))!.reconciliation.reconciled).toBe(true);
  });
});

describe("asignación de servicio", () => {
  it("crea con auditoría, rechaza solapamientos y edición obsoleta, desactiva y reactiva; el impacto muestra actividades y horas", async () => {
    const a = await createServiceAssignment(admin.id, { matchKind: "ENTORNO", matchValue: "  Entorno   Soporte ", service: "SOPORTE", validFrom: "2026-01-01", validTo: "" });
    expect(a.searchValue).toBe("entorno soporte");
    await expect(createServiceAssignment(admin.id, { matchKind: "ENTORNO", matchValue: "entorno soporte", service: "OTROS", validFrom: "2026-06-01" })).rejects.toThrow(/solapa/);
    await createServiceAssignment(admin.id, { matchKind: "ENTORNO", matchValue: "entorno soporte", service: "OTROS", validFrom: "2025-01-01", validTo: "2026-01-01" }); // contigua, sin solape
    await expect(updateServiceAssignment(admin.id, a.id, { matchValue: "Entorno Soporte", service: "SOPORTE", validFrom: "2026-01-01", validTo: "", expectedVersion: 7 })).rejects.toBeInstanceOf(StaleVersionError);
    const off = await setServiceAssignmentActive(admin.id, a.id, false, a.version);
    expect(off.isActive).toBe(false);
    expect((await listServiceAssignments(admin.id, { q: "soporte", status: "active" })).total).toBe(1);
    expect((await prisma.auditEvent.count({ where: { entityType: "ServiceAssignment" } }))).toBe(3);
    const g = await addGroup("G");
    const t = await fakeBatch(admin.id);
    await addTicket(t.id, { ticketId: "X", entorno: "Entorno Soporte" });
    await addZd({ batchId: t.id, date: "2026-02-10", minutes: 90, groupId: g.id, ticketId: "X" });
    const imp = await previewServiceAssignmentImpact(admin.id, { matchKind: "ENTORNO", matchValue: "entorno soporte", service: "SOPORTE", validFrom: "2026-01-01", validTo: "" });
    expect(imp).toMatchObject({ activities: 1, hours: "1.5", groups: 1 });
    await expect(setServiceAssignmentActive(admin.id, a.id, true, off.version)).resolves.toMatchObject({ isActive: true });
  });
  it("sin asignaciones por defecto: ninguna semilla inventada", async () => {
    expect(await prisma.serviceAssignment.count()).toBe(0);
  });
});

// La vía asistida anterior a 2025 (importHistoricFinance, que rechazaba 2025 en adelante) la sustituye la entrada «Histórico económico y usuarios»
// de HOTFIX-01 §6: sus pruebas están en tests/historico-economico.test.ts.

describe("seguridad: sin sesión o con perfil Consulta nada muta", () => {
  it("cargas financieras, decisiones, revisión, reversión, equivalencias, parámetros y asignaciones", async () => {
    const b = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 10 }], { total: { vta: 10 } });
    const done = await importFin(admin.id, "SOPORTE", 2025, [{ grupo: "Z", vta: 1 }], { total: { vta: 1 } });
    const snapshot = async () => JSON.stringify([
      await prisma.financeDecision.count(), await prisma.auditEvent.count(), await prisma.economicSettingsRevision.count(), await prisma.serviceAssignment.count(),
      await prisma.externalIdentity.count(), await scopeOf("SOPORTE", 2025), (await prisma.financeBatch.findUniqueOrThrow({ where: { batchId: b.id } })).reviewedScopeVersion,
      (await prisma.uploadBatch.findUniqueOrThrow({ where: { id: b.id } })).status, await prisma.uploadJob.count(),
    ]);
    const base = await snapshot();
    const g = await addGroup("G");
    const file = await financeXlsx([{ grupo: "A", vta: 1 }], { total: { vta: 1 } });
    const attempts: (() => Promise<unknown>)[] = [];
    for (const who of [reader.id, "sin-sesion"]) {
      attempts.push(
        () => decideFinance(who, b.id, { kind: "ACCEPT_UNASSIGNED" }),
        () => revokeFinanceDecision(who, b.id, "ACCEPT_UNASSIGNED", ""),
        () => reviewFinanceImpact(who, b.id),
        () => confirmUpload(who, b.id),
        () => revertUpload(who, done.id),
        () => receiveUpload(who, { profileId: "facturacion-soporte", originalName: "f.xlsx", metadata: { anio: 2026 }, declared: {}, contentLength: file.length, body: Readable.from([file]) }),
        () => createIdentity(who, { system: "WRIKE", kind: "PROJECT_NAME", rawValue: "P", targetType: "group", targetId: g.id }),
        () => updateSettings(who, { targetEurosPerDay: "1", dayHours: "8", reconciliationTolerance: "0", expectedRevisionNo: 1 }),
        () => createServiceAssignment(who, { matchKind: "ENTORNO", matchValue: "x", service: "OTROS" }),
      );
    }
    for (const a of attempts) await expect(a()).rejects.toBeInstanceOf(AccessError);
    expect(await snapshot()).toBe(base);
    // el motor sí admite lectura de Consulta; sin sesión no
    await expect(runEconomics(reader.id, { scope: { type: "groups", ids: [g.id] }, service: "SOPORTE", date: "2026-01-31", now: NOW })).resolves.toBeTruthy();
    await expect(runEconomics("sin-sesion", { scope: { type: "groups", ids: [g.id] }, service: "SOPORTE", date: "2026-01-31", now: NOW })).rejects.toBeInstanceOf(AccessError);
    // lecturas de asignaciones permitidas para Consulta; la importación histórica y los detalles con lotes, no
    await expect(listServiceAssignments(reader.id)).resolves.toBeTruthy();
    await drain();
  });
});
