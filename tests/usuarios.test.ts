import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { AccessError } from "@/lib/access";
import { DomainError, StaleVersionError } from "@/server/errors";
import { createGroup, setGroupActive } from "@/server/groups";
import { createClient, createImplementation } from "@/server/clients";
import * as audit from "@/server/audit";
import {
  confirmMatrixChange,
  copyFromPreviousYear,
  getMatrix,
  initializeHistoric,
  listMatrices,
  previewCopyFromPreviousYear,
  previewInitializeHistoric,
  previewMatrixChange,
  userMonthsExposure,
  usersAtCutoff,
  usersAtMonth,
} from "@/server/usuarios";
import { makeUsers, resetDatabase } from "./helpers";

const NOW26 = { now: new Date("2026-10-15T10:00:00Z") };
const NOW27 = { now: new Date("2027-03-10T10:00:00Z") };
const NOW25 = { now: new Date("2025-06-10T10:00:00Z") };

let admin: { id: string };
let reader: { id: string };
let g: { id: string };
let c: { id: string };
let impl: { id: string };

const G = () => ({ type: "group" as const, id: g.id });
const C = () => ({ type: "client" as const, id: c.id });
const I = () => ({ type: "implementation" as const, id: impl.id });
const t = (s: { type: string; id: string }) => ({ targetType: s.type, targetId: s.id });

beforeEach(async () => {
  await resetDatabase();
  ({ admin, reader } = await makeUsers());
  g = await createGroup(admin.id, { name: "Grupo Usuarios" });
  c = await createClient(admin.id, { name: "Cliente Usuarios", groupId: g.id });
  impl = await createImplementation(admin.id, c.id, { name: "Implantación A" });
  vi.restoreAllMocks();
});

async function counts() {
  const [matrices, months, audits] = await Promise.all([prisma.userMatrix.count(), prisma.userMatrixMonth.count(), prisma.auditEvent.count()]);
  return { matrices, months, audits };
}

/** 2025 = 65 histórico y 2026 copiado: la base de los ejemplos del contrato. */
async function seed2026(scope: { type: "group" | "client" | "implementation"; id: string } = C(), value = 65) {
  await initializeHistoric(admin.id, { ...t(scope), value, source: "Valor inicial indicado por el administrador" });
  const p = await previewCopyFromPreviousYear(admin.id, { ...t(scope), year: 2026 }, NOW26);
  await copyFromPreviousYear(admin.id, { ...t(scope), year: 2026, expectedVersion: p.version }, NOW26);
}

