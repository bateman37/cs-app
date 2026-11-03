import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { confirmUpload } from "@/server/uploads/batches";
import { readRows } from "@/server/uploads/readers";
import { readerLimits } from "@/server/uploads/config";
import { computeHistoricAnalysis } from "@/server/finance/historic";
import { getMatrix } from "@/server/usuarios";
import { listUsersBaseConflicts, resolveUsersBase } from "@/server/usuarios-base";
import { groupSearchKey } from "@/domain/finance";
import { batch, drain, freshEnvironment, removeUploadDir, uploadText, useUploadDir } from "./cargas-helpers";

/**
 * ENSAYO REAL (HOTFIX-01 §6-§7, §12): importa el libro privado «DATA FACTURACIÓN» en una base AISLADA (cs_app_ensayo_historico_test), con el motor
 * real: análisis, aplicación, repetición y comprobación de conteos/sumas/usuarios. Se salta si no hay archivo. El libro NUNCA va al repositorio:
 *
 *   HISTORICO_REAL_XLSX=/ruta/libro.xlsx HISTORICO_REAL_ESPERADO=/ruta/esperado.json [HISTORICO_REAL_INFORME=/tmp/informe.txt] \
 *   TEST_DATABASE_URL=postgresql://…/cs_app_ensayo_historico_test npx vitest run tests/historico-ensayo-real.test.ts
 *
 * `esperado.json` (fuera del repositorio) lo calcula una lectura independiente del XML del libro (sumas exactas por año+categoría); aquí solo se
 * versionan las cifras de control que el propio encargo publica (164 filas, 36/41/44/43, 11 administrativas, 43 valores/39 Grupos, 4 discrepancias).
 * Los Grupos del maestro se simulan con nombres anónimos («Grupo 001»…) y la equivalencia BC del libro; los dos últimos por clave quedan fuera del maestro.
 * El informe nominativo (si se pide) se escribe solo en la ruta indicada, nunca en el repositorio.
 */
const FILE = process.env.HISTORICO_REAL_XLSX;
const EXPECTED = process.env.HISTORICO_REAL_ESPERADO;
const REPORT = process.env.HISTORICO_REAL_INFORME ?? "/tmp/informe-ensayo-historico.txt";
const SHA = "d79f05cddafcb410103d83755ce4e47ea9064d9194a88388190082ae779f6628";
const NOW26 = new Date("2026-11-03T10:00:00Z");

let admin: { id: string };
let dir: string;
beforeAll(() => { dir = useUploadDir(); });
beforeEach(async () => { if (FILE) ({ admin } = await freshEnvironment()); });
afterAll(() => removeUploadDir(dir));

