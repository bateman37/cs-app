import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createIdentity } from "@/server/identities";
import { DomainError } from "@/server/errors";
import { bcFallbackImpact, runEconomics } from "@/server/economics/engine";
import { removeUploadDir, useUploadDir, freshEnvironment, drain } from "./cargas-helpers";
import { papBuffer, papDate, papRow, wrikeCsv, wrikeRow } from "./generators/csapp04";
import { ticket, ticketsBuffer } from "./generators/zendesk";
import { importFile, importWrike, wrikeEntries, PAP } from "./csapp04-helpers";
import { addClient, addGroup, importZd, TICKETS } from "./zendesk-helpers";
import { reprocessUpload } from "@/server/uploads/batches";

let dir: string;
let admin: { id: string };
beforeAll(() => { dir = useUploadDir(); });
afterAll(() => removeUploadDir(dir));
beforeEach(async () => { ({ admin } = await freshEnvironment()); });

describe("equivalencias Wrike/PAP directamente a Grupo Cliente", () => {
  it("«Proyecto A» apunta al «Grupo B» sin renombrarse ni crear una falsa clave BC; con identidad propia, destino único y auditoría", async () => {
    const gb = await addGroup("Grupo B");
    const id = await createIdentity(admin.id, { system: "WRIKE", kind: "PROJECT_NAME", rawValue: "Proyecto A", targetType: "group", targetId: gb.id });
    expect(id).toMatchObject({ system: "WRIKE", kind: "PROJECT_NAME", groupId: gb.id, clientId: null, implementationId: null });
    expect(await prisma.externalIdentity.count({ where: { system: "BC" } })).toBe(0);
    expect((await prisma.clientGroup.findUniqueOrThrow({ where: { id: gb.id } })).name).toBe("Grupo B");
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityType: "ExternalIdentity", entityId: id.id } });
    expect(audit.groupId).toBe(gb.id);
    const pap = await createIdentity(admin.id, { system: "PAP", kind: "PROJECT_ID", rawValue: "P-77", targetType: "group", targetId: gb.id });
    expect(pap.groupId).toBe(gb.id);
  });
  it("solo los tipos de proyecto admiten grupo; Zendesk ORG_ID sigue siendo de Cliente; el CHECK de la base lo garantiza", async () => {
    const g = await addGroup("G");
    await expect(createIdentity(admin.id, { system: "PAP", kind: "ORG_NAME", rawValue: "Org", targetType: "group", targetId: g.id })).rejects.toBeInstanceOf(DomainError);
    await expect(createIdentity(admin.id, { system: "ZENDESK", kind: "ORG_ID", rawValue: "123", targetType: "group", targetId: g.id })).rejects.toBeInstanceOf(DomainError);
    await expect(prisma.externalIdentity.create({ data: { system: "WRIKE", kind: "ORG_NAME", rawValue: "x", searchValue: "x", groupId: g.id } })).rejects.toThrow();
    await expect(prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: "9", searchValue: "9", groupId: g.id } })).rejects.toThrow();
    await prisma.externalIdentity.create({ data: { system: "WRIKE", kind: "PROJECT_NAME", rawValue: "ok", searchValue: "ok", groupId: g.id } });
  });
  it("rechaza solapamientos de vigencia, también concurrentes, aunque el destino sea otro", async () => {
    const g1 = await addGroup("G1");
    const g2 = await addGroup("G2");
    const c = await addClient({ name: "C", groupId: g2.id });
    await createIdentity(admin.id, { system: "WRIKE", kind: "PROJECT_NAME", rawValue: "Proy", targetType: "group", targetId: g1.id, validFrom: "2025-01-01" });
    await expect(createIdentity(admin.id, { system: "WRIKE", kind: "PROJECT_NAME", rawValue: "proy", targetType: "client", targetId: c.id, validFrom: "2025-06-01" })).rejects.toThrow(/solapa/);
    const res = await Promise.allSettled([
      createIdentity(admin.id, { system: "PAP", kind: "PROJECT_NAME", rawValue: "Carrera", targetType: "group", targetId: g1.id }),
      createIdentity(admin.id, { system: "PAP", kind: "PROJECT_NAME", rawValue: "carrera", targetType: "group", targetId: g2.id }),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.externalIdentity.count({ where: { system: "PAP", searchValue: "carrera" } })).toBe(1);
  });
  it("Wrike resuelve por la fecha del trabajo: antes de la vigencia no hay grupo; después sí; un ticket del mismo grupo completa el Cliente", async () => {
    const gb = await addGroup("Grupo B");
    const cb = await addClient({ name: "Cliente B", orgId: "9001", groupId: gb.id });
    await importZd(admin.id, TICKETS, await ticketsBuffer([ticket({ ticket_id: "123456", organization_id: "9001" })]));
    await createIdentity(admin.id, { system: "WRIKE", kind: "PROJECT_NAME", rawValue: "Proyecto Alfa", targetType: "group", targetId: gb.id, validFrom: "2025-02-01" });
    await importWrike(admin.id, wrikeCsv([
      wrikeRow({ proyecto: "Proyecto Alfa", tarea: "antes", fecha: "15/01/2025" }),
      wrikeRow({ proyecto: "Proyecto Alfa", tarea: "despues", fecha: "10/02/2025" }),
      wrikeRow({ proyecto: "Proyecto Alfa", tarea: "con ticket", ticket: "123456", fecha: "11/02/2025" }),
    ]));
    const e = Object.fromEntries((await wrikeEntries()).map((x) => [x.taskName, x]));
    expect(e.antes.groupId).toBeNull();
    expect(e.despues).toMatchObject({ groupId: gb.id, clientId: null });
    expect(e["con ticket"]).toMatchObject({ groupId: gb.id, clientId: cb.id, scope: "PROJECT_TICKET" });
  });
  it("si el ticket contradice el proyecto, se conserva el conflicto y no se elige destino", async () => {
    const ga = await addGroup("Grupo A");
    const gb = await addGroup("Grupo B");
    await addClient({ name: "Cliente A", orgId: "9001", groupId: ga.id });
    await importZd(admin.id, TICKETS, await ticketsBuffer([ticket({ ticket_id: "123456", organization_id: "9001" })]));
    await createIdentity(admin.id, { system: "WRIKE", kind: "PROJECT_NAME", rawValue: "Proyecto Beta", targetType: "group", targetId: gb.id });
    await importWrike(admin.id, wrikeCsv([wrikeRow({ proyecto: "Proyecto Beta", tarea: "choque", ticket: "123456", fecha: "11/02/2025" })]));
    const [e] = await wrikeEntries();
    expect(e).toMatchObject({ conflict: true, groupId: null, clientId: null, scope: "CONFLICT" });
    expect(e.minutes).toBe("60");
  });
  it("PAP resuelve por la fecha de producción", async () => {
    const gb = await addGroup("Grupo B");
    await createIdentity(admin.id, { system: "PAP", kind: "PROJECT_NAME", rawValue: "Proyecto PAP", targetType: "group", targetId: gb.id, validFrom: "2025-03-01" });
    await importFile(admin.id, PAP, await papBuffer([
      papRow({ Title: "1: antes", Proyecto: "Proyecto PAP", "Fecha puesta en producción": papDate("2025-02-10") }),
      papRow({ Title: "2: despues", Proyecto: "Proyecto PAP", "Fecha puesta en producción": papDate("2025-03-10") }),
    ]), { metadata: { lista: "lista-test" } });
    const items = Object.fromEntries((await prisma.papItem.findMany()).map((i) => [i.papId, i]));
    expect(items["1"]).toMatchObject({ drvScope: "UNMAPPED", drvGroupId: null });
    expect(items["2"]).toMatchObject({ drvScope: "GROUP_ONLY", drvGroupId: gb.id, drvClientId: null });
  });
});

