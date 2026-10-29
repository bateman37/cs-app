import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AccessError } from "@/lib/access";
import { DomainError, StaleVersionError } from "@/server/errors";
import { createGroup, listGroups, setGroupActive, updateGroup } from "@/server/groups";
import {
  createClient,
  createImplementation,
  listClients,
  setClientActive,
  updateClient,
  getClient,
} from "@/server/clients";
import { createIdentity, setIdentityActive } from "@/server/identities";
import { addTermPeriod, changeTerm, valueAt } from "@/server/terms";
import { createMilestone } from "@/server/milestones";
import { listHistory } from "@/server/history";
import { adminTransaction } from "@/server/tx";
import { recordAudit } from "@/server/audit";
import { counts, makeUsers, resetDatabase } from "./helpers";

let admin: { id: string };
let reader: { id: string };

beforeAll(async () => {
  await resetDatabase();
});
beforeEach(async () => {
  await resetDatabase();
  ({ admin, reader } = await makeUsers());
});

async function groupWithClients() {
  const g = await createGroup(admin.id, { name: "Grupo Prueba" });
  const c1 = await createClient(admin.id, { name: "Cliente Uno", groupId: g.id });
  const c2 = await createClient(admin.id, { name: "Cliente Dos", groupId: g.id });
  return { g, c1, c2 };
}

describe("Perfil Consulta y permisos en servicio", () => {
  it("Consulta lee pero cualquier mutación forjada se rechaza sin tocar datos ni auditoría", async () => {
    const { g, c1 } = await groupWithClients();
    const before = await counts();
    await expect(listGroups(reader.id)).resolves.toMatchObject({ total: 1 });
    await expect(listClients(reader.id)).resolves.toMatchObject({ total: 2 });

    const attempts: Array<() => Promise<unknown>> = [
      () => createGroup(reader.id, { name: "Forjado" }),
      () => updateGroup(reader.id, g.id, { name: "X", expectedVersion: 1 }),
      () => setGroupActive(reader.id, g.id, false, { expectedVersion: 1 }),
      () => createClient(reader.id, { name: "Forjado" }),
      () => setClientActive(reader.id, c1.id, false, { expectedVersion: 1 }),
      () => createIdentity(reader.id, { system: "ZENDESK", kind: "ORG_ID", rawValue: "1", targetType: "client", targetId: c1.id }),
      () => changeTerm(reader.id, { attribute: "HOSTING", value: "OP", targetType: "client", targetId: c1.id, unknownStart: "on" }),
      () => createMilestone(reader.id, { type: "START", date: "2026-01-01", targetType: "client", targetId: c1.id }),
      () => listHistory(reader.id, { clientId: c1.id }),
    ];
    for (const attempt of attempts) await expect(attempt()).rejects.toBeInstanceOf(AccessError);
    expect(await counts()).toEqual(before);
  });

  it("un actor inexistente o inactivo no puede leer ni escribir", async () => {
    await expect(listGroups("no-existe")).rejects.toBeInstanceOf(AccessError);
    await prisma.user.update({ where: { id: admin.id }, data: { isActive: false } });
    await expect(createGroup(admin.id, { name: "Y" })).rejects.toBeInstanceOf(AccessError);
  });
});

describe("Alta y persistencia", () => {
  it("un grupo con dos Clientes distintos se guarda y se recupera", async () => {
    const { g } = await groupWithClients();
    const read = await prisma.clientGroup.findUniqueOrThrow({ where: { id: g.id }, include: { clients: true } });
    expect(read.clients.map((c) => c.name).sort()).toEqual(["Cliente Dos", "Cliente Uno"]);
    const list = await listClients(admin.id, { groupId: g.id });
    expect(list.total).toBe(2);
  });

  it("rechaza nombres duplicados sin distinguir mayúsculas y valida campos", async () => {
    await createGroup(admin.id, { name: "Acme" });
    await expect(createGroup(admin.id, { name: "  acme " })).rejects.toBeInstanceOf(DomainError);
    await expect(createGroup(admin.id, { name: "   " })).rejects.toMatchObject({ fields: { name: expect.any(String) } });
  });

  it("un cliente puede quedar sin grupo asignado y se filtra como tal; la equivalencia Zendesk pendiente se detecta", async () => {
    const c = await createClient(admin.id, { name: "Suelto" });
    expect(c.groupId).toBeNull();
    expect((await listClients(admin.id, { groupId: "none" })).total).toBe(1);
    expect((await listClients(admin.id, { pendingZendesk: true })).total).toBe(1);
    await createIdentity(admin.id, { system: "ZENDESK", kind: "ORG_ID", rawValue: "123456789012", targetType: "client", targetId: c.id });
    expect((await listClients(admin.id, { pendingZendesk: true })).total).toBe(0);
  });
});

