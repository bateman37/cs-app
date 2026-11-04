/**
 * Configuración y evaluación de Calidad (CSAPP-07 §9-§10 y CSAPP-08 §2, §5-§7), sin dependencias de servidor: pesos exactos y su cobertura,
 * reglas de umbral por ámbito y unidad, edad de backlog, composición propuesta, plantilla del global y adaptador de la carga v1.
 * El MISMO evaluador (`evaluateEntity`) lo usan el simulador de Administración y el motor del dashboard.
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
  /**
   * ASIGNACIÓN efectiva: fracción exacta de cada indicador. Solo la ausencia de Client Health (BLANK = sin feedback) autoriza redistribuir su peso;
   * una fuente técnica ausente, un parcial o un Health presente sin calibrar CONSERVAN su asignación (no aumentan el peso de los demás).
   */
  fraction: Record<IndicatorKey, Rational>;
  percent: Record<IndicatorKey, string>;
  /** Pesos configurados (fracción del total de seis). */
  configuredPercent: Record<IndicatorKey, string>;
  /** COBERTURA: parte de la asignación cuyos indicadores tienen valor calculable (AVAILABLE). Contribución disponible = esa parte. */
  coverage: Rational;
  coveragePercent: string;
  /** Indicadores con asignación positiva que no aportan (ausentes, parciales o sin calibrar). */
  uncovered: { key: IndicatorKey; availability: Availability }[];
  redistributedFromHealth: boolean;
  /** Global completo posible: ningún indicador con asignación positiva queda sin cubrir y hay asignación. */
  computable: boolean;
  reasons: string[];
};

/** AVAILABLE: valor calculable · BLANK: Health sin feedback (única ausencia redistribuible) · MISSING: sin dato/parcial/sin fuente · UNCALIBRATED: feedback presente sin mapeo activo. */
export type Availability = "AVAILABLE" | "BLANK" | "MISSING" | "UNCALIBRATED";
const ZERO_R: Rational = { num: 0n, den: 1n };
const fmtPct = (r: Rational): string => (r.num === 0n ? "0" : Dec.int(100).ratio(r.num, r.den).toString());

/**
 * Pesos efectivos. Denominador = suma de pesos configurados − peso de Client Health SOLO si Health está en blanco (sin feedback).
 * Un indicador de peso cero no influye ni bloquea. Cualquier otro indicador con peso positivo que no sea AVAILABLE deja el global incompleto
 * (con su motivo) pero NO se retira del denominador: la cobertura muestra la parte no cubierta.
 */
export function effectiveWeights(units: Record<IndicatorKey, number>, availability: Record<IndicatorKey, Availability>): EffectiveWeights {
  const total = INDICATOR_KEYS.reduce((s, k) => s + units[k], 0);
  const reasons: string[] = [];
  const cfgPct = Object.fromEntries(INDICATOR_KEYS.map((k) => [k, total === 0 ? "0" : fmtPct({ num: BigInt(units[k]), den: BigInt(total) })])) as Record<IndicatorKey, string>;
  const assigned = {} as Record<IndicatorKey, number>;
  const uncovered: EffectiveWeights["uncovered"] = [];
  let covered = 0;
  for (const k of INDICATOR_KEYS) {
    const a = availability[k];
    if (units[k] === 0 || (a === "BLANK" && k === BLANKABLE)) assigned[k] = 0;
    else {
      assigned[k] = units[k];
      if (a === "AVAILABLE") covered += units[k];
      else {
        uncovered.push({ key: k, availability: a });
        reasons.push(
          a === "UNCALIBRATED"
            ? `${INDICATOR_NAME[k]}: hay feedback pero el mapeo a color no está confirmado/activo («sin calibrar»); conserva su peso y bloquea el global.`
            : a === "BLANK"
              ? `${INDICATOR_NAME[k]}: solo Client Health puede quedar en blanco.`
              : `${INDICATOR_NAME[k]} (peso positivo) no tiene resultado calculable: conserva su peso asignado, no se redistribuye ni cuenta como cero; el global no es completo.`,
        );
      }
    }
  }
  const denom = INDICATOR_KEYS.reduce((s, k) => s + assigned[k], 0);
  const computable = denom > 0 && uncovered.length === 0;
  if (denom === 0) reasons.push("Ningún indicador con peso positivo y dato: el global no es calculable.");
  const frac = (n: number): Rational => (denom === 0 || n === 0 ? ZERO_R : { num: BigInt(n), den: BigInt(denom) });
  const fraction = Object.fromEntries(INDICATOR_KEYS.map((k) => [k, frac(assigned[k])])) as Record<IndicatorKey, Rational>;
  const coverage = frac(covered);
  return {
    fraction,
    percent: Object.fromEntries(INDICATOR_KEYS.map((k) => [k, fmtPct(fraction[k])])) as Record<IndicatorKey, string>,
    configuredPercent: cfgPct,
    coverage,
    coveragePercent: denom === 0 ? "0" : fmtPct(coverage),
    uncovered,
    redistributedFromHealth: availability[BLANKABLE] === "BLANK" && units[BLANKABLE] > 0,
    computable,
    reasons,
  };
}

// ---------------------------------------------------------------- Ámbitos y unidades

/** Ámbitos de resultado de Calidad. Una implantación no hereda KPI del Cliente: solo es detalle parcial de horas/PAP atribuibles. */
export const QUALITY_SCOPES = ["GRUPO", "CLIENTE"] as const;
export type QScope = (typeof QUALITY_SCOPES)[number];
export const QSCOPE_LABEL: Record<QScope, string> = { GRUPO: "Grupo Cliente", CLIENTE: "Cliente" };

/**
 * Unidad de cada magnitud. Una regla declara SU unidad: solo se aplica a una métrica de la misma unidad (sin cambios de escala ocultos).
 * Stock de backlog: envejecidos × 100 / usuarios al corte (BACK 06); la unidad por usuario de v1 solo existe para adaptar reglas antiguas.
 */
export type MetricUnit = "HOURS_PER_USER_MONTH" | "PER_USER_MONTH" | "PER_100_USER_MONTHS" | "PER_USER_STOCK" | "PER_100_USERS_STOCK" | "ANNUAL_EQUIVALENT" | "CATEGORY" | "TOTAL_HOURS" | "TOTAL_COUNT" | "RELATIVE";

/**
 * HOTFIX-03 §11: modo de medida de Calidad. «usuario» (predeterminado) divide cada numerador por la exposición de usuarios (por UN usuario, no por 100);
 * «total» usa el numerador observado sin denominador. Las referencias por percentiles se calculan SIEMPRE con los valores del modo elegido.
 */
export const MEASURES = ["usuario", "total"] as const;
export type Measure = (typeof MEASURES)[number];
export const MEASURE_LABEL: Record<Measure, string> = { usuario: "Por usuario", total: "Total" };
export const DEFAULT_MEASURE: Measure = "usuario";
/** Referencia propia de Calidad (HOTFIX-03 §12): entidades externas activas del mismo ámbito con valor válido; no depende de Pulse Rent. */
export const QUALITY_COHORT_REFERENCE = "QUALITY_COHORT";
export const UNIT_LABEL: Record<MetricUnit, string> = {
  HOURS_PER_USER_MONTH: "horas por usuario y mes",
  PER_USER_MONTH: "eventos por usuario y mes",
  PER_100_USER_MONTHS: "por 100 usuarios y mes",
  PER_USER_STOCK: "por usuario (stock al corte, escala v1)",
  PER_100_USERS_STOCK: "por 100 usuarios (stock al corte)",
  ANNUAL_EQUIVALENT: "equivalente anual",
  CATEGORY: "categoría",
  TOTAL_HOURS: "horas totales del periodo",
  TOTAL_COUNT: "total del periodo (unidades)",
  RELATIVE: "relativa a la referencia (percentiles; sin unidad propia)",
};
/** Unidad canónica de cada indicador y del componente de backlog. */
export const METRIC_UNIT: Record<IndicatorKey, MetricUnit> = {
  HEALTH: "CATEGORY",
  DEDICATION: "HOURS_PER_USER_MONTH",
  PAP_CORRECTIVE: "PER_100_USER_MONTHS",
  N3_ESCALATIONS: "PER_100_USER_MONTHS",
  INCIDENTS_PROBLEMS: "PER_100_USER_MONTHS",
  BUGS_STANDARD: "PER_100_USER_MONTHS",
};
export const BACKLOG_UNIT: MetricUnit = "PER_100_USERS_STOCK";
export const BACKLOG_FACTOR = 100;

