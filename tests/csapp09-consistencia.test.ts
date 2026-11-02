import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { parseQualityQuery } from "@/domain/quality-query";
import { defaultQualityConfig } from "@/domain/quality-config";
import { activateDraft, saveDraft } from "@/server/pulse/config";
import { computeQuality } from "@/server/quality/engine";
import { evolutionIn } from "@/server/quality/detail";
import { saveHealthCell } from "@/server/quality/health";
import { readSnapshot, setSnapshotTestHook } from "@/server/analytics/snapshot";
import { resetDatabase, makeUsers } from "./helpers";
import { addClient, addGroup, seedFinance, setUsers } from "./economia-helpers";
import { batchOf, declare, seedTicket } from "./calidad-helpers";

/**
 * CSAPP-09 §7: lecturas coherentes bajo cambios concurrentes con BARRERAS deterministas. Mientras una lectura sigue abierta (REPEATABLE READ) otra conexión
 * activa un lote, cambia usuarios, Health, cobertura o la configuración; el resultado debe ser ÍNTEGRAMENTE el anterior (nunca una mezcla) y una lectura nueva
 * ve el estado posterior completo. Se comprueba en la cartera, en la ficha y en la serie de evolución.
 */
const NOW = new Date("2026-11-02T09:00:00Z");
let admin: { id: string };
beforeEach(async () => {
  await resetDatabase();
  ({ admin } = await makeUsers());
});
const Q = (extra: Record<string, string> = {}) => parseQualityQuery({ fecha: "2026-10-31", modo: "FULL_MONTH", ...extra }, NOW).query;

async function world() {
  const g = await addGroup("Atlas");
  const c = await addClient("Atlas 1", g.id);
  await prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: "701", searchValue: "701", clientId: c.id } });
  await setUsers(admin.id, { groupId: g.id }, 2026, Array(12).fill(100));
  const tb = await batchOf(admin.id, "zendesk-tickets", "2026-10-31");
  await seedTicket(tb.id, { id: "C1", org: "701", type: "incident", created: "2026-10-05", destinations: ["PMO_N3"], observedOn: "2026-10-31" });
  await declare(admin.id, tb.id, { statusScope: "ALL_STATUSES", from: "2026-01-01" });
  return { g, c, tb };
}
/** Cambios simultáneos que otra conexión confirma en un punto de la lectura: usuarios, Health, cobertura, configuración y un lote nuevo con más tickets. */
async function concurrentChanges(w: Awaited<ReturnType<typeof world>>) {
  await prisma.userMatrixMonth.updateMany({ data: { value: 1, revision: { increment: 1 } } }); // usuarios: 100 → 1
  await saveHealthCell(admin.id, { scope: "group", entityId: w.g.id, year: 2026, month: 10, state: "NEGATIVE", expectedVersion: 0 }, { now: NOW });
  const b2 = await batchOf(admin.id, "zendesk-tickets", "2026-10-31");
  for (let i = 0; i < 5; i++) await seedTicket(b2.id, { id: `X${i}`, org: "701", type: "incident", created: "2026-10-06", destinations: ["IT_N3"], observedOn: "2026-10-31" });
  await declare(admin.id, b2.id, { statusScope: "ALL_STATUSES", from: "2026-01-01" });
  const d = await saveDraft(admin.id, "QUALITY", { ...defaultQualityConfig(), incidents: { ...defaultQualityConfig().incidents, concerningDays: { incident: 1, problem: 1 } } }, { expectedVersion: null });
  await activateDraft(admin.id, "QUALITY", { expectedRevisionNo: 1, expectedDraftVersion: d.version, reason: "cambio concurrente" });
  await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: w.g.id, income: "999" }]);
}
/** Serializa sin la fecha de lectura (dos lecturas distintas tienen instantes distintos aunque describan el mismo estado). */
const clean = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, x) => (k === "readAt" ? undefined : typeof x === "bigint" ? x.toString() : x)));

describe("lecturas coherentes con cambios concurrentes", () => {
  for (const point of ["quality:after-meta", "quality:after-tickets", "quality:after-hours"]) {
    it(`cartera y ficha: un lote, usuarios, Health, cobertura y configuración cambiados en «${point}» no se mezclan con la lectura abierta`, async () => {
      const w = await world();
      const before = clean(await readSnapshot(admin.id, (tx) => computeQuality(tx, Q({ sel: w.g.id }), { now: NOW })));
      let fired = false;
      setSnapshotTestHook(async (p) => { if (p === point && !fired) { fired = true; await concurrentChanges(w); } });
      let during: unknown;
      try { during = clean(await readSnapshot(admin.id, (tx) => computeQuality(tx, Q({ sel: w.g.id }), { now: NOW }))); } finally { setSnapshotTestHook(null); }
      expect(fired).toBe(true);
      expect(during).toEqual(before); // íntegramente anterior: mismo sello, mismas cifras, misma revisión
      const after = clean(await readSnapshot(admin.id, (tx) => computeQuality(tx, Q({ sel: w.g.id }), { now: NOW }))) as { stamp: string; config: { revisionNo: number } };
      expect(after.stamp).not.toBe((before as { stamp: string }).stamp); // una lectura nueva ve el estado posterior completo
      expect(after.config.revisionNo).toBe(2);
    });
  }

  it("la serie de evolución (diez meses en una lectura) es íntegramente anterior aunque cambien usuarios, Health, cobertura y configuración durante ella", async () => {
    const w = await world();
    const run = () => readSnapshot(admin.id, (tx) => evolutionIn(tx, Q({ sel: w.g.id }), w.g.id, defaultQualityConfig(), "2026-11-02"));
    const before = clean(await run());
    let fired = false;
    setSnapshotTestHook(async (p) => { if (p === "quality:after-tickets" && !fired) { fired = true; await concurrentChanges(w); } });
    let during: unknown;
    try { during = clean(await run()); } finally { setSnapshotTestHook(null); }
    expect(fired).toBe(true);
    expect(during).toEqual(before);
    const after = (await run());
    expect(after.series.reference).not.toBe((before as { series: { reference: string } }).series.reference); // la referencia de la serie cambia con los datos
  });
});
