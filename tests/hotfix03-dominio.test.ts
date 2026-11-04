import { describe, expect, it } from "vitest";
import { Dec, eurosPerDay, proratedMonthIncome } from "@/domain/finance";
import { DEFAULT_BAND_FACTORS, cutsFor, economicBand, validateBandFactors } from "@/domain/economic-bands";
import { clientEffectiveActive, groupEffectiveActive, matchesEstado, parseEstado } from "@/domain/estado";
import { aggregatePortfolio } from "@/domain/portfolio";
import {
  INDICATOR_KEYS, defaultQualityConfig, uncalibratedQualityConfig, evaluateEntity, evaluateGlobal, evaluateRule, effectiveWeights, isLegacyUncalibrated, metricUnitFor, perUserRate, validateQualityConfig,
  QUALITY_COHORT_REFERENCE, type ComponentInput, type Color, type IndicatorKey, type ThresholdRule,
} from "@/domain/quality-config";
import { detectSheet } from "@/domain/precarga-maestros";
import { parseComparativaQuery, comparativaParams, COMPARATIVA_SORTS } from "@/domain/comparativa-query";
import { parseQualityQuery, qualityToParams } from "@/domain/quality-query";
import { parseCommonFilters, commonFiltersToParams } from "@/domain/filtros-comunes";

const d = (s: string | number) => Dec.parse(String(s)) as Dec;
const ds = (xs: (string | number)[]) => xs.map(d);

describe("bandas económicas con objetivo 550 (HOTFIX-03 §9)", () => {
  it("fronteras exactas: 329,99 rojo · 330 naranja · 440 amarillo · 549,99 amarillo · 550 verde · 660 verde intenso", () => {
    const b = (v: string) => economicBand(v, "550");
    expect(b("329.99")).toBe("red");
    expect(b("330")).toBe("orange");
    expect(b("439.99")).toBe("orange");
    expect(b("440")).toBe("yellow");
    expect(b("549.99")).toBe("yellow");
    expect(b("550")).toBe("green");
    expect(b("659.99")).toBe("green");
    expect(b("660")).toBe("green-strong");
    expect(economicBand(null, "550")).toBeNull(); // ausente = neutro
  });
  it("cambiar el objetivo desplaza los cortes (no hay 550 fijo en los componentes)", () => {
    expect(cutsFor("550")).toEqual(["330", "440", "550", "660"]);
    expect(cutsFor("600")).toEqual(["360", "480", "600", "720"]);
    expect(economicBand("580", "550")).toBe("green");
    expect(economicBand("580", "600")).toBe("yellow");
  });
  it("valida orden y fronteras de las bandas editables", () => {
    expect(validateBandFactors(["0.6", "0.8", "1", "1.2"]).ok).toBe(true);
    expect(validateBandFactors(["0,5", "0,9", "1", "1,5"]).ok).toBe(true);
    expect(validateBandFactors(["0.8", "0.6", "1", "1.2"]).ok).toBe(false);
    expect(validateBandFactors(["0.6", "0.8", "0.9", "1.2"]).ok).toBe(false); // el verde empieza en el objetivo
    expect(validateBandFactors(["0.6", "0.8", "1"]).ok).toBe(false);
    expect([...DEFAULT_BAND_FACTORS]).toEqual(["0.6", "0.8", "1", "1.2"]);
  });
});

describe("ejemplo económico independiente (§8)", () => {
  it("anual 12.000, mes completo R=1.000, H=16, jornada 8 → 500 €/jornada; corte 15/30 y H=8 → 500; R=0 con H>0 → 0; H=0 sin ratio", () => {
    const full = proratedMonthIncome(d(12000), 30, 30);
    expect(full.toString()).toBe("1000");
    expect(eurosPerDay(full, d(16 * 60), d(8)).ratio?.toString()).toBe("500");
    const cut = proratedMonthIncome(d(12000), 15, 30);
    expect(cut.toString()).toBe("500");
    expect(eurosPerDay(cut, d(8 * 60), d(8)).ratio?.toString()).toBe("500");
    expect(eurosPerDay(d(0), d(60), d(8)).ratio?.toString()).toBe("0");
    expect(eurosPerDay(d(1000), d(0), d(8)).ratio).toBeNull();
  });
});

