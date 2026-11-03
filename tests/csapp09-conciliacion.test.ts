import { beforeEach, describe, expect, it } from "vitest";
import { parse } from "csv-parse/sync";
import { prisma } from "@/lib/db";
import { STANDARD_CAUSE } from "@/domain/zendesk";
import { getReconRun, listReconRuns, reconCsv, runReconciliation } from "@/server/reconciliation/service";
import { resetDatabase, makeUsers } from "./helpers";
import { addClient, addGroup, addZd, seedFinance, setUsers } from "./economia-helpers";
import { batchOf, seedBugLink, seedPap, seedTicket } from "./calidad-helpers";

/**
 * CSAPP-09 §4: la conciliación lee, compara y registra; no modifica fuentes. Resultados esperados calculados a mano (minutos: 60 + 120 elegibles,
 * 30 pendientes de elegibilidad, 15 excluidos por PMO sin Grupo). El ingreso 12 000 € de la línea activa se compara con su Total de origen.
 */
let admin: { id: string };
let reader: { id: string };
beforeEach(async () => {
  await resetDatabase();
  ({ admin, reader } = await makeUsers());
});
const P = (extra: Record<string, string> = {}) => ({ scope: "group", sel: "", desde: "2026-10-01", hasta: "2026-10-31", servicio: "TOTAL", ...extra });
const byId = (run: { results: { id: string }[] }, id: string) => run.results.find((c) => c.id === id)! as ReturnType<typeof Object>;

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
  await seedBugLink(tb.id, { bugId: "2", ticket: "R2", clientId: c.id, groupId: g.id }); // dos bugs al mismo problema: cuenta una vez
  const pb = await batchOf(admin.id, "pap");
  await seedPap(pb.id, { id: "9", groupId: g.id, clientId: c.id, date: "2026-10-10", state: "CORRECTIVE", causes: [{ category: "CORRECTIVE", origin: "STANDARD" }, { category: "CORRECTIVE", origin: "CLIENT_ORIGIN" }] });
  const fb = await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "12000" }]);
  await prisma.financeBatch.update({ where: { batchId: fb.id }, data: { controlIncome: "12000" } });
  return { g, c, fb };
}