/** Unidad de la métrica de un indicador en el modo elegido (HOTFIX-03 §11): por un usuario o total observado. */
export const metricUnitFor = (key: IndicatorKey, measure: Measure): MetricUnit =>
  key === "HEALTH" ? "CATEGORY" : measure === "total" ? (key === "DEDICATION" ? "TOTAL_HOURS" : "TOTAL_COUNT") : key === "DEDICATION" ? "HOURS_PER_USER_MONTH" : "PER_USER_MONTH";
export const backlogUnitFor = (measure: Measure): MetricUnit => (measure === "total" ? "TOTAL_COUNT" : "PER_USER_STOCK");
/** Unidades que una regla puede declarar para un indicador (la canónica heredada por 100, la por usuario y la relativa de los percentiles). */
const acceptedUnits = (key: IndicatorKey): MetricUnit[] => [METRIC_UNIT[key], metricUnitFor(key, "usuario"), metricUnitFor(key, "total"), "RELATIVE"];
const acceptedBacklogUnits: MetricUnit[] = [BACKLOG_UNIT, "PER_USER_STOCK", "TOTAL_COUNT", "RELATIVE"];

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
  /** Referencia explícita de la MISMA métrica (id de referencia de Pulse; sus criterios se reutilizan, los valores se calculan para Calidad). */
  referenceId: string | null;
  /** Muestra mínima elegida para colorear (propia de Calidad, no de las bandas de Pulse). null = sin mínimo configurado. */
  minSample: number | null;
  calibration: "SIN_CALIBRAR" | "CALIBRADO";
  /** Unidad en la que están expresados los límites (v2). */
  unit: MetricUnit;
};