describe("Cambio 65 a 68 y magnitudes", () => {
  it("65 enero–mayo y 68 desde junio: 665 usuarios mes hasta octubre y stock 68", async () => {
    await seed2026();
    const m = await getMatrix(admin.id, C(), 2026, NOW26);
    expect(m.months.every((x) => x.value === 65 && x.kind === "COPIED")).toBe(true);
    const pv = await previewMatrixChange(admin.id, { ...t(C()), year: 2026, op: "APPLY_FROM", month: 6, value: 68 }, NOW26);
    expect(pv.plan.changedCount).toBe(7);
    await confirmMatrixChange(admin.id, { ...t(C()), year: 2026, op: "APPLY_FROM", month: 6, value: 68, expectedVersion: pv.version }, NOW26);
    const after = await getMatrix(admin.id, C(), 2026, NOW26);
    expect(after.months.map((x) => x.value)).toEqual([65, 65, 65, 65, 65, 68, 68, 68, 68, 68, 68, 68]);
    expect(after.months[5].kind).toBe("ADJUSTED");
    expect(after.months[6].kind).toBe("PROPAGATED");
    const e = await userMonthsExposure(admin.id, C(), { from: "2026-01-01", to: "2026-10-31" });
    expect(e.userMonths).toBe(665);
    expect(e.complete).toBe(true);
    const stock = await usersAtCutoff(admin.id, C(), "2026-10-31");
    expect(stock.value).toBe(68);
    expect(stock.status).toBe("informado");
    // mes parcial: 16–30 de junio = 15/30 de 68
    const partial = await userMonthsExposure(admin.id, C(), { from: "2026-06-16", to: "2026-06-30" });
    expect(partial.userMonths).toBeCloseTo(34, 10);
  });

  it("editar un mes no propaga y aplicar desde junio preserva septiembre explícito; la vista previa lo muestra", async () => {
    await seed2026();
    let v = (await getMatrix(admin.id, C(), 2026, NOW26)).version;
    await confirmMatrixChange(admin.id, { ...t(C()), year: 2026, op: "SET_MONTH", month: 9, value: 70, expectedVersion: v }, NOW26);
    let m = await getMatrix(admin.id, C(), 2026, NOW26);
    expect(m.months.map((x) => x.value)).toEqual([65, 65, 65, 65, 65, 65, 65, 65, 70, 65, 65, 65]);
    expect(m.months[8].kind).toBe("ADJUSTED");
    v = m.version;
    const pv = await previewMatrixChange(admin.id, { ...t(C()), year: 2026, op: "APPLY_FROM", month: 6, value: 68 }, NOW26);
    expect(pv.plan.protectedMonths).toEqual([9]);
    expect(pv.plan.rows.filter((r) => r.status === "changed").map((r) => r.month)).toEqual([6, 7, 8, 10, 11, 12]);
    expect(pv.plan.rows[0].status).toBe("unchanged");
    // la vista previa no escribe
    expect((await getMatrix(admin.id, C(), 2026, NOW26)).version).toBe(v);
    await confirmMatrixChange(admin.id, { ...t(C()), year: 2026, op: "APPLY_FROM", month: 6, value: 68, expectedVersion: v }, NOW26);
    m = await getMatrix(admin.id, C(), 2026, NOW26);
    expect(m.months.map((x) => x.value)).toEqual([65, 65, 65, 65, 65, 68, 68, 68, 70, 68, 68, 68]);
    // autoría, revisión y auditoría
    expect(m.months[5].revision).toBe(2);
    expect(m.months[5].updatedBy).toContain("admin@test.local");
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { entityType: "UserMatrix", action: "UPDATE" }, orderBy: { at: "desc" } });
    expect(ev.clientId).toBe(c.id);
    expect(ev.groupId).toBe(g.id);
    expect(JSON.stringify(ev.after)).toContain('"month":6');
    expect(ev.actorEmail).toBe("admin@test.local");
  });

  it("valores no enteros, negativos o vacíos se rechazan sin cambios", async () => {
    await seed2026();
    const before = await counts();
    const v = (await getMatrix(admin.id, C(), 2026, NOW26)).version;
    for (const value of ["6.5", "-3", "", "abc", "1e2"]) {
      await expect(confirmMatrixChange(admin.id, { ...t(C()), year: 2026, op: "SET_MONTH", month: 3, value, expectedVersion: v }, NOW26)).rejects.toBeInstanceOf(DomainError);
    }
    expect(await counts()).toEqual(before);
  });

  it("no hay cambios que guardar si el valor ya coincide", async () => {
    await seed2026();
    const v = (await getMatrix(admin.id, C(), 2026, NOW26)).version;
    await confirmMatrixChange(admin.id, { ...t(C()), year: 2026, op: "SET_MONTH", month: 3, value: 65, expectedVersion: v }, NOW26); // pasa de COPIED a ADJUSTED
    const v2 = (await getMatrix(admin.id, C(), 2026, NOW26)).version;
    await expect(confirmMatrixChange(admin.id, { ...t(C()), year: 2026, op: "SET_MONTH", month: 3, value: 65, expectedVersion: v2 }, NOW26)).rejects.toThrow(/No hay cambios/);
  });
});

