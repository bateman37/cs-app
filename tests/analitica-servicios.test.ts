import { beforeEach, describe, expect, it } from "vitest";
import { parse } from "csv-parse/sync";
import { prisma } from "@/lib/db";
import { Dec } from "@/domain/finance";
import { parseAnalysisQuery, type AnalysisQuery } from "@/domain/analytics-query";
import { PERIOD_KEYS, runEconomics } from "@/server/economics/engine";
import { listHoursDetail } from "@/server/economics/detail";
import { getPortfolio } from "@/server/analytics/portfolio";
import { getFicha, searchEntitiesView } from "@/server/analytics/ficha";
import { bugsDetail, hoursDetail, incomeDetail, papDetail, ticketsDetail } from "@/server/analytics/detail";
import { fichaCsv, portfolioCsv } from "@/server/analytics/export";
import { setSnapshotTestHook, readSnapshot } from "@/server/analytics/snapshot";
import { loadBugs, loadTickets, type EntityRef } from "@/server/analytics/operational";
import { resetDatabase, makeUsers } from "./helpers";
import { addClient, addGroup, addTicket, addWrike, addZd, fakeBatch, seedFinance, serviceAssignment, setUsers } from "./economia-helpers";

let admin: { id: string };
let reader: { id: string };
let bid: string;
beforeEach(async () => {
  setSnapshotTestHook(null);
  await resetDatabase();
  ({ admin, reader } = await makeUsers());
  bid = (await fakeBatch(admin.id)).id;
});

const NOW = new Date("2026-10-30T10:00:00Z");
const Q = (extra: Record<string, string> = {}): AnalysisQuery => parseAnalysisQuery({ fecha: "2026-06-30", modo: "FULL_MONTH", ...extra }, NOW).query;
const d = (v: string) => new Date(`${v}T00:00:00Z`);
const D = (v: string) => Dec.parse(v) as Dec;
/** La ficha panorámica ya no lleva tickets ni bugs (viven en Calidad): sus resúmenes siguen en operational y se leen con los mismos periodos de la ficha. */
async function fichaOps(q: AnalysisQuery, ref: EntityRef) {
  const f = await getFicha(admin.id, q, ref);
  if (!f) return null;
  const periods = PERIOD_KEYS.map((k) => ({ key: k as string, from: f.economics.periodsDefinition[k].from, to: f.economics.periodsDefinition[k].to }));
  const [tickets, bugs] = await readSnapshot(admin.id, async (tx) => [await loadTickets(tx, ref, periods), await loadBugs(tx, ref, periods)] as const);
  return { ...f, tickets, bugs };
}

async function world() {
  const A = await addGroup("Alfa");
  const B = await addGroup("Beta");
  const C = await addGroup("Gamma");
  const A1 = await addClient("Alfa 1", A.id);
  const A2 = await addClient("Alfa 2", A.id);
  const B1 = await addClient("Beta 1", B.id);
  const ident = (org: string, clientId: string) => prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: org, searchValue: org, clientId } });
  await ident("9001", A1.id);
  await ident("9002", A2.id);
  await ident("9003", B1.id);
  await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: A.id, income: "12000" }, { groupId: B.id, income: "6000" }, { groupId: C.id, income: "3000" }]);
  await seedFinance(admin.id, "SOPORTE", 2025, [{ groupId: A.id, income: "12000" }]);
  await serviceAssignment({ matchKind: "ENTORNO", matchValue: "soporte", service: "SOPORTE" });
  const tb = await fakeBatch(admin.id);
  const cs = await prisma.staffCatalogItem.create({ data: { kind: "TEAM", name: "CS" } });
  const n1 = await prisma.staffCatalogItem.create({ data: { kind: "LEVEL", name: "N1" } });
  const n2 = await prisma.staffCatalogItem.create({ data: { kind: "LEVEL", name: "N2" } });
  const ana = await prisma.staffCatalogItem.create({ data: { kind: "PMO_ROLE", name: "ANA" } });
  return { A, B, C, A1, A2, B1, tb, cs, n1, n2, ana };
}
const tk = (w: Awaited<ReturnType<typeof world>>, o: Parameters<typeof addTicket>[1]) => addTicket(w.tb.id, { entorno: "Soporte", ...o });