export type RuleOutcome = {
  color: Color | null;
  status: "OK" | "SIN_CALIBRAR" | "SIN_REGLA" | "SIN_REFERENCIA" | "DATO_INVALIDO" | "REGLA_INVALIDA";
  reason: string;
  cuts?: { a: string; b: string; p10?: string; p90?: string };
  /** Tamaño de la muestra de referencia usada (percentiles). */
  n?: number;
  /** HOTFIX-03 §12: intensidad dentro del mismo color (más favorable hasta P10, más desfavorable por encima de P90); no añade colores al global. */
  intensity?: "FAVORABLE" | "DESFAVORABLE";
  /** Conversión explícita de unidad aplicada a una regla absoluta heredada. */
  converted?: string;
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
    if (r.minSample === null) out.push("Un método por percentiles exige elegir la muestra mínima (no se asume ninguna).");
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
 * `metricUnit` (si se indica) debe coincidir con la unidad de la regla: no se cambia una escala en silencio. Sin calibrar, sin regla,
 * referencia insuficiente, unidad distinta o dato inválido devuelven un estado explícito, NUNCA verde por defecto.
 */
export function evaluateRule(rule: ThresholdRule | null, value: Dec | null, referenceValues: readonly Dec[] | null, metricUnit?: MetricUnit): RuleOutcome {
  if (rule === null) return { color: null, status: "SIN_REGLA", reason: "No hay regla configurada." };
  if (rule.method === "CATEGORICAL") return { color: null, status: "REGLA_INVALIDA", reason: "Una regla categórica no se evalúa con un número." };
  if (rule.calibration !== "CALIBRADO") return { color: null, status: "SIN_CALIBRAR", reason: "Umbrales sin calibrar: no se asigna color." };
  const problems = validateRule(rule);
  if (problems.length > 0) return { color: null, status: "REGLA_INVALIDA", reason: problems[0] };
  let converted: string | undefined;
  let scale: Dec | null = null;
  if (metricUnit !== undefined && rule.unit !== metricUnit && rule.unit !== "RELATIVE") {
    // Conversión EXPLÍCITA y solo donde es equivalente: una regla absoluta «por 100 usuarios» pasa a «por usuario» dividiendo sus límites entre 100.
    const per100 = (rule.unit === "PER_100_USER_MONTHS" && metricUnit === "PER_USER_MONTH") || (rule.unit === "PER_100_USERS_STOCK" && metricUnit === "PER_USER_STOCK");
    if (per100) {
      if (rule.method === "ABSOLUTE") {
        scale = Dec.int(100);
        converted = `Límites convertidos de «${UNIT_LABEL[rule.unit]}» a «${UNIT_LABEL[metricUnit]}» (÷100).`;
      }
    } else {
      return { color: null, status: "REGLA_INVALIDA", reason: `La regla está expresada en «${UNIT_LABEL[rule.unit]}» y la métrica en «${UNIT_LABEL[metricUnit]}»: reconfigure la regla (no se convierte la escala en silencio).` };
    }
  }
  if (value === null) return { color: null, status: "DATO_INVALIDO", reason: "Dato ausente o no calculable." };
  let a = Dec.parse((rule.a as string).replace(",", ".")) as Dec;
  let b = Dec.parse((rule.b as string).replace(",", ".")) as Dec;
  if (scale !== null) { a = a.div(scale); b = b.div(scale); }
  let n: number | undefined;
  let p10: Dec | null = null;
  let p90: Dec | null = null;
  if (rule.method === "PERCENTILE") {
    const ref = referenceValues ?? [];
    n = ref.length;
    if (ref.length === 0) return { color: null, status: "SIN_REFERENCIA", reason: "Muestra insuficiente: la referencia no tiene entidades con valor válido.", n };
    if (rule.minSample !== null && ref.length < rule.minSample) return { color: null, status: "SIN_REFERENCIA", reason: `Muestra insuficiente: ${ref.length} < ${rule.minSample} entidades válidas.`, n };
    a = percentileAt(ref, rule.a as string) as Dec;
    b = percentileAt(ref, rule.b as string) as Dec;
    p10 = percentileAt(ref, "10");
    p90 = percentileAt(ref, "90");
    // HOTFIX-03 §12: muestra constante. Todos iguales y cero confirmado → verde; todos iguales y positivos → amarillo relativo (no un verde colectivo por caer justo en P25).
    const constant = ref.every((x) => x.cmp(ref[0]) === 0);
    if (constant && rule.direction === "LOWER_BETTER" && value.cmp(ref[0]) === 0) {
      const color: Color = ref[0].isZero() ? "green" : "yellow";
      return { color, status: "OK", reason: ref[0].isZero() ? "Todos los valores de la referencia son cero confirmado: verde." : "Todos los valores de la referencia son iguales y positivos: amarillo relativo (sin verde colectivo).", cuts: { a: a.toString(), b: b.toString(), p10: p10?.toString(), p90: p90?.toString() }, n };
    }
  }
  const cuts = { a: a.toString(), b: b.toString(), ...(p10 && p90 ? { p10: p10.toString(), p90: p90.toString() } : {}) };
  const intensity = (c: Color): RuleOutcome["intensity"] =>
    p10 && p90 && rule.direction === "LOWER_BETTER" ? (c === "green" && value.cmp(p10) <= 0 ? "FAVORABLE" : c === "red" && value.cmp(p90) > 0 ? "DESFAVORABLE" : undefined) : undefined;
  if (rule.direction === "LOWER_BETTER") {
    // Valores iguales dan SIEMPRE el mismo resultado; con P25=P75 no hay amarillo y nada se reparte por orden o identificador.
    const color: Color = value.cmp(a) <= 0 ? "green" : value.cmp(b) <= 0 ? "yellow" : "red";
    return { color, status: "OK", reason: "menor mejor: verde x≤a · amarillo a<x≤b · rojo x>b", cuts, n, intensity: intensity(color), converted };
  }
  const color: Color = value.cmp(a) < 0 ? "red" : value.cmp(b) < 0 ? "yellow" : "green";
  return { color, status: "OK", reason: "mayor mejor: rojo x<a · amarillo a≤x<b · verde x≥b", cuts, n, converted };
}

// ---------------------------------------------------------------- Client Health (categórico)

export type HealthState = "positive" | "mixed" | "negative";
export const HEALTH_STATES = ["positive", "mixed", "negative"] as const;
export const HEALTH_LABEL: Record<HealthState, string> = { positive: "Positivo", mixed: "Mixto", negative: "Negativo" };
export type HealthMapping = Record<HealthState, Color>;
/** PROPUESTA explícita (no confirmada): positivo→verde, mixto→amarillo, negativo→rojo. La ausencia de feedback no es un estado: se deja en blanco. */
export const PROPOSED_HEALTH_MAPPING: HealthMapping = { positive: "green", mixed: "yellow", negative: "red" };

export type HealthOutcome = {
  /** BLANK: sin feedback (redistribuible) · UNCALIBRATED: feedback sin mapeo confirmado · COLOR: mapeo confirmado y color publicable. */
  kind: "BLANK" | "UNCALIBRATED" | "COLOR";
  state: HealthState | null;
  color: Color | null;
  availability: Availability;
};
/**
 * Resultado de Client Health. El COLOR solo existe con `confirmed=true` (mapeo activo): un feedback presente con mapeo propuesto se
 * muestra como categoría «sin calibrar», que ni colorea ni se redistribuye. Sin feedback = blanco redistribuible.
 */
export function healthOutcome(state: HealthState | null, health: { mapping: HealthMapping | null; confirmed: boolean }): HealthOutcome {
  if (state === null) return { kind: "BLANK", state: null, color: null, availability: "BLANK" };
  if (!health.confirmed || health.mapping === null) return { kind: "UNCALIBRATED", state, color: null, availability: "UNCALIBRATED" };
  return { kind: "COLOR", state, color: health.mapping[state], availability: "AVAILABLE" };
}
/** Compatibilidad con 07: color solo con mapeo confirmado. */
export function healthColor(state: HealthState | null, health: { mapping: HealthMapping | null; confirmed: boolean }): { color: Color | null; blank: boolean } {
  const o = healthOutcome(state, health);
  return { color: o.color, blank: o.kind === "BLANK" };
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

/** Edad natural entre dos fechas ISO (AAAA-MM-DD); null si la creación es posterior a la observación (error de ámbito/fecha, no edad cero). */
export function ageDays(createdOn: string, observedOn: string): number | null {
  const c = Date.parse(`${createdOn}T00:00:00Z`);
  const o = Date.parse(`${observedOn}T00:00:00Z`);
  if (Number.isNaN(c) || Number.isNaN(o) || c > o) return null;
  return Math.round((o - c) / 86_400_000);
}

/**
 * Stock de backlog por 100 usuarios AL CORTE observado: 100 × tickets / usuarios (BACK 06). Un stock, no se divide por exposición mensual.
 * (La escala por usuario de CSAPP-07 devolvía envejecidos/usuarios: la unidad y el factor 100 ahora son explícitos.)
 */
export function backlogStockRate(count: number, usersAtCut: number | null): Dec | null {
  if (usersAtCut === null || usersAtCut <= 0) return null;
  return Dec.int(count).mulInt(BACKLOG_FACTOR).divInt(usersAtCut);
}
/** Flujo de altas por 100 usuarios·mes (exposición del periodo). Un ticket antiguo abierto entra en el backlog aunque no tenga alta en el mes. */
export function flowRate(altas: number, userMonths: Dec | null): Dec | null {
  if (userMonths === null || userMonths.sign() <= 0) return null;
  return Dec.int(altas).mulInt(100).div(userMonths);
}
/** Tasa por 100 usuarios·mes de un conteo de eventos (PAP, escalados, bugs). */
export const ratePer100UserMonths = flowRate;
/** Horas por usuario·mes. */
export function hoursPerUserMonth(hours: Dec, userMonths: Dec | null): Dec | null {
  if (userMonths === null || userMonths.sign() <= 0) return null;
  return hours.div(userMonths);
}

const SEVERITY_RANK: Record<Color, number> = { green: 0, yellow: 1, red: 2 };
/** Composición PROPUESTA (BACK 07): peor señal. Un componente sin color deja la composición sin color. */
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

export type GlobalOutcome = {
  color: Color | null;
  score: string | null;
  status: "OK" | "SIN_METODO" | "COBERTURA_INSUFICIENTE" | "SIN_COLORES";
  reason: string;
  /** Indicadores con señal roja conocida: alerta PARCIAL que no convierte un global incompleto en completo. */
  partialAlerts: IndicatorKey[];
};

/**
 * Global: severidad verde=0, amarillo=0,5, rojo=1; score = Σ asignación efectiva × severidad (suma exacta y UNA división); verde si score ≤ límite verde,
 * amarillo si ≤ límite amarillo, rojo si mayor. Sin método/límites elegidos, con cobertura insuficiente o con algún indicador sin color NO se genera color
 * (se conservan las señales rojas conocidas como alerta parcial). Sin salvaguarda «un rojo obliga a rojo».
 */
export function evaluateGlobal(g: GlobalTemplate, weights: EffectiveWeights, colors: Record<IndicatorKey, Color | null>): GlobalOutcome {
  const partialAlerts = INDICATOR_KEYS.filter((k) => weights.fraction[k].num > 0n && colors[k] === "red");
  if (!g.enabled || validateGlobal(g).length > 0 || g.greenMax === null || g.yellowMax === null) {
    return { color: null, score: null, status: "SIN_METODO", reason: "No se ha elegido método y límites del global: no se genera color final.", partialAlerts };
  }
  if (!weights.computable) return { color: null, score: null, status: "COBERTURA_INSUFICIENTE", reason: weights.reasons[0] ?? "Cobertura técnica insuficiente.", partialAlerts };
  let acc = Dec.ZERO;
  let den = 1n;
  for (const k of INDICATOR_KEYS) {
    const f = weights.fraction[k];
    if (f.num === 0n) continue;
    const c = colors[k];
    if (c === null) return { color: null, score: null, status: "SIN_COLORES", reason: `${INDICATOR_NAME[k]} no tiene color (sin calibrar o sin dato): no se calcula el global.`, partialAlerts };
    acc = acc.add((Dec.parse(g.severity[c].replace(",", ".")) as Dec).mulInt(f.num));
    den = f.den;
  }
  const score = acc.divInt(den);
  const gm = Dec.parse(g.greenMax.replace(",", ".")) as Dec;
  const ym = Dec.parse(g.yellowMax.replace(",", ".")) as Dec;
  const color: Color = score.cmp(gm) <= 0 ? "green" : score.cmp(ym) <= 0 ? "yellow" : "red";
  return { color, score: score.toString(), status: "OK", reason: "suma ponderada de severidades con la asignación efectiva (índice configurado, no una probabilidad de fallo)", partialAlerts };
}

// ---------------------------------------------------------------- Diagnóstico por origen (catálogo versionado en la configuración)

export const DIAGNOSIS_FAMILIES = ["ESTANDAR", "CONFIGURACION", "PERSONALIZACION", "INTEGRACION_PROCESOS", "SISTEMAS_CLIENTE", "USO_INDEBIDO", "INFRA_VINCLE_CLOUD", "INFRA_CLIENTE_OP", "OTROS", "SIN_CAUSA"] as const;
export type DiagnosisFamily = (typeof DIAGNOSIS_FAMILIES)[number];
export const DIAGNOSIS_LABEL: Record<DiagnosisFamily, string> = {
  ESTANDAR: "Estándar del producto",
  CONFIGURACION: "Configuración",
  PERSONALIZACION: "Personalización",
  INTEGRACION_PROCESOS: "Integración y procesos",
  SISTEMAS_CLIENTE: "Sistemas del Cliente",
  USO_INDEBIDO: "Uso indebido",
  INFRA_VINCLE_CLOUD: "Infraestructura Vincle (CLOUD)",
  INFRA_CLIENTE_OP: "Infraestructura del cliente (OP)",
  OTROS: "Otros",
  SIN_CAUSA: "Sin causa registrada",
};
/** Orientación (hipótesis de revisión): nunca afirma falta de pruebas ni culpa demostrada solo por la etiqueta (DIA 04). */
export const DIAGNOSIS_ACTION: Record<DiagnosisFamily, string> = {
  ESTANDAR: "Revisar corrección y versión del estándar; revisar recurrencia.",
  CONFIGURACION: "Revisar la validación de la configuración y sus pruebas (hipótesis; requiere revisión de QA).",
  PERSONALIZACION: "Revisar diseño, pruebas y regresión de la personalización (hipótesis; requiere revisión de QA).",
  INTEGRACION_PROCESOS: "Revisar integraciones, datos de entrada y pruebas de extremo a extremo (hipótesis; requiere revisión de QA).",
  SISTEMAS_CLIENTE: "Revisar entradas y contratos de datos con los sistemas del cliente.",
  USO_INDEBIDO: "Revisar formación y adopción del aplicativo.",
  INFRA_VINCLE_CLOUD: "Revisar la operación del SaaS.",
  INFRA_CLIENTE_OP: "Revisar la operación en la infraestructura del cliente (distinta del SaaS y de Sistemas del Cliente).",
  OTROS: "Mantener visible; no forzar responsabilidad.",
  SIN_CAUSA: "Pendiente de atribución; no se convierte en cero.",
};
/** Correspondencias CONFIRMADAS por el contrato DIA 01 (causas observadas literales). No se infieren categorías por palabras sueltas. */
export const CONFIRMED_DIAGNOSIS_MAPPINGS: { cause: string; family: DiagnosisFamily }[] = [
  { cause: "incidente_estándar_plataforma", family: "ESTANDAR" },
  { cause: "incidente_configuración_plataforma", family: "CONFIGURACION" },
  { cause: "incidente_customización_plataforma", family: "PERSONALIZACION" },
  { cause: "incidente_integración/procesos", family: "INTEGRACION_PROCESOS" },
  { cause: "incidente_sistemas_del_cliente", family: "SISTEMAS_CLIENTE" },
  { cause: "incidente_uso_indebido", family: "USO_INDEBIDO" },
  // La infraestructura se resuelve por alojamiento vigente (CLOUD → Vincle, OP → cliente): no tiene una familia fija en el catálogo.
];
export const INFRA_CAUSE_KEY = "incidente_infraestructura";

/**
 * Familia de diagnóstico de una causa registrada. `hosting` = alojamiento vigente a la fecha contractual (creación del ticket / fecha del trabajo).
 * Sin causa → SIN_CAUSA; infraestructura sin alojamiento → OTROS (pendiente de alojamiento); causa no catalogada → OTROS (se conserva el valor original).
 */
export function diagnosisFamily(cause: string | null, hosting: "CLOUD" | "OP" | null, mappings: readonly { cause: string; family: DiagnosisFamily }[]): { family: DiagnosisFamily; pending: string | null } {
  if (cause === null || cause.trim() === "") return { family: "SIN_CAUSA", pending: "Causa raíz sin registrar." };
  const c = cause.trim().toLowerCase();
  if (c === INFRA_CAUSE_KEY) {
    if (hosting === "CLOUD") return { family: "INFRA_VINCLE_CLOUD", pending: null };
    if (hosting === "OP") return { family: "INFRA_CLIENTE_OP", pending: null };
    return { family: "OTROS", pending: "Infraestructura sin alojamiento vigente a la fecha: pendiente de alojamiento." };
  }
  const m = mappings.find((x) => x.cause.trim().toLowerCase() === c);
  return m ? { family: m.family, pending: null } : { family: "OTROS", pending: `Causa «${cause}» sin correspondencia en el catálogo.` };
}

// ---------------------------------------------------------------- Carga útil tipada de la configuración de Calidad

const colorZ = z.enum(["green", "yellow", "red"]);
const unitZ = z.enum(["HOURS_PER_USER_MONTH", "PER_USER_MONTH", "PER_100_USER_MONTHS", "PER_USER_STOCK", "PER_100_USERS_STOCK", "ANNUAL_EQUIVALENT", "CATEGORY", "TOTAL_HOURS", "TOTAL_COUNT", "RELATIVE"]);
const ruleV1Z = z.object({
  method: z.enum(["ABSOLUTE", "PERCENTILE", "CATEGORICAL"]),
  direction: z.enum(["LOWER_BETTER", "HIGHER_BETTER"]),
  a: z.string().max(20).nullable(),
  b: z.string().max(20).nullable(),
  referenceId: z.string().max(60).nullable(),
  minSample: z.number().int().min(1).max(1_000_000).nullable(),
  calibration: z.enum(["SIN_CALIBRAR", "CALIBRADO"]),
});
const ruleZ = ruleV1Z.extend({ unit: unitZ });
const ruleSetZ = z.object({ GRUPO: ruleZ, CLIENTE: ruleZ });
const baseWeightsZ = z.object({ mode: z.enum(["EQUAL", "CUSTOM"]), custom: z.record(z.enum(INDICATOR_KEYS), z.string().max(10)) });
const healthZ = z.object({ mapping: z.object({ positive: colorZ, mixed: colorZ, negative: colorZ }), confirmed: z.boolean() });
const dedicationZ = z.object({ profiles: z.array(z.string().max(40)).max(10), selectionConfirmed: z.boolean() });
const bandsZ = z.array(z.object({ from: z.number().int().min(0).max(100000), to: z.number().int().min(0).max(100000).nullable() })).max(20);
const concerningZ = z.object({ incident: z.number().int().min(0).max(100000).nullable(), problem: z.number().int().min(0).max(100000).nullable() });
const globalZ = z.object({
  template: z.literal("WEIGHTED_SEVERITY"),
  enabled: z.boolean(),
  severity: z.object({ green: z.string().max(10), yellow: z.string().max(10), red: z.string().max(10) }),
  greenMax: z.string().max(10).nullable(),
  yellowMax: z.string().max(10).nullable(),
});

/** v1 (CSAPP-07): un `scope` por indicador y una sola regla de backlog por usuario. Solo se LEE (adaptador); no se escribe más. */
export const qualityConfigV1Schema = z.object({
  schema: z.literal("quality-config-v1"),
  weights: baseWeightsZ,
  indicators: z.record(
    z.enum(INDICATOR_KEYS),
    z.object({ unit: z.string().max(200), normalization: z.enum(["POR_USUARIO_MES", "POR_100_USUARIOS_MES", "POR_USUARIO_STOCK", "CATEGORIA", "ANUAL_EQUIVALENTE"]), scope: z.enum(["GRUPO", "CLIENTE"]), rule: ruleV1Z }),
  ),
  health: healthZ,
  dedication: dedicationZ,
  incidents: z.object({ backlogRule: ruleV1Z, ageBands: bandsZ, concerningDays: concerningZ, worstOfFlowAndBacklog: z.boolean() }),
  global: globalZ,
});
export type QualityConfigV1 = z.infer<typeof qualityConfigV1Schema>;

export const SNAPSHOT_POLICIES = ["EXACT", "LATEST_BEFORE"] as const;
const diagnosisMappingZ = z.object({ cause: z.string().min(1).max(120), family: z.enum(DIAGNOSIS_FAMILIES) });

/** v2 (CSAPP-08): reglas por ámbito (Grupo/Cliente) y unidad; backlog por tipo; política de fotografía; correspondencias de diagnóstico versionadas. */
export const qualityConfigSchema = z.object({
  schema: z.literal("quality-config-v2"),
  weights: baseWeightsZ,
  indicators: z.record(z.enum(INDICATOR_KEYS), z.object({ unit: z.string().max(200), rules: ruleSetZ })),
  health: healthZ,
  dedication: dedicationZ,
  incidents: z.object({
    /** Componentes de backlog envejecido (stock por 100 usuarios al corte), por tipo y ámbito. El flujo usa la regla del indicador. */
    backlog: z.object({ INCIDENT: ruleSetZ, PROBLEM: ruleSetZ }),
    ageBands: bandsZ,
    concerningDays: concerningZ,
    /** BACK 07: peor señal entre flujo y componentes de backlog. PROPUESTA, desactivada hasta que el Administrador la elija. */
    worstOfFlowAndBacklog: z.boolean(),
  }),
  /** Política de fotografía para un corte histórico: exacta (por defecto) o «última anterior dentro de X días» elegida expresamente. */
  snapshotPolicy: z.object({ mode: z.enum(SNAPSHOT_POLICIES), maxDays: z.number().int().min(1).max(3650).nullable() }),
  diagnosis: z.object({ mappings: z.array(diagnosisMappingZ).max(200) }),
  global: globalZ,
  /** Solo en memoria: notas del adaptador cuando la revisión se leyó de v1 (el JSON almacenado no se modifica). */
  adapter: z.object({ from: z.literal("quality-config-v1"), notes: z.array(z.string()) }).optional(),
});
export type QualityConfig = z.infer<typeof qualityConfigSchema>;

export const emptyRule = (direction: RuleDirection, unit: MetricUnit): ThresholdRule => ({ method: "ABSOLUTE", direction, a: null, b: null, referenceId: null, minSample: null, calibration: "SIN_CALIBRAR", unit });
const emptyRuleSet = (direction: RuleDirection, unit: MetricUnit) => ({ GRUPO: emptyRule(direction, unit), CLIENTE: emptyRule(direction, unit) });

/** Referencias propias de Calidad (HOTFIX-03 §12): cohorte activa (inicial) o todas las entidades externas; ambas independientes de Pulse Rent. */
export const QUALITY_COHORT_REFERENCE_ALL = "QUALITY_COHORT_ALL";
export const QUALITY_REFERENCES = [
  { id: QUALITY_COHORT_REFERENCE, label: "Entidades externas activas del mismo ámbito (inicial)" },
  { id: QUALITY_COHORT_REFERENCE_ALL, label: "Todas las entidades externas del mismo ámbito (activas e inactivas)" },
] as const;

/** Etiqueta de procedencia de la configuración inicial HOTFIX-03 (no es un benchmark científico ni garantía de ausencia de fallos). */
export const INITIAL_PROFILE_NOTE = "Configuración inicial HOTFIX-03: criterio operativo inicial para comparar clientes (percentiles P25/P75 sobre la cohorte de entidades externas activas, muestra mínima 5). Editable y versionada; no es un benchmark científico ni una garantía de ausencia de fallos.";

const initialRule = (direction: RuleDirection): ThresholdRule => ({ method: "PERCENTILE", direction, a: "25", b: "75", referenceId: QUALITY_COHORT_REFERENCE, minSample: 5, calibration: "CALIBRADO", unit: "RELATIVE" });
const initialRuleSet = () => ({ GRUPO: initialRule("LOWER_BETTER"), CLIENTE: initialRule("LOWER_BETTER") });

/**
 * Configuración inicial HOTFIX-03 (§12): perfil operativo, editable y versionado. Ya no se entrega «sin calibrar»:
 *  - Dedicación: CS N1, CS N2 y mantenimiento PMO N3; menor carga es mejor en los cinco KPI técnicos.
 *  - Percentiles inclusivos P25/P75 sobre la cohorte propia de Calidad (entidades externas activas del ámbito), muestra mínima 5: verde x≤P25, amarillo P25<x≤P75, rojo x>P75.
 *  - Client Health: Positivo→verde, Mixto→amarillo, Negativo→rojo; pesos iguales exactos; severidad 0 / 0,5 / 1; global verde ≤0,25, amarillo ≤0,50, rojo >0,50.
 *  - Incidentes y problemas: peor señal entre flujo y backlog envejecido; edad preocupante > 7 días (incidente) y > 30 (problema); fotografía anterior al corte con ≤ 7 días.
 */
export function defaultQualityConfig(): QualityConfig {
  const ind = (key: IndicatorKey, unit: string) => ({ unit, rules: key === "HEALTH" ? emptyRuleSet("HIGHER_BETTER", METRIC_UNIT[key]) : initialRuleSet() });
  const health = ind("HEALTH", "categoría");
  for (const sc of QUALITY_SCOPES) health.rules[sc] = { ...health.rules[sc], method: "CATEGORICAL" };
  return {
    schema: "quality-config-v2",
    weights: { mode: "EQUAL", custom: Object.fromEntries(INDICATOR_KEYS.map((k) => [k, ""])) as Record<IndicatorKey, string> },
    indicators: {
      HEALTH: health,
      DEDICATION: ind("DEDICATION", "horas (por usuario y mes o total del periodo, según el modo)"),
      PAP_CORRECTIVE: ind("PAP_CORRECTIVE", "PAP correctivos (por usuario y mes o total del periodo)"),
      N3_ESCALATIONS: ind("N3_ESCALATIONS", "tickets escalados a N3 (por usuario y mes o total del periodo)"),
      INCIDENTS_PROBLEMS: ind("INCIDENTS_PROBLEMS", "flujo de altas (por usuario y mes o total del periodo)"),
      BUGS_STANDARD: ind("BUGS_STANDARD", "problemas vinculados (por usuario y mes o total del periodo)"),
    },
    health: { mapping: { ...PROPOSED_HEALTH_MAPPING }, confirmed: true },
    dedication: { profiles: ["CS_N1", "CS_N2", "PMO_N3"], selectionConfirmed: true },
    incidents: {
      backlog: { INCIDENT: initialRuleSet(), PROBLEM: initialRuleSet() },
      ageBands: [{ from: 0, to: 7 }, { from: 8, to: 30 }, { from: 31, to: null }],
      concerningDays: { incident: 7, problem: 30 },
      worstOfFlowAndBacklog: true,
    },
    snapshotPolicy: { mode: "LATEST_BEFORE", maxDays: 7 },
    diagnosis: { mappings: CONFIRMED_DIAGNOSIS_MAPPINGS.map((m) => ({ ...m })) },
    global: { template: "WEIGHTED_SEVERITY", enabled: true, severity: { ...PROPOSED_SEVERITY }, greenMax: "0.25", yellowMax: "0.5" },
  };
}

/** Configuración «de fábrica» anterior a HOTFIX-03: todo sin calibrar. Solo sirve para reconocer una revisión inicial que nadie calibró. */
export function isLegacyUncalibrated(cfg: QualityConfig): boolean {
  const rules = [...INDICATOR_KEYS.filter((k) => k !== "HEALTH").flatMap((k) => QUALITY_SCOPES.map((sc) => cfg.indicators[k].rules[sc])), ...(["INCIDENT", "PROBLEM"] as const).flatMap((t) => QUALITY_SCOPES.map((sc) => cfg.incidents.backlog[t][sc]))];
  return rules.every((r) => r.calibration === "SIN_CALIBRAR") && !cfg.global.enabled && !cfg.dedication.selectionConfirmed && !cfg.health.confirmed && cfg.incidents.concerningDays.incident === null && cfg.incidents.concerningDays.problem === null && cfg.snapshotPolicy.mode === "EXACT" && !cfg.incidents.worstOfFlowAndBacklog;
}

// ---------------------------------------------------------------- Adaptador v1 → v2

const NORMALIZATION_UNIT: Record<QualityConfigV1["indicators"]["HEALTH"]["normalization"], (k: IndicatorKey) => MetricUnit> = {
  POR_USUARIO_MES: (k) => (k === "DEDICATION" ? "HOURS_PER_USER_MONTH" : "PER_USER_MONTH"),
  POR_100_USUARIOS_MES: () => "PER_100_USER_MONTHS",
  POR_USUARIO_STOCK: () => "PER_USER_STOCK",
  CATEGORIA: () => "CATEGORY",
  ANUAL_EQUIVALENTE: () => "ANNUAL_EQUIVALENT",
};
/** Multiplica un límite absoluto por 100 de forma exacta (envejecidos por usuario → por 100 usuarios). */
function scaleLimit(limit: string | null): string | null {
  if (limit === null || limit.trim() === "") return limit;
  const d = Dec.parse(limit.trim().replace(",", "."));
  return d === null ? limit : d.mulInt(BACKLOG_FACTOR).toString();
}

/**
 * Lee una carga v1 (CSAPP-07) como v2 SIN modificar el JSON almacenado ni recalibrarla:
 *  - la regla de cada indicador se conserva en su ámbito declarado y con su unidad; el otro ámbito queda sin configurar (hay que elegirlo);
 *  - la regla de backlog por usuario se convierte a por 100 usuarios multiplicando de forma EXPLÍCITA los límites absolutos ×100 (los percentiles no cambian);
 *  - una regla v1 compartida se aplica a incidentes y a problemas en su ámbito, y queda anotado.
 * Una incompatibilidad (unidad distinta de la de la métrica) permanece visible: la regla no se aplica hasta reconfigurarla.
 */
export function adaptQualityV1(v1: QualityConfigV1): QualityConfig {
  const base = defaultQualityConfig();
  const notes: string[] = ["Carga leída de quality-config-v1 mediante adaptador: el JSON almacenado no se modifica; una nueva elección crea otra revisión."];
  const indicators = { ...base.indicators };
  for (const k of INDICATOR_KEYS) {
    const old = v1.indicators[k];
    if (!old) continue;
    const unit = NORMALIZATION_UNIT[old.normalization](k);
    const rules = emptyRuleSet(old.rule.direction, METRIC_UNIT[k]);
    if (k === "HEALTH") for (const sc of QUALITY_SCOPES) rules[sc] = { ...rules[sc], method: "CATEGORICAL" };
    rules[old.scope] = { ...old.rule, unit };
    indicators[k] = { unit: old.unit, rules };
    const other: QScope = old.scope === "GRUPO" ? "CLIENTE" : "GRUPO";
    notes.push(`${INDICATOR_NAME[k]}: regla v1 conservada en el ámbito ${QSCOPE_LABEL[old.scope]} (${UNIT_LABEL[unit]}); el ámbito ${QSCOPE_LABEL[other]} requiere configuración explícita.`);
    if (unit !== METRIC_UNIT[k] && k !== "HEALTH") notes.push(`${INDICATOR_NAME[k]}: la unidad v1 «${UNIT_LABEL[unit]}» no es la de la métrica («${UNIT_LABEL[METRIC_UNIT[k]]}»): incompatibilidad visible, la regla no se aplica.`);
  }
  const incScope = v1.indicators.INCIDENTS_PROBLEMS?.scope ?? "GRUPO";
  const br = v1.incidents.backlogRule;
  const converted: ThresholdRule =
    br.method === "ABSOLUTE"
      ? { ...br, a: scaleLimit(br.a), b: scaleLimit(br.b), unit: BACKLOG_UNIT }
      : { ...br, unit: BACKLOG_UNIT };
  const backlog = { INCIDENT: emptyRuleSet("LOWER_BETTER", BACKLOG_UNIT), PROBLEM: emptyRuleSet("LOWER_BETTER", BACKLOG_UNIT) };
  backlog.INCIDENT[incScope] = { ...converted };
  backlog.PROBLEM[incScope] = { ...converted };
  notes.push(
    br.method === "ABSOLUTE"
      ? `Backlog envejecido: la regla v1 (envejecidos por usuario) se convierte explícitamente a envejecidos por 100 usuarios (límites ×${BACKLOG_FACTOR}: ${br.a ?? "—"}→${converted.a ?? "—"}, ${br.b ?? "—"}→${converted.b ?? "—"}) y se aplica a incidentes y a problemas en el ámbito ${QSCOPE_LABEL[incScope]}.`
      : "Backlog envejecido: regla por percentiles v1 conservada; la referencia se recalcula en la métrica por 100 usuarios y se aplica a incidentes y problemas.",
  );
  return {
    schema: "quality-config-v2",
    weights: v1.weights,
    indicators,
    health: v1.health,
    dedication: v1.dedication,
    incidents: { backlog, ageBands: v1.incidents.ageBands, concerningDays: v1.incidents.concerningDays, worstOfFlowAndBacklog: v1.incidents.worstOfFlowAndBacklog },
    snapshotPolicy: { mode: "EXACT", maxDays: null },
    diagnosis: base.diagnosis,
    global: v1.global,
    adapter: { from: "quality-config-v1", notes },
  };
}

export type ConfigIssue = { path: string; message: string };

/** Lee una carga almacenada (v2 o v1 mediante adaptador). Devuelve los problemas estructurales si ninguna versión la acepta. */
export function readQualityPayload(raw: unknown): { ok: true; payload: QualityConfig } | { ok: false; issues: ConfigIssue[] } {
  const v2 = qualityConfigSchema.safeParse(raw);
  if (v2.success) return { ok: true, payload: v2.data };
  if (typeof raw === "object" && raw !== null && (raw as { schema?: unknown }).schema === "quality-config-v1") {
    const v1 = qualityConfigV1Schema.safeParse(raw);
    if (v1.success) return { ok: true, payload: adaptQualityV1(v1.data) };
    return { ok: false, issues: v1.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: `Estructura v1 no válida en «${i.path.join(".") || "raíz"}»: ${i.message}` })) };
  }
  return { ok: false, issues: v2.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: `Estructura no válida en «${i.path.join(".") || "raíz"}»: ${i.message}` })) };
}

