import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { Dec } from "@/domain/finance";
import {
  INDICATOR_KEYS, PROPOSED_SEVERITY, uncalibratedQualityConfig as defaultQualityConfig, effectiveWeights, evaluateGlobal, evaluateRule, healthColor, isAged, parsePercentCents, validateAgeBands,
  validateQualityConfig, validateRule, weightUnits, worstSignal, backlogStockRate, flowRate, percentileAt,
  type Availability, type Color, type IndicatorKey, type QualityConfig, type ThresholdRule, type GlobalTemplate,
} from "@/domain/quality-config";
import { activateDraft, discardDraft, getActive, getDraft, getManifest, listRevisions, rollbackTo, saveDraft } from "@/server/pulse/config";
import { readDataStamp } from "@/server/analytics/stamp";
import { defaultPulseConfig } from "@/domain/pulse-catalog";
import { resetDatabase, makeUsers, useUncalibratedQuality } from "./helpers";

const D = (v: string | number) => Dec.parse(String(v)) as Dec;
const custom = (v: number[]) => ({ mode: "CUSTOM" as const, custom: Object.fromEntries(INDICATOR_KEYS.map((k, i) => [k, String(v[i])])) as Record<IndicatorKey, string> });
const avail = (over: Partial<Record<IndicatorKey, Availability>> = {}): Record<IndicatorKey, Availability> => ({ ...(Object.fromEntries(INDICATOR_KEYS.map((k) => [k, "AVAILABLE"])) as Record<IndicatorKey, Availability>), ...over });

describe("pesos exactos", () => {
  it("iguales: seis fracciones 1/6, total 100 % (no se almacenan seis 16,67)", () => {
    const { units, issues } = weightUnits({ mode: "EQUAL", custom: {} as never });
    expect(issues).toEqual([]);
    const w = effectiveWeights(units!, avail());
    expect(w.fraction.HEALTH).toEqual({ num: 1n, den: 6n });
    expect(w.percent.HEALTH).toBe("16.66666666666666666667");
    expect(INDICATOR_KEYS.reduce((s, k) => s + Number(w.fraction[k].num), 0)).toBe(6);
    const cfg = defaultQualityConfig();
    expect(cfg.weights.mode).toBe("EQUAL");
    expect(Object.values(cfg.weights.custom).every((v) => v === "")).toBe(true);
  });
  it("sin Client Health, los otros cinco pesan 1/5 = 20 %", () => {
    const w = effectiveWeights(weightUnits({ mode: "EQUAL", custom: {} as never }).units!, avail({ HEALTH: "BLANK" }));
    expect(w.redistributedFromHealth).toBe(true);
    expect(w.computable).toBe(true);
    expect(INDICATOR_KEYS.filter((k) => k !== "HEALTH").map((k) => w.percent[k])).toEqual(Array(5).fill("20"));
    expect(w.percent.HEALTH).toBe("0");
  });
  it("personalizados: 20+20+15+15+15+15 válido; sin Health quedan 25 + 18,75×4", () => {
    const ok = weightUnits(custom([20, 20, 15, 15, 15, 15]));
    expect(ok.issues).toEqual([]);
    const w = effectiveWeights(ok.units!, avail({ HEALTH: "BLANK" }));
    expect(INDICATOR_KEYS.map((k) => w.percent[k])).toEqual(["0", "25", "18.75", "18.75", "18.75", "18.75"]);
    expect(w.configuredPercent.HEALTH).toBe("20");
  });
  it("99, 101 y 100,02 se rechazan (enteros en centésimas, sin tolerancia flotante); dos decimales sí", () => {
    expect(weightUnits(custom([20, 20, 15, 15, 15, 14])).issues[0].message).toMatch(/exactamente 100/);
    expect(weightUnits(custom([20, 20, 15, 15, 15, 16])).issues[0].key).toBe("total");
    expect(weightUnits({ mode: "CUSTOM", custom: { ...custom([20, 20, 15, 15, 15, 15.02]).custom, DEDICATION: "20" } as never }).issues[0].message).toMatch(/exactamente 100/);
    const decimals = weightUnits({ mode: "CUSTOM", custom: { HEALTH: "33.33", DEDICATION: "33,33", PAP_CORRECTIVE: "33.34", N3_ESCALATIONS: "0", INCIDENTS_PROBLEMS: "0", BUGS_STANDARD: "0" } });
    expect(decimals.issues).toEqual([]);
    expect(parsePercentCents("12.345")).toBeNull();
    expect(parsePercentCents("-1")).toBeNull();
    expect(parsePercentCents("100.01")).toBeNull();
    expect(parsePercentCents("abc")).toBeNull();
  });
  it("peso cero desactiva la influencia y no bloquea por falta de datos; Health=100 sin dato → no calculable", () => {
    const u = weightUnits(custom([0, 40, 20, 20, 10, 10])).units!;
    const w = effectiveWeights(u, avail({ HEALTH: "MISSING" }));
    expect(w.computable).toBe(true); // peso 0: no influye ni bloquea
    const only = weightUnits(custom([100, 0, 0, 0, 0, 0])).units!;
    const none = effectiveWeights(only, avail({ HEALTH: "BLANK" }));
    expect(none.computable).toBe(false);
    expect(none.reasons[0]).toMatch(/Ningún indicador/);
  });
  it("un KPI técnico ausente con peso positivo CONSERVA su asignación (no aumenta la de los demás): el global no se publica completo y la cobertura lo dice", () => {
    const u = weightUnits({ mode: "EQUAL", custom: {} as never }).units!;
    const w = effectiveWeights(u, avail({ DEDICATION: "MISSING" }));
    expect(w.computable).toBe(false);
    expect(w.reasons[0]).toMatch(/no se redistribuye/);
    expect(w.fraction.DEDICATION).toEqual({ num: 1n, den: 6n });
    expect(w.fraction.PAP_CORRECTIVE).toEqual({ num: 1n, den: 6n });
    expect(w.coverage).toEqual({ num: 5n, den: 6n });
  });
});

