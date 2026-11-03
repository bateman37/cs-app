import { BACKLOG_UNIT, INDICATOR_KEYS, METRIC_UNIT, QUALITY_SCOPES, defaultQualityConfig, DIAGNOSIS_FAMILIES, type AgeBand, type DiagnosisFamily, type IndicatorKey, type MetricUnit, type QScope, type QualityConfig, type ThresholdRule } from "@/domain/quality-config";
import { PROFILE_KEYS, PULSE_METRICS, REFERENCE_PLANS, type ProfileKey, type ProfileSelector, type PulseConfig, type PulseReference } from "@/domain/pulse-catalog";
import { DomainError } from "@/server/errors";

/**
 * Construcción de borradores desde los formularios de Administración (CSAPP-07 §8). Funciones puras: parten de la carga útil base y aplican SOLO
 * los campos enviados; la validación estructural y semántica la hace `saveDraft` (cliente y servidor comparten las reglas del dominio).
 */
type Raw = Record<string, string>;
const on = (raw: Raw, k: string) => raw[k] === "on" || raw[k] === "true";
const nz = (v: string | undefined): string | null => (v === undefined || v.trim() === "" ? null : v.trim());

function intOrNull(v: string | undefined, label: string): number | null {
  const t = nz(v);
  if (t === null) return null;
  if (!/^\d{1,6}$/.test(t)) throw new DomainError("Revise los campos marcados.", { [label]: "Indique un entero no negativo." });
  return Number(t);
}

/** «0-7, 8-30, 31-» → bandas de edad (la última puede quedar abierta). */
export function parseAgeBands(text: string): AgeBand[] {
  const out: AgeBand[] = [];
  for (const part of text.split(/[;,\n]+/).map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d{1,6})\s*-\s*(\d{1,6})?$/.exec(part);
    if (!m) throw new DomainError("Revise los campos marcados.", { i_bands: `Banda «${part}» no válida: use «desde-hasta» (p. ej. 0-7, 8-30, 31-).` });
    out.push({ from: Number(m[1]), to: m[2] === undefined ? null : Number(m[2]) });
  }
  return out;
}
export const formatAgeBands = (b: readonly AgeBand[]): string => b.map((x) => `${x.from}-${x.to ?? ""}`).join(", ");

function ruleFrom(raw: Raw, p: string, base: ThresholdRule, unit: MetricUnit = base.unit): ThresholdRule {
  if (raw[`${p}_method`] === undefined) return base;
  const method = raw[`${p}_method`] as ThresholdRule["method"];
  if (!["ABSOLUTE", "PERCENTILE", "CATEGORICAL"].includes(method)) throw new DomainError("Método de umbral no válido.");
  const minSample = intOrNull(raw[`${p}_min`], `${p}_min`);
  return {
    method,
    direction: raw[`${p}_dir`] === "HIGHER_BETTER" ? "HIGHER_BETTER" : "LOWER_BETTER",
    a: nz(raw[`${p}_a`]),
    b: nz(raw[`${p}_b`]),
    referenceId: nz(raw[`${p}_ref`]),
    minSample: minSample === 0 ? null : minSample,
    calibration: raw[`${p}_cal`] === "CALIBRADO" ? "CALIBRADO" : "SIN_CALIBRAR",
    unit,
  };
}

