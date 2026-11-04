import { beforeEach, describe, expect, it } from "vitest";
import { parse } from "csv-parse/sync";
import { prisma } from "@/lib/db";
import { Dec } from "@/domain/finance";
import { parseAnalysisQuery, type AnalysisQuery } from "@/domain/analytics-query";
import { alignMonths, annualPoints, cell, cellsOf, compareValues, cumulativeCells, MEASURES, trimEmptyYears, type MonthSrc } from "@/domain/ficha-series";
import { equipoTable, fichaProfile, problemTable, ticketTable, type DedMap } from "@/domain/ficha-dedicacion";
import { runEconomics } from "@/server/economics/engine";
import { getFicha } from "@/server/analytics/ficha";
import { hoursDetail } from "@/server/analytics/detail";
import { fichaCsv } from "@/server/analytics/export";
import { resetDatabase, makeUsers } from "./helpers";
import { addClient, addGroup, addTicket, addZd, fakeBatch, seedFinance, serviceAssignment } from "./economia-helpers";

/**
 * Ficha panorámica de Análisis Cliente (HOTFIX-02 §8): comparación interanual mes a mes, febrero bisiesto, mes parcial equivalente,
 * base cero, ausentes, CUM Σ/Σ, años disponibles y cuadros de dedicación que concilian con el detalle. Esperados escritos a mano
 * (independientes de los resolvers); PostgreSQL real aislado.
 */
const D = (v: string) => Dec.parse(v) as Dec;
const Q = (extra: Record<string, string> = {}): AnalysisQuery => parseAnalysisQuery({ ...extra }, new Date("2026-11-03T10:00:00Z")).query;

// ---------------------------------------------------------------- Dominio puro

