import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { confirmUpload, revertUpload } from "@/server/uploads/batches";
import { decideTimeCorrection, getCorrectionCompare, listCorrectionTargets } from "@/server/zendesk/corrections";
import { batch, drain, freshEnvironment, removeUploadDir, useUploadDir } from "./cargas-helpers";
import { csvText, wrikeCsv, wrikeRow } from "./generators/csapp04";
import { ticket, ticketsBuffer, timeRow, timesBuffer, excelSerial } from "./generators/zendesk";
import { WRIKE, addProjectEquivalence, addWrikePerson, eligibleHours, importFile, importWrike, prepare, wrikeEntries } from "./csapp04-helpers";
import { addClient, addGroup, addPerson, count, importZd, TICKETS, TIEMPO } from "./zendesk-helpers";

let dir: string;
let admin: { id: string };
beforeAll(() => { dir = useUploadDir(); });
afterAll(() => removeUploadDir(dir));
beforeEach(async () => { ({ admin } = await freshEnvironment()); });

const buckets = async (batchId: string) => Object.fromEntries((await prisma.$queryRaw<{ bucket: string; n: bigint }[]>`SELECT bucket, count(*) AS n FROM "ZdTimePreview" WHERE "batchId" = ${batchId} GROUP BY bucket`).map((r) => [r.bucket, Number(r.n)]));

describe("CSV Wrike y unidades", () => {
  it("coma en la tarea, comillas escapadas y salto interior conservan los seis campos; 0,5 h = 30 min sin dividir por 60", async () => {
    const tarea = 'Revisar "módulo", fase 2\nsegunda línea';
    const b = await importWrike(admin.id, wrikeCsv([wrikeRow({ tarea, horas: "0,5" }), wrikeRow({ tarea: "otra", horas: "2", fecha: "16/01/2025" })]));
    expect(b.rowsError).toBe(0);
    const e = await wrikeEntries();
    expect(e).toHaveLength(2);
    expect(e[0].taskName).toBe('Revisar "módulo", fase 2 segunda línea');
    expect(e.map((x) => x.minutes)).toEqual(["30", "120"]);
    const raw = (await prisma.uploadStagedRow.findFirstOrThrow({ where: { batchId: b.id, position: 1 } })).raw as [string, string][];
    expect(raw).toHaveLength(6);
    expect(raw[2][0]).toBe(tarea);
  });

  it("acepta orden libre de columnas y rechaza cabeceras faltantes con mensaje claro", async () => {
    const ok = await importWrike(admin.id, wrikeCsv([wrikeRow({ horas: "1" })], { order: [5, 4, 3, 2, 1, 0] }));
    expect(ok.status).toBe("COMPLETED");
    const bad = await prepare(admin.id, WRIKE, Buffer.from(csvText([["Usuario", "Proyecto"], ["a", "b"]])));
    expect(bad.status).toBe("REJECTED");
    expect(bad.statusDetail).toMatch(/faltan las cabeceras/);
  });

  it("notaciones de horas ambiguas son error y no se adivinan", async () => {
    const b = await prepare(admin.id, WRIKE, wrikeCsv([wrikeRow({ horas: "1.500" }), wrikeRow({ horas: "-1", tarea: "b" }), wrikeRow({ horas: "abc", tarea: "c" })]));
    expect(b.rowsError).toBe(3);
  });
});

