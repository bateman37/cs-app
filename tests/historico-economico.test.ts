import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AccessError } from "@/lib/access";
import { DomainError } from "@/server/errors";
import { confirmUpload, getUpload, revertUpload } from "@/server/uploads/batches";
import { filePath } from "@/server/uploads/storage";
import { computeHistoricAnalysis } from "@/server/finance/historic";
import { confirmMatrixChange, getMatrix } from "@/server/usuarios";
import { listUsersBaseConflicts, resolveUsersBase } from "@/server/usuarios-base";
import { runEconomics } from "@/server/economics/engine";
import { parseHistoricRow, mapHistoricHeaders, planHistoric, type HistCell, type HistContext } from "@/domain/finance-history";
import { batch, drain, freshEnvironment, removeUploadDir, uploadText, useUploadDir } from "./cargas-helpers";
import { importFin, scopeOf } from "./finanzas-helpers";
import { HIST_HEADERS, SYN, historicoXlsx, type HistRow } from "./generators/historico";

const PROFILE = "historico-economico";
let admin: { id: string };
let reader: { id: string };
let dir: string;
beforeAll(() => { dir = useUploadDir(); });
beforeEach(async () => { ({ admin, reader } = await freshEnvironment()); });
afterAll(() => removeUploadDir(dir));

const NOW26 = new Date("2026-10-15T10:00:00Z");
const NOW27 = new Date("2027-03-10T10:00:00Z");
const NOW28 = new Date("2028-03-10T10:00:00Z");

/** Maestro: los Grupos A, B y C con su equivalencia BC; X e Y no existen (se crearán como procedencia histórica). */
async function master() {
  const out: Record<string, { id: string }> = {};
  for (const n of ["Grupo A", "Grupo B", "Grupo C"]) {
    const g = await prisma.clientGroup.create({ data: { name: n, bcDenomination: n } });
    await prisma.externalIdentity.create({ data: { system: "BC", kind: "GROUP_KEY", rawValue: n, searchValue: n.toLowerCase(), groupId: g.id } });
    out[n] = g;
  }
  return out;
}

async function prepare(rows: HistRow[] = SYN, opts: Parameters<typeof historicoXlsx>[1] = {}) {
  const file = await historicoXlsx(rows, opts);
  const { id } = await uploadText(admin.id, file, { profileId: PROFILE, name: "libro.xlsx", metadata: {} });
  await drain();
  return batch(id);
}
async function confirm(id: string) {
  const cur = await batch(id);
  await confirmUpload(admin.id, id, { expectedVersion: cur.version });
  await drain();
  return batch(id);
}
async function importAll(rows: HistRow[] = SYN) {
  const p = await prepare(rows);
  if (p.status !== "READY") throw new Error(`Lote en ${p.status}: ${p.statusDetail ?? ""}`);
  const done = await confirm(p.id);
  if (done.status !== "COMPLETED") throw new Error(`Activación en ${done.status}: ${done.statusDetail ?? done.phase ?? ""}`);
  return done;
}

async function activeSet(cat: string, year: number) {
  return prisma.$queryRaw<{ label: string; income: string; original: string | null; groupId: string | null; resolution: string }[]>`
    SELECT r."groupLabel" AS label, trim_scale(r.income)::text AS income, r."incomeOriginal" AS original, r."groupId", r.resolution
    FROM "FinanceScope" s JOIN "FinanceRow" r ON r."batchId" = s."activeBatchId" WHERE s.year = ${year} AND s.category = ${cat} ORDER BY r.position`;
}
async function sumOf(cat: string, year: number) {
  const r = await prisma.$queryRaw<{ t: string | null }[]>`SELECT trim_scale(sum(r.income))::text AS t FROM "FinanceScope" s JOIN "FinanceRow" r ON r."batchId" = s."activeBatchId" WHERE s.year = ${year} AND s.category = ${cat}`;
  return r[0]?.t ?? null;
}

// Resultados esperados escritos a mano (no calculados con el código bajo prueba).
const EXPECTED: [number, string, number, string][] = [
  [2022, "ADMIN_DELEGADA", 1, "500"], [2022, "SOPORTE", 3, "6000.35"],
  [2023, "ADMIN_DELEGADA", 2, "1300"], [2023, "SOPORTE", 3, "3600.85"],
  [2024, "ADMIN_DELEGADA", 1, "650"], [2024, "SOPORTE", 2, "2000.1"],
  [2025, "ADMIN_DELEGADA", 2, "1700"], [2025, "SOPORTE", 4, "7350.3"],
];

// ---------------------------------------------------------------------------------------------- Dominio (sin base de datos)

