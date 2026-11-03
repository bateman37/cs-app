import { beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prisma } from "@/lib/db";
import { parseQualityQuery, qualityToParams, DEFAULT_QUALITY_QUERY } from "@/domain/quality-query";
import { defaultQualityConfig, INDICATOR_KEYS, type IndicatorKey } from "@/domain/quality-config";
import { KPI_ACCESS_NAME } from "@/domain/quality-kpi";
import { getQuality } from "@/server/quality/engine";
import { getKpiSection } from "@/server/quality/sections";
import { qualityCsv } from "@/server/quality/export";
import { getHealthMatrix, saveHealthCell } from "@/server/quality/health";
import { activateDraft, saveDraft, getActive } from "@/server/pulse/config";
import { resetDatabase, makeUsers } from "./helpers";
import { addClient, addGroup, setUsers, tkey } from "./economia-helpers";
import { batchOf, declare, seedBugLink, seedPap, seedTicket } from "./calidad-helpers";

/**
 * HOTFIX-02 §9: Calidad como «Resumen de clientes» con los seis KPI como navegación, sobre PostgreSQL real con datos SINTÉTICOS.
 * «Hoy» 02/11/2026; mes de análisis: octubre de 2026 completo. Los esperados se escriben a mano, no se calculan con el código bajo prueba.
 */
let admin: { id: string };
let reader: { id: string };
const NOW = new Date("2026-11-02T09:00:00Z");
beforeEach(async () => {
  await resetDatabase();
  ({ admin, reader } = await makeUsers());
});
const Q = (extra: Record<string, string> = {}) => parseQualityQuery({ fecha: "2026-10-31", modo: "FULL_MONTH", ...extra }, NOW).query;
const run = (extra: Record<string, string> = {}, o: Parameters<typeof getQuality>[2] = {}) => getQuality(admin.id, Q(extra), { now: NOW, ...o });
const term = (attribute: "SUPPORT" | "HOSTING", value: string, own: { clientId?: string; groupId?: string }) => prisma.serviceTerm.create({ data: { attribute, value, ...own } });
const names = (v: Awaited<ReturnType<typeof run>>) => v.rows.map((r) => r.name).sort();

/**
 * Atlas: c1 = GOLD + CLOUD, c2 = SILVER_RECURRENTE + OP (ningún Cliente tiene GOLD y OP a la vez).
 * Boreal: términos propios del Grupo GOLD + OP (su Cliente los hereda). Cobre: sin términos.
 */
async function world() {
  const g = await addGroup("Atlas");
  const g2 = await addGroup("Boreal");
  const g3 = await addGroup("Cobre");
  const c1 = await addClient("Atlas Norte", g.id);
  const c2 = await addClient("Atlas Sur", g.id);
  const b1 = await addClient("Boreal Central", g2.id);
  const k1 = await addClient("Cobre Uno", g3.id);
  for (const [org, cl] of [["701", c1], ["702", c2], ["703", b1], ["704", k1]] as const) await prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: org, searchValue: org, clientId: cl.id } });
  await term("SUPPORT", "GOLD", { clientId: c1.id }); await term("HOSTING", "CLOUD", { clientId: c1.id });
  await term("SUPPORT", "SILVER_RECURRENTE", { clientId: c2.id }); await term("HOSTING", "OP", { clientId: c2.id });
  await term("SUPPORT", "GOLD", { groupId: g2.id }); await term("HOSTING", "OP", { groupId: g2.id });
  await setUsers(admin.id, { groupId: g.id }, 2026, Array(12).fill(100));
  await setUsers(admin.id, { clientId: c1.id }, 2026, Array(12).fill(60));
  await setUsers(admin.id, { clientId: c2.id }, 2026, Array(12).fill(60));
  await setUsers(admin.id, { groupId: g2.id }, 2026, Array(12).fill(50));
  await setUsers(admin.id, { clientId: b1.id }, 2026, Array(12).fill(50));
  const tb = await batchOf(admin.id, "zendesk-tickets", "2026-10-31");
  return { g, g2, g3, c1, c2, b1, k1, tb };
}

