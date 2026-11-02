import "dotenv/config";
import { performance } from "node:perf_hooks";
import { loadavg } from "node:os";

/**
 * Medida de volumen de Calidad (CSAPP-08 §11). Solo base `_test` aprobada por el guard central (TEST_DATABASE_URL explícita; se comprueba
 * `current_database()` antes de migrar o vaciar). Fixture SINTÉTICA aislada: ≈1500 grupos y clientes, 250 000 tiempos, ≈114 000 tickets con revisiones,
 * seis fotografías mensuales (la última con todos los estados), estados antiguos, PAP, bugs vinculados, Client Health y cobertura declarada.
 * Registra tiempo, sentencias, tamaño de respuesta y memoria. Uso: npm run benchmark:calidad [grupos] [tiempos] [tickets]
 *
 * CSAPP-10 (evolución), variables opcionales:
 *  - CSAPP_SKIP_SEED=1   no migra, vacía ni siembra: mide sobre la base ya sembrada con la misma fixture (medidas repetidas sobre los mismos datos).
 *  - CSAPP_REPS=n        repeticiones por operación (por defecto 3).
 *  - CSAPP_ONLY=evol     solo las evoluciones mensuales (cartera, ficha y detalles no se miden).
 *  - CSAPP_EVOLUTION_REFERENCE=1  mide también la ruta de referencia de 09 (por mes con computeQuality), tal cual y con JIT desactivado.
 *  - CSAPP_PROFILE=1     duración y texto de las sentencias más costosas de cada evolución.
 *  - CSAPP_EVOLUTION_DUMP=ruta  escribe la salida íntegra de las evoluciones (config. activa; grupo y cliente) en un JSON, para compararlas entre versiones.
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
  const skipSeed = process.env.CSAPP_SKIP_SEED === "1";
  if (!skipSeed) {
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, SHADOW_DATABASE_URL: "" }, stdio: "pipe" });
    await guardedTruncateAll(prisma, approved);
    await provisionAccount({ email: "vol@test.local", name: "Vol", password: "clave-de-prueba-123", role: "ADMIN" });
  }
  const admin = await prisma.user.findFirstOrThrow();
  const { Prisma } = await import("../src/generated/prisma/client");
  const NOW = new Date("2026-11-02T09:00:00Z");
  const today = "2026-11-02";
  const t0 = performance.now();
  if (!skipSeed) {
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
  }
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
  // CSAPP_PROFILE=1: recoge duración y texto de cada sentencia de la última repetición para localizar el coste (no afecta a las medidas: solo se lee el evento).
  const stmts: { ms: number; q: string }[] = [];
  let collecting = false;
  if (process.env.CSAPP_PROFILE === "1") (prisma as unknown as { $on: (e: "query", cb: (ev: { duration: number | bigint; query: string }) => void) => void }).$on("query", (ev) => { if (collecting) stmts.push({ ms: Number(ev.duration), q: ev.query }); });
  const profileReport = (title: string) => {
    if (process.env.CSAPP_PROFILE !== "1") return;
    const by = new Map<string, { n: number; ms: number }>();
    for (const s of stmts) { const k = s.q.replace(/\s+/g, " ").slice(0, 110); const a = by.get(k) ?? { n: 0, ms: 0 }; a.n++; a.ms += s.ms; by.set(k, a); }
    const total = stmts.reduce((x, y) => x + y.ms, 0);
    console.log(`PERFIL ${title}: ${stmts.length} sentencias, ${total.toFixed(0)} ms en SQL`);
    for (const [k, v] of [...by.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 14)) console.log(`   ${v.ms.toFixed(0).padStart(6)} ms  x${String(v.n).padStart(3)}  ${k}`);
    stmts.length = 0;
  };
  // Tres medidas por operación (la primera es «fría»: caché de PostgreSQL y de módulos por calentar); se informa mediana y rango. `reps = 1` en operaciones con efectos.
  const run = async <T>(name: string, fn: () => Promise<T>, size?: (r: T) => number, repsOverride?: number) => {
    const reps = repsOverride ?? Number(process.env.CSAPP_REPS ?? 3);
    const times: number[] = [];
    let r!: T;
    let queries = 0;
    const m0 = process.memoryUsage().rss;
    for (let i = 0; i < reps; i++) {
      g.csappQueryCount = 0;
      collecting = i === reps - 1 && name.startsWith("Evolución");
      stmts.length = 0;
      const s = performance.now();
      r = await fn();
      times.push((performance.now() - s) / 1000);
      queries = g.csappQueryCount ?? 0;
      collecting = false;
    }
    if (name.startsWith("Evolución")) profileReport(name);
    const sorted = [...times].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const line = `| ${name} | ${med.toFixed(2)} (${sorted[0].toFixed(2)}–${sorted[sorted.length - 1].toFixed(2)}; 1.ª ${times[0].toFixed(2)}) | ${queries} | ${size ? (size(r) / 1024).toFixed(0) : "—"} | ${((process.memoryUsage().rss - m0) / 1048576).toFixed(0)} / ${(process.memoryUsage().rss / 1048576).toFixed(0)} / ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} | ${loadavg()[0].toFixed(2)} |`;
    rows.push(line);
    console.log(line);
    return r;
  };
  const json = (r: unknown) => JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).length;
  const { defaultQualityConfig: defaultQualityConfigRun } = await import("../src/domain/quality-config");
  const only = process.env.CSAPP_ONLY === "evol";
  if (!only) {
    await run("Cartera Grupo Cliente (1 página de 50, referencias por percentiles)", () => getQuality(admin.id, Q(), { now: NOW }), json);
    await run("Cartera Cliente (1500 clientes)", () => getQuality(admin.id, Q({ ambito: "client" }), { now: NOW }), json);
    await run("Filtro por color y orden por global (misma cohorte)", () => getQuality(admin.id, Q({ color: "yellow", orden: "global", dir: "desc" }), { now: NOW }), json);
    await run("Ficha de una entidad (cartera + selección)", () => getQuality(admin.id, Q({ sel: "vg7" }), { now: NOW }), json);
    await run("Evolución mensual de una entidad (config. por defecto, sin percentiles; medida de 09)", () => readSnapshot(admin.id, (tx) => evolutionIn(tx, Q({ sel: "vg7" }), "vg7", defaultQualityConfigRun(), today)), json);
  }
  // CSAPP-10: evolución con la configuración ACTIVA (percentiles de cartera en N3/PAP, backlog, Health, global), por Grupo y por Cliente.
  const { getActive } = await import("../src/server/pulse/config");
  const activeCfg = (await readSnapshot(admin.id, (tx) => getActive(tx, "QUALITY"))).payload;
  const evoG = await run("Evolución mensual · Grupo (config. activa con percentiles)", () => readSnapshot(admin.id, (tx) => evolutionIn(tx, Q({ sel: "vg7" }), "vg7", activeCfg, today)), json);
  const evoC = await run("Evolución mensual · Cliente (config. activa con percentiles)", () => readSnapshot(admin.id, (tx) => evolutionIn(tx, Q({ ambito: "client", sel: "vc7" }), "vc7", activeCfg, today)), json);
  if (process.env.CSAPP_EVOLUTION_REFERENCE === "1") {
    // Ruta de referencia de CSAPP-09 (un computeQuality completo por mes), SOLO para atribuir la mejora: tal cual y con JIT desactivado en la transacción.
    const { evolutionReferenceIn } = await import("../src/server/quality/detail");
    await run("Evolución mensual · Grupo · referencia 09 (por mes con computeQuality)", () => readSnapshot(admin.id, (tx) => evolutionReferenceIn(tx, Q({ sel: "vg7" }), "vg7", activeCfg, today)), json);
    await run("Evolución mensual · Grupo · referencia 09 con JIT desactivado", () => readSnapshot(admin.id, async (tx) => { await tx.$executeRaw`SET LOCAL jit = off`; return evolutionReferenceIn(tx, Q({ sel: "vg7" }), "vg7", activeCfg, today); }), json);
  }
  if (process.env.CSAPP_EVOLUTION_DUMP) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(process.env.CSAPP_EVOLUTION_DUMP, JSON.stringify({ grupo: evoG, cliente: evoC }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 1));
    console.log(`Evolución volcada en ${process.env.CSAPP_EVOLUTION_DUMP}`);
  }
  if (!only) {
    await run("Backlog histórico (cartera, fotografía exacta, 1.ª página)", () => getBacklog(admin.id, Q(), 1, 50, NOW), json);
    await run("Backlog de un corte con solo fotografía anterior", () => getBacklog(admin.id, Q({ fecha: "2026-09-15", modo: "CUTOFF" }), 1, 50, NOW), json);
    await run("Diagnóstico por origen (cartera)", () => getDiagnosis(admin.id, Q(), NOW), json);
    await run("Detalle de una familia (1.ª página)", () => diagnosisTickets(admin.id, Q(), "ESTANDAR", 1, 50, NOW), json);
    await run("Matriz de Client Health (1.ª página)", () => getHealthMatrix(admin.id, { scope: "group", year: 2026, q: "", page: 1, pageSize: 50 }), json);
    await run("CSV completo de la cartera", () => qualityCsv(admin.id, Q(), "cartera", { now: NOW }), (r) => r.body.length);
  }
  if (only) {
    console.log(`\n| Medida | s: mediana (rango; 1.ª fría) | sentencias | KB | RSS Δ / total / pico MB | carga 1 min |\n| --- | --- | --- | --- | --- | --- |\n${rows.join("\n")}`);
    await prisma.$disconnect();
    return;
  }
  // CSAPP-09: conciliación y exportación completa (solo en esta rama; no existen en 08).
  try {
    const { runReconciliation } = await import("../src/server/reconciliation/service");
    const { createExport } = await import("../src/server/exports/service");
    const { runExportOnce } = await import("../src/server/exports/run");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const nodePath = await import("node:path");
    process.env.CSAPP_EXPORT_DIR = mkdtempSync(nodePath.join(tmpdir(), "vol-exp-"));
    await run("Conciliación (tres niveles, todo el ámbito, 2026 hasta 31/10)", () => runReconciliation(admin.id, { scope: "group", sel: "", desde: "2026-01-01", hasta: "2026-10-31", servicio: "TOTAL" }), json, 1);
    for (const ds of ["tickets", "horas", "pap", "bugs"]) {
      await run(`Exportación completa «${ds}»: solicitud (totales + sello)`, () => createExport(admin.id, { dataset: ds, scope: "group", sel: "", desde: "2026-01-01", hasta: "2026-10-31", servicio: "TOTAL" }), json, 1);
      await run(`Exportación completa «${ds}»: preparación + generación en el trabajador`, () => runExportOnce("volumen"), () => 0, 1);
    }
  } catch (e) {
    if (!(e instanceof Error) || !/Cannot find module|Failed to load url/i.test(e.message)) throw e;
    console.log("(conciliación/exportación no existen en esta versión)");
  }
  // CSAPP-09 §7: planes con EXPLAIN (ANALYZE, BUFFERS) SOLO en esta base de test (la guarda ya lo garantizó). Se resumen nodos de lectura y tiempos.
  try {
    const { readDataStamp } = await import("../src/server/analytics/stamp");
    await run("Sello de datos (lectura sobre la instantánea)", () => prisma.$transaction((tx) => readDataStamp(tx), { isolationLevel: "RepeatableRead" }), json);
    const { DATASETS } = await import("../src/server/exports/datasets");
    const { resolveParams } = await import("../src/server/exports/service");
    const params = (await prisma.$transaction((tx) => resolveParams(tx, { dataset: "tickets", scope: "group", sel: "", desde: "2026-01-01", hasta: "2026-10-31", servicio: "TOTAL" }), { isolationLevel: "RepeatableRead" })).params;
    for (const [dsKey, fileKey] of [["tickets", "tickets"], ["horas", "horas"], ["pap", "pap"], ["bugs", "problemas_bugs"]] as const) {
      const f = DATASETS.find((d) => d.key === dsKey)!.files.find((x) => x.fileKey === fileKey)!;
      const plan = await prisma.$queryRaw<{ "QUERY PLAN": string }[]>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) ${f.sql(params)}`);
      const lines = plan.map((r) => r["QUERY PLAN"]);
      const scans = [...new Set(lines.map((l) => /(Seq Scan on \S+|Index (?:Only )?Scan using \S+ on \S+|Bitmap Heap Scan on \S+|Parallel Seq Scan on \S+)/.exec(l)?.[1]).filter(Boolean))];
      console.log(`EXPLAIN ${fileKey}: ${lines.find((l) => /Execution Time/.test(l))?.trim()}; ${lines.find((l) => /Planning Time/.test(l))?.trim()}; nodos de lectura: ${scans.join(" | ")}; ${lines.find((l) => /^\s*Buffers:/.test(l))?.trim() ?? ""}`);
    }
  } catch (e) {
    console.log(`(sello/EXPLAIN no disponibles: ${e instanceof Error ? e.message.split("\n")[0] : "error"})`);
  }
  console.log(`\n| Medida | s: mediana (rango; 1.ª fría) | sentencias | KB | RSS Δ / total / pico MB | carga 1 min |\n| --- | --- | --- | --- | --- | --- |\n${rows.join("\n")}`);
  await prisma.$disconnect();
})();
