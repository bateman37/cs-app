import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AccessError } from "@/lib/access";
import { DomainError, StaleVersionError } from "@/server/errors";
import {
  createCatalogItem,
  createPerson,
  getPerson,
  listCatalog,
  listPeople,
  listPersonHistory,
  setCatalogItemActive,
  setPersonActive,
  updatePerson,
} from "@/server/personal";
import { addAlias, findPersonByAlias, setAliasActive, updateAlias } from "@/server/personal-aliases";
import { addTermPeriod, changeTerm, resolvePersonAt, updateTerm } from "@/server/personal-terms";
import { resolveTermsAt, aliasSearchValue } from "@/domain/personal";
import { makeUsers, resetDatabase } from "./helpers";

let admin: { id: string };
let reader: { id: string };
let cat: { teamA: string; teamB: string; level1: string; ana: string; dev: string };

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
  ({ admin, reader } = await makeUsers());
  // resetDatabase vacía el catálogo sembrado por la migración: se repone con los roles iniciales conocidos.
  const mk = async (kind: "TEAM" | "LEVEL" | "PMO_ROLE", name: string) => (await createCatalogItem(admin.id, { kind, name })).id;
  cat = {
    teamA: await mk("TEAM", "Equipo A"),
    teamB: await mk("TEAM", "Equipo B"),
    level1: await mk("LEVEL", "Nivel 1"),
    ana: await mk("PMO_ROLE", "ANA"),
    dev: await mk("PMO_ROLE", "DEV"),
  };
});

const counts = async () => ({
  people: await prisma.person.count(),
  aliases: await prisma.personAlias.count(),
  terms: await prisma.personTerm.count(),
  audits: await prisma.auditEvent.count(),
});