describe("Histórico 2025", () => {
  it("inicializar 2025 vacío crea doce valores iguales y bloqueados; repetir no duplica", async () => {
    const r1 = await initializeHistoric(admin.id, { ...t(C()), value: 65, source: "Valor inicial" });
    expect(r1.status).toBe("created");
    const m = await getMatrix(admin.id, C(), 2025, NOW26);
    expect(m.months.every((x) => x.value === 65 && x.kind === "INITIAL" && x.isLocked && x.source === "Valor inicial")).toBe(true);
    const c1 = await counts();
    const r2 = await initializeHistoric(admin.id, { ...t(C()), value: 65, source: "Valor inicial" });
    expect(r2.status).toBe("unchanged");
    expect(await counts()).toEqual(c1);
    expect(c1.months).toBe(12);
    const initAudits = await prisma.auditEvent.count({ where: { action: "INITIALIZE" } });
    expect(initAudits).toBe(1);
  });

  it("con otro valor, o con datos incompatibles, se rechaza sin sobrescribir", async () => {
    await initializeHistoric(admin.id, { ...t(C()), value: 65, source: "Valor inicial" });
    const c1 = await counts();
    await expect(initializeHistoric(admin.id, { ...t(C()), value: 70, source: "Otro" })).rejects.toThrow(/No se sobrescribe/);
    expect(await counts()).toEqual(c1);
    expect((await getMatrix(admin.id, C(), 2025, NOW26)).months.every((x) => x.value === 65)).toBe(true);
    // dato parcial incompatible en otro ámbito
    await seedPartial2025(G());
    await expect(initializeHistoric(admin.id, { ...t(G()), value: 80, source: "Fuente" })).rejects.toBeInstanceOf(DomainError);
    expect((await getMatrix(admin.id, G(), 2025, NOW26)).months.filter((x) => x.value !== null)).toHaveLength(1);
    const pv = await previewInitializeHistoric(admin.id, { ...t(G()), value: 80, source: "Fuente" });
    expect(pv.status).toBe("conflict");
  });

  async function seedPartial2025(scope: { type: "group" | "client" | "implementation"; id: string }) {
    const m = await prisma.userMatrix.create({ data: { groupId: scope.id, year: 2025 } });
    await prisma.userMatrixMonth.create({ data: { matrixId: m.id, month: 3, value: 10, kind: "ADJUSTED", source: "x", updatedById: admin.id } });
  }

  it("cambiar un histórico ya informado se rechaza también por petición directa", async () => {
    await initializeHistoric(admin.id, { ...t(C()), value: 65, source: "Valor inicial" });
    const v = (await getMatrix(admin.id, C(), 2025, NOW26)).version;
    const before = await counts();
    for (const op of ["SET_MONTH", "APPLY_FROM"]) {
      await expect(confirmMatrixChange(admin.id, { ...t(C()), year: 2025, op, month: 6, value: 99, expectedVersion: v }, NOW26)).rejects.toThrow(/histórico fijo/);
      // incluso si el reloj estuviera en 2025, el mes bloqueado no se edita
      await expect(confirmMatrixChange(admin.id, { ...t(C()), year: 2025, op, month: 6, value: 99, expectedVersion: v }, NOW25)).rejects.toThrow(/bloqueado/);
    }
    await expect(previewMatrixChange(admin.id, { ...t(C()), year: 2025, op: "SET_MONTH", month: 6, value: 99 }, NOW26)).rejects.toBeInstanceOf(DomainError);
    expect(await counts()).toEqual(before);
  });

  it("grupo y cliente se inicializan por separado: no se copia el dato del grupo al cliente", async () => {
    await initializeHistoric(admin.id, { ...t(G()), value: 100, source: "Fuente privada (solo grupo)" });
    expect((await getMatrix(admin.id, G(), 2025, NOW26)).months[0].value).toBe(100);
    for (const s of [C(), I()]) {
      const m = await getMatrix(admin.id, s, 2025, NOW26);
      expect(m.months.every((x) => x.value === null && x.status === "sin informar")).toBe(true);
    }
    expect(await prisma.userMatrix.count()).toBe(1);
  });
});

describe("Año corriente calculado en servidor", () => {
  it("con el reloj en 2027, 2026 deja de ser editable y 2027 pasa a serlo", async () => {
    await seed2026();
    const v = (await getMatrix(admin.id, C(), 2026, NOW26)).version;
    await expect(confirmMatrixChange(admin.id, { ...t(C()), year: 2026, op: "SET_MONTH", month: 3, value: 1, expectedVersion: v }, NOW27)).rejects.toThrow(/año anterior/);
    expect((await getMatrix(admin.id, C(), 2026, NOW27)).editable).toBe(false);
    expect((await getMatrix(admin.id, C(), 2027, NOW27)).editable).toBe(true);
    await confirmMatrixChange(admin.id, { ...t(C()), year: 2027, op: "SET_MONTH", month: 1, value: 7, expectedVersion: 0 }, NOW27);
    expect((await getMatrix(admin.id, C(), 2027, NOW27)).months[0].value).toBe(7);
  });

  it("un año futuro no es un atajo para editar el actual", async () => {
    const before = await counts();
    await expect(confirmMatrixChange(admin.id, { ...t(C()), year: 2027, op: "SET_MONTH", month: 1, value: 5, expectedVersion: 0 }, NOW26)).rejects.toThrow(/año futuro/);
    await expect(copyFromPreviousYear(admin.id, { ...t(C()), year: 2027, expectedVersion: 0 }, NOW26)).rejects.toThrow(/año futuro/);
    expect(await counts()).toEqual(before);
  });
});