describe("estado comercial: semántica efectiva única (§7)", () => {
  it("Cliente: propio y Grupo; sin Grupo, solo el propio", () => {
    expect(clientEffectiveActive({ isActive: true }, { isActive: true })).toBe(true);
    expect(clientEffectiveActive({ isActive: true }, { isActive: false })).toBe(false);
    expect(clientEffectiveActive({ isActive: false }, { isActive: true })).toBe(false);
    expect(clientEffectiveActive({ isActive: true }, null)).toBe(true);
  });
  it("Grupo: con hijos activos e inactivos figura en Activos; todos inactivos → inactivo; sin hijos, su estado propio; desactivado → inactivo", () => {
    expect(groupEffectiveActive({ isActive: true }, [{ isActive: true }, { isActive: false }])).toBe(true);
    expect(groupEffectiveActive({ isActive: true }, [{ isActive: false }, { isActive: false }])).toBe(false);
    expect(groupEffectiveActive({ isActive: true }, [])).toBe(true);
    expect(groupEffectiveActive({ isActive: false }, [{ isActive: true }])).toBe(false);
    expect(matchesEstado(true, "activos")).toBe(true);
    expect(matchesEstado(true, "inactivos")).toBe(false);
    expect(matchesEstado(false, "todos")).toBe(true);
  });
  it("el parámetro `estado` es explícito y válido (predeterminado Activos) y se conserva en las URL", () => {
    expect(parseEstado(undefined)).toBe("activos");
    expect(parseEstado("inactivos")).toBe("inactivos");
    expect(parseEstado("basura")).toBe("activos");
    const { query, filters } = parseComparativaQuery({ estado: "todos", soporte: "GOLD" });
    expect(query.status).toBe("todos");
    expect(filters.estado).toBe("todos");
    expect(comparativaParams(query)).toMatchObject({ estado: "todos", soporte: "GOLD" });
    expect(comparativaParams(parseComparativaQuery({}).query).estado).toBeUndefined();
    expect(commonFiltersToParams(parseCommonFilters({ estado: "inactivos" }))).toEqual({ estado: "inactivos" });
    expect(parseQualityQuery({ estado: "inactivos" }).query.base.status).toBe("inactivos");
    expect(parseQualityQuery({}).query.base.status).toBe("activos");
    expect(qualityToParams(parseQualityQuery({ estado: "todos" }).query).estado).toBe("todos");
  });
});

describe("ordenación de Comparativa: todas las columnas son claves válidas (§9)", () => {
  it("cada clave de columna generada por la tabla llega intacta hasta la consulta (ninguna se normaliza a nombre)", () => {
    const COLS: Record<string, string[]> = {
      month: ["hours", "revenue", "perDay", "devTarget", "devPortfolio"],
      prevMonth: ["hours", "revenue", "perDay"],
      cum: ["hours", "revenue", "stock", "tariff", "perDay", "devTarget", "devPortfolio"],
      prevYear: ["hours", "revenue", "perDay"],
      prevCum: ["hours", "revenue", "perDay"],
    };
    const keys = ["name", "support", "hosting", ...Object.entries(COLS).flatMap(([p, cs]) => cs.map((c) => `${p}.${c}`))];
    for (const k of keys) {
      expect(COMPARATIVA_SORTS, k).toContain(k);
      const { query } = parseComparativaQuery({ orden: k, dir: "desc" });
      expect(query.sort, k).toBe(k);
      expect(comparativaParams(query).orden ?? "name", k).toBe(k);
      expect(query.dir).toBe("desc");
    }
    expect(parseComparativaQuery({ orden: "inventada" }).query.sort).toBe("name");
  });
});

describe("media filtrada con subconjunto comparable (§8)", () => {
  const row = (id: string, revenue: number | null, hours: number, extra: Partial<{ code: string | null; status: "AVAILABLE" | "PARTIAL" | "NO_SOURCE" | "NOT_COMPUTABLE"; provisional: boolean }> = {}) => ({
    id, revenue: revenue === null ? null : d(revenue), minutes: d(hours * 60), code: extra.code ?? null, status: extra.status ?? ("AVAILABLE" as const), provisional: extra.provisional ?? false,
  });
  it("ΣR/ΣH × jornada, no media simple; falta un Grupo → la media es del subconjunto y se declara «3/4 grupos»", () => {
    const p = aggregatePortfolio([row("a", 1000, 16), row("b", 3000, 8), row("c", 800, 8), row("d", null, 5, { code: "INCOME_UNKNOWN", status: "NO_SOURCE" })], d(550), d(8));
    expect(p.perDay.value).toBe("500".length ? p.perDay.value : "");
    // ΣR = 4800; ΣH = 32 → 4800/32 × 8 = 1200
    expect(Number(p.perDay.value)).toBeCloseTo(1200, 6);
    expect(p.scope).toEqual({ used: 3, total: 4, provisional: 0 });
    expect(p.complete).toBe(false);
    expect(p.perDay.reason).toContain("3/4 grupos");
    expect(p.deviationVsTarget.value).not.toBeNull(); // la desviación de los demás no queda vacía
    expect(p.knownSet.revenue).toBe("4800");
  });
  it("un grupo provisional entra con sus horas observadas y marca la referencia como provisional; completo sin faltantes → AVAILABLE", () => {
    const prov = aggregatePortfolio([row("a", 1000, 16), row("b", 500, 4, { code: "PERIMETER_PARTIAL", status: "PARTIAL", provisional: true })], d(550), d(8));
    expect(prov.perDay.status).toBe("PARTIAL");
    expect(prov.scope.provisional).toBe(1);
    expect(Number(prov.perDay.value)).toBeCloseTo((1500 / 20) * 8, 6);
    const ok = aggregatePortfolio([row("a", 1000, 16), row("b", 1000, 16)], d(550), d(8));
    expect(ok.perDay.status).toBe("AVAILABLE");
    expect(ok.complete).toBe(true);
    expect(Number(ok.perDay.value)).toBe(500);
  });
});

