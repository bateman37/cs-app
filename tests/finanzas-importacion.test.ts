import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { confirmUpload, revertUpload } from "@/server/uploads/batches";
import { reprocessUpload } from "@/server/uploads/batches";
import { DomainError } from "@/server/errors";
import { batch, drain, freshEnvironment, removeUploadDir, useUploadDir } from "./cargas-helpers";
import { activeRows, activeTotal, computeAnalysis, decideFinance, importFin, prepareFin, reviewFinanceImpact, scopeOf } from "./finanzas-helpers";
import { exactSum } from "./generators/finance";

let admin: { id: string };
let reader: { id: string };
let dir: string;
beforeAll(() => { dir = useUploadDir(); });
beforeEach(async () => { ({ admin, reader } = await freshEnvironment()); });
afterAll(() => removeUploadDir(dir));

async function group(name: string, ...keys: { key: string; from?: string; to?: string }[]) {
  const g = await prisma.clientGroup.create({ data: { name } });
  for (const k of keys) {
    await prisma.externalIdentity.create({
      data: { system: "BC", kind: "GROUP_KEY", rawValue: k.key, searchValue: k.key.toLowerCase(), groupId: g.id, validFrom: k.from ? new Date(`${k.from}T00:00:00Z`) : null, validTo: k.to ? new Date(`${k.to}T00:00:00Z`) : null },
    });
  }
  return g;
}
const cfg = async (id: string) => (await computeAnalysis(prisma, id))!;
const codes = async (id: string) => (await cfg(id)).blockers.map((b) => b.code);

