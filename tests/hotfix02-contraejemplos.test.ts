import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { drain, freshEnvironment, removeUploadDir, useUploadDir } from "./cargas-helpers";
import { cliente } from "./generators/precarga-maestros";
import { wrikeCsv, wrikeRow } from "./generators/csapp04";
import { importWrike } from "./csapp04-helpers";
import {
  CLIENT_ROWS, FIN_ROWS, FIN_TOTAL, WRIKE_TOTAL_MINUTES, ZD_TOTAL_MINUTES, financeOut, loadMaster, loadOperationalFirst, papOut, singleSheetBook, sumMinutes, wrikeOut, zdOut,
  TICKET_ROWS, ZD_TIMES, WRIKE_ROWS, PAP_ROWS, seedPersonal,
} from "./hotfix02-helpers";
import { importZd, TICKETS, TIEMPO } from "./zendesk-helpers";
import { ticketsBuffer, timesBuffer } from "./generators/zendesk";
import { papBuffer } from "./generators/csapp04";
import { importFile, PAP } from "./csapp04-helpers";
import { importFin } from "./finanzas-helpers";

/**
 * Contraejemplos de HOTFIX-02 §2 y casos 1–6 de §12. Se escribieron ANTES del arreglo y fallan en la base anterior (ver docs/validacion/hotfix-02-datos.md):
 * tras confirmar el libro de Clientes NADIE recalculaba lo ya cargado, así que Zendesk, Wrike, PAP y finanzas conservaban «sin asignar».
 * Las comprobaciones leen columnas materializadas y sumas de la fuente con valores escritos a mano en el escenario; no llaman a un resolver para fabricar lo esperado.
 */
let dir: string;
let admin: { id: string };
beforeAll(() => { dir = useUploadDir(); });
afterAll(() => removeUploadDir(dir));
beforeEach(async () => { ({ admin } = await freshEnvironment()); });

async function settle() {
  // El trabajador procesa la actualización automática de relaciones hasta que no queda trabajo (sin pulsar «Reprocesar» en ningún lote).
  await drain();
  await drain();
}

describe("1. operativos antes del maestro: sin reprocesar lote a lote", () => {
  it("al confirmar CLIENTES, todo lo ya cargado queda atribuido por su ruta (Zendesk, Wrike, PAP, finanzas) y las cantidades fuente no cambian", async () => {
    await loadOperationalFirst(admin.id);
    // Antes del maestro todo está sin asignar (la fuente existe, la unión no).
    expect((await zdOut()).every((r) => r.group === null)).toBe(true);
    expect((await financeOut()).every((r) => r.group === null)).toBe(true);
    const zdBefore = await sumMinutes("ZdTimeEntry");
    const wrBefore = await sumMinutes("WrikeTimeEntry");
    expect([zdBefore, wrBefore]).toEqual([ZD_TOTAL_MINUTES, WRIKE_TOTAL_MINUTES]);

    await loadMaster(admin.id, await singleSheetBook());
    await settle();

    // Tickets → organization_id → Cliente → Grupo (C/D/F), con nombres distintos en cada sistema.
    const zd = Object.fromEntries((await zdOut()).map((r) => [r.ticket, r]));
    expect([zd["3001"].group, zd["3001"].client, zd["3001"].minutes]).toEqual(["GRP ALFA", "Alfa Uno", "90"]);
    expect([zd["3002"].group, zd["3002"].client]).toEqual(["GRP BETA", "Beta Org"]);
    expect([zd["3003"].group, zd["3003"].client]).toEqual(["GRP GAMMA", "Gamma Org"]);
    expect([zd["3005"].group, zd["3005"].client]).toEqual(["GRP ALFA", "Alfa Dos"]);
    expect([zd["9999"].group, zd["9999"].bucket]).toEqual([null, "NO_TICKET"]); // ticket inexistente: no se inventa

    // Wrike → proyecto → A/B (a Grupo); ticket válido completa el Cliente; alias de varios Grupos solo con ticket compatible.
    const wr = Object.fromEntries((await wrikeOut()).map((r) => [r.task, r]));
    expect([wr["Sin ticket en Grupo"].group, wr["Sin ticket en Grupo"].client, wr["Sin ticket en Grupo"].bucket]).toEqual(["GRP ALFA", null, "GROUP_ONLY"]);
    expect([wr["Con ticket de Beta"].group, wr["Con ticket de Beta"].client]).toEqual(["GRP BETA", "Beta Org"]);
    expect([wr["Alias compartido y ticket de Gamma"].group, wr["Alias compartido y ticket de Gamma"].client]).toEqual(["GRP GAMMA", "Gamma Org"]);
    expect([wr["Alias compartido sin ticket"].group, wr["Alias compartido sin ticket"].bucket]).toEqual([null, "NO_SCOPE"]);
    expect(wr["Alias compartido sin ticket"].flags).toContain("ALIAS_AMBIGUOUS");
    expect([wr["Alias compartido y ticket de otro Grupo"].group, wr["Alias compartido y ticket de otro Grupo"].conflict]).toEqual([null, true]);
    expect([wr["Sin correspondencia"].group, wr["Sin correspondencia"].bucket]).toEqual([null, "NO_SCOPE"]);

    // PAP → organización/proyecto de la fila (I/J); un PAP con varias causas cuenta una vez.
    const pap = Object.fromEntries((await papOut()).map((r) => [r.pap, r]));
    expect(Object.keys(pap)).toHaveLength(5);
    expect([pap["501"].scope, pap["501"].group]).toEqual(["IMPLEMENTATION", "GRP ALFA"]);
    expect([pap["503"].scope, pap["503"].group]).toEqual(["GROUP_ONLY", "GRP GAMMA"]);
    expect([pap["504"].scope, pap["504"].group]).toEqual(["AMBIGUOUS", null]);
    expect([pap["505"].scope, pap["505"].group]).toEqual(["UNMAPPED", null]);

    // Finanzas → denominación BC (otra caja/espacios) → Grupo; el ingreso no se reparte entre Clientes.
    expect((await financeOut()).map((r) => [r.group, r.income]).sort()).toEqual([["GRP ALFA", "1200"], ["GRP BETA", "2400"], ["GRP GAMMA", "600"]]);

    // Conciliación: la cantidad fuente no cambió al pasar de «sin asignar» a un Grupo.
    expect([await sumMinutes("ZdTimeEntry"), await sumMinutes("WrikeTimeEntry")]).toEqual([zdBefore, wrBefore]);
  });
});