describe("lectura de una fila del libro (dominio)", () => {
  const ctx = (mapHistoricHeaders(HIST_HEADERS) as { ok: true; context: HistContext }).context;
  const t = (v: string, k = "text", f = false): HistCell => ({ v, k, ...(f ? { f: true } : {}) });
  const n = (v: string, f = false): HistCell => t(v, "number", f);
  const row = (o: { g?: string; b?: string; y?: string; d?: string; e?: string; f?: string; srv?: HistCell; h?: HistCell }) => [
    t(o.g ?? "G1"), n(o.b ?? "100"), n(o.y ?? "2025"), o.d === undefined ? t("Gold") : t(o.d, o.d === "" ? "empty" : "text"), n(o.e ?? "8.333333", true), n(o.f ?? "0", true), o.srv ?? t("Cloud"), o.h ?? ({ v: "", k: "empty" } as HistCell),
  ];

  it("D = Admin Delegada o F = 1 coherentes son administrativas, no ambiguas; el resto con F = 0 es Soporte con su etiqueta original", () => {
    const a = parseHistoricRow(row({ d: "Admin Delegada", f: "1" }), ctx);
    expect(a.kind === "ROW" && a.typed.category).toBe("ADMIN_DELEGADA");
    const b = parseHistoricRow(row({ d: "", f: "1" }), ctx);
    expect(b.kind === "ROW" && b.typed.category).toBe("ADMIN_DELEGADA");
    for (const d of ["Gold", "Platinum", "Silver"]) {
      const r = parseHistoricRow(row({ d }), ctx);
      expect(r.kind === "ROW" && [r.typed.category, r.typed.supportLabel]).toEqual(["SOPORTE", d]);
    }
  });
  it("contradicciones y categoría ausente son errores, no se inventan", () => {
    const code = (o: Parameters<typeof row>[0]) => {
      const r = parseHistoricRow(row(o), ctx);
      return r.kind === "ERROR" ? r.issues.map((i) => i.code) : ["OK"];
    };
    expect(code({ d: "Admin Delegada", f: "0" })).toContain("CATEGORIA_INCOHERENTE");
    expect(code({ d: "Gold", f: "1" })).toContain("CATEGORIA_AMBIGUA");
    expect(code({ d: "", f: "0" })).toContain("CATEGORIA_NO_EXPLICITA");
    expect(code({ y: "20x5" })).toContain("ANIO_ILEGIBLE");
    expect(code({ b: "" })).toContain("IMPORTE_VACIO");
  });
  it("B conserva la precisión decimal; E es una referencia y B/6 se señala sin deducir nada", () => {
    const r = parseHistoricRow(row({ b: "1234.5678901234", e: "205.7613150206" }), ctx);
    expect(r.kind === "ROW" && r.typed.amount).toBe("1234.5678901234");
    const six = parseHistoricRow(row({ b: "1542", e: "257" }), ctx);
    expect(six.kind === "ROW" && [six.typed.monthlyRefKind, six.issues.map((i) => i.code)]).toEqual(["B6", ["REFERENCIA_B_ENTRE_6"]]);
    const twelve = parseHistoricRow(row({ b: "1200", e: "100" }), ctx);
    expect(twelve.kind === "ROW" && twelve.typed.monthlyRefKind).toBe("B12");
  });
  it("G con #N/A se conserva como error de búsqueda y no descarta la fila; usuarios enteros ≥ 0, fórmula con valor almacenado", () => {
    const g = parseHistoricRow(row({ srv: t("#N/A", "error", true) }), ctx);
    expect(g.kind === "ROW" && [g.typed.serverStatus, g.typed.server]).toEqual(["ERROR", "#N/A"]);
    const f = parseHistoricRow(row({ h: n("1538", true) }), ctx);
    expect(f.kind === "ROW" && [f.typed.users, f.typed.usersFormula]).toEqual([1538, true]);
    for (const bad of ["-3", "2.5", "abc"]) {
      const r = parseHistoricRow(row({ h: n(bad) }), ctx);
      expect(r.kind === "ERROR" && r.issues[0].code).toBe("USUARIOS_ILEGIBLES");
    }
    // Usuarios fuera del año base: aviso y no se usan.
    const o = parseHistoricRow(row({ y: "2024", h: n("10") }), ctx);
    expect(o.kind === "ROW" && [o.typed.users, o.issues.map((i) => i.code)]).toEqual([null, ["USUARIOS_FUERA_DE_BASE"]]);
  });
  it("planificación por año+categoría: Grupos en dos categorías no suman usuarios y los valores distintos son discrepancia", () => {
    const rows = [
      ["Grupo A", "1", 2025, "Gold", 10, 1],
      ["Grupo A", "2", 2025, "Admin Delegada", 10, 2],
      ["Grupo B", "3", 2025, "Gold", 5, 3],
      ["Grupo B", "4", 2025, "Admin Delegada", 7, 4],
    ].map(([g, b, y, d, h, sr]) => {
      const r = parseHistoricRow(row({ g: g as string, b: b as string, y: String(y), d: d as string, f: String(/^Admin/.test(d as string) ? 1 : 0), h: n(String(h)) }), ctx);
      if (r.kind !== "ROW") throw new Error("fila inválida");
      return { typed: r.typed, label: r.label, sourceRow: sr as number, amountOriginal: r.amountOriginal };
    });
    const plan = planHistoric(rows);
    expect(plan.scopes.map((s) => `${s.category} ${s.rows.length} ${s.total.toString()}`)).toEqual(["ADMIN_DELEGADA 2 6", "SOPORTE 2 4"]);
    expect(plan.users.map((u) => [u.key, u.status, u.distinctValues])).toEqual([["grupo a", "UNICA", [10]], ["grupo b", "DISCREPANCIA", [5, 7]]]);
  });
});

