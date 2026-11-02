import { describe, expect, it } from "vitest";
import { Dec } from "@/domain/finance";
import {
  annualTariff, bandOf, cutsOf, distribution, exposureOf, historicalHoursEquivalent, normalize, percentileInc, portfolioEuroPerDay, sortDec, type Cuts, type Direction,
} from "@/domain/pulse-stats";
import { DEFAULT_REFERENCES, METRIC_BY_ID, PULSE_METRICS, PROFILE_KEYS, defaultPulseConfig, referenceMembership, validatePulseConfig, variantFor, type CriteriaCell, type CriteriaMeta } from "@/domain/pulse-catalog";

const D = (v: string | number) => Dec.parse(String(v)) as Dec;
const obs = (xs: (number | null)[]) => xs.map((x) => ({ value: x === null ? null : D(x) }));

describe("percentiles inclusivos continuos (PERCENTILE.INC)", () => {
  it("[0,10,20,30] → P10=3, P25=7,5, mediana=15, P75=22,5, P90=27 y media=15", () => {
    const d = distribution(obs([0, 10, 20, 30]));
    expect([d.p10, d.p25, d.median, d.p75, d.p90, d.mean, d.n]).toEqual(["3", "7.5", "15", "22.5", "27", "15", 4]);
  });
  it("valores desordenados, negativos, decimales y nulos (el nulo no participa; el cero confirmado sí)", () => {
    const d = distribution(obs([30, null, -10, 0, 20.5, 10]));
    expect(d.n).toBe(5);
    expect(d.excluded).toBe(1);
    expect(d.min).toBe("-10");
    expect(d.median).toBe("10");
    expect(sortDec([D(10), D(-2), D(3)]).map(String)).toEqual(["-2", "3", "10"]); // orden numérico, no léxico
    expect(sortDec([D(9), D(10), D(100)]).map(String)).toEqual(["9", "10", "100"]);
  });
  it("N=0: sin referencia; N=1 y valores iguales: deterministas, con aviso y sin dispersión inventada", () => {
    expect(distribution([]).n).toBe(0);
    expect(cutsOf(distribution(obs([null, null])))).toBeNull();
    const one = distribution(obs([7]));
    expect([one.p10, one.p90, one.median]).toEqual(["7", "7", "7"]);
    expect(one.warning).toMatch(/Una sola entidad/);
    const same = distribution(obs([5, 5, 5, 5, 5, 5]));
    expect(same.constant).toBe(true);
    expect(percentileInc([D(1), D(2)], 1, 2)?.toString()).toBe("1.5");
  });
  it("decimales exactos: sin Number en el cálculo (importes grandes y fracciones racionales)", () => {
    const d = distribution(obs([0.1, 0.2, 0.3]));
    expect(d.mean).toBe("0.2");
    expect(distribution([{ value: D("123456789012345678.123456789") }, { value: D("123456789012345678.123456791") }]).median).toBe("123456789012345678.12345679");
  });
});

describe("cinco bandas: cada igualdad en ambos sentidos, sin epsilon", () => {
  const cuts: Cuts = { p10: D(10), p25: D(25), p75: D(75), p90: D(90) };
  const at = (x: number, dir: Direction, c: Cuts = cuts) => bandOf(D(x), dir, c).band;
  it("menor = mejor (carga): ≤P10 verde intenso · ≤P25 verde claro · ≤P75 amarillo · ≤P90 naranja · >P90 rojo", () => {
    expect([at(10, "LOWER"), at(10.0001, "LOWER"), at(25, "LOWER"), at(25.01, "LOWER"), at(75, "LOWER"), at(75.01, "LOWER"), at(90, "LOWER"), at(90.01, "LOWER")]).toEqual([
      "verde_intenso", "verde_claro", "verde_claro", "amarillo", "amarillo", "naranja", "naranja", "rojo",
    ]);
  });
  it("mayor = mejor (tarifa, €/jornada): <P10 rojo · <P25 naranja · <P75 amarillo · <P90 verde claro · ≥P90 verde intenso", () => {
    expect([at(9.99, "HIGHER"), at(10, "HIGHER"), at(24.99, "HIGHER"), at(25, "HIGHER"), at(74.99, "HIGHER"), at(75, "HIGHER"), at(89.99, "HIGHER"), at(90, "HIGHER")]).toEqual([
      "rojo", "naranja", "naranja", "amarillo", "amarillo", "verde_claro", "verde_claro", "verde_intenso",
    ]);
  });
  it("con cortes coincidentes se evalúa en el orden del contrato (sin epsilon ni anchuras artificiales)", () => {
    const same: Cuts = { p10: D(5), p25: D(5), p75: D(5), p90: D(5) };
    expect([at(5, "LOWER", same), at(5.0000000001, "LOWER", same), at(4.99, "LOWER", same)]).toEqual(["verde_intenso", "rojo", "verde_intenso"]);
    expect([at(5, "HIGHER", same), at(4.99, "HIGHER", same)]).toEqual(["verde_intenso", "rojo"]);
  });
  it("sin referencia, sin valor o sin juicio: no se colorea (nunca verde por ausencia)", () => {
    expect(bandOf(D(1), "LOWER", null).band).toBeNull();
    expect(bandOf(null, "LOWER", cuts).band).toBeNull();
    expect(bandOf(D(1), "NONE", cuts).band).toBeNull();
    expect(bandOf(D(1), "NONE", cuts).reason).toMatch(/sin juicio/);
  });
});