/** Todas las reglas numéricas de una configuración, con su ruta (para validar y mostrar). */
function allRules(cfg: QualityConfig): { path: string; label: string; rule: ThresholdRule; accepted: MetricUnit[] }[] {
  const out: { path: string; label: string; rule: ThresholdRule; accepted: MetricUnit[] }[] = [];
  for (const k of INDICATOR_KEYS) for (const sc of QUALITY_SCOPES) out.push({ path: `indicators.${k}.${sc}`, label: `${INDICATOR_NAME[k]} · ${QSCOPE_LABEL[sc]}`, rule: cfg.indicators[k].rules[sc], accepted: acceptedUnits(k) });
  for (const t of ["INCIDENT", "PROBLEM"] as const) for (const sc of QUALITY_SCOPES) out.push({ path: `incidents.backlog.${t}.${sc}`, label: `Backlog ${t === "INCIDENT" ? "incidentes" : "problemas"} · ${QSCOPE_LABEL[sc]}`, rule: cfg.incidents.backlog[t][sc], accepted: acceptedBacklogUnits });
  return out;
}

/** Validación semántica completa de la sección Calidad. Vacío = se puede activar. */
export function validateQualityConfig(cfg: QualityConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const i of weightUnits({ mode: cfg.weights.mode, custom: cfg.weights.custom as Record<IndicatorKey, string> }).issues) issues.push({ path: `weights.${i.key}`, message: i.message });
  for (const { path, label, rule, accepted } of allRules(cfg)) {
    if (rule.method === "CATEGORICAL") continue;
    const partial = rule.calibration === "CALIBRADO" || (rule.a !== null && rule.b !== null && rule.a !== "" && rule.b !== "");
    if (partial) for (const m of validateRule(rule)) issues.push({ path, message: `${label}: ${m}` });
    if (rule.calibration === "CALIBRADO" && !accepted.includes(rule.unit)) issues.push({ path, message: `${label}: la regla está en «${UNIT_LABEL[rule.unit]}», que no corresponde a esta métrica.` });
  }
  if (cfg.incidents.ageBands.length > 0) for (const m of validateAgeBands(cfg.incidents.ageBands)) issues.push({ path: "incidents.ageBands", message: m });
  if (cfg.incidents.worstOfFlowAndBacklog) {
    if (cfg.incidents.concerningDays.incident === null || cfg.incidents.concerningDays.problem === null) {
      issues.push({ path: "incidents.worstOfFlowAndBacklog", message: "La composición «peor señal» necesita el umbral preocupante de incidentes y de problemas antes de activarse." });
    }
    const calibrated = (rs: Record<QScope, ThresholdRule>) => QUALITY_SCOPES.some((sc) => rs[sc].calibration === "CALIBRADO");
    if (!calibrated(cfg.indicators.INCIDENTS_PROBLEMS.rules) || !calibrated(cfg.incidents.backlog.INCIDENT) || !calibrated(cfg.incidents.backlog.PROBLEM)) {
      issues.push({ path: "incidents.worstOfFlowAndBacklog", message: "La composición «peor señal» necesita el flujo y los componentes de backlog de incidentes y de problemas con umbrales calibrados (al menos en un ámbito) antes de activarse." });
    }
  }
  if (cfg.snapshotPolicy.mode === "LATEST_BEFORE" && cfg.snapshotPolicy.maxDays === null) issues.push({ path: "snapshotPolicy", message: "La política «última fotografía anterior» exige que el Administrador elija el máximo de días (no se asume ninguno)." });
  if (cfg.snapshotPolicy.mode === "EXACT" && cfg.snapshotPolicy.maxDays !== null) issues.push({ path: "snapshotPolicy", message: "Con la política exacta no hay máximo de días." });
  const seen = new Set<string>();
  for (const m of cfg.diagnosis.mappings) {
    const key = m.cause.trim().toLowerCase();
    if (seen.has(key)) issues.push({ path: "diagnosis.mappings", message: `Causa «${m.cause}» repetida en el catálogo de correspondencias.` });
    seen.add(key);
  }
  for (const m of validateGlobal({ ...cfg.global, template: "WEIGHTED_SEVERITY" })) issues.push({ path: "global", message: m });
  for (const c of ["green", "yellow", "red"] as const) {
    const d = Dec.parse(cfg.global.severity[c].replace(",", "."));
    if (d === null || d.sign() < 0 || d.cmp(Dec.int(1)) > 0) issues.push({ path: "global.severity", message: "Las severidades deben estar en [0, 1]." });
  }
  return issues;
}