describe("tres perfiles, año y filtros", () => {
  it("cada categoría se prepara con su pie, Total y año seleccionado; el Total y el pie no son clientes", async () => {
    for (const cat of ["SOPORTE", "ADMIN_DELEGADA", "OTROS"] as const) {
      const b = await prepareFin(admin.id, cat, 2026, [{ grupo: "A", vta: 100, dif: 1 }, { grupo: "B", vta: 50.5, dif: -2 }], { total: { vta: 150.5, dif: -1 } });
      expect(b.status).toBe("READY");
      expect(b.rowsError).toBe(0);
      expect(b.scopeKey).toBe("2026");
      const a = await cfg(b.id);
      expect(a.controls.footer.status).toBe("ok");
      expect(a.counts).toMatchObject({ economic: 2, control: 4, errors: 0 });
      expect(a.reconciliation).toMatchObject({ totalPresent: true, reconciled: true, controlIncome: "150.5" });
      expect(a.reconciliation.diffControl?.difference).toBe("0");
    }
  });
  it("categoría equivocada en el pie y año explícito incompatible bloquean la confirmación", async () => {
    const wrong = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 1 }], { total: { vta: 1 }, footer: ["Filtros aplicados:", "DESC_L4 es Administración Delegada", "Año Actual es Año Actual"] });
    expect(await codes(wrong.id)).toContain("FOOTER_MISMATCH");
    const yr = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 1 }], { total: { vta: 1 }, footer: ["Filtros aplicados:", "DESC_L4 es Plan Gold", "Año es 2025"] });
    expect(await codes(yr.id)).toContain("YEAR_MISMATCH");
    await expect(confirmUpload(admin.id, yr.id)).rejects.toBeInstanceOf(DomainError);
    expect((await batch(yr.id)).status).toBe("READY");
  });
  it("«Año Actual es Año Actual» no aporta año; pie ausente o sin selección exige declaración expresa", async () => {
    const none = await prepareFin(admin.id, "OTROS", 2026, [{ grupo: "A", vta: 1 }], { total: { vta: 1 }, footer: false });
    let a = await cfg(none.id);
    expect(a.controls.footer.status).toBe("unverifiable");
    expect(a.controls.footer.explicitYear).toBeNull();
    expect(a.blockers.map((x) => x.code)).toContain("FOOTER_UNVERIFIED");
    await expect(decideFinance(admin.id, none.id, { kind: "ACK_UNVERIFIED_FOOTER" })).rejects.toBeInstanceOf(DomainError); // sin motivo
    await decideFinance(admin.id, none.id, { kind: "ACK_UNVERIFIED_FOOTER", reason: "Export de OTROS 2026, filtros revisados en origen" });
    a = await cfg(none.id);
    expect(a.blockers.map((x) => x.code)).not.toContain("FOOTER_UNVERIFIED");
  });
  it("valida por contenido: orden distinto de columnas, espacios, columnas extra con aviso; cabeceras ausentes o duplicadas se rechazan", async () => {
    const ok = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 10, dif: 2 }], { total: { vta: 10, dif: 2 }, order: [2, 0, 1], headers: [" Grupo cliente ", "vta potencial", "DIFERENCIA "], extraColumn: true, name: "cualquier-nombre.xlsx" });
    expect(ok.status).toBe("READY");
    expect(JSON.stringify(ok.summary)).toContain("Columnas adicionales");
    expect((await cfg(ok.id)).sums.unique).toBe("10");
    const missing = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 10 }], { headers: ["Grupo cliente", "Vta Potencial", "Dif"] });
    expect(missing.status).toBe("REJECTED");
    const dup = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 10 }], { headers: ["Grupo cliente", "Vta Potencial", "vta potencial"] });
    expect(dup.status).toBe("REJECTED");
  });
  it("varias hojas compatibles exigen la hoja explícita; con la hoja elegida se lee solo esa", async () => {
    const extra = [{ name: "Otra", rows: [["Grupo cliente", "Vta Potencial", "Diferencia"], ["Z", 9, 0]] }];
    const amb = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 10 }], { total: { vta: 10 }, extraSheets: extra });
    expect(amb.status).toBe("REJECTED");
    const ok = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 10 }], { total: { vta: 10 }, extraSheets: extra, metadata: { anio: 2026, conjuntoCompleto: "si", hoja: "Otra" } });
    expect(ok.status).toBe("READY");
    expect((await cfg(ok.id)).sums.unique).toBe("9");
  });
  it("sin año, sin declaración de conjunto completo o con año fuera de rango no se acepta (validado en servidor)", async () => {
    const { uploadText } = await import("./cargas-helpers");
    const { financeXlsx } = await import("./generators/finance");
    const f = await financeXlsx([{ grupo: "A", vta: 1 }], { total: { vta: 1 } });
    for (const metadata of [{}, { anio: 2026 }, { conjuntoCompleto: "si" }, { anio: 1999, conjuntoCompleto: "si" }, { anio: 2026, conjuntoCompleto: "no" }]) {
      await expect(uploadText(admin.id, f, { profileId: "facturacion-soporte", name: "f.xlsx", metadata })).rejects.toBeInstanceOf(DomainError);
    }
    await expect(uploadText(reader.id, f, { profileId: "facturacion-soporte", name: "f.xlsx", metadata: { anio: 2026, conjuntoCompleto: "si" } })).rejects.toThrow();
  });
});

