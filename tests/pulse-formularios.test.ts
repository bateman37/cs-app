import { describe, expect, it } from "vitest";
import { defaultPulseConfig, validatePulseConfig } from "@/domain/pulse-catalog";
import { defaultQualityConfig, validateQualityConfig } from "@/domain/quality-config";
import { buildPulseDraft, buildQualityDraft, formatAgeBands, parseAgeBands } from "@/server/pulse/forms";
import { DomainError } from "@/server/errors";

describe("construcción de borradores desde los formularios", () => {
  it("Calidad: pesos personalizados y reglas se aplican sobre la base; lo no enviado se conserva", () => {
    const base = defaultQualityConfig();
    const cfg = buildQualityDraft({ w_mode: "CUSTOM", w_HEALTH: "20", w_DEDICATION: "20", w_PAP_CORRECTIVE: "15", w_N3_ESCALATIONS: "15", w_INCIDENTS_PROBLEMS: "15", w_BUGS_STANDARD: "15", r_DEDICATION_method: "ABSOLUTE", r_DEDICATION_dir: "LOWER_BETTER", r_DEDICATION_a: "2", r_DEDICATION_b: "4", r_DEDICATION_cal: "CALIBRADO" }, base);
    expect(cfg.weights.mode).toBe("CUSTOM");
    expect(cfg.indicators.DEDICATION.rule).toMatchObject({ method: "ABSOLUTE", a: "2", b: "4", calibration: "CALIBRADO" });
    expect(cfg.indicators.PAP_CORRECTIVE.rule.calibration).toBe("SIN_CALIBRAR"); // intacto
    expect(validateQualityConfig(cfg)).toEqual([]);
    expect(base.weights.mode).toBe("EQUAL"); // la base no se muta
  });
  it("Calidad: una regla calibrada con a ≥ b o un total distinto de 100 produce problemas de validación (no se guarda)", () => {
    const bad = buildQualityDraft({ w_mode: "CUSTOM", w_HEALTH: "20", w_DEDICATION: "20", w_PAP_CORRECTIVE: "15", w_N3_ESCALATIONS: "15", w_INCIDENTS_PROBLEMS: "15", w_BUGS_STANDARD: "14", r_DEDICATION_method: "ABSOLUTE", r_DEDICATION_a: "5", r_DEDICATION_b: "5", r_DEDICATION_cal: "CALIBRADO" }, defaultQualityConfig());
    const msgs = validateQualityConfig(bad).map((i) => i.message).join(" | ");
    expect(msgs).toMatch(/exactamente 100/);
    expect(msgs).toMatch(/a < b/);
  });
  it("bandas de edad: «0-7, 8-30, 31-» se interpreta y se valida; texto libre se rechaza", () => {
    expect(parseAgeBands("0-7, 8-30, 31-")).toEqual([{ from: 0, to: 7 }, { from: 8, to: 30 }, { from: 31, to: null }]);
    expect(formatAgeBands(parseAgeBands("0-7, 8-30, 31-"))).toBe("0-7, 8-30, 31-");
    expect(() => parseAgeBands("0-7, abc")).toThrow(DomainError);
    const cfg = buildQualityDraft({ i_bands: "0-7, 9-30", i_conc_incident: "30", i_conc_problem: "", i_worst: "on", r_BACKLOG_method: "ABSOLUTE" }, defaultQualityConfig());
    const msgs = validateQualityConfig(cfg).map((i) => i.message).join(" | ");
    expect(msgs).toMatch(/hueco/);
    expect(msgs).toMatch(/umbral preocupante/); // la composición propuesta exige sus componentes antes de activarse
  });
  it("Pulse: perfiles canónicos, dirección personalizada y referencias nuevas se validan; el stock no admite juicio", () => {
    const base = defaultPulseConfig();
    const cfg = buildPulseDraft({ pulse_present: "1", p_CS_N1_0_team: "t1", p_CS_N1_0_level: "l1", p_PMO_N3_0_pmo: "si", dir_M01: "NONE", dir_M18: "HIGHER", nr_id: "mi_ref", nr_label: "Mi referencia", nr_plan_GOLD: "on", nr_host_OP: "on", nr_homog: "on", default_ref: "mi_ref" }, base);
    expect(cfg.profiles.CS_N1).toEqual([{ teamId: "t1", levelId: "l1", pmo: null }]);
    expect(cfg.profiles.PMO_N3).toEqual([{ teamId: null, levelId: null, pmo: true }]);
    expect(cfg.directions).toEqual({ M01: "NONE" }); // solo difiere el cambio respecto del catálogo
    expect(cfg.references.find((r) => r.id === "mi_ref")).toMatchObject({ origin: "PERSONALIZADA", plans: ["GOLD"], hostings: ["OP"], homogeneous: true });
    expect(validatePulseConfig(cfg)).toEqual([]);
    expect(validatePulseConfig(buildPulseDraft({ pulse_present: "1", dir_M17: "LOWER" }, base))[0].message).toMatch(/contexto/);
    expect(() => buildPulseDraft({ pulse_present: "1", nr_id: "MAL ID", nr_label: "x" }, base)).toThrow(DomainError);
    // Eliminar una personalizada y no una confirmada.
    const again = buildPulseDraft({ pulse_present: "1", ref_del_mi_ref: "on", ref_del_todos: "on" }, cfg);
    expect(again.references.some((r) => r.id === "mi_ref")).toBe(false);
    expect(again.references.some((r) => r.id === "todos")).toBe(true);
  });
});
