/**
 * Configuración de Calidad (CSAPP-07 §9-§10), sin dependencias de servidor: pesos exactos, cobertura, reglas de umbral, edad de backlog,
 * composición propuesta y plantilla del global. En 07 solo se CONFIGURA y SIMULA; el dashboard y Client Health son de CSAPP-08.
 * Reglas: docs/producto/calidad.md (QLT 03-10, QHL 01), docs/producto/backlog-antiguedad.md (BACK 04-10), docs/producto/administracion.md.
 * Nada aquí fija umbrales numéricos, mínimos de muestra ni límites del global: se inicializan SIN CALIBRAR y nunca producen un verde por defecto.
 */
import { z } from "zod";
import { Dec } from "./finance";
import { percentileInc, sortDec } from "./pulse-stats";

// ---------------------------------------------------------------- Seis indicadores estables

export const INDICATOR_KEYS = ["HEALTH", "DEDICATION", "PAP_CORRECTIVE", "N3_ESCALATIONS", "INCIDENTS_PROBLEMS", "BUGS_STANDARD"] as const;
export type IndicatorKey = (typeof INDICATOR_KEYS)[number];
/** Nombres completos: no se muestran códigos Q ambiguos. */
export const INDICATOR_NAME: Record<IndicatorKey, string> = {
  HEALTH: "Client Health",
  DEDICATION: "Dedicación",
  PAP_CORRECTIVE: "PAP correctivos",
  N3_ESCALATIONS: "Escalados N3",
  INCIDENTS_PROBLEMS: "Incidentes y problemas",
  BUGS_STANDARD: "Bugs y afectación del estándar",
};
/** Client Health es la única fuente que puede estar en blanco (sin feedback): su peso se redistribuye. */
export const BLANKABLE: IndicatorKey = "HEALTH";

// ---------------------------------------------------------------- Pesos exactos

/** Entero en centésimas de porcentaje: 100 % = 10000. Sin tolerancia flotante. */
export const WEIGHT_TOTAL_CENTS = 10000;

export type WeightMode = "EQUAL" | "CUSTOM";
export type WeightsConfig = { mode: WeightMode; custom: Record<IndicatorKey, string> };

/** Porcentaje en texto («15», «15,5», «15.25») → centésimas enteras; null si es negativo, tiene más de dos decimales o no es número. */
export function parsePercentCents(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return cents <= WEIGHT_TOTAL_CENTS ? cents : null;
}

export type WeightIssue = { key: IndicatorKey | "total"; message: string };

/** Valida el modo y devuelve las unidades enteras de cada peso (iguales: 1 cada uno → 1/6; personalizados: centésimas). */
export function weightUnits(cfg: WeightsConfig): { units: Record<IndicatorKey, number> | null; issues: WeightIssue[] } {
  if (cfg.mode === "EQUAL") return { units: Object.fromEntries(INDICATOR_KEYS.map((k) => [k, 1])) as Record<IndicatorKey, number>, issues: [] };
  const issues: WeightIssue[] = [];
  const units = {} as Record<IndicatorKey, number>;
  let sum = 0;
  for (const k of INDICATOR_KEYS) {
    const c = parsePercentCents(cfg.custom[k] ?? "");
    if (c === null) issues.push({ key: k, message: `${INDICATOR_NAME[k]}: indique un porcentaje no negativo con hasta dos decimales.` });
    else {
      units[k] = c;
      sum += c;
    }
  }
  if (issues.length === 0 && sum !== WEIGHT_TOTAL_CENTS) issues.push({ key: "total", message: `Los seis pesos deben sumar exactamente 100 %; suman ${(sum / 100).toFixed(2).replace(".", ",")} %.` });
  return { units: issues.length === 0 ? units : null, issues };
}

