import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { Dec } from "@/domain/finance";
import { runEconomics } from "@/server/economics/engine";
import { resetDatabase, makeUsers } from "./helpers";
import { addGroup, addTicket, addWrike, addZd, fakeBatch, seedFinance, serviceAssignment, setUsers } from "./economia-helpers";

let admin: { id: string };
let bid: string;
beforeEach(async () => {
  await resetDatabase();
  ({ admin } = await makeUsers());
  bid = (await fakeBatch(admin.id)).id;
});

const NOW = new Date("2026-10-30T10:00:00Z");
const run = (g: string[] | "ALL", o: Partial<Parameters<typeof runEconomics>[1]> = {}) =>
  runEconomics(admin.id, { scope: { type: "groups", ids: g }, service: "SOPORTE", date: "2026-06-15", now: NOW, ...o });
const D = (v: string) => Dec.parse(v) as Dec;

async function supportTicket() {
  await serviceAssignment({ matchKind: "ENTORNO", matchValue: "soporte", service: "SOPORTE" });
  const t = await fakeBatch(admin.id);
  await addTicket(t.id, { ticketId: "S", entorno: "Soporte" });
}
const hours = (gid: string, date: string, h: number) => addZd({ batchId: bid, date, minutes: h * 60, groupId: gid, ticketId: "S" });

describe("TAR RUN en el motor (12 × R_periodo / usuarios mes expuestos)", () => {
  it("anual 12000, diez usuarios, corte 15/30: R=500, UM=5 → 1200; también en el CUM y en doce meses completos", async () => {
    const g = await addGroup("G");
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "12000" }]);
    await setUsers(admin.id, { groupId: g.id }, 2026, Array(12).fill(10));
    const r = await run([g.id]);
    const m = r.entities[0].periods.month;
    expect(m.revenue.value).toBe("500");
    expect(m.users.userMonths).toBe("5");
    expect(m.perUserPerYear).toMatchObject({ value: "1200", numerator: "6000", denominator: "5", status: "AVAILABLE" });
    expect(r.entities[0].periods.cum.perUserPerYear.value).toBe("1200"); // 12 × 5500 / 55
    const full = await run([g.id], { date: "2026-12-31" });
    expect(full.entities[0].periods.cum.perUserPerYear).toMatchObject({ value: "1200", numerator: "144000", denominator: "120", reason: null });
  });
  it("Silver On Demand (ECO 08 retirado como veto, HOTFIX-03): la tarifa del periodo parcial sí se calcula con el equivalente anual; con doce meses completos, también", async () => {
    const g = await addGroup("G");
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "12000" }]);
    await setUsers(admin.id, { groupId: g.id }, 2026, Array(12).fill(10));
    await prisma.serviceTerm.create({ data: { attribute: "SUPPORT", value: "SILVER_ON_DEMAND", groupId: g.id } });
    const part = await run([g.id]);
    expect(part.entities[0].periods.cum.perUserPerYear.value).not.toBeNull();
    expect(part.entities[0].periods.cum.perUserPerYear.code).not.toBe("SILVER_ON_DEMAND");
    const full = await run([g.id], { date: "2026-12-31" });
    expect(full.entities[0].periods.cum.perUserPerYear.value).toBe("1200");
  });
});

describe("comparable de mes completo con datos", () => {
  it("FULL_MONTH febrero 2025 incluye las horas del 29/02/2024; CUTOFF 28/02/2025 no; las horas posteriores al corte no entran", async () => {
    const g = await addGroup("G");
    await seedFinance(admin.id, "SOPORTE", 2025, [{ groupId: g.id, income: "12000" }]);
    await seedFinance(admin.id, "SOPORTE", 2024, [{ groupId: g.id, income: "12000" }]);
    await supportTicket();
    await hours(g.id, "2024-02-10", 2);
    await hours(g.id, "2024-02-29", 3);
    await hours(g.id, "2024-03-01", 7); // posterior al corte comparable
    const full = await run([g.id], { date: "2025-02-10", mode: "FULL_MONTH" });
    expect(full.periodsDefinition.prevCum.to).toBe("2024-02-29");
    expect(full.entities[0].periods.prevCum.hours.inPerimeter).toBe("5");
    expect(full.entities[0].periods.prevCum.revenue.value).toBe("2000"); // 2 meses completos de 1000
    const cut = await run([g.id], { date: "2025-02-28", mode: "CUTOFF" });
    expect(cut.periodsDefinition.prevCum.to).toBe("2024-02-28");
    expect(cut.entities[0].periods.prevCum.hours.inPerimeter).toBe("2");
    expect(cut.entities[0].periods.prevCum.revenue.value).toBe((D("1000").add(D("1000").ratio(28, 29))).toString());
  });
});