// ---------------------------------------------------------------- Evaluador común (simulador y dashboard)

/** Una magnitud de entrada ya calculada por quien la produce (servidor o escenario). `partial`: valor conocido pero incompleto (cota inferior). */
export type ComponentInput = { value: Dec | null; partial?: boolean; reason?: string | null; refs?: readonly Dec[] | null };
export type EntityInput = {
  scope: QScope;
  /** null = sin feedback ese mes. */
  health: HealthState | null;
  dedication: ComponentInput;
  pap: ComponentInput;
  n3: ComponentInput;
  bugs: ComponentInput;
  incidents: { flow: ComponentInput; backlogIncident: ComponentInput; backlogProblem: ComponentInput };
};

export type ComponentOutcome = { id: string; label: string; unit: MetricUnit; value: string | null; color: Color | null; status: RuleOutcome["status"]; reason: string; cuts?: RuleOutcome["cuts"]; n?: number; intensity?: RuleOutcome["intensity"]; converted?: string };
export type IndicatorOutcome = {
  key: IndicatorKey;
  name: string;
  availability: Availability;
  color: Color | null;
  /** Señal roja conocida aunque el resultado sea incompleto (cota inferior de una magnitud «menor es mejor»). */
  alert: boolean;
  status: string;
  reason: string;
  value: string | null;
  unit: MetricUnit;
  cuts?: RuleOutcome["cuts"];
  n?: number;
  intensity?: RuleOutcome["intensity"];
  converted?: string;
  components?: ComponentOutcome[];
};
export type EntityEvaluation = { scope: QScope; weights: EffectiveWeights | null; weightIssues: WeightIssue[]; indicators: Record<IndicatorKey, IndicatorOutcome>; global: GlobalOutcome; configIssues: ConfigIssue[] };