describe("reglas de umbral deterministas", () => {
  const rule = (o: Partial<ThresholdRule> = {}): ThresholdRule => ({ method: "ABSOLUTE", direction: "LOWER_BETTER", a: "10", b: "20", referenceId: null, minSample: null, calibration: "CALIBRADO", unit: "PER_100_USER_MONTHS", ...o });
  const colorAt = (r: ThresholdRule, x: number | null, ref?: number[]) => evaluateRule(r, x === null ? null : D(x), ref ? ref.map(D) : null).color;
  it("menor mejor: verde x≤a · amarillo a<x≤b · rojo x>b (igualdades declaradas)", () => {
    expect([10, 10.01, 20, 20.01].map((x) => colorAt(rule(), x))).toEqual(["green", "yellow", "yellow", "red"]);
  });
  it("mayor mejor: rojo x<a · amarillo a≤x<b · verde x≥b", () => {
    const r = rule({ direction: "HIGHER_BETTER" });
    expect([9.99, 10, 19.99, 20].map((x) => colorAt(r, x))).toEqual(["red", "yellow", "yellow", "green"]);
  });
  it("sin calibrar, sin regla, dato ausente o regla inválida: nunca verde por defecto", () => {
    expect(evaluateRule(rule({ calibration: "SIN_CALIBRAR" }), D(1), null)).toMatchObject({ color: null, status: "SIN_CALIBRAR" });
    expect(evaluateRule(null, D(1), null).status).toBe("SIN_REGLA");
    expect(evaluateRule(rule(), null, null)).toMatchObject({ color: null, status: "DATO_INVALIDO" });
    expect(evaluateRule(rule({ a: "20", b: "10" }), D(1), null).status).toBe("REGLA_INVALIDA");
    expect(validateRule(rule({ a: "5", b: "5" }))[0]).toMatch(/a < b/);
    expect(validateRule(rule({ a: null }))[0]).toMatch(/Faltan/);
  });
  it("percentiles: dos posiciones ordenadas en [0,100] sobre una referencia explícita; los cortes pueden coincidir", () => {
    const p = rule({ method: "PERCENTILE", a: "25", b: "75", referenceId: "todos", minSample: 4 });
    const ref = [0, 10, 20, 30];
    expect(validateRule(rule({ method: "PERCENTILE", a: "25", b: "75", referenceId: "todos" }))[0]).toMatch(/muestra mínima/); // un mínimo requerido sin definir no se usa en silencio
    expect(percentileAt(ref.map(D), "25")?.toString()).toBe("7.5");
    expect([5, 7.5, 15, 22.5, 25].map((x) => colorAt(p, x, ref))).toEqual(["green", "green", "yellow", "yellow", "red"]);
    expect(validateRule(rule({ method: "PERCENTILE", a: "75", b: "25", referenceId: "x" }))[0]).toMatch(/ordenadas/);
    expect(validateRule(rule({ method: "PERCENTILE", a: "10", b: "101", referenceId: "x" }))[0]).toMatch(/\[0, 100\]/);
    expect(validateRule(rule({ method: "PERCENTILE", a: "10", b: "20", referenceId: null }))[0]).toMatch(/referencia explícita/);
    const same = evaluateRule(p, D(5), [5, 5, 5, 5].map(D));
    expect(same.cuts).toEqual({ a: "5", b: "5" }); // cortes iguales: sin epsilon
    expect(same.color).toBe("green");
  });
  it("referencia insuficiente (muestra mínima elegida) o vacía: sin referencia, nunca verde", () => {
    const p = rule({ method: "PERCENTILE", a: "25", b: "75", referenceId: "todos", minSample: 5 });
    expect(evaluateRule(p, D(1), [1, 2, 3].map(D))).toMatchObject({ color: null, status: "SIN_REFERENCIA" });
    expect(evaluateRule(p, D(1), [])).toMatchObject({ color: null, status: "SIN_REFERENCIA" });
  });
  it("Client Health es categórico: la ausencia queda en blanco y no hay propagación implícita", () => {
    const m = defaultQualityConfig().health.mapping;
    expect(healthColor("positive", { mapping: m, confirmed: true })).toEqual({ color: "green", blank: false });
    expect(healthColor("positive", { mapping: m, confirmed: false })).toEqual({ color: null, blank: false }); // propuesta: sin color publicado
    expect(healthColor(null, { mapping: m, confirmed: true })).toEqual({ color: null, blank: true });
    expect(defaultQualityConfig().health.confirmed).toBe(false); // propuesta, no confirmada
  });
});