describe("Nulos, cero y copia inicial", () => {
  it("sin dato no se convierte en cero; cero confirmado se conserva; exposición incompleta se identifica", async () => {
    await confirmMatrixChange(admin.id, { ...t(C()), year: 2026, op: "SET_MONTH", month: 1, value: 0, expectedVersion: 0 }, NOW26);
    await confirmMatrixChange(admin.id, { ...t(C()), year: 2026, op: "SET_MONTH", month: 3, value: 12, expectedVersion: 1 }, NOW26);
    const m = await getMatrix(admin.id, C(), 2026, NOW26);
    expect(m.months[0]).toMatchObject({ value: 0, status: "cero confirmado" });
    expect(m.months[1]).toMatchObject({ value: null, status: "sin informar" });
    expect(await prisma.userMatrixMonth.count()).toBe(2); // febrero no tiene fila: no hay ceros de relleno
    expect(await usersAtMonth(admin.id, C(), 2026, 2)).toMatchObject({ value: null, status: "sin informar" });
    expect(await usersAtMonth(admin.id, C(), 2026, 1)).toMatchObject({ value: 0, status: "cero confirmado" });
    const inc = await userMonthsExposure(admin.id, C(), { from: "2026-01-01", to: "2026-03-31" });
    expect(inc.complete).toBe(false);
    expect(inc.userMonths).toBeNull();
    expect(inc.missingMonths).toEqual([{ year: 2026, month: 2 }]);
    const ok = await userMonthsExposure(admin.id, C(), { from: "2026-03-01", to: "2026-03-31" });
    expect(ok).toMatchObject({ complete: true, userMonths: 12 });
    const zero = await userMonthsExposure(admin.id, C(), { from: "2026-01-01", to: "2026-01-31" });
    expect(zero).toMatchObject({ complete: true, userMonths: 0 });
  });

  it("usuarios compartidos: grupo, cliente e implantación son datos independientes", async () => {
    await seed2026(G(), 100);
    await seed2026(C(), 60);
    expect((await usersAtMonth(admin.id, G(), 2026, 5)).value).toBe(100);
    expect((await usersAtMonth(admin.id, C(), 2026, 5)).value).toBe(60); // no suma ni iguala al grupo
    const impl26 = await userMonthsExposure(admin.id, I(), { from: "2026-01-01", to: "2026-12-31" });
    expect(impl26.complete).toBe(false);
    expect(impl26.userMonths).toBeNull(); // falta de dato, no un reparto
    expect((await usersAtMonth(admin.id, I(), 2026, 5)).value).toBeNull();
    // cambiar el grupo no toca el cliente
    const v = (await getMatrix(admin.id, G(), 2026, NOW26)).version;
    await confirmMatrixChange(admin.id, { ...t(G()), year: 2026, op: "APPLY_FROM", month: 1, value: 90, expectedVersion: v }, NOW26);
    expect((await usersAtMonth(admin.id, C(), 2026, 5)).value).toBe(60);
  });

  it("copiar 2025 a 2026 no pisa ajustes; sin fuente conserva huecos y permite edición manual", async () => {
    // sin fuente
    const none = await previewCopyFromPreviousYear(admin.id, { ...t(C()), year: 2026 }, NOW26);
    expect(none.canApply).toBe(false);
    expect(none.message).toMatch(/No hay datos de 2025/);
    await expect(copyFromPreviousYear(admin.id, { ...t(C()), year: 2026, expectedVersion: 0 }, NOW26)).rejects.toThrow(/No hay datos de 2025/);
    expect((await getMatrix(admin.id, C(), 2026, NOW26)).months.every((x) => x.value === null)).toBe(true);
    await confirmMatrixChange(admin.id, { ...t(C()), year: 2026, op: "SET_MONTH", month: 4, value: 66, expectedVersion: 0 }, NOW26);
    // con fuente parcial: 2025 con solo marzo informado (dato preexistente) y abril ya ajustado en 2026
    const m25 = await prisma.userMatrix.create({ data: { clientId: c.id, year: 2025 } });
    await prisma.userMatrixMonth.createMany({
      data: [3, 4].map((month) => ({ matrixId: m25.id, month, value: 65, kind: "INITIAL" as const, isLocked: true, source: "x", updatedById: admin.id })),
    });
    const v = (await getMatrix(admin.id, C(), 2026, NOW26)).version;
    const pv = await previewCopyFromPreviousYear(admin.id, { ...t(C()), year: 2026 }, NOW26);
    expect(pv.plan.rows.filter((r) => r.status === "changed").map((r) => r.month)).toEqual([3]);
    await copyFromPreviousYear(admin.id, { ...t(C()), year: 2026, expectedVersion: v }, NOW26);
    const m = await getMatrix(admin.id, C(), 2026, NOW26);
    expect(m.months[2]).toMatchObject({ value: 65, kind: "COPIED", source: "Copia de 2025-03" });
    expect(m.months[3]).toMatchObject({ value: 66, kind: "ADJUSTED" }); // no pisado
    expect(m.months[0].value).toBeNull(); // sin origen: hueco
  });
});