describe("2. orden inverso y repetición", () => {
  it("el mismo resultado si el maestro llega primero y los tickets después de sus tiempos; repetir el maestro no duplica ni cambia lo activo", async () => {
    // Orden A: operativos primero.
    await loadOperationalFirst(admin.id);
    await loadMaster(admin.id, await singleSheetBook());
    await settle();
    const A = JSON.stringify({ zd: await zdOut(), wr: await wrikeOut(), pap: await papOut(), fin: await financeOut() });

    // Orden B: maestro primero; los tiempos antes que sus tickets; finanzas ya con Grupos.
    ({ admin } = await freshEnvironment());
    await seedPersonal();
    await loadMaster(admin.id, await singleSheetBook());
    await importZd(admin.id, TIEMPO, await timesBuffer(ZD_TIMES)); // tiempos antes que sus tickets
    await importZd(admin.id, TICKETS, await ticketsBuffer(TICKET_ROWS));
    await importWrike(admin.id, wrikeCsv(WRIKE_ROWS));
    await importFile(admin.id, PAP, await papBuffer(PAP_ROWS));
    await importFin(admin.id, "SOPORTE", 2025, FIN_ROWS, FIN_TOTAL); // sin `unassigned`: ya hay equivalencias BC
    await settle();
    const B = JSON.stringify({ zd: await zdOut(), wr: await wrikeOut(), pap: await papOut(), fin: await financeOut() });
    // Las etiquetas de finanzas conservan el original de cada carga; se comparan por Grupo e ingreso.
    const norm = (s: string) => JSON.parse(s, (k, v) => v) as { zd: unknown[]; wr: unknown[]; pap: unknown[]; fin: { group: string; income: string }[] };
    const a = norm(A);
    const b = norm(B);
    expect(b.zd).toEqual(a.zd);
    expect(b.wr).toEqual(a.wr);
    expect(b.pap).toEqual(a.pap);
    expect(b.fin.map((r) => [r.group, r.income]).sort()).toEqual(a.fin.map((r) => [r.group, r.income]).sort());

    // Repetir el mismo maestro: ni entidades nuevas ni cambios en lo derivado.
    const snap = async () => ({
      groups: await prisma.clientGroup.count(), clients: await prisma.client.count(), idents: await prisma.externalIdentity.count(), impls: await prisma.implementation.count(),
      wrikeV: await prisma.wrikeTimeEntry.aggregate({ _sum: { drvVersion: true } }), zdV: await prisma.zdTimeEntry.aggregate({ _sum: { drvVersion: true } }),
    });
    const before = await snap();
    await loadMaster(admin.id, await singleSheetBook(), "CLIENTES (repetido).xlsx");
    await settle();
    expect(await snap()).toEqual(before);
  });
});