describe("comparación interanual (dominio)", () => {
  it("variación = (actual − anterior) / abs(anterior); anterior negativo usa su valor absoluto", () => {
    expect(compareValues("150", "100", "magnitude")).toEqual({ state: "OK", diff: "50", pct: "0.5" });
    expect(compareValues("50", "100", "magnitude")).toEqual({ state: "OK", diff: "-50", pct: "-0.5" });
    expect(compareValues("-50", "-100", "magnitude")).toEqual({ state: "OK", diff: "50", pct: "0.5" }); // mejora desde un valor negativo: sube
    expect(compareValues("-150", "-100", "magnitude")).toEqual({ state: "OK", diff: "-50", pct: "-0.5" });
  });
  it("base cero o ausente se indica: ni infinito ni 0 %", () => {
    expect(compareValues("10", "0", "magnitude")).toEqual({ state: "BASE_CERO", diff: "10", pct: null });
    expect(compareValues("0", "0", "magnitude")).toEqual({ state: "BASE_CERO", diff: "0", pct: null });
    expect(compareValues("10", null, "magnitude")).toEqual({ state: "SIN_ANTERIOR", diff: null, pct: null });
    expect(compareValues(null, "10", "magnitude")).toEqual({ state: "SIN_ACTUAL", diff: null, pct: null });
    expect(compareValues(null, null, "magnitude").state).toBe("SIN_DATOS");
  });
  it("las fracciones se comparan en puntos porcentuales, sin variación relativa", () => {
    expect(compareValues("0.125", "0.1", "fraction")).toEqual({ state: "OK", diff: "2.5", pct: null });
    expect(compareValues("-0.05", "0.1", "fraction")).toEqual({ state: "OK", diff: "-15", pct: null });
    expect(compareValues("0.1", "0", "fraction").pct).toBeNull(); // un 0 % anterior es un dato válido en pp
  });
  it("los meses posteriores al corte son futuros: vacíos (null), nunca ceros; el parcial se marca", () => {
    const src = (label: string, partial = false): MonthSrc => ({
      label, from: `${label}-01`, to: `${label}-15`, provisional: partial, partial,
      revenue: { value: "1000", reason: null }, hours: { inPerimeter: "2", perimeterMinutes: "120" },
      perDay: { value: "4000", reason: null }, deviationVsTarget: { value: "0.1", reason: null },
    });
    const cur = [src("2026-01"), src("2026-02"), src("2026-03", true)];
    const prev = [src("2025-01"), src("2025-02"), src("2025-03", true)];
    const rows = alignMonths(MEASURES.hours, 3, cellsOf("hours", cur), cellsOf("hours", prev), cur, prev);
    expect(rows).toHaveLength(12);
    expect(rows.slice(3).every((r) => r.future && r.cur === null && r.prev === null && r.cmp === null)).toBe(true);
    expect(rows[2]).toMatchObject({ partial: true, provisional: true, curTo: "2026-03-15", prevTo: "2025-03-15" });
    expect(rows[0].cmp).toEqual({ state: "OK", diff: "0", pct: "0" });
  });
  it("el CUM mensual es Σingresos / Σhoras × jornada, no la suma ni la media de ratios; se interrumpe sin ingreso conocido", () => {
    const m = (label: string, revenue: string | null, minutes: string, code: string | null = null): MonthSrc => ({
      label, from: `${label}-01`, to: `${label}-28`, provisional: false, partial: false,
      revenue: { value: revenue, reason: revenue === null ? "Sin ingreso." : null }, hours: { inPerimeter: (Number(minutes) / 60).toString(), perimeterMinutes: minutes },
      perDay: { value: null, reason: null, code }, deviationVsTarget: { value: null, reason: null },
    });
    // mes 1: 1000 € / 10 h → 800 €/jornada; mes 2: 1000 € / 40 h → 200 €/jornada; media de ratios 500; CUM Σ/Σ = 2000/50×8 = 320
    const cum = cumulativeCells([m("2026-01", "1000", "600"), m("2026-02", "1000", "2400"), m("2026-03", null, "60"), m("2026-04", "1000", "60")], D("8"));
    expect(cum[0].v).toBe("800");
    expect(cum[1].v).toBe("320");
    expect(cum[2].v).toBeNull(); // sin ingreso del mes 3: el acumulado queda interrumpido (no comparable)
    expect(cum[3].v).toBeNull();
    const partial = cumulativeCells([m("2026-01", "1000", "600", "PERIMETER_PARTIAL")], D("8"));
    expect(partial[0].v).toBeNull();
    expect(cumulativeCells([m("2026-01", "1000", "0")], D("8"))[0]).toMatchObject({ v: null });
  });
  it("años disponibles: se descartan los iniciales sin datos y el año del corte solo tiene CUM", () => {
    const p = (rev: string | null, h: string) => ({ to: "2026-06-30", revenue: { value: rev, reason: null }, hours: { inPerimeter: h }, perDay: { value: null, reason: null } });
    const pts = trimEmptyYears(annualPoints([{ year: 2023, full: p(null, "0"), cum: p(null, "0") }, { year: 2024, full: p("100", "5"), cum: p("50", "2") }], 2025, p("10", "1")));
    expect(pts.map((x) => x.year)).toEqual([2024, 2025]);
    expect(pts[1]).toMatchObject({ currentYear: true, full: null });
    expect(cell(null, "x")).toEqual({ v: null, reason: "x" });
  });
});

