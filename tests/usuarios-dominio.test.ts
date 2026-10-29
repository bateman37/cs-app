import { describe, expect, it } from "vitest";
import {
  computeExposure,
  currentYear,
  editability,
  emptyYear,
  parseUserCount,
  planApplyFrom,
  planCopyFromPrevious,
  planInitializeHistoric,
  planSetMonth,
  type YearState,
} from "@/domain/usuarios";

function year(values: (number | null)[], kind: "COPIED" | "ADJUSTED" | "INITIAL" = "COPIED"): YearState {
  return values.map((v) => (v === null ? null : { value: v, kind, isLocked: kind === "INITIAL" }));
}
const lookupFrom = (values: (number | null)[]) => (_y: number, m: number): number | null => values[m - 1];

describe("Reglas puras de usuarios contratados", () => {
  it("año en curso calculado con Europe/Madrid y reloj inyectable", () => {
    expect(currentYear(new Date("2026-06-15T10:00:00Z"))).toBe(2026);
    // 31/12 23:30 UTC ya es 2027 en Madrid
    expect(currentYear(new Date("2026-12-31T23:30:00Z"))).toBe(2027);
    expect(editability(2026, new Date("2026-06-15T10:00:00Z")).editable).toBe(true);
    expect(editability(2026, new Date("2027-02-01T10:00:00Z")).editable).toBe(false);
    expect(editability(2027, new Date("2026-06-15T10:00:00Z")).editable).toBe(false);
    expect(editability(2025, new Date("2026-06-15T10:00:00Z")).reason).toMatch(/histórico fijo/);
  });

  it("valores enteros no negativos", () => {
    expect(parseUserCount("65")).toBe(65);
    expect(parseUserCount("0")).toBe(0);
    for (const bad of ["", " ", "-1", "6.5", "6,5", "abc", "1e3", null, undefined, 1.5, -2]) expect(parseUserCount(bad)).toBeNull();
  });

  it("65 de enero a mayo y 68 desde junio: 665 usuarios mes hasta octubre y stock 68", () => {
    const v = [65, 65, 65, 65, 65, 68, 68, 68, 68, 68, 68, 68];
    const e = computeExposure(lookupFrom(v), "2026-01-01", "2026-10-31");
    expect(e.complete).toBe(true);
    expect(e.userMonths).toBe(665);
    expect(v[9]).toBe(68); // stock a octubre, magnitud distinta
  });

  it("mes parcial pondera por días incluidos y reales; sin dato informa cobertura incompleta", () => {
    const v = [65, 65, 65, 65, 65, 68, 68, 68, 68, 68, 68, 68];
    const e = computeExposure(lookupFrom(v), "2026-06-16", "2026-06-30"); // 15 de 30 días
    expect(e.userMonths).toBeCloseTo(34, 10);
    const gap = computeExposure(lookupFrom([65, null, 65, ...Array(9).fill(65)]), "2026-01-01", "2026-03-31");
    expect(gap.complete).toBe(false);
    expect(gap.userMonths).toBeNull();
    expect(gap.knownUserMonths).toBe(130);
    expect(gap.missingMonths).toEqual([{ year: 2026, month: 2 }]);
  });

  it("un cero confirmado cuenta cero y es cobertura completa", () => {
    const e = computeExposure(lookupFrom([0, 0, 10, ...Array(9).fill(0)]), "2026-01-01", "2026-03-31");
    expect(e.complete).toBe(true);
    expect(e.userMonths).toBe(10);
  });

  it("periodos que cruzan años", () => {
    const e = computeExposure((y) => (y === 2025 ? 10 : 20), "2025-11-01", "2026-02-28");
    expect(e.requiredMonths).toHaveLength(4);
    expect(e.userMonths).toBe(10 + 10 + 20 + 20);
  });

  it("editar un mes no propaga; aplicar desde junio preserva septiembre explícito", () => {
    const base = year(Array(12).fill(65));
    const one = planSetMonth(base, 6, 68);
    expect(one.changedCount).toBe(1);
    expect(one.rows[5].after).toMatchObject({ value: 68, kind: "ADJUSTED" });
    expect(one.rows[6].after?.value).toBe(65);

    const state = year(Array(12).fill(65));
    state[8] = { value: 70, kind: "ADJUSTED", isLocked: false };
    const plan = planApplyFrom(state, 6, 68);
    expect(plan.protectedMonths).toEqual([9]);
    expect(plan.rows.map((r) => r.after?.value)).toEqual([65, 65, 65, 65, 65, 68, 68, 68, 70, 68, 68, 68]);
    expect(plan.rows[5].after?.kind).toBe("ADJUSTED");
    expect(plan.rows[6].after?.kind).toBe("PROPAGATED");
    expect(plan.changedCount).toBe(6);
  });

  it("aplicar desde rellena meses sin informar y no toca bloqueados", () => {
    const st = emptyYear();
    const p = planApplyFrom(st, 11, 5);
    expect(p.rows.filter((r) => r.status === "changed").map((r) => r.month)).toEqual([11, 12]);
    const locked = year(Array(12).fill(65), "INITIAL");
    expect(planApplyFrom(locked, 6, 1).protectedMonths).toEqual([7, 8, 9, 10, 11, 12]);
  });

  it("inicialización histórica: vacío crea 12, igual es idempotente, distinto es conflicto", () => {
    expect(planInitializeHistoric(emptyYear(), 65).status).toBe("new");
    const done = year(Array(12).fill(65), "INITIAL");
    expect(planInitializeHistoric(done, 65).status).toBe("unchanged");
    expect(planInitializeHistoric(done, 70).status).toBe("conflict");
    expect(planInitializeHistoric(year([65, null, ...Array(10).fill(null)]), 65).status).toBe("conflict");
  });

  it("copia del año anterior no pisa y deja huecos sin origen", () => {
    const prev = year([65, 65, null, ...Array(9).fill(65)]);
    const cur = emptyYear();
    cur[0] = { value: 70, kind: "ADJUSTED", isLocked: false };
    const p = planCopyFromPrevious(cur, prev, 2025);
    expect(p.rows[0].after?.value).toBe(70);
    expect(p.rows[1].after).toMatchObject({ value: 65, kind: "COPIED", source: "Copia de 2025-02" });
    expect(p.rows[2].after).toBeNull();
  });
});