function evalComponent(id: string, label: string, rule: ThresholdRule, unit: MetricUnit, c: ComponentInput): ComponentOutcome {
  const o = evaluateRule(rule, c.value, c.refs ?? null, unit);
  const base = { id, label, unit, value: c.value?.toString() ?? null };
  if (c.value === null) return { ...base, color: null, status: o.status === "SIN_CALIBRAR" || o.status === "SIN_REGLA" ? o.status : "DATO_INVALIDO", reason: c.reason ?? "Sin valor calculable.", cuts: o.cuts, n: o.n };
  // Valor parcial: una cota inferior solo sostiene una señal roja en «menor es mejor»; nunca un verde ni un amarillo.
  if (c.partial) {
    const red = o.color === "red" && rule.direction === "LOWER_BETTER";
    return { ...base, color: red ? "red" : null, status: red ? "OK" : "DATO_INVALIDO", reason: red ? `Valor parcial (cota inferior) ya en rojo. ${c.reason ?? ""}`.trim() : `Valor parcial: no se colorea. ${c.reason ?? ""}`.trim(), cuts: o.cuts, n: o.n };
  }
  return { ...base, color: o.color, status: o.status, reason: o.reason, cuts: o.cuts, n: o.n, intensity: o.intensity, converted: o.converted };
}