describe("parámetros retirados: no filtran en secreto", () => {
  it("búsqueda BC, servicio, complejidad, producto, estado, cobertura, tamaño, color, alojamiento y vista se ignoran y se listan como obsoletos", async () => {
    const w = await world();
    await seedTicket(w.tb.id, { id: "T1", org: "701", type: "incident", created: "2026-10-05", observedOn: "2026-10-31" });
    const clean = await run();
    const old = { q: "Atl", servicio: "TOTAL", complejidad: "ALTA", producto: "Vincle", estado: "inactivos", cobertura: "parcial", tam: "25", color: "green", alojamiento: "CLOUD", revision: "3", pestana: "pap", bloques: "mes" };
    const parsed = parseQualityQuery({ fecha: "2026-10-31", modo: "FULL_MONTH", ...old }, NOW);
    expect(parsed.obsolete.sort()).toEqual(["alojamiento", "bloques", "cobertura", "color", "complejidad", "estado", "pestana", "producto", "q", "revision", "servicio", "tam"].sort());
    expect(parsed.query.base).toMatchObject({ q: "", support: [], hosting: [], complexity: [], product: "", status: "todos", coverage: "todas", service: "SOPORTE", pageSize: 100 });
    const dirty = await run(old);
    expect(dirty.rows.map((r) => r.id)).toEqual(clean.rows.map((r) => r.id));
    expect(dirty.filteredEntities).toBe(clean.filteredEntities);
    expect(dirty.rows.map((r) => r.evaluation)).toEqual(clean.rows.map((r) => r.evaluation));
    // Ninguno de esos parámetros vuelve a emitirse en un enlace.
    expect(qualityToParams(parsed.query, NOW)).toEqual({ fecha: "2026-10-31", modo: "FULL_MONTH" });
  });
  it("la dirección canónica solo contiene el contrato vigente y es estable al releerla", () => {
    const p = parseQualityQuery({ fecha: "2026-10-31", modo: "FULL_MONTH", soporte: "GOLD,PLATINUM", servidor: "OP", ambito: "client", kpi: "PAP_CORRECTIVE", sel: "abc", q: "x" }, NOW);
    const out = qualityToParams(p.query, NOW);
    expect(out).toMatchObject({ soporte: "GOLD,PLATINUM", servidor: "OP", ambito: "client", kpi: "PAP_CORRECTIVE", sel: "abc" });
    expect(Object.keys(out).sort()).toEqual(["ambito", "fecha", "kpi", "modo", "sel", "servidor", "soporte"]);
    const again = parseQualityQuery(out, NOW);
    expect(again.obsolete).toEqual([]);
    expect(again.invalid).toEqual([]);
    expect(qualityToParams(again.query, NOW)).toEqual(out);
  });
  it("valores no válidos de los segmentadores se descartan y se reportan; los enlaces antiguos vista=health llegan al apartado de Client Health", () => {
    const p = parseQualityQuery({ soporte: "GOLD,ZINC", servidor: "CLOUD,NUBE", vista: "health" }, NOW);
    expect(p.query.filters).toEqual({ soporte: ["GOLD"], servidor: ["CLOUD"] });
    expect(p.invalid).toEqual(expect.arrayContaining(["soporte", "servidor"]));
    expect(p.query.kpi).toBe("HEALTH");
    expect(parseQualityQuery({ vista: "backlog" }, NOW).query.kpi).toBe("INCIDENTS_PROBLEMS");
    expect(parseQualityQuery({ kpi: "OTRO" }, NOW).invalid).toContain("kpi");
  });
  it("mes (AAAA-MM) de la barra pequeña se convierte en fecha: mes completo el día 1; a fecha de hoy conserva el día de hoy o el equivalente acotado", () => {
    expect(parseQualityQuery({ mes: "2026-03", modo: "FULL_MONTH" }, NOW).query.base.date).toBe("2026-03-01");
    expect(parseQualityQuery({ mes: "2026-11" }, NOW).query.base.date).toBe("2026-11-02");
    expect(parseQualityQuery({ mes: "2026-02" }, NOW).query.base.date).toBe("2026-02-02");
    expect(parseQualityQuery({ mes: "2026-13" }, NOW).invalid).toContain("mes");
    expect(DEFAULT_QUALITY_QUERY(NOW).base.pageSize).toBe(100);
  });
});

