import { beforeEach, describe, expect, it } from "vitest";
import { parse } from "csv-parse/sync";
import { prisma } from "@/lib/db";
import { Dec } from "@/domain/finance";
import { INCIDENT_APP_CAUSES } from "@/domain/zendesk";
import { defaultPulseConfig, type PulseConfig } from "@/domain/pulse-catalog";
import { distribution } from "@/domain/pulse-stats";
import { parsePulseQuery, type PulseQuery } from "@/domain/pulse-query";
import { activateDraft, saveDraft } from "@/server/pulse/config";
import { getPulse } from "@/server/pulse/service";
import { pulseDetail } from "@/server/pulse/detail";
import { pulseCsv } from "@/server/pulse/export";
import { resetDatabase, makeUsers } from "./helpers";
import { addClient, addGroup, addTicket, addWrike, addZd, fakeBatch, seedFinance, serviceAssignment, setUsers } from "./economia-helpers";
import { declareAllSources } from "./calidad-helpers";

/**
 * Pulse Rent (CSAPP-07): servicio analítico sobre PostgreSQL real con datos SINTÉTICOS. Corte 31/10/2026 (mes completo, CUM enero-octubre).
 */
let admin: { id: string };
let reader: { id: string };
let bid: string;
beforeEach(async () => {
  await resetDatabase();
  ({ admin, reader } = await makeUsers());
  bid = (await fakeBatch(admin.id)).id;
  await declareAllSources(admin.id); // cobertura declarada de las cuatro fuentes (contrato compartido con Calidad, CSAPP-08)
});

const NOW = new Date("2026-11-02T09:00:00Z");
const Q = (extra: Record<string, string> = {}): PulseQuery => parsePulseQuery({ fecha: "2026-10-31", modo: "FULL_MONTH", m: "M01,M02,M03,M04,M07,M10,M11,M12,M13,M14,M15,M16,M17,M18,M19,M20,M21,M22,M23,M30,M31,M32,M37", ...extra }, NOW).query;
const D = (v: string) => Dec.parse(v) as Dec;
const APP_CAUSE = INCIDENT_APP_CAUSES[0];

type W = Awaited<ReturnType<typeof world>>;
async function world() {
  const cs = await prisma.staffCatalogItem.create({ data: { kind: "TEAM", name: "CS" } });
  const n1 = await prisma.staffCatalogItem.create({ data: { kind: "LEVEL", name: "N1" } });
  const n2 = await prisma.staffCatalogItem.create({ data: { kind: "LEVEL", name: "N2" } });
  const gs = [] as { id: string; name: string }[];
  const clients = [] as { id: string }[];
  const names = ["Atlas", "Boreal", "Cénit", "Delta", "Eco"];
  for (const [i, n] of names.entries()) {
    const g = await addGroup(n);
    const c = await addClient(`${n} 1`, g.id);
    await prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: `70${i}`, searchValue: `70${i}`, clientId: c.id } });
    gs.push(g);
    clients.push(c);
  }
  const term = (attribute: "SUPPORT" | "HOSTING", value: string, groupId?: string, clientId?: string) => prisma.serviceTerm.create({ data: { attribute, value, groupId, clientId } });
  await term("SUPPORT", "GOLD", gs[0].id); await term("HOSTING", "OP", gs[0].id);
  await term("SUPPORT", "GOLD", gs[1].id); await term("HOSTING", "OP", gs[1].id);
  await term("SUPPORT", "PLATINUM", gs[2].id); await term("HOSTING", "CLOUD", gs[2].id);
  await term("SUPPORT", "SILVER_RECURRENTE", gs[3].id); await term("HOSTING", "OP", gs[3].id);
  // Eco: plan mezclado a nivel de Cliente (Gold y Platinum): no es homogéneo.
  const eco2 = await addClient("Eco 2", gs[4].id);
  await term("SUPPORT", "GOLD", undefined, clients[4].id); await term("SUPPORT", "PLATINUM", undefined, eco2.id); await term("HOSTING", "OP", gs[4].id);
  await serviceAssignment({ matchKind: "ENTORNO", matchValue: "soporte", service: "SOPORTE" });
  await serviceAssignment({ matchKind: "WRIKE_PROJECT", matchValue: "pmo atlas", service: "SOPORTE" });
  const tb = await fakeBatch(admin.id);
  // Perfiles canónicos configurados y activados por el Administrador (revisión 2).
  const cfg: PulseConfig = { ...defaultPulseConfig(), profiles: { CS_N1: [{ teamId: cs.id, levelId: n1.id, pmo: null }], CS_N2: [{ teamId: cs.id, levelId: n2.id, pmo: null }], PMO_N3: [{ teamId: null, levelId: null, pmo: true }] } };
  const d = await saveDraft(admin.id, "PULSE", cfg, { expectedVersion: null });
  await activateDraft(admin.id, "PULSE", { expectedRevisionNo: 1, expectedDraftVersion: d.version, reason: "Perfiles de prueba" });
  return { cs, n1, n2, gs, clients, tb };
}
let tn = 0;
async function hours(w: W, gi: number, o: { profile?: "n1" | "n2"; minutes: number; cause?: string | null; date?: string; dest?: string[] }) {
  tn++;
  const t = `P${tn}`;
  await addTicket(w.tb.id, { ticketId: t, entorno: "Soporte", org: `70${gi}`, cause: o.cause === undefined ? APP_CAUSE : o.cause, created: o.date ?? "2026-05-10", destinations: o.dest ?? [] });
  await addZd({ batchId: bid, date: o.date ?? "2026-05-12", minutes: o.minutes, groupId: w.gs[gi].id, clientId: w.clients[gi].id, ticketId: t, teamId: w.cs.id, levelId: (o.profile === "n2" ? w.n2 : w.n1).id });
  return t;
}
async function users(w: W, gi: number, values: (number | null)[]) {
  await setUsers(admin.id, { groupId: w.gs[gi].id }, 2026, values);
}
const row = (v: Awaited<ReturnType<typeof getPulse>>, name: string) => v.rows.find((r) => r.name === name)!;