/**
 * Evaluación de un ámbito (Grupo o Cliente) con la regla de SU ámbito y unidad: un umbral de Grupo nunca se aplica a un Cliente.
 * Incidentes y problemas conserva un solo peso: con la composición «peor señal» elegida evalúa flujo y backlog de incidentes y de problemas;
 * sin ella NO hay color de KPI (un flujo verde no es un color completo) y el flujo se ofrece solo como componente.
 */
export function evaluateEntity(cfg: QualityConfig, input: EntityInput, measure: Measure = DEFAULT_MEASURE): EntityEvaluation {
  const sc = input.scope;
  const bUnit = backlogUnitFor(measure);
  const wu = weightUnits({ mode: cfg.weights.mode, custom: cfg.weights.custom as Record<IndicatorKey, string> });
  const indicators = {} as Record<IndicatorKey, IndicatorOutcome>;
  const colors = {} as Record<IndicatorKey, Color | null>;
  const availability = {} as Record<IndicatorKey, Availability>;
  const mk = (key: IndicatorKey, extra: Partial<IndicatorOutcome> & Pick<IndicatorOutcome, "availability" | "status" | "reason">): IndicatorOutcome => ({
    key, name: INDICATOR_NAME[key], color: null, alert: false, value: null, unit: metricUnitFor(key, measure), ...extra,
  });

  // Client Health
  const h = healthOutcome(input.health, cfg.health);
  indicators.HEALTH = mk("HEALTH", {
    availability: h.availability,
    color: h.color,
    value: h.state,
    status: h.kind === "BLANK" ? "BLANCO" : h.kind === "UNCALIBRATED" ? "SIN_CALIBRAR" : "CATEGORIA",
    alert: h.color === "red",
    reason:
      h.kind === "BLANK"
        ? "Sin feedback en el mes: celda en blanco; su peso se redistribuye entre los demás."
        : h.kind === "UNCALIBRATED"
          ? `Feedback ${HEALTH_LABEL[h.state as HealthState]} registrado, mapeo a color no confirmado: categoría sin calibrar (conserva su peso; no se redistribuye).`
          : `Mapeo confirmado: ${HEALTH_LABEL[h.state as HealthState]}.`,
  });

  // Indicadores numéricos con una sola magnitud.
  const numeric: [Exclude<IndicatorKey, "HEALTH" | "INCIDENTS_PROBLEMS">, ComponentInput][] = [["DEDICATION", input.dedication], ["PAP_CORRECTIVE", input.pap], ["N3_ESCALATIONS", input.n3], ["BUGS_STANDARD", input.bugs]];
  for (const [k, comp] of numeric) {
    const c = evalComponent(k, INDICATOR_NAME[k], cfg.indicators[k].rules[sc], metricUnitFor(k, measure), comp);
    const known = comp.value !== null && !comp.partial;
    indicators[k] = mk(k, {
      availability: known ? "AVAILABLE" : "MISSING",
      color: c.color && known ? c.color : null,
      alert: c.color === "red",
      status: comp.value === null ? "SIN_DATO" : comp.partial ? "PARCIAL" : c.status,
      reason: c.reason,
      value: c.value,
      cuts: c.cuts,
      n: c.n,
      intensity: c.intensity,
      converted: c.converted,
    });
  }

  // Incidentes y problemas: flujo + backlog por tipo.
  const flow = evalComponent("flow", "Flujo de altas (incidentes y problemas)", cfg.indicators.INCIDENTS_PROBLEMS.rules[sc], metricUnitFor("INCIDENTS_PROBLEMS", measure), input.incidents.flow);
  const bi = evalComponent("backlog_incident", "Backlog envejecido de incidentes", cfg.incidents.backlog.INCIDENT[sc], bUnit, input.incidents.backlogIncident);
  const bp = evalComponent("backlog_problem", "Backlog envejecido de problemas", cfg.incidents.backlog.PROBLEM[sc], bUnit, input.incidents.backlogProblem);
  const comps = [flow, bi, bp];
  const allKnown = [input.incidents.flow, input.incidents.backlogIncident, input.incidents.backlogProblem].every((c) => c.value !== null && !c.partial);
  const alertI = comps.some((c) => c.color === "red");
  if (cfg.incidents.worstOfFlowAndBacklog) {
    const color = allKnown ? worstSignal(comps.map((c) => c.color)) : null;
    indicators.INCIDENTS_PROBLEMS = mk("INCIDENTS_PROBLEMS", {
      availability: allKnown && color !== null ? "AVAILABLE" : "MISSING",
      color,
      alert: alertI,
      status: color !== null ? "OK" : allKnown ? "SIN_CALIBRAR" : "INCOMPLETO",
      reason: color !== null ? "Peor señal entre flujo, backlog envejecido de incidentes y de problemas." : "Falta algún componente (flujo, backlog de incidentes o de problemas) con datos y regla calibrada: no hay color completo del KPI.",
      value: input.incidents.flow.value?.toString() ?? null,
      components: comps,
    });
    if (color === null && allKnown) indicators.INCIDENTS_PROBLEMS.availability = "MISSING";
  } else {
    indicators.INCIDENTS_PROBLEMS = mk("INCIDENTS_PROBLEMS", {
      availability: "MISSING",
      color: null,
      alert: alertI,
      status: "COMPOSICION_SIN_ELEGIR",
      reason: "La composición del color (propuesta «peor señal» entre flujo y backlog) no está elegida: un flujo saludable no se publica como color del KPI mientras el backlog confirmado como relevante no se pueda valorar. Se muestran los componentes.",
      value: input.incidents.flow.value?.toString() ?? null,
      components: comps,
    });
  }
  for (const k of INDICATOR_KEYS) {
    colors[k] = indicators[k].color;
    availability[k] = indicators[k].availability;
  }
  const weights = wu.units ? effectiveWeights(wu.units, availability) : null;
  const global: GlobalOutcome = weights
    ? evaluateGlobal({ ...cfg.global, template: "WEIGHTED_SEVERITY" }, weights, colors)
    : { color: null, score: null, status: "SIN_METODO", reason: "Pesos no válidos: no se calcula el global.", partialAlerts: [] };
  return { scope: sc, weights, weightIssues: wu.issues, indicators, global, configIssues: validateQualityConfig(cfg) };
}

