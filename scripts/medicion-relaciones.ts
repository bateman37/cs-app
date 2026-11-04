import "dotenv/config";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";

/**
 * Medida de la actualización automática de relaciones (HOTFIX-02 §12, volumen). Solo base `_test` aprobada por el guard central (TEST_DATABASE_URL explícita).
 * Pensada para una COPIA de la base de volumen representativa (≈250 000 tiempos Zendesk, ≈116 000 tickets, 6 000 PAP, 1 500 Clientes): aplica las migraciones
 * pendientes (tiempo), añade Wrike sintético, vacía la atribución derivada de tiempos Zendesk y Wrike y mide la reparación (tiempo, sentencias SQL, memoria de
 * proceso) y una segunda pasada idempotente. No promete tiempos: documenta lo medido en esta máquina. Uso: tsx scripts/medicion-relaciones.ts [filasWrike]
 */
(async () => {
  const { activateTestTarget, assertConnectedTo } = await import("../src/lib/test-guard");
  const approved = activateTestTarget();
  process.env.CSAPP_COUNT_QUERIES = "1";
  process.env.BETTER_AUTH_SECRET ||= "x".repeat(40);
  const wrikeRows = Number(process.argv[2] ?? 50000);
  const { prisma } = await import("../src/lib/db");
  const { Prisma } = await import("../src/generated/prisma/client");
  await assertConnectedTo(prisma, approved.target.name);
  const g = globalThis as unknown as { csappQueryCount?: number };

  const t0 = performance.now();
  execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: approved.url, SHADOW_DATABASE_URL: "" }, stdio: "pipe" });
  console.log(`migrate deploy: ${((performance.now() - t0) / 1000).toFixed(1)} s`);

  const one = async (sql: string) => Number((await prisma.$queryRawUnsafe<{ n: bigint }[]>(sql))[0].n);
  const before = {
    zd: await one(`SELECT count(*) AS n FROM "ZdTimeEntry"`), tickets: await one(`SELECT count(*) AS n FROM "ZdTicket"`), pap: await one(`SELECT count(*) AS n FROM "PapItem"`),
    clients: await one(`SELECT count(*) AS n FROM "Client"`), refreshRow: await one(`SELECT count(*) AS n FROM "RelationRefresh"`),
  };
  console.log("base:", JSON.stringify(before));

  // Wrike sintético (proyectos de las equivalencias existentes si las hay; si no, nombres inventados) para ejercitar su derivación.
  const batchId = (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "UploadBatch" LIMIT 1`))[0]?.id;
  if (batchId && wrikeRows > 0 && (await one(`SELECT count(*) AS n FROM "WrikeTimeEntry"`)) === 0) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "WrikeTimeEntry" ("originFingerprint","firstBatchId","taskName","userName","projectName","explicitState","workDate",hours,minutes,fingerprint,"updatedAt")
      SELECT 'w'||g, '${batchId}', 'tarea '||g, 'usuario '||(g % 40), 'proyecto '||(g % 800), 'NONE', date '2025-01-02' + (g % 300), 1, 60, 'wf'||g, now() FROM generate_series(1, ${wrikeRows}) g`);
  }
  // Estado «antes de propagar»: sin atribución derivada de tiempos.
  await prisma.$executeRawUnsafe(`UPDATE "ZdTimeEntry" SET "drvClientId" = NULL, "drvGroupId" = NULL, "drvBucket" = 'NO_CLIENT'`);
  await prisma.$executeRawUnsafe(`UPDATE "WrikeTimeEntry" SET "drvGroupId" = NULL, "drvClientId" = NULL, "drvBucket" = 'NO_SCOPE', "drvScopeMethod" = NULL`);

  const { refreshAllDerived } = await import("../src/server/relations/refresh");
  const { relationReport } = await import("../src/server/relations/report");
  const { lockDerivation } = await import("../src/server/zendesk/derive");
  for (const pass of ["reparación (1.ª pasada)", "idempotente (2.ª pasada)"]) {
    let peak = process.memoryUsage().rss;
    const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 100);
    g.csappQueryCount = 0;
    const t = performance.now();
    const updated = await prisma.$transaction(async (tx) => {
      await lockDerivation(tx);
      const a = await relationReport(tx);
      const u = await refreshAllDerived(tx);
      const b = await relationReport(tx);
      if (JSON.stringify(a.totals) !== JSON.stringify(b.totals)) throw new Error("no concilia");
      return u;
    }, { timeout: 3_600_000, maxWait: 10_000 });
    clearInterval(timer);
    console.log(`${pass}: ${((performance.now() - t) / 1000).toFixed(1)} s · ${g.csappQueryCount} sentencias · RSS pico ${(peak / 1048576).toFixed(0)} MB · actualizadas ${JSON.stringify(updated)}`);
  }
  const { runEconomics } = await import("../src/server/economics/engine");
  const admin = (await prisma.user.findFirst({ where: { role: "ADMIN" } }))?.id;
  if (admin) {
    g.csappQueryCount = 0;
    const t = performance.now();
    const r = await runEconomics(admin, { scope: { type: "groups", ids: "ALL" }, service: "TOTAL", date: "2026-06-15" } as never);
    console.log(`motor económico (todos los grupos, TOTAL): ${((performance.now() - t) / 1000).toFixed(1)} s · ${g.csappQueryCount} sentencias · ${r.totalEntities} entidades`);
  }
  void Prisma;
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