describe("Maestro único y alias", () => {
  it("una persona con varios alias conserva una identidad; PMO y rol viven en el mismo maestro", async () => {
    const p = await createPerson(admin.id, { name: "Persona Ejemplo" });
    await addAlias(admin.id, p.id, { system: "PAP", kind: "NAME", rawValue: "P. Ejemplo" });
    await addAlias(admin.id, p.id, { system: "PAP", kind: "EMAIL", rawValue: "Persona@Ejemplo.test" });
    await addAlias(admin.id, p.id, { system: "ZENDESK", kind: "ID", rawValue: "360000000001" });
    await addAlias(admin.id, p.id, { system: "WRIKE", kind: "NAME", rawValue: "Persona E." });
    await changeTerm(admin.id, p.id, { attribute: "PMO_MEMBER", value: "true", effectiveFrom: "2025-01-01" });
    await changeTerm(admin.id, p.id, { attribute: "PMO_ROLE", value: cat.ana, effectiveFrom: "2025-01-01" });
    expect(await prisma.person.count()).toBe(1);
    const full = await getPerson(admin.id, p.id);
    expect(full?.aliases).toHaveLength(4);
    expect(full?.terms.map((t) => t.attribute).sort()).toEqual(["PMO_MEMBER", "PMO_ROLE"]);
    const email = full!.aliases.find((a) => a.kind === "EMAIL")!;
    expect(email.rawValue).toBe("Persona@Ejemplo.test"); // valor original conservado
    expect(email.searchValue).toBe("persona@ejemplo.test");
  });

  it("una persona puede no tener alias en todos los sistemas y se busca por alias, ID y correo", async () => {
    const p = await createPerson(admin.id, { name: "Solo Zendesk" });
    await addAlias(admin.id, p.id, { system: "ZENDESK", kind: "ID", rawValue: "42" });
    await createPerson(admin.id, { name: "Otra Persona" });
    expect((await listPeople(admin.id, { q: "42" })).rows.map((r) => r.id)).toEqual([p.id]);
    expect((await listPeople(admin.id, { q: "otra" })).total).toBe(1);
  });

  it("nombre canónico único sin distinguir mayúsculas; una coincidencia parcial no fusiona personas", async () => {
    await createPerson(admin.id, { name: "Ana Pérez" });
    await expect(createPerson(admin.id, { name: "ana pérez" })).rejects.toBeInstanceOf(DomainError);
    const b = await createPerson(admin.id, { name: "Ana Pérez López" });
    const a = await addAlias(admin.id, b.id, { system: "PAP", kind: "NAME", rawValue: "Ana Pérez" });
    expect(a.personId).toBe(b.id);
    expect(await prisma.person.count()).toBe(2);
  });

  it("alias duplicado en otra persona con vigencia solapada se rechaza; sin solape se admite y se conservan los antiguos", async () => {
    const p1 = await createPerson(admin.id, { name: "Antigua" });
    const p2 = await createPerson(admin.id, { name: "Nueva" });
    await addAlias(admin.id, p1.id, { system: "PAP", kind: "NAME", rawValue: "jgarcia", validTo: "2025-07-01" });
    await expect(addAlias(admin.id, p2.id, { system: "PAP", kind: "NAME", rawValue: "JGarcia", validFrom: "2025-06-01" })).rejects.toThrow(/solapa/);
    await addAlias(admin.id, p2.id, { system: "PAP", kind: "NAME", rawValue: "jgarcia", validFrom: "2025-07-01" });
    const q = (value: string, date: string) => findPersonByAlias(reader.id, { system: "PAP", kind: "NAME", value, date });
    expect((await q("jgarcia", "2025-06-30"))?.personId).toBe(p1.id);
    expect((await q("JGARCIA", "2025-07-01"))?.personId).toBe(p2.id);
    // alias antiguo conservado aunque se desactive la persona
    await setPersonActive(admin.id, p1.id, false, { expectedVersion: 1 });
    expect((await q("jgarcia", "2025-06-30"))).toMatchObject({ personId: p1.id, isActive: false });
  });

  it("findPersonByAlias exige coincidencia exacta normalizada: nunca por similitud", async () => {
    const p = await createPerson(admin.id, { name: "Exacta" });
    await addAlias(admin.id, p.id, { system: "WRIKE", kind: "NAME", rawValue: "Maria  Lopez" });
    const q = (value: string) => findPersonByAlias(reader.id, { system: "WRIKE", kind: "NAME", value, date: "2026-01-01" });
    expect((await q("maria lopez"))?.personId).toBe(p.id);
    expect(await q("Maria")).toBeNull();
    expect(await q("Maria Lopez Garcia")).toBeNull();
    expect(await findPersonByAlias(reader.id, { system: "PAP", kind: "NAME", value: "maria lopez", date: "2026-01-01" })).toBeNull();
    expect(aliasSearchValue("ID", " 00123 ")).toBe("00123");
  });

  it("combinaciones sistema/tipo inválidas, IDs Zendesk no enteros y correos no válidos se rechazan", async () => {
    const p = await createPerson(admin.id, { name: "Validaciones" });
    await expect(addAlias(admin.id, p.id, { system: "ZENDESK", kind: "EMAIL", rawValue: "a@b.test" })).rejects.toBeInstanceOf(DomainError);
    await expect(addAlias(admin.id, p.id, { system: "WRIKE", kind: "EMAIL", rawValue: "a@b.test" })).rejects.toBeInstanceOf(DomainError);
    await expect(addAlias(admin.id, p.id, { system: "ZENDESK", kind: "ID", rawValue: "12.5" })).rejects.toBeInstanceOf(DomainError);
    await expect(addAlias(admin.id, p.id, { system: "PAP", kind: "EMAIL", rawValue: "no-es-correo" })).rejects.toBeInstanceOf(DomainError);
    expect(await prisma.personAlias.count()).toBe(0);
  });

  it("alta concurrente del mismo alias en dos personas: una sola prosperó, sin cambios parciales", async () => {
    const p1 = await createPerson(admin.id, { name: "Concurrente Uno" });
    const p2 = await createPerson(admin.id, { name: "Concurrente Dos" });
    const before = await counts();
    const mk = (id: string) => addAlias(admin.id, id, { system: "ZENDESK", kind: "ID", rawValue: "900000000777" });
    const results = await Promise.allSettled([mk(p1.id), mk(p2.id), mk(p1.id), mk(p2.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toBeInstanceOf(DomainError);
    const after = await counts();
    expect(after.aliases).toBe(before.aliases + 1);
    expect(after.audits).toBe(before.audits + 1);
    expect(after.people).toBe(2);
  });

  it("creación concurrente de la misma persona: una sola y sin duplicados", async () => {
    const r = await Promise.allSettled([createPerson(admin.id, { name: "Gemela" }), createPerson(admin.id, { name: "gemela" })]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.person.count()).toBe(1);
    expect(await prisma.auditEvent.count({ where: { entityType: "Person" } })).toBe(1);
  });

  it("desactivar y reactivar conserva historia y alias; una persona inactiva no admite alias nuevos", async () => {
    const p = await createPerson(admin.id, { name: "Baja Temporal" });
    const al = await addAlias(admin.id, p.id, { system: "PAP", kind: "NAME", rawValue: "baja" });
    await setPersonActive(admin.id, p.id, false, { expectedVersion: p.version });
    await expect(addAlias(admin.id, p.id, { system: "PAP", kind: "ID", rawValue: "9" })).rejects.toBeInstanceOf(DomainError);
    expect((await listPeople(admin.id, {})).total).toBe(0);
    expect((await listPeople(admin.id, { status: "inactive" })).total).toBe(1);
    await setPersonActive(admin.id, p.id, true, { expectedVersion: 2 });
    expect(await prisma.personAlias.count({ where: { id: al.id } })).toBe(1);
    const hist = await listPersonHistory(admin.id, p.id);
    expect(hist.rows.map((e) => e.action).sort()).toEqual(["CREATE", "CREATE", "DEACTIVATE", "REACTIVATE"]);
  });

  it("desactivar un alias libera el valor y reactivarlo revalida el conflicto", async () => {
    const p1 = await createPerson(admin.id, { name: "Uno" });
    const p2 = await createPerson(admin.id, { name: "Dos" });
    const a1 = await addAlias(admin.id, p1.id, { system: "PAP", kind: "ID", rawValue: "X1" });
    await setAliasActive(admin.id, a1.id, false, { expectedVersion: 1 });
    await addAlias(admin.id, p2.id, { system: "PAP", kind: "ID", rawValue: "X1" });
    await expect(setAliasActive(admin.id, a1.id, true, { expectedVersion: 2 })).rejects.toThrow(/solapa/);
  });
});

describe("Vigencias de equipo, nivel, PMO y rol", () => {
  it("resolver antes y después de un cambio de equipo devuelve la asignación correcta; la anterior queda en historia", async () => {
    const p = await createPerson(admin.id, { name: "Cambia Equipo" });
    await changeTerm(admin.id, p.id, { attribute: "TEAM", value: cat.teamA, effectiveFrom: "2025-01-01" });
    await changeTerm(admin.id, p.id, { attribute: "TEAM", value: cat.teamB, effectiveFrom: "2026-03-01" });
    const at = (d: string) => resolvePersonAt(reader.id, p.id, d);
    expect((await at("2025-06-15")).team?.name).toBe("Equipo A");
    expect((await at("2026-02-28")).team?.name).toBe("Equipo A");
    expect((await at("2026-03-01")).team?.name).toBe("Equipo B");
    expect((await at("2024-12-31")).team).toBeNull(); // antes de todo: sin informar
    expect(await prisma.personTerm.count({ where: { personId: p.id, attribute: "TEAM" } })).toBe(2);
  });

  it("nivel y equipo se resuelven por fecha; sin tramo = sin informar, nunca inferido", async () => {
    const p = await createPerson(admin.id, { name: "Con Nivel" });
    await changeTerm(admin.id, p.id, { attribute: "LEVEL", value: cat.level1, unknownStart: "on" });
    const r = await resolvePersonAt(admin.id, p.id, "2026-05-05");
    expect(r.level?.name).toBe("Nivel 1");
    expect(r.team).toBeNull();
    expect(r.pmoMember).toBeNull();
    expect(r.pmoRole).toBeNull();
  });

  it("el rol PMO se oculta si no pertenece a PMO y se cierra automáticamente al salir de PMO", async () => {
    const p = await createPerson(admin.id, { name: "Sale de PMO" });
    await changeTerm(admin.id, p.id, { attribute: "PMO_MEMBER", value: "true", effectiveFrom: "2025-01-01" });
    await changeTerm(admin.id, p.id, { attribute: "PMO_ROLE", value: cat.dev, effectiveFrom: "2025-01-01" });
    await changeTerm(admin.id, p.id, { attribute: "PMO_MEMBER", value: "false", effectiveFrom: "2026-01-01" });
    const at = (d: string) => resolvePersonAt(admin.id, p.id, d);
    expect(await at("2025-12-31")).toMatchObject({ pmoMember: true, pmoRole: { name: "DEV" } });
    expect(await at("2026-01-01")).toMatchObject({ pmoMember: false, pmoRole: null });
    const role = await prisma.personTerm.findFirstOrThrow({ where: { personId: p.id, attribute: "PMO_ROLE" } });
    expect(role.validTo?.toISOString().slice(0, 10)).toBe("2026-01-01"); // historia conservada
    expect(await prisma.auditEvent.count({ where: { personId: p.id, summary: { contains: "salida de PMO" } } })).toBe(1);
    // vuelve a PMO sin rol: no hay ANA/DEV por defecto
    await changeTerm(admin.id, p.id, { attribute: "PMO_MEMBER", value: "true", effectiveFrom: "2026-06-01" });
    expect(await at("2026-06-02")).toMatchObject({ pmoMember: true, pmoRole: null });
  });

  it("el rol exige pertenencia a PMO en su fecha de inicio y la resolución pura lo oculta aunque exista", async () => {
    const p = await createPerson(admin.id, { name: "Sin PMO" });
    await expect(changeTerm(admin.id, p.id, { attribute: "PMO_ROLE", value: cat.ana, effectiveFrom: "2025-01-01" })).rejects.toThrow(/PMO/);
    expect(await prisma.personTerm.count()).toBe(0);
    const res = resolveTermsAt(
      [
        { attribute: "PMO_MEMBER", flag: false, catalogItemId: null, catalogName: null, validFrom: "2025-01-01", validTo: null },
        { attribute: "PMO_ROLE", flag: null, catalogItemId: "x", catalogName: "ANA", validFrom: "2025-01-01", validTo: null },
      ],
      "2025-05-05",
    );
    expect(res.pmoRole).toBeNull();
  });

  it("solapamientos de vigencias rechazados al añadir y al corregir tramos", async () => {
    const p = await createPerson(admin.id, { name: "Solapes" });
    await addTermPeriod(admin.id, p.id, { attribute: "TEAM", value: cat.teamA, validFrom: "2025-01-01", validTo: "2025-07-01" });
    await expect(addTermPeriod(admin.id, p.id, { attribute: "TEAM", value: cat.teamB, validFrom: "2025-06-01", validTo: "2025-09-01" })).rejects.toThrow(/solapa/);
    const t2 = await addTermPeriod(admin.id, p.id, { attribute: "TEAM", value: cat.teamB, validFrom: "2025-07-01" });
    await expect(updateTerm(admin.id, t2.id, { value: cat.teamB, validFrom: "2025-03-01", expectedVersion: 1 })).rejects.toThrow(/solapan/);
    // la base también lo impide si se esquiva el servicio
    await expect(
      prisma.personTerm.create({ data: { personId: p.id, attribute: "TEAM", catalogItemId: cat.teamA, validFrom: new Date("2025-02-01"), validTo: new Date("2025-03-01") } }),
    ).rejects.toThrow();
  });

  it("cambio de valor idéntico, valores ajenos al catálogo y valores inactivos se rechazan", async () => {
    const p = await createPerson(admin.id, { name: "Catálogo" });
    await changeTerm(admin.id, p.id, { attribute: "TEAM", value: cat.teamA, effectiveFrom: "2025-01-01" });
    await expect(changeTerm(admin.id, p.id, { attribute: "TEAM", value: cat.teamA, effectiveFrom: "2025-06-01" })).rejects.toThrow(/nada que cambiar/);
    await expect(changeTerm(admin.id, p.id, { attribute: "TEAM", value: cat.level1, effectiveFrom: "2025-06-01" })).rejects.toBeInstanceOf(DomainError); // nivel ≠ equipo
    await expect(changeTerm(admin.id, p.id, { attribute: "TEAM", value: "Equipo B", effectiveFrom: "2025-06-01" })).rejects.toBeInstanceOf(DomainError); // por nombre no
    const item = await prisma.staffCatalogItem.findUniqueOrThrow({ where: { id: cat.teamB } });
    await setCatalogItemActive(admin.id, cat.teamB, false, { expectedVersion: item.version });
    await expect(changeTerm(admin.id, p.id, { attribute: "TEAM", value: cat.teamB, effectiveFrom: "2025-06-01" })).rejects.toThrow(/inactivo/);
    expect((await listCatalog(admin.id, "TEAM", { onlyActive: true })).map((c) => c.name)).toEqual(["Equipo A"]);
  });

  it("un tramo sin fecha de inicio se señala como fecha inicial por revisar", async () => {
    const p = await createPerson(admin.id, { name: "Fecha inicial desconocida" });
    await changeTerm(admin.id, p.id, { attribute: "TEAM", value: cat.teamA, unknownStart: "on" });
    expect((await resolvePersonAt(admin.id, p.id, "2026-01-01")).flags).toEqual([{ attribute: "TEAM", reason: "INITIAL_DATE_UNKNOWN" }]);
    await expect(changeTerm(admin.id, p.id, { attribute: "TEAM", value: cat.teamB, unknownStart: "on" })).rejects.toBeInstanceOf(DomainError);
    await changeTerm(admin.id, p.id, { attribute: "TEAM", value: cat.teamB, effectiveFrom: "2026-02-01" });
    expect((await resolvePersonAt(admin.id, p.id, "2026-03-01")).flags).toEqual([]);
  });

  it("filtros de la lista por equipo y PMO se resuelven a la fecha indicada", async () => {
    const a = await createPerson(admin.id, { name: "En A" });
    const b = await createPerson(admin.id, { name: "En B luego" });
    await changeTerm(admin.id, a.id, { attribute: "TEAM", value: cat.teamA, effectiveFrom: "2025-01-01" });
    await changeTerm(admin.id, b.id, { attribute: "TEAM", value: cat.teamA, effectiveFrom: "2025-01-01" });
    await changeTerm(admin.id, b.id, { attribute: "TEAM", value: cat.teamB, effectiveFrom: "2026-01-01" });
    await changeTerm(admin.id, b.id, { attribute: "PMO_MEMBER", value: "true", effectiveFrom: "2025-01-01" });
    const ids = async (q: Parameters<typeof listPeople>[1]) => (await listPeople(admin.id, q)).rows.map((r) => r.id).sort();
    expect(await ids({ teamId: cat.teamA, date: "2025-06-01" })).toEqual([a.id, b.id].sort());
    expect(await ids({ teamId: cat.teamA, date: "2026-06-01" })).toEqual([a.id]);
    expect(await ids({ pmo: "yes", date: "2026-06-01" })).toEqual([b.id]);
    expect(await ids({ pmo: "unknown", date: "2026-06-01" })).toEqual([a.id]);
    expect(await ids({ pmo: "no", date: "2026-06-01" })).toEqual([]);
  });
});

describe("Concurrencia, atomicidad y permisos", () => {
  it("una edición obsoleta no sobrescribe los cambios de otro administrador", async () => {
    const p = await createPerson(admin.id, { name: "Versionada" });
    await updatePerson(admin.id, p.id, { name: "Versionada A", expectedVersion: 1 });
    await expect(updatePerson(admin.id, p.id, { name: "Versionada B", expectedVersion: 1 })).rejects.toBeInstanceOf(StaleVersionError);
    expect((await prisma.person.findUniqueOrThrow({ where: { id: p.id } })).name).toBe("Versionada A");
    const al = await addAlias(admin.id, p.id, { system: "PAP", kind: "NAME", rawValue: "v" });
    await updateAlias(admin.id, al.id, { rawValue: "v2", expectedVersion: 1 });
    await expect(updateAlias(admin.id, al.id, { rawValue: "v3", expectedVersion: 1 })).rejects.toBeInstanceOf(StaleVersionError);
    const r = await Promise.allSettled([
      updatePerson(admin.id, p.id, { name: "Carrera 1", expectedVersion: 2 }),
      updatePerson(admin.id, p.id, { name: "Carrera 2", expectedVersion: 2 }),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });

  it("dos cambios de equipo simultáneos en la misma fecha: uno prospera y el otro revierte entero (cierre, alta y auditoría)", async () => {
    const p = await createPerson(admin.id, { name: "Carrera de equipos" });
    await changeTerm(admin.id, p.id, { attribute: "TEAM", value: cat.teamA, effectiveFrom: "2025-01-01" });
    const base = await counts();
    const r = await Promise.allSettled([
      changeTerm(admin.id, p.id, { attribute: "TEAM", value: cat.teamB, effectiveFrom: "2026-01-01" }),
      changeTerm(admin.id, p.id, { attribute: "TEAM", value: cat.teamB, effectiveFrom: "2026-01-01" }),
      changeTerm(admin.id, p.id, { attribute: "TEAM", value: cat.teamB, effectiveFrom: "2026-01-01" }),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const after = await counts();
    expect(after.terms).toBe(base.terms + 1);
    expect(after.audits).toBe(base.audits + 2); // cierre del tramo anterior + alta del nuevo, una sola vez
    expect((await resolvePersonAt(admin.id, p.id, "2026-06-01")).team?.name).toBe("Equipo B");
  });

  it("el cambio y su auditoría son atómicos: una validación fallida no deja rastro y un cambio correcto deja un evento", async () => {
    const p = await createPerson(admin.id, { name: "Atómica" });
    const before = await counts();
    // cierre de tramo + nuevo tramo + auditoría en la misma transacción; el segundo cambio falla en la base (catálogo inexistente)
    await expect(changeTerm(admin.id, p.id, { attribute: "TEAM", value: "no-existe", effectiveFrom: "2025-01-01" })).rejects.toBeInstanceOf(DomainError);
    expect(await counts()).toEqual(before);
    const ok = await changeTerm(admin.id, p.id, { attribute: "TEAM", value: cat.teamA, effectiveFrom: "2025-01-01" });
    const audits = await prisma.auditEvent.findMany({ where: { entityId: ok.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ personId: p.id, actorId: admin.id, entityType: "PersonTerm" });
  });

  it("Consulta puede leer, pero cualquier mutación forjada se rechaza sin cambios ni auditoría", async () => {
    const p = await createPerson(admin.id, { name: "Protegida" });
    const al = await addAlias(admin.id, p.id, { system: "PAP", kind: "NAME", rawValue: "prot" });
    const t = await changeTerm(admin.id, p.id, { attribute: "TEAM", value: cat.teamA, effectiveFrom: "2025-01-01" });
    const before = await counts();
    await expect(listPeople(reader.id)).resolves.toMatchObject({ total: 1 });
    await expect(getPerson(reader.id, p.id)).resolves.toBeTruthy();
    await expect(listCatalog(reader.id)).resolves.toHaveLength(5);
    await expect(resolvePersonAt(reader.id, p.id, "2025-02-02")).resolves.toBeTruthy();
    const attempts: Array<() => Promise<unknown>> = [
      () => createPerson(reader.id, { name: "Forjada" }),
      () => updatePerson(reader.id, p.id, { name: "X", expectedVersion: 1 }),
      () => setPersonActive(reader.id, p.id, false, { expectedVersion: 1 }),
      () => addAlias(reader.id, p.id, { system: "PAP", kind: "ID", rawValue: "1" }),
      () => updateAlias(reader.id, al.id, { rawValue: "x", expectedVersion: 1 }),
      () => setAliasActive(reader.id, al.id, false, { expectedVersion: 1 }),
      () => changeTerm(reader.id, p.id, { attribute: "TEAM", value: cat.teamB, effectiveFrom: "2026-01-01" }),
      () => addTermPeriod(reader.id, p.id, { attribute: "LEVEL", value: cat.level1 }),
      () => updateTerm(reader.id, t.id, { value: cat.teamA, expectedVersion: 1 }),
      () => createCatalogItem(reader.id, { kind: "TEAM", name: "Forjado" }),
      () => setCatalogItemActive(reader.id, cat.teamA, false, { expectedVersion: 1 }),
      () => listPersonHistory(reader.id, p.id),
    ];
    for (const attempt of attempts) await expect(attempt()).rejects.toBeInstanceOf(AccessError);
    expect(await counts()).toEqual(before);
  });

  it("un actor inexistente o inactivo no puede leer ni mutar", async () => {
    await expect(createPerson("no-existe", { name: "X" })).rejects.toBeInstanceOf(AccessError);
    await prisma.user.update({ where: { id: admin.id }, data: { isActive: false } });
    await expect(createPerson(admin.id, { name: "Y" })).rejects.toBeInstanceOf(AccessError);
    await expect(listPeople(admin.id)).rejects.toBeInstanceOf(AccessError);
    expect(await prisma.person.count()).toBe(0);
  });

  it("los alias no crean cuentas ni dan permisos: el maestro no toca las cuentas de acceso", async () => {
    const users = await prisma.user.count();
    const p = await createPerson(admin.id, { name: "No es cuenta" });
    await addAlias(admin.id, p.id, { system: "PAP", kind: "EMAIL", rawValue: "admin@test.local" });
    expect(await prisma.user.count()).toBe(users);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } })).role).toBe("ADMIN");
  });
});
