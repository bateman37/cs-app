import { beforeEach, describe, expect, it } from "vitest";
import { parse } from "csv-parse/sync";
import { prisma } from "@/lib/db";
import { Dec } from "@/domain/finance";
import { comparativaParams, parseComparativaQuery, COMPARATIVA_PAGE_SIZE } from "@/domain/comparativa-query";
import { getPortfolio, getPortfolioAll, usersTariffTotal } from "@/server/analytics/portfolio";
import { portfolioCsv } from "@/server/analytics/export";
import { resetDatabase, makeUsers } from "./helpers";
import { addClient, addGroup, addTicket, addZd, fakeBatch, seedFinance, serviceAssignment, setUsers } from "./economia-helpers";

/**
 * HOTFIX-02 §6–7 (agente B): dos filtros de negocio (Soporte/Servidor) con AND en el MISMO Cliente, Grupo incluido = cifras del Grupo entero,
 * totales ponderados de todo el filtrado, URL limpia de parámetros antiguos y CSV = pantalla.
 */
let admin: { id: string };
beforeEach(async () => {
  await resetDatabase();
  ({ admin } = await makeUsers());
});

const NOW = new Date("2026-10-30T10:00:00Z");
const Q = (extra: Record<string, string> = {}) => parseComparativaQuery({ fecha: "2026-06-30", modo: "FULL_MONTH", ...extra }, NOW).query;
const term = (attribute: "SUPPORT" | "HOSTING", value: string, clientId: string) => prisma.serviceTerm.create({ data: { attribute, value, clientId } });

async function world() {
  const A = await addGroup("Alfa");
  const B = await addGroup("Beta");
  const C = await addGroup("Gamma");
  const A1 = await addClient("Alfa 1", A.id);
  const A2 = await addClient("Alfa 2", A.id);
  const B1 = await addClient("Beta 1", B.id);
  // Alfa: A1 = Gold+OP, A2 = Silver Recurrente+CLOUD (Gold y CLOUD existen en el Grupo pero NO en el mismo Cliente). Beta: Gold+CLOUD. Gamma: sin atributos.
  await term("SUPPORT", "GOLD", A1.id);
  await term("HOSTING", "OP", A1.id);
  await term("SUPPORT", "SILVER_RECURRENTE", A2.id);
  await term("HOSTING", "CLOUD", A2.id);
  await term("SUPPORT", "GOLD", B1.id);
  await term("HOSTING", "CLOUD", B1.id);
  await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: A.id, income: "12000" }, { groupId: B.id, income: "6000" }, { groupId: C.id, income: "3000" }]);
  await serviceAssignment({ matchKind: "ENTORNO", matchValue: "soporte", service: "SOPORTE" });
  const tb = await fakeBatch(admin.id);
  const bid = (await fakeBatch(admin.id)).id;
  await addTicket(tb.id, { ticketId: "T1", org: "9001", entorno: "Soporte" });
  await addZd({ batchId: bid, date: "2026-06-10", minutes: 600, groupId: A.id, clientId: A1.id, ticketId: "T1" });
  await addZd({ batchId: bid, date: "2026-06-11", minutes: 300, groupId: A.id, ticketId: "T1" }); // solo Grupo: no se pierde al filtrar
  await addZd({ batchId: bid, date: "2026-06-10", minutes: 1800, groupId: B.id, clientId: B1.id, ticketId: "T1" });
  return { A, B, C, A1, A2, B1 };
}
const names = (v: { rows: { meta: { name: string } }[] }) => v.rows.map((r) => r.meta.name);