describe("Concurrencia y atomicidad", () => {
  it("dos confirmaciones con la misma versión: una gana, la otra falla sin cambios parciales", async () => {
    await seed2026();
    const v = (await getMatrix(admin.id, C(), 2026, NOW26)).version;
    const run = (value: number) =>
      confirmMatrixChange(admin.id, { ...t(C()), year: 2026, op: "APPLY_FROM", month: 2, value, expectedVersion: v }, NOW26);
    const res = await Promise.allSettled([run(70), run(80)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = res.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(StaleVersionError);
    const m = await getMatrix(admin.id, C(), 2026, NOW26);
    expect(new Set(m.months.slice(1).map((x) => x.value)).size).toBe(1); // un solo valor, no mezcla
    expect(m.version).toBe(v + 1);
  });

  it("creación concurrente de la cabecera con versión 0: solo una prospera", async () => {
    const run = (value: number) =>
      confirmMatrixChange(admin.id, { ...t(C()), year: 2026, op: "SET_MONTH", month: 5, value, expectedVersion: 0 }, NOW26);
    const res = await Promise.allSettled([run(1), run(2), run(3)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.userMatrix.count()).toBe(1);
    expect(await prisma.userMatrixMonth.count()).toBe(1);
    expect(await prisma.auditEvent.count({ where: { entityType: "UserMatrix" } })).toBe(1);
  });

  it("inicializaciones simultáneas del mismo histórico: doce valores y una sola auditoría", async () => {
    const run = () => initializeHistoric(admin.id, { ...t(C()), value: 50, source: "Fuente" });
    const res = await Promise.all([run(), run(), run()]);
    expect(res.filter((r) => r.status === "created")).toHaveLength(1);
    expect(await prisma.userMatrixMonth.count()).toBe(12);
    expect(await prisma.auditEvent.count({ where: { action: "INITIALIZE" } })).toBe(1);
  });

  it("si falla la auditoría, el cambio de la matriz se deshace entero", async () => {
    await seed2026();
    const v = (await getMatrix(admin.id, C(), 2026, NOW26)).version;
    const before = await counts();
    const snapshot = await prisma.userMatrixMonth.findMany({ orderBy: [{ matrixId: "asc" }, { month: "asc" }] });
    vi.spyOn(audit, "recordAudit").mockRejectedValueOnce(new Error("fallo simulado de auditoría"));
    await expect(confirmMatrixChange(admin.id, { ...t(C()), year: 2026, op: "APPLY_FROM", month: 3, value: 99, expectedVersion: v }, NOW26)).rejects.toThrow(/fallo simulado/);
    expect(await counts()).toEqual(before);
    expect(await prisma.userMatrixMonth.findMany({ orderBy: [{ matrixId: "asc" }, { month: "asc" }] })).toEqual(snapshot);
    expect((await getMatrix(admin.id, C(), 2026, NOW26)).version).toBe(v); // la versión tampoco avanzó
  });
});

describe("Permisos y ámbito", () => {
  it("Consulta lee la matriz pero no muta ni inicializa; sin cambios ni auditoría", async () => {
    await seed2026();
    const before = await counts();
    const v = (await getMatrix(reader.id, C(), 2026, NOW26)).version;
    await expect(getMatrix(reader.id, C(), 2026, NOW26)).resolves.toMatchObject({ year: 2026 });
    await expect(listMatrices(reader.id, { year: 2026, scopeType: "client" })).resolves.toMatchObject({ total: 1 });
    await expect(usersAtMonth(reader.id, C(), 2026, 3)).resolves.toMatchObject({ value: 65 });
    const attempts: Array<() => Promise<unknown>> = [
      () => confirmMatrixChange(reader.id, { ...t(C()), year: 2026, op: "SET_MONTH", month: 3, value: 1, expectedVersion: v }, NOW26),
      () => previewMatrixChange(reader.id, { ...t(C()), year: 2026, op: "SET_MONTH", month: 3, value: 1 }, NOW26),
      () => initializeHistoric(reader.id, { ...t(G()), value: 5, source: "x" }),
      () => previewInitializeHistoric(reader.id, { ...t(G()), value: 5, source: "x" }),
      () => copyFromPreviousYear(reader.id, { ...t(G()), year: 2026, expectedVersion: 0 }, NOW26),
      () => confirmMatrixChange("no-existe", { ...t(C()), year: 2026, op: "SET_MONTH", month: 3, value: 1, expectedVersion: v }, NOW26),
    ];
    for (const a of attempts) await expect(a()).rejects.toBeInstanceOf(AccessError);
    expect(await counts()).toEqual(before);
  });

  it("un administrador desactivado ya no puede escribir", async () => {
    await prisma.user.update({ where: { id: admin.id }, data: { isActive: false } });
    await expect(initializeHistoric(admin.id, { ...t(C()), value: 5, source: "x" })).rejects.toBeInstanceOf(AccessError);
    expect(await counts()).toEqual({ matrices: 0, months: 0, audits: expect.any(Number) });
  });

  it("un ámbito inactivo no admite escrituras pero sigue consultándose", async () => {
    await seed2026(G(), 40);
    const v = (await getMatrix(admin.id, G(), 2026, NOW26)).version;
    const gv = (await prisma.clientGroup.findUniqueOrThrow({ where: { id: g.id } })).version;
    await setGroupActive(admin.id, g.id, false, { expectedVersion: gv });
    await expect(confirmMatrixChange(admin.id, { ...t(G()), year: 2026, op: "SET_MONTH", month: 2, value: 1, expectedVersion: v }, NOW26)).rejects.toThrow(/inactivo/);
    const m = await getMatrix(admin.id, G(), 2026, NOW26);
    expect(m.editable).toBe(false);
    expect(m.months[1].value).toBe(40);
  });
});

describe("Listado e integridad", () => {
  it("la lista de la matriz muestra nulos como sin informar y reutiliza los maestros existentes", async () => {
    await seed2026(C(), 65);
    const c2 = await createClient(admin.id, { name: "Otro Cliente", groupId: g.id });
    const l = await listMatrices(admin.id, { year: 2026, scopeType: "client" });
    expect(l.total).toBe(2);
    const own = l.rows.find((r) => r.id === c.id)!;
    expect(own.values.every((x) => x === 65)).toBe(true);
    expect(own.context).toBe("Grupo Usuarios");
    expect(l.rows.find((r) => r.id === c2.id)!.values.every((x) => x === null)).toBe(true);
    const search = await listMatrices(admin.id, { year: 2026, scopeType: "client", q: "otro" });
    expect(search.rows.map((r) => r.id)).toEqual([c2.id]);
    expect((await listMatrices(admin.id, { year: 2026, scopeType: "implementation" })).total).toBe(1);
    expect((await listMatrices(admin.id, { year: 2026, scopeType: "group" })).total).toBe(1);
  });

  it("la base impide duplicados, meses fuera de rango, negativos y referencias inexistentes", async () => {
    const m = await prisma.userMatrix.create({ data: { clientId: c.id, year: 2026 } });
    await expect(prisma.userMatrix.create({ data: { clientId: c.id, year: 2026 } })).rejects.toThrow();
    await expect(prisma.userMatrix.create({ data: { clientId: c.id, groupId: g.id, year: 2027 } })).rejects.toThrow();
    await expect(prisma.userMatrix.create({ data: { year: 2027 } })).rejects.toThrow();
    const base = { matrixId: m.id, kind: "ADJUSTED" as const, source: "x", updatedById: admin.id };
    await prisma.userMatrixMonth.create({ data: { ...base, month: 1, value: 0 } });
    await expect(prisma.userMatrixMonth.create({ data: { ...base, month: 1, value: 5 } })).rejects.toThrow();
    await expect(prisma.userMatrixMonth.create({ data: { ...base, month: 13, value: 5 } })).rejects.toThrow();
    await expect(prisma.userMatrixMonth.create({ data: { ...base, month: 2, value: -1 } })).rejects.toThrow();
    await expect(prisma.userMatrix.create({ data: { clientId: "no-existe", year: 2028 } })).rejects.toThrow();
  });
});
