import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { AccessError } from "@/lib/access";
import { DomainError } from "@/server/errors";
import { applyMatrixBatch, previewMatrixBatch, userMonthsExposure, usersAtCutoff, batchKey } from "@/server/usuarios";
import { applySteps, emptyYear, parseUserCount, type MatrixStep } from "@/domain/usuarios";
import { resetDatabase, makeUsers } from "./helpers";

/**
 * HOTFIX-04 §6 y §10 (casos 6–9): edición de enero–diciembre en la propia matriz de usuarios contratados, con guardado por lote atómico, un único versionado por matriz,
 * «0» distinto de «sin informar», ventana de años con reloj del servidor, «Aplicar desde este mes» sin pisar ajustes explícitos y conflictos localizados.
 */
let admin: { id: string };
let reader: { id: string };
beforeEach(async () => {
  await resetDatabase();
  ({ admin, reader } = await makeUsers());
});

const NOW = { now: new Date("2026-11-04T10:00:00Z") };
const op = () => randomUUID();
type Row = { type: "group" | "client" | "implementation"; id: string; version: number; steps: MatrixStep[] };
const batch = (rows: Row[], year = 2026, operationId = op()) => ({ operationId, year, matrices: rows.map((r) => ({ targetType: r.type, targetId: r.id, expectedVersion: r.version, steps: r.steps })) });
const save = (rows: Row[], year = 2026, id = op(), opts = NOW) => applyMatrixBatch(admin.id, batch(rows, year, id), opts);
const set = (month: number, value: number | null): MatrixStep => ({ type: "SET", month, value });

async function matrix(scope: { groupId?: string; clientId?: string }, year: number, months: { m: number; v: number; kind?: "INITIAL" | "ADJUSTED" | "PROPAGATED" | "COPIED" }[]) {
  const m = await prisma.userMatrix.create({ data: { ...scope, year } });
  for (const x of months) await prisma.userMatrixMonth.create({ data: { matrixId: m.id, month: x.m, value: x.v, kind: x.kind ?? "INITIAL", source: "Valor inicial de prueba", updatedById: admin.id } });
  return m;
}
const monthsOf = async (matrixId: string) => Object.fromEntries((await prisma.userMatrixMonth.findMany({ where: { matrixId } })).map((r) => [r.month, { v: r.value, k: r.kind, rev: r.revision }]));
const audits = () => prisma.auditEvent.count();