export type Rational = { num: bigint; den: bigint };
export type EffectiveWeights = {
  /** Fracción exacta de cada indicador entre los que influyen (peso positivo y con dato). */
  fraction: Record<IndicatorKey, Rational>;
  percent: Record<IndicatorKey, string>;
  /** Pesos configurados (fracción del total de seis). */
  configuredPercent: Record<IndicatorKey, string>;
  redistributedFromHealth: boolean;
  computable: boolean;
  reasons: string[];
};

export type Availability = "AVAILABLE" | "BLANK" | "MISSING";
const ZERO_R: Rational = { num: 0n, den: 1n };
const fmtPct = (r: Rational): string => (r.num === 0n ? "0" : Dec.int(100).ratio(r.num, r.den).toString());

/**
 * Pesos efectivos. Sin feedback Client Health (BLANK) se redistribuye SOLO su peso proporcionalmente entre los demás: `peso_i / (total − peso_Health)`.
 * Una fuente técnica ausente (MISSING) con peso positivo NO se redistribuye ni se convierte en cero: el global queda no calculable y se explica.
 * Un indicador de peso cero no influye ni bloquea por falta de datos.
 */
export function effectiveWeights(units: Record<IndicatorKey, number>, availability: Record<IndicatorKey, Availability>): EffectiveWeights {
  const total = INDICATOR_KEYS.reduce((s, k) => s + units[k], 0);
  const reasons: string[] = [];
  const cfgPct = Object.fromEntries(INDICATOR_KEYS.map((k) => [k, total === 0 ? "0" : fmtPct({ num: BigInt(units[k]), den: BigInt(total) })])) as Record<IndicatorKey, string>;
  let computable = true;
  const active = {} as Record<IndicatorKey, number>;
  for (const k of INDICATOR_KEYS) {
    const a = availability[k];
    if (units[k] === 0) active[k] = 0;
    else if (a === "AVAILABLE") active[k] = units[k];
    else if (a === "BLANK" && k === BLANKABLE) active[k] = 0;
    else {
      active[k] = 0;
      computable = false;
      reasons.push(`${INDICATOR_NAME[k]} (peso positivo) no tiene dato: el global no se publica completo; la fuente técnica ausente no se redistribuye ni cuenta como cero.`);
    }
  }
  const denom = INDICATOR_KEYS.reduce((s, k) => s + active[k], 0);
  if (denom === 0) {
    computable = false;
    if (reasons.length === 0) reasons.push("Ningún indicador con peso positivo y dato: el global no es calculable.");
  }
  const redistributed = availability[BLANKABLE] === "BLANK" && units[BLANKABLE] > 0;
  const fraction = Object.fromEntries(INDICATOR_KEYS.map((k) => [k, denom === 0 || active[k] === 0 ? ZERO_R : { num: BigInt(active[k]), den: BigInt(denom) }])) as Record<IndicatorKey, Rational>;
  return {
    fraction,
    percent: Object.fromEntries(INDICATOR_KEYS.map((k) => [k, fmtPct(fraction[k])])) as Record<IndicatorKey, string>,
    configuredPercent: cfgPct,
    redistributedFromHealth: redistributed,
    computable,
    reasons,
  };
}

// ---------------------------------------------------------------- Reglas de umbral

export type Color = "green" | "yellow" | "red";
export const COLOR_LABEL: Record<Color, string> = { green: "Verde", yellow: "Amarillo", red: "Rojo" };
export type RuleDirection = "LOWER_BETTER" | "HIGHER_BETTER";
export type RuleMethod = "ABSOLUTE" | "PERCENTILE" | "CATEGORICAL";

export type ThresholdRule = {
  method: RuleMethod;
  direction: RuleDirection;
  /** Absoluto: límites a<b (texto decimal). Percentil: posiciones 0-100 con hasta dos decimales (pA<=pB). */
  a: string | null;
  b: string | null;
  /** Referencia explícita de la MISMA métrica (id de referencia de Pulse). */
  referenceId: string | null;
  /** Muestra mínima elegida para colorear (propia de Calidad, no de las bandas de Pulse). null = sin mínimo configurado. */
  minSample: number | null;
  calibration: "SIN_CALIBRAR" | "CALIBRADO";
};