describe("incidentes y problemas: edad, stock y flujo", () => {
  it("envejecido es edad > umbral (no ≥); stock y flujo usan denominadores distintos", () => {
    expect([isAged(30, 30), isAged(31, 30), isAged(0, 0)]).toEqual([false, true, false]);
    expect(backlogStockRate(6, 60)?.toString()).toBe("10"); // 100 × 6 / 60 por 100 usuarios AL CORTE (BACK 06)
    expect(flowRate(6, D(120))?.toString()).toBe("5"); // 100 × 6 / 120 usuarios·mes (exposición)
    expect(backlogStockRate(6, null)).toBeNull();
    expect(flowRate(6, D(0))).toBeNull();
  });
  it("bandas de edad ordenadas, sin solapamiento ni huecos", () => {
    expect(validateAgeBands([{ from: 0, to: 7 }, { from: 8, to: 30 }, { from: 31, to: null }])).toEqual([]);
    expect(validateAgeBands([{ from: 0, to: 7 }, { from: 7, to: 30 }])[0]).toMatch(/solapa/);
    expect(validateAgeBands([{ from: 0, to: 7 }, { from: 9, to: 30 }])[0]).toMatch(/hueco/);
    expect(validateAgeBands([{ from: 1, to: 7 }])[0]).toMatch(/día 0/);
    expect(validateAgeBands([{ from: 0, to: null }, { from: 5, to: 9 }])[0]).toMatch(/abierta/);
  });
  it("composición propuesta «peor señal»: un backlog rojo con pocas altas no acaba verde", () => {
    expect(worstSignal(["green", "red"])).toBe("red");
    expect(worstSignal(["green", "yellow"])).toBe("yellow");
    expect(worstSignal(["green", null])).toBeNull(); // sin componente no se inventa
    expect(worstSignal(["green", "green"])).toBe("green");
    expect(defaultQualityConfig().incidents.worstOfFlowAndBacklog).toBe(false); // desactivada
  });
});