describe("sin imputación y fecha", () => {
  it("persona y fecha vacías con cero horas son tarea sin imputación (bruto conservado, fuera del hecho); horas positivas sin fecha son error", async () => {
    const b = await prepare(admin.id, WRIKE, wrikeCsv([
      wrikeRow({ usuario: "", fecha: "", horas: "0", tarea: "solo tarea" }),
      wrikeRow({ usuario: "", fecha: "", horas: "2", tarea: "horas sin fecha" }),
      wrikeRow({ tarea: "buena" }),
    ]));
    expect(b.rowsExcluded).toBe(1);
    expect(b.rowsError).toBe(1);
    expect(b.status).toBe("READY");
    // Con errores obligatorios el lote no se confirma.
    await expect(confirmUpload(admin.id, b.id)).rejects.toThrow(/errores obligatorios/);
    const excl = await prisma.uploadStagedRow.findFirstOrThrow({ where: { batchId: b.id, classification: "EXCLUDED" } });
    expect((excl.issues as { code: string }[])[0].code).toBe("SIN_IMPUTACION");
    const ok = await importWrike(admin.id, wrikeCsv([wrikeRow({ usuario: "", fecha: "", horas: "0", tarea: "solo tarea" }), wrikeRow({ tarea: "buena" })]));
    expect(ok.rowsExcluded).toBe(1);
    expect(await count("WrikeTimeEntry")).toBe(1);
  });
});

describe("ticket: prioridad, normalización y ambigüedad", () => {
  it("216.527 normaliza solo el ticket; cero/vacío no inventa ID; un explícito no encontrado no se reemplaza por el del nombre", async () => {
    const g = await addGroup("Grupo A");
    const c = await addClient({ name: "Cliente A", orgId: "9001", groupId: g.id });
    await importZd(admin.id, TICKETS, await ticketsBuffer([ticket({ ticket_id: "216527", organization_id: "9001" }), ticket({ ticket_id: "345678", organization_id: "9001" })]));
    await importWrike(admin.id, wrikeCsv([
      wrikeRow({ ticket: "216.527", tarea: "con punto de millares" }),
      wrikeRow({ ticket: "0", tarea: "cero sin ticket" }),
      wrikeRow({ ticket: "", tarea: "vacío sin ticket" }),
      wrikeRow({ ticket: "999999", tarea: "ticket #345678 en el nombre" }),
      wrikeRow({ ticket: "", tarea: "ticket #345678 solo en el nombre", fecha: "16/01/2025" }),
    ]));
    const e = Object.fromEntries((await wrikeEntries()).map((x) => [x.taskName, x]));
    expect(e["con punto de millares"]).toMatchObject({ ticketId: "216527", ticketState: "CONFIRMED", method: "EXPLICIT", clientId: c.id });
    expect(e["cero sin ticket"]).toMatchObject({ ticketId: null, ticketState: "NONE" });
    expect(e["vacío sin ticket"]).toMatchObject({ ticketId: null, ticketState: "NONE" });
    expect(e["ticket #345678 en el nombre"]).toMatchObject({ ticketId: "999999", ticketState: "PENDING", method: "EXPLICIT" });
    expect(e["ticket #345678 en el nombre"].flags).toEqual(expect.arrayContaining(["TICKET_PENDING", "NAME_CONTRADICTS_EXPLICIT"]));
    expect(e["ticket #345678 solo en el nombre"]).toMatchObject({ ticketId: "345678", ticketState: "CONFIRMED", method: "NAME" });
    expect(e["ticket #345678 solo en el nombre"].flags).toContain("TICKET_BY_NAME");
  });

  it("varios candidatos, versiones, fechas y Bug #N no eligen ticket; conflicto proyecto–ticket visible y horas conservadas", async () => {
    const ga = await addGroup("Grupo A");
    const gb = await addGroup("Grupo B");
    const ca = await addClient({ name: "Cliente A", orgId: "9001", groupId: ga.id });
    await addClient({ name: "Cliente B", orgId: "9002", groupId: gb.id });
    await importZd(admin.id, TICKETS, await ticketsBuffer([ticket({ ticket_id: "123456", organization_id: "9001" }), ticket({ ticket_id: "222222", organization_id: "9002" })]));
    await addProjectEquivalence("WRIKE", "Proyecto Alfa", { clientId: ca.id });
    await importWrike(admin.id, wrikeCsv([
      wrikeRow({ tarea: "ticket #111111 y ticket #222222", fecha: "10/01/2025" }),
      wrikeRow({ tarea: "Bug #123456 corregido", fecha: "11/01/2025" }),
      wrikeRow({ tarea: "Release 2.3.45678 del 10/05/2024", fecha: "12/01/2025" }),
      wrikeRow({ tarea: "ticket #222222 de otro cliente", fecha: "13/01/2025" }),
    ]));
    const e = Object.fromEntries((await wrikeEntries()).map((x) => [x.workDate, x]));
    expect(e["2025-01-10"]).toMatchObject({ ticketId: null, ticketState: "AMBIGUOUS", clientId: ca.id });
    expect(e["2025-01-11"]).toMatchObject({ ticketId: null, ticketState: "NONE" });
    expect(e["2025-01-12"]).toMatchObject({ ticketId: null, ticketState: "NONE" });
    expect(e["2025-01-13"]).toMatchObject({ ticketId: "222222", conflict: true, clientId: null, groupId: null });
    expect(e["2025-01-13"].flags).not.toContain("NO_TICKET");
    expect(Number(e["2025-01-13"].minutes)).toBe(60);
  });

  it("proyecto que solo identifica grupo conserva ese ámbito sin inventar Cliente; un ticket del mismo grupo completa el desglose", async () => {
    const g = await addGroup("Grupo A");
    const c = await addClient({ name: "Cliente A", orgId: "9001", groupId: g.id });
    await importZd(admin.id, TICKETS, await ticketsBuffer([ticket({ ticket_id: "123456", organization_id: "9001" })]));
    await addProjectEquivalence("WRIKE", "Proyecto Alfa", { groupId: g.id });
    await importWrike(admin.id, wrikeCsv([wrikeRow({ tarea: "sin ticket", fecha: "10/01/2025" }), wrikeRow({ tarea: "con ticket", ticket: "123456", fecha: "11/01/2025" })]));
    const e = Object.fromEntries((await wrikeEntries()).map((x) => [x.taskName, x]));
    expect(e["sin ticket"]).toMatchObject({ groupId: g.id, clientId: null });
    expect(e["con ticket"]).toMatchObject({ groupId: g.id, clientId: c.id, scope: "PROJECT_TICKET" });
    expect(e["sin ticket"].flags).toContain("CAUSE_UNCLASSIFIED");
  });
});