describe("varias celdas y varias filas en un solo guardado", () => {
  it("cambia varios meses de dos filas y de otra nueva con UNA versión por matriz (sin fallar en la segunda celda), clasifica solo lo editado y audita antes/después", async () => {
    const g1 = await prisma.clientGroup.create({ data: { name: "Alfa" } });
    const g2 = await prisma.clientGroup.create({ data: { name: "Beta" } });
    const g3 = await prisma.clientGroup.create({ data: { name: "Gamma" } }); // sin matriz todavía
    const m1 = await matrix({ groupId: g1.id }, 2026, Array.from({ length: 12 }, (_, i) => ({ m: i + 1, v: 10 })));
    const m2 = await matrix({ groupId: g2.id }, 2026, Array.from({ length: 12 }, (_, i) => ({ m: i + 1, v: 20, kind: "COPIED" as const })));
    const a0 = await audits();
    const r = await save([
      { type: "group", id: g1.id, version: m1.version, steps: [set(1, 11), set(2, 12), set(3, 13)] }, // tres meses de una fila
      { type: "group", id: g2.id, version: m2.version, steps: [set(12, 25)] },
      { type: "group", id: g3.id, version: 0, steps: [set(1, 5), set(2, 6)] },
    ]);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.versions).sort()).toEqual([batchKey("group", g1.id), batchKey("group", g2.id), batchKey("group", g3.id)].sort());
    // Una sola versión nueva por matriz, aunque se hayan editado tres meses.
    expect((await prisma.userMatrix.findUniqueOrThrow({ where: { id: m1.id } })).version).toBe(m1.version + 1);
    expect((await prisma.userMatrix.findUniqueOrThrow({ where: { id: m2.id } })).version).toBe(m2.version + 1);
    const a = await monthsOf(m1.id);
    expect([a[1].v, a[2].v, a[3].v]).toEqual([11, 12, 13]);
    expect([a[1].k, a[2].k, a[3].k]).toEqual(["ADJUSTED", "ADJUSTED", "ADJUSTED"]);
    expect(a[4]).toMatchObject({ v: 10, k: "INITIAL", rev: 1 }); // los meses sin editar conservan valor, clase y revisión
    const b = await monthsOf(m2.id);
    expect(b[12]).toMatchObject({ v: 25, k: "ADJUSTED", rev: 2 });
    expect(b[11]).toMatchObject({ v: 20, k: "COPIED", rev: 1 });
    const c = await prisma.userMatrix.findFirstOrThrow({ where: { groupId: g3.id, year: 2026 }, include: { months: true } });
    expect(c.version).toBe(1);
    expect(c.months.map((x) => x.month).sort((p, q) => p - q)).toEqual([1, 2]);
    // Auditoría: un evento por matriz con los meses exactos antes/después + el de la operación.
    expect(await audits()).toBe(a0 + 3 + 1);
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { entityType: "UserMatrix", entityId: m1.id } });
    expect(ev.actorId).toBe(admin.id);
    expect(JSON.stringify(ev.before)).toContain('"value":10');
    expect(JSON.stringify(ev.after)).toContain('"value":13');
  });

  it("la vista previa NO escribe: valores, versiones y auditoría siguen igual", async () => {
    const g = await prisma.clientGroup.create({ data: { name: "Alfa" } });
    const m = await matrix({ groupId: g.id }, 2026, [{ m: 1, v: 10 }]);
    const a0 = await audits();
    const p = await previewMatrixBatch(admin.id, batch([{ type: "group", id: g.id, version: m.version, steps: [set(1, 99), set(2, 7)] }]), NOW);
    expect(p.ok).toBe(true);
    expect(p.rows[0].months.filter((x) => x.status === "changed").map((x) => [x.month, x.before, x.after])).toEqual([[1, 10, 99], [2, null, 7]]);
    expect((await monthsOf(m.id))[1].v).toBe(10);
    expect((await prisma.userMatrix.findUniqueOrThrow({ where: { id: m.id } })).version).toBe(m.version);
    expect(await audits()).toBe(a0);
    expect(await prisma.userMatrixMonth.count({ where: { matrixId: m.id, month: 2 } })).toBe(0);
  });

  it("doble envío con la misma operación aplica una sola vez (sin segunda versión ni auditoría repetida)", async () => {
    const g = await prisma.clientGroup.create({ data: { name: "Alfa" } });
    const m = await matrix({ groupId: g.id }, 2026, [{ m: 1, v: 10 }]);
    const id = op();
    const rows: Row[] = [{ type: "group", id: g.id, version: m.version, steps: [set(1, 11)] }];
    expect((await save(rows, 2026, id)).ok).toBe(true);
    const a1 = await audits();
    expect(await save(rows, 2026, id)).toMatchObject({ ok: true, alreadyApplied: true });
    expect(await audits()).toBe(a1);
    expect((await prisma.userMatrix.findUniqueOrThrow({ where: { id: m.id } })).version).toBe(m.version + 1);
  });

  it("un valor igual al actual no cambia nada: ni versión, ni clase (un dato heredado no pasa a ajuste por renderizarlo), ni cabecera nueva", async () => {
    const g = await prisma.clientGroup.create({ data: { name: "Alfa" } });
    const h = await prisma.clientGroup.create({ data: { name: "Vacía" } });
    const m = await matrix({ groupId: g.id }, 2026, [{ m: 1, v: 10, kind: "INITIAL" }]);
    const r = await save([{ type: "group", id: g.id, version: m.version, steps: [set(1, 10)] }, { type: "group", id: h.id, version: 0, steps: [set(5, null)] }]);
    expect(r.ok).toBe(true);
    expect(r.rows).toEqual([]);
    expect((await monthsOf(m.id))[1]).toMatchObject({ k: "INITIAL", rev: 1 });
    expect((await prisma.userMatrix.findUniqueOrThrow({ where: { id: m.id } })).version).toBe(m.version);
    expect(await prisma.userMatrix.count({ where: { groupId: h.id } })).toBe(0);
  });
});

