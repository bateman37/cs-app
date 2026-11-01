import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { runEconomics } from "@/server/economics/engine";
import { resetDatabase, makeUsers } from "./helpers";
import { addClient, addGroup, addTicket, addWrike, addZd, fakeBatch, seedFinance, serviceAssignment, setUsers } from "./economia-helpers";

let admin: { id: string };
let reader: { id: string };
let bid: string;
beforeEach(async () => {
  await resetDatabase();
  ({ admin, reader } = await makeUsers());
  bid = (await fakeBatch(admin.id)).id;
});

const NOW = new Date("2026-10-30T10:00:00Z");
const run = (g: string[] | "ALL", o: Partial<Parameters<typeof runEconomics>[1]> = {}, actor = admin.id) =>
  runEconomics(actor, { scope: { type: "groups", ids: g }, service: "SOPORTE", date: "2026-06-15", now: NOW, ...o });
const cum = (r: Awaited<ReturnType<typeof run>>, i = 0) => r.entities[i].periods.cum;

describe("prorrateo e imputación", () => {
  it("anual 12000, corte 15/30 → 500 del mes; 15/31 → 1000 × 15/31; mes completo = base mensual", async () => {
    const g = await addGroup("G");
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "12000" }]);
    const r30 = await run([g.id], { date: "2026-06-15" }); // junio: 30 días
    expect(r30.entities[0].periods.month.revenue.value).toBe("500");
    const r31 = await run([g.id], { date: "2026-07-15" }); // julio: 31 días
    expect(r31.entities[0].periods.month.revenue.value).toBe((await import("@/domain/finance")).Dec.parse("1000")!.ratio(15, 31).toString());
    const full = await run([g.id], { date: "2026-06-15", mode: "FULL_MONTH" });
    expect(full.entities[0].periods.month.revenue.value).toBe("1000");
    expect(full.input.cut).toBe("2026-06-30");
    expect(full.entities[0].periods.month.provisional).toBe(false);
    expect(r30.entities[0].periods.month.provisional).toBe(true);
  });
  it("febrero real (28 y 29 días), CUM = meses previos + fracción, y cruce de año usa el conjunto de cada año", async () => {
    const g = await addGroup("G");
    await seedFinance(admin.id, "SOPORTE", 2024, [{ groupId: g.id, income: "2400" }]);
    await seedFinance(admin.id, "SOPORTE", 2023, [{ groupId: g.id, income: "1200" }]);
    const r = await run([g.id], { date: "2024-02-15", now: new Date("2026-10-30T00:00:00Z") });
    expect(r.entities[0].periods.month.revenue.value).toBe((await import("@/domain/finance")).Dec.parse("200")!.ratio(15, 29).toString());
    // CUM = enero completo (200) + febrero 15/29 de 200
    expect(cum(r).revenue.value).toBe((await import("@/domain/finance")).Dec.parse("200")!.add((await import("@/domain/finance")).Dec.parse("200")!.ratio(15, 29)).toString());
    // año anterior completo = 1200 (2023); CUM comparable = hasta 15/02/2023 con 28 días: 100 + 100×15/28
    expect(r.entities[0].periods.prevYear.revenue.value).toBe("1200");
    expect(r.entities[0].periods.prevCum.revenue.value).toBe((await import("@/domain/finance")).Dec.parse("100")!.add((await import("@/domain/finance")).Dec.parse("100")!.ratio(15, 28)).toString());
    // un periodo que cruza años (mes anterior de enero): diciembre del año previo con el conjunto del año previo
    const jan = await run([g.id], { date: "2024-01-10" });
    expect(jan.entities[0].periods.prevMonth).toMatchObject({ from: "2023-12-01", to: "2023-12-31" });
    expect(jan.entities[0].periods.prevMonth.revenue.value).toBe("100");
  });
});