describe("normalización y exposición", () => {
  it("65 hasta mayo y 68 desde junio: 665 usuarios mes y stock 68; horas registradas NO se prorratean", async () => {
    const w = await world();
    await users(w, 0, [65, 65, 65, 65, 65, 68, 68, 68, 68, 68, null, null]);
    await hours(w, 0, { minutes: 600 }); // 10 h N1 incidente
    await hours(w, 0, { minutes: 300, cause: "Sistemas del Cliente" }); // 5 h N1 otro
    const v = await getPulse(admin.id, Q());
    const a = row(v, "Atlas");
    expect(a.cells.M17.value).toBe("68"); // stock del mes del corte
    expect(a.cells.M01.raw).toBe("15");
    expect(a.cells.M01.state).toBe("OK");
    expect(a.cells.M01.value).toBe(D("15").mulInt(12).div(D("665")).toString()); // 12 × H / UM con UM = 665
    expect(a.cells.M01.denominator).toBe("665");
    expect(a.cells.M02.raw).toBe("10");
    expect(a.cells.M03.raw).toBe("5");
    // Modo «por mes»: H / UM; bruto: sin normalizar.
    const mes = row(await getPulse(admin.id, Q({ norm: "periodo" })), "Atlas");
    expect(mes.cells.M01.value).toBe(D("15").div(D("665")).toString());
    const bruto = row(await getPulse(admin.id, Q({ norm: "bruto" })), "Atlas");
    expect(bruto.cells.M01.value).toBe("15");
  });
  it("un mes sin informar no se rellena con cero: no hay ratio por usuario, el bruto sí", async () => {
    const w = await world();
    await users(w, 1, [10, 10, null, 10, 10, 10, 10, 10, 10, 10, null, null]);
    await hours(w, 1, { minutes: 600 });
    const b = row(await getPulse(admin.id, Q()), "Boreal");
    expect(b.cells.M01.state).toBe("NO_DATA");
    expect(b.cells.M01.value).toBeNull();
    expect(b.cells.M01.raw).toBe("10");
    expect(b.cells.M01.reason).toMatch(/usuarios/i);
    expect(row(await getPulse(admin.id, Q({ norm: "bruto" })), "Boreal").cells.M01.value).toBe("10");
  });
  it("equivalencia histórica: separada de la correcta; difieren cuando cambian los usuarios y no se activa en corte parcial", async () => {
    const w = await world();
    await users(w, 0, [65, 65, 65, 65, 65, 68, 68, 68, 68, 68, null, null]);
    await hours(w, 0, { minutes: 600 });
    const correct = row(await getPulse(admin.id, Q()), "Atlas").cells.M01.value as string;
    const hist = row(await getPulse(admin.id, Q({ historico: "1" })), "Atlas").cells.M01;
    expect(hist.value).toBe(D("10").mulInt(12).div(D("68").mulInt(10)).toString()); // H_CUM / U_corte / nº mes × 12
    expect(hist.value).not.toBe(correct);
    const partial = row(await getPulse(admin.id, Q({ historico: "1", fecha: "2026-10-15", modo: "CUTOFF" })), "Atlas").cells.M01;
    expect(partial.value).toBeNull();
    expect(partial.reason).toMatch(/parcial/i);
  });
});