describe("0 confirmado ≠ sin informar; valores inválidos", () => {
  it("0 se guarda como cero confirmado; vaciar una celda la deja sin informar (no es 0) y el valor anterior queda en la auditoría", async () => {
    const g = await prisma.clientGroup.create({ data: { name: "Alfa" } });
    const m = await matrix({ groupId: g.id }, 2026, [{ m: 1, v: 10 }, { m: 2, v: 10 }]);
    expect((await save([{ type: "group", id: g.id, version: m.version, steps: [set(1, 0), set(2, null), set(3, 0)] }])).ok).toBe(true);
    const a = await monthsOf(m.id);
    expect(a[1].v).toBe(0); // cero confirmado
    expect(a[2]).toBeUndefined(); // sin informar: la fila del mes ya no existe, NO es 0
    expect(a[3].v).toBe(0);
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { entityType: "UserMatrix", entityId: m.id } });
    expect(JSON.stringify(ev.before)).toContain('"month":2');
    expect(JSON.stringify(ev.before)).toMatch(/"month":2,"value":10/);
    expect(JSON.stringify(ev.after)).toMatch(/"month":2,"value":null/);
  });

  it("negativo, decimal, texto o fuera de rango se rechazan antes de escribir", async () => {
    const g = await prisma.clientGroup.create({ data: { name: "Alfa" } });
    const m = await matrix({ groupId: g.id }, 2026, [{ m: 1, v: 10 }]);
    for (const bad of [-1, 1.5, "7", "abc", 10_000_001, undefined]) {
      await expect(applyMatrixBatch(admin.id, { operationId: op(), year: 2026, matrices: [{ targetType: "group", targetId: g.id, expectedVersion: m.version, steps: [{ type: "SET", month: 1, value: bad }] }] }, NOW)).rejects.toBeInstanceOf(DomainError);
    }
    expect((await monthsOf(m.id))[1].v).toBe(10);
    // El analizador de celdas del navegador (misma función) tampoco acepta vacío como cero.
    expect([parseUserCount(""), parseUserCount("-1"), parseUserCount("1.5"), parseUserCount("abc"), parseUserCount("0"), parseUserCount("12")]).toEqual([null, null, null, null, 0, 12]);
  });
});

describe("ventana de años con el reloj del servidor", () => {
  it("noviembre de 2026: 2025 y 2026 se editan; 2024 y 2027 son lectura también ante una petición forjada", async () => {
    const g = await prisma.clientGroup.create({ data: { name: "Alfa" } });
    for (const year of [2025, 2026]) expect((await save([{ type: "group", id: g.id, version: 0, steps: [set(1, 5)] }], year, op())).ok).toBe(true);
    for (const year of [2024, 2027]) await expect(save([{ type: "group", id: g.id, version: 0, steps: [set(1, 5)] }], year)).rejects.toBeInstanceOf(DomainError);
    expect(await prisma.userMatrix.count({ where: { groupId: g.id, year: { in: [2024, 2027] } } })).toBe(0);
  });

  it("con el reloj simulado de 2027: se editan 2026 y 2027; 2025 pasa a lectura", async () => {
    const g = await prisma.clientGroup.create({ data: { name: "Alfa" } });
    const clock = { now: new Date("2027-03-10T10:00:00Z") };
    expect((await save([{ type: "group", id: g.id, version: 0, steps: [set(1, 5)] }], 2026, op(), clock)).ok).toBe(true);
    expect((await save([{ type: "group", id: g.id, version: 0, steps: [set(1, 5)] }], 2027, op(), clock)).ok).toBe(true);
    await expect(save([{ type: "group", id: g.id, version: 0, steps: [set(1, 5)] }], 2025, op(), clock)).rejects.toThrow(/fuera de la ventana/);
  });

  it("solo un Administrador previsualiza o guarda (Consulta forjando la petición)", async () => {
    const g = await prisma.clientGroup.create({ data: { name: "Alfa" } });
    const input = batch([{ type: "group", id: g.id, version: 0, steps: [set(1, 5)] }]);
    await expect(applyMatrixBatch(reader.id, input, NOW)).rejects.toBeInstanceOf(AccessError);
    await expect(previewMatrixBatch(reader.id, input, NOW)).rejects.toBeInstanceOf(AccessError);
    expect(await prisma.userMatrix.count()).toBe(0);
  });
});