describe("series mensuales: estado real y datos propios del comparable", () => {
  it("el último mes parcial es provisional/parcial; el anterior comparable usa sus propias horas y se corta como el modo; los meses futuros no existen", async () => {
    const g = await addGroup("G");
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "12000" }]);
    await seedFinance(admin.id, "SOPORTE", 2025, [{ groupId: g.id, income: "12000" }]);
    await supportTicket();
    await hours(g.id, "2026-06-10", 4);
    await hours(g.id, "2025-06-10", 8);
    await hours(g.id, "2025-06-20", 16); // posterior al corte comparable 15/06/2025
    await hours(g.id, "2025-02-01", 1);
    const r = await run([g.id], { detailFor: g.id });
    const e = r.entities[0];
    expect(e.monthly).toHaveLength(6);
    expect(e.monthly.map((x) => x.provisional)).toEqual([false, false, false, false, false, true]);
    expect(e.monthly[5]).toMatchObject({ partial: true, to: "2026-06-15", label: "2026-06" });
    expect(e.monthly[5].hours.inPerimeter).toBe("4");
    expect(e.prevMonthly).toHaveLength(6);
    expect(e.prevMonthly[5]).toMatchObject({ provisional: false, partial: true, to: "2025-06-15" });
    expect(e.prevMonthly[5].hours.inPerimeter).toBe("8"); // datos propios del año anterior, no copia de la serie actual
    expect(e.prevMonthly[1].hours.inPerimeter).toBe("1");
    expect(e.monthly[1].hours.inPerimeter).toBe("0");
    // sin detailFor no se calculan series por entidad
    expect((await run([g.id])).entities[0].monthly).toHaveLength(0);
    // mes completo pasado: nada provisional
    const closed = await run([g.id], { date: "2026-03-15", mode: "FULL_MONTH", detailFor: g.id });
    expect(closed.entities[0].monthly.every((x) => !x.provisional && !x.partial)).toBe(true);
    // mes en curso en modo mes completo: sigue provisional
    const cur = await run([g.id], { date: "2026-10-05", mode: "FULL_MONTH", detailFor: g.id });
    expect(cur.entities[0].monthly[9]).toMatchObject({ provisional: true, partial: false });
  });
});

describe("cartera incompleta: no se elude la restricción de las filas mediante el total", () => {
  it("un grupo con horas sin servicio (perímetro sin horas observables) queda fuera de la media comparable, que se declara «1/2 grupos»; los demás conservan su desviación (HOTFIX-03 §8)", async () => {
    const [a, b] = [await addGroup("A"), await addGroup("B")];
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: a.id, income: "12000" }, { groupId: b.id, income: "12000" }]);
    await supportTicket();
    await hours(a.id, "2026-01-10", 10);
    await addZd({ batchId: bid, date: "2026-01-11", minutes: 600, groupId: b.id }); // sin ticket: sin servicio
    const r = await run([a.id, b.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    const p = r.portfolio!.month;
    expect(p.complete).toBe(false);
    expect(p.perDay).toMatchObject({ value: "800", status: "PARTIAL", numerator: "1000" });
    expect(p.scope).toEqual({ used: 1, total: 2, provisional: 0 });
    expect(p.perDay.reason).toContain("1/2 grupos");
    expect(p.coverage).toEqual({ groups: 2, complete: 1, blocked: 1 });
    expect(p.knownSet).toMatchObject({ groups: 1, revenue: "1000", hours: "10", perDay: "800" });
    const rowA = r.entities.find((x) => x.name === "A")!.periods.month;
    expect(rowA.perDay.value).toBe("800");
    expect(rowA.deviationVsPortfolio?.value).toBe("0"); // la desviación de A ya no queda vacía
    const rowB = r.entities.find((x) => x.name === "B")!.periods.month;
    expect(rowB.perDay).toMatchObject({ value: null, status: "PARTIAL", code: "PERIMETER_PARTIAL" }); // sin horas observables: permanece «—» con causa
    expect(p.deviationVsTarget.value).not.toBeNull();
  });
  it("un grupo con horas del servicio Y horas sin servicio publica el ratio de las horas observadas como PROVISIONAL, coherente con la columna Horas", async () => {
    const g = await addGroup("G");
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "12000" }]);
    await supportTicket();
    await hours(g.id, "2026-01-10", 10);
    await addZd({ batchId: bid, date: "2026-01-11", minutes: 600, groupId: g.id }); // 10 h sin servicio: perímetro incierto
    const r = await run([g.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    const m = r.entities[0].periods.month;
    expect(m.hours.inPerimeter).toBe("10");
    expect(m.perDay).toMatchObject({ value: "800", status: "PARTIAL", provisional: true, code: "PERIMETER_PARTIAL", denominator: "10" });
    expect(m.deviationVsTarget).toMatchObject({ status: "PARTIAL", provisional: true });
    expect(m.perDay.reason).toContain("provisional");
    expect(r.portfolio!.month.scope).toEqual({ used: 1, total: 1, provisional: 1 });
  });
  it("ingreso ausente en un grupo (conjunto sin fuente de su categoría) → cartera parcial, no cero", async () => {
    const [a, b] = [await addGroup("A"), await addGroup("B")];
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: a.id, income: "12000" }], { origin: "HISTORICAL" });
    await supportTicket();
    await hours(a.id, "2026-01-10", 10);
    const r = await run([a.id, b.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    expect(r.portfolio!.month.complete).toBe(false);
    expect(r.portfolio!.month.groupsUnknownIncome).toBe(1);
    expect(r.entities.find((x) => x.name === "B")!.periods.month.revenue.value).toBeNull();
  });
  it("un filtro que recorta solo horas deja la cartera parcial con motivo HOURS_FILTER", async () => {
    const a = await addGroup("A");
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: a.id, income: "12000" }]);
    await supportTicket();
    await hours(a.id, "2026-01-10", 10);
    const r = await run([a.id], { date: "2026-01-31", mode: "FULL_MONTH", filters: { projectName: "x" } });
    expect(r.portfolio!.month.affected[0]).toMatchObject({ code: "HOURS_FILTER", groups: 1 });
    expect(r.portfolio!.month.perDay.value).toBeNull();
  });
  it("cero horas con ingreso confirmado no bloquea y su ingreso permanece (1000/0 y 1000/10 → 1600)", async () => {
    const [a, b] = [await addGroup("A"), await addGroup("B")];
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: a.id, income: "12000" }, { groupId: b.id, income: "12000" }]);
    await supportTicket();
    await hours(b.id, "2026-01-10", 10);
    const r = await run([a.id, b.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    expect(r.portfolio!.month.complete).toBe(true);
    expect(r.portfolio!.month.perDay.value).toBe("1600");
    expect(r.portfolio!.month.zeroHours).toEqual({ count: 1, income: "1000" });
    expect(r.entities.find((x) => x.name === "A")!.periods.month.perDay).toMatchObject({ value: null, code: "ZERO_HOURS" });
  });
});