describe("perfiles, fuentes y cobertura", () => {
  it("un perfil sin configurar nunca devuelve cero; una fuente ausente impide publicar un cero", async () => {
    const w = await world();
    await users(w, 0, Array(12).fill(10));
    await hours(w, 0, { minutes: 120 });
    const v = await getPulse(admin.id, Q({ m: "M01,M24,M07" }));
    const a = row(v, "Atlas");
    expect(a.cells.M24.state).toBe("UNCONFIGURED"); // IT N3 sin selección
    expect(a.cells.M24.value).toBeNull();
    expect(v.unconfiguredProfiles).toEqual(expect.arrayContaining(["IT_N3", "PLATAFORMA_N4"]));
    // PMO configurado pero sin cobertura declarada de Wrike en 2026 (aquí su lote queda revertido: no prueba cobertura): 0 NO es evidencia.
    await prisma.uploadBatch.updateMany({ where: { profileId: "wrike" }, data: { status: "REVERTED" } });
    const v2 = await getPulse(admin.id, Q({ m: "M01,M24,M07" }));
    const a2 = row(v2, "Atlas");
    expect(a.cells.M07.state).toBe("ZERO"); // con la cobertura declarada, el cero sí está sustentado
    expect(a2.cells.M07.state).toBe("NO_DATA");
    expect(a2.cells.M07.value).toBeNull();
    expect(a2.cells.M07.reason).toMatch(/Wrike/);
  });
  it("PMO elegible con rol desconocido permanece en el total PMO; sin clasificar: total completo y variantes como cota", async () => {
    const w = await world();
    await users(w, 0, Array(12).fill(10));
    await hours(w, 0, { minutes: 300 });
    await hours(w, 0, { minutes: 120, cause: null }); // sin causa: sin clasificar
    await addWrike({ batchId: bid, date: "2026-06-15", minutes: 360, groupId: w.gs[0].id, clientId: w.clients[0].id, project: "PMO Atlas", pmo: true, roleId: null });
    const a = row(await getPulse(admin.id, Q({ norm: "bruto", m: "M01,M02,M03,M32,M07" })), "Atlas");
    expect(a.cells.M01.value).toBe("7"); // 5 h + 2 h: el total es completo
    expect(a.cells.M02.state).toBe("PARTIAL"); // cota inferior por 2 h sin clasificar
    expect(a.cells.M02.reason).toMatch(/sin clasificar/);
    expect(a.cells.M32.value).toBe("2");
    expect(a.cells.M07.value).toBe("6");
  });
});