describe("«Aplicar desde este mes»: cambios reales, ajustes explícitos preservados y cifra independiente", () => {
  it("65 de enero a mayo y 68 de junio a octubre → exposición CUM 665 usuarios·mes y stock 68; solo julio no mueve junio ni agosto", async () => {
    const g = await prisma.clientGroup.create({ data: { name: "Alfa" } });
    expect((await save([{ type: "group", id: g.id, version: 0, steps: [{ type: "APPLY_FROM", month: 1, value: 65 }, { type: "APPLY_FROM", month: 6, value: 68 }] }])).ok).toBe(true);
    const scope = { type: "group" as const, id: g.id };
    const ex = await userMonthsExposure(admin.id, scope, { from: "2026-01-01", to: "2026-10-31" });
    expect(String(ex.userMonths)).toBe("665");
    expect((await usersAtCutoff(admin.id, scope, "2026-10-31")).value).toBe(68);
    const before = await prisma.userMatrix.findFirstOrThrow({ where: { groupId: g.id, year: 2026 } });
    expect((await save([{ type: "group", id: g.id, version: before.version, steps: [set(7, 99)] }])).ok).toBe(true);
    const m = await monthsOf(before.id);
    expect([m[6].v, m[7].v, m[8].v]).toEqual([68, 99, 68]); // solo julio cambió
  });

  it("no pisa un ajuste explícito posterior y la confirmación lista los meses cambiados y los preservados", async () => {
    const g = await prisma.clientGroup.create({ data: { name: "Alfa" } });
    const m = await matrix({ groupId: g.id }, 2026, Array.from({ length: 12 }, (_, i) => ({ m: i + 1, v: 10, kind: i + 1 === 9 ? ("ADJUSTED" as const) : ("PROPAGATED" as const) })));
    const p = await previewMatrixBatch(admin.id, batch([{ type: "group", id: g.id, version: m.version, steps: [{ type: "APPLY_FROM", month: 6, value: 40 }] }]), NOW);
    const row = p.rows[0];
    expect(row.protectedMonths).toEqual([9]);
    expect(row.months.filter((x) => x.status === "changed").map((x) => x.month)).toEqual([6, 7, 8, 10, 11, 12]);
    await save([{ type: "group", id: g.id, version: m.version, steps: [{ type: "APPLY_FROM", month: 6, value: 40 }] }]);
    const a = await monthsOf(m.id);
    expect(a[9]).toMatchObject({ v: 10, k: "ADJUSTED" });
    expect(a[6]).toMatchObject({ v: 40, k: "ADJUSTED" });
    expect(a[7]).toMatchObject({ v: 40, k: "PROPAGATED" });
    expect(a[5].v).toBe(10); // meses anteriores intactos
  });

  it("copiar la base del año anterior desde la propia tabla: vista previa, guardado y sin pisar lo informado", async () => {
    const g = await prisma.clientGroup.create({ data: { name: "Alfa" } });
    await matrix({ groupId: g.id }, 2025, Array.from({ length: 12 }, (_, i) => ({ m: i + 1, v: 30 + i })));
    const m = await matrix({ groupId: g.id }, 2026, [{ m: 3, v: 99, kind: "ADJUSTED" }]);
    const rows: Row[] = [{ type: "group", id: g.id, version: m.version, steps: [{ type: "COPY", mode: "SAME_MONTH" }] }];
    const p = await previewMatrixBatch(admin.id, batch(rows), NOW);
    expect(p.rows[0].months.filter((x) => x.status === "changed")).toHaveLength(11);
    await save(rows);
    const a = await monthsOf(m.id);
    expect(a[3].v).toBe(99);
    expect(a[1]).toMatchObject({ v: 30, k: "COPIED" });
    // Sin nada que copiar el error se localiza en la fila.
    const again = await previewMatrixBatch(admin.id, batch([{ type: "group", id: g.id, version: m.version + 1, steps: [{ type: "COPY", mode: "SAME_MONTH" }] }]), NOW);
    expect(again.ok).toBe(false);
    expect(again.errors[0].key).toBe(batchKey("group", g.id));
  });

  it("el dominio puro produce el mismo resultado que el servidor (el navegador usa la misma función)", () => {
    const out = applySteps(emptyYear(), [{ type: "APPLY_FROM", month: 1, value: 65 }, { type: "APPLY_FROM", month: 6, value: 68 }, set(8, null)], { year: 2026, previous: emptyYear() });
    expect(out.after.map((s) => s?.value ?? null)).toEqual([65, 65, 65, 65, 65, 68, 68, null, 68, 68, 68, 68]);
    expect(out.after[0]?.kind).toBe("ADJUSTED");
    expect(out.after[1]?.kind).toBe("PROPAGATED");
  });
});

