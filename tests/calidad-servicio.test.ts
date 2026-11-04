import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { Dec } from "@/domain/finance";
import { parseQualityQuery } from "@/domain/quality-query";
import { uncalibratedQualityConfig as defaultQualityConfig, type QualityConfig, type IndicatorKey } from "@/domain/quality-config";
import { defaultPulseConfig } from "@/domain/pulse-catalog";
import { STANDARD_CAUSE } from "@/domain/zendesk";
import { computeQuality, getQuality } from "@/server/quality/engine";
import { activateDraft, saveDraft } from "@/server/pulse/config";
import { saveHealthCell, getHealthMatrix } from "@/server/quality/health";
import { readSnapshot } from "@/server/analytics/snapshot";
import { resetDatabase, makeUsers, useUncalibratedQuality } from "./helpers";
import { addClient, addGroup, addTicket, fakeBatch, setUsers, tkey } from "./economia-helpers";
import { batchOf, declare, seedBugLink, seedPap, seedTicket } from "./calidad-helpers";

/**
 * Servicio de Calidad (CSAPP-08) sobre PostgreSQL real con datos SINTÉTICOS. Mes de análisis: octubre de 2026 (corte 31/10, mes completo), «hoy» 02/11/2026.
 * Los resultados esperados se calculan aquí a mano, no se copian del código.
 */
let admin: { id: string };
let reader: { id: string };
const NOW = new Date("2026-11-02T09:00:00Z");
beforeEach(async () => {
  await resetDatabase();
  ({ admin, reader } = await makeUsers());
  await useUncalibratedQuality(admin.id);
});
const Q = (extra: Record<string, string> = {}) => parseQualityQuery({ fecha: "2026-10-31", modo: "FULL_MONTH", ...extra }, NOW).query;
const run = (extra: Record<string, string> = {}, o: Parameters<typeof getQuality>[2] = {}) => getQuality(admin.id, Q(extra), { now: NOW, ...o });

async function world() {
  const g = await addGroup("Atlas");
  const g2 = await addGroup("Boreal");
  const c1 = await addClient("Atlas 1", g.id);
  const c2 = await addClient("Atlas 2", g.id);
  const b1 = await addClient("Boreal 1", g2.id);
  await prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: "701", searchValue: "701", clientId: c1.id } });
  await prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: "702", searchValue: "702", clientId: c2.id } });
  await prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: "703", searchValue: "703", clientId: b1.id } });
  // Grupo Atlas: 100 usuarios propios (NO es la suma de sus hijos); Atlas 1 = 60, Atlas 2 = 60 (compartidos entre hijos).
  await setUsers(admin.id, { groupId: g.id }, 2026, Array(12).fill(100));
  await setUsers(admin.id, { clientId: c1.id }, 2026, Array(12).fill(60));
  await setUsers(admin.id, { clientId: c2.id }, 2026, Array(12).fill(60));
  await setUsers(admin.id, { groupId: g2.id }, 2026, Array(12).fill(50));
  const tb = await batchOf(admin.id, "zendesk-tickets", "2026-10-31");
  return { g, g2, c1, c2, b1, tb };
}
const row = (v: Awaited<ReturnType<typeof run>>, name: string) => v.rows.find((r) => r.name === name)!;
const V = (r: ReturnType<typeof row>, k: IndicatorKey) => r.evaluation.indicators[k];

describe("cartera sin calibrar: magnitudes, razones y ningún color por defecto", () => {
  it("base vacía funciona; con datos muestra valores y razones, sin verde automático ni global", async () => {
    const empty = await run();
    expect(empty.rows).toEqual([]);
    const w = await world();
    for (let i = 0; i < 4; i++) await seedTicket(w.tb.id, { id: `A${i}`, org: "701", type: "incident", created: "2026-10-05", observedOn: "2026-10-31" });
    const v = await run();
    const a = row(v, "Atlas");
    expect(a.users.userMonths).toBe("100"); // 100 usuarios propios del grupo, mes completo (peso 31/31)
    // 4 incidentes / 100 usuarios·mes × 100 = 4 por 100 (flujo): sin cobertura declarada → cota inferior (parcial), sin color
    expect(V(a, "INCIDENTS_PROBLEMS").components?.[0]).toMatchObject({ id: "flow", value: "4", color: null });
    expect(a.evaluation.global).toMatchObject({ color: null });
    expect(Object.values(a.evaluation.indicators).every((i) => i.color === null)).toBe(true);
    expect(v.cards).toMatchObject({ green: 0, yellow: 0, red: 0, noGlobal: 2, total: 2 });
    expect(v.notes.join(" ")).toMatch(/Sin (declaración de cobertura|carga completada)[^.]*tickets Zendesk/);
  });
  it("Health en blanco redistribuye (cinco de 20 %); con feedback presente sin calibrar conserva el peso y se muestra categoría sin calibrar", async () => {
    const w = await world();
    const blank = row(await run(), "Atlas");
    expect(blank.evaluation.weights?.redistributedFromHealth).toBe(true);
    expect(blank.evaluation.weights?.percent.DEDICATION).toBe("20");
    await saveHealthCell(admin.id, { scope: "group", entityId: w.g.id, year: 2026, month: 10, state: "NEGATIVE", comment: "Reunión trimestral", feedbackOn: "2026-10-15", expectedVersion: 0 }, { now: NOW });
    const withFb = row(await run(), "Atlas");
    expect(V(withFb, "HEALTH")).toMatchObject({ availability: "UNCALIBRATED", color: null, status: "SIN_CALIBRAR", value: "negative" });
    expect(withFb.evaluation.weights?.redistributedFromHealth).toBe(false);
    expect(withFb.evaluation.weights?.percent.HEALTH).toBe("16.66666666666666666667");
  });
});