describe("cuadros de dedicación (dominio)", () => {
  const prof = (profile: string, i: string, o: string, u: string) => ({ profile, incidentMinutes: i, otherMinutes: o, unclassifiedMinutes: u, minutes: D(i).add(D(o)).add(D(u)).toString() });
  const per = (profiles: ReturnType<typeof prof>[], causes: { cause: string; cls: string; minutes: string }[] = []) => ({ totalMinutes: profiles.reduce((a, p) => a.add(D(p.minutes)), Dec.ZERO).toString(), profiles, causes });
  const d: DedMap = {
    cum: per(
      [prof("CS N1", "120", "60", "0"), prof("IT N3", "60", "0", "30"), prof("Plataforma N4", "0", "0", "30"), prof("PMO ANA", "0", "90", "0"), prof("Sin identificar", "0", "0", "60")],
      [{ cause: "incidente_estándar_plataforma", cls: "INCIDENTE_VINCLE", minutes: "120" }, { cause: "incidente_infraestructura", cls: "INCIDENTE_VINCLE", minutes: "60" }, { cause: "sistemas del cliente", cls: "OTRO_SOPORTE", minutes: "150" }],
    ),
    prevCum: per([prof("CS N1", "60", "0", "0")], [{ cause: "incidente_integración/procesos", cls: "INCIDENTE_VINCLE", minutes: "60" }]),
  };
  it("IT N3 y Plataforma N4 se presentan como IT y Plataforma; los seis perfiles fijos siempre aparecen y Sin identificar va al final", () => {
    expect(fichaProfile("IT N3")).toBe("IT");
    expect(fichaProfile("Plataforma N4")).toBe("Plataforma");
    expect(fichaProfile("PMO ANA")).toBe("PMO ANA");
    const t = equipoTable(d);
    expect(t.rows.map((r) => r.profile)).toEqual(["CS N1", "CS N2", "PMO ANA", "PMO DEV", "IT", "Plataforma", "Sin identificar"]);
    expect(t.rows.find((r) => r.profile === "IT")!.periods.cum).toEqual({ minutes: "90", hours: "1.5" });
    expect(t.total.cum.minutes).toBe("450");
    expect(t.rows.reduce((a, r) => a.add(D(r.periods.cum.minutes)), Dec.ZERO).toString()).toBe(t.total.cum.minutes); // filas concilian con el total
    expect(t.rows.find((r) => r.profile === "CS N2")!.share.cum).toBe("0"); // 0 sobre 450 = 0 %, con denominador
    expect(t.rows.find((r) => r.profile === "CS N2")!.share.month).toBeNull(); // sin horas en el mes: sin denominador, no 0 %
  });
  it("tipo de ticket: el total suma los tres tipos una vez; las filas de perfil son detalle con su % dentro del tipo", () => {
    const t = ticketTable(d);
    expect(t.groups.map((g) => [g.label, g.total.cum.minutes])).toEqual([["Incidente/Problema Vincle", "180"], ["Otro soporte", "150"], ["Causa pendiente", "120"]]);
    expect(t.total.cum.minutes).toBe("450");
    const inc = t.groups[0];
    expect(inc.profiles.map((p) => p.profile)).toEqual(["CS N1", "IT"]);
    expect(inc.profiles.reduce((a, p) => a.add(D(p.periods.cum.minutes)), Dec.ZERO).toString()).toBe(inc.total.cum.minutes);
    expect(inc.profiles[0].share.cum).toBe("0.66666666666666666667"); // 120 / 180
    expect(t.groups[2].profiles.map((p) => p.profile)).toEqual(["IT", "Plataforma", "Sin identificar"]);
  });
  it("tipo de problema Vincle: horas CUM, % sobre dedicadas y sobre objetivo; infraestructura solo si procede; sin objetivo → null", () => {
    const t = problemTable(d, "10");
    expect(t.rows.map((r) => [r.label, r.cum.hours])).toEqual([["Integración/Procesos", "0"], ["Configuración", "0"], ["Personalización", "0"], ["Estándar", "2"], ["Infraestructura CLOUD", "1"]]);
    expect(t.rows[3].shareOfDedicated).toBe("0.26666666666666666667"); // 120 / 450 minutos
    expect(t.rows[3].shareOfTarget).toBe("0.2"); // 2 h / 10 h
    expect(t.rows[0].prevCum.hours).toBe("1"); // CUM anterior comparable
    expect(t.total).toMatchObject({ cum: { minutes: "180" }, prevCum: { minutes: "60" } });
    expect(problemTable(d, null).rows[3].shareOfTarget).toBeNull();
    const noInfra = problemTable({ cum: per([prof("CS N1", "60", "0", "0")], [{ cause: "incidente_estándar_plataforma", cls: "INCIDENTE_VINCLE", minutes: "60" }]) }, null);
    expect(noInfra.omittedInfra).toBe(true);
    expect(noInfra.rows.map((r) => r.key)).not.toContain("infra");
  });
});

// ---------------------------------------------------------------- Servicio con PostgreSQL

let admin: { id: string };
let bid: string;
beforeEach(async () => {
  await resetDatabase();
  ({ admin } = await makeUsers());
  bid = (await fakeBatch(admin.id)).id;
});

async function support() {
  await serviceAssignment({ matchKind: "ENTORNO", matchValue: "soporte", service: "SOPORTE" });
  const t = await fakeBatch(admin.id);
  await addTicket(t.id, { ticketId: "S", entorno: "Soporte" });
}
const hours = (gid: string, date: string, h: number, extra: Partial<Parameters<typeof addZd>[0]> = {}) => addZd({ batchId: bid, date, minutes: h * 60, groupId: gid, ticketId: "S", ...extra });