describe("exposición y normalización", () => {
  it("65 hasta mayo y 68 desde junio → 665 usuarios mes; usuarios medios = UM / meses (no el stock)", () => {
    const months = Array.from({ length: 10 }, (_, i) => ({ users: i < 5 ? 65 : 68, days: 30, daysInMonth: 30 }));
    const ex = exposureOf(months);
    expect(ex.userMonths?.toString()).toBe("665");
    expect(ex.months.toString()).toBe("10");
    expect(ex.averageUsers?.toString()).toBe("66.5");
  });
  it("corte parcial: pondera exposición, no las horas; un mes sin informar deja la exposición incompleta", () => {
    const ex = exposureOf([{ users: 10, days: 31, daysInMonth: 31 }, { users: 20, days: 15, daysInMonth: 30 }]);
    expect(ex.userMonths?.toString()).toBe("20"); // 10 + 20 × 15/30
    expect(normalize(D(100), "per_user", ex).value?.toString()).toBe("5"); // las 100 h NO se prorratean
    const gap = exposureOf([{ users: 10, days: 31, daysInMonth: 31 }, { users: null, days: 30, daysInMonth: 30 }]);
    expect(gap.userMonths).toBeNull();
    expect(normalize(D(100), "per_user", gap).value).toBeNull();
    expect(normalize(D(100), "raw", gap).value?.toString()).toBe("100");
  });
  it("fórmulas: H/UM, 12H/UM, 100E/UM y 1200E/UM; usuarios mes cero no divide", () => {
    const ex = { userMonths: D(100) };
    expect([normalize(D(50), "per_user", ex), normalize(D(50), "per_user_year", ex), normalize(D(50), "per_100", ex), normalize(D(50), "per_100_year", ex)].map((n) => n.value?.toString())).toEqual(["0.5", "6", "50", "600"]);
    expect(normalize(D(50), "per_user", { userMonths: D(0) }).value).toBeNull();
  });
  it("equivalencia histórica = H_CUM / U_corte / nº mes × 12, separada de la correcta, no en corte parcial", () => {
    expect(historicalHoursEquivalent(D(100), 10, 5, false).value?.toString()).toBe("24");
    expect(historicalHoursEquivalent(D(100), 10, 5, true).value).toBeNull();
    // Con usuarios que cambian difiere de 12·H/UM.
    const correct = normalize(D(100), "per_user_year", exposureOf(Array.from({ length: 5 }, (_, i) => ({ users: i < 2 ? 10 : 20, days: 30, daysInMonth: 30 }))));
    expect(correct.value?.toString()).not.toBe(historicalHoursEquivalent(D(100), 20, 5, false).value?.toString());
  });
  it("tarifa de año completo = ingreso anual / usuarios medios", () => {
    const ex = exposureOf(Array.from({ length: 12 }, () => ({ users: 10, days: 30, daysInMonth: 30 })));
    expect(annualTariff(D(12000), ex).value?.toString()).toBe("1200");
    expect(normalize(D(12000), "per_user_year", ex).value?.toString()).toBe("1200"); // 12R/UM con UM=120 coincide
  });
  it("cartera 1000/10 y 1000/30 = 400 €/jornada y la media de ratios es distinta", () => {
    const p = portfolioEuroPerDay([{ revenue: D(1000), hours: D(10) }, { revenue: D(1000), hours: D(30) }], D(8));
    expect(p.value?.toString()).toBe("400");
    const mean = D(800).add(D("266.66666666666666666667")).divInt(2);
    expect(mean.toString()).not.toBe("400");
    expect(portfolioEuroPerDay([{ revenue: D(1000), hours: D(0) }], D(8)).value).toBeNull();
  });
});