describe("Silver On Demand por vigencia del periodo valorado", () => {
  it("Silver On Demand y los planes mixtos usan la misma imputación anual prorrateada en los cinco periodos y se rotulan como imputación (ECO 08 retirado)", async () => {
    const g = await addGroup("G");
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "12000" }]);
    await supportTicket();
    await hours(g.id, "2026-01-10", 10);
    await hours(g.id, "2026-06-10", 10);
    await hours(g.id, "2026-07-10", 10);
    await prisma.serviceTerm.create({ data: { attribute: "SUPPORT", value: "GOLD", groupId: g.id, validTo: new Date("2026-06-10T00:00:00Z") } });
    await prisma.serviceTerm.create({ data: { attribute: "SUPPORT", value: "SILVER_ON_DEMAND", groupId: g.id, validFrom: new Date("2026-06-10T00:00:00Z") } });
    const r = await run([g.id], { date: "2026-06-30", mode: "FULL_MONTH", detailFor: g.id });
    const m = r.entities[0].monthly;
    expect(m[0].perDay.status).toBe("AVAILABLE"); // enero con Gold
    expect(m[0].perDay.imputed).toBeUndefined();
    expect(m[5].perDay).toMatchObject({ value: "800", status: "AVAILABLE", imputed: true }); // junio mezcla Gold y Silver On Demand: calculable, rotulado como imputación
    expect(m[5].perDay.reason).toContain("Imputación económica anual prorrateada");
    expect(m[5].revenue.value).toBe("1000");
    expect(r.entities[0].periods.cum.perDay.code ?? "").not.toMatch(/SILVER|PLAN/);
    const jul = await run([g.id], { date: "2026-07-31", mode: "FULL_MONTH" });
    expect(jul.entities[0].periods.month.perDay).toMatchObject({ value: "800", imputed: true });
    expect(jul.entities[0].periods.prevMonth.perDay.value).toBe("800");
  });
});