describe("referencias y estadística reproducible", () => {
  async function five(w: W) {
    for (let i = 0; i < 5; i++) await users(w, i, Array(12).fill(10));
    // Atlas 10 h, Boreal 20 h, Cénit 30 h, Delta 40 h; Eco sin horas pero con usuarios.
    for (const [i, h] of [[0, 10], [1, 20], [2, 30], [3, 40]] as const) await hours(w, i, { minutes: h * 60 });
  }
  it("[0,10,20,30] reproduce P10=3, P25=7,5, mediana=15, P75=22,5, P90=27 y media=15 en una columna real", async () => {
    const w = await world();
    for (let i = 0; i < 5; i++) await users(w, i, Array(12).fill(10));
    // UM = 100 (10 usuarios × 10 meses): H / UM por mes. 5 grupos, 4 con horas; cero confirmado de Eco participa en la referencia.
    for (const [i, h] of [[0, 0], [1, 10], [2, 20], [3, 30]] as const) if (h > 0) await hours(w, i, { minutes: h * 60 });
    await hours(w, 4, { minutes: 60 }); // Eco: una hora (para que exista el ticket y la fuente)
    const v = await getPulse(admin.id, Q({ norm: "bruto", m: "M01", ref: "gold_op" }));
    // gold_op: Atlas (0 h → cero confirmado, Atlas sin horas), Boreal 10 h… solo dos grupos Gold OP: comprobamos con todos.
    const todos = await getPulse(admin.id, Q({ norm: "bruto", m: "M01", ref: "todos" }));
    const s = todos.stats.M01;
    expect(s.n).toBe(5);
    const expected = distribution([0, 10, 20, 30, 1].map((x) => ({ value: D(String(x)) })));
    expect(s.median).toBe(expected.median);
    expect(s.p10).toBe(expected.p10);
    expect(s.mean).toBe(expected.mean);
    expect(v.stats.M01.n).toBe(2); // gold_op: Atlas y Boreal
  });
  it("buscar, ocultar, ordenar y paginar NO cambian la referencia; cambiar de referencia sí", async () => {
    const w = await world();
    await five(w);
    const base = await getPulse(admin.id, Q({ norm: "bruto", m: "M01" }));
    const filtered = await getPulse(admin.id, Q({ norm: "bruto", m: "M01", q: "boreal", tam: "25", orden: "M01", dir: "desc" }));
    expect(filtered.rows.map((r) => r.name)).toEqual(["Boreal"]);
    expect(filtered.stats.M01).toEqual(base.stats.M01);
    const page2 = await getPulse(admin.id, Q({ norm: "bruto", m: "M01", tam: "25", pagina: "9" }));
    expect(page2.stats.M01).toEqual(base.stats.M01);
    // Con soporte filtrado en las FILAS, la referencia sigue siendo todo el conjunto.
    const rowsGold = await getPulse(admin.id, Q({ norm: "bruto", m: "M01", soporte: "GOLD" }));
    expect(rowsGold.filteredEntities).toBeLessThan(base.filteredEntities);
    expect(rowsGold.stats.M01).toEqual(base.stats.M01);
    const gold = await getPulse(admin.id, Q({ norm: "bruto", m: "M01", ref: "gold_op" }));
    expect(gold.stats.M01.n).toBe(2);
    expect(gold.stats.M01).not.toEqual(base.stats.M01);
    // «Usar filtros visibles como referencia» es una acción explícita: criterios copiados en `ref=custom` y distinguibles.
    const custom = await getPulse(admin.id, Q({ norm: "bruto", m: "M01", ref: "custom", rsoporte: "GOLD", ralojamiento: "OP", rhomog: "1", q: "atlas" }));
    expect(custom.reference.origin).toBe("PERSONALIZADA");
    expect(custom.stats.M01.n).toBe(2);
    expect(custom.rows.map((r) => r.name)).toEqual(["Atlas"]);
  });
  it("«sin Silver» exige plan conocido; los homogéneos excluyen mezclas con motivo; la propia entidad cuenta una vez", async () => {
    const w = await world();
    await five(w);
    const sinSilver = await getPulse(admin.id, Q({ norm: "bruto", m: "M01", ref: "sin_silver" }));
    // Delta (Silver recurrente) fuera; Eco (Gold+Platinum, ninguno Silver) dentro.
    expect(sinSilver.reference.exclusions.map((e) => e.reason).join()).toMatch(/Silver/);
    expect(sinSilver.stats.M01.n).toBe(4); // Atlas, Boreal, Cénit y Eco (cero confirmado con fuente presente participa); Delta (Silver) queda fuera
    const goldOp = await getPulse(admin.id, Q({ norm: "bruto", m: "M01", ref: "gold_op" }));
    expect(goldOp.reference.exclusions.some((e) => /mezclado|fuera de la referencia/.test(e.reason))).toBe(true);
    expect(goldOp.reference.members).toBe(2);
    // El N válido puede diferir por columna: Eco tiene usuarios pero M18 (economía) sin ingreso.
    expect(goldOp.stats.M01.n).toBe(2);
  });
});