describe("ficha: series interanuales", () => {
  it("febrero bisiesto: 29/02/2024 se compara con el fin de febrero 2023 (28/02); las horas posteriores al comparable no entran; marzo y siguientes son futuros", async () => {
    const g = await addGroup("G");
    await support();
    await seedFinance(admin.id, "SOPORTE", 2024, [{ groupId: g.id, income: "12000" }]);
    await seedFinance(admin.id, "SOPORTE", 2023, [{ groupId: g.id, income: "12000" }]);
    await hours(g.id, "2024-02-10", 4);
    await hours(g.id, "2024-02-29", 2); // solo existe en el bisiesto
    await hours(g.id, "2023-02-10", 3);
    await hours(g.id, "2023-02-28", 1);
    await hours(g.id, "2023-03-01", 9); // posterior al comparable
    const f = (await getFicha(admin.id, Q({ fecha: "2024-02-29", modo: "CUTOFF" }), { type: "group", id: g.id }))!;
    const h = f.series.rows.hours!;
    expect(h).toHaveLength(12);
    expect(h[1]).toMatchObject({ month: 2, partial: false, curTo: "2024-02-29", prevTo: "2023-02-28" });
    expect(h[1].cur!.v).toBe("6");
    expect(h[1].prev!.v).toBe("4");
    expect(h[1].cmp).toEqual({ state: "OK", diff: "2", pct: "0.5" });
    expect(h[2].future && h[2].cur === null && h[2].prev === null).toBe(true); // marzo: vacío, no cero
    expect(h.slice(2).every((r) => r.future)).toBe(true);
    expect(f.series.prevCumTo).toBe("2023-02-28");
  });

  it("mes parcial: 15/06/2026 se compara con el 15/06/2025; 20/06/2025 no entra; enero–mayo completos; hueco de enero en el año anterior = base cero", async () => {
    const g = await addGroup("G");
    await support();
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "12000" }]);
    await seedFinance(admin.id, "SOPORTE", 2025, [{ groupId: g.id, income: "12000" }]);
    await hours(g.id, "2026-01-10", 5);
    await hours(g.id, "2026-06-10", 4);
    await hours(g.id, "2025-06-10", 8);
    await hours(g.id, "2025-06-20", 16);
    const f = (await getFicha(admin.id, Q({ fecha: "2026-06-15", modo: "CUTOFF" }), { type: "group", id: g.id }))!;
    const h = f.series.rows.hours!;
    expect(h[5]).toMatchObject({ month: 6, partial: true, curTo: "2026-06-15", prevTo: "2025-06-15" });
    expect(h[5].cur!.v).toBe("4");
    expect(h[5].prev!.v).toBe("8");
    expect(h[5].cmp).toEqual({ state: "OK", diff: "-4", pct: "-0.5" });
    expect(h[0].prev!.v).toBe("0"); // enero 2025 sin horas: cero real (el motor lee el conjunto), la variación es base cero
    expect(h[0].cmp).toEqual({ state: "BASE_CERO", diff: "5", pct: null });
    expect(h.filter((r) => r.future)).toHaveLength(6);
    // el mes completo compara los meses enteros
    const full = (await getFicha(admin.id, Q({ fecha: "2026-06-15", modo: "FULL_MONTH" }), { type: "group", id: g.id }))!;
    expect(full.series.rows.hours![5]).toMatchObject({ partial: false, curTo: "2026-06-30", prevTo: "2025-06-30" });
    expect(full.series.rows.hours![5].prev!.v).toBe("24");
  });

  it("ausentes: sin ingreso 2025 la rentabilidad anterior es «—» con motivo y la variación SIN_ANTERIOR; nunca cero ni infinito", async () => {
    const g = await addGroup("G");
    await support();
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "12000" }]);
    await hours(g.id, "2026-03-05", 10);
    await hours(g.id, "2025-03-05", 10);
    const f = (await getFicha(admin.id, Q({ fecha: "2026-03-31", modo: "FULL_MONTH" }), { type: "group", id: g.id }))!;
    const r = f.series.rows.perDay![2];
    expect(r.cur!.v).toBe("800"); // 1000 € / 10 h × 8
    expect(r.prev).toMatchObject({ v: null });
    expect(r.prev!.reason).toMatch(/Falta el conjunto financiero/);
    expect(r.cmp).toMatchObject({ state: "SIN_ANTERIOR", diff: null, pct: null });
    expect(f.series.rows.revenue![2].prev!.v).toBeNull();
    // sin 2026 tampoco se inventa copiando 2025
    const noCurrent = (await getFicha(admin.id, Q({ fecha: "2027-03-31", modo: "FULL_MONTH" }), { type: "group", id: g.id }))!;
    expect(noCurrent.series.rows.revenue![2].cur!.v).toBeNull();
  });

  it("el CUM del último mes coincide con el del motor (Σ/Σ) y difiere de la media de los ratios mensuales", async () => {
    const g = await addGroup("G");
    await support();
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "12000" }]);
    await seedFinance(admin.id, "SOPORTE", 2025, [{ groupId: g.id, income: "12000" }]);
    await hours(g.id, "2026-01-10", 10); // 1000 € / 10 h × 8 = 800
    await hours(g.id, "2026-02-10", 40); // 1000 € / 40 h × 8 = 200
    await hours(g.id, "2025-01-10", 20);
    await hours(g.id, "2025-02-10", 20);
    const f = (await getFicha(admin.id, Q({ fecha: "2026-02-28", modo: "FULL_MONTH" }), { type: "group", id: g.id }))!;
    const per = f.series.rows.perDay!;
    expect(per[0].cur!.v).toBe("800");
    expect(per[1].cur!.v).toBe("200");
    const cum = f.series.rows.cumPerDay!;
    expect(cum[1].cur!.v).toBe("320"); // 2000 / 50 × 8; la media de ratios (500) o su suma (1000) serían erróneas
    expect(cum[1].cur!.v).toBe(f.entity.periods.cum.perDay.value); // mismo operador que el motor
    expect(cum[1].prev!.v).toBe("400"); // 2000 / 40 × 8
    expect(f.entity.periods.prevCum.perDay.value).toBe("400");
    expect(cum[1].cmp).toEqual({ state: "OK", diff: "-80", pct: "-0.2" });
  });

  it("el motor entrega el año completo y el CUM comparable de cada año disponible con las mismas fórmulas que una consulta directa", async () => {
    const g = await addGroup("G");
    await support();
    for (const y of [2023, 2024, 2025, 2026]) await seedFinance(admin.id, "SOPORTE", y, [{ groupId: g.id, income: String(12000 * (y - 2022)) }]);
    await hours(g.id, "2024-02-10", 10);
    await hours(g.id, "2024-09-10", 10);
    await hours(g.id, "2025-02-10", 20);
    await hours(g.id, "2026-02-10", 5);
    const f = (await getFicha(admin.id, Q({ fecha: "2026-03-31", modo: "FULL_MONTH" }), { type: "group", id: g.id }))!;
    expect(f.annual.map((p) => p.year)).toEqual([2023, 2024, 2025, 2026]);
    expect(f.annual[3]).toMatchObject({ currentYear: true, full: null });
    for (const y of [2024, 2025]) {
      const direct = await runEconomics(admin.id, { scope: { type: "groups", ids: [g.id] }, service: "SOPORTE", date: `${y}-12-31`, mode: "FULL_MONTH" });
      const p = f.annual.find((x) => x.year === y)!;
      expect(p.full!.revenue.v).toBe(direct.entities[0].periods.cum.revenue.value); // año completo
      expect(p.full!.hours.v).toBe(direct.entities[0].periods.cum.hours.inPerimeter);
      expect(p.full!.perDay.v).toBe(direct.entities[0].periods.cum.perDay.value);
      const cumDirect = await runEconomics(admin.id, { scope: { type: "groups", ids: [g.id] }, service: "SOPORTE", date: `${y}-03-31`, mode: "FULL_MONTH" });
      expect(p.cum!.revenue.v).toBe(cumDirect.entities[0].periods.cum.revenue.value); // CUM comparable del mismo corte
      expect(p.cum!.perDay.v).toBe(cumDirect.entities[0].periods.cum.perDay.value);
    }
    expect(f.annual[1].full!.hours.v).toBe("20");
    expect(f.annual[1].cum!.hours.v).toBe("10"); // el CUM comparable no incluye septiembre
    expect(f.annual[3].cum!.revenue.v).toBe(f.entity.periods.cum.revenue.value);
  });
});

