import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { STANDARD_CAUSE } from "@/domain/zendesk";
import { runReconciliation, type Check } from "@/server/reconciliation/service";
import { matchScreenPeriod } from "@/server/reconciliation/bridge";
import { resetDatabase, makeUsers } from "./helpers";
import { addClient, addGroup, addZd, seedFinance, setUsers } from "./economia-helpers";
import { batchOf, seedBugLink, seedPap, seedTicket } from "./calidad-helpers";

/**
 * CSAPP-10 §10: puente de conciliación de Comparativa / Análisis Cliente / Pulse Rent / Calidad (nivel 4, IDs REC-N4-*). Resultados conocidos calculados a mano:
 * minutos elegibles 60 + 120 = 180 (3 h); usuarios 100 al corte; 4 tickets (uno con PMO_N3 + IT_N3 → un escalado N3); un PAP con dos causas correctivas → uno.
 */
let admin: { id: string };
beforeEach(async () => { await resetDatabase(); ({ admin } = await makeUsers()); });
const P = (extra: Record<string, string> = {}) => ({ scope: "group", sel: "", desde: "2026-10-01", hasta: "2026-10-31", servicio: "TOTAL", ...extra });
const get = (run: { results: Check[] }, id: string) => run.results.find((c) => c.id === id)!;

async function world() {
  const g = await addGroup("Atlas");
  const c = await addClient("Atlas 1", g.id);
  await prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: "701", searchValue: "701", clientId: c.id } });
  await setUsers(admin.id, { groupId: g.id }, 2026, Array(12).fill(100));
  const zd = await batchOf(admin.id, "zendesk-tiempo");
  await addZd({ batchId: zd.id, date: "2026-10-05", minutes: 60, groupId: g.id, clientId: c.id });
  await addZd({ batchId: zd.id, date: "2026-10-06", minutes: 120, groupId: g.id, clientId: c.id });
  await addZd({ batchId: zd.id, date: "2026-10-07", minutes: 30, groupId: g.id, clientId: c.id, eligibility: "PENDING_ELIGIBILITY", bucket: "PENDING_ELIGIBILITY" });
  await addZd({ batchId: zd.id, date: "2026-10-08", minutes: 15, eligibility: "EXCLUDED_PMO", bucket: "EXCLUDED_PMO" });
  const tb = await batchOf(admin.id, "zendesk-tickets", "2026-10-31");
  await seedTicket(tb.id, { id: "R1", org: "701", type: "problem", created: "2026-10-05", cause: STANDARD_CAUSE, destinations: ["PMO_N3", "IT_N3"], observedOn: "2026-10-31" });
  await seedTicket(tb.id, { id: "R2", org: "701", type: "problem", created: "2026-10-06", observedOn: "2026-10-31" });
  await seedBugLink(tb.id, { bugId: "1", ticket: "R2", clientId: c.id, groupId: g.id });
  const pb = await batchOf(admin.id, "pap");
  await seedPap(pb.id, { id: "9", groupId: g.id, clientId: c.id, date: "2026-10-10", state: "CORRECTIVE", causes: [{ category: "CORRECTIVE", origin: "STANDARD" }, { category: "CORRECTIVE", origin: "CLIENT_ORIGIN" }] });
  await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "12000" }]);
  return { g, c };
}