// ---------------------------------------------------------------------------------------------- Importación completa

describe("libro sintético: análisis, activación atómica y conciliación", () => {
  it("prepara con resumen por año+categoría, impacto y controles antes de confirmar", async () => {
    await master();
    const p = await prepare();
    expect(p.status).toBe("READY");
    expect(p.rowsError).toBe(0);
    const a = (await computeHistoricAnalysis(prisma, p.id))!;
    expect(a.rowsValid).toBe(18);
    expect(a.scopes.map((s) => [s.year, s.category, s.rows, s.total])).toEqual(EXPECTED.map(([y, c, n, t]) => [y, c, n, t]));
    expect(a.total).toBe("23101.6");
    expect(a.scopes.every((s) => s.outcome === "NUEVO" && s.current === null)).toBe(true);
    expect(a.groups.distinct).toBe(5);
    expect(a.groups.inMaster).toBe(3);
    expect(a.groups.toCreate.map((g) => g.label).sort()).toEqual(["Grupo X", "Grupo Y"]);
    expect(a.controls.b6Cells).toEqual(["E16"]);
    expect(a.controls.serverErrorCells).toEqual(["G4", "G12"]);
    expect(a.users).toMatchObject({ groupsWithValues: 3, values: 5, unique: 2, fromFormula: ["H16"] });
    expect(a.users.discrepancies).toHaveLength(1);
    expect(a.users.discrepancies[0].entries.map((e) => [e.category, e.value, e.cell])).toEqual([["SOPORTE", 59, "H15"], ["ADMIN_DELEGADA", 87, "H18"]]);
    expect(a.blockers).toEqual([]);
    // Nada se activa antes de confirmar.
    expect(await prisma.financeScope.count({ where: { activeBatchId: { not: null } } })).toBe(0);
    expect(await prisma.clientGroup.count()).toBe(3);
  });

  it("confirmar aplica los ocho conjuntos a la vez; conserva B exacto, no suma E ni G, y concilia sumas y filas", async () => {
    const m = await master();
    const done = await importAll();
    expect(done.rowsImported).toBe(18);
    for (const [y, c, n, t] of EXPECTED) {
      const rows = await activeSet(c, y);
      expect(rows).toHaveLength(n);
      expect(await sumOf(c, y)).toBe(t);
    }
    // Precisión: el texto original de B se conserva tal cual.
    expect((await activeSet("SOPORTE", 2025)).map((r) => r.original)).toEqual(["1300", "2300.30", "3300", "450"]);
    // Todos los Grupos atribuidos (los dos nuevos también); ningún ingreso sin asignar.
    const all = [...(await activeSet("SOPORTE", 2023)), ...(await activeSet("SOPORTE", 2024))];
    expect(all.every((r) => r.groupId !== null && r.resolution === "RESOLVED")).toBe(true);
    expect((await activeSet("ADMIN_DELEGADA", 2023)).map((r) => r.groupId)).toEqual([m["Grupo A"].id, m["Grupo B"].id]);
    // La referencia E (incluida la excepción B/6 de la fila 16) no se suma: el ingreso 2025 es la suma de B.
    expect(await sumOf("SOPORTE", 2025)).toBe("7350.3");
    // Lotes hijos: uno por año+categoría, mismo checksum que el original, sin rutas inventadas.
    const kids = await prisma.uploadBatch.findMany({ where: { profileId: { startsWith: "facturacion-" } } });
    expect(kids).toHaveLength(8);
    for (const k of kids) {
      expect(k.status).toBe("COMPLETED");
      expect(k.checksum).toBe(done.checksum);
      expect((k.metadata as { loteOrigenId?: string }).loteOrigenId).toBe(done.id);
      const sha = createHash("sha256").update(readFileSync(filePath(k.storageId))).digest("hex");
      expect(sha).toBe(done.checksum);
    }
    expect(createHash("sha256").update(readFileSync(filePath(done.storageId))).digest("hex")).toBe(done.checksum);
    const fb = await prisma.financeBatch.findMany({ where: { batchId: { in: kids.map((k) => k.id) } } });
    expect(fb.every((x) => x.origin === "HISTORICAL")).toBe(true);
    const h = (fb.find((x) => x.year === 2025 && x.category === "SOPORTE")!.controls as { historic: { rows: { sourceRow: number; supportLabel: string; subtype: unknown; monthlyRefKind: string }[]; annualTotal: string } }).historic;
    expect(h.annualTotal).toBe("7350.3");
    expect(h.rows.map((r) => [r.sourceRow, r.supportLabel, r.subtype, r.monthlyRefKind])).toEqual([[14, "Gold", null, "B12"], [15, "Silver", null, "B12"], [16, "Platinum", null, "B6"], [19, "Gold", null, "B12"]]);
    // G #N/A conservado como no informado, ingreso intacto.
    const f22 = (fb.find((x) => x.year === 2022 && x.category === "SOPORTE")!.controls as { historic: { rows: { label: string; serverStatus: string; server: string }[] } }).historic.rows;
    expect(f22.find((r) => r.label === "Grupo C")).toMatchObject({ serverStatus: "ERROR", server: "#N/A" });
    expect(await sumOf("SOPORTE", 2022)).toBe("6000.35");
    // Plan, alojamiento y servicio del maestro no se tocan.
    expect(await prisma.serviceTerm.count()).toBe(0);
    // La carga del libro queda COMPLETED y concilia en su ficha.
    const up = (await getUpload(admin.id, done.id))!;
    expect(up.actions.revert.allowed).toBe(true);
    const child = (await getUpload(admin.id, kids[0].id))!;
    expect(child.actions.revert.allowed).toBe(false);
    await expect(revertUpload(admin.id, kids[0].id)).rejects.toBeInstanceOf(DomainError);
  });

  it("los Grupos ausentes del maestro se crean como procedencia histórica, sin Cliente, identidades de Zendesk, implantaciones ni usuarios", async () => {
    await master();
    await importAll();
    const origin = await prisma.historicGroupOrigin.findMany({ orderBy: { originalLabel: "asc" } });
    expect(origin.map((o) => o.originalLabel)).toEqual(["Grupo X", "Grupo Y"]);
    for (const o of origin) {
      const g = await prisma.clientGroup.findUniqueOrThrow({ where: { id: o.groupId }, include: { identities: true, clients: true, userMatrices: true } });
      expect(g.clients).toHaveLength(0);
      expect(g.identities.map((i) => [i.system, i.kind])).toEqual([["BC", "GROUP_KEY"]]);
      expect(g.userMatrices).toHaveLength(0);
    }
    expect(await prisma.implementation.count()).toBe(0);
    expect(await prisma.client.count()).toBe(0);
    // El ingreso de esos Grupos sí está atribuido.
    const x25 = (await activeSet("SOPORTE", 2025)).find((r) => r.label === "Grupo X")!;
    expect(x25).toMatchObject({ income: "450", resolution: "RESOLVED" });
    expect(x25.groupId).toBe(origin.find((o) => o.originalLabel === "Grupo X")!.groupId);
  });

  it("repetir la carga no suma ingresos ni crea lotes (idempotente); un archivo cambiado sustituye solo lo que cambia", async () => {
    await master();
    const first = await importAll();
    const before = await prisma.financeScope.findMany({ orderBy: [{ year: "asc" }, { category: "asc" }] });
    const second = await importAll();
    expect(second.rowsImported).toBe(0);
    const a = (await computeHistoricAnalysis(prisma, second.id))!;
    expect(a.scopes.every((s) => s.outcome === "SIN_CAMBIOS")).toBe(true);
    expect(await prisma.uploadBatch.count({ where: { profileId: { startsWith: "facturacion-" } } })).toBe(8);
    const after = await prisma.financeScope.findMany({ orderBy: [{ year: "asc" }, { category: "asc" }] });
    expect(after.map((s) => [s.activeBatchId, s.version])).toEqual(before.map((s) => [s.activeBatchId, s.version]));
    for (const [y, c, , t] of EXPECTED) expect(await sumOf(c, y)).toBe(t);
    // El libro anterior queda sustituido como registro; el nuevo es el vigente.
    expect((await batch(first.id)).supersededByBatchId).toBe(second.id);
    // Un cambio de importe en 2024 Soporte reescribe únicamente ese ámbito.
    const changed = SYN.map((r) => (r.g === "Grupo Y" ? { ...r, b: "810" } : r));
    const third = await importAll(changed);
    expect(third.rowsImported).toBe(2);
    expect(await sumOf("SOPORTE", 2024)).toBe("2010.1");
    expect(await prisma.uploadBatch.count({ where: { profileId: { startsWith: "facturacion-" }, status: "COMPLETED" } })).toBe(9);
    for (const [y, c, , t] of EXPECTED.filter(([y2, c2]) => !(y2 === 2024 && c2 === "SOPORTE"))) expect(await sumOf(c, y)).toBe(t);
  });

  it("con 2025 ya cargado la sustitución es explícita en el resumen; años y categorías ausentes (OTROS, 2026) quedan intactos", async () => {
    await master();
    await importFin(admin.id, "SOPORTE", 2025, [{ grupo: "Grupo A", vta: 5 }], { total: { vta: 5 } });
    await importFin(admin.id, "OTROS", 2025, [{ grupo: "Grupo A", vta: 7 }], { total: { vta: 7 } });
    await importFin(admin.id, "SOPORTE", 2026, [{ grupo: "Grupo A", vta: 9 }], { total: { vta: 9 } });
    const keep = async () => JSON.stringify([await scopeOf("OTROS", 2025), await scopeOf("SOPORTE", 2026)]);
    const untouched = await keep();
    const prevActive = (await scopeOf("SOPORTE", 2025))!.activeBatchId!;
    const p = await prepare();
    const a = (await computeHistoricAnalysis(prisma, p.id))!;
    const s25 = a.scopes.find((s) => s.year === 2025 && s.category === "SOPORTE")!;
    expect(s25).toMatchObject({ outcome: "SUSTITUYE", difference: "7345.3" });
    expect(s25.current).toMatchObject({ batchId: prevActive, total: "5", rows: 1 });
    expect(a.scopes.filter((s) => s.outcome === "SUSTITUYE")).toHaveLength(1);
    const done = await confirm(p.id);
    expect(done.status).toBe("COMPLETED");
    expect(await sumOf("SOPORTE", 2025)).toBe("7350.3");
    expect((await batch(prevActive)).supersededByBatchId).not.toBeNull();
    expect(await keep()).toBe(untouched);
    expect(await sumOf("OTROS", 2025)).toBe("7");
    expect(await sumOf("SOPORTE", 2026)).toBe("9");
  });

  it("un cambio de los conjuntos tras la preparación bloquea confirmar y la activación hasta actualizar el impacto", async () => {
    await master();
    const p = await prepare();
    await importFin(admin.id, "SOPORTE", 2024, [{ grupo: "Grupo A", vta: 1 }], { total: { vta: 1 } });
    const a = (await computeHistoricAnalysis(prisma, p.id))!;
    expect(a.stamp.stale).toBe(true);
    await expect(confirmUpload(admin.id, p.id)).rejects.toBeInstanceOf(DomainError);
    const { reprocessUpload } = await import("@/server/uploads/batches");
    await reprocessUpload(admin.id, p.id);
    await drain();
    const again = (await computeHistoricAnalysis(prisma, p.id))!;
    expect(again.stamp.stale).toBe(false);
    expect(again.scopes.find((s) => s.year === 2024 && s.category === "SOPORTE")!.outcome).toBe("SUSTITUYE");
    expect((await confirm(p.id)).status).toBe("COMPLETED");
  });

  it("la unidad de confirmación es el libro: si un conjunto falla no se activa ninguno, ni Grupos ni usuarios", async () => {
    await master();
    const p = await prepare();
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION hist_fail() RETURNS trigger AS $$ BEGIN IF NEW.year = 2025 AND NEW.category = 'ADMIN_DELEGADA' THEN RAISE EXCEPTION 'fallo simulado'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER hist_fail_trg BEFORE UPDATE ON "FinanceScope" FOR EACH ROW EXECUTE FUNCTION hist_fail()`);
    try {
      const cur = await batch(p.id);
      await confirmUpload(admin.id, p.id, { expectedVersion: cur.version });
      await drain();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS hist_fail_trg ON "FinanceScope"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS hist_fail()`);
    }
    expect((await batch(p.id)).status).not.toBe("COMPLETED");
    expect(await prisma.financeScope.count({ where: { activeBatchId: { not: null } } })).toBe(0);
    expect(await prisma.uploadBatch.count({ where: { profileId: { startsWith: "facturacion-" } } })).toBe(0);
    expect(await prisma.historicGroupOrigin.count()).toBe(0);
    expect(await prisma.clientGroup.count()).toBe(3);
    expect(await prisma.userMatrix.count()).toBe(0);
    expect(await prisma.historicUserBase.count()).toBe(0);
  });

  it("revertir el libro restaura cada conjunto anterior; no se revierte si una carga posterior ya sustituyó alguno", async () => {
    await master();
    await importFin(admin.id, "SOPORTE", 2025, [{ grupo: "Grupo A", vta: 5 }], { total: { vta: 5 } });
    const done = await importAll();
    expect(await sumOf("SOPORTE", 2025)).toBe("7350.3");
    // Una carga financiera posterior sustituye 2024 Soporte: revertir el libro queda bloqueado y no cambia nada.
    await importFin(admin.id, "SOPORTE", 2024, [{ grupo: "Grupo A", vta: 3 }], { total: { vta: 3 } });
    await revertUpload(admin.id, done.id);
    await drain();
    expect((await batch(done.id)).status).toBe("COMPLETED");
    expect(await sumOf("SOPORTE", 2025)).toBe("7350.3");
    expect(await sumOf("SOPORTE", 2024)).toBe("3");
  });
  it("revertir el libro (sin cargas posteriores) restaura el conjunto anterior de 2025 y vacía los nuevos", async () => {
    await master();
    await importFin(admin.id, "SOPORTE", 2025, [{ grupo: "Grupo A", vta: 5 }], { total: { vta: 5 } });
    const prev = (await scopeOf("SOPORTE", 2025))!.activeBatchId!;
    const done = await importAll();
    await revertUpload(admin.id, done.id);
    await drain();
    expect((await batch(done.id)).status).toBe("REVERTED");
    expect((await scopeOf("SOPORTE", 2025))!.activeBatchId).toBe(prev);
    expect((await batch(prev)).supersededByBatchId).toBeNull();
    expect(await sumOf("SOPORTE", 2025)).toBe("5");
    expect(await sumOf("SOPORTE", 2022)).toBeNull();
    // Los Grupos de procedencia histórica y las matrices de usuarios no se borran al revertir.
    expect(await prisma.historicGroupOrigin.count()).toBe(2);
  });

  it("errores de categoría, importes o conflictos bloquean la confirmación; solo un Administrador sube y confirma", async () => {
    await master();
    const bad = [...SYN, { g: "Grupo Z", b: "10", y: 2025, d: "Gold", f: 1 as const }];
    const p = await prepare(bad);
    expect(p.status).toBe("READY");
    expect(p.rowsError).toBe(1);
    await expect(confirmUpload(admin.id, p.id)).rejects.toBeInstanceOf(DomainError);
    // Mismo Grupo+año+categoría con importes distintos: conflicto sobre ambas filas.
    const dup = await prepare([...SYN, { g: "Grupo A", b: "999", y: 2025, d: "Gold" }]);
    expect(dup.rowsError).toBeGreaterThanOrEqual(2);
    // Una repetición idéntica cuenta una vez.
    const same = await prepare([...SYN, SYN[12]]);
    expect(same.rowsError).toBe(0);
    expect((await computeHistoricAnalysis(prisma, same.id))!.rowsValid).toBe(18);
    // Consulta no sube ni confirma.
    const file = await historicoXlsx(SYN);
    await expect(uploadText(reader.id, file, { profileId: PROFILE, name: "libro.xlsx", metadata: {} })).rejects.toBeInstanceOf(AccessError);
    await expect(confirmUpload(reader.id, same.id)).rejects.toBeInstanceOf(AccessError);
  });

  it("un libro sin las cabeceras esperadas se rechaza; la cabecera «Año » con espacio final es válida", async () => {
    const file = await historicoXlsx(SYN, { headers: ["Grupo cliente", "Importe", "Año", "Soporte", "Facturación mes", "Admin Delegada", "Servidor", "Usuarios"] });
    const { id } = await uploadText(admin.id, file, { profileId: PROFILE, name: "libro.xlsx", metadata: {} });
    await drain();
    expect((await batch(id)).status).toBe("REJECTED");
    expect((await prepare()).status).toBe("READY");
  });

  it("un Grupo existente con ese nombre pero sin equivalencia BC bloquea la confirmación en lugar de duplicarse", async () => {
    await master();
    await prisma.clientGroup.create({ data: { name: "GRUPO X" } });
    const p = await prepare();
    const a = (await computeHistoricAnalysis(prisma, p.id))!;
    expect(a.groups.nameClash).toEqual(["Grupo X"]);
    await expect(confirmUpload(admin.id, p.id)).rejects.toBeInstanceOf(DomainError);
  });

  it("el motor económico lee el histórico como conjunto sin cobertura confirmada (la ausencia no acredita cero)", async () => {
    const m = await master();
    await importAll();
    const r = await runEconomics(admin.id, { scope: { type: "groups", ids: [m["Grupo A"].id] }, service: "SOPORTE", date: "2025-12-31", mode: "FULL_MONTH", now: NOW26 });
    expect(Number(r.entities[0].periods.month.revenue.value)).toBeCloseTo(1300 / 12, 6);
    expect(r.reference.finance.find((f) => f.year === 2025 && f.category === "SOPORTE")?.coverage).toBe("NO_CONFIRMADA");
  });
});