describe("ficha: Grupo, Cliente y contexto", () => {
  it("un Cliente muestra sus horas propias y la serie económica del Grupo identificada como contexto; no se le atribuye ingreso propio", async () => {
    const A = await addGroup("Alfa");
    const A1 = await addClient("Alfa 1", A.id);
    const A2 = await addClient("Alfa 2", A.id);
    await support();
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: A.id, income: "12000" }]);
    await hours(A.id, "2026-03-05", 10, { clientId: A1.id });
    await hours(A.id, "2026-03-06", 30, { clientId: A2.id });
    const g = (await getFicha(admin.id, Q({ fecha: "2026-03-31", modo: "FULL_MONTH" }), { type: "group", id: A.id }))!;
    const c = (await getFicha(admin.id, Q({ fecha: "2026-03-31", modo: "FULL_MONTH" }), { type: "client", id: A1.id }))!;
    expect(g.series.economicOwner).toMatchObject({ kind: "own", name: "Alfa" });
    expect(c.series.economicOwner).toMatchObject({ kind: "group", name: "Alfa" });
    expect(c.series.rows.hours![2].cur!.v).toBe("10"); // horas propias del Cliente
    expect(g.series.rows.hours![2].cur!.v).toBe("40");
    expect(c.series.rows.perDay![2].cur!.v).toBe(g.series.rows.perDay![2].cur!.v); // contexto del Grupo (identificado), no cifra propia
    expect(c.entity.periods.month.revenue.value).toBeNull();
    expect(c.entity.periods.month.perDay).toMatchObject({ value: null, code: "NOT_GROUP_LEVEL" });
    expect(c.annual.at(-1)!.cum!.revenue.v).toBe("3000"); // ingreso del Grupo (ene–mar), contexto
  });

  it("un Cliente sin Grupo no inventa una serie económica: motivo explícito", async () => {
    const solo = await addClient("Solo SL", null);
    await support();
    await addZd({ batchId: bid, date: "2026-03-05", minutes: 600, clientId: solo.id, ticketId: "S" });
    const c = (await getFicha(admin.id, Q({ fecha: "2026-03-31", modo: "FULL_MONTH" }), { type: "client", id: solo.id }))!;
    expect(c.series.economicOwner).toBeNull();
    expect(c.series.rows.perDay).toBeNull();
    expect(c.series.missing.perDay).toMatch(/Sin Grupo Cliente/);
    expect(c.series.rows.hours![2].cur!.v).toBe("10");
    expect(c.annual).toEqual([]);
  });
});