describe("conciliación en tres niveles", () => {
  it("resultados conocidos: partición 180 + 30 + 15 = 225, exclusiones con motivo, resultado de Calidad = conjuntos de exportación, sexto indicador 2 y PAP único", async () => {
    await world();
    const before = { times: await prisma.zdTimeEntry.count(), tickets: await prisma.zdTicket.count(), batches: await prisma.uploadBatch.count(), cfg: await prisma.configRevision.count() };
    const run = await runReconciliation(admin.id, P());
    expect(run.summary.difference).toBe(0);
    expect(byId(run, "REC-N1-01")).toMatchObject({ status: "OK", expected: "225", observed: "225" });
    expect(byId(run, "REC-N2-01")).toMatchObject({ status: "OK", expected: "225", observed: "225" });
    const n2 = byId(run, "REC-N2-01") as { exclusions: { reason: string; count: number }[] };
    expect(n2.exclusions.find((e) => /EXCLUIDA · motivo EXCLUDED_PMO/.test(e.reason))?.count).toBe(1);
    expect(byId(run, "REC-N2-02")).toMatchObject({ status: "OK" }); // las elegibles tienen Grupo
    expect(byId(run, "REC-N3-01")).toMatchObject({ status: "OK", expected: "180", observed: "180" });
    expect(byId(run, "REC-N3-02")).toMatchObject({ status: "OK", expected: "2" });
    expect(byId(run, "REC-N3-03")).toMatchObject({ status: "OK", expected: "1" }); // PMO N3 + IT N3 → un ticket en la unión
    expect(byId(run, "REC-N3-05")).toMatchObject({ status: "OK", expected: "2", observed: "2" }); // estándar R1 + R2 por vínculo (dos bugs: una vez)
    expect(byId(run, "REC-N3-05")).toMatchObject({ additive: false });
    expect(byId(run, "REC-N3-07")).toMatchObject({ status: "OK", expected: "1", observed: "1" }); // un PAP con dos causas: uno
    expect(byId(run, "REC-N1-04:2026:SOPORTE")).toMatchObject({ status: "OK", expected: "12000", observed: "12000" });
    expect(byId(run, "REC-N3-08")).toMatchObject({ status: "OK" });
    // No modifica ninguna fuente ni configuración; solo registra la ejecución con su manifiesto.
    expect({ times: await prisma.zdTimeEntry.count(), tickets: await prisma.zdTicket.count(), batches: await prisma.uploadBatch.count(), cfg: await prisma.configRevision.count() }).toEqual(before);
    expect(await prisma.reconRun.count()).toBe(1);
    expect(run.manifest).toMatchObject({ motor: expect.any(String), sello_datos: run.stamp, params: P() });
    // Informe tabular y manifiesto descargables.
    const rows = parse(reconCsv(run).replace(/^﻿/, ""), { delimiter: ";", columns: true, skip_empty_lines: true }) as Record<string, string>[];
    expect(rows.map((r) => r.id_comprobacion)).toContain("REC-N3-05");
    expect(rows.find((r) => r.id_comprobacion === "REC-N3-05")?.aditivo).toMatch(/^no/);
  });

  it("una diferencia financiera se señala con su signo y tolerancia monetaria; la tolerancia no tapa diferencias de horas o conteos", async () => {
    const w = await world();
    await prisma.financeBatch.update({ where: { batchId: w.fb.id }, data: { controlIncome: "12000.50" } });
    const run = await runReconciliation(admin.id, P());
    expect(byId(run, "REC-N1-04:2026:SOPORTE")).toMatchObject({ status: "DIFERENCIA", difference: "-0.5", tolerance: "0.01" });
    await prisma.financeBatch.update({ where: { batchId: w.fb.id }, data: { controlIncome: "12000.005" } });
    expect(byId(await runReconciliation(admin.id, P()), "REC-N1-04:2026:SOPORTE")).toMatchObject({ status: "OK" }); // dentro de la tolerancia monetaria
    expect(byId(run, "REC-N1-01").tolerance).toBe("0"); // las horas se concilian exactamente
  });

  it("sin conjunto financiero no se inventa resultado; un informe anterior conserva sus resultados y avisa si los datos cambian", async () => {
    await world();
    await prisma.financeScope.deleteMany();
    const first = await runReconciliation(admin.id, P());
    expect(first.results.find((c) => c.id === "REC-N1-04")?.status).toBe("NO_DISPONIBLE");
    const again = await getReconRun(admin.id, first.id);
    expect(again.stale).toBe(false);
    const zd = await batchOf(admin.id, "zendesk-tiempo");
    await addZd({ batchId: zd.id, date: "2026-10-09", minutes: 5 });
    const later = await getReconRun(admin.id, first.id);
    expect(later.stale).toBe(true); // avisa
    expect(byId(later, "REC-N1-01")).toMatchObject({ expected: "225", observed: "225" }); // pero NO se reescribe
    expect((await listReconRuns(admin.id)).length).toBe(1);
    const second = await runReconciliation(admin.id, P());
    expect(byId(second, "REC-N1-01")).toMatchObject({ expected: "230", observed: "230" });
    expect(await prisma.reconRun.count()).toBe(2);
  });

  it("solo Administración: Consulta no ejecuta ni lee informes; parámetros no válidos se rechazan", async () => {
    await world();
    await expect(runReconciliation(reader.id, P())).rejects.toThrow();
    const run = await runReconciliation(admin.id, P());
    await expect(getReconRun(reader.id, run.id)).rejects.toThrow();
    await expect(getReconRun(admin.id, "../../x")).rejects.toThrow(/no encontrado/);
    await expect(runReconciliation(admin.id, P({ desde: "2026-02-30" }))).rejects.toThrow(/no es válida/);
    expect(await prisma.reconRun.count()).toBe(1);
  });
});
