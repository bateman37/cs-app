import { describe, expect, it } from "vitest";
import { Dec } from "@/domain/finance";
import {
  INDICATOR_KEYS, adaptQualityV1, ageDays, backlogStockRate, defaultQualityConfig, diagnosisFamily, effectiveWeights, evaluateEntity, evaluateRule, healthOutcome, isAged, readQualityPayload,
  validateQualityConfig, weightUnits, qualityConfigV1Schema,
  type Availability, type EntityInput, type IndicatorKey, type QualityConfig, type QualityConfigV1, type ThresholdRule, type ComponentInput,
} from "@/domain/quality-config";

const D = (v: string | number) => Dec.parse(String(v)) as Dec;
const EQ = weightUnits({ mode: "EQUAL", custom: {} as never }).units!;
const av = (over: Partial<Record<IndicatorKey, Availability>> = {}): Record<IndicatorKey, Availability> => ({ ...(Object.fromEntries(INDICATOR_KEYS.map((k) => [k, "AVAILABLE"])) as Record<IndicatorKey, Availability>), ...over });
const rule = (o: Partial<ThresholdRule> = {}): ThresholdRule => ({ method: "ABSOLUTE", direction: "LOWER_BETTER", a: "10", b: "20", referenceId: null, minSample: null, calibration: "CALIBRADO", unit: "PER_100_USER_MONTHS", ...o });

describe("CSAPP-08 §2: contraejemplos de pesos y fuente técnica ausente", () => {
  it("seis pesos 1/6 exactos; sin Health cinco de 20 %", () => {
    const w = effectiveWeights(EQ, av());
    expect(INDICATOR_KEYS.map((k) => w.fraction[k])).toEqual(Array(6).fill({ num: 1n, den: 6n }));
    const nh = effectiveWeights(EQ, av({ HEALTH: "BLANK" }));
    expect(INDICATOR_KEYS.filter((k) => k !== "HEALTH").map((k) => nh.percent[k])).toEqual(Array(5).fill("20"));
  });
  it("un técnico ausente NO aumenta el peso de los disponibles (el denominador conserva a todos)", () => {
    const w = effectiveWeights(EQ, av({ N3_ESCALATIONS: "MISSING" }));
    expect(w.percent.N3_ESCALATIONS).toBe("16.66666666666666666667"); // sigue asignado
    expect(w.percent.DEDICATION).toBe("16.66666666666666666667"); // no pasa a 20 %
    expect(w.computable).toBe(false);
  });
  it("ejemplo obligatorio: Health en blanco + un técnico ausente → cinco asignados 20 %, cobertura 80 %, sin global completo", () => {
    const w = effectiveWeights(EQ, av({ HEALTH: "BLANK", PAP_CORRECTIVE: "MISSING" }));
    expect(INDICATOR_KEYS.filter((k) => k !== "HEALTH").map((k) => w.percent[k])).toEqual(Array(5).fill("20"));
    expect(w.coveragePercent).toBe("80");
    expect(w.computable).toBe(false);
    expect(w.uncovered).toEqual([{ key: "PAP_CORRECTIVE", availability: "MISSING" }]);
  });
  it("Health presente SIN calibrar conserva su peso y bloquea el global; no es ausencia redistribuible", () => {
    const w = effectiveWeights(EQ, av({ HEALTH: "UNCALIBRATED" }));
    expect(w.percent.HEALTH).toBe("16.66666666666666666667");
    expect(w.redistributedFromHealth).toBe(false);
    expect(w.computable).toBe(false);
    expect(w.reasons[0]).toMatch(/sin calibrar/);
  });
  it("Health = 100 % y en blanco → no calculable; un peso cero no bloquea por falta de datos", () => {
    const only = weightUnits({ mode: "CUSTOM", custom: { HEALTH: "100", DEDICATION: "0", PAP_CORRECTIVE: "0", N3_ESCALATIONS: "0", INCIDENTS_PROBLEMS: "0", BUGS_STANDARD: "0" } }).units!;
    expect(effectiveWeights(only, av({ HEALTH: "BLANK" })).computable).toBe(false);
    const zero = weightUnits({ mode: "CUSTOM", custom: { HEALTH: "0", DEDICATION: "40", PAP_CORRECTIVE: "20", N3_ESCALATIONS: "20", INCIDENTS_PROBLEMS: "10", BUGS_STANDARD: "10" } }).units!;
    expect(effectiveWeights(zero, av({ HEALTH: "MISSING" })).computable).toBe(true);
  });
  it("99, 101 y 100,02 se rechazan", () => {
    const mk = (v: string[]) => weightUnits({ mode: "CUSTOM", custom: Object.fromEntries(INDICATOR_KEYS.map((k, i) => [k, v[i]])) as Record<IndicatorKey, string> }).issues.length;
    expect([mk(["20", "20", "15", "15", "15", "14"]), mk(["20", "20", "15", "15", "15", "16"]), mk(["20", "20", "15", "15", "15", "15.02"])]).toEqual([1, 1, 1]);
  });
});