describe("ficha: cuadros de dedicación y detalle que concilia", () => {
  it("los tres cuadros concilian con la cifra de horas, con la suma de los meses y con el detalle de horas", async () => {
    const G = await addGroup("Gran Grupo");
    const C1 = await addClient("C1", G.id);
    await support();
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: G.id, income: "24000" }]);
    const cs = await prisma.staffCatalogItem.create({ data: { kind: "TEAM", name: "CS" } });
    const it = await prisma.staffCatalogItem.create({ data: { kind: "TEAM", name: "IT" } });
    const n1 = await prisma.staffCatalogItem.create({ data: { kind: "LEVEL", name: "N1" } });
    const n3 = await prisma.staffCatalogItem.create({ data: { kind: "LEVEL", name: "N3" } });
    await prisma.serviceTerm.create({ data: { attribute: "HOSTING", value: "CLOUD", clientId: C1.id } });
    const t = await fakeBatch(admin.id);
    await addTicket(t.id, { ticketId: "E", entorno: "Soporte", org: "9001", cause: "incidente_estándar_plataforma" });
    await addTicket(t.id, { ticketId: "I", entorno: "Soporte", org: "9001", cause: "incidente_infraestructura" });
    await addTicket(t.id, { ticketId: "X", entorno: "Soporte", org: "9001", cause: "Sistemas del Cliente" });
    await addTicket(t.id, { ticketId: "N", entorno: "Soporte", org: "9001", cause: null });
    const z = (date: string, h: number, ticketId: string, o: Partial<Parameters<typeof addZd>[0]> = {}) => addZd({ batchId: bid, date, minutes: h * 60, groupId: G.id, clientId: C1.id, ticketId, ...o });
    await z("2026-03-02", 3, "E", { teamId: cs.id, levelId: n1.id });
    await z("2026-03-03", 2, "I", { teamId: it.id, levelId: n3.id }); // infraestructura con CLOUD: incidente Vincle
    await z("2026-03-04", 1.5, "X", { teamId: cs.id, levelId: n1.id });
    await z("2026-03-05", 0.5, "N");
    await z("2026-01-05", 4, "E", { teamId: cs.id, levelId: n1.id });
    const f = (await getFicha(admin.id, Q({ fecha: "2026-03-31", modo: "FULL_MONTH" }), { type: "group", id: G.id }))!;
    const cumHours = f.entity.periods.cum.hours.inPerimeter; // 11
    expect(cumHours).toBe("11");
    expect(D(f.tables.equipo.total.cum.hours).toString()).toBe(cumHours);
    expect(D(f.tables.ticket.total.cum.hours).toString()).toBe(cumHours);
    expect(f.tables.equipo.rows.find((r) => r.profile === "IT")!.periods.cum.hours).toBe("2");
    expect(f.tables.equipo.rows.find((r) => r.profile === "CS N1")!.periods.cum.hours).toBe("8.5");
    expect(f.tables.ticket.groups.map((g) => g.total.cum.hours)).toEqual(["9", "1.5", "0.5"]); // incidente (3+2+4), otro soporte, causa pendiente
    const p = f.tables.problema;
    expect(p.rows.find((r) => r.key === "estandar")!.cum.hours).toBe("7");
    expect(p.rows.find((r) => r.key === "infra")!.cum.hours).toBe("2");
    expect(p.total.cum.hours).toBe("9");
    expect(p.total.shareOfTarget).toBe(D("9").div(D(f.entity.periods.cum.targetHours.value as string)).toString()); // 9 h / horas objetivo (24000/550×8)
    // el detalle de horas incluidas suma exactamente la cifra y la suma de las filas mensuales
    const det = await hoursDetail(admin.id, f.query, { type: "group", id: G.id }, "cum", "incluidas", 1);
    expect(det.total.hours).toBe(cumHours);
    const monthlySum = f.series.rows.hours!.filter((r) => !r.future).reduce((a, r) => a.add(D(r.cur!.v as string)), Dec.ZERO).toString();
    expect(monthlySum).toBe(cumHours);
  });
});