describe("retirada del atajo por clave BC", () => {
  it("una clave BC que coincide con el texto del proyecto ya no atribuye; sin registros dependientes el impacto es cero", async () => {
    const g = await addGroup("Grupo Z");
    await prisma.externalIdentity.create({ data: { system: "BC", kind: "GROUP_KEY", rawValue: "Proyecto Z", searchValue: "proyecto z", groupId: g.id } });
    await importWrike(admin.id, wrikeCsv([wrikeRow({ proyecto: "Proyecto Z", tarea: "t", fecha: "10/02/2025" })]));
    const [e] = await wrikeEntries();
    expect(e.groupId).toBeNull();
    expect(e.scope).toBeNull();
    expect(await bcFallbackImpact(prisma)).toEqual({ wrike: 0, pap: 0 });
  });
  it("si existían atribuciones apoyadas en el atajo, se muestran como impacto y recálculo pendiente, se conservan como evidencia y el reproceso las revisa sin tocar los hechos", async () => {
    const g = await addGroup("Grupo Z");
    await prisma.externalIdentity.create({ data: { system: "BC", kind: "GROUP_KEY", rawValue: "Proyecto Z", searchValue: "proyecto z", groupId: g.id } });
    const b = await importWrike(admin.id, wrikeCsv([wrikeRow({ proyecto: "Proyecto Z", tarea: "t", fecha: "10/02/2025", horas: "2" })]));
    // Estado heredado de CSAPP-04: la entrada tenía grupo por el atajo.
    await prisma.$executeRaw`UPDATE "WrikeTimeEntry" SET "drvGroupId" = ${g.id}, "drvScopeMethod" = 'PROJECT', "drvBucket" = 'GROUP_ONLY'`;
    expect(await bcFallbackImpact(prisma)).toEqual({ wrike: 1, pap: 0 });
    const r = await runEconomics(admin.id, { scope: { type: "groups", ids: [g.id] }, service: "SOPORTE", date: "2025-02-28" });
    expect(r.reference.pendingRecalc.bcFallback).toEqual({ wrike: 1, pap: 0 });
    expect(r.reference.pendingRecalc.reason).toMatch(/no está validada/);
    // Los hechos (minutos, fecha, tarea) siguen intactos; el reproceso recalcula con las reglas actuales (sin atajo).
    await reprocessUpload(admin.id, b.id); await drain();
    const [e] = await wrikeEntries();
    expect(e).toMatchObject({ minutes: "120", workDate: "2025-02-10", groupId: null });
    expect(await bcFallbackImpact(prisma)).toEqual({ wrike: 0, pap: 0 });
    // La acción para corregirlo es crear la equivalencia explícita.
    await createIdentity(admin.id, { system: "WRIKE", kind: "PROJECT_NAME", rawValue: "Proyecto Z", targetType: "group", targetId: g.id });
    await reprocessUpload(admin.id, b.id); await drain();
    expect((await wrikeEntries())[0].groupId).toBe(g.id);
  });
});
