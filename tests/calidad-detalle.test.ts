import { beforeEach, describe, expect, it } from "vitest";
import { parse } from "csv-parse/sync";
import { prisma } from "@/lib/db";
import { parseQualityQuery } from "@/domain/quality-query";
import { defaultQualityConfig } from "@/domain/quality-config";
import { STANDARD_CAUSE } from "@/domain/zendesk";
import { activateDraft, saveDraft } from "@/server/pulse/config";
import { diagnosisTickets, getBacklog, getDiagnosis, evolutionIn } from "@/server/quality/detail";
import { qualityCsv } from "@/server/quality/export";
import { addQualityNote, listQualityNotes } from "@/server/quality/notes";
import { saveHealthCell } from "@/server/quality/health";
import { getQuality } from "@/server/quality/engine";
import { readSnapshot } from "@/server/analytics/snapshot";
import { resetDatabase, makeUsers } from "./helpers";
import { addClient, addGroup, setUsers } from "./economia-helpers";
import { batchOf, declare, seedBugLink, seedTicket } from "./calidad-helpers";

/** Detalles de Calidad (diagnóstico, backlog con filas, evolución), CSV y permisos sobre PostgreSQL real con datos SINTÉTICOS. Octubre de 2026, «hoy» 02/11/2026. */
let admin: { id: string };
let reader: { id: string };
const NOW = new Date("2026-11-02T09:00:00Z");
const Q = (extra: Record<string, string> = {}) => parseQualityQuery({ fecha: "2026-10-31", modo: "FULL_MONTH", ...extra }, NOW).query;
beforeEach(async () => {
  await resetDatabase();
  ({ admin, reader } = await makeUsers());
});

async function world() {
  const g = await addGroup("Atlas");
  const g2 = await addGroup("Boreal");
  const c1 = await addClient("Atlas 1", g.id);
  const c2 = await addClient("Boreal 1", g2.id);
  await prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: "701", searchValue: "701", clientId: c1.id } });
  await prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: "703", searchValue: "703", clientId: c2.id } });
  await prisma.serviceTerm.create({ data: { attribute: "HOSTING", value: "OP", groupId: g.id, validTo: new Date("2026-06-01T00:00:00Z") } });
  await prisma.serviceTerm.create({ data: { attribute: "HOSTING", value: "CLOUD", groupId: g.id, validFrom: new Date("2026-06-01T00:00:00Z") } });
  await setUsers(admin.id, { groupId: g.id }, 2026, Array(12).fill(100));
  await setUsers(admin.id, { groupId: g2.id }, 2026, Array(12).fill(50));
  const tb = await batchOf(admin.id, "zendesk-tickets", "2026-10-31");
  return { g, g2, c1, c2, tb };
}