describe("importes: precisión, vacíos, controles", () => {
  it("decimales largos, científicos, negativos, cero y residuos se suman exactos sin Number ni redondeo por fila", async () => {
    const rows = [
      { grupo: "A", vta: { raw: "1234.5678901234567" }, dif: { raw: "1E-3" } },
      { grupo: "B", vta: { raw: "1.5E+3" }, dif: -0.5 },
      { grupo: "C", vta: { raw: "-250.125" } , dif: 0 },
      { grupo: "D", vta: 0, dif: 0 },
      { grupo: "E", vta: { raw: "0.30000000000000004" } },
    ];
    const total = "2484.74289012345670004";
    const b = await prepareFin(admin.id, "SOPORTE", 2026, rows, { total: { vta: { raw: total } } });
    const a = await cfg(b.id);
    expect(a.sums.unique).toBe("2484.74289012345670004");
    expect(a.reconciliation.reconciled).toBe(true);
    const st = await prisma.$queryRaw<{ vta: string; dif: string | null }[]>`SELECT typed->>'vta' AS vta, typed->>'dif' AS dif FROM "UploadStagedRow" WHERE "batchId" = ${b.id} AND typed->>'key' = 'b'`;
    expect(st[0]).toEqual({ vta: "1500", dif: "-0.5" });
    await decideFinance(admin.id, b.id, { kind: "ACCEPT_UNASSIGNED" });
    await reviewFinanceImpact(admin.id, b.id);
    await confirmUpload(admin.id, b.id); await drain();
    expect(await activeTotal("SOPORTE", 2026)).toBe("2484.74289012345670004");
    const r = await activeRows("SOPORTE", 2026);
    expect(r.find((x) => x.label === "C")?.income).toBe("-250.12500000000000000000"); // ajuste negativo conservado
    expect(r.find((x) => x.label === "D")?.income).toBe("0.00000000000000000000"); // cero confirmado
  });
  it("vacío de ingreso: sin decisión conserva null y bloquea; con decisión conserva original, cero derivado, actor y motivo; nunca usa Diferencia", async () => {
    const rows = [{ grupo: "A", vta: 100, dif: 5 }, { grupo: "B", vta: null, dif: 40 }, { grupo: "C", vta: 20, dif: 1 }];
    const b = await prepareFin(admin.id, "OTROS", 2026, rows, { total: { vta: 120, dif: 46 } });
    let a = await cfg(b.id);
    expect(a.counts.emptyIncome).toBe(1);
    expect(a.blockers.map((x) => x.code)).toContain("EMPTY_INCOME");
    const st = await prisma.$queryRaw<{ vta: string | null }[]>`SELECT typed->>'vta' AS vta FROM "UploadStagedRow" WHERE "batchId" = ${b.id} AND typed->>'key' = 'b'`;
    expect(st[0].vta).toBeNull();
    await reviewFinanceImpact(admin.id, b.id);
    await expect(confirmUpload(admin.id, b.id)).rejects.toBeInstanceOf(DomainError);
    await expect(decideFinance(admin.id, b.id, { kind: "EMPTY_AS_ZERO" })).rejects.toBeInstanceOf(DomainError); // sin motivo
    await decideFinance(admin.id, b.id, { kind: "EMPTY_AS_ZERO", reason: "El Total confirma que el vacío es cero" });
    await decideFinance(admin.id, b.id, { kind: "ACCEPT_UNASSIGNED" });
    a = await cfg(b.id);
    expect(a.blockers.map((x) => x.code)).toEqual(["REVIEW"]); // la decisión invalida la revisión previa
    await reviewFinanceImpact(admin.id, b.id);
    const cur = await batch(b.id);
    await confirmUpload(admin.id, b.id, { expectedVersion: cur.version }); await drain();
    const r = await activeRows("OTROS", 2026);
    const rb = r.find((x) => x.label === "B")!;
    expect(rb).toMatchObject({ derivedZero: true, original: null });
    expect(Number(rb.income)).toBe(0); // 40 de Diferencia no pasa al ingreso
    expect(Number(rb.difference)).toBe(40);
    const d = await prisma.financeDecision.findFirstOrThrow({ where: { batchId: b.id, kind: "EMPTY_AS_ZERO" }, include: { decidedBy: true } });
    expect(d).toMatchObject({ reason: "El Total confirma que el vacío es cero", decidedBy: { email: "admin@test.local" } });
  });
  it("vacíos como cero exige Total presente y conciliado; texto inválido y fórmulas sin valor no son vacíos", async () => {
    const noTotal = await prepareFin(admin.id, "OTROS", 2026, [{ grupo: "A", vta: 100 }, { grupo: "B", vta: null }], { total: false });
    await expect(decideFinance(admin.id, noTotal.id, { kind: "EMPTY_AS_ZERO", reason: "x" })).rejects.toThrow(/Total/);
    const bad = await prepareFin(admin.id, "OTROS", 2026, [{ grupo: "A", vta: 100 }, { grupo: "B", vta: 7 }], { total: { vta: 900 } });
    expect((await cfg(bad.id)).blockers.map((x) => x.code)).toContain("RECONCILIATION");
    const f = await prepareFin(admin.id, "OTROS", 2026, [{ grupo: "A", vta: { f: "SUM(1,2)" } }, { grupo: "B", vta: "abc" }, { grupo: "C", vta: { f: "1+1", v: "2" } }], { total: { vta: 2 } });
    const issues = await prisma.$queryRaw<{ typed: { key: string }; issues: { code: string }[] }[]>`SELECT typed, issues FROM "UploadStagedRow" WHERE "batchId" = ${f.id} AND classification = 'ERROR' ORDER BY position`;
    expect(issues.map((i) => i.issues[0].code)).toEqual(["FORMULA_SIN_VALOR", "IMPORTE_ILEGIBLE"]);
    expect(f.rowsError).toBe(2);
    expect((await cfg(f.id)).sums.unique).toBe("2"); // la fórmula con valor almacenado se usa; la otra no vale cero
  });
  it("Total, pie y filas vacías son controles; una línea desconocida, un subtotal o totales incompatibles no se ignoran", async () => {
    const sub = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 10 }, { grupo: "Subtotal parcial", vta: 10 }], { total: { vta: 10 } });
    expect(sub.rowsError).toBe(1);
    const unk = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 10 }], { total: { vta: 10 }, afterTotal: [["Cliente suelto", 5, 1]], footer: false });
    expect(unk.rowsError).toBe(1);
    const sinGrupo = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 10 }, { grupo: "", vta: 7 }], { total: { vta: 10 } });
    expect(sinGrupo.rowsError).toBe(1);
    const dos = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 10 }], { total: { vta: 10 }, afterTotal: [["Total", 11, 0]] });
    expect((await cfg(dos.id)).blockers.map((x) => x.code)).toContain("TOTALS_INCOMPATIBLE");
    const ninguno = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 10 }], { total: false });
    expect((await cfg(ninguno.id)).blockers.map((x) => x.code)).toContain("NO_TOTAL");
    const solo = await prepareFin(admin.id, "SOPORTE", 2026, [], { total: { vta: 0 } });
    expect((await cfg(solo.id)).blockers.map((x) => x.code)).toContain("EMPTY_SET");
  });
  it("el nombre de un cliente que empieza por «Total» no es una fila de control", async () => {
    const b = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "Total Energies", vta: 10 }], { total: { vta: 10 } });
    expect((await cfg(b.id)).counts).toMatchObject({ economic: 1, errors: 0 });
  });
  it("duplicados idénticos cuentan una vez; claves contradictorias bloquean; el total de control no se usa para ajustar", async () => {
    const dup = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 10, dif: 1 }, { grupo: "a  ", vta: 10, dif: 1 }, { grupo: "B", vta: 5 }], { total: { vta: 15 } });
    let a = await cfg(dup.id);
    expect(a.counts).toMatchObject({ economic: 2, duplicates: 1, errors: 0 });
    expect(a.sums).toMatchObject({ gross: "25", duplicates: "10", unique: "15" });
    expect(a.reconciliation.reconciled).toBe(true);
    const bad = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 10 }, { grupo: "A", vta: 12 }], { total: { vta: 22 } });
    a = await cfg(bad.id);
    expect(bad.rowsError).toBe(2);
    expect(a.blockers.map((x) => x.code)).toContain("ERRORS");
    await expect(confirmUpload(admin.id, bad.id)).rejects.toBeInstanceOf(DomainError);
  });
  it("la discrepancia superior a la tolerancia bloquea; la tolerancia es absoluta y no por fila", async () => {
    const within = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 10 }, { grupo: "B", vta: 10 }], { total: { vta: { raw: "20.01" } } });
    expect((await cfg(within.id)).reconciliation.reconciled).toBe(true);
    const over = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 10 }, { grupo: "B", vta: 10 }], { total: { vta: { raw: "20.011" } } });
    expect((await cfg(over.id)).reconciliation.reconciled).toBe(false);
    expect((await cfg(over.id)).blockers.map((x) => x.code)).toContain("RECONCILIATION");
    expect(exactSum(["0.1", "0.2"])).toBe("0.3");
  });
});