describe("segmentadores Soporte y Servidor: OR dentro de cada uno, AND en el MISMO Cliente", () => {
  it("Grupo: GOLD + OP no incluye Atlas (el GOLD es de un hijo y el OP del otro); sí Boreal (términos del Grupo heredados)", async () => {
    await world();
    expect(names(await run())).toEqual(["Atlas", "Boreal", "Cobre"]);
    expect(names(await run({ soporte: "GOLD" }))).toEqual(["Atlas", "Boreal"]);
    expect(names(await run({ servidor: "OP" }))).toEqual(["Atlas", "Boreal"]);
    expect(names(await run({ soporte: "GOLD", servidor: "CLOUD" }))).toEqual(["Atlas"]);
    expect(names(await run({ soporte: "GOLD", servidor: "OP" }))).toEqual(["Boreal"]);
    expect(names(await run({ soporte: "GOLD,SILVER_RECURRENTE", servidor: "OP" }))).toEqual(["Atlas", "Boreal"]); // OR dentro de Soporte; Silver+OP en Atlas Sur
    expect(names(await run({ soporte: "PLATINUM" }))).toEqual([]);
  });
  it("Cliente: solo los Clientes que cumplen los dos filtros; un Cliente sin términos propios hereda los de su Grupo; sin dato no cumple un filtro activo", async () => {
    await world();
    expect(names(await run({ ambito: "client", soporte: "GOLD" }))).toEqual(["Atlas Norte", "Boreal Central"]);
    expect(names(await run({ ambito: "client", soporte: "GOLD", servidor: "OP" }))).toEqual(["Boreal Central"]);
    expect(names(await run({ ambito: "client", servidor: "CLOUD" }))).toEqual(["Atlas Norte"]);
    expect(names(await run({ ambito: "client" }))).toEqual(["Atlas Norte", "Atlas Sur", "Boreal Central", "Cobre Uno"]);
  });
  it("el filtro es de presentación: no cambia los valores de la entidad que queda ni sus referencias; los accesos resumen solo la selección", async () => {
    const w = await world();
    for (let i = 0; i < 3; i++) await seedTicket(w.tb.id, { id: `A${i}`, org: "701", type: "incident", created: "2026-10-05", observedOn: "2026-10-31" });
    await seedTicket(w.tb.id, { id: "B1", org: "703", type: "incident", created: "2026-10-06", observedOn: "2026-10-31" });
    const all = await run();
    const gold = await run({ soporte: "GOLD", servidor: "CLOUD" });
    expect(gold.rows.map((r) => r.name)).toEqual(["Atlas"]);
    expect(gold.rows[0].evaluation).toEqual(all.rows.find((r) => r.name === "Atlas")!.evaluation);
    expect(all.access.INCIDENTS_PROBLEMS.observedTotal).toBe("4"); // 3 de Atlas + 1 de Boreal
    expect(gold.access.INCIDENTS_PROBLEMS.observedTotal).toBe("3");
    expect(gold.selection).toEqual([w.g.id]);
  });
  it("el CSV de la cartera coincide con la pantalla: mismas entidades de TODO el conjunto filtrado, con el filtro registrado", async () => {
    await world();
    const v = await run({ soporte: "GOLD" }, { allRows: true });
    const csv = await qualityCsv(admin.id, Q({ soporte: "GOLD", pagina: "2" }), "cartera", { now: NOW });
    expect(csv.rows).toBe(v.rows.length);
    expect(csv.rows).toBe(2);
    expect(csv.body).toContain("Atlas");
    expect(csv.body).toContain("Boreal");
    expect(csv.body).not.toContain("Cobre");
    expect(csv.body).toContain("filtro_soporte");
    const health = await qualityCsv(admin.id, Q({ soporte: "GOLD", servidor: "OP" }), "health", { now: NOW });
    expect(health.rows).toBe(1); // solo Boreal en la matriz exportada
    expect(health.body).toContain("Boreal");
    expect(health.body).not.toContain("Atlas");
  });
});