describe("diagnóstico por origen", () => {
  it("Sistemas del Cliente y Uso indebido se separan; entorno personalización + causa estándar conserva ambos; el vínculo a bug no sobrescribe la causa; infraestructura por alojamiento a la fecha de creación", async () => {
    const w = await world();
    const t = (id: string, o: Omit<Parameters<typeof seedTicket>[1], "id" | "org" | "observedOn">) => seedTicket(w.tb.id, { id, org: "701", observedOn: "2026-10-31", ...o });
    await t("D1", { type: "incident", created: "2026-10-02", cause: "incidente_sistemas_del_cliente" });
    await t("D2", { type: "incident", created: "2026-10-03", cause: "incidente_uso_indebido" });
    await t("D3", { type: "problem", created: "2026-10-04", cause: STANDARD_CAUSE, entorno: "Personalización" });
    await t("D4", { type: "problem", created: "2026-10-05", cause: "incidente_uso_indebido" }); // con vínculo a bug: la causa sigue siendo uso indebido
    await seedBugLink(w.tb.id, { bugId: "1", ticket: "D4" });
    await t("D5", { type: "incident", created: "2026-10-06", cause: "incidente_infraestructura" }); // Atlas es CLOUD desde junio → Vincle
    await t("D6", { type: "incident", created: "2026-10-07" }); // sin causa
    const d = await getDiagnosis(admin.id, Q(), NOW);
    expect(d.totals.tickets).toBe(6);
    expect(d.typeByFamily.cells["incident|SISTEMAS_CLIENTE"]).toBe(1);
    expect(d.typeByFamily.cells["incident|USO_INDEBIDO"]).toBe(1);
    expect(d.typeByFamily.cells["problem|USO_INDEBIDO"]).toBe(1); // el bug vinculado no la convierte en estándar
    expect(d.typeByFamily.cells["problem|ESTANDAR"]).toBe(1);
    expect(d.envByFamily.cells["Personalización|ESTANDAR"]).toBe(1); // ambos ejes conservados
    expect(d.typeByFamily.cells["incident|INFRA_VINCLE_CLOUD"]).toBe(1);
    expect(d.typeByFamily.cells["incident|SIN_CAUSA"]).toBe(1);
    expect(d.pending.noCause).toBe(1);
    // detalle: mismos predicados, total completo (no la página)
    const det = await diagnosisTickets(admin.id, Q({ fam: "USO_INDEBIDO" }), "USO_INDEBIDO", 1, 1, NOW);
    expect(det.total).toBe(2);
    expect(det.rows).toHaveLength(1);
    expect(det.pageCount).toBe(2);
  });
  it("una migración posterior a CLOUD no convierte retroactivamente OP en CLOUD", async () => {
    const w = await world();
    await seedTicket(w.tb.id, { id: "H1", org: "701", type: "incident", created: "2026-04-10", cause: "incidente_infraestructura", observedOn: "2026-10-31" }); // antes de junio: OP
    const d = await getDiagnosis(admin.id, Q({ fecha: "2026-04-30" }), NOW);
    expect(d.typeByFamily.cells["incident|INFRA_CLIENTE_OP"]).toBe(1);
    expect(d.typeByFamily.cells["incident|INFRA_VINCLE_CLOUD"]).toBeUndefined();
  });
  it("una causa sin correspondencia queda en Otros con su valor original; un cambio de correspondencias crea revisión y referencia nueva sin alterar el bruto", async () => {
    const w = await world();
    await seedTicket(w.tb.id, { id: "X1", org: "701", type: "incident", created: "2026-10-02", cause: "hardware", observedOn: "2026-10-31" });
    const d0 = await getDiagnosis(admin.id, Q(), NOW);
    expect(d0.typeByFamily.cells["incident|OTROS"]).toBe(1);
    expect(d0.pending.unmapped).toEqual(["hardware"]);
    const cfg = defaultQualityConfig();
    cfg.diagnosis.mappings.push({ cause: "hardware", family: "INFRA_CLIENTE_OP" });
    const dr = await saveDraft(admin.id, "QUALITY", cfg, { expectedVersion: null });
    await activateDraft(admin.id, "QUALITY", { expectedRevisionNo: 1, expectedDraftVersion: dr.version, reason: "hardware es infraestructura del cliente" });
    const d1 = await getDiagnosis(admin.id, Q(), NOW);
    expect(d1.typeByFamily.cells["incident|INFRA_CLIENTE_OP"]).toBe(1);
    expect(d1.mappingsVersion).toBe(2);
    expect((await prisma.zdTicketRevision.findFirstOrThrow({ where: { causaRaiz: "hardware" } })).causaRaiz).toBe("hardware"); // el bruto no cambia
  });
});