describe("contrato de consulta", () => {
  it("valida enums, fechas, enteros y columnas de orden; lo no válido vuelve al valor inicial e informa", () => {
    const r = parseAnalysisQuery({ fecha: "2026-13-40", modo: "x'; DROP", servicio: "TOTAL", orden: "name; DELETE", dir: "up", pagina: "-3", tam: "7", soporte: "GOLD,NOPE", revision: "abc", bloques: "mes,zzz", sello: "no" }, NOW);
    expect(r.query).toMatchObject({ date: "2026-10-30", mode: "CUTOFF", service: "TOTAL", sort: "name", dir: "asc", page: 1, pageSize: 50, support: ["GOLD"], revision: null, blocks: ["mes"], stamp: "" });
    expect(r.invalid).toEqual(expect.arrayContaining(["fecha", "modo", "orden", "dir", "pagina", "tam", "soporte", "revision", "bloques"]));
    const ok = parseAnalysisQuery({ orden: "cum.perDay", dir: "desc", pagina: "3", tam: "100", soporte: "GOLD,SIN_INFORMAR" }, NOW);
    expect(ok.invalid).toEqual([]);
    expect(ok.query).toMatchObject({ sort: "cum.perDay", dir: "desc", page: 3, pageSize: 100, support: ["GOLD", "SIN_INFORMAR"] });
  });
  it("los valores iniciales son hoy en Madrid, a fecha de corte, SOPORTE y la última configuración (sin fechas fijas)", () => {
    const q = parseAnalysisQuery({}, new Date("2031-03-05T23:30:00Z")).query; // 00:30 del 06/03 en Madrid
    expect(q).toMatchObject({ date: "2031-03-06", mode: "CUTOFF", service: "SOPORTE", revision: null, status: "todos" });
  });
});

describe("Comparativa: cartera filtrada", () => {
  it("grupos completos: un filtro por plan de un Cliente conserva el ingreso y las horas del grupo entero; heterogéneo se declara", async () => {
    const w = await world();
    await prisma.serviceTerm.create({ data: { attribute: "SUPPORT", value: "GOLD", clientId: w.A1.id } });
    await prisma.serviceTerm.create({ data: { attribute: "SUPPORT", value: "SILVER_RECURRENTE", clientId: w.A2.id } });
    await prisma.serviceTerm.create({ data: { attribute: "SUPPORT", value: "GOLD", groupId: w.B.id } });
    await tk(w, { ticketId: "T1", org: "9001" });
    await addZd({ batchId: bid, date: "2026-06-10", minutes: 600, groupId: w.A.id, clientId: w.A1.id, ticketId: "T1" });
    await addZd({ batchId: bid, date: "2026-06-11", minutes: 300, groupId: w.A.id, ticketId: "T1" }); // solo del grupo: no se pierde
    const all = await getPortfolio(admin.id, Q());
    expect(all.filteredGroups).toBe(3);
    const alfa = all.rows.find((r) => r.meta.name === "Alfa")!;
    expect(alfa.meta.support).toMatchObject({ heterogeneous: true, source: "clients", values: ["GOLD", "SILVER_RECURRENTE"] });
    const f = await getPortfolio(admin.id, Q({ soporte: "SILVER_RECURRENTE" }));
    expect(f.rows.map((r) => r.meta.name)).toEqual(["Alfa"]);
    expect(f.rows[0].periods.month.hours.inPerimeter).toBe("15"); // 10 h del Cliente + 5 h del grupo
    expect(f.rows[0].periods.month.revenue.value).toBe("1000");
    expect(f.economics.portfolio!.month.groups).toBe(1);
    // GOLD: coincide con A (por A1) y con B; HETEROGENEO selecciona solo el heterogéneo; SIN_INFORMAR a los que no tienen plan
    expect((await getPortfolio(admin.id, Q({ soporte: "GOLD" }))).filteredGroups).toBe(2);
    expect((await getPortfolio(admin.id, Q({ soporte: "HETEROGENEO" }))).rows.map((r) => r.meta.name)).toEqual(["Alfa"]);
    expect((await getPortfolio(admin.id, Q({ soporte: "SIN_INFORMAR" }))).rows.map((r) => r.meta.name)).toEqual(["Gamma"]);
    // búsqueda y estado
    expect((await getPortfolio(admin.id, Q({ q: "BET" }))).rows.map((r) => r.meta.name)).toEqual(["Beta"]);
    await prisma.clientGroup.update({ where: { id: w.C.id }, data: { isActive: false } });
    expect((await getPortfolio(admin.id, Q({ estado: "inactivos" }))).rows.map((r) => r.meta.name)).toEqual(["Gamma"]);
    expect((await getPortfolio(admin.id, Q())).filteredGroups).toBe(3); // por defecto incluye todos los estados; un inactivo sigue consultable
  });

  it("la media filtrada no cambia con orden ni página y cambia con el filtro; los nulos no se ordenan como ceros", async () => {
    const w = await world();
    await tk(w, { ticketId: "T1", org: "9001" });
    await addZd({ batchId: bid, date: "2026-06-10", minutes: 600, groupId: w.A.id, clientId: w.A1.id, ticketId: "T1" });
    await addZd({ batchId: bid, date: "2026-06-10", minutes: 1800, groupId: w.B.id, clientId: w.B1.id, ticketId: "T1" });
    const base = await getPortfolio(admin.id, Q({ ref: "mes" }));
    const m = base.economics.portfolio!.month;
    // A: 1000/10 h, B: 500/30 h, C: 250/0 h (cero horas válido, sin ratio individual)
    expect(m.perDay.value).toBe(D("1750").mulInt(60).mul(D("8")).div(D("2400")).toString());
    const byDesc = await getPortfolio(admin.id, Q({ orden: "month.perDay", dir: "desc" }));
    const byAsc = await getPortfolio(admin.id, Q({ orden: "month.perDay", dir: "asc" }));
    expect(byDesc.rows.map((r) => r.meta.name)).toEqual(["Alfa", "Beta", "Gamma"]);
    expect(byAsc.rows.map((r) => r.meta.name)).toEqual(["Beta", "Alfa", "Gamma"]); // Gamma (sin ratio) siempre al final
    expect(byAsc.economics.portfolio!.month.perDay.value).toBe(m.perDay.value);
    const filtered = await getPortfolio(admin.id, Q({ q: "alfa" }));
    expect(filtered.economics.portfolio!.month.perDay.value).toBe("800");
  });

  it("paginación de servidor: la segunda página no altera tarjetas ni cartera", async () => {
    const w = await world();
    await prisma.clientGroup.createMany({ data: Array.from({ length: 27 }, (_, i) => ({ name: `Extra ${String(i).padStart(2, "0")}` })) });
    const p1 = await getPortfolio(admin.id, Q({ tam: "25" }));
    const p2 = await getPortfolio(admin.id, Q({ tam: "25", pagina: "2" }));
    expect(p1.rows).toHaveLength(25);
    expect(p2.rows).toHaveLength(5);
    expect(p1.filteredGroups).toBe(30);
    expect(p2.economics.portfolio!.month).toEqual(p1.economics.portfolio!.month);
    expect(p1.rows.map((r) => r.meta.id).filter((id) => p2.rows.some((x) => x.meta.id === id))).toEqual([]);
    expect(w.A.id).toBeTruthy();
  });

  it("el perfil Consulta lee; sin sesión o con un actor inexistente no; los detalles de Cargas siguen siendo solo ADMIN", async () => {
    const w = await world();
    expect((await getPortfolio(reader.id, Q())).filteredGroups).toBe(3);
    await expect(getPortfolio("no-existe", Q())).rejects.toThrow();
    await expect(portfolioCsv("no-existe", Q())).rejects.toThrow();
    await expect(listHoursDetail(reader.id, { groupId: w.A.id, from: "2026-01-01", to: "2026-06-30" })).rejects.toThrow();
    expect((await incomeDetail(reader.id, Q(), w.A.id, "cum", 1)).complete).toBe(true);
  });
});