describe("política histórica: fuente PMO", () => {
  it("dic-2024: Zendesk 2 h elegibles y Wrike no sustituye; ene-2025: Zendesk 3 h excluidas y Wrike 4 h elegibles; total combinado 6 h", async () => {
    const g = await addGroup("G");
    await addClient({ name: "C", orgId: "9001", groupId: g.id });
    await addPerson({ name: "Ana", zdId: "5001", pmo: [[null, null, true]] });
    await addWrikePerson({ name: "Ana W", alias: "ana.wrike", pmo: [[null, null, true]] });
    await addProjectEquivalence("WRIKE", "Proyecto Alfa", { groupId: g.id });
    // La misma persona real aparece en ambos sistemas: se enlaza el alias de Wrike a la persona de Zendesk.
    const ana = await prisma.person.findFirstOrThrow({ where: { name: "Ana" } });
    await prisma.personAlias.updateMany({ where: { system: "WRIKE" }, data: { personId: ana.id } });
    await prisma.personTerm.deleteMany({ where: { person: { name: "Ana W" } } });
    await importZd(admin.id, TICKETS, await ticketsBuffer([ticket({ ticket_id: "1001", organization_id: "9001" })]));
    const d = (iso: string) => ({ date: excelSerial(iso) });
    await importZd(admin.id, TIEMPO, await timesBuffer([
      timeRow({ date: d("2024-12-10"), logged_hours: 2, logged_minutes: 0 }),
      timeRow({ date: d("2025-01-10"), logged_hours: 3, logged_minutes: 0 }),
    ]));
    await importWrike(admin.id, wrikeCsv([wrikeRow({ fecha: "10/12/2024", horas: "5", tarea: "dic" }), wrikeRow({ fecha: "10/01/2025", horas: "4", tarea: "ene" })]));
    const v = await prisma.$queryRaw<{ source: string; workDate: string; eligibility: string; isEligible: boolean; minutes: string }[]>`
      SELECT source, to_char("workDate",'YYYY-MM-DD') AS "workDate", eligibility, "isEligible", minutes::text FROM "TimeActivity" ORDER BY "workDate", source`;
    expect(v.map((x) => [x.source, x.workDate, x.eligibility])).toEqual([
      ["WRIKE", "2024-12-10", "BEFORE_CUTOFF"], ["ZENDESK", "2024-12-10", "ELIGIBLE"],
      ["WRIKE", "2025-01-10", "ELIGIBLE"], ["ZENDESK", "2025-01-10", "EXCLUDED_PMO"],
    ]);
    expect(await eligibleHours("\"workDate\" >= '2024-12-01' AND \"workDate\" < '2025-02-01'")).toBeCloseTo(2 + 4, 12);
    expect(await eligibleHours("source = 'ZENDESK'")).toBeCloseTo(2, 12);
    expect(await eligibleHours("source = 'WRIKE'")).toBeCloseTo(4, 12);
  });

  it("PMO desconocido no se fuerza; no PMO queda fuera del tiempo PMO elegible; ANA/DEV por vigencia; rol no informado no borra horas", async () => {
    const g = await addGroup("G");
    await addProjectEquivalence("WRIKE", "Proyecto Alfa", { groupId: g.id });
    await addWrikePerson({ name: "Pmo", alias: "pmo", pmo: [["2025-01-01", null, true]], role: [{ name: "ANA", from: null, to: "2025-03-01" }, { name: "DEV", from: "2025-03-01", to: null }] });
    await addWrikePerson({ name: "Otro", alias: "otro", pmo: [["2025-01-01", null, false]] });
    await addWrikePerson({ name: "Desc", alias: "desc" });
    await addWrikePerson({ name: "SinRol", alias: "sinrol", pmo: [[null, null, true]] });
    await importWrike(admin.id, wrikeCsv([
      wrikeRow({ usuario: "pmo", fecha: "10/02/2025", tarea: "ana" }),
      wrikeRow({ usuario: "pmo", fecha: "10/04/2025", tarea: "dev" }),
      wrikeRow({ usuario: "otro", fecha: "10/04/2025", tarea: "otro" }),
      wrikeRow({ usuario: "desc", fecha: "10/04/2025", tarea: "desc" }),
      wrikeRow({ usuario: "fantasma", fecha: "10/04/2025", tarea: "fantasma" }),
      wrikeRow({ usuario: "sinrol", fecha: "10/04/2025", tarea: "sinrol" }),
    ]));
    const e = Object.fromEntries((await wrikeEntries()).map((x) => [x.taskName, x]));
    const roles = Object.fromEntries((await prisma.staffCatalogItem.findMany({ where: { kind: "PMO_ROLE" } })).map((r) => [r.id, r.name]));
    expect(roles[e.ana.roleId as string]).toBe("ANA");
    expect(roles[e.dev.roleId as string]).toBe("DEV");
    expect(e.otro).toMatchObject({ eligibility: "NOT_PMO", bucket: "NOT_PMO" });
    expect(e.desc).toMatchObject({ eligibility: "PENDING_ELIGIBILITY", bucket: "PENDING_ELIGIBILITY" });
    expect(e.fantasma).toMatchObject({ eligibility: "PENDING_ELIGIBILITY", personId: null });
    expect(e.fantasma.flags).toContain("NO_PERSON");
    expect(e.sinrol).toMatchObject({ eligibility: "ELIGIBLE", bucket: "GROUP_ONLY", roleId: null });
    expect(e.sinrol.flags).toContain("NO_ROLE");
    expect(await eligibleHours()).toBeCloseTo(3, 12);
  });
});