describe.skipIf(!FILE || !EXPECTED)("ensayo real del libro DATA FACTURACIÓN (base aislada)", () => {
  it("analiza, aplica, repite y concilia; usuarios 43 valores / 39 Grupos / 4 discrepancias", async () => {
    const file = readFileSync(FILE as string);
    expect(createHash("sha256").update(file).digest("hex")).toBe(SHA);
    const expected = JSON.parse(readFileSync(EXPECTED as string, "utf8")) as { scopes: Record<string, { rows: number; sum: string }>; total: string };
    const lines: string[] = [];
    const say = (s: string) => lines.push(s);

    // Maestro simulado: todas las claves del libro salvo las dos últimas, con nombre anónimo y la equivalencia BC del libro.
    const labels = new Map<string, string>();
    let header = true;
    for await (const r of readRows(FILE as string, { format: "xlsx", limits: readerLimits() })) {
      if (header) { header = false; continue; }
      const l = (r.cells[0]?.v ?? "").trim();
      if (l) labels.set(groupSearchKey(l), l);
    }
    const keys = [...labels.keys()].sort();
    expect(keys).toHaveLength(46);
    const outOfMaster = keys.slice(-2);
    let i = 0;
    const anon = new Map<string, string>();
    for (const k of keys.slice(0, -2)) {
      i++;
      const g = await prisma.clientGroup.create({ data: { name: `Grupo ${String(i).padStart(3, "0")}` } });
      await prisma.externalIdentity.create({ data: { system: "BC", kind: "GROUP_KEY", rawValue: labels.get(k) as string, searchValue: k, groupId: g.id } });
      anon.set(g.id, `Grupo ${String(i).padStart(3, "0")}`);
    }

    // 1) Análisis (sin aplicar).
    const up = await uploadText(admin.id, file, { profileId: "historico-economico", name: "DATA FACTURACIÓN.xlsx", metadata: {} });
    await drain();
    const p = await batch(up.id);
    expect(p.status).toBe("READY");
    expect(p.checksum).toBe(SHA);
    expect(p.rowsReceived).toBe(164);
    expect(p.rowsError).toBe(0);
    const a = (await computeHistoricAnalysis(prisma, p.id))!;
    expect(a.rowsValid).toBe(164);
    const byScope = new Map(a.scopes.map((s) => [`${s.year}|${s.category}`, s]));
    expect([...byScope.keys()].sort()).toEqual(Object.keys(expected.scopes).sort());
    for (const [k, e] of Object.entries(expected.scopes)) {
      expect(byScope.get(k)!.rows).toBe(e.rows);
      expect(byScope.get(k)!.total).toBe(e.sum);
    }
    expect([2022, 2023, 2024, 2025].map((y) => a.scopes.filter((s) => s.year === y).reduce((n, s) => n + s.rows, 0))).toEqual([36, 41, 44, 43]);
    expect(a.scopes.filter((s) => s.category === "ADMIN_DELEGADA").reduce((n, s) => n + s.rows, 0)).toBe(11);
    expect(a.total).toBe(expected.total);
    expect(a.groups.distinct).toBe(46);
    expect(a.groups.toCreate).toHaveLength(2);
    expect(a.groups.nameClash).toEqual([]);
    expect(a.controls.b6Cells).toEqual(["E164"]);
    expect(a.controls.serverErrorCells).toEqual(["G28", "G100"]);
    expect(a.users).toMatchObject({ values: 43, groupsWithValues: 39, fromFormula: ["H160"] });
    expect(a.users.discrepancies).toHaveLength(4);
    const pairs = a.users.discrepancies.map((d) => d.entries.map((e) => e.cell).sort().join("/")).sort();
    expect(pairs).toEqual(["H124/H165", "H132/H161", "H143/H162", "H152/H163"]);
    expect(a.blockers).toEqual([]);
    say(`Análisis: ${a.rowsValid} filas válidas; ámbitos ${a.scopes.length}; grupos ${a.groups.distinct} (a crear ${a.groups.toCreate.length}); usuarios ${a.users.values} valores / ${a.users.groupsWithValues} grupos / ${a.users.discrepancies.length} discrepancias.`);
    expect(await prisma.financeScope.count({ where: { activeBatchId: { not: null } } })).toBe(0);

    // 2) Aplicación.
    const confirmV = (await batch(p.id)).version;
    await confirmUpload(admin.id, p.id, { expectedVersion: confirmV });
    await drain();
    const done = await batch(p.id);
    expect(done.status).toBe("COMPLETED");
    expect(done.rowsImported).toBe(164);
    const applied = await prisma.$queryRaw<{ year: number; category: string; n: bigint; total: string }[]>`
      SELECT s.year, s.category, count(r.id) AS n, sum(r.income)::text AS total FROM "FinanceScope" s JOIN "FinanceRow" r ON r."batchId" = s."activeBatchId" GROUP BY 1, 2 ORDER BY 1, 2`;
    expect(applied).toHaveLength(8);
    for (const r of applied) {
      const e = expected.scopes[`${r.year}|${r.category}`];
      expect(Number(r.n)).toBe(e.rows);
      // Σ de lo aplicado (NUMERIC 20 decimales) = Σ exacta del texto del libro, normalizada.
      expect(r.total.replace(/\.?0+$/, "")).toBe(e.sum);
    }
    const unassigned = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "FinanceScope" s JOIN "FinanceRow" r ON r."batchId" = s."activeBatchId" WHERE r."groupId" IS NULL`;
    expect(Number(unassigned[0].n)).toBe(0);
    const created = await prisma.historicGroupOrigin.findMany();
    expect(created).toHaveLength(2);
    expect(created.map((c) => groupSearchKey(c.originalLabel)).sort()).toEqual(outOfMaster);
    expect(await prisma.client.count()).toBe(0);
    expect(await prisma.implementation.count()).toBe(0);
    const kids = await prisma.uploadBatch.findMany({ where: { profileId: { startsWith: "facturacion-" } } });
    expect(kids).toHaveLength(8);
    expect(kids.every((k) => k.checksum === SHA && k.status === "COMPLETED")).toBe(true);
    say(`Aplicación: 164 filas en 8 conjuntos; 8 lotes hijos con el SHA-256 del original; ${created.length} Grupos de procedencia histórica.`);

    // 3) Repetición: idempotente.
    const up2 = await uploadText(admin.id, file, { profileId: "historico-economico", name: "DATA FACTURACIÓN.xlsx", metadata: {} });
    await drain();
    const p2 = await batch(up2.id);
    expect(p2.status).toBe("READY");
    const a2 = (await computeHistoricAnalysis(prisma, p2.id))!;
    expect(a2.scopes.every((s) => s.outcome === "SIN_CAMBIOS")).toBe(true);
    await confirmUpload(admin.id, p2.id, { expectedVersion: (await batch(p2.id)).version });
    await drain();
    expect((await batch(p2.id)).status).toBe("COMPLETED");
    expect((await batch(p2.id)).rowsImported).toBe(0);
    expect(await prisma.uploadBatch.count({ where: { profileId: { startsWith: "facturacion-" } } })).toBe(8);
    const applied2 = await prisma.$queryRaw<{ total: string }[]>`SELECT sum(r.income)::text AS total FROM "FinanceScope" s JOIN "FinanceRow" r ON r."batchId" = s."activeBatchId"`;
    expect(applied2[0].total.replace(/\.?0+$/, "")).toBe(expected.total);
    say("Repetición: 8 conjuntos «sin cambios»; ningún lote nuevo; ingreso total idéntico (no se suma).");

    // 4) Usuarios.
    const bases = await prisma.historicUserBase.findMany();
    expect(bases).toHaveLength(43);
    expect(new Set(bases.map((b) => b.groupId)).size).toBe(39);
    const conflicts = await listUsersBaseConflicts(admin.id);
    expect(conflicts).toHaveLength(4);
    const m25 = await prisma.userMatrix.findMany({ where: { year: 2025, groupId: { not: null } }, include: { months: true } });
    expect(m25).toHaveLength(35);
    expect(m25.every((m) => m.months.length === 12 && new Set(m.months.map((x) => x.value)).size === 1 && m.months.every((x) => x.kind === "INITIAL"))).toBe(true);
    expect(await prisma.userMatrix.count({ where: { OR: [{ clientId: { not: null } }, { implementationId: { not: null } }] } })).toBe(0);
    expect(await prisma.userMatrix.count({ where: { year: 2026 } })).toBe(35);
    const est = await prisma.userMatrixMonth.count({ where: { kind: "ESTIMATED" } });
    expect(est).toBeGreaterThan(0);
    const conflictGroup = conflicts[0].groupId;
    expect((await getMatrix(admin.id, { type: "group", id: conflictGroup }, 2025, { now: NOW26 })).months.every((x) => x.value === null)).toBe(true);
    say(`Usuarios: ${bases.length} valores / 39 Grupos; ${m25.length} Grupos inicializados (12 meses iguales), 4 en discrepancia sin denominador; ${est} meses estimados 2022–2024; matrices solo de Grupo.`);
    // Resolución explícita de una discrepancia.
    const c0 = conflicts[0];
    await resolveUsersBase(admin.id, { groupId: c0.groupId, category: c0.entries[0].category as "SOPORTE" | "ADMIN_DELEGADA", reason: "Ensayo" });
    expect(await listUsersBaseConflicts(admin.id)).toHaveLength(3);
    expect((await getMatrix(admin.id, { type: "group", id: c0.groupId }, 2025, { now: NOW26 })).months.every((x) => x.value === c0.entries[0].value)).toBe(true);
    say("Resolución explícita de 1 discrepancia: inicializa 2025 (12 meses), 2026 y estimados; quedan 3 pendientes.");

    // Informe: solo cifras seguras + (en la ruta indicada, fuera del repositorio) la identificación nominativa de lo señalado.
    lines.push("", "== NOMINATIVO (solo informe privado) ==");
    for (const d of a.users.discrepancies) lines.push(`Discrepancia ${d.label}: ${d.entries.map((e) => `${e.category} ${e.value} (${e.cell})`).join(" / ")}`);
    for (const c of created) lines.push(`Grupo de procedencia histórica: ${c.originalLabel}`);
    writeFileSync(REPORT, lines.join("\n") + "\n");
  }, 600_000);
});