describe("Client Health y calibración", () => {
  const mapping = defaultQualityConfig().health.mapping;
  it("categoría presente con confirmed=false: no colorea ni redistribuye; sin feedback sí redistribuye; confirmar cambia solo la evaluación", () => {
    expect(healthOutcome("negative", { mapping, confirmed: false })).toMatchObject({ kind: "UNCALIBRATED", color: null, availability: "UNCALIBRATED" });
    expect(healthOutcome(null, { mapping, confirmed: false })).toMatchObject({ kind: "BLANK", availability: "BLANK" });
    expect(healthOutcome("negative", { mapping, confirmed: true })).toMatchObject({ kind: "COLOR", color: "red", availability: "AVAILABLE" });
  });
});

describe("Escala, edad y backlog", () => {
  it("2026-01-01 → 2026-02-01 = 31 días; umbral 30 → envejecido; edad 30 no; creación posterior = error, no cero", () => {
    expect(ageDays("2026-01-01", "2026-02-01")).toBe(31);
    expect(isAged(31, 30)).toBe(true);
    expect(isAged(30, 30)).toBe(false);
    expect(ageDays("2026-02-02", "2026-02-01")).toBeNull();
  });
  it("2 envejecidos con 10 usuarios = 20 por 100 usuarios (stock), con independencia de la exposición mensual", () => {
    expect(backlogStockRate(2, 10)?.toString()).toBe("20");
    expect(backlogStockRate(2, 0)).toBeNull();
  });
  it("una regla v1 por usuario se convierte de forma explícita ×100 y no cambia un umbral por el factor 100", () => {
    const v1 = v1Config({ backlogRule: { ...v1Rule(), a: "0.1", b: "0.3", calibration: "CALIBRADO" } });
    const a = adaptQualityV1(v1);
    expect(a.incidents.backlog.INCIDENT.GRUPO).toMatchObject({ a: "10", b: "30", unit: "PER_100_USERS_STOCK" });
    // Mismo caso real: 2 envejecidos / 10 usuarios = 0,2 por usuario (v1) = 20 por 100 usuarios → superaba 0,3? no: 0,2 ≤ 0,3 amarillo; 20 ≤ 30 amarillo.
    expect(evaluateRule(a.incidents.backlog.INCIDENT.GRUPO, D(20), null, "PER_100_USERS_STOCK").color).toBe("yellow");
    // Aplicar el umbral v1 sin convertir (0,1/0,3) a 20 habría dado rojo: el cambio silencioso de escala se evita.
    expect(evaluateRule({ ...rule(), a: "0.1", b: "0.3", unit: "PER_100_USERS_STOCK" }, D(20), null, "PER_100_USERS_STOCK").color).toBe("red");
  });
  it("unidad incompatible entre regla y métrica: REGLA_INVALIDA visible, nunca verde", () => {
    expect(evaluateRule(rule({ unit: "PER_USER_STOCK" }), D(1), null, "PER_100_USERS_STOCK")).toMatchObject({ color: null, status: "REGLA_INVALIDA" });
  });
});

function v1Rule(): QualityConfigV1["indicators"]["HEALTH"]["rule"] {
  return { method: "ABSOLUTE", direction: "LOWER_BETTER", a: null, b: null, referenceId: null, minSample: null, calibration: "SIN_CALIBRAR" };
}
function v1Config(over: Partial<QualityConfigV1["incidents"]> = {}, ind: Partial<QualityConfigV1["indicators"]> = {}): QualityConfigV1 {
  const base = defaultQualityConfig();
  const indicators = Object.fromEntries(
    INDICATOR_KEYS.map((k) => [k, { unit: base.indicators[k].unit, normalization: k === "DEDICATION" ? "POR_USUARIO_MES" : k === "HEALTH" ? "CATEGORIA" : "POR_100_USUARIOS_MES", scope: k === "HEALTH" ? "CLIENTE" : "GRUPO", rule: { ...v1Rule(), method: k === "HEALTH" ? "CATEGORICAL" : "ABSOLUTE" } }]),
  ) as QualityConfigV1["indicators"];
  return {
    schema: "quality-config-v1", weights: base.weights, indicators: { ...indicators, ...ind }, health: base.health, dedication: base.dedication,
    incidents: { backlogRule: v1Rule(), ageBands: [], concerningDays: { incident: null, problem: null }, worstOfFlowAndBacklog: false, ...over }, global: base.global,
  };
}