describe("periodos", () => {
  it("enero tiene diciembre anterior; CUM, año anterior completo y CUM comparable son distintos; 29/02/2024 → 28/02/2023", async () => {
    const g = await addGroup("G");
    await seedFinance(admin.id, "SOPORTE", 2024, [{ groupId: g.id, income: "1200" }]);
    await seedFinance(admin.id, "SOPORTE", 2023, [{ groupId: g.id, income: "2400" }]);
    const r = await run([g.id], { date: "2024-02-29" });
    const p = r.periodsDefinition;
    expect(p.prevCum).toMatchObject({ from: "2023-01-01", to: "2023-02-28" });
    expect(p.prevYear).toMatchObject({ from: "2023-01-01", to: "2023-12-31" });
    expect(p.cum).toMatchObject({ from: "2024-01-01", to: "2024-02-29" });
    expect(r.entities[0].periods.prevCum.revenue.value).not.toBe(r.entities[0].periods.prevYear.revenue.value);
    expect(r.entities[0].periods.prevCum.revenue.value).toBe("400"); // 2 meses completos de 200
    const jan = await run([g.id], { date: "2024-01-31" });
    expect(jan.periodsDefinition.prevMonth).toMatchObject({ from: "2023-12-01", to: "2023-12-31" });
  });
  it("las horas se filtran por fecha de trabajo y no se incluyen registros posteriores al corte; no se prorratean", async () => {
    const g = await addGroup("G");
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "12000" }]);
    const t = await fakeBatch(admin.id);
    await addTicket(t.id, { ticketId: "A", adminDelegada: false });
    await serviceAssignment({ matchKind: "ENTORNO", matchValue: "entorno soporte", service: "SOPORTE" });
    await addTicket(t.id, { ticketId: "S", entorno: "Entorno Soporte" });
    await addZd({ batchId: bid, date: "2026-06-10", minutes: 120, groupId: g.id, ticketId: "S" });
    await addZd({ batchId: bid, date: "2026-06-16", minutes: 600, groupId: g.id, ticketId: "S" }); // posterior al corte 15
    await addZd({ batchId: bid, date: "2026-05-01", minutes: 60, groupId: g.id, ticketId: "S" });
    const r = await run([g.id], { date: "2026-06-15" });
    expect(r.entities[0].periods.month.hours.inPerimeter).toBe("2");
    expect(r.entities[0].periods.cum.hours.inPerimeter).toBe("3");
    expect(r.entities[0].periods.prevMonth.hours.inPerimeter).toBe("1");
    expect(r.entities[0].monthly.map((m) => m.hours.inPerimeter).slice(4)).toEqual(["1", "2"]);
  });
});