describe("explicación de desviaciones", () => {
  it("devuelve numerador y denominador reales y operandos que reconstruyen el valor exacto", async () => {
    const [a, b] = [await addGroup("A"), await addGroup("B")];
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: a.id, income: "12000" }, { groupId: b.id, income: "12000" }]);
    await supportTicket();
    await hours(a.id, "2026-01-10", 20); // 1000 × 8 / 20 = 400
    await hours(b.id, "2026-01-10", 10); // 800
    const r = await run([a.id, b.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    const m = r.entities.find((x) => x.name === "A")!.periods.month;
    expect(m.perDay.value).toBe("400");
    expect(m.deviationVsTarget).toMatchObject({ numerator: "150", denominator: "550", operands: { objetivo: "550", ratio: "400" } });
    expect(D(m.deviationVsTarget.numerator!).div(D(m.deviationVsTarget.denominator!)).toString()).toBe(m.deviationVsTarget.value);
    const port = r.portfolio!.month.perDay.value!; // 2000 × 8 / 30
    const dp = m.deviationVsPortfolio!;
    expect(dp.operands).toEqual({ cartera: port, grupo: "400" });
    expect(D(dp.numerator!).toString()).toBe(D(port).sub(D("400")).toString());
    expect(dp.denominator).toBe(port);
    expect(D(dp.numerator!).div(D(dp.denominator!)).toString()).toBe(dp.value);
  });
  it("desviación de horas: (reales − objetivo) / objetivo, con su tratamiento de cero y sin ingreso propio en Cliente", async () => {
    const g = await addGroup("G");
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "6600" }]); // 550/mes → 8 h objetivo
    await supportTicket();
    await hours(g.id, "2026-01-10", 10);
    const r = await run([g.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    const d = r.entities[0].periods.month.deviationHours;
    expect(d).toMatchObject({ value: "0.25", numerator: "2", denominator: "8", operands: { horasReales: "10", horasObjetivo: "8" } });
    const z = await addGroup("Z");
    await seedFinance(admin.id, "ADMIN_DELEGADA", 2026, [{ groupId: z.id, income: "100" }]);
    await seedFinance(admin.id, "SOPORTE", 2025, []);
    const zr = await run([z.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    expect(zr.entities[0].periods.month.deviationHours.status).not.toBe("AVAILABLE");
  });
});

describe("derivados pendientes de reproceso", () => {
  it("conserva las magnitudes pero no las presenta como validadas", async () => {
    const g = await addGroup("G");
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "12000" }], { stale: true });
    await supportTicket();
    await hours(g.id, "2026-01-10", 10);
    const r = await run([g.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    expect(r.reference.validation.state).toBe("PENDING_RECALC");
    const m = r.entities[0].periods.month;
    expect(m.perDay.value).toBe("800"); // magnitud conservada
    expect(m.validated).toBe(false);
    expect(m.perDay.validated).toBe(false);
    expect(m.revenue.validated).toBe(false);
    const ok = await (async () => {
      await resetDatabase();
      ({ admin } = await makeUsers());
      bid = (await fakeBatch(admin.id)).id;
      const h = await addGroup("H");
      await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: h.id, income: "12000" }]);
      return run([h.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    })();
    expect(ok.reference.validation.state).toBe("VALIDATED");
    expect(ok.entities[0].periods.month.validated).toBe(true);
  });
});

describe("sello de datos: MAX(drvVersion) no identifica el estado", () => {
  it("una fila que pasa de la versión 1 a la 2 con otra en la 100 cambia el sello aunque el máximo no cambie", async () => {
    const g = await addGroup("G");
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "12000" }]);
    await addZd({ batchId: bid, date: "2026-01-10", minutes: 60, groupId: g.id });
    await addZd({ batchId: bid, date: "2026-01-11", minutes: 60, groupId: g.id });
    const rows = await prisma.zdTimeEntry.findMany({ orderBy: { workDate: "asc" } });
    await prisma.zdTimeEntry.update({ where: { id: rows[0].id }, data: { drvVersion: 100 } });
    const before = await run([g.id]);
    expect(before.reference.time.zendeskMaxDerivationVersion).toBe(100);
    await prisma.zdTimeEntry.update({ where: { id: rows[1].id }, data: { drvVersion: 2 } });
    const after = await run([g.id]);
    expect(after.reference.time.zendeskMaxDerivationVersion).toBe(100); // el máximo no lo detecta…
    expect(after.reference.dataStamp.stamp).not.toBe(before.reference.dataStamp.stamp); // …el sello sí
    expect((await run([g.id])).reference.dataStamp.stamp).toBe(after.reference.dataStamp.stamp); // y es estable sin cambios
  });
});

describe("PMO y Wrike: tiempo atribuido solo al grupo suma una vez", () => {
  it("una actividad Wrike atribuida al grupo cuenta en el grupo", async () => {
    const g = await addGroup("G");
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "12000" }]);
    await serviceAssignment({ matchKind: "WRIKE_PROJECT", matchValue: "proyecto", service: "SOPORTE" });
    await addWrike({ batchId: bid, date: "2026-01-10", minutes: 120, groupId: g.id, project: "Proyecto" });
    const r = await run([g.id], { date: "2026-01-31", mode: "FULL_MONTH" });
    expect(r.entities[0].periods.month.hours.inPerimeter).toBe("2");
  });
});