describe("Compatibilidad: v1 se lee mediante adaptador sin recalibrarse", () => {
  it("conserva la elección v1 en su ámbito y unidad; el otro ámbito requiere configuración explícita; el JSON original no cambia", () => {
    const v1 = v1Config({}, { DEDICATION: { unit: "h", normalization: "POR_USUARIO_MES", scope: "GRUPO", rule: { ...v1Rule(), a: "2", b: "4", calibration: "CALIBRADO" } } });
    const raw = JSON.parse(JSON.stringify(v1));
    const r = readQualityPayload(raw);
    expect(r.ok).toBe(true);
    const cfg = (r as { ok: true; payload: QualityConfig }).payload;
    expect(cfg.schema).toBe("quality-config-v2");
    expect(cfg.adapter?.from).toBe("quality-config-v1");
    expect(cfg.indicators.DEDICATION.rules.GRUPO).toMatchObject({ a: "2", b: "4", calibration: "CALIBRADO", unit: "HOURS_PER_USER_MONTH" });
    expect(cfg.indicators.DEDICATION.rules.CLIENTE.calibration).toBe("SIN_CALIBRAR");
    expect(cfg.health.confirmed).toBe(false);
    expect(raw).toEqual(JSON.parse(JSON.stringify(v1))); // el adaptador no muta lo almacenado
    expect(qualityConfigV1Schema.safeParse(raw).success).toBe(true);
  });
  it("una unidad v1 incompatible con la métrica queda visible y la regla no se aplica", () => {
    const v1 = v1Config({}, { PAP_CORRECTIVE: { unit: "x", normalization: "POR_USUARIO_MES", scope: "GRUPO", rule: { ...v1Rule(), a: "1", b: "2", calibration: "CALIBRADO" } } });
    const cfg = adaptQualityV1(v1);
    expect(cfg.adapter?.notes.join(" ")).toMatch(/incompatibilidad visible/);
    expect(validateQualityConfig(cfg).map((i) => i.message).join(" ")).toMatch(/PAP correctivos/);
  });
});

