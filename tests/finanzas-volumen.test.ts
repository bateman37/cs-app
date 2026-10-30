import { appendFileSync, createReadStream, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { confirmUpload, receiveUpload } from "@/server/uploads/batches";
import { reviewFinanceImpact } from "@/server/finance/review";
import { runEconomics } from "@/server/economics/engine";
import { listHoursDetail, listIncomeDetail } from "@/server/economics/detail";
import { batch, buildWorker, freshEnvironment, killAndWait, removeUploadDir, spawnWorker, useUploadDir, waitFor } from "./cargas-helpers";
import { writeXlsx } from "./generators/xlsx";
import { standardFooter } from "./generators/finance";

/**
 * Volumen de CSAPP-05. (1) Circuito financiero completo con el trabajador REAL: recepción, preparación, revisión del impacto, activación y
 * sustitución de un conjunto de FIN_ROWS grupos (los tamaños de las muestras reales, 40/4/7 filas, no son límites). (2) Motor económico con
 * ≥250 000 tiempos sintéticos de Zendesk y Wrike repartidos entre grupos y meses, con servicios, vacíos y filtros: consultas por conjuntos
 * (se cuentan las sentencias), sin joins que multipliquen horas ni arrays completos en el navegador. Las medidas se imprimen y, si se indica
 * CSAPP_TEST_MEASURES_FILE, se anexan a ese archivo.
 */
const FIN_ROWS = Number(process.env.CSAPP_TEST_FIN_ROWS ?? 60_000);
const TIMES = Number(process.env.CSAPP_TEST_TIMES ?? 250_000);
const GROUPS = Number(process.env.CSAPP_TEST_GROUPS ?? 1_500);

let dir: string;
let tmp: string;
let admin: { id: string };
beforeAll(() => { dir = useUploadDir(); tmp = mkdtempSync(path.join(tmpdir(), "csapp-05vol-")); buildWorker(); });
afterAll(() => { removeUploadDir(dir); rmSync(tmp, { recursive: true, force: true }); });
beforeEach(async () => { admin = (await freshEnvironment()).admin; });

function report(m: object) {
  const line = `MEDIDAS_CSAPP05 ${JSON.stringify(m)}`;
  console.log(line);
  if (process.env.CSAPP_TEST_MEASURES_FILE) appendFileSync(process.env.CSAPP_TEST_MEASURES_FILE, `${line}\n`);
}
function peakRssMb(pid: number | undefined): number | null {
  if (!pid) return null;
  try {
    const m = /VmHWM:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
    return m ? Math.round(Number(m[1]) / 1024) : null;
  } catch { return null; }
}
const queries = () => (globalThis as unknown as { csappQueryCount?: number }).csappQueryCount ?? -1;

function* finRows(n: number, bump = 0): Generator<(string | number | null)[]> {
  yield ["Grupo cliente", "Vta Potencial", "Diferencia"];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = 1000 + (i % 97) * 13 + bump;
    sum += v;
    yield [`Grupo origen ${i}`, v, -(i % 7)];
  }
  yield ["Total", sum, null];
  for (const l of standardFooter("SOPORTE")) yield [l];
}