describe("Análisis Cliente: ficha", () => {
  it("el Grupo muestra todas sus métricas; el Cliente solo hechos de su ámbito y el contexto «del grupo» sin repartir dinero", async () => {
    const w = await world();
    await tk(w, { ticketId: "T1", org: "9001" });
    await addZd({ batchId: bid, date: "2026-06-10", minutes: 120, groupId: w.A.id, clientId: w.A1.id, ticketId: "T1" });
    await addZd({ batchId: bid, date: "2026-06-12", minutes: 60, groupId: w.A.id, clientId: w.A2.id, ticketId: "T1" });
    await addZd({ batchId: bid, date: "2026-06-13", minutes: 30, groupId: w.A.id, ticketId: "T1" }); // solo del grupo: una vez
    await setUsers(admin.id, { groupId: w.A.id }, 2026, Array(12).fill(10));
    await setUsers(admin.id, { clientId: w.A1.id }, 2026, Array(12).fill(10)); // usuarios compartidos: no se suman
    const g = (await getFicha(admin.id, Q(), { type: "group", id: w.A.id }))!;
    expect(g.entity.periods.month.hours.inPerimeter).toBe("3.5");
    expect(g.entity.periods.month.revenue.value).toBe("1000");
    expect(g.entity.periods.month.users.stock.value).toBe(10);
    expect(g.entity.monthly).toHaveLength(6);
    expect(g.entity.prevMonthly).toHaveLength(6);
    const c = (await getFicha(admin.id, Q(), { type: "client", id: w.A1.id }))!;
    expect(c.entity.periods.month.hours.inPerimeter).toBe("2");
    expect(c.entity.periods.month.revenue.value).toBeNull();
    expect(c.entity.periods.month.perDay).toMatchObject({ value: null, code: "NOT_GROUP_LEVEL" });
    expect(c.entity.periods.month.deviationHours.value).toBeNull();
    expect(c.entity.periods.month.deviationHours.reason).toMatch(/Sin ingreso propio/);
    expect(c.entity.incomeNote).toMatch(/Ingreso agrupado en el Grupo Cliente «Alfa»/);
    expect(c.groupContext!.periods.month.revenue.value).toBe("1000"); // contexto «del grupo»: no se suma a las horas del Cliente
    expect(c.entity.periods.month.users.stock.value).toBe(10);
    expect(c.dedication!.month.withoutImplementationHours).toBe("2"); // «sin implantación» se conserva, no se clona
    expect((await getFicha(admin.id, Q(), { type: "client", id: "inexistente-1234" }))).toBeNull();
  });

  it("dedicación por perfil y causa a la fecha del trabajo: sin identificar visible, Sistemas del Cliente conservado, clases que reconcilian el total", async () => {
    const w = await world();
    await tk(w, { ticketId: "T1", org: "9001", cause: "incidente_estándar_plataforma" });
    await tk(w, { ticketId: "T2", org: "9001", cause: "Sistemas del Cliente" });
    await tk(w, { ticketId: "T3", org: "9001", cause: "incidente_infraestructura" });
    await tk(w, { ticketId: "T4", org: "9001", cause: null });
    await prisma.serviceTerm.create({ data: { attribute: "HOSTING", value: "OP", clientId: w.A1.id, validTo: d("2026-03-01") } });
    await prisma.serviceTerm.create({ data: { attribute: "HOSTING", value: "CLOUD", clientId: w.A1.id, validFrom: d("2026-03-01") } });
    const z = (date: string, min: number, ticketId: string, extra: Partial<Parameters<typeof addZd>[0]> = {}) => addZd({ batchId: bid, date, minutes: min, groupId: w.A.id, clientId: w.A1.id, ticketId, ...extra });
    await z("2026-06-01", 180, "T1", { teamId: w.cs.id, levelId: w.n1.id }); // CS N1 incidente
    await z("2026-06-02", 120, "T2", { teamId: w.cs.id, levelId: w.n2.id }); // CS N2 otro soporte
    await z("2026-06-03", 60, "T3", { teamId: w.cs.id, levelId: w.n1.id }); // infraestructura con CLOUD hoy → incidente
    await z("2026-02-03", 60, "T3", { teamId: w.cs.id, levelId: w.n1.id }); // infraestructura con OP en febrero → NO incidente (OP no es SaaS por migración posterior)
    await z("2026-06-04", 30, "T4"); // sin causa, sin perfil
    await addWrike({ batchId: bid, date: "2026-06-05", minutes: 90, groupId: w.A.id, project: "Soporte PMO", pmo: true, roleId: w.ana.id });
    await serviceAssignment({ matchKind: "WRIKE_PROJECT", matchValue: "soporte pmo", service: "SOPORTE" });
    const f = (await getFicha(admin.id, Q(), { type: "group", id: w.A.id }))!;
    const m = f.dedication!.month;
    expect(m.profiles.map((p) => p.profile)).toEqual(["CS N1", "CS N2", "PMO ANA", "Sin identificar"]);
    expect(Object.fromEntries(m.profiles.map((p) => [p.profile, p.hours]))).toEqual({ "CS N1": "4", "CS N2": "2", "PMO ANA": "1.5", "Sin identificar": "0.5" });
    expect(m.causes.find((c) => c.cause === "sistemas del cliente")).toMatchObject({ hours: "2", cls: "OTRO_SOPORTE" });
    // clases: incidente (T1 + T3 en CLOUD) = 4 h; otro = 2 h; sin clasificar = T4 0,5 h + Wrike sin ticket 1,5 h
    expect(m.byClass).toEqual({ incident: "4", other: "2", unclassified: "2" });
    const sum = ["incident", "other", "unclassified"].reduce((s, k) => s.add(D(m.byClass[k as "incident"])), Dec.ZERO);
    expect(sum.toString()).toBe(m.totalHours);
    expect(m.totalHours).toBe(f.entity.periods.month.hours.inPerimeter); // las partes concilian con la cifra de la tarjeta
    const cum = f.dedication!.cum;
    expect(cum.byClass.incident).toBe("4"); // febrero con OP: no incidente
    expect(cum.causes.find((c) => c.cause === "incidente_infraestructura" && c.cls === "OTRO_SOPORTE")?.hours).toBe("1");
  });

  it("PAP: un ID con varias causas y tickets cuenta una vez; no aditivo; origen cliente; resultado no OK y sin fecha se conservan", async () => {
    const w = await world();
    const pb = await fakeBatch(admin.id, "pap");
    const mk = async (papId: string, o: { date: string | null; result: string | null; state: string; causes: [string, string, string | null][]; client?: string | null; group?: string }) => {
      const it = await prisma.papItem.create({ data: { listKey: "L1", papId, firstBatchId: pb.id, drvScope: "CLIENT", drvGroupId: o.group ?? w.A.id, drvClientId: o.client === undefined ? w.A1.id : o.client } });
      const rev = await prisma.papRevision.create({ data: { itemId: it.id, fingerprint: `fp${papId}`, revisionNo: 1, title: `PAP ${papId}`, result: o.result, productionDate: o.date ? d(o.date) : null, correctiveState: o.state, data: {}, batchId: pb.id } });
      for (const [raw, category, origin] of o.causes) await prisma.papCause.create({ data: { revisionId: rev.id, rawToken: raw, normalized: raw.toLowerCase(), category, origin } });
      await prisma.papItem.update({ where: { id: it.id }, data: { currentRevisionId: rev.id } });
    };
    await mk("1", { date: "2026-06-10", result: "OK", state: "CORRECTIVE", causes: [["Correctivo estándar", "CORRECTIVE", "STANDARD"], ["Evolutivo", "EVOLUTIVE", null]] });
    await mk("2", { date: "2026-06-11", result: "Revertido", state: "CORRECTIVE", causes: [["Correctivo uso indebido", "CORRECTIVE", "CLIENT_ORIGIN"]] });
    await mk("3", { date: null, result: null, state: "UNKNOWN", causes: [] });
    await mk("4", { date: "2026-06-12", result: "OK", state: "NON_CORRECTIVE", causes: [["Evolutivo", "EVOLUTIVE", null]], group: (await addGroup("Otro")).id });
    const f = (await getFicha(admin.id, Q(), { type: "group", id: w.A.id }))!;
    const p = f.pap.periods.month;
    expect(p).toMatchObject({ total: 2, corrective: 2, standard: 1, clientOrigin: 1, evolutive: 1, nonOk: 1, additive: false });
    expect(f.pap.withoutProductionDate).toBe(1);
    expect(f.pap.results.map((r) => r.result)).toEqual(expect.arrayContaining(["OK", "Revertido", "(sin resultado)"]));
    const det = await papDetail(reader.id, Q(), { type: "group", id: w.A.id }, "month", 1);
    expect(det.total).toBe(p.total);
    expect(det.rows.map((r) => r.papId).sort()).toEqual(["1", "2"]);
    expect((await papDetail(reader.id, Q(), { type: "group", id: w.A.id }, "sin_fecha", 1)).total).toBe(1);
  });

  it("tickets sin horas visibles, dos destinos N3 cuentan una vez y la cohorte es la creación; las implantaciones no identifican tickets", async () => {
    const w = await world();
    await tk(w, { ticketId: "T1", org: "9001", created: "2026-06-05", destinations: ["PMO_N3", "IT_N3"], type: "incident", status: "solved" });
    await tk(w, { ticketId: "T2", org: "9002", created: "2026-06-06", destinations: ["IT_N3"], type: "problem", status: "open" });
    await tk(w, { ticketId: "T3", org: "9001", created: "2026-05-06", type: "question", status: "closed" });
    await tk(w, { ticketId: "T4", org: "9003", created: "2026-06-06", type: "incident" });
    const f = (await fichaOps(Q(), { type: "group", id: w.A.id }))!;
    const t = f.tickets.periods.month;
    expect(t).toMatchObject({ total: 2, incident: 1, problem: 1, other: 0 });
    expect(t.escalations).toMatchObject({ n3: 2, pmoN3: 1, itN3: 2 });
    expect(f.tickets.periods.prevMonth.total).toBe(1);
    expect(f.tickets.periods.cum.other).toBe(1);
    const only1 = (await fichaOps(Q(), { type: "client", id: w.A1.id }))!;
    expect(only1.tickets.periods.month.total).toBe(1);
    const dt = await ticketsDetail(reader.id, Q(), { type: "group", id: w.A.id }, "month", 1);
    expect(dt.total).toBe(2);
    const impl = await prisma.implementation.create({ data: { clientId: w.A1.id, name: "Impl" } });
    const im = (await fichaOps(Q(), { type: "implementation", id: impl.id }))!;
    expect(im.tickets.supported).toBe(false);
  });

  it("bugs vinculados: un bug con dos problemas = 1 bug y 2 problemas; un problema con dos bugs = 1 problema y 2 bugs; rechazados, pendientes e internos fuera", async () => {
    const w = await world();
    const internal = await addClient("Interno", null, true);
    await prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: "9999", searchValue: "9999", clientId: internal.id } });
    await tk(w, { ticketId: "P1", org: "9001", created: "2026-06-05", type: "problem" });
    await tk(w, { ticketId: "P2", org: "9001", created: "2026-06-06", type: "problem" });
    await tk(w, { ticketId: "P3", org: "9002", created: "2026-06-07", type: "problem" });
    await tk(w, { ticketId: "I1", org: "9001", created: "2026-06-08", type: "incident" });
    await tk(w, { ticketId: "C1", org: "9999", created: "2026-06-08", type: "problem" });
    const bb = await fakeBatch(admin.id, "bugs-vfs");
    const bug = async (wid: string, isBug = true) => {
      const wi = await prisma.workItem.create({ data: { product: "VFS", scopeKey: "S", workItemId: wid, firstBatchId: bb.id } });
      const rev = await prisma.workItemRevision.create({ data: { workItemId: wi.id, fingerprint: `f${wid}`, revisionNo: 1, itemType: isBug ? "Bug_" : "Task", isBug, title: `Bug ${wid}`, state: "Active", stateCategory: "ACTIVE", stateKnown: true, batchId: bb.id } });
      await prisma.workItem.update({ where: { id: wi.id }, data: { currentRevisionId: rev.id } });
      return wi;
    };
    const link = (wi: { id: string }, ticket: string, o: { state: string; client?: string | null; group?: string | null; manual?: string | null }) =>
      prisma.workItemLink.create({ data: { workItemId: wi.id, ticketId: ticketKey(ticket), drvState: o.state, drvClientId: o.client ?? null, drvGroupId: o.group ?? null, manualState: o.manual ?? null } });
    const { tkey } = await import("./economia-helpers");
    const ticketKey = tkey;
    const b1 = await bug("101");
    await link(b1, "P1", { state: "RESOLVED_EXTERNAL", client: w.A1.id, group: w.A.id });
    await link(b1, "P2", { state: "RESOLVED_EXTERNAL", client: w.A1.id, group: w.A.id });
    const b2 = await bug("102");
    const b3 = await bug("103");
    await link(b2, "P3", { state: "RESOLVED_EXTERNAL", client: w.A2.id, group: w.A.id });
    await link(b3, "P3", { state: "RESOLVED_EXTERNAL", client: w.A2.id, group: w.A.id });
    const b4 = await bug("104");
    await link(b4, "I1", { state: "RESOLVED_EXTERNAL", client: w.A1.id, group: w.A.id, manual: "REJECTED" }); // rechazado: no confirmado
    const b5 = await bug("105");
    await link(b5, "C1", { state: "CENTRAL_INTERNAL" }); // central interno: contexto, no afecta a la cartera
    const b6 = await bug("106");
    await link(b6, "ZZ9", { state: "PENDING_TICKET" }); // pendiente: fuera del conteo confirmado
    const f = (await fichaOps(Q(), { type: "group", id: w.A.id }))!;
    expect(f.bugs.periods.month).toMatchObject({ bugs: 3, problems: 3, incidents: 0 }); // b1 (2 problemas), b2 y b3 (el mismo problema P3)
    expect(f.bugs.outside).toMatchObject({ rejectedInScope: 1, pendingTicketGlobal: 1, centralInternalGlobal: 1 });
    const onlyP1P2 = (await fichaOps(Q(), { type: "client", id: w.A1.id }))!;
    expect(onlyP1P2.bugs.periods.month).toMatchObject({ bugs: 1, problems: 2 });
    const onlyP3 = (await fichaOps(Q(), { type: "client", id: w.A2.id }))!;
    expect(onlyP3.bugs.periods.month).toMatchObject({ bugs: 2, problems: 1 });
    const det = await bugsDetail(reader.id, Q(), { type: "group", id: w.A.id }, "month", 1);
    expect(det.total).toBe(3);
    expect(det.rows.find((r) => r.workItemId === "101")!.tickets).toHaveLength(2);
  });
});