describe("economía: cartera frente a media de ratios", () => {
  it("1000/10 h y 1000/30 h: la cartera es 400 €/jornada y NO la media de ratios; cero horas conserva el ingreso", async () => {
    const w = await world();
    // Ingreso anual 1200 → CUM enero-octubre = 1000.
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: w.gs[0].id, income: "1200" }, { groupId: w.gs[1].id, income: "1200" }, { groupId: w.gs[2].id, income: "1200" }]);
    await seedFinance(admin.id, "SOPORTE", 2025, [{ groupId: w.gs[0].id, income: "1200" }]);
    for (let i = 0; i < 3; i++) await users(w, i, Array(12).fill(10));
    await hours(w, 0, { minutes: 600 });
    await hours(w, 1, { minutes: 1800 });
    // Cénit: ingreso 1000 y cero horas: el ingreso permanece en la cartera (no bloquea).
    const v = await getPulse(admin.id, Q({ m: "M18,M19,M20,M10", ref: "todos" }));
    const a = row(v, "Atlas");
    const b = row(v, "Boreal");
    expect(a.cells.M18.value).toBe("800");
    expect(b.cells.M18.value).toBe(D("1000").mulInt(60).mul(D("8")).div(D("1800")).toString());
    expect(row(v, "Cénit").cells.M18.state).not.toBe("OK"); // ingreso positivo con cero horas: sin ratio, nunca infinito
    // Cero horas NO bloquea: el ingreso de Cénit (1000) permanece en la cartera → ΣR = 3000, ΣH = 40 h → 3000/40 × 8 = 600 €/jornada.
    expect(v.economicReference?.portfolio.complete).toBe(true);
    expect(v.economicReference?.portfolio.perDay).toBe("600");
    expect(a.cells.M20.value).toBe(D("600").sub(D("800")).div(D("600")).toString());
    // TAR RUN: 12 R / UM = 12 × 1000 / 100 = 120.
    expect(a.cells.M10.value).toBe("120");
  });
  it("cartera completa de dos grupos: ΣR/ΣH×jornada = 400 y la media aritmética de ratios es distinta", async () => {
    const w = await world();
    await seedFinance(admin.id, "SOPORTE", 2026, w.gs.map((g, i) => ({ groupId: g.id, income: i < 2 ? "1200" : "0" })));
    await seedFinance(admin.id, "SOPORTE", 2025, w.gs.map((g) => ({ groupId: g.id, income: "0" })));
    for (let i = 0; i < 5; i++) await users(w, i, Array(12).fill(10));
    await hours(w, 0, { minutes: 600 });
    await hours(w, 1, { minutes: 1800 });
    await hours(w, 2, { minutes: 60 });
    await hours(w, 3, { minutes: 60 });
    await hours(w, 4, { minutes: 60 });
    const v = await getPulse(admin.id, Q({ m: "M18,M20", ref: "custom", rsoporte: "GOLD", ralojamiento: "OP", rhomog: "1" }));
    expect(v.economicReference?.groups).toBe(2);
    expect(v.economicReference?.portfolio.perDay).toBe("400");
    expect(v.economicReference?.meanOfRatios).toBe(D("800").add(D("1000").mulInt(60).mul(D("8")).div(D("1800"))).divInt(2).toString());
    expect(v.economicReference?.meanOfRatios).not.toBe("400");
    expect(row(v, "Atlas").cells.M20.value).toBe("-1"); // (400 − 800) / 400
  });
});

describe("cobertura económica", () => {
  it("un conjunto financiero ausente deja la cartera incompleta: no se publica como AVAILABLE ni se rellena con cero", async () => {
    const w = await world();
    for (let i = 0; i < 2; i++) await users(w, i, Array(12).fill(10));
    await hours(w, 0, { minutes: 600 });
    await hours(w, 1, { minutes: 600 });
    const v = await getPulse(admin.id, Q({ m: "M18,M19,M20" }));
    expect(v.economicReference?.portfolio.complete).toBe(false);
    expect(v.economicReference?.portfolio.perDay).toBeNull();
    const a = row(v, "Atlas");
    expect(a.cells.M18.state).toBe("NO_DATA");
    expect(a.cells.M19.value).toBeNull();
    expect(a.cells.M20.value).toBeNull();
  });
});