describe("volumen de CSAPP-05", () => {
  it("circuito financiero: recepción, preparación, revisión, activación y sustitución con el trabajador real", async () => {
    // La mitad de los grupos de origen está en el maestro: el resto queda sin asignar y se acepta expresamente.
    await prisma.$executeRawUnsafe(`INSERT INTO "ClientGroup" (id, name, "updatedAt") SELECT 'vg' || g, 'Grupo ' || g, now() FROM generate_series(0, ${Math.floor(FIN_ROWS / 2) - 1}) g`);
    await prisma.$executeRawUnsafe(`INSERT INTO "ExternalIdentity" (id, system, kind, "rawValue", "searchValue", "groupId", "updatedAt")
      SELECT 'vi' || g, 'BC', 'GROUP_KEY', 'Grupo origen ' || g, 'grupo origen ' || g, 'vg' || g, now() FROM generate_series(0, ${Math.floor(FIN_ROWS / 2) - 1}) g`);
    const f1 = path.join(tmp, "fin1.xlsx");
    const f2 = path.join(tmp, "fin2.xlsx");
    const tg = Date.now();
    await writeXlsx(f1, { sheets: [{ name: "Hoja1", rows: finRows(FIN_ROWS) }] });
    await writeXlsx(f2, { sheets: [{ name: "Hoja1", rows: finRows(FIN_ROWS, 5) }] });
    const genS = (Date.now() - tg) / 1000;
    const w = spawnWorker({ CSAPP_WORKER_POLL_MS: "200", CSAPP_WORKER_CHUNK_ROWS: "2000" });
    const out: Record<string, unknown> = { filasFinancieras: FIN_ROWS, bytes: statSync(f1).size, generacionS: genS };
    try {
      const run = async (file: string, label: string) => {
        const t0 = Date.now();
        const up = await receiveUpload(admin.id, { profileId: "facturacion-soporte", originalName: label, metadata: { anio: 2026, conjuntoCompleto: "si" }, declared: {}, contentLength: statSync(file).size, body: createReadStream(file) });
        const tUp = Date.now();
        await waitFor(async () => ((await batch(up.id)).status === "READY" ? true : null), 600_000, 200);
        const tPrep = Date.now();
        const { decideFinance } = await import("@/server/finance/review");
        await decideFinance(admin.id, up.id, { kind: "ACCEPT_UNASSIGNED" });
        const t3 = Date.now();
        await reviewFinanceImpact(admin.id, up.id);
        const tRev = Date.now();
        const cur = await batch(up.id);
        await confirmUpload(admin.id, up.id, { expectedVersion: cur.version });
        await waitFor(async () => ((await batch(up.id)).status === "COMPLETED" ? true : null), 600_000, 200);
        const tAct = Date.now();
        return { recepcionS: (tUp - t0) / 1000, preparacionS: (tPrep - tUp) / 1000, decisionS: (t3 - tPrep) / 1000, revisionImpactoS: (tRev - t3) / 1000, activacionS: (tAct - tRev) / 1000, id: up.id };
      };
      out.primera = await run(f1, "fin1.xlsx");
      out.sustitucion = await run(f2, "fin2.xlsx");
      out.picoMemoriaTrabajadorMb = peakRssMb(w.pid);
    } finally {
      await killAndWait(w, "SIGTERM");
    }
    const n = await prisma.$queryRaw<{ n: bigint; t: string }[]>`SELECT count(*) AS n, sum(r.income)::text AS t FROM "FinanceScope" s JOIN "FinanceRow" r ON r."batchId" = s."activeBatchId" WHERE s.year = 2026 AND s.category = 'SOPORTE'`;
    expect(Number(n[0].n)).toBe(FIN_ROWS); // sustituido, no sumado
    out.filasActivas = Number(n[0].n);
    report(out);
  }, 1_800_000);

  it("motor económico con ≥250 000 tiempos: consultas por conjuntos, cartera ponderada y detalle paginado", async () => {
    const g = GROUPS;
    await prisma.$executeRawUnsafe(`INSERT INTO "ClientGroup" (id, name, "updatedAt") SELECT 'vg' || i, 'Grupo ' || lpad(i::text, 5, '0'), now() FROM generate_series(1, ${g}) i`);
    for (const [cat, prof] of [["SOPORTE", "facturacion-soporte"], ["ADMIN_DELEGADA", "facturacion-admin-delegada"], ["OTROS", "facturacion-otros"]] as const) {
      for (const year of [2025, 2026]) {
        const id = `vb-${cat}-${year}`;
        await prisma.$executeRawUnsafe(`INSERT INTO "UploadBatch" (id, "profileId", "profileVersion", status, "originalName", "storageId", "fileFormat", "createdById", "updatedAt") VALUES ('${id}', '${prof}', 1, 'COMPLETED', 'v', 's-${id}', 'xlsx', '${admin.id}', now())`);
        await prisma.$executeRawUnsafe(`INSERT INTO "FinanceBatch" ("batchId", year, category, origin, tolerance) VALUES ('${id}', ${year}, '${cat}', 'UPLOAD', 0.01)`);
        await prisma.$executeRawUnsafe(`INSERT INTO "FinanceRow" ("batchId", position, "sourceRow", "groupLabel", "sourceKey", fingerprint, income, "groupId", resolution)
          SELECT '${id}', i, i + 1, 'g' || i, 'g' || i, '${id}-' || i, (1000 + (i % 50) * 100) * ${cat === "SOPORTE" ? 12 : 2}, 'vg' || i, 'RESOLVED' FROM generate_series(1, ${g}) i WHERE i % ${cat === "SOPORTE" ? 1 : 3} = 0`);
        await prisma.$executeRawUnsafe(`INSERT INTO "FinanceScope" (year, category, "activeBatchId", version) VALUES (${year}, '${cat}', '${id}', 2)`);
      }
    }
    await prisma.$executeRawUnsafe(`INSERT INTO "UserMatrix" (id, "groupId", year, "updatedAt") SELECT 'vm' || i || '-' || y, 'vg' || i, y, now() FROM generate_series(1, ${g}) i, (VALUES (2025), (2026)) t(y)`);
    await prisma.$executeRawUnsafe(`INSERT INTO "UserMatrixMonth" ("matrixId", month, value, kind, source, "updatedById", "updatedAt") SELECT 'vm' || i || '-' || y, m, 10 + (i % 40), 'ADJUSTED', 'vol', '${admin.id}', now() FROM generate_series(1, ${g}) i, (VALUES (2025), (2026)) t(y), generate_series(1, 12) m`);
    const bid = "vb-tiempos";
    await prisma.$executeRawUnsafe(`INSERT INTO "UploadBatch" (id, "profileId", "profileVersion", status, "originalName", "storageId", "fileFormat", "createdById", "updatedAt") VALUES ('${bid}', 'zendesk-tiempo', 1, 'COMPLETED', 'v', 's-${bid}', 'xlsx', '${admin.id}', now())`);
    // Tickets con distintos Entorno y Tipología (parte asignados a servicios, parte sin asignar) y 1 000 tickets de administración delegada.
    await prisma.$executeRawUnsafe(`INSERT INTO "ZdTicket" ("ticketId", "firstBatchId", "updatedAt") SELECT (700000 + i)::text, '${bid}', now() FROM generate_series(1, 5000) i`);
    await prisma.$executeRawUnsafe(`INSERT INTO "ZdTicketRevision" ("ticketId", fingerprint, "revisionNo", entorno, "createdOn", "ticketType", status, "typeKnown", "statusKnown", "adminDelegada", "batchId")
      SELECT (700000 + i)::text, 'fp' || i, 1, CASE i % 5 WHEN 0 THEN 'Entorno soporte' WHEN 1 THEN 'Entorno otros' WHEN 2 THEN 'Administración Delegada' WHEN 3 THEN 'Sin asignar' ELSE NULL END,
        DATE '2026-01-01', 'incident', 'open', true, true, CASE WHEN i % 5 = 2 THEN true WHEN i % 5 = 4 THEN NULL ELSE false END, '${bid}' FROM generate_series(1, 5000) i`);
    await prisma.$executeRawUnsafe(`UPDATE "ZdTicket" t SET "currentRevisionId" = r.id FROM "ZdTicketRevision" r WHERE r."ticketId" = t."ticketId"`);
    await prisma.$executeRawUnsafe(`INSERT INTO "ServiceAssignment" (id, "matchKind", "matchValue", "searchValue", service, "updatedAt") VALUES ('sa1','ENTORNO','Entorno soporte','entorno soporte','SOPORTE', now()), ('sa2','ENTORNO','Entorno otros','entorno otros','OTROS', now()), ('sa3','WRIKE_PROJECT','Proyecto Vol','proyecto vol','SOPORTE', now())`);
    const zd = Math.floor(TIMES * 0.6);
    const wr = TIMES - zd;
    const t0 = Date.now();
    await prisma.$executeRawUnsafe(`INSERT INTO "ZdTimeEntry" (id, "originFingerprint", "firstBatchId", "ticketId", "workDate", "loggedHours", "loggedMinutes", minutes, fingerprint, "drvGroupId", "drvEligibility", "drvBucket", "updatedAt")
      SELECT 'z' || i, 'zo' || i, '${bid}', (700000 + (i % 5000) + 1)::text, DATE '2025-01-01' + (i % 668), 0, 5 + (i % 90), 5 + (i % 90), 'zf' || i, 'vg' || (1 + (i % ${g})),
        CASE WHEN i % 40 = 0 THEN 'PENDING_ELIGIBILITY' WHEN i % 31 = 0 THEN 'EXCLUDED_PMO' ELSE 'ELIGIBLE' END, 'ATTRIBUTABLE', now() FROM generate_series(1, ${zd}) i`);
    await prisma.$executeRawUnsafe(`INSERT INTO "WrikeTimeEntry" (id, "originFingerprint", "firstBatchId", "taskName", "projectName", "explicitState", "workDate", hours, minutes, fingerprint, "drvGroupId", "drvTicketId", "drvEligibility", "drvBucket", "updatedAt")
      SELECT 'w' || i, 'wo' || i, '${bid}', 't' || i, CASE WHEN i % 3 = 0 THEN 'Proyecto Vol' ELSE 'Otro proyecto' END, 'NONE', DATE '2025-01-01' + (i % 668), (15 + (i % 8) * 15)::numeric / 60, 15 + (i % 8) * 15, 'wf' || i,
        CASE WHEN i % 17 = 0 THEN NULL ELSE 'vg' || (1 + (i % ${g})) END, CASE WHEN i % 4 = 0 THEN (700000 + (i % 5000) + 1)::text END, CASE WHEN i % 29 = 0 THEN 'PENDING_ELIGIBILITY' ELSE 'ELIGIBLE' END, 'GROUP_ONLY', now() FROM generate_series(1, ${wr}) i`);
    await prisma.$executeRawUnsafe(`ANALYZE`);
    const seedS = (Date.now() - t0) / 1000;
    const base = { grupos: g, tiempos: TIMES, zendesk: zd, wrike: wr, sembradoS: seedS };

    const measure = async (label: string, fn: () => Promise<unknown>) => {
      const q0 = queries();
      const m0 = process.memoryUsage().rss;
      const t = Date.now();
      await fn();
      return { [label]: { s: (Date.now() - t) / 1000, consultas: queries() - q0, rssDeltaMb: Math.round((process.memoryUsage().rss - m0) / 1048576) } };
    };
    const all: Record<string, unknown> = { ...base };
    let result: Awaited<ReturnType<typeof runEconomics>> | undefined;
    Object.assign(all, await measure("cartera_soporte_todos_los_grupos", async () => { result = await runEconomics(admin.id, { scope: { type: "groups", ids: "ALL" }, service: "SOPORTE", date: "2026-10-15", pageSize: 50, now: new Date("2026-10-30T10:00:00Z") }); }));
    Object.assign(all, await measure("cartera_total", () => runEconomics(admin.id, { scope: { type: "groups", ids: "ALL" }, service: "TOTAL", date: "2026-10-31", mode: "FULL_MONTH", pageSize: 50 })));
    Object.assign(all, await measure("cartera_con_filtro_de_proyecto", () => runEconomics(admin.id, { scope: { type: "groups", ids: "ALL" }, service: "SOPORTE", date: "2026-10-15", filters: { projectName: "Proyecto Vol" }, pageSize: 50 })));
    Object.assign(all, await measure("un_grupo_con_serie_mensual", () => runEconomics(admin.id, { scope: { type: "groups", ids: ["vg7"] }, service: "SOPORTE", date: "2026-10-15" })));
    Object.assign(all, await measure("detalle_ingresos_pagina", () => listIncomeDetail(admin.id, { groupId: "vg9", pageSize: 25 })));
    Object.assign(all, await measure("detalle_horas_pagina", () => listHoursDetail(admin.id, { groupId: "vg9", from: "2026-01-01", to: "2026-10-15", pageSize: 25 })));
    // La cartera se calcula sobre el conjunto completo aunque solo se devuelva una página.
    expect(result!.totalEntities).toBe(g);
    expect(result!.entities).toHaveLength(50);
    expect(result!.portfolio!.cum.groupsWithIncome + result!.portfolio!.cum.groupsUnknownIncome).toBe(g);
    // Una pasada por tablas: el número de sentencias no depende del número de grupos ni de meses.
    const q = (all.cartera_soporte_todos_los_grupos as { consultas: number }).consultas;
    if (q >= 0) expect(q).toBeLessThan(40);
    // Sin multiplicación de horas: la suma de horas por periodos no supera la de la tabla.
    const tot = await prisma.$queryRaw<{ h: string }[]>`SELECT (sum(minutes)/60)::text AS h FROM "TimeActivity" WHERE "workDate" BETWEEN DATE '2026-01-01' AND DATE '2026-10-15' AND "isEligible" AND "groupId" IS NOT NULL`;
    const cumH = result!.portfolio!.cum.hours;
    expect(Number(cumH)).toBeLessThanOrEqual(Number(tot[0].h) + 1e-6);
    report(all);
  }, 1_800_000);
});