export function buildQualityDraft(raw: Raw, base: QualityConfig): QualityConfig {
  const cfg: QualityConfig = JSON.parse(JSON.stringify(base));
  if (raw.w_mode !== undefined) {
    cfg.weights.mode = raw.w_mode === "CUSTOM" ? "CUSTOM" : "EQUAL";
    for (const k of INDICATOR_KEYS) cfg.weights.custom[k] = (raw[`w_${k}`] ?? cfg.weights.custom[k] ?? "").trim();
  }
  // Reglas por ámbito (Grupo / Cliente): campos r_<indicador>_<ámbito>_*; la unidad la fija el catálogo, no el formulario.
  for (const sc of QUALITY_SCOPES as readonly QScope[]) {
    for (const k of INDICATOR_KEYS) if (k !== "HEALTH") cfg.indicators[k].rules[sc] = ruleFrom(raw, `r_${k}_${sc}`, cfg.indicators[k].rules[sc], METRIC_UNIT[k]);
    for (const t of ["INCIDENT", "PROBLEM"] as const) cfg.incidents.backlog[t][sc] = ruleFrom(raw, `r_BACKLOG_${t}_${sc}`, cfg.incidents.backlog[t][sc], BACKLOG_UNIT);
  }
  if (raw.sp_mode !== undefined) {
    const mode = raw.sp_mode === "LATEST_BEFORE" ? "LATEST_BEFORE" : "EXACT";
    cfg.snapshotPolicy = { mode, maxDays: mode === "LATEST_BEFORE" ? intOrNull(raw.sp_days, "sp_days") : null };
  }
  if (raw.dg_present !== undefined) {
    const mappings: { cause: string; family: DiagnosisFamily }[] = [];
    for (const line of (raw.dg_text ?? "").split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
      const m = /^(.+?)\s*=>\s*([A-Z_]+)$/.exec(line);
      if (!m || !(DIAGNOSIS_FAMILIES as readonly string[]).includes(m[2])) throw new DomainError("Revise los campos marcados.", { dg_text: `Línea «${line}» no válida: use «causa => FAMILIA» con una familia del catálogo.` });
      mappings.push({ cause: m[1].trim(), family: m[2] as DiagnosisFamily });
    }
    cfg.diagnosis = { mappings };
  }
  if (raw.h_positive !== undefined) {
    const c = (v: string): "green" | "yellow" | "red" => (v === "green" || v === "yellow" || v === "red" ? v : "yellow");
    cfg.health.mapping = { positive: c(raw.h_positive), mixed: c(raw.h_mixed), negative: c(raw.h_negative) };
    cfg.health.confirmed = on(raw, "h_confirmed");
  }
  if (raw.d_present !== undefined) {
    cfg.dedication.profiles = PROFILE_KEYS.filter((k) => on(raw, `d_${k}`));
    cfg.dedication.selectionConfirmed = on(raw, "d_confirmed");
  }
  if (raw.i_bands !== undefined) {
    cfg.incidents.ageBands = parseAgeBands(raw.i_bands);
    cfg.incidents.concerningDays = { incident: intOrNull(raw.i_conc_incident, "i_conc_incident"), problem: intOrNull(raw.i_conc_problem, "i_conc_problem") };
    cfg.incidents.worstOfFlowAndBacklog = on(raw, "i_worst");
  }
  if (raw.g_present !== undefined) {
    cfg.global.enabled = on(raw, "g_enabled");
    cfg.global.greenMax = nz(raw.g_green);
    cfg.global.yellowMax = nz(raw.g_yellow);
  }
  return cfg;
}

const slugOk = /^[a-z0-9_]{2,40}$/;
export function buildPulseDraft(raw: Raw, base: PulseConfig): PulseConfig {
  const cfg: PulseConfig = JSON.parse(JSON.stringify(base));
  if (raw.pulse_present !== undefined) {
    cfg.directions = {};
    for (const m of PULSE_METRICS) {
      const v = raw[`dir_${m.id}`];
      if (v === "LOWER" || v === "HIGHER" || v === "NONE") if (v !== m.direction) cfg.directions[m.id] = v;
    }
    for (const key of PROFILE_KEYS as readonly ProfileKey[]) {
      const sels: ProfileSelector[] = [];
      for (const slot of [0, 1]) {
        const team = nz(raw[`p_${key}_${slot}_team`]);
        const level = nz(raw[`p_${key}_${slot}_level`]);
        const pmo = raw[`p_${key}_${slot}_pmo`] === "si" ? true : raw[`p_${key}_${slot}_pmo`] === "no" ? false : null;
        if (team !== null || level !== null || pmo !== null) sels.push({ teamId: team, levelId: level, pmo });
      }
      if (sels.length > 0) cfg.profiles[key] = sels;
      else delete cfg.profiles[key];
    }
    cfg.references = cfg.references.filter((r) => !(r.origin === "PERSONALIZADA" && on(raw, `ref_del_${r.id}`)));
    const id = nz(raw.nr_id);
    if (id !== null) {
      if (!slugOk.test(id)) throw new DomainError("Revise los campos marcados.", { nr_id: "Use 2-40 caracteres: minúsculas, números y «_»." });
      const label = nz(raw.nr_label);
      if (label === null) throw new DomainError("Revise los campos marcados.", { nr_label: "Indique el nombre de la referencia." });
      const ref: PulseReference = {
        id, label, kind: "CRITERIA", origin: "PERSONALIZADA",
        plans: REFERENCE_PLANS.filter((p) => on(raw, `nr_plan_${p}`)), hostings: (["CLOUD", "OP"] as const).filter((h) => on(raw, `nr_host_${h}`)),
        complexities: (["BASIC", "MEDIUM", "ENTERPRISE"] as const).filter((c) => on(raw, `nr_cx_${c}`)), product: nz(raw.nr_product), homogeneous: on(raw, "nr_homog"), excludeSilver: on(raw, "nr_nosilver"),
      };
      cfg.references = [...cfg.references.filter((r) => r.id !== id), ref];
    }
    if (nz(raw.default_ref)) cfg.defaultReference = raw.default_ref.trim();
  }
  return cfg;
}

export const QUALITY_SECTIONS_BASE = defaultQualityConfig;
export type { IndicatorKey };