describe("ámbitos", () => {
  it("Cliente sin ingreso propio no hereda el del grupo; las operativas usan los usuarios propios del ámbito", async () => {
    const w = await world();
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: w.gs[0].id, income: "12000" }]);
    await setUsers(admin.id, { groupId: w.gs[0].id }, 2026, Array(12).fill(100));
    await setUsers(admin.id, { clientId: w.clients[0].id }, 2026, Array(12).fill(40)); // usuarios compartidos: el grupo conserva su total propio
    await hours(w, 0, { minutes: 600 });
    const v = await getPulse(admin.id, Q({ ambito: "client", m: "M01,M10,M18,M17", norm: "periodo" }));
    const c = row(v, "Atlas 1");
    expect(c.cells.M10.state).toBe("NA");
    expect(c.cells.M18.state).toBe("NA");
    expect(c.cells.M17.value).toBe("40");
    expect(c.cells.M01.value).toBe(D("10").div(D("400")).toString()); // 10 h / (40 usuarios × 10 meses)
    const g = row(await getPulse(admin.id, Q({ m: "M17" })), "Atlas");
    expect(g.cells.M17.value).toBe("100");
  });
});

describe("PAP y escalados", () => {
  it("N2→N3 usa la intersección sobre N2; dos etiquetas N3 cuentan un ticket; creación no se etiqueta como escalado real", async () => {
    const w = await world();
    await users(w, 0, Array(12).fill(10));
    await hours(w, 0, { minutes: 60, dest: ["CS_N2"] });
    await hours(w, 0, { minutes: 60, dest: ["CS_N2", "PMO_N3", "IT_N3"] }); // dos destinos N3: un ticket
    await hours(w, 0, { minutes: 60, dest: ["CS_N2", "IT_N3"] });
    await hours(w, 0, { minutes: 60, dest: ["PMO_N3"] }); // N3 sin N2: no entra en el numerador de N2→N3
    await hours(w, 0, { minutes: 60, dest: [] });
    const a = row(await getPulse(admin.id, Q({ norm: "bruto", m: "M15,M30,M31" })), "Atlas");
    expect(a.cells.M15.value).toBe(D("200").div(D("3")).toString()); // 2 de 3 tickets con N2
    expect(a.cells.M15.numerator).toBe("2");
    expect(a.cells.M15.denominator).toBe("3");
    expect(a.cells.M30.value).toBe("3"); // tickets únicos con destino N3
    expect(a.cells.M31.value).toBe("60"); // 3 de 5
    // Sin tickets con N2: denominador cero, no calculable (no cero).
    const e = row(await getPulse(admin.id, Q({ norm: "bruto", m: "M15" })), "Boreal");
    expect(e.cells.M15.value).toBeNull();
  });
  it("PAP: un PAP con varias causas cuenta una vez; correctivo estándar/proyecto/origen cliente; evolutivo no se supone no facturable", async () => {
    const w = await world();
    await users(w, 0, Array(12).fill(10));
    const pb = await fakeBatch(admin.id, "pap");
    const mk = async (id: string, state: string, causes: { cat: string; origin: string | null }[]) => {
      const it = await prisma.papItem.create({ data: { listKey: "L1", papId: id, firstBatchId: pb.id, drvScope: "GROUP_ONLY", drvGroupId: w.gs[0].id } });
      const rev = await prisma.papRevision.create({ data: { itemId: it.id, fingerprint: `f${id}`, revisionNo: 1, title: `PAP ${id}`, result: "OK", productionDate: new Date("2026-07-10T00:00:00Z"), correctiveState: state, data: {}, batchId: pb.id } });
      for (const c of causes) await prisma.papCause.create({ data: { revisionId: rev.id, rawToken: `${c.cat}-${c.origin}`, normalized: `${c.cat}-${c.origin}`.toLowerCase(), category: c.cat, origin: c.origin } });
      await prisma.papItem.update({ where: { id: it.id }, data: { currentRevisionId: rev.id } });
    };
    await mk("1", "CORRECTIVE", [{ cat: "CORRECTIVE", origin: "STANDARD" }, { cat: "CORRECTIVE", origin: "CUSTOMIZATION" }]); // dos causas: un PAP, estándar Y proyecto
    await mk("2", "CORRECTIVE", [{ cat: "CORRECTIVE", origin: "CLIENT_ORIGIN" }]);
    await mk("3", "NON_CORRECTIVE", [{ cat: "EVOLUTIVE", origin: null }]);
    const a = row(await getPulse(admin.id, Q({ norm: "bruto", m: "M11,M12,M13,M14,M23,M37" })), "Atlas");
    expect(a.cells.M23.value).toBe("3");
    expect(a.cells.M13.value).toBe("1");
    expect(a.cells.M12.value).toBe("1");
    expect(a.cells.M14.value).toBe("1");
    expect(a.cells.M37.value).toBe("1");
    expect(a.cells.M11.state).toBe("NO_DATA"); // sin evidencia de facturación: no se afirma no facturable
    expect(a.cells.M11.reason).toMatch(/evidencia/);
    const normalized = row(await getPulse(admin.id, Q({ m: "M23" })), "Atlas").cells.M23;
    expect(normalized.value).toBe(D("3").mulInt(1200).div(D("100")).toString()); // 1200 × eventos / UM
  });
});