describe("sustitución atómica por año y categoría", () => {
  it("admin 2026 de 100 pasa a 120 (nunca 220), una fila ausente se retira y los demás ámbitos siguen intactos", async () => {
    await importFin(admin.id, "SOPORTE", 2026, [{ grupo: "S", vta: 7 }], { total: { vta: 7 } });
    await importFin(admin.id, "OTROS", 2026, [{ grupo: "O", vta: 3 }], { total: { vta: 3 } });
    await importFin(admin.id, "ADMIN_DELEGADA", 2025, [{ grupo: "P", vta: 9 }], { total: { vta: 9 } });
    await importFin(admin.id, "ADMIN_DELEGADA", 2026, [{ grupo: "X", vta: 100 }, { grupo: "Y", vta: 30 }], { total: { vta: 130 } });
    const second = await importFin(admin.id, "ADMIN_DELEGADA", 2026, [{ grupo: "X", vta: 120 }], { total: { vta: 120 } });
    expect(await activeTotal("ADMIN_DELEGADA", 2026)).toBe("120");
    expect((await activeRows("ADMIN_DELEGADA", 2026)).map((r) => r.label)).toEqual(["X"]);
    expect(await activeTotal("SOPORTE", 2026)).toBe("7");
    expect(await activeTotal("OTROS", 2026)).toBe("3");
    expect(await activeTotal("ADMIN_DELEGADA", 2025)).toBe("9");
    const prev = await prisma.uploadBatch.findFirstOrThrow({ where: { supersededByBatchId: second.id } });
    expect(prev.status).toBe("COMPLETED");
  });
  it("repetir el mismo fichero conserva exactamente sus ingresos (ni suma ni cero); «duplicado respecto al lote anterior» no lo omite", async () => {
    const rows = [{ grupo: "A", vta: 40 }, { grupo: "B", vta: 60 }];
    await importFin(admin.id, "SOPORTE", 2026, rows, { total: { vta: 100 } });
    const again = await importFin(admin.id, "SOPORTE", 2026, rows, { total: { vta: 100 } });
    expect(await activeTotal("SOPORTE", 2026)).toBe("100");
    expect(again.rowsImported).toBe(2);
    expect((await activeRows("SOPORTE", 2026)).length).toBe(2);
  });
  it("la preparación y la revisión no cambian los hechos activos", async () => {
    await importFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 40 }], { total: { vta: 40 } });
    const b = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 999 }], { total: { vta: 999 } });
    await reviewFinanceImpact(admin.id, b.id);
    expect(await activeTotal("SOPORTE", 2026)).toBe("40");
    const a = await cfg(b.id);
    expect(a.impact).toMatchObject({ previousTotal: "40", newTotal: "999", variation: "959", groups: { modified: 1, added: 0, retired: 0 } });
  });
  it("la ficha previa muestra grupos nuevos, modificados y retirados con filas fuente y grupos canónicos por separado", async () => {
    await importFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 40 }, { grupo: "B", vta: 10 }, { grupo: "C", vta: 5 }], { total: { vta: 55 } });
    const b = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 40 }, { grupo: "B", vta: 11 }, { grupo: "D", vta: 1 }], { total: { vta: 52 } });
    const a = await cfg(b.id);
    expect(a.impact.groups).toEqual({ added: 1, modified: 1, retired: 1, unchanged: 1 });
    expect(a.impact.sourceRows).toEqual({ previous: 3, next: 3 });
  });
  it("retroceso de la extracción declarada exige reconocimiento", async () => {
    await importFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 40 }], { total: { vta: 40 }, declared: { extraccion: "2026-10-01" } });
    const old = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 41 }], { total: { vta: 41 }, declared: { extraccion: "2026-09-01" } });
    expect((await cfg(old.id)).blockers.map((x) => x.code)).toContain("RETROCESO");
    await decideFinance(admin.id, old.id, { kind: "ACK_RETROCESO" });
    expect((await cfg(old.id)).blockers.map((x) => x.code)).not.toContain("RETROCESO");
  });
});