describe("detalle que concilia", () => {
  it("las horas incluidas concilian exactamente con la cifra; excluidas, pendientes y sin clasificar se consultan aparte; los totales no dependen de la página", async () => {
    const w = await world();
    await tk(w, { ticketId: "T1", org: "9001" });
    await addTicket(w.tb.id, { ticketId: "SIN", entorno: "Otro entorno", org: "9001" });
    for (let i = 1; i <= 7; i++) await addZd({ batchId: bid, date: `2026-06-0${i}`, minutes: 20 * i, groupId: w.A.id, clientId: w.A1.id, ticketId: "T1" });
    await addZd({ batchId: bid, date: "2026-06-09", minutes: 45, groupId: w.A.id, clientId: w.A1.id, ticketId: "SIN" }); // sin servicio
    await addZd({ batchId: bid, date: "2026-06-10", minutes: 15, groupId: w.A.id, ticketId: "T1", eligibility: "EXCLUDED_PMO" });
    await addZd({ batchId: bid, date: "2026-06-11", minutes: 25, groupId: w.A.id, ticketId: "T1", eligibility: "PENDING_ELIGIBILITY" });
    const q = Q();
    const eco = await runEconomics(admin.id, { scope: { type: "groups", ids: [w.A.id] }, service: "SOPORTE", date: q.date, mode: q.mode, now: NOW });
    const card = D(eco.entities[0].periods.cum.hours.perimeterMinutes);
    const ref = { type: "group", id: w.A.id } as const;
    const inc1 = await hoursDetail(reader.id, q, ref, "cum", "incluidas", 1, 5);
    const inc2 = await hoursDetail(reader.id, q, ref, "cum", "incluidas", 2, 5);
    expect(inc1.rows).toHaveLength(5);
    expect(inc2.rows).toHaveLength(2);
    expect(inc1.total).toEqual(inc2.total);
    expect(D(inc1.total.minutes).toString()).toBe(card.toString()); // 560 minutos = cifra de la tarjeta
    expect(inc1.total.rows).toBe(7);
    expect((await hoursDetail(reader.id, q, ref, "cum", "excluidas", 1)).total.minutes).toBe("15");
    expect((await hoursDetail(reader.id, q, ref, "cum", "pendientes", 1)).total.minutes).toBe("25");
    const sc = await hoursDetail(reader.id, q, ref, "cum", "sin_clasificar", 1);
    expect(sc.total.minutes).toBe("45");
    expect(sc.rows[0].service).toBe("SIN_CLASIFICAR");
    expect(inc1.rows[0].origins).toEqual(["ENTORNO"]);
    // los cuatro grupos de horas son disjuntos y suman todas las actividades del ámbito
    const sum = ["incluidas", "excluidas", "pendientes", "sin_clasificar"].reduce(async (acc, m) => (await acc) + Number((await hoursDetail(reader.id, q, ref, "cum", m as "incluidas", 1)).total.rows), Promise.resolve(0));
    expect(await sum).toBe(10);
  });

  it("el detalle de ingreso explica año/categoría, importe anual fuente y contribución imputada, y concilia con la cifra sin sumar doce veces el anual", async () => {
    const w = await world();
    const q = Q({ fecha: "2026-06-15", modo: "CUTOFF" });
    const eco = await runEconomics(admin.id, { scope: { type: "groups", ids: [w.A.id] }, service: "SOPORTE", date: q.date, mode: q.mode, now: NOW });
    const det = await incomeDetail(reader.id, q, w.A.id, "cum", 1);
    expect(det.totalContribution).toBe(eco.entities[0].periods.cum.revenue.value);
    expect(det.contributions).toHaveLength(1);
    expect(det.contributions[0]).toMatchObject({ year: 2026, annualSource: "12000", state: "AVAILABLE", monthsFactor: "5.5" });
    expect(det.contributions[0].contribution).toBe("5500");
    const jun = await incomeDetail(reader.id, q, w.A.id, "2026-06", 1);
    expect(jun.totalContribution).toBe("500"); // 12000/12 × 15/30
    const prev = await incomeDetail(reader.id, q, w.A.id, "2025-06", 1);
    expect(prev.contributions[0]).toMatchObject({ year: 2025, annualSource: "12000" });
    await expect(incomeDetail(reader.id, q, w.A.id, "2024-06", 1)).rejects.toThrow(/fuera del periodo/);
    await expect(incomeDetail(reader.id, q, w.A.id, "no-es-un-periodo", 1)).rejects.toThrow(/Periodo no válido/);
  });

  it("si cambian los datos entre el agregado y el detalle, el sello difiere y el detalle es una lectura nueva", async () => {
    const w = await world();
    await tk(w, { ticketId: "T1", org: "9001" });
    await addZd({ batchId: bid, date: "2026-06-10", minutes: 60, groupId: w.A.id, ticketId: "T1" });
    const port = await getPortfolio(admin.id, Q());
    const before = await hoursDetail(reader.id, Q({ sello: port.economics.reference.dataStamp.stamp }), { type: "group", id: w.A.id }, "cum", "incluidas", 1);
    expect(before.reference.stamp).toBe(port.economics.reference.dataStamp.stamp);
    await addZd({ batchId: bid, date: "2026-06-11", minutes: 60, groupId: w.A.id, ticketId: "T1" });
    const after = await hoursDetail(reader.id, Q(), { type: "group", id: w.A.id }, "cum", "incluidas", 1);
    expect(after.reference.stamp).not.toBe(port.economics.reference.dataStamp.stamp);
    expect(after.total.minutes).toBe("120");
  });
});