describe("repetición, partición y reversión", () => {
  it("repetir el mismo CSV no añade imputaciones; la partición de filas y minutos reconcilia", async () => {
    const rows = [wrikeRow({ tarea: "a", horas: "1" }), wrikeRow({ tarea: "b", horas: "0,5" }), wrikeRow({ tarea: "a", horas: "1" })];
    const first = await importWrike(admin.id, wrikeCsv(rows));
    expect(first.rowsDuplicate).toBe(1);
    expect(await count("WrikeTimeEntry")).toBe(2);
    const second = await importWrike(admin.id, wrikeCsv(rows));
    expect(second.rowsDuplicate).toBe(3);
    expect(await count("WrikeTimeEntry")).toBe(2);
    const p = await prepare(admin.id, WRIKE, wrikeCsv([...rows, wrikeRow({ tarea: "nueva" })]));
    expect(await buckets(p.id)).toEqual({ PENDING_ELIGIBILITY: 1 });
  });

  it("un ticket que llega después completa Wrike (relaciones tardías) y revertir ese lote lo devuelve a pendiente", async () => {
    const g = await addGroup("G");
    const c = await addClient({ name: "C", orgId: "9001", groupId: g.id });
    await importWrike(admin.id, wrikeCsv([wrikeRow({ ticket: "123456" })]));
    expect((await wrikeEntries())[0]).toMatchObject({ ticketState: "PENDING", clientId: null });
    const before = await prisma.wrikeTimeEntry.findFirstOrThrow();
    const t = await importZd(admin.id, TICKETS, await ticketsBuffer([ticket({ ticket_id: "123456", organization_id: "9001" })]));
    expect((await wrikeEntries())[0]).toMatchObject({ ticketState: "CONFIRMED", clientId: c.id });
    const after = await prisma.wrikeTimeEntry.findFirstOrThrow();
    expect(after.workDate).toEqual(before.workDate);
    expect(after.createdAt).toEqual(before.createdAt);
    expect(await count("WrikeTimeEntry")).toBe(1);
    await revertUpload(admin.id, t.id);
    await drain();
    expect((await wrikeEntries())[0]).toMatchObject({ ticketState: "PENDING", clientId: null });
  });

  it("REDERIVE de un lote completado tras completar el alias de la persona no duplica ni mueve fechas", async () => {
    const b = await importWrike(admin.id, wrikeCsv([wrikeRow({ usuario: "nueva.persona", fecha: "10/02/2025" })]));
    expect((await wrikeEntries())[0].eligibility).toBe("PENDING_ELIGIBILITY");
    await addWrikePerson({ name: "Nueva", alias: "nueva.persona", pmo: [[null, null, true]] });
    const { reprocessUpload } = await import("@/server/uploads/batches");
    await reprocessUpload(admin.id, b.id);
    await drain();
    const e = await wrikeEntries();
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ eligibility: "ELIGIBLE", workDate: "2025-02-10" });
  });

  it("revertir retira solo lo no compartido con otro lote vigente", async () => {
    const a = await importWrike(admin.id, wrikeCsv([wrikeRow({ tarea: "x" }), wrikeRow({ tarea: "y" })]));
    const b = await importWrike(admin.id, wrikeCsv([wrikeRow({ tarea: "x" }), wrikeRow({ tarea: "z" })]));
    await revertUpload(admin.id, a.id);
    await drain();
    expect((await wrikeEntries()).map((e) => e.taskName)).toEqual(["x", "z"]);
    await revertUpload(admin.id, b.id);
    await drain();
    expect(await count("WrikeTimeEntry")).toBe(0);
  });
});