describe("catálogo de métricas", () => {
  it("conserva las 23 métricas de partida con IDs estables y las seis variantes IT N3 / Plataforma N4", () => {
    const ids = PULSE_METRICS.map((m) => m.id);
    for (let i = 1; i <= 23; i++) expect(ids).toContain(`M${String(i).padStart(2, "0")}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect(["M24", "M25", "M26", "M27", "M28", "M29"].map((id) => METRIC_BY_ID.get(id)?.family)).toEqual(Array(6).fill("horas_it"));
    expect(METRIC_BY_ID.get("M15")?.denominator).toMatch(/N2/); // el denominador de N2→N3 NO es el total de tickets
    expect(METRIC_BY_ID.get("M31")?.denominator).toMatch(/todos/);
    expect(METRIC_BY_ID.get("M16")?.direction).toBe("NONE");
    expect(METRIC_BY_ID.get("M17")?.direction).toBe("NONE");
    expect(["M18", "M21", "M10"].map((id) => METRIC_BY_ID.get(id)?.direction)).toEqual(["HIGHER", "HIGHER", "HIGHER"]);
    expect(METRIC_BY_ID.get("M11")?.label).toMatch(/no facturables/);
  });
  it("las variantes se aplican a toda la columna: los porcentajes y €/jornada no se dividen otra vez por usuarios", () => {
    for (const id of ["M15", "M18", "M19", "M20", "M21", "M31"]) expect(variantFor(METRIC_BY_ID.get(id)!, "per_user_year")).toBe("raw");
    expect(variantFor(METRIC_BY_ID.get("M01")!, "per_user_year")).toBe("per_user_year");
    expect(variantFor(METRIC_BY_ID.get("M23")!, "per_user_year")).toBe("per_100_year");
    expect(variantFor(METRIC_BY_ID.get("M10")!, "raw")).toBe("per_user_year");
  });
  it("la configuración inicial es válida, con las referencias confirmadas y sin perfiles configurados", () => {
    const cfg = defaultPulseConfig();
    expect(validatePulseConfig(cfg)).toEqual([]);
    expect(DEFAULT_REFERENCES.map((r) => r.id)).toEqual(["todos", "sin_silver", "gold_op", "gold_cloud", "platinum_op", "platinum_cloud"]);
    expect(Object.keys(cfg.profiles)).toEqual([]);
    expect(PROFILE_KEYS).toHaveLength(5);
    expect(validatePulseConfig({ ...cfg, directions: { M17: "LOWER" } })[0].message).toMatch(/contexto/);
  });
});

describe("pertenencia a referencias", () => {
  const cell = (values: string[], over: Partial<CriteriaCell> = {}): CriteriaCell => ({ values, heterogeneous: values.length > 1, source: values.length ? "group" : "none", clientsWith: 0, clientsTotal: 0, ...over });
  const meta = (support: string[], hosting: string[], over: Partial<CriteriaMeta> = {}): CriteriaMeta => ({ support: cell(support), hosting: cell(hosting), complexity: cell([]), product: { ...cell([]), contains: [] }, ...over });
  const ref = (id: string) => DEFAULT_REFERENCES.find((r) => r.id === id)!;
  it("Gold OP homogéneo: un grupo con mezcla, planes desconocidos o cobertura insuficiente queda fuera con motivo", () => {
    expect(referenceMembership(ref("gold_op"), meta(["GOLD"], ["OP"])).member).toBe(true);
    expect(referenceMembership(ref("gold_op"), meta(["GOLD", "PLATINUM"], ["OP"])).reason).toMatch(/mezclado/);
    expect(referenceMembership(ref("gold_op"), meta([], ["OP"])).reason).toMatch(/sin informar/);
    expect(referenceMembership(ref("gold_op"), meta(["GOLD"], ["CLOUD"])).member).toBe(false);
    const partial = meta(["GOLD"], ["OP"], { support: cell(["GOLD"], { source: "clients", clientsWith: 1, clientsTotal: 3 }) });
    expect(referenceMembership(ref("gold_op"), partial).reason).toMatch(/cobertura insuficiente/);
    // «Contiene algún Gold» (Comparativa) NO equivale a Gold OP homogéneo.
    expect(referenceMembership(ref("gold_op"), meta(["GOLD", "SILVER_ON_DEMAND"], ["OP"])).member).toBe(false);
  });
  it("sin Silver = plan conocido distinto de Silver; un desconocido no entra", () => {
    expect(referenceMembership(ref("sin_silver"), meta(["GOLD", "PLATINUM"], [])).member).toBe(true);
    expect(referenceMembership(ref("sin_silver"), meta([], [])).reason).toMatch(/desconocido/);
    expect(referenceMembership(ref("sin_silver"), meta(["GOLD", "SILVER_ON_DEMAND"], [])).reason).toMatch(/Silver/);
    expect(referenceMembership(ref("todos"), meta([], [])).member).toBe(true);
  });
});