describe("Equivalencias", () => {
  it("la misma identidad con vigencias solapadas se rechaza aunque el destino sea otro, y explica el conflicto", async () => {
    const { c1, c2 } = await groupWithClients();
    await createIdentity(admin.id, { system: "PAP", kind: "ORG_NAME", rawValue: "ACME  Sistemas", targetType: "client", targetId: c1.id });
    const before = await counts();
    const err = await createIdentity(admin.id, { system: "PAP", kind: "ORG_NAME", rawValue: "acme sistemas", targetType: "client", targetId: c2.id }).catch((e) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err.message).toContain("Cliente Uno");
    expect(await counts()).toEqual(before);
  });

  it("vigencias contiguas no solapan; el mismo texto en otro sistema o tipo no es la misma identidad", async () => {
    const { c1, c2 } = await groupWithClients();
    await createIdentity(admin.id, { system: "WRIKE", kind: "PROJECT_NAME", rawValue: "Proyecto X", targetType: "client", targetId: c1.id, validTo: "2026-03-01" });
    await createIdentity(admin.id, { system: "WRIKE", kind: "PROJECT_NAME", rawValue: "Proyecto X", targetType: "client", targetId: c2.id, validFrom: "2026-03-01" });
    await createIdentity(admin.id, { system: "PAP", kind: "PROJECT_NAME", rawValue: "Proyecto X", targetType: "client", targetId: c2.id });
    await expect(
      createIdentity(admin.id, { system: "WRIKE", kind: "PROJECT_NAME", rawValue: "Proyecto X", targetType: "client", targetId: c1.id, validFrom: "2026-02-01", validTo: "2026-04-01" }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("no elimina acentos ni puntuación para igualar nombres", async () => {
    const { c1, c2 } = await groupWithClients();
    await createIdentity(admin.id, { system: "PAP", kind: "ORG_NAME", rawValue: "Álvaro S.L.", targetType: "client", targetId: c1.id });
    await createIdentity(admin.id, { system: "PAP", kind: "ORG_NAME", rawValue: "Alvaro SL", targetType: "client", targetId: c2.id });
    const rows = await prisma.externalIdentity.findMany({ orderBy: { rawValue: "asc" } });
    expect(rows.map((r) => r.rawValue)).toEqual(["Alvaro SL", "Álvaro S.L."]);
    expect(rows.map((r) => r.searchValue)).toEqual(["alvaro sl", "álvaro s.l."]);
  });

  it("ante peticiones concurrentes solo una de dos asignaciones incompatibles se guarda", async () => {
    const { c1, c2 } = await groupWithClients();
    const mk = (clientId: string) =>
      createIdentity(admin.id, { system: "ZENDESK", kind: "ORG_ID", rawValue: "900000000001", targetType: "client", targetId: clientId });
    const results = await Promise.allSettled([mk(c1.id), mk(c2.id), mk(c1.id), mk(c2.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toBeInstanceOf(DomainError);
    expect(await prisma.externalIdentity.count()).toBe(1);
    expect(await prisma.auditEvent.count({ where: { entityType: "ExternalIdentity" } })).toBe(1);
  });

  it("guarda IDs externos como texto exacto y rechaza IDs Zendesk no enteros", async () => {
    const { c1 } = await groupWithClients();
    const id = await createIdentity(admin.id, { system: "ZENDESK", kind: "ORG_ID", rawValue: " 360012345678901234 ", targetType: "client", targetId: c1.id });
    expect(id.rawValue).toBe("360012345678901234");
    await expect(
      createIdentity(admin.id, { system: "ZENDESK", kind: "ORG_ID", rawValue: "1.5e3", targetType: "client", targetId: c1.id }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("respeta las reglas de sistema y destino (BC solo a grupo, Zendesk solo a cliente)", async () => {
    const { g, c1 } = await groupWithClients();
    await expect(createIdentity(admin.id, { system: "BC", kind: "GROUP_KEY", rawValue: "ACME", targetType: "client", targetId: c1.id })).rejects.toBeInstanceOf(DomainError);
    await expect(createIdentity(admin.id, { system: "ZENDESK", kind: "ORG_NAME", rawValue: "Acme", targetType: "group", targetId: g.id })).rejects.toBeInstanceOf(DomainError);
    await createIdentity(admin.id, { system: "BC", kind: "GROUP_KEY", rawValue: "ACME", targetType: "group", targetId: g.id });
  });

  it("añadir otro alias PAP no crea otro Cliente ni otra implantación", async () => {
    const { c1 } = await groupWithClients();
    const impl = await createImplementation(admin.id, c1.id, { name: "Producción", key: "PRD" });
    const base = await counts();
    await createIdentity(admin.id, { system: "PAP", kind: "ORG_NAME", rawValue: "Alias PAP 1", targetType: "client", targetId: c1.id });
    await createIdentity(admin.id, { system: "PAP", kind: "ORG_NAME", rawValue: "Alias PAP 2", targetType: "client", targetId: c1.id });
    await createIdentity(admin.id, { system: "PAP", kind: "PROJECT_NAME", rawValue: "Proyecto PAP", targetType: "implementation", targetId: impl.id });
    const after = await counts();
    expect(after.clients).toBe(base.clients);
    expect(after.impls).toBe(base.impls);
    expect(after.identities).toBe(base.identities + 3);
  });
});

describe("Vigencias de servicio", () => {
  it("OP a CLOUD con fecha efectiva 1 de junio: OP el 31 de mayo, CLOUD desde el 1 de junio, sin solapamiento", async () => {
    const { c1 } = await groupWithClients();
    const scope = { type: "client" as const, id: c1.id };
    await changeTerm(admin.id, { attribute: "HOSTING", value: "OP", targetType: "client", targetId: c1.id, unknownStart: "on" });
    await changeTerm(admin.id, { attribute: "HOSTING", value: "CLOUD", targetType: "client", targetId: c1.id, effectiveFrom: "2026-06-01" });
    expect(await valueAt(admin.id, scope, "HOSTING", "2026-05-31")).toBe("OP");
    expect(await valueAt(admin.id, scope, "HOSTING", "2026-06-01")).toBe("CLOUD");
    expect(await valueAt(admin.id, scope, "HOSTING", "2020-01-01")).toBe("OP");
    const rows = await prisma.serviceTerm.findMany({ where: { clientId: c1.id }, orderBy: { validFrom: { sort: "asc", nulls: "first" } } });
    expect(rows).toHaveLength(2);
    expect(rows[0].validFrom).toBeNull(); // no se inventó una fecha de arranque
    expect(rows[0].validTo?.toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(rows[1].validTo).toBeNull();
  });

  it("sin informar es distinto de un valor asignado, y la base impide solapar tramos", async () => {
    const { c1 } = await groupWithClients();
    const scope = { type: "client" as const, id: c1.id };
    expect(await valueAt(admin.id, scope, "SUPPORT", "2026-01-01")).toBeNull();
    await addTermPeriod(admin.id, { attribute: "SUPPORT", value: "GOLD", targetType: "client", targetId: c1.id, validFrom: "2025-01-01", validTo: "2026-01-01" });
    await expect(
      addTermPeriod(admin.id, { attribute: "SUPPORT", value: "SILVER_ON_DEMAND", targetType: "client", targetId: c1.id, validFrom: "2025-06-01", validTo: "2026-06-01" }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(await valueAt(admin.id, scope, "SUPPORT", "2026-01-01")).toBeNull(); // hueco = sin informar
    // la restricción de la base también lo impide si se esquiva la comprobación de la aplicación
    await expect(
      prisma.serviceTerm.create({ data: { attribute: "SUPPORT", value: "PLATINUM", clientId: c1.id, validFrom: new Date("2025-03-01T00:00:00Z"), validTo: new Date("2025-04-01T00:00:00Z") } }),
    ).rejects.toThrow();
  });

  it("un cambio retroactivo se audita como tal, un cambio sin efecto se rechaza y un dato de grupo no se copia al cliente", async () => {
    const { g, c1 } = await groupWithClients();
    await changeTerm(admin.id, { attribute: "COMPLEXITY", value: "BASIC", targetType: "group", targetId: g.id, unknownStart: "on" });
    await changeTerm(admin.id, { attribute: "COMPLEXITY", value: "MEDIUM", targetType: "group", targetId: g.id, effectiveFrom: "2020-01-01" });
    await expect(
      changeTerm(admin.id, { attribute: "COMPLEXITY", value: "MEDIUM", targetType: "group", targetId: g.id, effectiveFrom: "2021-01-01" }),
    ).rejects.toBeInstanceOf(DomainError);
    const ev = await prisma.auditEvent.findMany({ where: { entityType: "ServiceTerm", action: "CREATE" } });
    expect(ev.some((e) => e.summary.includes("retroactivo"))).toBe(true);
    expect(await valueAt(admin.id, { type: "client", id: c1.id }, "COMPLEXITY", "2026-01-01")).toBeNull();
  });

  it("rechaza valores fuera de catálogo y productos inexistentes", async () => {
    const { c1 } = await groupWithClients();
    await expect(changeTerm(admin.id, { attribute: "HOSTING", value: "SAAS", targetType: "client", targetId: c1.id, unknownStart: "on" })).rejects.toBeInstanceOf(DomainError);
    await expect(changeTerm(admin.id, { attribute: "PRODUCT", value: "Inventado", targetType: "client", targetId: c1.id, unknownStart: "on" })).rejects.toBeInstanceOf(DomainError);
  });
});

describe("Desactivación", () => {
  it("conserva registro, relaciones e historia, y no admite nuevas asignaciones hasta reactivar", async () => {
    const { g, c1 } = await groupWithClients();
    await createIdentity(admin.id, { system: "ZENDESK", kind: "ORG_NAME", rawValue: "Cliente Uno SA", targetType: "client", targetId: c1.id });
    const idn = await prisma.externalIdentity.findFirstOrThrow();
    await setClientActive(admin.id, c1.id, false, { expectedVersion: 1 });

    const detail = await getClient(admin.id, c1.id);
    expect(detail?.isActive).toBe(false);
    expect(detail?.identities).toHaveLength(1);
    expect(await prisma.client.count()).toBe(2); // sigue existiendo
    expect((await listClients(admin.id, { status: "inactive" })).total).toBe(1);
    expect((await listClients(admin.id, { status: "all", groupId: g.id })).total).toBe(2);
    expect((await listHistory(admin.id, { clientId: c1.id })).total).toBeGreaterThanOrEqual(3);

    await expect(createIdentity(admin.id, { system: "PAP", kind: "ORG_NAME", rawValue: "Otro", targetType: "client", targetId: c1.id })).rejects.toBeInstanceOf(DomainError);
    await expect(createImplementation(admin.id, c1.id, { name: "Nueva" })).rejects.toBeInstanceOf(DomainError);
    await expect(changeTerm(admin.id, { attribute: "HOSTING", value: "OP", targetType: "client", targetId: c1.id, unknownStart: "on" })).rejects.toBeInstanceOf(DomainError);
    // la relación histórica sigue ahí
    expect((await prisma.externalIdentity.findUniqueOrThrow({ where: { id: idn.id } })).clientId).toBe(c1.id);

    await setClientActive(admin.id, c1.id, true, { expectedVersion: 2 });
    await createIdentity(admin.id, { system: "PAP", kind: "ORG_NAME", rawValue: "Otro", targetType: "client", targetId: c1.id });
  });

  it("una equivalencia desactivada libera la identidad y reactivarla revalida el solapamiento", async () => {
    const { c1, c2 } = await groupWithClients();
    const a = await createIdentity(admin.id, { system: "PAP", kind: "ORG_NAME", rawValue: "Repetida", targetType: "client", targetId: c1.id });
    await setIdentityActive(admin.id, a.id, false, { expectedVersion: 1 });
    await createIdentity(admin.id, { system: "PAP", kind: "ORG_NAME", rawValue: "Repetida", targetType: "client", targetId: c2.id });
    await expect(setIdentityActive(admin.id, a.id, true, { expectedVersion: 2 })).rejects.toBeInstanceOf(DomainError);
  });

  it("sin borrado físico: las claves ajenas restringen", async () => {
    const { g } = await groupWithClients();
    await expect(prisma.clientGroup.delete({ where: { id: g.id } })).rejects.toThrow();
  });
});

describe("Control de versión", () => {
  it("la segunda edición obsoleta no sobrescribe silenciosamente la primera", async () => {
    const { c1 } = await groupWithClients();
    const first = await updateClient(admin.id, c1.id, { name: "Cliente Uno (A)", expectedVersion: c1.version });
    expect(first.version).toBe(2);
    await expect(updateClient(admin.id, c1.id, { name: "Cliente Uno (B)", expectedVersion: c1.version })).rejects.toBeInstanceOf(StaleVersionError);
    expect((await prisma.client.findUniqueOrThrow({ where: { id: c1.id } })).name).toBe("Cliente Uno (A)");
  });

  it("dos ediciones simultáneas con la misma versión: solo una prospera", async () => {
    const g = await createGroup(admin.id, { name: "Concurrente" });
    const r = await Promise.allSettled([
      updateGroup(admin.id, g.id, { name: "Versión A", expectedVersion: 1 }),
      updateGroup(admin.id, g.id, { name: "Versión B", expectedVersion: 1 }),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(StaleVersionError);
    expect(await prisma.auditEvent.count({ where: { entityType: "ClientGroup", action: "UPDATE" } })).toBe(1);
  });
});

describe("Auditoría", () => {
  it("registra actor, fecha y antes/después", async () => {
    const g = await createGroup(admin.id, { name: "Original", bcDenomination: "BC-1" });
    await updateGroup(admin.id, g.id, { name: "Renombrado", bcDenomination: "BC-1", expectedVersion: 1 });
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: g.id, action: "UPDATE" } });
    expect(ev.actorId).toBe(admin.id);
    expect(ev.actorEmail).toBe("admin@test.local");
    expect((ev.before as { name: string }).name).toBe("Original");
    expect((ev.after as { name: string }).name).toBe("Renombrado");
    expect(ev.groupId).toBe(g.id);
    expect(JSON.stringify(ev)).not.toMatch(/password|secret/i);
  });

  it("una operación fallida no deja cambios parciales ni auditoría", async () => {
    const before = await counts();
    await expect(
      adminTransaction(admin.id, async (tx, actor) => {
        const g = await tx.clientGroup.create({ data: { name: "Parcial" } });
        await recordAudit(tx, actor, { action: "CREATE", entityType: "ClientGroup", entityId: g.id, groupId: g.id, summary: "x" });
        throw new Error("fallo a mitad de la operación");
      }),
    ).rejects.toThrow("fallo");
    expect(await counts()).toEqual(before);

    // y un cambio de servicio que falla en su segundo paso revierte también el cierre del tramo
    const { c1 } = await groupWithClients();
    await changeTerm(admin.id, { attribute: "HOSTING", value: "OP", targetType: "client", targetId: c1.id, unknownStart: "on" });
    const snap = await counts();
    await expect(
      changeTerm(admin.id, { attribute: "HOSTING", value: "CLOUD", targetType: "client", targetId: c1.id, effectiveFrom: "2026-13-45" }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(await counts()).toEqual(snap);
  });

  it("los hitos se guardan con fecha, ámbito y nota y no alteran contratos", async () => {
    const { c1 } = await groupWithClients();
    const m = await createMilestone(admin.id, { type: "CLOUD_MIGRATION", date: "2026-06-01", note: "Migración a cloud", targetType: "client", targetId: c1.id });
    expect(m.date.toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(await prisma.serviceTerm.count()).toBe(0);
  });
});