export type RuleOutcome = {
  color: Color | null;
  status: "OK" | "SIN_CALIBRAR" | "SIN_REGLA" | "SIN_REFERENCIA" | "DATO_INVALIDO" | "REGLA_INVALIDA";
  reason: string;
  cuts?: { a: string; b: string };
};

/** Valida una regla numérica. Devuelve los problemas (vacío = utilizable). */
export function validateRule(r: ThresholdRule): string[] {
  const out: string[] = [];
  if (r.method === "CATEGORICAL") return out;
  const a = r.a === null ? null : Dec.parse(r.a.replace(",", "."));
  const b = r.b === null ? null : Dec.parse(r.b.replace(",", "."));
  if (r.a === null || r.b === null || r.a === "" || r.b === "") return ["Faltan los dos límites."];
  if (a === null || b === null) return ["Los límites deben ser números."];
  if (r.method === "ABSOLUTE") {
    if (a.sign() < 0 || b.sign() < 0) out.push("Un límite absoluto de carga o tasa no puede ser negativo.");
    if (a.cmp(b) >= 0) out.push("En valores absolutos debe cumplirse a < b.");
  } else {
    const hundred = Dec.int(100);
    if (a.sign() < 0 || b.sign() < 0 || a.cmp(hundred) > 0 || b.cmp(hundred) > 0) out.push("Las posiciones de percentil deben estar en [0, 100].");
    if (a.cmp(b) > 0) out.push("Las dos posiciones deben estar ordenadas (a ≤ b).");
    if (!/^\d{1,3}([.,]\d{1,2})?$/.test(r.a) || !/^\d{1,3}([.,]\d{1,2})?$/.test(r.b)) out.push("Las posiciones admiten hasta dos decimales.");
    if (!r.referenceId) out.push("Un método por percentiles exige una referencia explícita de la misma métrica.");
  }
  if (r.minSample !== null && (!Number.isInteger(r.minSample) || r.minSample < 1)) out.push("La muestra mínima debe ser un entero positivo.");
  return out;
}

/** Corte en un percentil arbitrario (posición 0-100, dos decimales) de una muestra, con la misma interpolación inclusiva. */
export function percentileAt(values: readonly Dec[], position: string): Dec | null {
  const cents = parsePercentCents(position);
  if (cents === null) return null;
  return percentileInc(sortDec(values), cents, WEIGHT_TOTAL_CENTS);
}

/**
 * Evalúa un valor con una regla determinista. Menor mejor: verde x≤a, amarillo a<x≤b, rojo x>b. Mayor mejor: rojo x<a, amarillo a≤x<b, verde x≥b.
 * Sin calibrar, sin regla, referencia insuficiente o dato inválido devuelven un estado explícito, NUNCA verde por defecto.
 */