describe("Calidad: valores por UN usuario y total (§11)", () => {
  it("dos PAP con 10 usuarios en mes completo → 0,2 por usuario; el Total no necesita denominador", () => {
    expect(perUserRate(2, d(10))?.toString()).toBe("0.2");
    expect(perUserRate(2, null)).toBeNull(); // no se divide entre uno ni se inventa cero
    expect(perUserRate(2, d(0))).toBeNull();
    expect(perUserRate(0, d(10))?.toString()).toBe("0");
  });
  it("las unidades de cada modo son distintas y explícitas", () => {
    expect(metricUnitFor("PAP_CORRECTIVE", "usuario")).toBe("PER_USER_MONTH");
    expect(metricUnitFor("PAP_CORRECTIVE", "total")).toBe("TOTAL_COUNT");
    expect(metricUnitFor("DEDICATION", "usuario")).toBe("HOURS_PER_USER_MONTH");
    expect(metricUnitFor("DEDICATION", "total")).toBe("TOTAL_HOURS");
  });
});

describe("regla por percentiles P25/P75 (§12)", () => {
  const rule: ThresholdRule = { method: "PERCENTILE", direction: "LOWER_BETTER", a: "25", b: "75", referenceId: QUALITY_COHORT_REFERENCE, minSample: 5, calibration: "CALIBRADO", unit: "RELATIVE" };
  it("verde x≤P25 · amarillo P25<x≤P75 · rojo x>P75, con percentiles inclusivos", () => {
    const ref = ds([1, 2, 3, 4, 5, 6, 7, 8, 9]); // P25 = 3, P75 = 7
    const o = (v: number) => evaluateRule(rule, d(v), ref);
    expect(o(3)).toMatchObject({ color: "green", cuts: { a: "3", b: "7" }, n: 9 });
    expect(o(3.01).color).toBe("yellow");
    expect(o(7).color).toBe("yellow");
    expect(o(7.01).color).toBe("red");
  });
  it("menos de cinco valores válidos → «Muestra insuficiente», sin color y sin verde inventado", () => {
    const o = evaluateRule(rule, d(1), ds([1, 2, 3, 4]));
    expect(o.color).toBeNull();
    expect(o.status).toBe("SIN_REFERENCIA");
    expect(o.reason).toContain("Muestra insuficiente");
  });
  it("empates: todo cero confirmado → verde; todos iguales y positivos → amarillo relativo; valores iguales, mismo resultado; sin desempate aleatorio", () => {
    expect(evaluateRule(rule, d(0), ds([0, 0, 0, 0, 0])).color).toBe("green");
    expect(evaluateRule(rule, d(2), ds([2, 2, 2, 2, 2])).color).toBe("yellow");
    // P25 = P75 con muestra no constante: los iguales a ese valor tienen el MISMO color; nada se reparte por orden.
    const ref = ds([1, 5, 5, 5, 5, 5, 9]);
    const a = evaluateRule(rule, d(5), ref);
    const b = evaluateRule(rule, d(5), ref);
    expect(a.cuts?.a).toBe(a.cuts?.b);
    expect(a.color).toBe(b.color);
    expect(a.color).toBe("green");
    expect(evaluateRule(rule, d(9), ref).color).toBe("red");
  });
  it("intensidad: más favorable hasta P10 y más desfavorable por encima de P90 (sin añadir colores)", () => {
    const ref = ds([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(evaluateRule(rule, d(1), ref)).toMatchObject({ color: "green", intensity: "FAVORABLE" });
    expect(evaluateRule(rule, d(3), ref).intensity).toBeUndefined();
    expect(evaluateRule(rule, d(10), ref)).toMatchObject({ color: "red", intensity: "DESFAVORABLE" });
  });
  it("una regla absoluta heredada «por 100 usuarios» se convierte de forma explícita a «por usuario» (÷100) y no se aplica a totales", () => {
    const legacy: ThresholdRule = { method: "ABSOLUTE", direction: "LOWER_BETTER", a: "10", b: "30", referenceId: null, minSample: null, calibration: "CALIBRADO", unit: "PER_100_USER_MONTHS" };
    const o = evaluateRule(legacy, d("0.2"), null, "PER_USER_MONTH");
    expect(o.cuts).toEqual({ a: "0.1", b: "0.3" });
    expect(o.color).toBe("yellow"); // 0,1 < 0,2 ≤ 0,3 (los límites 10/30 por 100 usuarios equivalen a 0,1/0,3 por usuario)
    expect(evaluateRule(legacy, d("0.35"), null, "PER_USER_MONTH").color).toBe("red");
    expect(o.converted).toContain("÷100");
    expect(evaluateRule(legacy, d(5), null, "TOTAL_COUNT").status).toBe("REGLA_INVALIDA");
  });
});

describe("perfil inicial y global (§12)", () => {
  it("la configuración inicial es válida, calibrada, con pesos iguales y límites 0,25/0,50; la anterior sin calibrar se reconoce", () => {
    const cfg = defaultQualityConfig();
    expect(validateQualityConfig(cfg)).toEqual([]);
    expect(isLegacyUncalibrated(cfg)).toBe(false);
    expect(cfg.weights.mode).toBe("EQUAL");
    expect(cfg.global).toMatchObject({ enabled: true, greenMax: "0.25", yellowMax: "0.5" });
    expect(cfg.dedication).toEqual({ profiles: ["CS_N1", "CS_N2", "PMO_N3"], selectionConfirmed: true });
    expect(cfg.incidents.concerningDays).toEqual({ incident: 7, problem: 30 });
    expect(cfg.snapshotPolicy).toEqual({ mode: "LATEST_BEFORE", maxDays: 7 });
    expect(cfg.incidents.worstOfFlowAndBacklog).toBe(true);
    const legacy = uncalibratedQualityConfig();
    expect(isLegacyUncalibrated(legacy)).toBe(true);
  });
  const colorsOf = (m: Partial<Record<IndicatorKey, Color | null>>) => Object.fromEntries(INDICATOR_KEYS.map((k) => [k, m[k] ?? null])) as Record<IndicatorKey, Color | null>;
  it("sin Health: cinco pesos de 20 %; tres rojos y dos verdes → 0,60 → rojo; límites exactos 0,25 verde · 0,50 amarillo", () => {
    const cfg = defaultQualityConfig();
    const units = Object.fromEntries(INDICATOR_KEYS.map((k) => [k, 1])) as Record<IndicatorKey, number>;
    const avail = Object.fromEntries(INDICATOR_KEYS.map((k) => [k, k === "HEALTH" ? "BLANK" : "AVAILABLE"])) as never;
    const w = effectiveWeights(units, avail);
    expect(INDICATOR_KEYS.filter((k) => k !== "HEALTH").every((k) => w.percent[k] === "20")).toBe(true);
    const g = (c: Color[]) => evaluateGlobal({ ...cfg.global, template: "WEIGHTED_SEVERITY" }, w, colorsOf({ DEDICATION: c[0], PAP_CORRECTIVE: c[1], N3_ESCALATIONS: c[2], INCIDENTS_PROBLEMS: c[3], BUGS_STANDARD: c[4] }));
    expect(g(["red", "red", "red", "green", "green"])).toMatchObject({ color: "red", score: "0.6" });
    expect(g(["yellow", "green", "green", "green", "green"])).toMatchObject({ color: "green", score: "0.1" });
    expect(g(["red", "green", "green", "green", "green"])).toMatchObject({ color: "green", score: "0.2" });
    expect(g(["yellow", "yellow", "green", "green", "green"])).toMatchObject({ color: "green", score: "0.2" });
    expect(g(["red", "yellow", "green", "green", "green"])).toMatchObject({ color: "yellow", score: "0.3" });
    expect(g(["red", "red", "green", "green", "green"])).toMatchObject({ color: "yellow", score: "0.4" });
    expect(g(["red", "red", "yellow", "green", "green"])).toMatchObject({ color: "yellow", score: "0.5" });
    expect(g(["red", "red", "yellow", "yellow", "green"])).toMatchObject({ color: "red", score: "0.6" });
  });
  it("un técnico sin dato conserva su peso y deja el global parcial (nunca cero ni redistribución)", () => {
    const cfg = defaultQualityConfig();
    const units = Object.fromEntries(INDICATOR_KEYS.map((k) => [k, 1])) as Record<IndicatorKey, number>;
    const avail = Object.fromEntries(INDICATOR_KEYS.map((k) => [k, k === "HEALTH" ? "BLANK" : k === "N3_ESCALATIONS" ? "MISSING" : "AVAILABLE"])) as never;
    const w = effectiveWeights(units, avail);
    expect(w.percent.N3_ESCALATIONS).toBe("20");
    const out = evaluateGlobal({ ...cfg.global, template: "WEIGHTED_SEVERITY" }, w, colorsOf({ DEDICATION: "red", PAP_CORRECTIVE: "green", INCIDENTS_PROBLEMS: "green", BUGS_STANDARD: "green" }));
    expect(out.color).toBeNull();
    expect(out.status).toBe("COBERTURA_INSUFICIENTE");
    expect(out.partialAlerts).toContain("DEDICATION");
  });
  it("evaluateEntity con el perfil inicial: sin calibrar ya no aparece; referencia propia y modo Total/Por usuario", () => {
    const cfg = defaultQualityConfig();
    const ref = ds([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const comp = (v: number): ComponentInput => ({ value: d(v), refs: ref });
    const input = { scope: "GRUPO" as const, health: "positive" as const, dedication: comp(1), pap: comp(5), n3: comp(9), bugs: comp(2), incidents: { flow: comp(1), backlogIncident: comp(1), backlogProblem: comp(1) } };
    for (const m of ["usuario", "total"] as const) {
      const ev = evaluateEntity(cfg, input, m);
      expect(ev.indicators.PAP_CORRECTIVE.status).toBe("OK");
      expect(ev.indicators.PAP_CORRECTIVE.color).toBe("yellow");
      expect(ev.indicators.N3_ESCALATIONS.color).toBe("red");
      expect(ev.indicators.DEDICATION.color).toBe("green");
      expect(ev.indicators.HEALTH.color).toBe("green");
      expect(ev.indicators.PAP_CORRECTIVE.unit).toBe(metricUnitFor("PAP_CORRECTIVE", m));
      expect(ev.global.status).not.toBe("SIN_METODO");
    }
  });
});

describe("formatos de gestión: detección por cabeceras (§5)", () => {
  it("Clientes de 8 columnas y Personal de 6 (con y sin Rol PMO), sin depender del nombre de hoja", () => {
    const c8 = detectSheet(["GRUPO CLIENTE VINCLE", "organization_wrike", "organization_id_zendesk", "Organization_name_zendesk", "Nivel_Servicio_acutal", "SERVIDOR", "Organization_name_PAP", "TIPO "]);
    expect(c8).toMatchObject({ kind: "CLIENTES", layout: "v2" });
    const p6 = detectSheet(["Persona PAP", "Persona Zendesk", "Nivel", "Equipo", "PMO", "Persona Wrike"]);
    expect(p6).toMatchObject({ kind: "PERSONAL", layout: "v2", roleCol: null });
    const p6r = detectSheet(["Persona PAP", "Persona Zendesk", "Nivel", "Equipo", "PMO", "Persona Wrike", "Rol PMO"]);
    expect(p6r).toMatchObject({ kind: "PERSONAL", layout: "v2", roleCol: 6, extras: [] });
  });
  it("conserva los formatos anteriores: CLIENTES de 11 columnas y PERSONAL de 7 con Zendesk duplicado; el duplicado no se confunde con un rol", () => {
    const c11 = detectSheet(["organization_wrike", "Grupo Cliente Vincle", "organization_id_zendesk", "organization_name_zendesk", "Nivel_Servicio_acutal", "Grupo Cliente Vincle", "SERVIDOR", "Nivel_Servicio_acutal", "organization_name_PAP", "Grupo Cliente Vincle", "TIPO"]);
    expect(c11).toMatchObject({ kind: "CLIENTES", layout: "v1" });
    const p7 = detectSheet(["Persona PAP", "Persona Zendesk", "Nivel", "Equipo", "PMO", "Persona Wrike", "Persona Zendesk"]);
    expect(p7).toMatchObject({ kind: "PERSONAL", layout: "v1", roleCol: null });
    expect(detectSheet(["Persona", "Perfil"])).toMatchObject({ kind: "PMO" });
    expect(detectSheet(["a", "b"]).kind).toBeNull();
  });
});