describe("plantilla propuesta del global", () => {
  const eq = () => effectiveWeights(weightUnits({ mode: "EQUAL", custom: {} as never }).units!, avail());
  const colors = (c: Color): Record<IndicatorKey, Color | null> => Object.fromEntries(INDICATOR_KEYS.map((k) => [k, c])) as Record<IndicatorKey, Color | null>;
  const g = (o: Partial<GlobalTemplate> = {}): GlobalTemplate => ({ template: "WEIGHTED_SEVERITY", enabled: true, severity: { ...PROPOSED_SEVERITY }, greenMax: "0.25", yellowMax: "0.6", ...o });
  it("sin método ni límites elegidos no hay color final (no se asignan 0,33/0,66 automáticamente)", () => {
    expect(evaluateGlobal(g({ enabled: false }), eq(), colors("green"))).toMatchObject({ color: null, status: "SIN_METODO" });
    expect(evaluateGlobal(g({ greenMax: null, yellowMax: null }), eq(), colors("green")).status).toBe("SIN_METODO");
    expect(defaultQualityConfig().global).toMatchObject({ enabled: false, greenMax: null, yellowMax: null });
  });
  it("score = Σ peso efectivo × severidad (verde 0, amarillo 0,5, rojo 1) con límites e igualdades declaradas", () => {
    expect(evaluateGlobal(g(), eq(), colors("green"))).toMatchObject({ color: "green", score: "0" });
    expect(evaluateGlobal(g(), eq(), colors("red"))).toMatchObject({ color: "red", score: "1" });
    const mixed = { ...colors("green"), HEALTH: "red" as Color, DEDICATION: "red" as Color }; // 2/6 rojo
    const r = evaluateGlobal(g({ greenMax: "0.3333333333333333", yellowMax: "0.5" }), eq(), mixed);
    expect(r.score).toBe("0.33333333333333333333");
    expect(r.color).toBe("yellow");
    expect(evaluateGlobal(g({ greenMax: "0.5", yellowMax: "0.5" }), eq(), { ...colors("yellow") }).color).toBe("green"); // score 0,5 ≤ límite verde
    // Sin «un rojo obliga a global rojo»: un solo rojo de seis con límites amplios no tiñe todo.
    expect(evaluateGlobal(g({ greenMax: "0.2", yellowMax: "0.5" }), eq(), { ...colors("green"), BUGS_STANDARD: "red" }).color).toBe("green");
  });
  it("cobertura técnica insuficiente o un indicador sin color: no se genera color final", () => {
    const w = effectiveWeights(weightUnits({ mode: "EQUAL", custom: {} as never }).units!, avail({ N3_ESCALATIONS: "MISSING" }));
    expect(evaluateGlobal(g(), w, colors("green"))).toMatchObject({ color: null, status: "COBERTURA_INSUFICIENTE" });
    expect(evaluateGlobal(g(), eq(), { ...colors("green"), PAP_CORRECTIVE: null }).status).toBe("SIN_COLORES");
  });
  it("sin Health (blanco): el global usa cinco pesos de 20 %", () => {
    const w = effectiveWeights(weightUnits({ mode: "EQUAL", custom: {} as never }).units!, avail({ HEALTH: "BLANK" }));
    const r = evaluateGlobal(g(), w, { ...colors("green"), HEALTH: null, DEDICATION: "red" });
    expect(r.score).toBe("0.2");
  });
  it("la validación exige límites dentro de [0,1] y ordenados cuando se activa", () => {
    const cfg: QualityConfig = { ...defaultQualityConfig(), global: { template: "WEIGHTED_SEVERITY", enabled: true, severity: { ...PROPOSED_SEVERITY }, greenMax: "1.5", yellowMax: "0.5" } };
    expect(validateQualityConfig(cfg).map((i) => i.message).join()).toMatch(/\[0, 1\]/);
    expect(validateQualityConfig({ ...cfg, global: { ...cfg.global, greenMax: "0.7", yellowMax: "0.5" } })[0].message).toMatch(/verde ≤ límite amarillo/);
    expect(validateQualityConfig(defaultQualityConfig())).toEqual([]);
  });
});

