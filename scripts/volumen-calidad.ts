import "dotenv/config";
import { performance } from "node:perf_hooks";

/**
 * Medida de volumen de Calidad (CSAPP-08 §11). Solo base `_test` aprobada por el guard central (TEST_DATABASE_URL explícita; se comprueba
 * `current_database()` antes de migrar o vaciar). Fixture SINTÉTICA aislada: ≈1500 grupos y clientes, 250 000 tiempos, ≈114 000 tickets con revisiones,
 * seis fotografías mensuales (la última con todos los estados), estados antiguos, PAP, bugs vinculados, Client Health y cobertura declarada.
 * Registra tiempo, sentencias, tamaño de respuesta y memoria. Uso: npm run benchmark:calidad [grupos] [tiempos] [tickets]
 */
(async () => {
  const { activateTestTarget, assertConnectedTo, guardedTruncateAll } = await import("../src/lib/test-guard");
  const approved = activateTestTarget();
  process.env.CSAPP_COUNT_QUERIES = "1";
  process.env.BETTER_AUTH_SECRET ||= "x".repeat(40);
  const groups = Number(process.argv[2] ?? 1500);
  const times = Number(process.argv[3] ?? 250000);
  const tickets = Number(process.argv[4] ?? 114000);
  const { prisma } = await import("../src/lib/db");
  const { provisionAccount } = await import("../src/server/accounts");
  const { execFileSync } = await import("node:child_process");
  await assertConnectedTo(prisma, approved.target.name);
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, SHADOW_DATABASE_URL: "" }, stdio: "pipe" });
  await guardedTruncateAll(prisma, approved);
  await provisionAccount({ email: "vol@test.local", name: "Vol", password: "clave-de-prueba-123", role: "ADMIN" });
  const admin = await prisma.user.findFirstOrThrow();
  const { Prisma } = await import("../src/generated/prisma/client");
  const NOW = new Date("2026-11-02T09:00:00Z");
  const today = "2026-11-02";
  const t0 = performance.now();
  const { seedVolumen } = await import("../tests/generators/analitica-volumen");
  await seedVolumen(admin.id, today, groups, times);
  const sql = (s: ReturnType<typeof Prisma.sql>) => prisma.$executeRaw(s);
  const mk = (profileId: string, name: string, extract: string | null) =>
    prisma.uploadBatch.create({ data: { profileId, profileVersion: 1, status: "COMPLETED", originalName: name, storageId: `s-${name}`, fileFormat: "xlsx", createdById: admin.id, declaredExtractionDate: extract ? new Date(`${extract}T00:00:00Z`) : null } });
  // Clientes: usuarios propios, identidad de organización y tickets (mezcla de tipos, estados, causas y destinos).
  await sql(Prisma.sql`INSERT INTO "UserMatrix" (id, "clientId", year, "updatedAt") SELECT 'vn' || i, 'vc' || i, 2026, now() FROM generate_series(1, ${groups}) i`);
  await sql(Prisma.sql`INSERT INTO "UserMatrixMonth" ("matrixId", month, value, kind, source, "updatedById", "updatedAt") SELECT m.id, mo, 5 + length(m.id) % 20, 'ADJUSTED', 'sintético', ${admin.id}, now() FROM "UserMatrix" m, generate_series(1, 12) mo WHERE m."clientId" IS NOT NULL`);
  await sql(Prisma.sql`INSERT INTO "ExternalIdentity" (id, system, kind, "rawValue", "searchValue", "clientId", "updatedAt") SELECT 'vx' || i, 'ZENDESK', 'ORG_ID', (8000000 + i)::text, (8000000 + i)::text, 'vc' || i, now() FROM generate_series(1, ${groups}) i`);
  const tb = await mk("zendesk-tickets", "tickets-final.xlsx", "2026-10-31");
  await sql(Prisma.sql`INSERT INTO "ZdTicket" ("ticketId", "firstBatchId", "updatedAt") SELECT (1000000 + i)::text, ${tb.id}, now() FROM generate_series(1, ${tickets}) i`);
  await sql(Prisma.sql`INSERT INTO "ZdTicketRevision" ("ticketId", fingerprint, "revisionNo", "organizationId", entorno, "causaRaiz", destinations, "createdOn", "ticketType", status, "typeKnown", "statusKnown", "batchId")
    SELECT (1000000 + i)::text, 'qf' || i, 1, (8000001 + i % ${groups})::text, (ARRAY['Soporte','Personalización','Configuración','Integración'])[1 + i % 4],
      (ARRAY['incidente_estándar_plataforma','incidente_sistemas_del_cliente','incidente_uso_indebido','incidente_infraestructura','incidente_configuración_plataforma','incidente_customización_plataforma',NULL])[1 + i % 7],
      CASE WHEN i % 33 = 0 THEN ARRAY['PMO_N3','IT_N3'] WHEN i % 17 = 0 THEN ARRAY['CS_N2'] ELSE ARRAY[]::text[] END,
      '2025-01-01'::date + (i % 670), (ARRAY['incident','incident','incident','incident','problem','question','question','task'])[1 + i % 8],
      CASE WHEN i % 12 = 0 THEN 'open' WHEN i % 12 = 1 THEN 'pending' WHEN i % 40 = 2 THEN 'hold' WHEN i % 50 = 3 THEN 'new' WHEN i % 2 = 0 THEN 'solved' ELSE 'closed' END, true, true, ${tb.id}
    FROM generate_series(1, ${tickets}) i`);
  await sql(Prisma.sql`UPDATE "ZdTicket" t SET "currentRevisionId" = r.id FROM "ZdTicketRevision" r WHERE r."ticketId" = t."ticketId"`);
  // Observaciones: cinco fotografías mensuales de «solo sin resolver» y una final con todos los estados (estados antiguos incluidos).
  const photos: [string, string, boolean][] = [["2026-05-31", "may", false], ["2026-06-30", "jun", false], ["2026-07-31", "jul", false], ["2026-08-31", "ago", false], ["2026-09-30", "sep", false], ["2026-10-31", "oct", true]];
  const photoBatches = [] as { id: string; extract: string; full: boolean }[];
  for (const [extract, name, full] of photos) {
    const b = full ? tb : await mk("zendesk-tickets", `tickets-${name}.xlsx`, extract);
    photoBatches.push({ id: b.id, extract, full });
    await sql(Prisma.sql`INSERT INTO "ZdTicketObservation" ("ticketId", "batchId", "revisionId", "observedOn", "observedKind", "receivedAt")
      SELECT r."ticketId", ${b.id}, r.id, ${extract}::date, 'DECLARED', now() FROM "ZdTicketRevision" r
      WHERE r."createdOn" <= ${extract}::date AND (${full} OR r.status IN ('new', 'open', 'pending', 'hold'))`);
  }
  // PAP, bugs vinculados, tiempos Wrike no se necesitan; PAP y Work Items sí.
  const pb = await mk("pap", "pap.xlsx", null);
  await sql(Prisma.sql`INSERT INTO "PapItem" (id, "listKey", "papId", "firstBatchId", "drvScope", "drvGroupId", "drvClientId", "updatedAt") SELECT 'qp' || i, 'L1', i::text, ${pb.id}, 'CLIENT', 'vg' || (1 + i % ${groups}), 'vc' || (1 + i % ${groups}), now() FROM generate_series(1, ${groups * 4}) i`);
  await sql(Prisma.sql`INSERT INTO "PapRevision" ("itemId", fingerprint, "revisionNo", title, result, "productionDate", "correctiveState", data, "batchId") SELECT 'qp' || i, 'qpf' || i, 1, 'PAP ' || i, 'OK', '2026-01-01'::date + (i % 300), CASE WHEN i % 2 = 0 THEN 'CORRECTIVE' ELSE 'NON_CORRECTIVE' END, '{}', ${pb.id} FROM generate_series(1, ${groups * 4}) i`);
  await sql(Prisma.sql`UPDATE "PapItem" t SET "currentRevisionId" = r.id FROM "PapRevision" r WHERE r."itemId" = t.id`);
  await sql(Prisma.sql`INSERT INTO "PapCause" ("revisionId", "rawToken", normalized, category, origin) SELECT r.id, 'c', 'c', CASE WHEN r."correctiveState" = 'CORRECTIVE' THEN 'CORRECTIVE' ELSE 'EVOLUTIVE' END, CASE WHEN r."correctiveState" = 'CORRECTIVE' THEN (ARRAY['STANDARD','CUSTOMIZATION','CLIENT_ORIGIN'])[1 + r.id::int % 3] END FROM "PapRevision" r`);
  const bb = await mk("bugs-vfs", "bugs.csv", "2026-10-31");
  await sql(Prisma.sql`INSERT INTO "WorkItem" (id, product, "scopeKey", "workItemId", "firstBatchId", "updatedAt") SELECT 'qw' || i, 'VFS', 'S', i::text, ${bb.id}, now() FROM generate_series(1, 3000) i`);
  await sql(Prisma.sql`INSERT INTO "WorkItemRevision" ("workItemId", fingerprint, "revisionNo", "itemType", "isBug", title, state, "stateCategory", "stateKnown", "batchId") SELECT 'qw' || i, 'qwf' || i, 1, 'Bug_', true, 'Bug ' || i, 'Active', 'ACTIVE', true, ${bb.id} FROM generate_series(1, 3000) i`);
  await sql(Prisma.sql`UPDATE "WorkItem" w SET "currentRevisionId" = r.id FROM "WorkItemRevision" r WHERE r."workItemId" = w.id`);
  await sql(Prisma.sql`INSERT INTO "WorkItemObservation" ("workItemId", "batchId", "revisionId", "observedOn", "observedKind", "receivedAt") SELECT w.id, ${bb.id}, w."currentRevisionId", '2026-10-31', 'DECLARED', now() FROM "WorkItem" w`);
  await sql(Prisma.sql`INSERT INTO "WorkItemLink" ("workItemId", "ticketId", "drvState", "drvTicketType") SELECT 'qw' || i, (1000000 + 5 + 8 * i)::text, 'RESOLVED_EXTERNAL', 'problem' FROM generate_series(1, 3000) i WHERE 5 + 8 * i <= ${tickets}`);
  await sql(Prisma.sql`INSERT INTO "WorkItemLinkEvidence" ("linkId", "batchId", source, "rawRef", "observedOn") SELECT l.id, ${bb.id}, 'ZENDESK_TICKET_ID', l."ticketId", '2026-10-31' FROM "WorkItemLink" l`);
  // Client Health: 1500 grupos × 10 meses de 2026 (feedback explícito, nunca arrastrado) y clientes.
  await sql(Prisma.sql`INSERT INTO "HealthFeedback" ("groupId", year, month, state, "updatedById", "updatedAt") SELECT 'vg' || i, 2026, mo, (ARRAY['POSITIVE','MIXED','NEGATIVE'])[1 + (i + mo) % 3], ${admin.id}, now() FROM generate_series(1, ${groups}) i, generate_series(1, 10) mo`);
  // Cobertura declarada de los lotes completados.
  for (const b of [...new Set(photoBatches.map((x) => x.id))]) await sql(Prisma.sql`INSERT INTO "UploadCoverageDeclaration" ("batchId", version, population, "statusScope", "coveredFrom", "coveredTo", reason, "declaredById") VALUES (${b}, 1, 'ALL_CLIENTS', ${b === tb.id ? "ALL_STATUSES" : "UNRESOLVED_ONLY"}, '2025-01-01', '2026-10-31', 'volumen', ${admin.id})`);
  const zb = await prisma.uploadBatch.findFirstOrThrow({ where: { profileId: "zendesk-tiempo" } });
  for (const b of [zb.id, pb.id]) await sql(Prisma.sql`INSERT INTO "UploadCoverageDeclaration" ("batchId", version, population, "statusScope", "coveredFrom", "coveredTo", reason, "declaredById") VALUES (${b}, 1, 'ALL_CLIENTS', 'NOT_APPLICABLE', '2025-01-01', '2026-10-31', 'volumen', ${admin.id})`);
  // Configuración activada por el Administrador (fixture aislada).
  const cs = await prisma.staffCatalogItem.create({ data: { kind: "TEAM", name: "CS" } });
  const n1 = await prisma.staffCatalogItem.create({ data: { kind: "LEVEL", name: "N1" } });
  await sql(Prisma.sql`UPDATE "ZdTimeEntry" SET "drvTeamId" = ${cs.id}, "drvLevelId" = ${n1.id}`);
  const { defaultPulseConfig } = await import("../src/domain/pulse-catalog");
  const { defaultQualityConfig, emptyRule } = await import("../src/domain/quality-config");
  const { saveDraft, activateDraft } = await import("../src/server/pulse/config");
  const pd = await saveDraft(admin.id, "PULSE", { ...defaultPulseConfig(), profiles: { CS_N1: [{ teamId: cs.id, levelId: n1.id, pmo: null }] } }, { expectedVersion: null });
  await activateDraft(admin.id, "PULSE", { expectedRevisionNo: 1, expectedDraftVersion: pd.version, reason: "volumen" });
  const q = defaultQualityConfig();
  const cal = (a: string, b: string, unit: Parameters<typeof emptyRule>[1]) => ({ ...emptyRule("LOWER_BETTER", unit), a, b, calibration: "CALIBRADO" as const });
  q.health.confirmed = true;
  q.dedication = { profiles: ["CS_N1"], selectionConfirmed: true };
  for (const sc of ["GRUPO", "CLIENTE"] as const) {
    q.indicators.DEDICATION.rules[sc] = cal("2", "6", "HOURS_PER_USER_MONTH");
    // Percentiles sobre toda la cartera (referencia «todos») para N3 y PAP: valida el coste de las referencias.
    for (const k of ["PAP_CORRECTIVE", "N3_ESCALATIONS"] as const) q.indicators[k].rules[sc] = { ...emptyRule("LOWER_BETTER", "PER_100_USER_MONTHS"), method: "PERCENTILE", a: "50", b: "90", referenceId: "todos", minSample: 30, calibration: "CALIBRADO" };
    q.indicators.BUGS_STANDARD.rules[sc] = cal("5", "20", "PER_100_USER_MONTHS");
    q.indicators.INCIDENTS_PROBLEMS.rules[sc] = cal("30", "60", "PER_100_USER_MONTHS");
    q.incidents.backlog.INCIDENT[sc] = cal("20", "50", "PER_100_USERS_STOCK");
    q.incidents.backlog.PROBLEM[sc] = cal("20", "50", "PER_100_USERS_STOCK");
  }
  q.incidents = { ...q.incidents, concerningDays: { incident: 30, problem: 60 }, worstOfFlowAndBacklog: true, ageBands: [{ from: 0, to: 30 }, { from: 31, to: 180 }, { from: 181, to: null }] };
  q.global = { template: "WEIGHTED_SEVERITY", enabled: true, severity: { green: "0", yellow: "0.5", red: "1" }, greenMax: "0.3", yellowMax: "0.6" };
  const qd = await saveDraft(admin.id, "QUALITY", q, { expectedVersion: null });
  await activateDraft(admin.id, "QUALITY", { expectedRevisionNo: 1, expectedDraftVersion: qd.version, reason: "volumen" });
  console.log(`Siembra: ${groups} grupos y clientes, ${times} tiempos, ${tickets} tickets, ${photos.length} fotografías, ${groups * 4} PAP, 3000 vínculos a bugs, ${groups * 10} celdas de Health en ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  await prisma.$executeRawUnsafe("ANALYZE");
  const counts = await prisma.$queryRaw<{ t: string; n: bigint }[]>(Prisma.sql`SELECT 'tickets' AS t, count(*) AS n FROM "ZdTicket" UNION ALL SELECT 'observaciones', count(*) FROM "ZdTicketObservation" UNION ALL SELECT 'tiempos', count(*) FROM "ZdTimeEntry"`);
  console.log(counts.map((c) => `${c.t}: ${c.n}`).join(" · "));
  const { parseQualityQuery } = await import("../src/domain/quality-query");
  const { getQuality } = await import("../src/server/quality/engine");
  const { getBacklog, getDiagnosis, diagnosisTickets, evolutionIn } = await import("../src/server/quality/detail");
  const { qualityCsv } = await import("../src/server/quality/export");
  const { getHealthMatrix } = await import("../src/server/quality/health");
  const { readSnapshot } = await import("../src/server/analytics/snapshot");
  const g = globalThis as unknown as { csappQueryCount?: number };
  const Q = (p: Record<string, string> = {}) => parseQualityQuery({ fecha: "2026-10-31", modo: "FULL_MONTH", ...p }, NOW).query;
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
  const json = (r: unknown) => JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).length;
  await run("Cartera Grupo Cliente (1 página de 50, referencias por percentiles)", () => getQuality(admin.id, Q(), { now: NOW }), json);
  await run("Cartera Cliente (1500 clientes)", () => getQuality(admin.id, Q({ ambito: "client" }), { now: NOW }), json);
  await run("Filtro por color y orden por global (misma cohorte)", () => getQuality(admin.id, Q({ color: "yellow", orden: "global", dir: "desc" }), { now: NOW }), json);
  await run("Ficha de una entidad (cartera + selección)", () => getQuality(admin.id, Q({ sel: "vg7" }), { now: NOW }), json);
  await run("Evolución mensual de una entidad", () => readSnapshot(admin.id, (tx) => evolutionIn(tx, Q({ sel: "vg7" }), "vg7", defaultQualityConfig(), today)), json);
  await run("Backlog histórico (cartera, fotografía exacta, 1.ª página)", () => getBacklog(admin.id, Q(), 1, 50, NOW), json);
  await run("Backlog de un corte con solo fotografía anterior", () => getBacklog(admin.id, Q({ fecha: "2026-09-15", modo: "CUTOFF" }), 1, 50, NOW), json);
  await run("Diagnóstico por origen (cartera)", () => getDiagnosis(admin.id, Q(), NOW), json);
  await run("Detalle de una familia (1.ª página)", () => diagnosisTickets(admin.id, Q(), "ESTANDAR", 1, 50, NOW), json);
  await run("Matriz de Client Health (1.ª página)", () => getHealthMatrix(admin.id, { scope: "group", year: 2026, q: "", page: 1, pageSize: 50 }), json);
  await run("CSV completo de la cartera", () => qualityCsv(admin.id, Q(), "cartera", { now: NOW }), (r) => r.body.length);
  console.log(`\n| Medida | s | sentencias | KB | RSS Δ / total MB |\n| --- | --- | --- | --- | --- |\n${rows.join("\n")}`);
  await prisma.$disconnect();
})();
