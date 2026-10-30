import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { confirmUpload } from "@/server/uploads/batches";
import { reviewFinanceImpact } from "@/server/finance/review";
import { batch, buildWorker, drain, freshEnvironment, killAndWait, removeUploadDir, spawnWorker, useUploadDir, waitFor } from "./cargas-helpers";
import { activeRows, activeTotal, importFin, prepareFin, scopeOf } from "./finanzas-helpers";

/** Sustitución financiera con el trabajador REAL construido: fallo inyectado y SIGKILL en mitad de la transacción de activación. */
const FAST = {
  CSAPP_WORKER_LEASE_MS: "2000",
  CSAPP_WORKER_HEARTBEAT_MS: "500",
  CSAPP_WORKER_POLL_MS: "200",
  CSAPP_WORKER_CHUNK_ROWS: "2000",
  CSAPP_WORKER_BACKOFF_MS: "100",
};
let dir: string;
let admin: { id: string };
beforeAll(() => { dir = useUploadDir(); buildWorker(); }, 120_000);
afterAll(async () => { await dropTrigger(); removeUploadDir(dir); });
beforeEach(async () => { await dropTrigger(); admin = (await freshEnvironment()).admin; });

async function dropTrigger() {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS csapp05_test_trigger ON "FinanceScope"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS csapp05_test_fn()`);
}
/** Solo en la base _test: el puntero del ámbito (último paso de la activación) se retrasa o falla. */
async function injectOnPointerUpdate(body: string) {
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION csapp05_test_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${body} RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER csapp05_test_trigger BEFORE UPDATE OF "activeBatchId" ON "FinanceScope" FOR EACH ROW EXECUTE FUNCTION csapp05_test_fn()`);
}

async function setup() {
  const a = await importFin(admin.id, "ADMIN_DELEGADA", 2026, [{ grupo: "X", vta: 100 }, { grupo: "Y", vta: 30 }], { total: { vta: 130 } });
  const b = await prepareFin(admin.id, "ADMIN_DELEGADA", 2026, [{ grupo: "X", vta: 120 }], { total: { vta: 120 } });
  // el grupo X ya existe en el maestro tras importFin; la segunda carga se confirma con el trabajador real
  await reviewFinanceImpact(admin.id, b.id);
  return { a, b };
}

describe("atomicidad con el trabajador real", () => {
  it("fallo inyectado en mitad de la sustitución: el conjunto anterior queda íntegro y, retirado el fallo, la sustitución termina una sola vez", async () => {
    const { a, b } = await setup();
    await injectOnPointerUpdate(`RAISE EXCEPTION 'fallo inyectado por la prueba';`);
    const cur = await batch(b.id);
    await confirmUpload(admin.id, b.id, { expectedVersion: cur.version });
    const w = spawnWorker(FAST);
    try {
      await waitFor(async () => {
        const j = await prisma.uploadJob.findFirst({ where: { batchId: b.id, kind: "ACTIVATE" } });
        return j && j.status === "FAILED" ? j : null;
      }, 60_000, 100);
    } finally {
      await killAndWait(w, "SIGTERM");
    }
    // Ni conjunto intermedio ni mezcla: A sigue siendo el vigente con su total y B no ha dejado filas.
    expect(await activeTotal("ADMIN_DELEGADA", 2026)).toBe("130");
    expect((await scopeOf("ADMIN_DELEGADA", 2026))!.activeBatchId).toBe(a.id);
    expect(await prisma.financeRow.count({ where: { batchId: b.id } })).toBe(0);
    expect((await batch(a.id)).supersededByBatchId).toBeNull();
    expect((await batch(b.id)).status).not.toBe("COMPLETED");
    await dropTrigger();
  }, 120_000);

  it("SIGKILL durante la transacción de sustitución: lo no confirmado no es visible; al reiniciar se completa sin duplicados ni estado intermedio", async () => {
    const { a, b } = await setup();
    await injectOnPointerUpdate(`PERFORM pg_sleep(60);`);
    const cur = await batch(b.id);
    await confirmUpload(admin.id, b.id, { expectedVersion: cur.version });
    const w1 = spawnWorker(FAST);
    try {
      await waitFor(async () => {
        // la transacción de activación está abierta: la consulta bloqueada es la actualización del puntero
        const r = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND query ILIKE '%UPDATE "FinanceScope" SET "activeBatchId"%' AND state = 'active'`;
        return Number(r[0].n) > 0 ? true : null;
      }, 60_000, 100);
      // mientras tanto, lo que ve cualquier lector es el conjunto anterior completo
      expect(await activeTotal("ADMIN_DELEGADA", 2026)).toBe("130");
      expect(await prisma.financeRow.count({ where: { batchId: b.id } })).toBe(0);
    } finally {
      await killAndWait(w1, "SIGKILL");
    }
    await prisma.$queryRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND query ILIKE '%pg_sleep%'`;
    expect(await activeTotal("ADMIN_DELEGADA", 2026)).toBe("130");
    expect((await scopeOf("ADMIN_DELEGADA", 2026))!.activeBatchId).toBe(a.id);
    expect(await prisma.financeRow.count({ where: { batchId: b.id } })).toBe(0);
    await dropTrigger();

    const w2 = spawnWorker(FAST);
    try {
      await waitFor(async () => ((await batch(b.id)).status === "COMPLETED" ? true : null), 120_000);
    } finally {
      await killAndWait(w2, "SIGTERM");
    }
    expect(await activeTotal("ADMIN_DELEGADA", 2026)).toBe("120"); // nunca 250 ni 130
    expect((await activeRows("ADMIN_DELEGADA", 2026)).map((r) => r.label)).toEqual(["X"]);
    expect(await prisma.financeRow.count({ where: { batchId: b.id } })).toBe(1);
    expect((await batch(a.id)).supersededByBatchId).toBe(b.id);
    expect(await prisma.uploadJob.count({ where: { batchId: b.id, kind: "ACTIVATE", status: "DONE" } })).toBe(1);
    expect((await scopeOf("ADMIN_DELEGADA", 2026))!.activeBatchId).toBe(b.id);
    await drain();
  }, 180_000);
});