export function evaluateRule(rule: ThresholdRule | null, value: Dec | null, referenceValues: readonly Dec[] | null): RuleOutcome {
  if (rule === null) return { color: null, status: "SIN_REGLA", reason: "No hay regla configurada." };
  if (rule.method === "CATEGORICAL") return { color: null, status: "REGLA_INVALIDA", reason: "Una regla categórica no se evalúa con un número." };
  if (rule.calibration !== "CALIBRADO") return { color: null, status: "SIN_CALIBRAR", reason: "Umbrales sin calibrar: no se asigna color." };
  const problems = validateRule(rule);
  if (problems.length > 0) return { color: null, status: "REGLA_INVALIDA", reason: problems[0] };
  if (value === null) return { color: null, status: "DATO_INVALIDO", reason: "Dato ausente o no calculable." };
  let a = Dec.parse((rule.a as string).replace(",", ".")) as Dec;
  let b = Dec.parse((rule.b as string).replace(",", ".")) as Dec;
  if (rule.method === "PERCENTILE") {
    const ref = referenceValues ?? [];
    if (ref.length === 0) return { color: null, status: "SIN_REFERENCIA", reason: "Referencia sin entidades válidas." };
    if (rule.minSample !== null && ref.length < rule.minSample) return { color: null, status: "SIN_REFERENCIA", reason: `Referencia insuficiente: ${ref.length} < ${rule.minSample} entidades.` };
    a = percentileAt(ref, rule.a as string) as Dec;
    b = percentileAt(ref, rule.b as string) as Dec;
  }
  const cuts = { a: a.toString(), b: b.toString() };
  if (rule.direction === "LOWER_BETTER") {
    const color: Color = value.cmp(a) <= 0 ? "green" : value.cmp(b) <= 0 ? "yellow" : "red";
    return { color, status: "OK", reason: "menor mejor: verde x≤a · amarillo a<x≤b · rojo x>b", cuts };
  }
  const color: Color = value.cmp(a) < 0 ? "red" : value.cmp(b) < 0 ? "yellow" : "green";
  return { color, status: "OK", reason: "mayor mejor: rojo x<a · amarillo a≤x<b · verde x≥b", cuts };
}

// ---------------------------------------------------------------- Client Health (categórico, propuesta)

export type HealthState = "positive" | "mixed" | "negative";
export type HealthMapping = Record<HealthState, Color>;
/** PROPUESTA explícita (no confirmada): positivo→verde, mixto→amarillo, negativo→rojo. La ausencia de feedback no es un estado: se deja en blanco. */
export const PROPOSED_HEALTH_MAPPING: HealthMapping = { positive: "green", mixed: "yellow", negative: "red" };
export function healthColor(state: HealthState | null, mapping: HealthMapping | null): { color: Color | null; blank: boolean } {
  if (state === null) return { color: null, blank: true };
  return { color: mapping ? mapping[state] : null, blank: false };
}

// ---------------------------------------------------------------- Incidentes y problemas: edad, stock y flujo (BACK 04-10)

/** Edad en días naturales al corte observado. Envejecido es edad > umbral (no ≥). */
export const isAged = (ageDays: number, thresholdDays: number): boolean => ageDays > thresholdDays;

export type AgeBand = { from: number; to: number | null };
/** Bandas de edad ordenadas, sin solapamiento ni huecos; la última puede quedar abierta. */
export function validateAgeBands(bands: readonly AgeBand[]): string[] {
  const out: string[] = [];
  if (bands.length === 0) return ["Defina al menos una banda de edad."];
  if (bands[0].from !== 0) out.push("La primera banda debe empezar en el día 0.");
  bands.forEach((b, i) => {
    if (!Number.isInteger(b.from) || b.from < 0 || (b.to !== null && (!Number.isInteger(b.to) || b.to < b.from))) out.push(`Banda ${i + 1}: límites no válidos.`);
    if (b.to === null && i !== bands.length - 1) out.push(`Banda ${i + 1}: solo la última puede quedar abierta.`);
    if (i > 0) {
      const prev = bands[i - 1];
      if (prev.to !== null && b.from <= prev.to) out.push(`Banda ${i + 1} se solapa con la anterior.`);
      else if (prev.to !== null && b.from > prev.to + 1) out.push(`Hay un hueco no declarado entre las bandas ${i} y ${i + 1}.`);
    }
  });
  return out;
}

/** Stock de backlog envejecido por usuario AL CORTE (no se divide por exposición). */
export function backlogStockRate(aged: number, usersAtCut: number | null): Dec | null {
  if (usersAtCut === null || usersAtCut <= 0) return null;
  return Dec.int(aged).div(Dec.int(usersAtCut));
}
/** Flujo de altas por exposición del periodo (usuarios mes). Un ticket antiguo abierto entra en el backlog aunque no tenga alta en el mes. */
export function flowRate(altas: number, userMonths: Dec | null): Dec | null {
  if (userMonths === null || userMonths.sign() <= 0) return null;
  return Dec.int(altas).div(userMonths);
}