describe("selector de entidades", () => {
  it("busca en servidor por Grupo / Cliente / implantación con paginación y escapa comodines", async () => {
    const w = await world();
    await prisma.implementation.create({ data: { clientId: w.A1.id, name: "Alfa producción" } });
    await addClient("100%_raro", null);
    const r = await searchEntitiesView(reader.id, "alfa", 1);
    expect(r.rows.map((x) => `${x.type}:${x.name}`)).toEqual(["group:Alfa", "client:Alfa 1", "client:Alfa 2", "implementation:Alfa producción"]);
    expect((await searchEntitiesView(reader.id, "%", 1)).total).toBe(1); // el comodín del usuario no coincide con todo
    expect((await searchEntitiesView(reader.id, "", 1)).total).toBeGreaterThan(5);
  });
});

describe("CSV de la cartera y de la ficha", () => {
  it("exporta la cartera COMPLETA filtrada (no la página), mismas columnas por fila, desconocido distinto de cero y sin fórmulas ejecutables", async () => {
    const w = await world();
    await prisma.clientGroup.update({ where: { id: w.B.id }, data: { name: "=CMD|' /C calc'!A0" } });
    await prisma.clientGroup.createMany({ data: Array.from({ length: 27 }, (_, i) => ({ name: `Extra ${String(i).padStart(2, "0")}` })) });
    await tk(w, { ticketId: "T1", org: "9001" });
    await addZd({ batchId: bid, date: "2026-06-10", minutes: 600, groupId: w.A.id, ticketId: "T1" });
    const q = Q({ tam: "25" });
    const csv = await portfolioCsv(reader.id, q);
    expect(csv.rows).toBe(30);
    expect(csv.body.startsWith("﻿")).toBe(true);
    const recs = parse(csv.body.slice(1), { delimiter: ";", skip_empty_lines: true }) as string[][];
    const header = recs[0];
    expect(recs.slice(1).every((r) => r.length === header.length)).toBe(true);
    expect(recs.length - 1).toBe(30 * 5 + 5);
    const col = (name: string) => header.indexOf(name);
    const alfaMes = recs.find((r) => r[col("grupo_cliente")] === "Alfa" && r[col("periodo")] === "mes_seleccionado")!;
    expect(alfaMes[col("eur_jornada")]).toBe("800");
    expect(alfaMes[col("modo")]).toBe("mes completo");
    expect(alfaMes[col("sello_datos")]).toMatch(/^[0-9a-f]{16}$/);
    const gamma = recs.find((r) => r[col("grupo_cliente")] === "Gamma" && r[col("periodo")] === "mes_seleccionado")!;
    expect(gamma[col("eur_jornada")]).toBe(""); // desconocido ≠ cero
    expect(gamma[col("estado_ratio")]).toBe("NOT_COMPUTABLE");
    expect(gamma[col("horas")]).toBe("0"); // cero confirmado
    const inj = recs.find((r) => r[col("grupo_cliente")].includes("CMD"))!;
    expect(inj[col("grupo_cliente")].startsWith("'=")).toBe(true);
    expect(recs.some((r) => r[col("fila")] === "CARTERA" && r[col("periodo")] === "cum_actual")).toBe(true);
    // filtrado: solo las filas del conjunto
    const only = await portfolioCsv(reader.id, Q({ q: "alfa" }));
    expect(only.rows).toBe(1);
    await expect(portfolioCsv("no-existe", q)).rejects.toThrow();
  });
  it("la ficha exporta series (periodos y meses de ambos años), dedicación, PAP y tickets con las mismas cifras que la pantalla", async () => {
    const w = await world();
    await tk(w, { ticketId: "T1", org: "9001", created: "2026-06-05" });
    await addZd({ batchId: bid, date: "2026-06-10", minutes: 600, groupId: w.A.id, clientId: w.A1.id, ticketId: "T1", teamId: w.cs.id });
    const ref = { type: "group", id: w.A.id } as const;
    const s = await fichaCsv(reader.id, Q(), ref, "series");
    const recs = parse(s!.body.slice(1), { delimiter: ";", skip_empty_lines: true }) as string[][];
    const h = recs[0];
    expect(recs.slice(1).every((r) => r.length === h.length)).toBe(true);
    const kinds = recs.slice(1).map((r) => r[h.indexOf("serie")]);
    expect(kinds.filter((k) => k === "PERIODO")).toHaveLength(5);
    expect(kinds.filter((k) => k === "MENSUAL_ACTUAL")).toHaveLength(6);
    expect(kinds.filter((k) => k === "MENSUAL_ANTERIOR_COMPARABLE")).toHaveLength(6);
    const mes = recs.find((r) => r[h.indexOf("serie")] === "PERIODO" && r[h.indexOf("periodo")] === "mes_seleccionado")!;
    const ficha = (await getFicha(reader.id, Q(), ref))!;
    expect(mes[h.indexOf("eur_jornada")]).toBe(ficha.entity.periods.month.perDay.value!.replace(".", ","));
    for (const t of ["dedicacion", "pap", "tickets"] as const) {
      const x = await fichaCsv(reader.id, Q(), ref, t);
      const rr = parse(x!.body.slice(1), { delimiter: ";", skip_empty_lines: true }) as string[][];
      expect(rr.slice(1).every((r) => r.length === rr[0].length)).toBe(true);
    }
    expect(await fichaCsv(reader.id, Q(), { type: "group", id: "inexistente-123" }, "series")).toBeNull();
  });
});