describe("estado de los accesos: ni la ausencia ni la falta de calibración dan verde", () => {
  it("sin calibrar y sin datos: ningún acceso es verde y las magnitudes observadas siguen visibles", async () => {
    const w = await world();
    for (let i = 0; i < 5; i++) await seedTicket(w.tb.id, { id: `A${i}`, org: "701", type: "incident", created: "2026-10-05", observedOn: "2026-10-31", destinations: i < 2 ? ["PMO_N3"] : [] });
    const v = await run();
    for (const k of INDICATOR_KEYS) expect(["uncalibrated", "nodata"]).toContain(v.access[k].state);
    expect(v.access.N3_ESCALATIONS.observedTotal).toBe("2"); // magnitud observada sin declaración de cobertura
    expect(v.access.INCIDENTS_PROBLEMS.observedTotal).toBe("5");
    const a = v.rows.find((r) => r.name === "Atlas")!;
    for (const k of INDICATOR_KEYS) expect(a.evaluation.indicators[k].color).toBeNull();
    expect(a.evaluation.global.color).toBeNull();
    expect(a.explain.N3_ESCALATIONS.observed).toBe("2");
  });
  it("null, cero confirmado y parcial son distintos: sin cobertura un cero no se sustenta; con cobertura declarada es cero confirmado", async () => {
    const w = await world();
    const before = await run();
    const b0 = before.rows.find((r) => r.name === "Boreal")!; // 50 usuarios, ningún ticket N3
    expect(b0.evaluation.indicators.N3_ESCALATIONS).toMatchObject({ value: null, status: "SIN_DATO" }); // sin cobertura no hay evidencia de cero
    expect(b0.explain.N3_ESCALATIONS.observed).toBe("0");
    await seedTicket(w.tb.id, { id: "N1", org: "701", type: "incident", created: "2026-10-05", observedOn: "2026-10-31", destinations: ["IT_N3"] });
    const partial = (await run()).rows.find((r) => r.name === "Atlas")!;
    expect(partial.evaluation.indicators.N3_ESCALATIONS).toMatchObject({ status: "PARCIAL", availability: "MISSING" });
    expect(partial.evaluation.indicators.N3_ESCALATIONS.color).toBeNull();
    await declare(admin.id, w.tb.id, { statusScope: "ALL_STATUSES", from: "2026-01-01", to: "2026-10-31" });
    const after = await run();
    expect(after.rows.find((r) => r.name === "Boreal")!.evaluation.indicators.N3_ESCALATIONS).toMatchObject({ value: "0", availability: "AVAILABLE" }); // cero confirmado
    expect(after.rows.find((r) => r.name === "Atlas")!.evaluation.indicators.N3_ESCALATIONS.status).not.toBe("PARCIAL");
  });
  it("Client Health sin feedback redistribuye a cinco al 20 %; un técnico sin dato conserva su peso (no se redistribuye)", async () => {
    await world();
    const v = await run();
    const w = v.rows.find((r) => r.name === "Atlas")!.evaluation.weights!;
    expect(w.percent.HEALTH).toBe("0");
    for (const k of INDICATOR_KEYS.filter((x) => x !== "HEALTH")) expect(w.percent[k]).toBe("20");
    // Dedicación sin dato ni selección de perfiles: sigue pesando 20 y se reporta como sin cubrir.
    expect(v.rows[0].evaluation.indicators.DEDICATION.availability).toBe("MISSING");
    expect(w.uncovered.some((u) => u.key === "DEDICATION")).toBe(true);
    await saveHealthCell(admin.id, { scope: "group", entityId: v.rows[0].id, year: 2026, month: 10, state: "POSITIVE", expectedVersion: 0 }, { now: NOW });
    const withHealth = (await run()).rows.find((r) => r.id === v.rows[0].id)!.evaluation.weights!;
    for (const k of INDICATOR_KEYS) expect(Number(withHealth.percent[k])).toBeCloseTo(100 / 6, 10);
  });
  it("Client Health: verde solo con el mapeo confirmado y todo lo que tiene dato en verde; sin mapeo es «sin calibrar»", async () => {
    const w = await world();
    for (const g of [w.g, w.g2]) await saveHealthCell(admin.id, { scope: "group", entityId: g.id, year: 2026, month: 10, state: "POSITIVE", expectedVersion: 0 }, { now: NOW });
    const before = await run();
    expect(before.access.HEALTH.state).toBe("uncalibrated");
    expect(before.access.HEALTH.health).toEqual({ positive: 2, mixed: 0, negative: 0, blank: 1 });
    const cfg = defaultQualityConfig();
    cfg.health.confirmed = true;
    const d = await saveDraft(admin.id, "QUALITY", cfg, { expectedVersion: null });
    await activateDraft(admin.id, "QUALITY", { expectedRevisionNo: (await getActive(prisma, "QUALITY")).revisionNo, expectedDraftVersion: d.version, reason: "mapeo de la prueba" });
    const after = await run();
    expect(after.access.HEALTH).toMatchObject({ state: "green", green: 2 });
    expect(after.access.DEDICATION.state).not.toBe("green");
    await saveHealthCell(admin.id, { scope: "group", entityId: w.g3.id, year: 2026, month: 10, state: "NEGATIVE", expectedVersion: 0 }, { now: NOW });
    expect((await run()).access.HEALTH).toMatchObject({ state: "red", red: 1, green: 2 });
  });
});