describe("Client Health: edición atómica, historial y temporalidad", () => {
  it("vacío inicial; positivo/negativo/mixto; limpiar conserva historial; conflicto concurrente; grupo y Cliente independientes", async () => {
    const w = await world();
    const m0 = await getHealthMatrix(admin.id, { scope: "group", year: 2026, q: "", page: 1, pageSize: 25 });
    expect(m0.rows.every((r) => Object.values(r.cells).every((c) => c === null))).toBe(true);
    const cell = { scope: "group" as const, entityId: w.g.id, year: 2026, month: 9 };
    const c1 = await saveHealthCell(admin.id, { ...cell, state: "POSITIVE", comment: "<b>bien</b>", expectedVersion: 0 }, { now: NOW });
    expect(c1).toMatchObject({ version: 1, state: "POSITIVE", comment: "<b>bien</b>", feedbackOn: null }); // texto, sin interpretar
    const c2 = await saveHealthCell(admin.id, { ...cell, state: "MIXED", comment: "matices", expectedVersion: 1 }, { now: NOW });
    expect(c2.version).toBe(2);
    // dos ediciones con la misma versión vista: solo una gana
    const [a, b] = await Promise.allSettled([
      saveHealthCell(admin.id, { ...cell, state: "NEGATIVE", comment: "a", expectedVersion: 2 }, { now: NOW }),
      saveHealthCell(admin.id, { ...cell, state: "POSITIVE", comment: "b", expectedVersion: 2 }, { now: NOW }),
    ]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
    const cur = await prisma.healthFeedback.findFirstOrThrow({ where: { groupId: w.g.id, year: 2026, month: 9 } });
    const cleared = await saveHealthCell(admin.id, { ...cell, state: "NONE", expectedVersion: cur.version }, { now: NOW });
    expect(cleared).toMatchObject({ state: "NONE", comment: null });
    const events = await prisma.healthFeedbackEvent.findMany({ where: { feedbackId: cur.id }, orderBy: { version: "asc" } });
    expect(events.map((e) => e.action)).toEqual(["CREATE", "UPDATE", "UPDATE", "CLEAR"]);
    expect(await prisma.auditEvent.count({ where: { entityType: "HealthFeedback" } })).toBe(4);
    // Cliente independiente: no hereda ni propaga la celda del grupo
    const m = await getHealthMatrix(admin.id, { scope: "client", year: 2026, q: "", page: 1, pageSize: 25 });
    expect(m.rows.every((r) => r.cells[9] === null)).toBe(true);
    await expect(prisma.$executeRawUnsafe(`UPDATE "HealthFeedbackEvent" SET comment = 'x'`)).rejects.toThrow();
  });
  it("fecha futura, mes futuro, fuera del mes y ámbito interno se rechazan; Consulta no edita", async () => {
    const w = await world();
    const base = { scope: "group" as const, entityId: w.g.id, state: "POSITIVE" as const, expectedVersion: 0 };
    await expect(saveHealthCell(admin.id, { ...base, year: 2026, month: 11, feedbackOn: "2026-11-20" }, { now: NOW })).rejects.toThrow(/futura|no ha empezado|aún/i);
    await expect(saveHealthCell(admin.id, { ...base, year: 2026, month: 12 }, { now: NOW })).rejects.toThrow(/no ha empezado/);
    await expect(saveHealthCell(admin.id, { ...base, year: 2026, month: 10, feedbackOn: "2026-09-30" }, { now: NOW })).rejects.toThrow(/dentro del mes/);
    const internal = await addClient("VINCLE BUGS", null, true);
    await expect(saveHealthCell(admin.id, { scope: "client", entityId: internal.id, year: 2026, month: 10, state: "POSITIVE", expectedVersion: 0 }, { now: NOW })).rejects.toThrow(/interna/);
    await expect(saveHealthCell(reader.id, { ...base, year: 2026, month: 10 }, { now: NOW })).rejects.toThrow();
    expect(await prisma.healthFeedback.count()).toBe(0); // nada se ha guardado ni auditado como éxito
    expect(await prisma.auditEvent.count({ where: { entityType: "HealthFeedback" } })).toBe(0);
  });
  it("fecha concreta posterior al corte diario no se usa antes de ella; registro retroactivo identificado", async () => {
    const w = await world();
    await saveHealthCell(admin.id, { scope: "group", entityId: w.g.id, year: 2026, month: 10, state: "NEGATIVE", feedbackOn: "2026-10-20", expectedVersion: 0 }, { now: NOW });
    const atCut = row(await run({ fecha: "2026-10-10", modo: "CUTOFF" }), "Atlas");
    expect(V(atCut, "HEALTH").availability).toBe("BLANK"); // el 20/10 aún no había sucedido el 10/10
    expect(atCut.health.use?.notYetAtCut).toBe(true);
    const later = row(await run(), "Atlas");
    expect(V(later, "HEALTH").availability).toBe("UNCALIBRATED");
    expect(later.health.use).toMatchObject({ precision: "DIA", registeredLater: true }); // registrado en noviembre para octubre
  });
});

describe("sexto indicador: COUNT DISTINCT(S ∪ B)", () => {
  it("dos problemas vinculados a un Bug_ y uno además estándar → 2, no 3; un problema con dos bugs → 1; incidentes, internos, rechazados y sin resolver separados", async () => {
    const w = await world();
    const mk = (id: string, o: Partial<Parameters<typeof seedTicket>[1]> = {}) => seedTicket(w.tb.id, { id, org: "701", type: "problem", created: "2026-10-05", observedOn: "2026-10-31", ...o });
    await mk("P1", { cause: STANDARD_CAUSE }); // S y B
    await mk("P2"); // solo B
    await mk("P3"); // problema con dos bugs
    await mk("P4", { cause: "incidente_uso_indebido" }); // causa distinta + vínculo: no se sobrescribe, cuenta por B
    await mk("P5"); // vínculo rechazado → no entra
    await mk("P6"); // vínculo sin ticket resuelto → no entra
    await mk("I1", { type: "incident" }); // incidente vinculado: contexto, no numerador
    await seedBugLink(w.tb.id, { bugId: "1", ticket: "P1" });
    await seedBugLink(w.tb.id, { bugId: "2", ticket: "P2" });
    await seedBugLink(w.tb.id, { bugId: "3", ticket: "P3" });
    await seedBugLink(w.tb.id, { bugId: "3", product: "VSW", ticket: "P3" }); // mismo ID en otro producto: no colisiona; sigue siendo UN problema
    await seedBugLink(w.tb.id, { bugId: "4", ticket: "P4" });
    await seedBugLink(w.tb.id, { bugId: "5", ticket: "P5", manual: "REJECTED" });
    await seedBugLink(w.tb.id, { bugId: "6", ticket: "P6", state: "PENDING_TICKET" });
    await seedBugLink(w.tb.id, { bugId: "7", ticket: "I1" });
    await seedBugLink(w.tb.id, { bugId: "8", ticket: "P2", isBug: false }); // Task: no es defecto
    await mk("S1", { cause: STANDARD_CAUSE }); // solo S, sin vínculo
    const a = row(await run(), "Atlas");
    const ex = a.explain.BUGS_STANDARD;
    // Unión = {P1 (S+B), P2, P3, P4 (B), S1 (S)} = 5. Por causa = {P1, S1} = 2; por vínculo = {P1, P2, P3, P4} = 4; ambas = {P1} = 1; incidentes vinculados = 1.
    expect(ex.numerator).toBe("5");
    expect(ex.breakdown).toMatchObject({ "por causa (S)": "2", "por vínculo (B)": "4", ambas: "1", "total único": "5", "incidentes vinculados (adicional, no numerador)": "1" });
    // 5 problemas × 100 / 100 usuarios·mes = 5 por 100
    expect(V(a, "BUGS_STANDARD").value).toBe("5");
    expect(V(a, "BUGS_STANDARD").status).toBe("PARCIAL"); // sin cobertura declarada y con vínculos sin resolver: afectación conocida, cota inferior
  });
  it("ejemplo mínimo del contrato: P1(S+B) y P2(B) con un único Bug_ → 2, no 3", async () => {
    const w = await world();
    for (const id of ["P1", "P2"]) await seedTicket(w.tb.id, { id, org: "701", type: "problem", created: "2026-10-02", observedOn: "2026-10-31", cause: id === "P1" ? STANDARD_CAUSE : null });
    await seedBugLink(w.tb.id, { bugId: "9", ticket: "P1" });
    await seedBugLink(w.tb.id, { bugId: "9", product: "VSW", ticket: "P2" });
    expect(row(await run(), "Atlas").explain.BUGS_STANDARD.numerator).toBe("2");
  });
});

describe("escalados N3 y PAP", () => {
  it("ticket sin horas cuenta; dos destinos N3 = uno; N4 no inventa N3; el mes es el de CREACIÓN", async () => {
    const w = await world();
    await seedTicket(w.tb.id, { id: "E1", org: "701", created: "2026-10-03", destinations: ["PMO_N3", "IT_N3"], observedOn: "2026-10-31" });
    await seedTicket(w.tb.id, { id: "E2", org: "701", created: "2026-10-04", destinations: ["PLATAFORMA_N4"], observedOn: "2026-10-31" });
    await seedTicket(w.tb.id, { id: "E3", org: "701", created: "2026-09-30", destinations: ["IT_N3"], observedOn: "2026-10-31" }); // creado en septiembre
    const a = row(await run(), "Atlas");
    expect(a.explain.N3_ESCALATIONS.numerator).toBe("1");
    expect(a.explain.N3_ESCALATIONS.breakdown).toMatchObject({ "PMO N3": "1", "IT N3": "1" });
    expect(V(a, "N3_ESCALATIONS").value).toBe("1");
  });
  it("PAP: identidad única con correctivo + otra causa cuenta una vez; estándar y origen cliente solapan sin sumarse; no OK y sin fecha no desaparecen", async () => {
    const w = await world();
    const pb = await batchOf(admin.id, "pap");
    await seedPap(pb.id, { id: "1", groupId: w.g.id, clientId: w.c1.id, date: "2026-10-10", state: "CORRECTIVE", causes: [{ category: "CORRECTIVE", origin: "STANDARD" }, { category: "CORRECTIVE", origin: "CLIENT_ORIGIN" }, { category: "EVOLUTIVE" }], result: "KO" });
    await seedPap(pb.id, { id: "2", groupId: w.g.id, clientId: w.c1.id, date: "2026-10-11", state: "CORRECTIVE", causes: [{ category: "CORRECTIVE", origin: "CUSTOMIZATION" }], result: "Revertido" });
    await seedPap(pb.id, { id: "3", groupId: w.g.id, clientId: w.c1.id, date: "2026-10-12", state: "NON_CORRECTIVE", causes: [{ category: "EVOLUTIVE" }] });
    await seedPap(pb.id, { id: "4", groupId: w.g.id, clientId: w.c1.id, date: null, state: "CORRECTIVE", causes: [{ category: "CORRECTIVE", origin: "STANDARD" }] });
    await seedPap(pb.id, { id: "5", groupId: w.g.id, clientId: w.c1.id, date: "2026-10-13", state: "UNKNOWN" });
    const a = row(await run(), "Atlas");
    const e = a.explain.PAP_CORRECTIVE;
    expect(e.numerator).toBe("2");
    expect(e.breakdown).toMatchObject({ estándar: "1", "origen cliente": "1", "total PAP del periodo": "4", "sin fecha": "1", "sin causa": "1" });
    expect(V(a, "PAP_CORRECTIVE").value).toBe("2"); // 2 × 100 / 100 usuarios·mes
    expect(V(a, "PAP_CORRECTIVE").status).toBe("PARCIAL"); // sin cobertura declarada, un PAP sin fecha y otro sin causa
  });
});

describe("backlog por observación y fotografías", () => {
  it("incidente de hace un año todavía open entra en el stock sin altas en el mes; question/task, solved/closed y desconocidos separados; edad 31 y umbral 30 → envejecido", async () => {
    const w = await world();
    const photo = await batchOf(admin.id, "zendesk-tickets", "2026-10-31");
    await declare(admin.id, photo.id, { statusScope: "ALL_STATUSES" });
    const mk = (id: string, o: Omit<Parameters<typeof seedTicket>[1], "id">) => seedTicket(photo.id, { id, org: "701", observedOn: "2026-10-31", ...o });
    await mk("B1", { type: "incident", status: "open", created: "2025-10-31" }); // hace un año
    await mk("B2", { type: "incident", status: "pending", created: "2026-10-01" }); // 30 días: NO envejecido (umbral 30)
    await mk("B3", { type: "incident", status: "hold", created: "2026-09-30" }); // 31 días: envejecido
    await mk("B4", { type: "problem", status: "new", created: "2026-08-01" });
    await mk("B5", { type: "question", status: "open", created: "2025-01-01" });
    await mk("B6", { type: "incident", status: "solved", created: "2025-01-01" });
    await mk("B7", { type: "incident", status: "closed", created: "2025-01-01" });
    const d = await saveDraft(admin.id, "QUALITY", { ...defaultQualityConfig(), incidents: { ...defaultQualityConfig().incidents, ageBands: [{ from: 0, to: 30 }, { from: 31, to: 90 }, { from: 91, to: null }], concerningDays: { incident: 30, problem: 60 } } }, { expectedVersion: null });
    await activateDraft(admin.id, "QUALITY", { expectedRevisionNo: 1, expectedDraftVersion: d.version, reason: "umbrales de prueba" });
    const v = await run();
    const a = row(v, "Atlas");
    expect(v.backlog).toMatchObject({ exact: true, observedOn: "2026-10-31" });
    const ex = a.explain.INCIDENTS_PROBLEMS.breakdown;
    expect(ex).toMatchObject({ "stock incidentes activos": "3", "stock incidentes envejecidos": "2", "stock problemas activos": "1", "stock problemas envejecidos": "1" }); // B1 (365) y B3 (31) envejecidos; B2 (30) no
    // 2 envejecidos / 100 usuarios al corte × 100 = 2 por 100 (stock, sin dividir por la exposición del mes)
    expect(a.evaluation.indicators.INCIDENTS_PROBLEMS.components?.find((c) => c.id === "backlog_incident")?.value).toBe("2");
    expect(a.evaluation.indicators.INCIDENTS_PROBLEMS.components?.find((c) => c.id === "backlog_problem")?.value).toBe("1");
    expect(w.g.id).toBeTruthy();
  });
  it("fotografía enero (open) y febrero (solved): cada fecha conserva su estado; sin foto del día no se inventa; una foto futura no se usa; anterior se muestra como observada en D, no como R", async () => {
    const w = await world();
    const jan = await batchOf(admin.id, "zendesk-tickets", "2026-01-31");
    const feb = await batchOf(admin.id, "zendesk-tickets", "2026-02-28");
    await declare(admin.id, jan.id, { statusScope: "UNRESOLVED_ONLY", from: "2026-01-01", to: "2026-01-31" });
    await declare(admin.id, feb.id, { statusScope: "UNRESOLVED_ONLY", from: "2026-02-01", to: "2026-02-28" });
    await seedTicket(jan.id, { id: "J1", org: "701", type: "incident", status: "open", created: "2025-12-01", observedOn: "2026-01-31", current: false });
    await seedTicket(feb.id, { id: "J1", org: "701", type: "incident", status: "solved", created: "2025-12-01", observedOn: "2026-02-28" });
    const cfg: QualityConfig = { ...defaultQualityConfig(), incidents: { ...defaultQualityConfig().incidents, concerningDays: { incident: 30, problem: 60 } } };
    const d = await saveDraft(admin.id, "QUALITY", cfg, { expectedVersion: null });
    await activateDraft(admin.id, "QUALITY", { expectedRevisionNo: 1, expectedDraftVersion: d.version, reason: "r" });
    const q = (date: string) => run({ fecha: date, modo: "CUTOFF" });
    const vj = await q("2026-01-31");
    expect(row(vj, "Atlas").explain.INCIDENTS_PROBLEMS.breakdown["stock incidentes activos"]).toBe("1"); // enero conserva open
    expect(row(vj, "Atlas").explain.INCIDENTS_PROBLEMS.breakdown["stock incidentes envejecidos"]).toBe("1"); // 61 días > 30
    const vf = await q("2026-02-28");
    expect(row(vf, "Atlas").explain.INCIDENTS_PROBLEMS.breakdown["stock incidentes activos"]).toBe("0"); // febrero: sale del stock (solved) sin probar fecha de resolución
    const vmid = await q("2026-02-15"); // sin foto del día: la de enero NO se dibuja como valor del 15/02
    expect(vmid.backlog.choice.kind).toBe("NONE");
    expect(vmid.backlog.earlierInfo).toMatchObject({ observedOn: "2026-01-31", gapDays: 15 });
    const before = await q("2026-01-15"); // solo hay fotos futuras: no se usan
    expect(before.backlog.choice.kind).toBe("NONE");
    expect(before.backlog.earlierInfo).toBeNull();
    expect(w.g.id).toBeTruthy();
  });
  it("política elegida «última anterior dentro de X días»: se usa como provisional y observada en D; el exceso del máximo no", async () => {
    await world();
    const jan = await batchOf(admin.id, "zendesk-tickets", "2026-01-31");
    await declare(admin.id, jan.id, { statusScope: "UNRESOLVED_ONLY", from: "2026-01-01", to: "2026-01-31" });
    const cfg: QualityConfig = { ...defaultQualityConfig(), snapshotPolicy: { mode: "LATEST_BEFORE", maxDays: 20 } };
    const d = await saveDraft(admin.id, "QUALITY", cfg, { expectedVersion: null });
    await activateDraft(admin.id, "QUALITY", { expectedRevisionNo: 1, expectedDraftVersion: d.version, reason: "política" });
    const near = await run({ fecha: "2026-02-15", modo: "CUTOFF" });
    expect(near.backlog).toMatchObject({ provisional: true, observedOn: "2026-01-31" });
    const far = await run({ fecha: "2026-03-15", modo: "CUTOFF" });
    expect(far.backlog.choice.kind).toBe("NONE");
  });
  it("una fotografía sin declaración de cobertura no es compatible (frescura/población desconocidas) y no se aprueba sola", async () => {
    const w = await world();
    await seedTicket(w.tb.id, { id: "U1", org: "701", type: "incident", status: "open", created: "2026-01-01", observedOn: "2026-10-31" });
    const v = await run();
    expect(v.backlog.choice.kind).toBe("NONE");
    expect(v.notes.join(" ")).not.toMatch(/undefined/);
  });
});

describe("cobertura y ceros honestos", () => {
  it("export completo declarado sin altas sustenta cero; una fila de otro cliente o la ausencia de declaración no lo sustentan; lotes revertidos no cuentan", async () => {
    const w = await world();
    await seedTicket(w.tb.id, { id: "O1", org: "703", type: "incident", created: "2026-10-05", observedOn: "2026-10-31" }); // fila de OTRO cliente (Boreal)
    const sin = row(await run(), "Atlas");
    expect(V(sin, "N3_ESCALATIONS")).toMatchObject({ value: null, status: "SIN_DATO", availability: "MISSING" }); // presente ≠ cobertura: el cero no es evidencia
    const dcl = await declare(admin.id, w.tb.id, { statusScope: "ALL_STATUSES" });
    expect(dcl.version).toBe(1);
    const con = row(await run(), "Atlas");
    expect(V(con, "N3_ESCALATIONS")).toMatchObject({ value: "0", availability: "AVAILABLE" }); // cero confirmado y sustentado
    await prisma.uploadBatch.update({ where: { id: w.tb.id }, data: { status: "REVERTED" } });
    expect(V(row(await run(), "Atlas"), "N3_ESCALATIONS").availability).toBe("MISSING"); // revertido: ya no prueba cobertura
  });
  it("una declaración «solo sin resolver» no sustenta el flujo de altas (sí el stock)", async () => {
    const w = await world();
    await declare(admin.id, w.tb.id, { statusScope: "UNRESOLVED_ONLY" });
    expect(V(row(await run(), "Atlas"), "N3_ESCALATIONS").availability).toBe("MISSING");
  });
  it("la declaración se versiona con control de edición obsoleta y exige motivo; Consulta no declara", async () => {
    const w = await world();
    await declare(admin.id, w.tb.id, { statusScope: "ALL_STATUSES" });
    await expect(declare(admin.id, w.tb.id, { statusScope: "ALL_STATUSES" })).rejects.toThrow(/modificado por otra persona/); // expectedVersion 0 ya no es la vigente
    const v2 = await declare(admin.id, w.tb.id, { statusScope: "ALL_STATUSES", population: "PARTIAL", expectedVersion: 1 });
    expect(v2.version).toBe(2);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "UploadCoverageDeclaration"`)).rejects.toThrow();
    const { declareCoverage } = await import("@/server/quality/coverage");
    await expect(declareCoverage(reader.id, { batchId: w.tb.id, population: "ALL_CLIENTS", statusScope: "ALL_STATUSES", coveredFrom: "2026-01-01", coveredTo: "2026-10-31", reason: "x", expectedVersion: 2 })).rejects.toThrow();
    // El lote original no se modifica: filas y extracción quedan igual.
    expect((await prisma.uploadBatch.findUniqueOrThrow({ where: { id: w.tb.id } })).declaredExtractionDate?.toISOString().slice(0, 10)).toBe("2026-10-31");
  });
});

describe("ámbitos, usuarios y consistencia", () => {
  it("usuarios propios del grupo (100), no la suma de hijos (120); el grupo no promedia a sus hijos; Cliente sin grupo conserva sus hechos", async () => {
    const w = await world();
    const solo = await addClient("Solitario", null);
    await prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: "799", searchValue: "799", clientId: solo.id } });
    await setUsers(admin.id, { clientId: solo.id }, 2026, Array(12).fill(10));
    await seedTicket(w.tb.id, { id: "S1", org: "799", type: "incident", created: "2026-10-05", observedOn: "2026-10-31" });
    const g = await run();
    expect(row(g, "Atlas").users).toMatchObject({ stock: 100, userMonths: "100" });
    const c = await run({ ambito: "client" });
    expect(row(c, "Atlas 1").users.stock).toBe(60);
    expect(row(c, "Solitario").explain.INCIDENTS_PROBLEMS.numerator).toBe("1");
    expect(row(c, "Solitario").parent).toBeNull();
    expect(w.c1.id).toBeTruthy();
  });
  it("mes parcial: exposición ponderada (10/31) y horas/eventos registrados sin prorratear", async () => {
    const w = await world();
    await seedTicket(w.tb.id, { id: "M1", org: "701", type: "incident", created: "2026-10-05", observedOn: "2026-10-31" });
    const v = await run({ fecha: "2026-10-10", modo: "CUTOFF" });
    const a = row(v, "Atlas");
    expect(v.period).toMatchObject({ partial: true, provisional: true, cut: "2026-10-10" });
    expect(Dec.parse(a.users.userMonths as string)?.toFixed(6)).toBe("32.258065"); // 100 × 10/31
    // 1 incidente × 100 / 32,258065 = 3,1 por 100 usuarios·mes
    expect(Number(V(a, "INCIDENTS_PROBLEMS").value)).toBeCloseTo(3.1, 5);
  });
  it("un mes futuro no inventa datos y un corte posterior a hoy se limita a hoy", async () => {
    await world();
    const f = await run({ fecha: "2026-12-15", modo: "CUTOFF" });
    expect(f.period.future).toBe(true);
    expect(f.rows.every((r) => Object.values(r.evaluation.indicators).every((i) => i.color === null))).toBe(true);
    const cur = await run({ fecha: "2026-11-30", modo: "FULL_MONTH" });
    expect(cur.period).toMatchObject({ cut: "2026-11-02", clamped: true, provisional: true });
  });
  it("la página y los parámetros retirados no mueven la cohorte ni las tarjetas; el orden es estable; los segmentadores solo recortan las filas", async () => {
    const w = await world();
    const all = await run();
    const page = await run({ pagina: "2", tam: "25" });
    expect(page.cards).toEqual(all.cards);
    const retired = await run({ color: "green", q: "zzz" }); // retirados: no filtran en secreto
    expect(retired.rows.map((r) => r.id)).toEqual(all.rows.map((r) => r.id));
    expect(retired.cards).toEqual(all.cards);
    await prisma.serviceTerm.create({ data: { attribute: "SUPPORT", value: "GOLD", groupId: w.g.id } });
    const gold = await run({ soporte: "GOLD" });
    expect(gold.rows.map((r) => r.name)).toEqual(["Atlas"]);
    expect(gold.rows[0].evaluation.indicators).toEqual(all.rows.find((r) => r.name === "Atlas")!.evaluation.indicators); // la cohorte de referencia no cambia
    expect((await run()).rows.map((r) => r.id)).toEqual(all.rows.map((r) => r.id));
  });
  it("lectura consistente: un cambio de Health entre la instantánea y una lectura posterior no se mezcla en la misma respuesta", async () => {
    const w = await world();
    const { snapshotPoint, setSnapshotTestHook } = await import("@/server/analytics/snapshot");
    void snapshotPoint;
    let changed = false;
    setSnapshotTestHook(async (point) => {
      if (point === "quality:after-tickets" && !changed) {
        changed = true;
        await saveHealthCell(admin.id, { scope: "group", entityId: w.g.id, year: 2026, month: 10, state: "POSITIVE", expectedVersion: 0 }, { now: NOW }); // otra conexión, mientras la lectura sigue abierta
      }
    });
    try {
      const during = row(await run(), "Atlas");
      expect(V(during, "HEALTH").availability).toBe("BLANK"); // la instantánea REPEATABLE READ no ve el cambio
    } finally {
      setSnapshotTestHook(null);
    }
    expect(V(row(await run(), "Atlas"), "HEALTH").availability).toBe("UNCALIBRATED"); // una lectura nueva sí lo ve
  });
});

describe("sello de datos", () => {
  it("nueva observación sin cambio de contenido, feedback editado y reversión cambian el sello", async () => {
    const w = await world();
    const stamp = async () => (await run()).stamp;
    const s0 = await stamp();
    await seedTicket(w.tb.id, { id: "T1", org: "701", type: "incident", created: "2026-10-05", observedOn: "2026-10-31" });
    const s1 = await stamp();
    expect(s1).not.toBe(s0);
    const b2 = await batchOf(admin.id, "zendesk-tickets", "2026-11-01");
    const tk = await prisma.zdTicket.findUniqueOrThrow({ where: { ticketId: tkey("T1") } });
    await prisma.zdTicketObservation.create({ data: { ticketId: tk.ticketId, batchId: b2.id, revisionId: tk.currentRevisionId as bigint, observedOn: new Date("2026-11-01T00:00:00Z"), observedKind: "DECLARED", receivedAt: new Date() } });
    const s2 = await stamp();
    expect(s2).not.toBe(s1); // misma revisión (mismo contenido), otra observación: el sello cambia
    await saveHealthCell(admin.id, { scope: "group", entityId: w.g.id, year: 2026, month: 10, state: "POSITIVE", expectedVersion: 0 }, { now: NOW });
    const s3 = await stamp();
    expect(s3).not.toBe(s2);
    await declare(admin.id, w.tb.id, { statusScope: "ALL_STATUSES" });
    expect(await stamp()).not.toBe(s3); // la cobertura declarada también invalida
  });
  it("sirve también dentro de una transacción propia (computeQuality con el cliente de la transacción)", async () => {
    await world();
    const v = await readSnapshot(admin.id, (tx) => computeQuality(tx, Q(), { now: NOW }));
    expect(v.rows).toHaveLength(2);
    void addTicket; void fakeBatch; void defaultPulseConfig;
  });
});

describe("referencias por percentiles de la métrica de Calidad", () => {
  it("la referencia se calcula con los valores de Calidad del ámbito (N y cortes), excluye no calculables y no se mueve por filtros de presentación ni por la página", async () => {
    const tb = await batchOf(admin.id, "zendesk-tickets", "2026-10-31");
    const gs = [];
    for (let i = 1; i <= 6; i++) {
      const g = await addGroup(`G${i}`);
      const c = await addClient(`C${i}`, g.id);
      await prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: `71${i}`, searchValue: `71${i}`, clientId: c.id } });
      if (i <= 5) await setUsers(admin.id, { groupId: g.id }, 2026, Array(12).fill(100)); // G6: usuarios sin informar → no calculable
      for (let n = 0; n < i - 1; n++) await seedTicket(tb.id, { id: `R${i}-${n}`, org: `71${i}`, type: "question", created: "2026-10-05", destinations: ["PMO_N3"], observedOn: "2026-10-31" });
      gs.push(g);
    }
    await declare(admin.id, tb.id, { statusScope: "ALL_STATUSES" });
    const cfg = defaultQualityConfig();
    cfg.indicators.N3_ESCALATIONS.rules.GRUPO = { ...cfg.indicators.N3_ESCALATIONS.rules.GRUPO, method: "PERCENTILE", a: "25", b: "75", referenceId: "todos", minSample: 5, calibration: "CALIBRADO" };
    const d = await saveDraft(admin.id, "QUALITY", cfg, { expectedVersion: null });
    await activateDraft(admin.id, "QUALITY", { expectedRevisionNo: 1, expectedDraftVersion: d.version, reason: "percentiles" });
    const v = await run();
    const color = (name: string) => V(row(v, name), "N3_ESCALATIONS");
    // valores por 100 usuarios·mes: G1=0, G2=1, G3=2, G4=3, G5=4 → P25 = 1, P75 = 3, N = 5 (G6 no calculable queda fuera)
    expect([color("G1").color, color("G2").color, color("G3").color, color("G4").color, color("G5").color]).toEqual(["green", "green", "yellow", "yellow", "red"]);
    expect(color("G3")).toMatchObject({ cuts: { a: "1", b: "3" }, n: 5 });
    expect(V(row(v, "G6"), "N3_ESCALATIONS").value).toBeNull();
    // filtros de presentación y página: mismos cortes y mismo N
    const filtered = await run({ q: "G5", pagina: "1", tam: "25" });
    expect(V(row(filtered, "G5"), "N3_ESCALATIONS")).toMatchObject({ color: "red", cuts: { a: "1", b: "3" }, n: 5 });
    // referencia inexistente en la revisión de Pulse: sin referencia, nunca verde
    const bad = { ...cfg, indicators: { ...cfg.indicators, N3_ESCALATIONS: { ...cfg.indicators.N3_ESCALATIONS, rules: { ...cfg.indicators.N3_ESCALATIONS.rules, GRUPO: { ...cfg.indicators.N3_ESCALATIONS.rules.GRUPO, referenceId: "no_existe" } } } } };
    const sim = await run({ sim: "" }, { configOverride: bad as QualityConfig });
    expect(V(row(sim, "G1"), "N3_ESCALATIONS")).toMatchObject({ color: null, status: "SIN_REFERENCIA" });
    expect(sim.config.simulated).toBe(true);
    expect((await run()).config.simulated).toBe(false); // la simulación no cambia lo activo
  });
});