// ---------------------------------------------------------------------------------------------- Usuarios

const matrixOf = (groupId: string, year: number) => prisma.userMatrix.findFirst({ where: { groupId, year }, include: { months: { orderBy: { month: "asc" } } } });

describe("usuarios 2025 y su continuidad", () => {
  it("inicializa los doce meses de 2025, 2026 desde la base y 2022–2024 como estimados solo donde el Grupo existe; B queda sin informar", async () => {
    const m = await master();
    await importAll();
    const A = m["Grupo A"].id;
    const C = m["Grupo C"].id;
    const a25 = await matrixOf(A, 2025);
    expect(a25!.months.map((x) => [x.value, x.kind, x.isLocked])).toEqual(Array.from({ length: 12 }, () => [100, "INITIAL", false]));
    // Los doce meses con el mismo número: 12 × 100 es una condición inicial, no 1200 usuarios.
    expect((await matrixOf(A, 2026))!.months.map((x) => [x.value, x.kind])).toEqual(Array.from({ length: 12 }, () => [100, "COPIED"]));
    for (const y of [2022, 2023, 2024]) {
      const mt = await matrixOf(A, y);
      expect(mt!.months.every((x) => x.value === 100 && x.kind === "ESTIMATED" && x.source === "Estimado a partir de 2025")).toBe(true);
    }
    // C: H es una fórmula con resultado almacenado (40); solo existió en 2022.
    expect((await matrixOf(C, 2025))!.months.every((x) => x.value === 40 && x.kind === "INITIAL")).toBe(true);
    expect((await matrixOf(C, 2022))!.months.every((x) => x.value === 40 && x.kind === "ESTIMATED")).toBe(true);
    expect(await matrixOf(C, 2023)).toBeNull();
    expect(await matrixOf(C, 2024)).toBeNull();
    // B en discrepancia: sin matriz (denominador pendiente, jamás cero); X e Y sin usuarios.
    const B = m["Grupo B"].id;
    expect(await prisma.userMatrix.count({ where: { groupId: B } })).toBe(0);
    const bm = await getMatrix(admin.id, { type: "group", id: B }, 2025, { now: NOW26 });
    expect(bm.months.every((x) => x.value === null)).toBe(true);
    expect(await prisma.userMatrix.count()).toBe(5 + 3); // A: 2025, 2026, 2022–2024; C: 2025, 2026, 2022 (solo matrices de Grupo)
    expect(await prisma.userMatrix.count({ where: { OR: [{ clientId: { not: null } }, { implementationId: { not: null } }] } })).toBe(0);
    // No se suman las filas: A figura en Soporte y Administración y vale 100, no 200.
    expect((await prisma.historicUserBase.findMany({ where: { groupId: A } })).map((x) => [x.category, x.value, x.sourceCell]).sort()).toEqual([["ADMIN_DELEGADA", 100, "H17"], ["SOPORTE", 100, "H14"]]);
  });

  it("las cuatro discrepancias son análogas: ambos valores y celdas se conservan, se listan y solo se resuelven por elección explícita", async () => {
    const m = await master();
    await importAll();
    const B = m["Grupo B"].id;
    const list = await listUsersBaseConflicts(admin.id);
    expect(list.map((c) => c.name)).toEqual(["Grupo B"]);
    expect(list[0].entries).toEqual([{ category: "ADMIN_DELEGADA", value: 87, cell: "H18" }, { category: "SOPORTE", value: 59, cell: "H15" }]);
    await expect(resolveUsersBase(reader.id, { groupId: B, category: "SOPORTE" })).rejects.toBeInstanceOf(AccessError);
    await expect(resolveUsersBase(admin.id, { groupId: B })).rejects.toBeInstanceOf(DomainError); // sin elección: no hay máximo/suma/último
    await resolveUsersBase(admin.id, { groupId: B, category: "SOPORTE", reason: "Confirmado con el cliente" });
    expect((await matrixOf(B, 2025))!.months.every((x) => x.value === 59 && x.kind === "INITIAL")).toBe(true);
    expect((await matrixOf(B, 2026))!.months.every((x) => x.value === 59 && x.kind === "COPIED")).toBe(true);
    expect((await matrixOf(B, 2022))!.months.every((x) => x.value === 59 && x.kind === "ESTIMATED")).toBe(true);
    expect((await matrixOf(B, 2023))!.months.every((x) => x.value === 59 && x.kind === "ESTIMATED")).toBe(true);
    expect(await matrixOf(B, 2024)).toBeNull(); // B no existe en 2024
    expect(await listUsersBaseConflicts(admin.id)).toEqual([]);
    await expect(resolveUsersBase(admin.id, { groupId: B, category: "ADMIN_DELEGADA" })).rejects.toBeInstanceOf(DomainError);
  });

  it("una recarga no revierte ajustes manuales ni pisa valores ya informados; 2026 editado se conserva", async () => {
    const m = await master();
    await importAll();
    const A = m["Grupo A"].id;
    const t = { targetType: "group", targetId: A };
    const v25 = (await getMatrix(admin.id, { type: "group", id: A }, 2025, { now: NOW26 })).version;
    await confirmMatrixChange(admin.id, { ...t, year: 2025, op: "SET_MONTH", month: 3, value: 105, expectedVersion: v25 }, { now: NOW26 });
    const v26 = (await getMatrix(admin.id, { type: "group", id: A }, 2026, { now: NOW26 })).version;
    await confirmMatrixChange(admin.id, { ...t, year: 2026, op: "APPLY_FROM", month: 5, value: 99, expectedVersion: v26 }, { now: NOW26 });
    // Recarga con un valor de usuarios distinto para A en el libro: no cambia nada ya informado.
    const reload = SYN.map((r) => (r.g === "Grupo A" && r.y === 2025 ? { ...r, h: 120 } : r));
    await importAll(reload);
    const a25 = (await matrixOf(A, 2025))!.months.map((x) => [x.value, x.kind]);
    expect(a25[2]).toEqual([105, "ADJUSTED"]);
    expect(a25.filter((_, i) => i !== 2).every(([v, k]) => v === 100 && k === "INITIAL")).toBe(true);
    const a26 = (await matrixOf(A, 2026))!.months.map((x) => x.value);
    expect(a26).toEqual([100, 100, 100, 100, 99, 99, 99, 99, 99, 99, 99, 99]);
    // Un nuevo Grupo del mismo libro sigue sin pisar nada: B sigue pendiente (valores 59/87 sin elección).
    expect((await listUsersBaseConflicts(admin.id)).map((c) => c.name)).toEqual(["Grupo B"]);
  });
});