// ---------------------------------------------------------------- Persistencia, revisiones y permisos

let admin: { id: string };
let reader: { id: string };
beforeEach(async () => {
  await resetDatabase();
  ({ admin, reader } = await makeUsers());
  await useUncalibratedQuality(admin.id);
});
const withWeights = (v: number[]): QualityConfig => ({ ...defaultQualityConfig(), weights: custom(v) });

describe("configuración versionada de Calidad y Pulse", () => {
  it("inicial en memoria (sin escribir en una lectura); borrador y simulación no alteran lo activo", async () => {
    const before = await getActive(prisma, "QUALITY");
    expect(before).toMatchObject({ revisionNo: 1, persisted: false, kind: "INITIAL" });
    expect(await prisma.configRevision.count()).toBe(0); // un GET nunca cambia parámetros
    const d = await saveDraft(admin.id, "QUALITY", withWeights([20, 20, 15, 15, 15, 15]), { expectedVersion: null, note: "prueba" });
    expect(d.version).toBe(1);
    expect((await getActive(prisma, "QUALITY")).payload.weights.mode).toBe("EQUAL");
    expect(await prisma.configRevision.count()).toBe(0);
    const again = await saveDraft(admin.id, "QUALITY", withWeights([20, 20, 15, 15, 15, 15]), { expectedVersion: 1 });
    expect(again.version).toBe(2);
    await expect(saveDraft(admin.id, "QUALITY", withWeights([20, 20, 15, 15, 15, 15]), { expectedVersion: 1 })).rejects.toThrow(/modificado por otra persona/);
  });
  it("totales 99, 101 y 100,02 se rechazan también en el servidor; el borrador no se guarda", async () => {
    for (const bad of [[20, 20, 15, 15, 15, 14], [20, 20, 15, 15, 15, 16], [20, 20, 15, 15, 15, 15.02]]) {
      await expect(saveDraft(admin.id, "QUALITY", withWeights(bad), { expectedVersion: null })).rejects.toThrow(/100/);
    }
    expect(await prisma.configDraft.count()).toBe(0);
  });
  it("activación atómica con auditoría; vuelta a una anterior crea una NUEVA revisión identificada; edición obsoleta rechazada", async () => {
    const d = await saveDraft(admin.id, "QUALITY", withWeights([20, 20, 15, 15, 15, 15]), { expectedVersion: null });
    const r2 = await activateDraft(admin.id, "QUALITY", { expectedRevisionNo: 1, expectedDraftVersion: d.version, reason: "Pesos personalizados" });
    expect(r2).toMatchObject({ revisionNo: 2, kind: "ACTIVATION", persisted: true });
    expect(await prisma.configRevision.count({ where: { family: "QUALITY" } })).toBe(2); // 1 inicial persistida + 2
    expect(await prisma.configDraft.count()).toBe(0);
    expect((await prisma.auditEvent.findMany({ where: { entityType: "Config:QUALITY" } })).map((a) => a.action)).toEqual(["ACTIVATE"]);
    const d2 = await saveDraft(admin.id, "QUALITY", defaultQualityConfig(), { expectedVersion: null });
    // Una edición basada en una revisión que ya no es la vigente se rechaza.
    await expect(activateDraft(admin.id, "QUALITY", { expectedRevisionNo: 1, expectedDraftVersion: d2.version, reason: "obsoleta" })).rejects.toThrow(/modificado por otra persona/);
    const back = await rollbackTo(admin.id, "QUALITY", { toRevisionNo: 1, expectedRevisionNo: 2, reason: "Volver a iguales" });
    expect(back).toMatchObject({ revisionNo: 3, kind: "ROLLBACK", restoredFromRevisionNo: 1 });
    expect(back.payload.weights.mode).toBe("EQUAL");
    expect((await listRevisions(admin.id, "QUALITY")).map((r) => r.revisionNo)).toEqual([3, 2, 1]);
    expect((await getActive(prisma, "QUALITY", 2)).payload.weights.mode).toBe("CUSTOM"); // la historia no cambia
  });
  it("las revisiones son inmutables (disparador): ni UPDATE ni DELETE", async () => {
    const d = await saveDraft(admin.id, "PULSE", defaultPulseConfig(), { expectedVersion: null });
    await activateDraft(admin.id, "PULSE", { expectedRevisionNo: 1, expectedDraftVersion: d.version, reason: "r" });
    await expect(prisma.$executeRawUnsafe(`UPDATE "ConfigRevision" SET reason = 'x'`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "ConfigRevision"`)).rejects.toThrow();
  });
  it("activar exige motivo y borrador; solo ADMIN escribe y ve borradores; Consulta lee las reglas aplicadas", async () => {
    await expect(activateDraft(admin.id, "QUALITY", { expectedRevisionNo: 1, expectedDraftVersion: 1, reason: "  " })).rejects.toThrow(/motivo/);
    await expect(activateDraft(admin.id, "QUALITY", { expectedRevisionNo: 1, expectedDraftVersion: 1, reason: "x" })).rejects.toThrow(/borrador/);
    await expect(saveDraft(reader.id, "QUALITY", defaultQualityConfig(), { expectedVersion: null })).rejects.toThrow();
    await expect(getDraft(reader.id, "QUALITY")).rejects.toThrow();
    await expect(rollbackTo(reader.id, "QUALITY", { toRevisionNo: 1, expectedRevisionNo: 1, reason: "x" })).rejects.toThrow();
    expect((await listRevisions(reader.id, "QUALITY"))[0].revisionNo).toBe(1);
    await discardDraft(admin.id, "QUALITY");
  });
  it("la estructura se valida: JSON arbitrario o fórmulas no se aceptan", async () => {
    await expect(saveDraft(admin.id, "QUALITY", { schema: "quality-config-v1", formula: "1+1" }, { expectedVersion: null })).rejects.toThrow();
    await expect(saveDraft(admin.id, "PULSE", { schema: "pulse-config-v1", references: [], directions: {}, profiles: {}, defaultReference: "x" }, { expectedVersion: null })).rejects.toThrow();
  });
  it("economía preservada; el manifiesto y el sello de datos cambian al activar otra configuración (invalida bandas previas)", async () => {
    const eco0 = await prisma.economicSettingsRevision.count();
    const s0 = (await readDataStamp(prisma as never)).stamp;
    const d = await saveDraft(admin.id, "PULSE", { ...defaultPulseConfig(), directions: { M01: "NONE" } }, { expectedVersion: null });
    await activateDraft(admin.id, "PULSE", { expectedRevisionNo: 1, expectedDraftVersion: d.version, reason: "Sin juicio en M01" });
    expect(await getManifest(prisma)).toMatchObject({ pulse: 2, quality: 1 });
    expect((await readDataStamp(prisma as never)).stamp).not.toBe(s0);
    expect(await prisma.economicSettingsRevision.count()).toBe(eco0); // la economía no se reinicia
    expect((await getActive(prisma, "PULSE")).payload.directions.M01).toBe("NONE");
  });
  it("activación concurrente de dos borradores: solo una gana el número de revisión (bloqueo por familia)", async () => {
    const d = await saveDraft(admin.id, "QUALITY", withWeights([20, 20, 15, 15, 15, 15]), { expectedVersion: null });
    const results = await Promise.allSettled([
      activateDraft(admin.id, "QUALITY", { expectedRevisionNo: 1, expectedDraftVersion: d.version, reason: "a" }),
      activateDraft(admin.id, "QUALITY", { expectedRevisionNo: 1, expectedDraftVersion: d.version, reason: "b" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.configRevision.count({ where: { family: "QUALITY" } })).toBe(2);
  });
});
