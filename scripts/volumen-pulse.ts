import "dotenv/config";
import { performance } from "node:perf_hooks";

/**
 * Medida de volumen de Pulse Rent (CSAPP-07 §11). Solo base `_test` aprobada por el guard central (TEST_DATABASE_URL explícita; se comprueba
 * `current_database()` antes de migrar o vaciar). Fixture aislada ≈1500 grupos y 250 000 tiempos (siembra de CSAPP-06) más perfiles canónicos,
 * destinos N2/N3 en tickets y PAP sintéticos con causas. Registra tamaño de la respuesta, sentencias, tiempo y memoria.
 * Uso: npm run benchmark:pulse [grupos] [tiempos]
 */
(async () => {
  const { activateTestTarget, assertConnectedTo, guardedTruncateAll } = await import("../src/lib/test-guard");
  const approved = activateTestTarget();
  process.env.CSAPP_COUNT_QUERIES = "1";
  process.env.BETTER_AUTH_SECRET ||= "x".repeat(40);
  const groups = Number(process.argv[2] ?? 1500);
  const times = Number(process.argv[3] ?? 250000);
  const { prisma } = await import("../src/lib/db");
  const { provisionAccount } = await import("../src/server/accounts");
  const { execFileSync } = await import("node:child_process");
  await assertConnectedTo(prisma, approved.target.name);
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, SHADOW_DATABASE_URL: "" }, stdio: "pipe" });
  await guardedTruncateAll(prisma, approved);
  await provisionAccount({ email: "vol@test.local", name: "Vol", password: "clave-de-prueba-123", role: "ADMIN" });
  const admin = await prisma.user.findFirstOrThrow();
  const { todayMadrid } = await import("../src/domain/vigencia");
  const today = todayMadrid();
  const { Prisma } = await import("../src/generated/prisma/client");
  const t0 = performance.now();
  const { seedVolumen } = await import("../tests/generators/analitica-volumen");
  await seedVolumen(admin.id, today, groups, times);
  // Perfiles, destinos y PAP sintéticos sobre la siembra de 06.
  const cs = await prisma.staffCatalogItem.create({ data: { kind: "TEAM", name: "CS" } });
  const n1 = await prisma.staffCatalogItem.create({ data: { kind: "LEVEL", name: "N1" } });
  const n2 = await prisma.staffCatalogItem.create({ data: { kind: "LEVEL", name: "N2" } });
  await prisma.$executeRaw(Prisma.sql`UPDATE "ZdTimeEntry" SET "drvTeamId" = ${cs.id}, "drvLevelId" = CASE WHEN id::text ~ '[05]$' THEN ${n2.id} ELSE ${n1.id} END`);
  await prisma.$executeRaw(Prisma.sql`UPDATE "ZdTicketRevision" SET destinations = CASE WHEN "ticketId"::int % 7 = 0 THEN ARRAY['CS_N2','PMO_N3','IT_N3'] WHEN "ticketId"::int % 5 = 0 THEN ARRAY['CS_N2'] ELSE ARRAY[]::text[] END`);
  const pb = await prisma.uploadBatch.create({ data: { profileId: "pap", profileVersion: 1, status: "COMPLETED", originalName: "s.xlsx", storageId: "s-vol-pap", fileFormat: "xlsx", createdById: admin.id } });
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "PapItem" (id, "listKey", "papId", "firstBatchId", "drvScope", "drvGroupId", "drvClientId", "updatedAt") SELECT 'vp' || i, 'L1', i::text, ${pb.id}, 'CLIENT', 'vg' || (1 + i % ${groups}), 'vc' || (1 + i % ${groups}), now() FROM generate_series(1, ${groups * 3}) i`);
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "PapRevision" ("itemId", fingerprint, "revisionNo", title, result, "productionDate", "correctiveState", data, "batchId") SELECT 'vp' || i, 'vpf' || i, 1, 'PAP ' || i, 'OK', ${`${today.slice(0, 4)}-01-01`}::date + (i % 280), CASE WHEN i % 2 = 0 THEN 'CORRECTIVE' ELSE 'NON_CORRECTIVE' END, '{}', ${pb.id} FROM generate_series(1, ${groups * 3}) i`);
  await prisma.$executeRaw(Prisma.sql`UPDATE "PapItem" t SET "currentRevisionId" = r.id FROM "PapRevision" r WHERE r."itemId" = t.id`);
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "PapCause" ("revisionId", "rawToken", normalized, category, origin) SELECT r.id, 'c', 'c', CASE WHEN r."correctiveState" = 'CORRECTIVE' THEN 'CORRECTIVE' ELSE 'EVOLUTIVE' END, CASE WHEN r."correctiveState" = 'CORRECTIVE' THEN (ARRAY['STANDARD','CUSTOMIZATION','CLIENT_ORIGIN'])[1 + r.id::int % 3] END FROM "PapRevision" r`);
  const { defaultPulseConfig } = await import("../src/domain/pulse-catalog");
  const { saveDraft, activateDraft } = await import("../src/server/pulse/config");
  const cfg = { ...defaultPulseConfig(), profiles: { CS_N1: [{ teamId: cs.id, levelId: n1.id, pmo: null }], CS_N2: [{ teamId: cs.id, levelId: n2.id, pmo: null }] } };
  const d = await saveDraft(admin.id, "PULSE", cfg, { expectedVersion: null });
  await activateDraft(admin.id, "PULSE", { expectedRevisionNo: 1, expectedDraftVersion: d.version, reason: "volumen" });
  console.log(`Siembra: ${groups} grupos, ${times} tiempos, ${groups * 3} PAP en ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  await prisma.$executeRawUnsafe("ANALYZE");
  const { parsePulseQuery } = await import("../src/domain/pulse-query");
  const { getPulse } = await import("../src/server/pulse/service");
  const { pulseDetail } = await import("../src/server/pulse/detail");
  const { pulseCsv } = await import("../src/server/pulse/export");
  const g = globalThis as unknown as { csappQueryCount?: number };
  const ALL = "M01,M02,M03,M04,M07,M10,M12,M13,M14,M15,M16,M17,M18,M19,M20,M21,M22,M23,M30,M31";
  const Q = (p: Record<string, string> = {}) => parsePulseQuery({ fecha: today, m: ALL, ...p }).query;
  const rows: string[] = [];
  const run = async <T>(name: string, fn: () => Promise<T>, size?: (r: T) => number) => {
    g.csappQueryCount = 0;
    const m0 = process.memoryUsage().rss;
    const s = performance.now();
    const r = await fn();
    const ms = performance.now() - s;
    const line = `| ${name} | ${(ms / 1000).toFixed(2)} | ${g.csappQueryCount} | ${size ? (size(r) / 1024).toFixed(0) : "—"} | ${((process.memoryUsage().rss - m0) / 1048576).toFixed(0)} / ${(process.memoryUsage().rss / 1048576).toFixed(0)} |`;
    rows.push(line);
    console.log(line);
    return r;
  };
  const json = (r: unknown) => JSON.stringify(r).length;
  await run("Tabla inicial (20 métricas, referencia «todos», página 1)", () => getPulse(admin.id, Q()), json);
  await run("Cambio de referencia (sin Silver)", () => getPulse(admin.id, Q({ ref: "sin_silver" })), json);
  await run("Cambio de normalización (bruto)", () => getPulse(admin.id, Q({ norm: "bruto" })), json);
  await run("Orden por M01 y segunda página", () => getPulse(admin.id, Q({ orden: "M01", dir: "desc", pagina: "2" })), json);
  await run("Distribución de una columna seleccionada", () => getPulse(admin.id, Q({ col: "M12", sel: "vg7" })), json);
  await run("Ámbito Cliente (1500 clientes)", () => getPulse(admin.id, Q({ ambito: "client" })), json);
  await run("Detalle de horas N1 (página 1)", () => pulseDetail(admin.id, Q(), "vg7", "M01", 1), json);
  await run("Detalle de PAP estándar (página 1)", () => pulseDetail(admin.id, Q(), "vg7", "M13", 1), json);
  await run("CSV completo de filas filtradas", () => pulseCsv(admin.id, Q(), "filas"), (r) => r.body.length);
  await run("CSV de estadísticas", () => pulseCsv(admin.id, Q(), "estadisticas"), (r) => r.body.length);
  console.log(`\n| Medida | s | sentencias | KB | RSS Δ / total MB |\n| --- | --- | --- | --- | --- |\n${rows.join("\n")}`);
  await prisma.$disconnect();
})();