const SEVERITY_RANK: Record<Color, number> = { green: 0, yellow: 1, red: 2 };
/** Composición PROPUESTA (BACK 07, desactivada): peor señal entre flujo y backlog envejecido. Un componente sin color deja la composición sin color. */
export function worstSignal(components: readonly (Color | null)[]): Color | null {
  if (components.length === 0 || components.some((c) => c === null)) return null;
  return (components as Color[]).reduce((w, c) => (SEVERITY_RANK[c] > SEVERITY_RANK[w] ? c : w));
}

// ---------------------------------------------------------------- Plantilla del global (propuesta, no activada)

export type GlobalTemplate = {
  /** Plantilla propuesta; no la ha aceptado nadie hasta que el Administrador la active. */
  template: "WEIGHTED_SEVERITY";
  enabled: boolean;
  severity: Record<Color, string>;
  /** Límites del score (suma ponderada de severidades) dentro de [0,1]; null = sin elegir → no hay color final. */
  greenMax: string | null;
  yellowMax: string | null;
};
export const PROPOSED_SEVERITY: Record<Color, string> = { green: "0", yellow: "0.5", red: "1" };

export function validateGlobal(g: GlobalTemplate): string[] {
  const out: string[] = [];
  if (!g.enabled) return out;
  const gm = g.greenMax === null ? null : Dec.parse(g.greenMax.replace(",", "."));
  const ym = g.yellowMax === null ? null : Dec.parse(g.yellowMax.replace(",", "."));
  if (gm === null || ym === null) return ["Elija los dos límites del global (no se asignan límites automáticos)."];
  const one = Dec.int(1);
  if (gm.sign() < 0 || ym.sign() < 0 || gm.cmp(one) > 0 || ym.cmp(one) > 0) out.push("Los dos límites deben estar dentro de [0, 1].");
  if (gm.cmp(ym) > 0) out.push("Debe cumplirse límite verde ≤ límite amarillo.");
  return out;
}

export type GlobalOutcome = { color: Color | null; score: string | null; status: "OK" | "SIN_METODO" | "COBERTURA_INSUFICIENTE" | "SIN_COLORES"; reason: string };

/**
 * Global simulado: severidad verde=0, amarillo=0,5, rojo=1; score = Σ peso efectivo × severidad; verde si score ≤ límite verde, amarillo si ≤ límite
 * amarillo, rojo si mayor. Sin método/límites elegidos o con cobertura técnica insuficiente NO se genera color. Sin salvaguarda «un rojo obliga a rojo».
 */
export function evaluateGlobal(g: GlobalTemplate, weights: EffectiveWeights, colors: Record<IndicatorKey, Color | null>): GlobalOutcome {
  if (!g.enabled || validateGlobal(g).length > 0 || g.greenMax === null || g.yellowMax === null) {
    return { color: null, score: null, status: "SIN_METODO", reason: "No se ha elegido método y límites del global: no se genera color final." };
  }
  if (!weights.computable) return { color: null, score: null, status: "COBERTURA_INSUFICIENTE", reason: weights.reasons[0] ?? "Cobertura técnica insuficiente." };
  let score = Dec.ZERO;
  for (const k of INDICATOR_KEYS) {
    const f = weights.fraction[k];
    if (f.num === 0n) continue;
    const c = colors[k];
    if (c === null) return { color: null, score: null, status: "SIN_COLORES", reason: `${INDICATOR_NAME[k]} no tiene color (sin calibrar o sin dato): no se calcula el global.` };
    const sev = Dec.parse(g.severity[c]) as Dec;
    score = score.add(sev.ratio(f.num, f.den));
  }
  const gm = Dec.parse(g.greenMax.replace(",", ".")) as Dec;
  const ym = Dec.parse(g.yellowMax.replace(",", ".")) as Dec;
  const color: Color = score.cmp(gm) <= 0 ? "green" : score.cmp(ym) <= 0 ? "yellow" : "red";
  return { color, score: score.toString(), status: "OK", reason: "suma ponderada de severidades con pesos efectivos" };
}

