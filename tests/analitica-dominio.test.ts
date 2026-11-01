import { describe, expect, it } from "vitest";
import { Dec, buildPeriods, deviationHoursParts, deviationPortfolioParts, deviationTargetParts, tariffRun } from "@/domain/finance";
import { aggregatePortfolio, type PortfolioRow } from "@/domain/portfolio";
import { formatPercentEs } from "@/lib/money";
import { csvCell, csvLine } from "@/domain/csv";

const D = (v: string) => Dec.parse(v) as Dec;
const TARGET = D("550");
const DAY = D("8");

describe("TAR RUN: 12 × R_periodo / usuarios mes expuestos", () => {
  it("anual 12000, diez usuarios y corte 15/30: R=500, UM=5 → 1200 (no 1216,67)", () => {
    const r = D("12000").ratio(15, 12 * 30); // 500
    expect(r.toString()).toBe("500");
    const um = D("10").ratio(15, 30); // 5
    expect(um.toString()).toBe("5");
    const t = tariffRun(r, um)!;
    expect(t.value.toString()).toBe("1200");
    expect(t.numerator.toString()).toBe("6000");
    expect(t.denominator.toString()).toBe("5");
    expect(r.ratio(365, 15).div(um).toString()).not.toBe("1200"); // el antiguo 365/días daba 1216,67
  });
  it("doce meses completos coincide con ingreso anual / usuarios medios anuales", () => {
    const t = tariffRun(D("12000"), D("10").mulInt(12))!;
    expect(t.value.toString()).toBe("1200");
  });
  it("usuarios mes cero o negativos: no calculable", () => {
    expect(tariffRun(D("100"), Dec.ZERO)).toBeNull();
  });
});

describe("comparable de mes completo", () => {
  const TODAY = "2026-10-30";
  it("FULL_MONTH febrero 2025 → CUM anterior hasta 29/02/2024; CUTOFF 28/02/2025 → hasta 28/02/2024", () => {
    expect(buildPeriods("2025-02-10", "FULL_MONTH", TODAY).prevCum).toMatchObject({ from: "2024-01-01", to: "2024-02-29" });
    expect(buildPeriods("2025-02-28", "CUTOFF", TODAY).prevCum).toMatchObject({ from: "2024-01-01", to: "2024-02-28" });
    expect(buildPeriods("2025-02-27", "CUTOFF", TODAY).prevCum.to).toBe("2024-02-27");
  });
  it("conserva 29/02/2024 → 28/02/2023 y FULL_MONTH de febrero 2024 → 28/02/2023; el año anterior completo es otra cosa", () => {
    const c = buildPeriods("2024-02-29", "CUTOFF", TODAY);
    expect(c.prevCum.to).toBe("2023-02-28");
    expect(buildPeriods("2024-02-10", "FULL_MONTH", TODAY).prevCum.to).toBe("2023-02-28");
    expect(c.prevYear).toMatchObject({ from: "2023-01-01", to: "2023-12-31" });
  });
  it("otros meses de mes completo cierran el fin del mismo mes anterior", () => {
    expect(buildPeriods("2026-06-10", "FULL_MONTH", TODAY).prevCum.to).toBe("2025-06-30");
  });
});

describe("desviaciones con componentes reales", () => {
  it("objetivo 550 y ratio 400 → 150/550; el detalle reconstruye el valor", () => {
    const d = deviationTargetParts(TARGET, D("400"));
    expect([d.numerator.toString(), d.denominator.toString()]).toEqual(["150", "550"]);
    expect(d.numerator.div(d.denominator).toString()).toBe(d.value.toString());
  });
  it("cartera 500 y ratio 400 → 100/500; cartera cero no calculable", () => {
    const d = deviationPortfolioParts(D("500"), D("400"))!;
    expect([d.numerator.toString(), d.denominator.toString()]).toEqual(["100", "500"]);
    expect(d.value.toString()).toBe("0.2");
    expect(deviationPortfolioParts(Dec.ZERO, D("1"))).toBeNull();
  });
  it("desviación de horas = (reales − objetivo) / objetivo; objetivo cero no calculable", () => {
    const d = deviationHoursParts(D("12"), D("10"))!;
    expect([d.numerator.toString(), d.denominator.toString(), d.value.toString()]).toEqual(["2", "10", "0.2"]);
    expect(deviationHoursParts(D("3"), Dec.ZERO)).toBeNull();
  });
  it("0,25 se presenta como 25 % y el signo se conserva", () => {
    expect(formatPercentEs("0.25")).toBe("25 %");
    expect(formatPercentEs("-0.4545")).toBe("-45,5 %");
    expect(formatPercentEs(null)).toBe("—");
  });
});