describe("3. libro de una sola hoja CLIENTES", () => {
  it("se admite sin PERSONAL ni PERSONAL PMO, conserva personas y roles existentes y actualiza relaciones aunque no cree ninguna entidad nueva", async () => {
    const { ana, pmo } = await seedPersonal();
    await importZd(admin.id, TICKETS, await ticketsBuffer(TICKET_ROWS));
    await importZd(admin.id, TIEMPO, await timesBuffer(ZD_TIMES));
    const aliasesBefore = await prisma.personAlias.count();
    const persons = await prisma.person.count();
    // Las entidades YA existen (alta manual previa de Grupo, Cliente y equivalencia): la precarga no crea ninguna y aun así debe enlazar lo cargado.
    const g = await prisma.clientGroup.create({ data: { name: "GRP ALFA", bcDenomination: "GRP ALFA" } });
    const c1 = await prisma.client.create({ data: { name: "Alfa Uno", groupId: g.id } });
    await prisma.externalIdentity.create({ data: { system: "BC", kind: "GROUP_KEY", rawValue: "GRP ALFA", searchValue: "grp alfa", groupId: g.id } });
    await prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: "710001", searchValue: "710001", clientId: c1.id } });
    await settle(); // la edición del maestro ya se propagó
    expect((await zdOut()).find((r) => r.ticket === "3001")?.group).toBe("GRP ALFA");

    const only = await singleSheetBook([CLIENT_ROWS[0]]);
    const done = await loadMaster(admin.id, only);
    await settle();
    expect(done.rowsReceived).toBe(1);
    expect(await prisma.person.count()).toBe(persons); // Personal conservado: no se vacía ni se sustituye por no venir en el libro
    expect(await prisma.personAlias.count()).toBe(aliasesBefore);
    expect(await prisma.personTerm.count({ where: { personId: pmo.id, attribute: "PMO_ROLE" } })).toBe(1);
    expect(ana.id).toBeTruthy();
  });
});

describe("4. columnas Grupo repetidas y nombres distintos por sistema", () => {
  it("A/B, C/D/F e I/J llevan cada uno SU Grupo: no se unen por D ni por parecido, y todas las rutas suman al mismo Grupo", async () => {
    const rows = [
      // Los nombres de Wrike, Zendesk, PAP y BC son deliberadamente distintos entre sí; las TRES columnas Grupo tienen valores equivalentes de cada lado.
      cliente("zzz proyecto wrike", "Grupo Z", "720001", "Org Zendesk Distinta", "Gold", "Grupo Z", "CLOUD", "Gold", "pap otro nombre", "Grupo Z", "Basic"),
    ];
    await seedPersonal();
    await importZd(admin.id, TICKETS, await ticketsBuffer([{ ...TICKET_ROWS[0], ticket_id: "4001", organization_id: "720001" }]));
    await importZd(admin.id, TIEMPO, await timesBuffer([{ ...ZD_TIMES[0], ticket_id: "4001" }]));
    await importWrike(admin.id, wrikeCsv([wrikeRow({ usuario: "pmo.uno", proyecto: "ZZZ PROYECTO  WRIKE", tarea: "t", horas: "1" })]));
    await importFile(admin.id, PAP, await papBuffer([{ ...PAP_ROWS[0], Title: "ID 601: x", Proyecto: "PAP Otro Nombre" }]));
    await loadMaster(admin.id, await singleSheetBook(rows));
    await settle();
    expect((await zdOut())[0].group).toBe("Grupo Z");
    expect((await wrikeOut())[0].group).toBe("Grupo Z");
    expect((await papOut())[0].group).toBe("Grupo Z");
    // No se creó ninguna equivalencia a Cliente por parecido entre nombres.
    expect(await prisma.externalIdentity.count({ where: { system: { in: ["WRIKE", "PAP"] }, clientId: { not: null } } })).toBe(0);
  });
});