// ---------------------------------------------------------------- Carga útil tipada de la configuración de Calidad

const colorZ = z.enum(["green", "yellow", "red"]);
const ruleZ = z.object({
  method: z.enum(["ABSOLUTE", "PERCENTILE", "CATEGORICAL"]),
  direction: z.enum(["LOWER_BETTER", "HIGHER_BETTER"]),
  a: z.string().max(20).nullable(),
  b: z.string().max(20).nullable(),
  referenceId: z.string().max(60).nullable(),
  minSample: z.number().int().min(1).max(1_000_000).nullable(),
  calibration: z.enum(["SIN_CALIBRAR", "CALIBRADO"]),
});
const indicatorZ = z.object({
  /** Normalización/ámbito declarados para no comparar tasas mensuales con anuales ni un stock con usuarios mes. */
  unit: z.string().max(60),
  normalization: z.enum(["POR_USUARIO_MES", "POR_100_USUARIOS_MES", "POR_USUARIO_STOCK", "CATEGORIA", "ANUAL_EQUIVALENTE"]),
  scope: z.enum(["GRUPO", "CLIENTE"]),
  rule: ruleZ,
});
export const qualityConfigSchema = z.object({
  schema: z.literal("quality-config-v1"),
  weights: z.object({ mode: z.enum(["EQUAL", "CUSTOM"]), custom: z.record(z.enum(INDICATOR_KEYS), z.string().max(10)) }),
  indicators: z.record(z.enum(INDICATOR_KEYS), indicatorZ),
  health: z.object({ mapping: z.object({ positive: colorZ, mixed: colorZ, negative: colorZ }), confirmed: z.boolean() }),
  dedication: z.object({ profiles: z.array(z.string().max(40)).max(10), selectionConfirmed: z.boolean() }),
  incidents: z.object({
    ageBands: z.array(z.object({ from: z.number().int().min(0).max(100000), to: z.number().int().min(0).max(100000).nullable() })).max(20),
    concerningDays: z.object({ incident: z.number().int().min(0).max(100000).nullable(), problem: z.number().int().min(0).max(100000).nullable() }),
    /** BACK 07: peor señal entre flujo y backlog envejecido. PROPUESTA, desactivada hasta que el Administrador la active. */
    worstOfFlowAndBacklog: z.boolean(),
  }),
  global: z.object({
    template: z.literal("WEIGHTED_SEVERITY"),
    enabled: z.boolean(),
    severity: z.object({ green: z.string().max(10), yellow: z.string().max(10), red: z.string().max(10) }),
    greenMax: z.string().max(10).nullable(),
    yellowMax: z.string().max(10).nullable(),
  }),
});
export type QualityConfig = z.infer<typeof qualityConfigSchema>;

const emptyRule = (direction: RuleDirection): ThresholdRule => ({ method: "ABSOLUTE", direction, a: null, b: null, referenceId: null, minSample: null, calibration: "SIN_CALIBRAR" });