describe("detalle, CSV y permisos", () => {
  it("el detalle usa el predicado de la métrica y concilia con el numerador; el CSV exporta todas las filas filtradas", async () => {
    const w = await world();
    await users(w, 0, Array(12).fill(10));
    await hours(w, 0, { minutes: 600 }); // N1 incidente
    await hours(w, 0, { minutes: 300, cause: "Sistemas del Cliente" }); // N1 otro
    await hours(w, 0, { minutes: 120, profile: "n2" }); // N2
    const q = Q({ norm: "bruto", m: "M01,M02,M04" });
    const v = await getPulse(admin.id, q);
    const a = row(v, "Atlas");
    const det = async (id: string) => pulseDetail(admin.id, q, a.id, id, 1, 25);
    const d02 = await det("M02");
    expect(d02.total).toBe(1);
    expect(d02.numerator).toBe(a.cells.M02.raw);
    const d01 = await det("M01");
    expect(d01.total).toBe(2);
    expect(d01.numerator).toBe(a.cells.M01.raw);
    expect((await det("M04")).numerator).toBe(a.cells.M04.raw);
    // CSV: BOM, separador, todas las filas aunque la página sea de 1.
    const csv = await pulseCsv(admin.id, { ...q, base: { ...q.base, pageSize: 25 } }, "filas");
    expect(csv.body.startsWith("﻿")).toBe(true);
    const parsed = parse(csv.body.slice(1), { delimiter: ";", columns: true }) as Record<string, string>[];
    expect(parsed.length).toBe(v.filteredEntities);
    expect(Object.keys(parsed[0])).toEqual(expect.arrayContaining(["M01_valor", "M01_estado", "M01_banda", "revision_pulse", "sello_datos"]));
    const stats = parse((await pulseCsv(admin.id, q, "estadisticas")).body.slice(1), { delimiter: ";", columns: true }) as Record<string, string>[];
    expect(stats.map((s) => s.metrica)).toEqual(["M01", "M02", "M04"]);
  });
  it("CSV: neutraliza textos que empiezan por fórmula sin alterar los negativos válidos; un ticket sin horas sigue contando en eventos", async () => {
    const w = await world();
    await prisma.clientGroup.update({ where: { id: w.gs[0].id }, data: { name: "=HYPERLINK(\"x\")" } });
    for (let i = 0; i < 2; i++) await users(w, i, Array(12).fill(10));
    await seedFinance(admin.id, "SOPORTE", 2026, w.gs.map((g) => ({ groupId: g.id, income: "1200" })));
    await seedFinance(admin.id, "SOPORTE", 2025, w.gs.map((g) => ({ groupId: g.id, income: "0" })));
    await hours(w, 0, { minutes: 600 });
    await hours(w, 1, { minutes: 1800 });
    // Ticket con destino N3 y SIN ninguna hora registrada: sigue en los eventos.
    await addTicket(w.tb.id, { ticketId: "SINHORAS", entorno: "Soporte", org: "700", cause: APP_CAUSE, created: "2026-05-10", destinations: ["PMO_N3"] });
    const q = Q({ m: "M20,M30", norm: "bruto", ref: "custom", rsoporte: "GOLD", ralojamiento: "OP", rhomog: "1" });
    const v = await getPulse(admin.id, q);
    expect(row(v, "=HYPERLINK(\"x\")").cells.M30.value).toBe("1");
    const csv = (await pulseCsv(admin.id, q, "filas")).body;
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
    const m20 = row(v, "=HYPERLINK(\"x\")").cells.M20.value as string;
    expect(Dec.parse(m20)!.sign()).toBeLessThan(0);
    expect(csv).toContain(`;${m20.replace(".", ",")};`); // el negativo conserva su signo y sigue siendo número
  });
  it("Consulta lee; un actor inexistente no", async () => {
    await world();
    expect((await getPulse(reader.id, Q())).totalEntities).toBe(5);
    await expect(getPulse("no-existe", Q())).rejects.toThrow();
  });
});