describe("Evaluador común: ámbitos, composición y global", () => {
  const cal = (a: string, b: string, unit: ThresholdRule["unit"] = "PER_100_USER_MONTHS") => rule({ a, b, unit });
  function calibrated(): QualityConfig {
    const c = defaultQualityConfig();
    c.global = { template: "WEIGHTED_SEVERITY", enabled: true, severity: { green: "0", yellow: "0.5", red: "1" }, greenMax: "0.3", yellowMax: "0.6" };
    c.health.confirmed = true;
    for (const k of ["DEDICATION", "PAP_CORRECTIVE", "N3_ESCALATIONS", "BUGS_STANDARD", "INCIDENTS_PROBLEMS"] as const) c.indicators[k].rules.GRUPO = cal("10", "20", k === "DEDICATION" ? "HOURS_PER_USER_MONTH" : "PER_100_USER_MONTHS");
    return c;
  }
  const comp = (v: number | null, extra: Partial<ComponentInput> = {}): ComponentInput => ({ value: v === null ? null : D(v), ...extra });
  const input = (o: Partial<EntityInput> = {}): EntityInput => ({
    scope: "GRUPO", health: null, dedication: comp(5), pap: comp(5), n3: comp(5), bugs: comp(5),
    incidents: { flow: comp(5), backlogIncident: comp(5), backlogProblem: comp(5) }, ...o,
  });
  it("cinco técnicos verde/amarillo/rojo/verde/amarillo y sin Health → índice 0,4 (severidades 0/0,5/1)", () => {
    const c = calibrated();
    c.incidents.worstOfFlowAndBacklog = true;
    c.incidents.concerningDays = { incident: 30, problem: 60 };
    for (const t of ["INCIDENT", "PROBLEM"] as const) c.incidents.backlog[t].GRUPO = cal("10", "20", "PER_100_USERS_STOCK");
    // DEDICATION verde(5) · PAP amarillo(15) · N3 rojo(25) · INCIDENTS verde (todo 5) · BUGS amarillo(15)
    const r = evaluateEntity(c, input({ dedication: comp(5), pap: comp(15), n3: comp(25), bugs: comp(15) }));
    expect(INDICATOR_KEYS.map((k) => r.indicators[k].color)).toEqual([null, "green", "yellow", "red", "green", "yellow"]);
    expect(r.weights?.redistributedFromHealth).toBe(true);
    expect(r.global).toMatchObject({ status: "OK", score: "0.4", color: "yellow" });
  });
  it("sin método/límites: sin color global; sin un técnico necesario no hay global completo, pero una alerta roja conocida se conserva", () => {
    const c = calibrated();
    c.global.enabled = false;
    expect(evaluateEntity(c, input()).global.color).toBeNull();
    const d = calibrated();
    d.incidents.worstOfFlowAndBacklog = false;
    const r = evaluateEntity(d, input({ n3: comp(25) }));
    expect(r.global.color).toBeNull();
    expect(r.global.status).toBe("COBERTURA_INSUFICIENTE");
    expect(r.global.partialAlerts).toContain("N3_ESCALATIONS");
  });
  it("composición: «peor señal» con flujo verde y backlog rojo no produce KPI verde; sin elegir la composición no hay color de KPI", () => {
    const c = calibrated();
    c.incidents.worstOfFlowAndBacklog = true;
    c.incidents.concerningDays = { incident: 30, problem: 60 };
    for (const t of ["INCIDENT", "PROBLEM"] as const) c.incidents.backlog[t].GRUPO = cal("10", "20", "PER_100_USERS_STOCK");
    const worst = evaluateEntity(c, input({ incidents: { flow: comp(1), backlogIncident: comp(30), backlogProblem: comp(1) } }));
    expect(worst.indicators.INCIDENTS_PROBLEMS.color).toBe("red");
    c.incidents.worstOfFlowAndBacklog = false;
    const none = evaluateEntity(c, input({ incidents: { flow: comp(1), backlogIncident: comp(30), backlogProblem: comp(1) } }));
    expect(none.indicators.INCIDENTS_PROBLEMS).toMatchObject({ color: null, status: "COMPOSICION_SIN_ELEGIR", alert: true });
    // sin fotografía de backlog: se muestra incompleto con la señal conocida, no solo el flujo saludable
    c.incidents.worstOfFlowAndBacklog = true;
    const noPhoto = evaluateEntity(c, input({ incidents: { flow: comp(1), backlogIncident: comp(null), backlogProblem: comp(null) } }));
    expect(noPhoto.indicators.INCIDENTS_PROBLEMS).toMatchObject({ color: null, availability: "MISSING" });
  });
  it("ámbitos: la regla de Grupo no se aplica a un Cliente; sin regla del ámbito → sin calibrar, nunca verde", () => {
    const c = calibrated();
    expect(evaluateEntity(c, input({ scope: "GRUPO" })).indicators.DEDICATION.color).toBe("green");
    const cli = evaluateEntity(c, input({ scope: "CLIENTE" }));
    expect(cli.indicators.DEDICATION.color).toBeNull();
    expect(cli.indicators.DEDICATION.status).toBe("SIN_CALIBRAR");
  });
  it("un valor parcial (cota inferior) nunca da verde ni amarillo; en rojo sostiene solo una alerta", () => {
    const c = calibrated();
    const g = evaluateEntity(c, input({ pap: comp(5, { partial: true }), n3: comp(25, { partial: true }) }));
    expect(g.indicators.PAP_CORRECTIVE).toMatchObject({ color: null, availability: "MISSING", status: "PARCIAL" });
    expect(g.indicators.N3_ESCALATIONS).toMatchObject({ color: null, alert: true, availability: "MISSING" });
  });
  it("percentiles: la referencia usa solo valores válidos y la muestra mínima elegida", () => {
    const p = rule({ method: "PERCENTILE", a: "25", b: "75", referenceId: "todos", minSample: 4 });
    expect(evaluateRule(p, D(1), [D(0), D(10), D(20)], "PER_100_USER_MONTHS")).toMatchObject({ status: "SIN_REFERENCIA", n: 3 });
    expect(evaluateRule(p, D(30), [D(0), D(10), D(20), D(0)], "PER_100_USER_MONTHS").color).toBe("red");
  });
});

describe("Diagnóstico por origen", () => {
  const m = defaultQualityConfig().diagnosis.mappings;
  it("causas confirmadas → familias separadas; Sistemas del Cliente y Uso indebido no se mezclan", () => {
    expect(diagnosisFamily("incidente_sistemas_del_cliente", null, m).family).toBe("SISTEMAS_CLIENTE");
    expect(diagnosisFamily("incidente_uso_indebido", null, m).family).toBe("USO_INDEBIDO");
    expect(diagnosisFamily("incidente_estándar_plataforma", null, m).family).toBe("ESTANDAR");
  });
  it("infraestructura: CLOUD → Vincle, OP → cliente, sin alojamiento → pendiente (no se infiere); causa nueva → Otros con valor original", () => {
    expect(diagnosisFamily("incidente_infraestructura", "CLOUD", m).family).toBe("INFRA_VINCLE_CLOUD");
    expect(diagnosisFamily("incidente_infraestructura", "OP", m).family).toBe("INFRA_CLIENTE_OP");
    expect(diagnosisFamily("incidente_infraestructura", null, m)).toMatchObject({ family: "OTROS", pending: expect.stringMatching(/alojamiento/) });
    expect(diagnosisFamily("hardware", null, m)).toMatchObject({ family: "OTROS", pending: expect.stringMatching(/hardware/) });
    expect(diagnosisFamily(null, null, m).family).toBe("SIN_CAUSA");
  });
});