describe("ratios y cartera", () => {
  async function two(h1: number, h2: number, r1 = "1000", r2 = "1000") {
    const g1 = await addGroup("G1");
    const g2 = await addGroup("G2");
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g1.id, income: String(Number(r1) * 12) }, { groupId: g2.id, income: String(Number(r2) * 12) }]);
    await serviceAssignment({ matchKind: "ENTORNO", matchValue: "soporte", service: "SOPORTE" });
    const t = await fakeBatch(admin.id);
    await addTicket(t.id, { ticketId: "S", entorno: "Soporte" });
    // 1 mes completo de ingreso por grupo (enero), horas en enero.
    if (h1) await addZd({ batchId: bid, date: "2026-01-10", minutes: h1 * 60, groupId: g1.id, ticketId: "S" });
    if (h2) await addZd({ batchId: bid, date: "2026-01-11", minutes: h2 * 60, groupId: g2.id, ticketId: "S" });
    return [g1, g2];
  }
  it("1000/10 y 1000/30 → cartera 400 €/jornada, no la media de 800 y 266,666; independiente de la paginación", async () => {
    const [g1, g2] = await two(10, 30);
    const r = await run([g1.id, g2.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    const by = Object.fromEntries(r.entities.map((e) => [e.name, e.periods.month.perDay.value]));
    expect(by.G1).toBe("800");
    expect(by.G2).toMatch(/^266\.666666666666666666/);
    expect(r.portfolio!.month.perDay.value).toBe("400");
    const page = await run([g1.id, g2.id], { date: "2026-01-31", mode: "FULL_MONTH", pageSize: 1 });
    expect(page.entities).toHaveLength(1);
    expect(page.portfolio!.month.perDay.value).toBe("400");
    expect(page.totalEntities).toBe(2);
    // desviaciones: contra objetivo 550 y contra cartera
    expect(r.entities[0].periods.month.deviationVsTarget.value).toMatch(/^-0\.4545/); // (550-800)/550 → rendimiento por encima
    expect(r.entities[0].periods.month.deviationVsPortfolio?.value).toBe("-1"); // (400-800)/400
  });
  it("1000/0 más 1000/10 → cartera 1600 €/jornada con el primer ratio individual no calculable y su ingreso a la vista", async () => {
    const [g1, g2] = await two(0, 10);
    const r = await run([g1.id, g2.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    expect(r.portfolio!.month.perDay.value).toBe("1600");
    expect(r.portfolio!.month.groupsNotComputable).toEqual({ count: 1, incomeAtStake: "1000" });
    const a = r.entities.find((e) => e.name === "G1")!.periods.month;
    expect(a.perDay).toMatchObject({ value: null, status: "NOT_COMPUTABLE" });
    expect(a.perDay.reason).toMatch(/cero horas/);
  });
  it("positivo contra objetivo = por debajo; cartera de ratio cero no divide; ingreso cero confirmado con horas → ratio cero", async () => {
    const g1 = await addGroup("G1");
    const g2 = await addGroup("G2");
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g2.id, income: "1200" }]); // g1 ausente en un conjunto completo y atribuido → cero confirmado
    await serviceAssignment({ matchKind: "ENTORNO", matchValue: "soporte", service: "SOPORTE" });
    const t = await fakeBatch(admin.id);
    await addTicket(t.id, { ticketId: "S", entorno: "Soporte" });
    await addZd({ batchId: bid, date: "2026-01-10", minutes: 600, groupId: g1.id, ticketId: "S" });
    await addZd({ batchId: bid, date: "2026-01-10", minutes: 600, groupId: g2.id, ticketId: "S" });
    const r = await run([g1.id, g2.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    const e1 = r.entities.find((e) => e.name === "G1")!.periods.month;
    expect(e1.revenue).toMatchObject({ value: "0", status: "AVAILABLE" });
    expect(e1.perDay.value).toBe("0");
    expect(e1.deviationVsTarget.value).toBe("1"); // (550-0)/550: positivo = por debajo del objetivo
    const e2 = r.entities.find((e) => e.name === "G2")!.periods.month;
    expect(e2.perDay.value).toBe("80"); // 100 € mensuales / 10 h × 8
    const solo = await run([g1.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    expect(solo.portfolio!.month.perDay.value).toBe("0");
    expect(solo.entities[0].periods.month.deviationVsPortfolio).toMatchObject({ value: null, status: "NOT_COMPUTABLE" });
  });
});

describe("cero, ausencia de fuente y usuarios", () => {
  it("sin fuente ≠ grupo ausente en conjunto completo ≠ conjunto parcial ≠ histórico no confirmado; horas cero; usuarios sin informar no impiden el ratio", async () => {
    const g = await addGroup("G");
    const none = await run([g.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    expect(none.entities[0].periods.month.revenue).toMatchObject({ value: null, status: "NO_SOURCE" });
    const other = await addGroup("Otro");
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: other.id, income: "1200" }]);
    const complete = await run([g.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    expect(complete.entities[0].periods.month.revenue).toMatchObject({ value: "0", status: "AVAILABLE" }); // cero confirmado
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: other.id, income: "1200" }, { groupId: null, income: "50", label: "sin grupo" }]);
    const partial = await run([g.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    expect(partial.entities[0].periods.month.revenue.status).toBe("NO_SOURCE");
    expect(partial.reference.finance.find((f) => f.year === 2026 && f.category === "SOPORTE")).toMatchObject({ coverage: "PARCIAL", unassigned: 1 });
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: other.id, income: "1200" }], { origin: "HISTORICAL" });
    const hist = await run([g.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    expect(hist.entities[0].periods.month.revenue.status).toBe("NO_SOURCE");
  });
  it("sin usuarios sigue habiendo ratio económico; cero confirmado de usuarios no permite dividir; hueco = exposición incompleta", async () => {
    const g = await addGroup("G");
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "12000" }]);
    await serviceAssignment({ matchKind: "ENTORNO", matchValue: "soporte", service: "SOPORTE" });
    const t = await fakeBatch(admin.id);
    await addTicket(t.id, { ticketId: "S", entorno: "Soporte" });
    await addZd({ batchId: bid, date: "2026-01-10", minutes: 600, groupId: g.id, ticketId: "S" });
    const r0 = await run([g.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    expect(r0.entities[0].periods.month.perDay.value).toBe("800");
    expect(r0.entities[0].periods.month.users.stock.status).toBe("sin informar");
    expect(r0.entities[0].periods.month.perUserPerYear.status).toBe("NOT_COMPUTABLE");
    await setUsers(admin.id, { groupId: g.id }, 2026, [0, 5, 5]);
    const z = await run([g.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    expect(z.entities[0].periods.month.users.stock.status).toBe("cero confirmado");
    expect(z.entities[0].periods.month.perUserPerYear.reason).toMatch(/cero/);
    const gap = await run([g.id], { date: "2026-03-31", mode: "FULL_MONTH" });
    expect(gap.entities[0].periods.cum.users.complete).toBe(true);
    const gap2 = await run([g.id], { date: "2026-04-30", mode: "FULL_MONTH" });
    expect(gap2.entities[0].periods.cum.users).toMatchObject({ complete: false, userMonths: null, missingMonths: [{ year: 2026, month: 4 }] });
  });
  it("65 usuarios hasta mayo y 68 desde junio: enero–octubre = 665 usuarios mes y stock 68; mes parcial pondera solo su exposición", async () => {
    const g = await addGroup("G");
    await setUsers(admin.id, { groupId: g.id }, 2026, [65, 65, 65, 65, 65, 68, 68, 68, 68, 68]);
    const r = await run([g.id], { date: "2026-10-31", mode: "FULL_MONTH" });
    expect(r.entities[0].periods.cum.users).toMatchObject({ userMonths: "665", complete: true });
    expect(r.entities[0].periods.cum.users.stock).toEqual({ value: 68, status: "informado" });
    expect(r.entities[0].periods.cum.users.averageUsers).toBe("66.5");
    const part = await run([g.id], { date: "2026-10-15" });
    expect(part.entities[0].periods.month.users.userMonths).toBe((await import("@/domain/finance")).Dec.int(68).ratio(15, 31).toString());
    expect(part.entities[0].periods.month.users.stock.value).toBe(68);
  });
  it("usuarios de implantaciones no se suman al grupo ni se copian a cada hijo", async () => {
    const g = await addGroup("G");
    const c = await addClient("C", g.id);
    const im = await prisma.implementation.create({ data: { clientId: c.id, name: "I" } });
    await setUsers(admin.id, { groupId: g.id }, 2026, [10]);
    await setUsers(admin.id, { clientId: c.id }, 2026, [6]);
    await setUsers(admin.id, { implementationId: im.id }, 2026, [4]);
    const rg = await run([g.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    expect(rg.entities[0].periods.month.users.stock.value).toBe(10);
    const rc = await runEconomics(admin.id, { scope: { type: "client", id: c.id }, service: "SOPORTE", date: "2026-01-31", mode: "FULL_MONTH", now: NOW });
    expect(rc.entities[0].periods.month.users.stock.value).toBe(6);
    const ri = await runEconomics(admin.id, { scope: { type: "implementation", id: im.id }, service: "SOPORTE", date: "2026-01-31", mode: "FULL_MONTH", now: NOW });
    expect(ri.entities[0].periods.month.users.stock.value).toBe(4);
  });
});

describe("ámbito, servicio y fuente histórica PMO", () => {
  it("tiempo solo de grupo cuenta una vez; el cliente tiene sus horas propias y «ingreso agrupado en Grupo Cliente»; filtro parcial no produce rentabilidad", async () => {
    const g = await addGroup("G");
    const c1 = await addClient("C1", g.id);
    const c2 = await addClient("C2", g.id);
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "12000" }]);
    await serviceAssignment({ matchKind: "WRIKE_PROJECT", matchValue: "proyecto g", service: "SOPORTE" });
    await addWrike({ batchId: bid, date: "2026-01-05", minutes: 120, groupId: g.id, project: "Proyecto G", bucket: "GROUP_ONLY" });
    await addWrike({ batchId: bid, date: "2026-01-06", minutes: 60, groupId: g.id, clientId: c1.id, project: "Proyecto G", bucket: "CLIENT" });
    await addWrike({ batchId: bid, date: "2026-01-07", minutes: 60, groupId: g.id, clientId: c2.id, project: "Proyecto G", bucket: "CLIENT" });
    const rg = await run([g.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    expect(rg.entities[0].periods.month.hours.inPerimeter).toBe("4"); // 120 + 60 + 60 minutos, cada actividad una vez
    const rc = await runEconomics(admin.id, { scope: { type: "client", id: c1.id }, service: "SOPORTE", date: "2026-01-31", mode: "FULL_MONTH", now: NOW });
    expect(rc.entities[0].periods.month.hours.inPerimeter).toBe("1");
    expect(rc.entities[0].periods.month.revenue).toMatchObject({ value: null, status: "NOT_COMPUTABLE" });
    expect(rc.entities[0].periods.month.revenue.reason).toMatch(/Ingreso agrupado en Grupo Cliente/);
    expect(rc.entities[0].incomeNote).toContain("«G»");
    expect(rc.entities[0].groupId).toBe(g.id);
    const f = await run([g.id], { date: "2026-01-31", mode: "FULL_MONTH", filters: { projectName: "Proyecto G" } });
    expect(f.entities[0].periods.month.perDay.status).toBe("NOT_COMPUTABLE");
    expect(f.entities[0].periods.month.perDay.reason).toMatch(/recorta solo las horas/);
    expect(f.entities[0].periods.month.revenue.value).toBe("1000"); // el ingreso se informa, pero no se llama rentabilidad del subconjunto
  });
  it("fuente histórica PMO: 2 h Zendesk PMO 2024 + 3 h Zendesk PMO 2025 excluidas + 4 h Wrike PMO 2025 elegibles → 6 h", async () => {
    const g = await addGroup("G");
    await seedFinance(admin.id, "SOPORTE", 2025, [{ groupId: g.id, income: "1200" }]);
    await seedFinance(admin.id, "SOPORTE", 2024, [{ groupId: g.id, income: "1200" }]);
    await serviceAssignment({ matchKind: "WRIKE_PROJECT", matchValue: "pmo", service: "SOPORTE" });
    await serviceAssignment({ matchKind: "ENTORNO", matchValue: "soporte", service: "SOPORTE" });
    const t = await fakeBatch(admin.id);
    await addTicket(t.id, { ticketId: "S", entorno: "Soporte" });
    await addZd({ batchId: bid, date: "2024-06-01", minutes: 120, groupId: g.id, ticketId: "S", pmo: true, eligibility: "ELIGIBLE" });
    await addZd({ batchId: bid, date: "2025-02-01", minutes: 180, groupId: g.id, ticketId: "S", pmo: true, eligibility: "EXCLUDED_PMO", bucket: "EXCLUDED_PMO" });
    await addWrike({ batchId: bid, date: "2025-02-01", minutes: 240, groupId: g.id, project: "PMO", pmo: true, eligibility: "ELIGIBLE" });
    await addZd({ batchId: bid, date: "2025-03-01", minutes: 60, groupId: g.id, ticketId: "S", pmo: false, eligibility: "ELIGIBLE" }); // no PMO sigue Zendesk
    const r = await run([g.id], { date: "2025-12-31", mode: "FULL_MONTH" });
    const e = r.entities[0];
    expect(Number(e.periods.prevYear.hours.inPerimeter)).toBe(2); // 2024: solo Zendesk PMO elegible
    expect(Number(e.periods.cum.hours.inPerimeter)).toBe(5); // 2025: Wrike PMO (4) + Zendesk no PMO (1); el Zendesk PMO de 2025 queda fuera
    expect(Number(e.periods.prevYear.hours.inPerimeter) + Number(e.periods.cum.hours.inPerimeter) - 1).toBe(6);
    expect(e.periods.cum.hours.excluded).toBe("3");
  });
  it("servicio: admin confirmado, soporte/otros expresamente asignados, desconocido y conflicto; causas del cliente conservan horas; un ratio de servicio con horas por clasificar no se presenta completo", async () => {
    const g = await addGroup("G");
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "12000" }]);
    await seedFinance(admin.id, "ADMIN_DELEGADA", 2026, [{ groupId: g.id, income: "2400" }]);
    await serviceAssignment({ matchKind: "ENTORNO", matchValue: "Entorno Soporte", service: "SOPORTE" });
    await serviceAssignment({ matchKind: "ENTORNO", matchValue: "Entorno Otros", service: "OTROS" });
    await serviceAssignment({ matchKind: "WRIKE_PROJECT", matchValue: "Proyecto Admin", service: "ADMIN_DELEGADA" });
    const t = await fakeBatch(admin.id);
    await addTicket(t.id, { ticketId: "ADM", entorno: "Administración Delegada Cloud", adminDelegada: true });
    await addTicket(t.id, { ticketId: "SOP", entorno: "Entorno Soporte", adminDelegada: false });
    await addTicket(t.id, { ticketId: "OTR", entorno: "Entorno Otros", adminDelegada: false });
    await addTicket(t.id, { ticketId: "UNK", entorno: "Algo sin asignar", adminDelegada: false }); // adminDelegada=false no prueba SOPORTE
    await addTicket(t.id, { ticketId: "CON", entorno: "Entorno Soporte", adminDelegada: true }); // evidencias incompatibles
    for (const [tk, m] of [["ADM", 60], ["SOP", 120], ["OTR", 30], ["UNK", 15], ["CON", 45]] as const) await addZd({ batchId: bid, date: "2026-01-10", minutes: m, groupId: g.id, ticketId: tk });
    await addWrike({ batchId: bid, date: "2026-01-11", minutes: 90, groupId: g.id, project: "proyecto admin" }); // tiempo sin ticket con proyecto asignado
    const r = await run([g.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    const h = r.entities[0].periods.month.hours;
    expect(h.byService).toEqual({ SOPORTE: "2", ADMIN_DELEGADA: "2.5", OTROS: "0.5", SIN_CLASIFICAR: "0.25", CONFLICTO: "0.75" });
    // soporte: ratio no completo por horas sin clasificar/conflicto, pero con sus magnitudes conocidas
    const p = r.entities[0].periods.month.perDay;
    expect(p).toMatchObject({ value: null, status: "PARTIAL", numerator: "1000", denominator: "2" });
    expect(p.reason).toMatch(/sin servicio|conflicto/);
    // sin horas por clasificar el ratio es completo
    const adm = await run([g.id], { service: "ADMIN_DELEGADA", date: "2026-01-31", mode: "FULL_MONTH" });
    expect(adm.entities[0].periods.month.perDay.status).toBe("PARTIAL");
    expect(adm.entities[0].periods.month.revenue.value).toBe("200");
  });
  it("«otro soporte» no es OTROS financiero ni la causa del cliente decide el servicio; una asignación vencida no clasifica", async () => {
    const g = await addGroup("G");
    await seedFinance(admin.id, "OTROS", 2026, [{ groupId: g.id, income: "1200" }]);
    await serviceAssignment({ matchKind: "ENTORNO", matchValue: "x", service: "OTROS", validTo: "2026-01-05" });
    const t = await fakeBatch(admin.id);
    await addTicket(t.id, { ticketId: "X", entorno: "X" });
    await addZd({ batchId: bid, date: "2026-01-10", minutes: 60, groupId: g.id, ticketId: "X" });
    const r = await run([g.id], { service: "OTROS", date: "2026-01-31", mode: "FULL_MONTH" });
    expect(r.entities[0].periods.month.hours.byService.SIN_CLASIFICAR).toBe("1");
    expect(r.entities[0].periods.month.hours.byService.OTROS).toBe("0");
  });
});

describe("consistencia, configuración y autorización", () => {
  it("devuelve la referencia de lotes, versiones y configuración usadas; Silver On Demand no activa rentabilidad mensual", async () => {
    const g = await addGroup("G");
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "12000" }]);
    await prisma.serviceTerm.create({ data: { attribute: "SUPPORT", value: "SILVER_ON_DEMAND", groupId: g.id } });
    const r = await run([g.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    expect(r.settings).toMatchObject({ revisionNo: 1, targetEurosPerDay: "550", dayHours: "8" });
    expect(r.reference.finance.filter((f) => f.batchId)).toHaveLength(1);
    expect(r.reference.engineVersion).toBe("eco-v1");
    expect(r.entities[0].eco08).toBe(true);
    expect(r.entities[0].periods.month.perDay.reason).toMatch(/ECO 08/);
    expect(r.entities[0].periods.cum.perDay.reason ?? "").not.toMatch(/ECO 08/);
  });
  it("el perfil Consulta puede leer; sin sesión (actor inexistente) no", async () => {
    const g = await addGroup("G");
    const r = await run([g.id], {}, reader.id);
    expect(r.entities).toHaveLength(1);
    await expect(run([g.id], {}, "no-existe")).rejects.toThrow();
  });
});