describe("ficha: CSV interanual del mismo conjunto de datos", () => {
  it("las filas del CSV son las del gráfico: meses futuros ausentes, base cero indicada, variación vacía sin base", async () => {
    const g = await addGroup("G");
    await support();
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "12000" }]);
    await seedFinance(admin.id, "SOPORTE", 2025, [{ groupId: g.id, income: "12000" }]);
    await hours(g.id, "2026-01-10", 5);
    await hours(g.id, "2026-02-10", 10);
    await hours(g.id, "2025-02-10", 5);
    const f = (await getFicha(admin.id, Q({ fecha: "2026-02-28", modo: "FULL_MONTH" }), { type: "group", id: g.id }))!;
    const csv = (await fichaCsv(admin.id, f.query, { type: "group", id: g.id }, "interanual"))!;
    const rows = parse(csv.body.replace(/^﻿/, ""), { delimiter: ";", columns: true }) as Record<string, string>[];
    const horas = rows.filter((r) => r.medida === MEASURES.hours.title);
    expect(horas.map((r) => r.mes)).toEqual(["1", "2"]); // marzo–diciembre: sin fila (futuros)
    expect(horas[0]).toMatchObject({ actual: "5", mismo_mes_anterior: "0", diferencia: "5", variacion_pct: "", estado_variacion: "BASE_CERO" });
    expect(horas[1]).toMatchObject({ actual: "10", mismo_mes_anterior: "5", diferencia: "5", estado_variacion: "OK" });
    expect(horas[1].variacion_pct).toBe("1"); // +100 %
    expect(Number(f.series.rows.hours![1].cmp!.pct)).toBe(1);
  });
});