describe("apartados: datos de la selección y del objeto, conciliados con el resumen", () => {
  it("Escalados a N3: tickets únicos (PMO+IT cuentan uno), cantidades por mes de creación y lista igual al conteo; el objeto solo ve lo suyo", async () => {
    const w = await world();
    await seedTicket(w.tb.id, { id: "N1", org: "701", type: "incident", created: "2026-10-05", observedOn: "2026-10-31", destinations: ["PMO_N3", "IT_N3"] });
    await seedTicket(w.tb.id, { id: "N2", org: "701", type: "incident", created: "2026-10-08", observedOn: "2026-10-31", destinations: ["IT_N3"] });
    await seedTicket(w.tb.id, { id: "N3", org: "703", type: "incident", created: "2026-09-08", observedOn: "2026-10-31", destinations: ["PMO_N3"] });
    await seedTicket(w.tb.id, { id: "X1", org: "703", type: "incident", created: "2026-10-09", observedOn: "2026-10-31" });
    const all = await getKpiSection(admin.id, Q(), "N3_ESCALATIONS", NOW);
    if (all.kind !== "N3_ESCALATIONS") throw new Error("tipo");
    const oct = all.data.monthly.find((m) => m.month === 10)!;
    expect(oct).toMatchObject({ total: 3, n3: 2, n3pmo: 1, n3it: 2 }); // N1 una vez aunque tenga los dos tags
    expect(all.data.monthly.find((m) => m.month === 9)).toMatchObject({ n3: 1 });
    expect(all.data.cum.n3).toBe(3);
    expect(all.list.total).toBe(2);
    expect(all.list.rows.map((r) => r.ticketId).sort()).toEqual([tkey("N1"), tkey("N2")].sort());
    expect(all.list.rows.find((r) => r.ticketId === tkey("N1"))!.destinations.sort()).toEqual(["IT_N3", "PMO_N3"]);
    const one = await getKpiSection(admin.id, Q({ sel: w.g2.id }), "N3_ESCALATIONS", NOW);
    if (one.kind !== "N3_ESCALATIONS") throw new Error("tipo");
    expect(one.data.entities).toBe(1);
    expect(one.data.cum.n3).toBe(1); // solo N3 de Boreal (septiembre)
    expect(one.list.total).toBe(0);
    // Concilia con el resumen: el numerador del indicador de Atlas es el de su apartado.
    const atlas = await getKpiSection(admin.id, Q({ sel: w.g.id }), "N3_ESCALATIONS", NOW);
    if (atlas.kind !== "N3_ESCALATIONS") throw new Error("tipo");
    expect(atlas.data.monthly.find((m) => m.month === 10)!.n3).toBe(Number((await run()).rows.find((r) => r.name === "Atlas")!.explain.N3_ESCALATIONS.numerator));
  });
  it("selección: los apartados siguen los segmentadores y la tasa solo usa entidades con usuarios informados", async () => {
    const w = await world();
    await seedTicket(w.tb.id, { id: "N1", org: "701", type: "incident", created: "2026-10-05", observedOn: "2026-10-31", destinations: ["PMO_N3"] });
    await seedTicket(w.tb.id, { id: "N4", org: "704", type: "incident", created: "2026-10-05", observedOn: "2026-10-31", destinations: ["PMO_N3"] }); // Cobre: sin usuarios
    const s = await getKpiSection(admin.id, Q(), "N3_ESCALATIONS", NOW);
    if (s.kind !== "N3_ESCALATIONS") throw new Error("tipo");
    expect(s.data.entities).toBe(3);
    expect(s.data.monthly.find((m) => m.month === 10)!.n3).toBe(2); // se cuentan los dos
    expect(s.data.usersMissing).toBe(1); // Cobre sin usuarios del mes
    expect(s.data.months.find((m) => m.month === 10)).toMatchObject({ users: 150, usersKnown: 2 });
    // 1 N3 de las entidades con usuarios ÷ 150 usuarios·mes × 100
    expect(Number(s.data.monthly.find((m) => m.month === 10)!.rate.n3)).toBeCloseTo(100 / 150, 6);
    const filtered = await getKpiSection(admin.id, Q({ soporte: "GOLD", servidor: "CLOUD" }), "N3_ESCALATIONS", NOW);
    if (filtered.kind !== "N3_ESCALATIONS") throw new Error("tipo");
    expect(filtered.data.entities).toBe(1);
    expect(filtered.list.total).toBe(1);
  });
  it("PAP correctivos: PAP único aunque tenga varias causas, Petición cliente aparte, producción por mes y comparación con el año anterior", async () => {
    const w = await world();
    const pb = await batchOf(admin.id, "pap");
    await seedPap(pb.id, { id: "1", groupId: w.g.id, clientId: w.c1.id, date: "2026-10-10", state: "CORRECTIVE", causes: [{ category: "CORRECTIVE", origin: "STANDARD" }, { category: "CORRECTIVE", origin: "CONFIG_DATA" }, { category: "CLIENT_REQUEST" }] });
    await seedPap(pb.id, { id: "2", groupId: w.g.id, clientId: w.c1.id, date: "2026-10-11", state: "NON_CORRECTIVE", causes: [{ category: "CLIENT_REQUEST" }] });
    await seedPap(pb.id, { id: "3", groupId: w.g.id, clientId: w.c1.id, date: "2025-10-11", state: "CORRECTIVE", causes: [{ category: "CORRECTIVE", origin: "STANDARD" }] });
    await seedPap(pb.id, { id: "4", groupId: w.g.id, clientId: w.c1.id, date: null, state: "UNKNOWN", causes: [] });
    const s = await getKpiSection(admin.id, Q({ sel: w.g.id }), "PAP_CORRECTIVE", NOW);
    if (s.kind !== "PAP_CORRECTIVE") throw new Error("tipo");
    expect(s.data.monthly.find((m) => m.month === 10)).toMatchObject({ total: 2, corrective: 1, standard: 1, project: 1, clientRequest: 2, previousYear: { total: 1, corrective: 1 } });
    expect(s.data.noDate).toBe(1);
    expect(s.list.total).toBe(2); // una fila por PAP, no por causa
    expect(s.list.rows.map((r) => r.papId).sort()).toEqual(["1", "2"]);
    expect(Number((await run()).rows.find((r) => r.name === "Atlas")!.explain.PAP_CORRECTIVE.numerator)).toBe(s.data.monthly.find((m) => m.month === 10)!.corrective);
  });
  it("Bugs y afectaciones: unión sin duplicar (causa estándar ∪ vínculo a Bug_), solo Bug_ cuenta; contexto VFS/VSW aparte", async () => {
    const w = await world();
    const { STANDARD_CAUSE } = await import("@/domain/zendesk");
    await seedTicket(w.tb.id, { id: "P1", org: "701", type: "problem", created: "2026-10-05", observedOn: "2026-10-31", cause: STANDARD_CAUSE });
    await seedTicket(w.tb.id, { id: "P2", org: "701", type: "problem", created: "2026-10-06", observedOn: "2026-10-31" });
    await seedTicket(w.tb.id, { id: "P3", org: "701", type: "problem", created: "2026-10-07", observedOn: "2026-10-31" });
    await seedTicket(w.tb.id, { id: "I1", org: "701", type: "incident", created: "2026-10-07", observedOn: "2026-10-31", cause: STANDARD_CAUSE });
    await seedBugLink(w.tb.id, { bugId: "100", ticket: "P1" }); // también por causa: cuenta una vez
    await seedBugLink(w.tb.id, { bugId: "101", ticket: "P2" });
    await seedBugLink(w.tb.id, { bugId: "102", ticket: "P3", isBug: false }); // un Work Item que no es Bug_: no cuenta
    const s = await getKpiSection(admin.id, Q({ sel: w.g.id }), "BUGS_STANDARD", NOW);
    if (s.kind !== "BUGS_STANDARD") throw new Error("tipo");
    expect(s.data.monthly.find((m) => m.month === 10)).toMatchObject({ s: 1, b: 2, both: 1, union: 2 });
    expect(s.list.rows.map((r) => r.ticketId).sort()).toEqual([tkey("P1"), tkey("P2")].sort());
    expect(s.list.rows.find((r) => r.ticketId === tkey("P1"))).toMatchObject({ viaCause: true, viaLink: true });
    expect(s.list.rows.find((r) => r.ticketId === tkey("P2"))).toMatchObject({ viaCause: false, viaLink: true });
    expect(s.openBugs.rows.every((r) => r.category !== "TERMINAL")).toBe(true);
    expect(Number((await run()).rows.find((r) => r.name === "Atlas")!.explain.BUGS_STANDARD.numerator)).toBe(2);
  });
  it("Client Health: la matriz sigue la selección y el objeto; la edición solo la ofrece el servicio al Administrador (Consulta no escribe)", async () => {
    const w = await world();
    const sel = await run({ soporte: "GOLD", servidor: "OP" });
    const m = await getHealthMatrix(admin.id, { scope: "group", year: 2026, q: "", page: 1, pageSize: 50, filters: sel.query.filters, cut: sel.period.cut });
    expect(m.rows.map((r) => r.name)).toEqual(["Boreal"]);
    const one = await getHealthMatrix(admin.id, { scope: "group", year: 2026, q: "", page: 1, pageSize: 50, ids: [w.g.id] });
    expect(one.rows.map((r) => r.name)).toEqual(["Atlas"]);
    expect(one.canEdit).toBe(true);
    expect((await getHealthMatrix(reader.id, { scope: "group", year: 2026, q: "", page: 1, pageSize: 50 })).canEdit).toBe(false);
    await expect(saveHealthCell(reader.id, { scope: "group", entityId: w.g.id, year: 2026, month: 10, state: "POSITIVE", expectedVersion: 0 }, { now: NOW })).rejects.toThrow();
  });
});