describe("lectura coherente con dos conexiones y barreras", () => {
  it("una escritura concurrente (sustitución financiera, usuarios y atribución) no mezcla estados: la respuesta es toda la anterior y la siguiente toda la nueva", async () => {
    const w = await world();
    await tk(w, { ticketId: "T1", org: "9001" });
    await addZd({ batchId: bid, date: "2026-06-10", minutes: 600, groupId: w.A.id, clientId: w.A1.id, ticketId: "T1" });
    await setUsers(admin.id, { groupId: w.A.id }, 2026, Array(12).fill(10));
    const key = (v: Awaited<ReturnType<typeof getFicha>>) => {
      const m = v!.entity.periods.month;
      return { revenue: m.revenue.value, hours: m.hours.inPerimeter, users: m.users.stock.value, perDay: m.perDay.value };
    };
    const before = key(await getFicha(admin.id, Q(), { type: "group", id: w.A.id }));
    expect(before).toEqual({ revenue: "1000", hours: "10", users: 10, perDay: "800" });
    let writes: Promise<void> | null = null;
    let gate!: () => void;
    const released = new Promise<void>((r) => (gate = r));
    setSnapshotTestHook(async (point) => {
      if (point !== "ficha:after-context") return;
      // Otra conexión confirma los tres cambios mientras la lectura ya tomó su instantánea y aún no ha leído el motor.
      writes = (async () => {
        await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: w.A.id, income: "24000" }, { groupId: w.B.id, income: "6000" }, { groupId: w.C.id, income: "3000" }]);
        await prisma.userMatrixMonth.updateMany({ data: { value: 20 } });
        await prisma.zdTimeEntry.updateMany({ data: { drvGroupId: w.B.id } });
        gate();
      })();
      await released; // los cambios están confirmados antes de que la lectura continúe
    });
    const during = key(await getFicha(admin.id, Q(), { type: "group", id: w.A.id }));
    await writes;
    expect(during).toEqual(before); // instantánea anterior completa: ni ingreso nuevo, ni usuarios nuevos, ni horas reatribuidas
    setSnapshotTestHook(null);
    const after = key(await getFicha(admin.id, Q(), { type: "group", id: w.A.id }));
    expect(after).toEqual({ revenue: "2000", hours: "0", users: 20, perDay: null });
    // la misma barrera sobre la cartera: el sello distingue ambos estados
    const p0 = await getPortfolio(admin.id, Q());
    expect(p0.economics.reference.dataStamp.stamp).not.toBe("");
  });
});