describe("corrección explícita sin ID (Wrike y Zendesk)", () => {
  const decide = (batchId: string, fingerprint: string, targetEntryId: string, rev: number, extra = {}) =>
    decideTimeCorrection(admin.id, batchId, { fingerprint, decision: "CORRECTION", targetEntryId, expectedEntryRevision: rev, confirmReplace: true, ...extra });

  it("Wrike: la selección manual crea una revisión (no dos duraciones), conserva el anterior y revertir restituye", async () => {
    await importWrike(admin.id, wrikeCsv([wrikeRow({ tarea: "Informe mensual", horas: "1" })]));
    const target = await prisma.wrikeTimeEntry.findFirstOrThrow();
    const b = await prepare(admin.id, WRIKE, wrikeCsv([wrikeRow({ tarea: "Informe mensual", horas: "2,5" })]));
    // Sin ID ni candidato automático: la fila es nueva hasta que el Administrador la relaciona.
    expect((await buckets(b.id)).PENDING_ELIGIBILITY).toBe(1);
    const row = await prisma.uploadStagedRow.findFirstOrThrow({ where: { batchId: b.id } });
    const cands = await listCorrectionTargets(admin.id, b.id, { text: "informe" });
    expect(cands?.map((c) => c.id)).toEqual([target.id]);
    const cmp = await getCorrectionCompare(admin.id, b.id, row.fingerprint as string, target.id);
    expect(cmp?.differences).toEqual(["Minutos"]);
    expect([cmp?.target?.minutes, cmp?.incomingMinutes]).toEqual(["60", "150"]);
    await decide(b.id, row.fingerprint as string, target.id, target.revision);
    await confirmUpload(admin.id, b.id);
    await drain();
    expect((await batch(b.id)).status).toBe("COMPLETED");
    const e = await prisma.wrikeTimeEntry.findMany();
    expect(e).toHaveLength(1);
    expect([Number(e[0].minutes), e[0].revision]).toEqual([150, 2]);
    const c = await prisma.wrikeTimeCorrection.findFirstOrThrow();
    expect([Number(c.minutesBefore), Number(c.minutesAfter)]).toEqual([60, 150]);
    const audit = await prisma.auditEvent.findFirst({ where: { batchId: b.id, entityType: "TimeDecision" } });
    expect(audit?.summary).toMatch(/1 h → 2.5 h/);
    await revertUpload(admin.id, b.id);
    await drain();
    expect(Number((await prisma.wrikeTimeEntry.findFirstOrThrow()).minutes)).toBe(60);
  });

  it("Zendesk sin id: se puede elegir un registro activo; no suma; otra fuente, inexistente o versión obsoleta se rechazan", async () => {
    await importZd(admin.id, TIEMPO, await timesBuffer([timeRow({ id: null, logged_hours: 1, logged_minutes: 0 })]));
    const z = await prisma.zdTimeEntry.findFirstOrThrow();
    await importWrike(admin.id, wrikeCsv([wrikeRow({ tarea: "w" })]));
    const w = await prisma.wrikeTimeEntry.findFirstOrThrow();
    const b = await prepare(admin.id, TIEMPO, await timesBuffer([timeRow({ id: null, logged_hours: 3, logged_minutes: 0 })]));
    const row = await prisma.uploadStagedRow.findFirstOrThrow({ where: { batchId: b.id } });
    expect(row.disposition).toBe("NEW");
    // El objetivo de otra fuente no existe como registro Zendesk.
    await expect(decide(b.id, row.fingerprint as string, w.id, 1)).rejects.toThrow(/no existe como registro activo/);
    await expect(decide(b.id, row.fingerprint as string, z.id, z.revision + 3)).rejects.toThrow(/cambió/);
    await expect(decideTimeCorrection(admin.id, b.id, { fingerprint: row.fingerprint, decision: "CORRECTION", targetEntryId: z.id, expectedEntryRevision: z.revision })).rejects.toThrow(/Confirme/);
    const cur = await batch(b.id);
    await expect(decide(b.id, row.fingerprint as string, z.id, z.revision, { expectedBatchVersion: cur.version + 7 })).rejects.toThrow(/cambiado|versión|modificad/i);
    expect(await count("ZdTimeDecision")).toBe(0);
    await decide(b.id, row.fingerprint as string, z.id, z.revision, { expectedBatchVersion: cur.version });
    await confirmUpload(admin.id, b.id);
    await drain();
    const all = await prisma.zdTimeEntry.findMany();
    expect(all).toHaveLength(1);
    expect(Number(all[0].minutes)).toBe(180);
  });

  it("una decisión obsoleta (el objetivo cambió después) deja la fila pendiente: ni corrige a ciegas ni crea un registro nuevo", async () => {
    await importWrike(admin.id, wrikeCsv([wrikeRow({ tarea: "t", horas: "1" })]));
    const target = await prisma.wrikeTimeEntry.findFirstOrThrow();
    const b = await prepare(admin.id, WRIKE, wrikeCsv([wrikeRow({ tarea: "t", horas: "2" })]));
    const row = await prisma.uploadStagedRow.findFirstOrThrow({ where: { batchId: b.id } });
    await decide(b.id, row.fingerprint as string, target.id, target.revision);
    // Otro lote corrige el mismo registro antes de activar este.
    const b2 = await prepare(admin.id, WRIKE, wrikeCsv([wrikeRow({ tarea: "t", horas: "4" })]));
    const row2 = await prisma.uploadStagedRow.findFirstOrThrow({ where: { batchId: b2.id } });
    await decide(b2.id, row2.fingerprint as string, target.id, target.revision);
    await confirmUpload(admin.id, b2.id);
    await drain();
    expect(Number((await prisma.wrikeTimeEntry.findFirstOrThrow()).minutes)).toBe(240);
    const cmp = await getCorrectionCompare(admin.id, b.id, row.fingerprint as string);
    expect(cmp?.decision?.stale).toBe(true);
    await confirmUpload(admin.id, b.id);
    await drain();
    const e = await prisma.wrikeTimeEntry.findMany();
    expect(e).toHaveLength(1);
    expect(Number(e[0].minutes)).toBe(240);
  });

  it("un registro solo puede ser corregido por una fila del lote", async () => {
    await importWrike(admin.id, wrikeCsv([wrikeRow({ tarea: "t", horas: "1" })]));
    const target = await prisma.wrikeTimeEntry.findFirstOrThrow();
    const b = await prepare(admin.id, WRIKE, wrikeCsv([wrikeRow({ tarea: "t", horas: "2" }), wrikeRow({ tarea: "t", horas: "3" })]));
    const rows = await prisma.uploadStagedRow.findMany({ where: { batchId: b.id }, orderBy: { position: "asc" } });
    await decide(b.id, rows[0].fingerprint as string, target.id, target.revision);
    await expect(decide(b.id, rows[1].fingerprint as string, target.id, target.revision)).rejects.toThrow(/otra fila/);
  });

  it("solo el Administrador decide; Consulta no muta", async () => {
    const reader = await prisma.user.findUniqueOrThrow({ where: { email: "lectura@test.local" } });
    await importWrike(admin.id, wrikeCsv([wrikeRow({ tarea: "t", horas: "1" })]));
    const target = await prisma.wrikeTimeEntry.findFirstOrThrow();
    const b = await prepare(admin.id, WRIKE, wrikeCsv([wrikeRow({ tarea: "t", horas: "2" })]));
    const row = await prisma.uploadStagedRow.findFirstOrThrow({ where: { batchId: b.id } });
    await expect(decideTimeCorrection(reader.id, b.id, { fingerprint: row.fingerprint, decision: "CORRECTION", targetEntryId: target.id, expectedEntryRevision: 1, confirmReplace: true })).rejects.toThrow();
    await expect(listCorrectionTargets(reader.id, b.id, { text: "t" })).rejects.toThrow();
    expect(await count("WrikeTimeDecision")).toBe(0);
  });
});

void importFile;