describe("puente Comparativa / Análisis Cliente / Pulse Rent / Calidad", () => {
  it("el periodo del informe se reconoce como uno de los cinco periodos de las pantallas (o no)", () => {
    expect(matchScreenPeriod("2026-10-01", "2026-10-31", "2026-11-02")).toEqual({ key: "month", mode: "FULL_MONTH" });
    expect(matchScreenPeriod("2026-01-01", "2026-10-31", "2026-11-02")?.key).toBe("cum");
    expect(matchScreenPeriod("2026-10-01", "2026-10-15", "2026-11-02")).toEqual({ key: "month", mode: "CUTOFF" });
    expect(matchScreenPeriod("2026-10-02", "2026-10-31", "2026-11-02")).toBeNull();
    // El año natural anterior completo, pedido con corte 31/12/2025, es el CUM de esa fecha: mismo perímetro y mismo resultado.
    expect(matchScreenPeriod("2025-01-01", "2025-12-31", "2026-11-02")?.key).toBe("cum");
  });

  it("con datos conocidos, las seis comprobaciones del puente cuadran con numeradores, denominadores y exclusiones visibles", async () => {
    await world();
    const run = await runReconciliation(admin.id, P());
    const n4 = run.results.filter((c) => c.level === 4);
    expect(n4.map((c) => c.id)).toEqual(["REC-N4-01", "REC-N4-02", "REC-N4-03", "REC-N4-04", "REC-N4-05", "REC-N4-06"]);
    expect(get(run, "REC-N4-01")).toMatchObject({ status: "OK", expected: "180", observed: "180", unit: "min" });
    expect(get(run, "REC-N4-01").exclusions.map((e) => e.reason).join("|")).toMatch(/pendientes de elegibilidad.*excluidas por política/);
    expect(get(run, "REC-N4-02")).toMatchObject({ status: "OK", expected: "3", observed: "3", unit: "h" });
    expect(get(run, "REC-N4-03")).toMatchObject({ status: "OK", expected: "100", observed: "100" });
    expect(get(run, "REC-N4-04")).toMatchObject({ status: "OK", additive: false });
    expect(get(run, "REC-N4-04").notes.join(" ")).toMatch(/Numerador \(horas\).*Denominador \(usuarios mes UM\)/);
    expect(get(run, "REC-N4-05")).toMatchObject({ status: "OK", expected: "1", observed: "1" }); // PMO_N3 + IT_N3 → un ticket
    expect(get(run, "REC-N4-06")).toMatchObject({ status: "OK", expected: "1", observed: "1" }); // un PAP con dos causas
    expect(n4.every((c) => c.status === "OK")).toBe(true);
    expect(run.summary.difference).toBe(0);
  });

  it("por servicio y por ámbito: SOPORTE, un Cliente y una entidad seleccionada usan el mismo perímetro en todas las pantallas", async () => {
    const { g, c } = await world();
    for (const extra of [{ servicio: "SOPORTE" }, { servicio: "ADMIN_DELEGADA" }, { scope: "client" }, { scope: "group", sel: g.id }, { scope: "client", sel: c.id }, { desde: "2026-01-01" }]) {
      const run = await runReconciliation(admin.id, P(extra));
      const bad = run.results.filter((x) => x.level === 4 && x.status === "DIFERENCIA").map((x) => `${x.id} ${x.expected}≠${x.observed}`);
      expect(bad, JSON.stringify(extra)).toEqual([]);
    }
  });

  it("un periodo que no es de las pantallas se declara NO DISPONIBLE con la explicación; nunca se compara uno ajeno", async () => {
    await world();
    const run = await runReconciliation(admin.id, P({ desde: "2026-10-05" }));
    const n4 = run.results.filter((c) => c.level === 4);
    expect(n4).toHaveLength(6);
    expect(n4.every((c) => c.status === "NO_DISPONIBLE")).toBe(true);
    expect(n4[0].notes[0]).toMatch(/no coincide con ninguno de los cinco periodos/);
    expect(run.results.find((c) => c.id === "REC-N1-01")?.status).toBe("OK"); // los niveles 1-3 siguen
  });

  it("al añadir horas elegibles, todas las pantallas se mueven juntas (225 min) y la partición sigue conciliando", async () => {
    const { g } = await world();
    const zd = await batchOf(admin.id, "zendesk-tiempo");
    await addZd({ batchId: zd.id, date: "2026-10-09", minutes: 45, groupId: g.id });
    const run = await runReconciliation(admin.id, P());
    expect(get(run, "REC-N4-01")).toMatchObject({ status: "OK", expected: "225", observed: "225" });
    expect(get(run, "REC-N4-02")).toMatchObject({ status: "OK", expected: "3.75", observed: "3.75" });
    expect(run.summary.difference).toBe(0);
  });
});