const row = (id: string, rev: string | null, minutes: number, status: PortfolioRow["status"] = "AVAILABLE", code: string | null = null): PortfolioRow => ({
  id, revenue: rev === null ? null : D(rev), minutes: D(String(minutes * 60)), status, code,
});

describe("agregación de cartera", () => {
  it("1000/10 y 1000/30 → 400 €/jornada, no la media de 800 y 266,67", () => {
    const p = aggregatePortfolio([row("a", "1000", 10), row("b", "1000", 30)], TARGET, DAY);
    expect(p.perDay.value).toBe("400");
    expect(p.complete).toBe(true);
    expect(p.deviationVsTarget.numerator).toBe("150");
  });
  it("1000/0 y 1000/10 → 1600 con el primer ratio individual no calculable y su ingreso a la vista", () => {
    const p = aggregatePortfolio([row("a", "1000", 0, "NOT_COMPUTABLE", "ZERO_HOURS"), row("b", "1000", 10)], TARGET, DAY);
    expect(p.perDay.value).toBe("1600");
    expect(p.zeroHours).toEqual({ count: 1, income: "1000" });
    expect(p.groupsNotComputable).toEqual({ count: 1, incomeAtStake: "1000" });
    expect(p.complete).toBe(true);
  });
  it("cambia con el conjunto filtrado, no con el orden", () => {
    const rows = [row("a", "1000", 10), row("b", "1000", 30), row("c", "500", 5)];
    expect(aggregatePortfolio(rows, TARGET, DAY).perDay.value).toBe(aggregatePortfolio([...rows].reverse(), TARGET, DAY).perDay.value);
    expect(aggregatePortfolio(rows.slice(0, 2), TARGET, DAY).perDay.value).not.toBe(aggregatePortfolio(rows, TARGET, DAY).perDay.value);
  });
  it.each([
    ["ingreso ausente", row("x", null, 4), "INCOME_UNKNOWN"],
    ["servicio desconocido o conflictivo / elegibilidad pendiente", row("x", "1000", 4, "PARTIAL", "PERIMETER_PARTIAL"), "PERIMETER_PARTIAL"],
    ["filtro que recorta solo horas", row("x", "1000", 4, "NOT_COMPUTABLE", "HOURS_FILTER"), "HOURS_FILTER"],
    ["Silver On Demand mensual", row("x", "1000", 4, "NOT_COMPUTABLE", "SILVER_ON_DEMAND"), "SILVER_ON_DEMAND"],
  ])("%s: la cartera no se publica como completa y conserva componentes, afectados y cobertura", (_n, bad, code) => {
    const p = aggregatePortfolio([row("a", "1000", 10), bad], TARGET, DAY);
    expect(p.complete).toBe(false);
    expect(p.perDay.value).toBeNull();
    expect(p.perDay.status).toBe("PARTIAL");
    expect(p.deviationVsTarget.value).toBeNull();
    expect(p.affected.map((a) => a.code)).toEqual([code]);
    expect(p.coverage).toEqual({ groups: 2, complete: 1, blocked: 1 });
    expect(p.knownSet).toMatchObject({ groups: 1, revenue: "1000", hours: "10", perDay: "800" }); // conjunto conocido: no es la cartera
  });
  it("ningún grupo con ingreso: sin fuente, no cero; conjunto vacío: no calculable", () => {
    expect(aggregatePortfolio([row("a", null, 3)], TARGET, DAY).perDay.status).toBe("NO_SOURCE");
    expect(aggregatePortfolio([], TARGET, DAY).perDay.status).toBe("NOT_COMPUTABLE");
  });
});

describe("CSV seguro", () => {
  it("escapa comillas, separadores y saltos; neutraliza fórmulas en texto sin alterar números negativos", () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('di"jo')).toBe('"di""jo"');
    expect(csvCell("l1\nl2")).toBe('"l1\nl2"');
    expect(csvCell("=SUMA(A1)")).toBe("\"'=SUMA(A1)\"");
    expect(csvCell("+34 600")).toBe("\"'+34 600\"");
    expect(csvCell("@x")).toBe("\"'@x\"");
    expect(csvCell("\tx")).toBe("\"'\tx\"");
    expect(csvCell({ n: "-12.5" })).toBe("-12,5");
    expect(csvCell(null)).toBe("");
    expect(csvLine(["a", { n: "1.50" }, null])).toBe("a;1,50;");
  });
});