describe("atribución a Grupo Cliente", () => {
  it("identidad resuelta, nueva a mitad de año, sin asignar (aceptación expresa y cobertura parcial); el dinero siempre concilia", async () => {
    const g1 = await group("Grupo 1", { key: "Acme SA" });
    const g2 = await group("Grupo 2", { key: "Nueva SL", from: "2026-06-01" }); // alias nacido a mitad de año: no se pierde
    const b = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "ACME SA", vta: 10 }, { grupo: "nueva sl", vta: 20 }, { grupo: "Desconocida", vta: 5 }], { total: { vta: 35 } });
    const a = await cfg(b.id);
    expect(a.resolution).toMatchObject({ resolved: 2, unresolved: 1 });
    expect(a.sums).toMatchObject({ unique: "35", attributed: "30", unassigned: "5" });
    expect(a.reconciliation.reconciled).toBe(true);
    expect(a.blockers.map((x) => x.code)).toContain("UNASSIGNED");
    await decideFinance(admin.id, b.id, { kind: "ACCEPT_UNASSIGNED" });
    await reviewFinanceImpact(admin.id, b.id);
    const cur = await batch(b.id);
    await confirmUpload(admin.id, b.id, { expectedVersion: cur.version }); await drain();
    const rows = await activeRows("SOPORTE", 2026);
    expect(rows.find((r) => r.label === "Desconocida")).toMatchObject({ groupId: null, income: "5.00000000000000000000" });
    expect(rows.find((r) => r.label === "nueva sl")?.groupId).toBe(g2.id);
    expect(rows.find((r) => r.label === "ACME SA")?.groupId).toBe(g1.id);
    const det = await prisma.financeRow.findFirstOrThrow({ where: { sourceKey: "nueva sl" } });
    expect(JSON.stringify(det.resolutionDetail)).toContain("2026-06-01");
  });
  it("cambio de destino dentro del año exige asignación anual explícita y auditada; no reparte ni altera equivalencias", async () => {
    const ga = await group("Grupo A", { key: "Mutante", to: "2026-07-01" });
    const gb = await group("Grupo B", { key: "Mutante", from: "2026-07-01" });
    const idsBefore = await prisma.externalIdentity.findMany({ orderBy: { id: "asc" } });
    const b = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "Mutante", vta: 100 }], { total: { vta: 100 } });
    let a = await cfg(b.id);
    expect(a.resolution.ambiguous).toBe(1);
    expect(a.ambiguousList[0].candidates.map((c) => c.groupName).sort()).toEqual(["Grupo A", "Grupo B"]);
    expect(a.blockers.map((x) => x.code)).toContain("AMBIGUOUS");
    await expect(decideFinance(admin.id, b.id, { kind: "YEAR_ASSIGNMENT", key: "mutante", groupId: "no-es-candidato", reason: "x" })).rejects.toBeInstanceOf(DomainError);
    await decideFinance(admin.id, b.id, { kind: "YEAR_ASSIGNMENT", key: "mutante", groupId: gb.id, reason: "Contrato vigente a cierre de año" });
    a = await cfg(b.id);
    expect(a.resolution).toMatchObject({ decision: 1, ambiguous: 0 });
    await reviewFinanceImpact(admin.id, b.id);
    const cur = await batch(b.id);
    await confirmUpload(admin.id, b.id, { expectedVersion: cur.version }); await drain();
    expect((await activeRows("SOPORTE", 2026))[0].groupId).toBe(gb.id);
    expect(await prisma.externalIdentity.findMany({ orderBy: { id: "asc" } })).toEqual(idsBefore);
    void ga;
  });
  it("varias denominaciones en el mismo grupo canónico requieren revisar la colisión", async () => {
    await group("Grupo", { key: "Nombre 1" }, { key: "Nombre 2" });
    const b = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "Nombre 1", vta: 10 }, { grupo: "Nombre 2", vta: 10 }], { total: { vta: 20 } });
    const a = await cfg(b.id);
    expect(a.collisions).toHaveLength(1);
    expect(a.blockers.map((x) => x.code)).toContain("COLLISION");
    await decideFinance(admin.id, b.id, { kind: "ACCEPT_COLLISION", key: a.collisions[0].groupId, reason: "Dos contratos distintos" });
    expect((await cfg(b.id)).blockers.map((x) => x.code)).not.toContain("COLLISION");
  });
  it("completar el maestro y reprocesar un lote listo recupera el grupo antes de activar, conservando el dinero y las decisiones", async () => {
    const b = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "Pendiente SA", vta: 10 }], { total: { vta: 10 } });
    expect((await cfg(b.id)).resolution.unresolved).toBe(1);
    await group("Grupo nuevo", { key: "pendiente sa" });
    await reprocessUpload(admin.id, b.id); await drain();
    const a = await cfg(b.id);
    expect(a.resolution).toMatchObject({ resolved: 1, unresolved: 0 });
    expect(a.sums).toMatchObject({ unique: "10", attributed: "10", unassigned: "0" });
    expect(a.blockers.map((x) => x.code)).toEqual(["REVIEW"]);
  });
  it("el reproceso de un lote completado recupera el grupo sin cambiar dinero, año, filtros ni extracción, y no lo reactiva", async () => {
    const b = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "Tardia", vta: 10 }], { total: { vta: 10 }, declared: { extraccion: "2026-10-01" } });
    await decideFinance(admin.id, b.id, { kind: "ACCEPT_UNASSIGNED" });
    await reviewFinanceImpact(admin.id, b.id);
    let cur = await batch(b.id);
    await confirmUpload(admin.id, b.id, { expectedVersion: cur.version }); await drain();
    expect((await activeRows("SOPORTE", 2026))[0].groupId).toBeNull();
    const g = await group("Tardio", { key: "tardia" });
    const fbBefore = await prisma.financeBatch.findUniqueOrThrow({ where: { batchId: b.id } });
    const scopeBefore = await scopeOf("SOPORTE", 2026);
    await reprocessUpload(admin.id, b.id); await drain();
    const rows = await activeRows("SOPORTE", 2026);
    expect(rows[0]).toMatchObject({ groupId: g.id, income: "10.00000000000000000000" });
    const fbAfter = await prisma.financeBatch.findUniqueOrThrow({ where: { batchId: b.id } });
    expect([fbAfter.year, fbAfter.category, fbAfter.controls, fbAfter.extractionDate]).toEqual([fbBefore.year, fbBefore.category, fbBefore.controls, fbBefore.extractionDate]);
    expect(fbAfter.derivedVersion).toBe(fbBefore.derivedVersion + 1);
    expect((await scopeOf("SOPORTE", 2026))!.version).toBe(scopeBefore!.version); // no se reactiva
    cur = await batch(b.id);
    expect(cur.status).toBe("COMPLETED");
  });
});