describe("backlog con filas y evolución", () => {
  it("filas con ticket, tipo, status, creación, observación, edad y motivo; estadísticos por tipo (mediana, P90, máxima, % envejecido, tasas por 100 usuarios)", async () => {
    const w = await world();
    const photo = await batchOf(admin.id, "zendesk-tickets", "2026-10-31");
    await declare(admin.id, photo.id, { statusScope: "UNRESOLVED_ONLY" });
    const cfg = { ...defaultQualityConfig(), incidents: { ...defaultQualityConfig().incidents, ageBands: [{ from: 0, to: 30 }, { from: 31, to: null }], concerningDays: { incident: 30, problem: 60 } } };
    const dr = await saveDraft(admin.id, "QUALITY", cfg, { expectedVersion: null });
    await activateDraft(admin.id, "QUALITY", { expectedRevisionNo: 1, expectedDraftVersion: dr.version, reason: "umbrales" });
    for (const [i, created] of ["2026-10-31", "2026-10-21", "2026-10-01", "2026-09-30", "2025-10-31"].entries()) await seedTicket(photo.id, { id: `K${i}`, org: "701", type: "incident", status: "open", created, observedOn: "2026-10-31" });
    const b = await getBacklog(admin.id, Q({ sel: w.g.id }), 1, 50, NOW);
    expect(b.choice.kind).toBe("EXACT");
    expect(b.stats?.incident).toMatchObject({ count: 5, aged: 2, median: "30", max: 365 }); // edades 0, 10, 30, 31, 365
    expect(b.stats?.incident.agedPct).toBe("40");
    expect(b.stats?.incident.per100).toBe("5"); // 5 tickets × 100 / 100 usuarios
    expect(b.stats?.incident.agedPer100).toBe("2");
    expect(b.stats?.problem).toMatchObject({ count: 0, median: null, max: null }); // stock vacío confirmado: conteo cero, edades no aplicables
    expect([...b.rows].sort((a, c) => a.age - c.age).map((r) => [r.age, r.aged])).toEqual([[0, false], [10, false], [30, false], [31, true], [365, true]]);
    expect(b.rows.find((r) => r.age === 31)?.reason).toMatch(/Edad 31 > umbral 30/);
  });
  it("evolución: cada mes con sus datos; sin cobertura declarada un mes NO es un cero confirmado y no hay fotografía compatible (hueco); CUM técnico separado", async () => {
    const w = await world();
    await seedTicket(w.tb.id, { id: "E1", org: "701", type: "incident", created: "2026-03-10", observedOn: "2026-10-31" });
    await seedTicket(w.tb.id, { id: "E2", org: "701", type: "incident", created: "2026-10-10", observedOn: "2026-10-31" });
    const ev = await readSnapshot(admin.id, (tx) => evolutionIn(tx, Q(), w.g.id, defaultQualityConfig(), "2026-11-02"));
    expect(ev.points).toHaveLength(10);
    expect(ev.series.basis).toBe("RECALCULADA_CON_REVISION_ACTIVA");
    const mar = ev.points[2].indicators.INCIDENTS_PROBLEMS;
    expect(mar.numerator).toBe("1");
    expect(ev.points[9].indicators.INCIDENTS_PROBLEMS.numerator).toBe("1");
    // Un mes SIN tickets y SIN cobertura declarada no es un cero confirmado: valor nulo con motivo, nunca «0».
    const feb = ev.points[1].indicators.N3_ESCALATIONS;
    expect(feb.value).toBeNull();
    expect(feb.reason).toMatch(/no sustentado/i);
    expect(ev.points[9].backlog).toMatchObject({ kind: "NONE", observedOn: null }); // sin fotografía declarada: hueco, no relleno
    expect(ev.cum.current).toMatchObject({ flujo: 2 });
    expect(ev.series.reference).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("CSV, notas y seguridad", () => {
  it("la cartera exporta TODAS las filas filtradas (no la página), con unidades, colores textuales, pesos, revisión y corte; negativos y fórmulas neutralizadas", async () => {
    const w = await world();
    await saveHealthCell(admin.id, { scope: "group", entityId: w.g.id, year: 2026, month: 10, state: "POSITIVE", comment: "=HYPERLINK(\"x\")", expectedVersion: 0 }, { now: NOW });
    const csv = await qualityCsv(admin.id, Q({ tam: "25", pagina: "1" }), "cartera", { now: NOW });
    const rows = parse(csv.body.replace(/^﻿/, ""), { delimiter: ";", columns: true, skip_empty_lines: true }) as Record<string, string>[];
    expect(rows.map((r) => r.entidad)).toEqual(["Atlas", "Boreal"]);
    expect(rows[0]).toMatchObject({ ambito: "Grupo Cliente", corte_efectivo: "2026-10-31", estado_periodo: "cerrado", revision_calidad: "1 (inicial)", global_color: "sin color", HEALTH_color: "sin color" });
    expect(rows[0].HEALTH_valor).toBe("Positivo"); // categoría visible aunque el mapeo no esté confirmado
    expect(rows[0].HEALTH_peso_configurado_pct).toBe("16,66666666666666666667");
    const health = await qualityCsv(admin.id, Q({ anio: "2026" }), "health", { now: NOW });
    expect(health.body).toContain("'=HYPERLINK"); // fórmula textual neutralizada
    const small = await qualityCsv(admin.id, Q({ q: "Atl" }), "cartera", { now: NOW });
    expect(small.rows).toBe(1);
    const reader1 = await qualityCsv(reader.id, Q(), "cartera", { now: NOW });
    expect(reader1.rows).toBe(2); // Consulta lee y descarga
  });
  it("Consulta lee análisis y notas pero no escribe notas, Health ni cobertura; anónimo (usuario inexistente) no lee", async () => {
    const w = await world();
    await expect(addQualityNote(reader.id, { scope: "group", entityId: w.g.id, year: 2026, month: 10, topic: "CONFIGURACION", text: "x" })).rejects.toThrow();
    const n = await addQualityNote(admin.id, { scope: "group", entityId: w.g.id, year: 2026, month: 10, topic: "CONFIGURACION", evidence: "T1, T2", text: "Hipótesis confirmada en la revisión de QA" });
    expect(n.author).toBe("admin@test.local");
    expect((await listQualityNotes(reader.id, "group", w.g.id)).map((x) => x.text)).toEqual(["Hipótesis confirmada en la revisión de QA"]);
    await expect(addQualityNote(admin.id, { scope: "group", entityId: w.g.id, year: 2026, month: 10, topic: "NO_EXISTE", text: "x" })).rejects.toThrow();
    await expect(getQuality("no-existe", Q(), { now: NOW })).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`UPDATE "QualityNote" SET text = 'x'`)).rejects.toThrow(); // solo se añade
    expect(await prisma.auditEvent.count({ where: { entityType: "QualityNote" } })).toBe(1); // solo el éxito se audita
  });
});