// ---------------------------------------------------------------- Simulación manual (sin escribir nada)

export type SimInput = {
  /** BLANK solo para Client Health; MISSING = fuente ausente. */
  availability: "AVAILABLE" | "BLANK" | "MISSING";
  /** Valor numérico (texto decimal) o, para Client Health, la categoría. */
  value: string;
  /** Solo Incidentes y problemas: backlog envejecido por 100 usuarios al corte, de incidentes y de problemas. */
  backlogValue?: string;
  backlogProblemValue?: string;
  /** Muestra manual de referencia (para reglas por percentiles). */
  reference?: string;
};
export type SimResult = EntityEvaluation;

const numOrNull = (t: string | undefined): Dec | null => (t === undefined || t.trim() === "" ? null : Dec.parse(t.trim().replace(",", ".")));
const sample = (t: string | undefined): Dec[] => (t ?? "").split(/[;\s]+/).map((x) => numOrNull(x)).filter((x): x is Dec => x !== null);

/** Evalúa una configuración (borrador o activa) con ESCENARIOS manuales y el MISMO evaluador del dashboard. No lee ni escribe hechos reales. */
export function simulateQuality(cfg: QualityConfig, scenario: Record<IndicatorKey, SimInput>, scope: QScope = "GRUPO"): SimResult {
  const num = (k: IndicatorKey): ComponentInput => {
    const sc = scenario[k];
    if (sc.availability !== "AVAILABLE") return { value: null, reason: "Fuente ausente en el escenario: no se convierte en cero ni en verde." };
    return { value: numOrNull(sc.value), refs: sample(sc.reference) };
  };
  const inc = scenario.INCIDENTS_PROBLEMS;
  const absent = inc.availability !== "AVAILABLE";
  const healthRaw = scenario.HEALTH;
  const healthState = healthRaw.availability === "AVAILABLE" && (HEALTH_STATES as readonly string[]).includes(healthRaw.value) ? (healthRaw.value as HealthState) : null;
  return evaluateEntity(cfg, {
    scope,
    health: healthState,
    dedication: num("DEDICATION"),
    pap: num("PAP_CORRECTIVE"),
    n3: num("N3_ESCALATIONS"),
    bugs: num("BUGS_STANDARD"),
    incidents: {
      flow: absent ? { value: null, reason: "Fuente ausente en el escenario." } : { value: numOrNull(inc.value), refs: sample(inc.reference) },
      backlogIncident: absent ? { value: null } : { value: numOrNull(inc.backlogValue) },
      backlogProblem: absent ? { value: null } : { value: numOrNull(inc.backlogProblemValue) },
    },
  });
}