describe("revisión vigente y recuperación", () => {
  it("dos lotes preparados sobre A: al activar B, C no puede sobrescribirlo con la confirmación antigua", async () => {
    await importFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 10 }], { total: { vta: 10 } });
    const b = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 20 }], { total: { vta: 20 } });
    const c = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 30 }], { total: { vta: 30 } });
    await reviewFinanceImpact(admin.id, b.id);
    await reviewFinanceImpact(admin.id, c.id);
    // C se confirma sobre A; B se confirma y se activa primero.
    const cb = await batch(b.id);
    await confirmUpload(admin.id, b.id, { expectedVersion: cb.version });
    const cc = await batch(c.id);
    await confirmUpload(admin.id, c.id, { expectedVersion: cc.version });
    await drain(); // el trabajador activa B y después intenta C con una revisión obsoleta
    expect(await activeTotal("SOPORTE", 2026)).toBe("20");
    const after = await batch(c.id);
    expect(after.status).toBe("READY");
    expect(after.statusDetail).toMatch(/otra carga|revis/i);
    expect((await cfg(c.id)).impact).toMatchObject({ previousTotal: "20", newTotal: "30" });
    await expect(confirmUpload(admin.id, c.id)).rejects.toBeInstanceOf(DomainError); // exige revisar de nuevo
    await reviewFinanceImpact(admin.id, c.id);
    const again = await batch(c.id);
    await confirmUpload(admin.id, c.id, { expectedVersion: again.version }); await drain();
    expect(await activeTotal("SOPORTE", 2026)).toBe("30");
  });
  it("también se invalida una revisión hecha antes de que otra carga (o una reversión) cambie el conjunto", async () => {
    const a = await importFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 10 }], { total: { vta: 10 } });
    const c = await prepareFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 30 }], { total: { vta: 30 } });
    await reviewFinanceImpact(admin.id, c.id);
    await revertUpload(admin.id, a.id); await drain();
    expect(await activeTotal("SOPORTE", 2026)).toBeNull();
    await expect(confirmUpload(admin.id, c.id)).rejects.toBeInstanceOf(DomainError);
  });
  it("cadena A→B→C: se revierte solo el vigente, restaurando su predecesor completo; un lote supersedido no se revierte ni se reactiva", async () => {
    const a = await importFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 1 }, { grupo: "Z", vta: 4 }], { total: { vta: 5 } });
    const b = await importFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 2 }], { total: { vta: 2 } });
    const c = await importFin(admin.id, "SOPORTE", 2026, [{ grupo: "A", vta: 3 }], { total: { vta: 3 } });
    await importFin(admin.id, "OTROS", 2026, [{ grupo: "O", vta: 8 }], { total: { vta: 8 } });
    await expect(revertUpload(admin.id, a.id)).rejects.toBeInstanceOf(DomainError); // supersedido
    await expect(revertUpload(admin.id, b.id)).rejects.toBeInstanceOf(DomainError);
    await reprocessUpload(admin.id, b.id); await drain(); // REDERIVE de un supersedido: no toca el conjunto activo
    expect(await activeTotal("SOPORTE", 2026)).toBe("3");
    await revertUpload(admin.id, c.id); await drain();
    expect(await activeTotal("SOPORTE", 2026)).toBe("2");
    expect((await batch(c.id)).status).toBe("REVERTED");
    expect((await batch(b.id)).supersededByBatchId).toBeNull();
    await revertUpload(admin.id, b.id); await drain();
    expect(await activeTotal("SOPORTE", 2026)).toBe("5");
    expect((await activeRows("SOPORTE", 2026)).map((r) => r.label)).toEqual(["A", "Z"]);
    await revertUpload(admin.id, a.id); await drain();
    expect(await activeTotal("SOPORTE", 2026)).toBeNull(); // ausencia de fuente, no un conjunto vacío confirmado
    expect((await scopeOf("SOPORTE", 2026))!.activeBatchId).toBeNull();
    expect(await activeTotal("OTROS", 2026)).toBe("8");
  });
});