describe("política de edición: año actual y año anterior (Europe/Madrid, reloj del servidor)", () => {
  async function seeded() {
    const m = await master();
    await importAll();
    return { id: m["Grupo A"].id, t: { targetType: "group", targetId: m["Grupo A"].id } };
  }
  const edit = (t: object, year: number, now: Date, value = 90) => confirmMatrixChange(admin.id, { ...t, year, op: "SET_MONTH", month: 7, value, expectedVersion: 0 }, { now });
  const version = async (id: string, year: number, now: Date) => (await getMatrix(admin.id, { type: "group", id }, year, { now })).version;

  it("en 2026 se editan 2025 y 2026 pero no 2024; en 2027, 2026 y 2027 pero no 2025; en 2028, 2027 y 2028", async () => {
    const { id, t } = await seeded();
    let n = 90;
    const ok = async (year: number, now: Date) => {
      n += 1;
      await confirmMatrixChange(admin.id, { ...t, year, op: "SET_MONTH", month: 7, value: n, expectedVersion: await version(id, year, now) }, { now });
      expect((await matrixOf(id, year))!.months.find((x) => x.month === 7)).toMatchObject({ value: n, kind: "ADJUSTED" });
    };
    await ok(2025, NOW26);
    await ok(2026, NOW26);
    await expect(edit(t, 2024, NOW26)).rejects.toBeInstanceOf(DomainError);
    await expect(edit(t, 2027, NOW26)).rejects.toBeInstanceOf(DomainError); // futuro: tampoco
    await ok(2026, NOW27);
    await ok(2027, NOW27); // la matriz de 2027 no existe: se crea al editar
    await expect(edit(t, 2025, NOW27)).rejects.toBeInstanceOf(DomainError);
    await ok(2027, NOW28);
    await ok(2028, NOW28);
    await expect(edit(t, 2026, NOW28)).rejects.toBeInstanceOf(DomainError);
    await expect(edit(t, 2025, NOW28)).rejects.toBeInstanceOf(DomainError);
  });

  it("el servidor no obedece un año o reloj enviados por el cliente: una petición forjada sobre un año fuera de ventana se rechaza y no deja rastro", async () => {
    const { id, t } = await seeded();
    const before = JSON.stringify((await matrixOf(id, 2022))!.months);
    for (const year of [2022, 2023, 2024]) await expect(edit(t, year, NOW26)).rejects.toBeInstanceOf(DomainError);
    await expect(confirmMatrixChange(admin.id, { ...t, year: 2022, op: "SET_MONTH", month: 7, value: 90, expectedVersion: 0, now: NOW26 }, { now: NOW26 })).rejects.toBeInstanceOf(DomainError);
    expect(JSON.stringify((await matrixOf(id, 2022))!.months)).toBe(before);
    // Con el calendario de 2028 la base 2025 queda cerrada para edición, aunque se pida el valor inicial uniforme: no hay bypass abierto.
    const { initializeHistoric } = await import("@/server/usuarios");
    const c = await prisma.clientGroup.create({ data: { name: "Otro" } });
    await expect(initializeHistoric(admin.id, { targetType: "group", targetId: c.id, year: 2025, value: 10, source: "x" }, { now: NOW28 })).rejects.toBeInstanceOf(DomainError);
    await expect(edit(t, 2025, NOW28)).rejects.toBeInstanceOf(DomainError);
  });

  it("las filas de 2025 bloqueadas por la carga inicial anterior se desbloquean con la migración sin perder valor, tipo ni historial", async () => {
    const m = await master();
    const g = m["Grupo A"];
    const mx = await prisma.userMatrix.create({ data: { groupId: g.id, year: 2025 } });
    await prisma.userMatrixMonth.create({ data: { matrixId: mx.id, month: 1, value: 65, kind: "INITIAL", isLocked: true, source: "Valor inicial", revision: 3, updatedById: admin.id } });
    await prisma.userMatrixMonth.create({ data: { matrixId: mx.id, month: 2, value: 70, kind: "ADJUSTED", isLocked: false, source: "Ajuste", revision: 2, updatedById: admin.id } });
    const audits = await prisma.auditEvent.count();
    const sql = readFileSync("prisma/migrations/20261108090000_hotfix01_historico_usuarios/migration.sql", "utf8");
    const stmt = /UPDATE "UserMatrixMonth"[^;]*;/.exec(sql)![0];
    await prisma.$executeRawUnsafe(stmt);
    const rows = await prisma.userMatrixMonth.findMany({ where: { matrixId: mx.id }, orderBy: { month: "asc" } });
    expect(rows.map((r) => [r.value, r.kind, r.isLocked, r.revision, r.source])).toEqual([[65, "INITIAL", false, 3, "Valor inicial"], [70, "ADJUSTED", false, 2, "Ajuste"]]);
    expect(await prisma.auditEvent.count()).toBe(audits);
    // Ya editable en 2026 (ventana 2025/2026): se ajusta el mes y pasa a ajuste explícito.
    await confirmMatrixChange(admin.id, { targetType: "group", targetId: g.id, year: 2025, op: "SET_MONTH", month: 1, value: 66, expectedVersion: 1 }, { now: NOW26 });
    expect((await matrixOf(g.id, 2025))!.months[0]).toMatchObject({ value: 66, kind: "ADJUSTED", revision: 4 });
  });
});