describe("URL de la vista normal: parámetros antiguos no filtran ni se propagan", () => {
  it("ignora cualquier clave heredada y solo conserva periodo, Soporte, Servidor, orden y página", () => {
    const raw = { fecha: "2026-06-30", modo: "FULL_MONTH", soporte: "gold,NOPE", servidor: "op", q: "alfa", servicio: "TOTAL", complejidad: "BASIC", producto: "X", estado: "inactivos", cobertura: "parcial", revision: "3", tam: "200", bloques: "mes", ref: "cum", pestana: "datos", alojamiento: "CLOUD", orden: "cum.revenue", dir: "desc", pagina: "2" };
    const { query, filters } = parseComparativaQuery(raw, NOW);
    // HOTFIX-03 §7: `estado` es ahora un parámetro explícito y válido (ya no se ignora); el resto de claves heredadas siguen ignorándose.
    expect(filters).toEqual({ soporte: ["GOLD"], servidor: ["OP"], estado: "inactivos" });
    expect(query).toMatchObject({ service: "SOPORTE", revision: null, q: "", complexity: [], product: "", status: "inactivos", coverage: "todas", pageSize: COMPARATIVA_PAGE_SIZE, ref: "mes", tab: "resumen", support: ["GOLD"], hosting: ["OP"], sort: "cum.revenue", dir: "desc", page: 2 });
    expect(query.blocks).toHaveLength(5);
    const out = comparativaParams(query, NOW);
    expect(Object.keys(out).sort()).toEqual(["dir", "estado", "fecha", "modo", "orden", "pagina", "servidor", "soporte"]);
    for (const k of ["q", "servicio", "complejidad", "producto", "cobertura", "revision", "tam", "bloques", "ref", "pestana", "alojamiento"]) expect(out).not.toHaveProperty(k);
  });
  it("un orden no permitido vuelve a «name»; sin parámetros solo queda el periodo por defecto", () => {
    expect(parseComparativaQuery({ orden: "name; DROP" }, NOW).query.sort).toBe("name");
    expect(comparativaParams(parseComparativaQuery({}, NOW).query, NOW)).toEqual({});
    expect(parseComparativaQuery({ orden: "hosting" }, NOW).query.sort).toBe("hosting");
  });
});

describe("Comparativa: filtros Soporte y Servidor", () => {
  it("OR dentro de un filtro y AND entre ambos EN EL MISMO Cliente", async () => {
    await world();
    expect(names(await getPortfolio(admin.id, Q()))).toEqual(["Alfa", "Beta", "Gamma"]); // sin selección = todos (incluye los sin atributos)
    expect(names(await getPortfolio(admin.id, Q({ soporte: "GOLD" })))).toEqual(["Alfa", "Beta"]);
    expect(names(await getPortfolio(admin.id, Q({ servidor: "CLOUD" })))).toEqual(["Alfa", "Beta"]);
    expect(names(await getPortfolio(admin.id, Q({ soporte: "GOLD,SILVER_RECURRENTE" })))).toEqual(["Alfa", "Beta"]); // OR
    // Gold + CLOUD: Alfa tiene Gold (Alfa 1, OP) y CLOUD (Alfa 2, Silver) pero en Clientes distintos → NO entra
    expect(names(await getPortfolio(admin.id, Q({ soporte: "GOLD", servidor: "CLOUD" })))).toEqual(["Beta"]);
    expect(names(await getPortfolio(admin.id, Q({ soporte: "GOLD", servidor: "OP" })))).toEqual(["Alfa"]);
    expect(names(await getPortfolio(admin.id, Q({ soporte: "SILVER_RECURRENTE", servidor: "CLOUD" })))).toEqual(["Alfa"]);
    expect(names(await getPortfolio(admin.id, Q({ soporte: "PLATINUM", servidor: "OP" })))).toEqual([]);
  });

  it("un Grupo incluido conserva TODO su ingreso y sus horas (el filtro decide la pertenencia, no recorta cifras)", async () => {
    await world();
    const f = await getPortfolio(admin.id, Q({ soporte: "SILVER_RECURRENTE", servidor: "CLOUD" }));
    const alfa = f.rows[0];
    expect(alfa.meta.name).toBe("Alfa");
    expect(alfa.periods.month.hours.inPerimeter).toBe("15"); // 10 h de Alfa 1 + 5 h solo-Grupo: no solo las del Cliente que coincide
    expect(alfa.periods.month.revenue.value).toBe("1000");
    expect(alfa.meta.support).toMatchObject({ heterogeneous: true, values: ["GOLD", "SILVER_RECURRENTE"] }); // «Mixto» explicable
    expect(alfa.meta.hosting).toMatchObject({ heterogeneous: true, values: ["CLOUD", "OP"] });
  });

  it("totales de TODO el filtrado con componentes agregados, no medias de porcentajes ni solo la página", async () => {
    await world();
    await prisma.clientGroup.createMany({ data: Array.from({ length: 55 }, (_, i) => ({ name: `Extra ${String(i).padStart(2, "0")}` })) });
    const p1 = await getPortfolio(admin.id, Q());
    const p2 = await getPortfolio(admin.id, Q({ pagina: "2" }));
    expect(p1.rows).toHaveLength(COMPARATIVA_PAGE_SIZE);
    expect(p1.filteredGroups).toBe(58);
    expect(p2.economics.portfolio!.month).toEqual(p1.economics.portfolio!.month);
    const sub = await getPortfolio(admin.id, Q({ soporte: "GOLD" }));
    const m = sub.economics.portfolio!.month;
    // Alfa 1000 € / 15 h y Beta 500 € / 30 h  →  ΣR/ΣH×8 = 1500/45×8, NO la media de los ratios (533,33 y 133,33)
    expect(m.revenue).toBe("1500");
    expect(m.hours).toBe("45");
    expect(Dec.parse(m.perDay.value!)!.sub(Dec.parse("1500")!.mulInt(8).div(Dec.parse("45")!)).abs().cmp(Dec.parse("0.0000001")!)).toBeLessThan(0);
    expect(m.deviationVsTarget.value).not.toBeNull();
    // Desv. media filtrada: misma población, mismo criterio; la de cada fila se calcula contra ESE ratio ponderado
    for (const r of sub.rows) expect(r.periods.month.deviationVsPortfolio?.operands?.cartera).toBe(m.perDay.value);
  });

  it("Usuarios al corte y Tarifa anual/usuario del total salen de componentes (Σ usuarios; 12×ΣR/Σ usuarios·mes), con grupos sin dato declarados", async () => {
    const w = await world();
    await setUsers(admin.id, { groupId: w.A.id }, 2026, Array(12).fill(10));
    await setUsers(admin.id, { groupId: w.B.id }, 2026, Array(12).fill(20));
    const v = await getPortfolio(admin.id, Q());
    const t = v.totals.cum;
    expect(t.users).toBe("30");
    expect(t.usersMissing).toBe(1); // Gamma sin usuarios: el total es parcial y se declara
    // CUM a junio: ingreso 6 meses (6000 + 3000) y usuarios·mes 60 + 120 → 12 × 9000 / 180 = 600
    expect(Dec.parse(t.tariff!)!.sub(Dec.parse("600")!).abs().cmp(Dec.parse("0.0001")!)).toBeLessThan(0);
    expect(t.tariffMissing).toBe(1);
    expect(usersTariffTotal([], "cum")).toMatchObject({ users: null, tariff: null });
  });
});