/** Configuración inicial: pesos iguales CONFIRMADOS; todo lo demás sin calibrar / propuesta desactivada. */
export function defaultQualityConfig(): QualityConfig {
  const ind = (unit: string, normalization: QualityConfig["indicators"]["HEALTH"]["normalization"], scope: "GRUPO" | "CLIENTE" = "GRUPO", direction: RuleDirection = "LOWER_BETTER") => ({ unit, normalization, scope, rule: emptyRule(direction) });
  return {
    schema: "quality-config-v1",
    weights: { mode: "EQUAL", custom: Object.fromEntries(INDICATOR_KEYS.map((k) => [k, ""])) as Record<IndicatorKey, string> },
    indicators: {
      HEALTH: { ...ind("categoría", "CATEGORIA", "CLIENTE"), rule: { ...emptyRule("HIGHER_BETTER"), method: "CATEGORICAL" } },
      DEDICATION: ind("horas por usuario y mes", "POR_USUARIO_MES"),
      PAP_CORRECTIVE: ind("PAP correctivos por 100 usuarios y mes", "POR_100_USUARIOS_MES"),
      N3_ESCALATIONS: ind("tickets escalados a N3 por 100 usuarios y mes", "POR_100_USUARIOS_MES"),
      INCIDENTS_PROBLEMS: ind("tickets por 100 usuarios y mes (flujo) / envejecidos por usuario al corte (stock)", "POR_100_USUARIOS_MES"),
      BUGS_STANDARD: ind("problemas vinculados por 100 usuarios y mes", "POR_100_USUARIOS_MES"),
    },
    health: { mapping: { ...PROPOSED_HEALTH_MAPPING }, confirmed: false },
    dedication: { profiles: [], selectionConfirmed: false },
    incidents: { ageBands: [], concerningDays: { incident: null, problem: null }, worstOfFlowAndBacklog: false },
    global: { template: "WEIGHTED_SEVERITY", enabled: false, severity: { ...PROPOSED_SEVERITY }, greenMax: null, yellowMax: null },
  };
}

export type ConfigIssue = { path: string; message: string };

/** Validación semántica completa de la sección Calidad. Vacío = se puede activar. */
export function validateQualityConfig(cfg: QualityConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const i of weightUnits({ mode: cfg.weights.mode, custom: cfg.weights.custom as Record<IndicatorKey, string> }).issues) issues.push({ path: `weights.${i.key}`, message: i.message });
  for (const k of INDICATOR_KEYS) {
    const r = cfg.indicators[k].rule;
    if (r.calibration === "CALIBRADO") for (const m of validateRule(r)) issues.push({ path: `indicators.${k}`, message: `${INDICATOR_NAME[k]}: ${m}` });
    else if (r.a !== null || r.b !== null) {
      // Un borrador con límites a medias se admite solo si es coherente; sin calibrar nunca colorea.
      const partial = r.a !== null && r.b !== null && r.a !== "" && r.b !== "" ? validateRule(r) : [];
      for (const m of partial) issues.push({ path: `indicators.${k}`, message: `${INDICATOR_NAME[k]}: ${m}` });
    }
  }
  if (cfg.incidents.ageBands.length > 0) for (const m of validateAgeBands(cfg.incidents.ageBands)) issues.push({ path: "incidents.ageBands", message: m });
  if (cfg.incidents.worstOfFlowAndBacklog) {
    if (cfg.incidents.concerningDays.incident === null || cfg.incidents.concerningDays.problem === null) {
      issues.push({ path: "incidents.worstOfFlowAndBacklog", message: "La composición «peor señal» necesita el umbral preocupante de incidentes y de problemas antes de activarse." });
    }
    if (cfg.indicators.INCIDENTS_PROBLEMS.rule.calibration !== "CALIBRADO") {
      issues.push({ path: "incidents.worstOfFlowAndBacklog", message: "La composición «peor señal» necesita componentes configurados (umbrales calibrados) antes de activarse." });
    }
  }
  for (const m of validateGlobal({ ...cfg.global, template: "WEIGHTED_SEVERITY" })) issues.push({ path: "global", message: m });
  for (const c of ["green", "yellow", "red"] as const) {
    const d = Dec.parse(cfg.global.severity[c].replace(",", "."));
    if (d === null || d.sign() < 0 || d.cmp(Dec.int(1)) > 0) issues.push({ path: "global.severity", message: "Las severidades deben estar en [0, 1]." });
  }
  return issues;
}