describe("conflictos concurrentes: localizados y atómicos", () => {
  it("una fila con versión antigua se marca en conflicto; NADA se guarda (ni siquiera las otras filas) y el borrador de las demás sigue siendo válido", async () => {
    const g1 = await prisma.clientGroup.create({ data: { name: "Alfa" } });
    const g2 = await prisma.clientGroup.create({ data: { name: "Beta" } });
    const m1 = await matrix({ groupId: g1.id }, 2026, [{ m: 1, v: 10 }]);
    const m2 = await matrix({ groupId: g2.id }, 2026, [{ m: 1, v: 20 }]);
    // Otra persona guarda la fila Beta entretanto.
    expect((await save([{ type: "group", id: g2.id, version: m2.version, steps: [set(1, 21)] }])).ok).toBe(true);
    const rows: Row[] = [{ type: "group", id: g1.id, version: m1.version, steps: [set(1, 11)] }, { type: "group", id: g2.id, version: m2.version, steps: [set(2, 22)] }];
    const r = await save(rows);
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual([expect.objectContaining({ key: batchKey("group", g2.id), kind: "CONFLICT" })]);
    expect((await monthsOf(m1.id))[1].v).toBe(10); // Alfa tampoco se aplicó: operación atómica
    expect((await monthsOf(m2.id))[1].v).toBe(21);
    // Con la versión actual de Beta el resto del borrador se guarda.
    const cur = await prisma.userMatrix.findUniqueOrThrow({ where: { id: m2.id } });
    expect((await save([rows[0], { ...rows[1], version: cur.version }])).ok).toBe(true);
    expect((await monthsOf(m1.id))[1].v).toBe(11);
    expect((await monthsOf(m2.id))[2].v).toBe(22);
  });

  it("un digest de otro borrador impide guardar lo que no se revisó", async () => {
    const g = await prisma.clientGroup.create({ data: { name: "Alfa" } });
    const rows: Row[] = [{ type: "group", id: g.id, version: 0, steps: [set(1, 5)] }];
    const p = await previewMatrixBatch(admin.id, batch(rows), NOW);
    await expect(applyMatrixBatch(admin.id, { ...batch([{ ...rows[0], steps: [set(1, 6)] }]), digest: p.digest }, NOW)).rejects.toThrow(/cambió después de revisarlo/);
    expect((await applyMatrixBatch(admin.id, { ...batch(rows), digest: p.digest }, NOW)).ok).toBe(true);
  });
});