describe("CSV = pantalla", () => {
  it("mismo periodo, selección y orden; todas las filas del filtrado y los totales del filtrado completo", async () => {
    await world();
    const q = Q({ soporte: "GOLD", orden: "month.hours", dir: "desc" });
    const view = await getPortfolioAll(admin.id, q);
    const csv = await portfolioCsv(admin.id, q);
    const recs = parse(csv.body.slice(1), { delimiter: ";", skip_empty_lines: true }) as string[][];
    const header = recs[0];
    const col = (n: string) => header.indexOf(n);
    const groups = recs.filter((r) => r[col("fila")] === "GRUPO" && r[col("periodo")] === "mes_seleccionado");
    expect(groups.map((r) => r[col("grupo_cliente")])).toEqual(names(view)); // mismo orden que la tabla (Beta 30 h, Alfa 15 h)
    expect(groups.map((r) => r[col("grupo_cliente")])).toEqual(["Beta", "Alfa"]);
    expect(recs.length - 1).toBe(2 * 5 + 5);
    const total = recs.find((r) => r[col("fila")] === "CARTERA" && r[col("periodo")] === "mes_seleccionado")!;
    expect(total[col("horas")]).toBe(view.economics.portfolio!.month.hours);
    expect(total[col("ingreso_imputado_eur")]).toBe(view.economics.portfolio!.month.revenue);
    expect(total[col("ambito")]).toContain("soporte: Gold");
    // Soporte mixto del Grupo: «Mixto», no un valor inventado
    const alfa = groups.find((r) => r[col("grupo_cliente")] === "Alfa")!;
    expect(alfa[col("soporte")]).toMatch(/^Mixto: /);
    expect(header).not.toContain("complejidad_filtro");
  });
  it("las claves antiguas de la URL no recortan el CSV de la vista normal", async () => {
    await world();
    const csv = await portfolioCsv(admin.id, parseComparativaQuery({ fecha: "2026-06-30", modo: "FULL_MONTH", q: "alfa", estado: "todos", producto: "X" }, NOW).query);
    expect(csv.rows).toBe(3); // `q` y `producto` siguen ignorados; `estado=todos` es explícito y válido
  });
});