describe("navegación: cada acceso, cabecera y celda enlaza al KPI y al objeto correctos conservando el contexto", () => {
  it("accesos → apartado de la selección; cabeceras → mismo apartado; celdas → detalle del indicador de ESE objeto; todo con periodo, nivel y segmentadores", async () => {
    const w = await world();
    await seedTicket(w.tb.id, { id: "N1", org: "701", type: "incident", created: "2026-10-05", observedOn: "2026-10-31", destinations: ["PMO_N3"] });
    const q = Q({ ambito: "client", soporte: "GOLD", orden: "global", dir: "desc" });
    const v = await getQuality(admin.id, q, { now: NOW });
    const { KpiAccessGrid } = await import("@/app/(app)/calidad/access");
    const { Portfolio } = await import("@/app/(app)/calidad/table");
    const grid = renderToStaticMarkup(createElement(KpiAccessGrid, { access: v.access, q, basePath: "/calidad" }));
    const hrefs = [...grid.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
    expect(hrefs).toHaveLength(6);
    INDICATOR_KEYS.forEach((k, i) => {
      const p = new URL(hrefs[i], "http://x").searchParams;
      expect(p.get("kpi")).toBe(k);
      expect(p.get("sel")).toBeNull();
      expect(p.get("soporte")).toBe("GOLD");
      expect(p.get("ambito")).toBe("client");
      expect(p.get("fecha")).toBe("2026-10-31");
      expect(p.get("modo")).toBe("FULL_MONTH");
    });
    expect(grid).toContain("Client Health");
    expect(grid).toContain("Escalados a N3");
    expect(grid).toContain("Bugs y afectaciones");
    for (const k of INDICATOR_KEYS) expect(grid).toContain(KPI_ACCESS_NAME[k]);
    const table = renderToStaticMarkup(createElement(Portfolio, { rows: v.rows, q, basePath: "/calidad" }));
    const attr = (tag: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1]?.replace(/&amp;/g, "&").replace(/&quot;/g, '"') ?? "";
    const links = [...table.matchAll(/<a\b[^>]*>/g)].map((m) => ({ href: attr(m[0], "href"), label: attr(m[0], "aria-label") }));
    const heads = links.filter((l) => l.label.startsWith("Abrir el apartado"));
    expect(heads.map((l) => /apartado (.+) para la selección/.exec(l.label)![1])).toEqual(INDICATOR_KEYS.map((k) => KPI_ACCESS_NAME[k]));
    heads.forEach((l, i) => { const p = new URL(l.href, "http://x").searchParams; expect(p.get("kpi")).toBe(INDICATOR_KEYS[i]); expect(p.get("sel")).toBeNull(); expect(p.get("soporte")).toBe("GOLD"); });
    // Cada fila: la ficha (nombre y global) y las seis celdas apuntan a su propio objeto; cada celda abre SU indicador.
    for (const r of v.rows) {
      const own = links.map((l) => new URL(l.href, "http://x").searchParams).filter((p) => p.get("sel") === r.id);
      expect(own.map((p) => p.get("kpi") ?? "").sort()).toEqual(["", "", ...INDICATOR_KEYS].sort());
      for (const p of own) { expect(p.get("ambito")).toBe("client"); expect(p.get("soporte")).toBe("GOLD"); expect(p.get("fecha")).toBe("2026-10-31"); expect(p.get("orden")).toBe("global"); }
    }
    for (const l of links.filter((x) => x.label.endsWith("Abrir detalle"))) expect(l.label).toMatch(/Client Health|Dedicación|PAP correctivos|Escalados a N3|Incidentes y problemas|Bugs y afectaciones/);
    expect(table).toContain("Abrir detalle");
    expect(w.c1.id).toBeTruthy();
  });
});

describe("kpi y sel conservan nivel de objeto", () => {
  it("un Cliente abierto con kpi solo ve sus datos aunque pertenezca a un Grupo con más Clientes; no se reparte a hermanos", async () => {
    const w = await world();
    await seedTicket(w.tb.id, { id: "N1", org: "701", type: "incident", created: "2026-10-05", observedOn: "2026-10-31", destinations: ["PMO_N3"] });
    await seedTicket(w.tb.id, { id: "N2", org: "702", type: "incident", created: "2026-10-05", observedOn: "2026-10-31", destinations: ["PMO_N3"] });
    const c1 = await getKpiSection(admin.id, Q({ ambito: "client", sel: w.c1.id }), "N3_ESCALATIONS", NOW);
    const grp = await getKpiSection(admin.id, Q({ sel: w.g.id }), "N3_ESCALATIONS", NOW);
    if (c1.kind !== "N3_ESCALATIONS" || grp.kind !== "N3_ESCALATIONS") throw new Error("tipo");
    expect(c1.list.rows.map((r) => r.ticketId)).toEqual([tkey("N1")]);
    expect(grp.list.rows.map((r) => r.ticketId).sort()).toEqual([tkey("N1"), tkey("N2")].sort());
    void (await getActive(prisma, "QUALITY"));
    expect((["HEALTH", "DEDICATION", "PAP_CORRECTIVE", "N3_ESCALATIONS", "INCIDENTS_PROBLEMS", "BUGS_STANDARD"] as IndicatorKey[]).length).toBe(6);
  });
});