describe("5. Wrike sin ticket, tickets sin horas, hechos solo Grupo", () => {
  it("Wrike sin ticket con alias de Grupo y PMO válido suma al Grupo; el hecho solo-Grupo no se reparte entre los hijos; los tickets sin horas siguen disponibles", async () => {
    await loadOperationalFirst(admin.id);
    await loadMaster(admin.id, await singleSheetBook());
    await settle();
    const rows = await prisma.$queryRaw<{ n: bigint; m: string }[]>`
      SELECT count(*) AS n, COALESCE(sum(minutes),0)::text AS m FROM "ActiveWrikeTimeEntry" e JOIN "ClientGroup" g ON g.id = e."drvGroupId"
      WHERE g.name = 'GRP ALFA' AND e."drvClientId" IS NULL AND e."drvEligibility" = 'ELIGIBLE'`;
    expect([Number(rows[0].n), Number(rows[0].m)]).toEqual([1, 120]);
    // Ninguno de los dos Clientes del Grupo recibe esas 120 minutos Wrike.
    const perClient = await prisma.$queryRaw<{ m: string }[]>`SELECT COALESCE(sum(minutes),0)::text AS m FROM "ActiveWrikeTimeEntry" WHERE "drvClientId" IN (SELECT id FROM "Client" WHERE name IN ('Alfa Uno', 'Alfa Dos'))`;
    expect(Number(perClient[0].m)).toBe(0);
    // Ticket sin horas (3007): existe, con su organización resuelta a Cliente y Grupo, aunque ningún tiempo lo mencione.
    const t = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "ZdTicket" z JOIN "ZdTicketRevision" r ON r.id = z."currentRevisionId"
      JOIN "ExternalIdentity" i ON i.system = 'ZENDESK' AND i.kind = 'ORG_ID' AND i."searchValue" = r."organizationId" AND i."isActive"
      JOIN "Client" c ON c.id = i."clientId" WHERE z."ticketId" = '3007' AND c."groupId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "ZdTimeEntry" e WHERE e."ticketId" = '3007')`;
    expect(Number(t[0].n)).toBe(1);
  });
});

describe("6. alias ambiguos y discrepancias E/H", () => {
  it("el alias de varios Grupos solo se resuelve con evidencia inequívoca; el conflicto queda acotado; E/H distintos no vacían la identidad ni el ingreso", async () => {
    await loadOperationalFirst(admin.id);
    await loadMaster(admin.id, await singleSheetBook());
    await settle();
    // El alias compartido NO se asignó a ningún Grupo (ni al primero).
    expect(await prisma.externalIdentity.count({ where: { system: "WRIKE", searchValue: "w-compartido" } })).toBe(0);
    expect(await prisma.externalIdentity.count({ where: { system: "PAP", searchValue: "p-multi" } })).toBe(0);
    // Los demás alias no se bloquean por ello.
    expect(await prisma.externalIdentity.count({ where: { system: "WRIKE", searchValue: { in: ["w-alfa", "w-beta"] } } })).toBe(2);
    // Epsilon: E y H discrepan → el Cliente existe y atribuye; solo el atributo Soporte queda pendiente.
    const eps = await prisma.client.findFirst({ where: { name: "Epsilon Org" }, include: { group: true } });
    expect(eps?.group?.name).toBe("GRP EPSILON");
    expect(await prisma.serviceTerm.count({ where: { clientId: eps?.id, attribute: "SUPPORT" } })).toBe(0);
    expect(await prisma.serviceTerm.count({ where: { clientId: eps?.id, attribute: "HOSTING" } })).toBe(1);
    expect((await zdOut()).find((r) => r.ticket === "3006")).toBeUndefined(); // sin horas de Epsilon: nada que atribuir
  });
});

describe("normalización única (NFC, espacios no separables, caja)", () => {
  it("un nombre de proyecto Wrike con forma Unicode distinta (NFD, NBSP, mayúsculas) encuentra la equivalencia escrita por la precarga", async () => {
    await seedPersonal();
    const projectNfd = "W-ÁLAMO  SUR"; // «W-ÁLAMO SUR» descompuesto, con espacio no separable doble
    const rows = [cliente("w-Álamo sur", "Grupo Ñandú", "730001", "Org Ñ", "Gold", "Grupo Ñandú", "OP", "Gold", null, "Grupo Ñandú", null)];
    // El maestro llega ANTES: no hace falta propagación; el único obstáculo es la comparación de nombres (NFC, espacios no separables, caja).
    await loadMaster(admin.id, await singleSheetBook(rows));
    await importWrike(admin.id, wrikeCsv([wrikeRow({ usuario: "pmo.uno", proyecto: projectNfd, tarea: "unicode", horas: "1" })]));
    await settle();
    expect((await wrikeOut())[0].group).toBe("Grupo Ñandú");
  });
});
