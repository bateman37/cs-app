import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { confirmUpload, reprocessUpload, revertUpload } from "@/server/uploads/batches";
import { runOnce } from "@/server/uploads/worker";
import { decideTimeCorrection } from "@/server/zendesk/corrections";
import { listBatchTimes, listCorrectionCandidates, timesSummary } from "@/server/zendesk/summary";
import { batch, drain, freshEnvironment, removeUploadDir, useUploadDir } from "./cargas-helpers";
import { excelSerial, ticket, ticketsBuffer, timeRow, timesBuffer, type TimeRow } from "./generators/zendesk";
import { addClient, addGroup, addPerson, addPersonAlias, count, entries, importZd, prepareZd, sumHours, TICKETS, TIEMPO, decideCorrection } from "./zendesk-helpers";

let dir: string;
let admin: { id: string };
beforeAll(() => { dir = useUploadDir(); });
afterAll(() => removeUploadDir(dir));
beforeEach(async () => { ({ admin } = await freshEnvironment()); });

const day = (iso: string) => ({ date: excelSerial(iso) });
const T = (rows: TimeRow[], o = {}) => timesBuffer(rows, o);
const hourAt = (h: number, m: number) => ({ date: (h * 60 + m) / 1440 });
const bucketsOf = async (batchId: string) => Object.fromEntries((await timesSummary(admin.id, batchId))!.buckets.filter((b) => b.rows > 0).map((b) => [b.bucket, b.rows]));

describe("duración y estructura (ZTM 01)", () => {
  it("1 h + 30 min = 1,5 h; 0 h + 5 min = 1/12 h; la hora del registro no suma duración", async () => {
    await importZd(admin.id, TIEMPO, await T([
      timeRow({ logged_hours: 1, logged_minutes: 30, hour: hourAt(8, 25), date: day("2024-03-06") }),
      timeRow({ logged_hours: 0, logged_minutes: 5, hour: hourAt(8, 25), date: day("2024-03-07") }),
    ]));
    const e = await entries();
    expect(e.map((x) => Number(x.minutes))).toEqual([90, 5]);
    expect(await sumHours()).toBeCloseTo(1.5 + 5 / 60, 12);
    const row = await prisma.zdTimeEntry.findFirstOrThrow({ where: { workDate: new Date("2024-03-06T00:00:00Z") } });
    expect(row.hourText).toBe("08:25:00");
    expect(Number(row.minutes)).toBe(90);
  });

  it("doce registros de cinco minutos suman exactamente una hora, sin acumular redondeos", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => timeRow({ logged_hours: 0, logged_minutes: 5, hour: hourAt(8, i * 5) }));
    await importZd(admin.id, TIEMPO, await T(rows));
    expect(await count("ZdTimeEntry")).toBe(12);
    const r = await prisma.$queryRaw<{ h: string }[]>`SELECT (sum(minutes) / 60)::text AS h FROM "ZdTimeEntry"`;
    expect(r[0].h).toMatch(/^1(\.0+)?$/);
  });

  it("conserva la precisión de los componentes decimales sin redondear por fila", async () => {
    await importZd(admin.id, TIEMPO, await T([timeRow({ logged_hours: 0, logged_minutes: "5.5" }), timeRow({ logged_hours: "0.083333333333333", logged_minutes: 0, hour: hourAt(9, 0) })]));
    const r = await prisma.$queryRaw<{ m: string }[]>`SELECT string_agg(minutes::text, ',' ORDER BY minutes) AS m FROM "ZdTimeEntry"`;
    expect(r[0].m.replace(/0+(,|$)/g, "$1")).toBe("4.99999999999998,5.5");
  });

  it("cero es válido; vacío, negativo o ilegible es error y no se convierte en cero", async () => {
    const ok = await importZd(admin.id, TIEMPO, await T([timeRow({ logged_hours: 0, logged_minutes: 0 })]));
    expect(ok.rowsError).toBe(0);
    expect(Number((await entries())[0].minutes)).toBe(0);
    const bad = await prepareZd(admin.id, TIEMPO, await T([
      timeRow({ ticket_id: "1", logged_hours: null }),
      timeRow({ ticket_id: "2", logged_minutes: -5 }),
      timeRow({ ticket_id: "3", logged_hours: "abc" }),
      timeRow({ ticket_id: "4", date: "no-es-fecha" }),
      timeRow({ ticket_id: "", }),
    ]));
    expect(bad.rowsError).toBe(5);
    await expect(confirmUpload(admin.id, bad.id)).rejects.toThrow(/errores obligatorios/);
    expect(await count("ZdTimeEntry")).toBe(1);
  });

  it("las once cabeceras son obligatorias aunque id esté vacío; las columnas calculadas posteriores no son entrada", async () => {
    const miss = await prepareZd(admin.id, TIEMPO, await T([timeRow()], { headers: ["ticket_id", "user_id", "user_name", "date", "hour", "logged_hours", "logged_minutes", "Día de la semana", "Segmentador app time", "ident", "type"] }));
    expect(miss.status).toBe("REJECTED");
    expect(miss.statusDetail).toMatch(/«id»/);
    const extra = await prepareZd(admin.id, TIEMPO, await T([timeRow()], { extraColumn: true }));
    expect(extra.status).toBe("READY");
    expect((extra.summary as { notes?: string[] }).notes?.[0]).toMatch(/columna_extra/);
  });

  it("fechas 1900 y 1904 y de texto dd/mm sin desplazamiento; ticket_id exacto", async () => {
    await importZd(admin.id, TIEMPO, await T([timeRow({ ticket_id: "123456789012345", date: "31/12/2024" })]));
    expect(await prisma.zdTimeEntry.count({ where: { ticketId: "123456789012345", workDate: new Date("2024-12-31T00:00:00Z") } })).toBe(1);
    ({ admin } = await freshEnvironment());
    await importZd(admin.id, TIEMPO, await T([timeRow({ date: { date: excelSerial("2024-12-31", true) } })], { date1904: true }));
    expect((await entries())[0].workDate).toBe("2024-12-31");
  });

  it("falta de user_id o alias es un aviso de atribución, no un error; hora ilegible no se convierte en duración", async () => {
    const b = await importZd(admin.id, TIEMPO, await T([timeRow({ user_id: null, user_name: null }), timeRow({ hour: "tarde", logged_minutes: 10, ticket_id: "2" })]));
    expect(b.rowsError).toBe(0);
    const codes = ((b.summary as { issues: { code: string }[] }).issues).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["SIN_PERSONA", "HORA_ILEGIBLE"]));
    expect(await sumHours()).toBeCloseTo(1.5 + (60 + 10) / 60, 12);
  });
});

describe("identidad, duplicados y correcciones (ZTM 05, IMP 04-05)", () => {
  it("un tiempo con id vacío carga; dos filas distintas del mismo ticket/persona/día suman ambas", async () => {
    await importZd(admin.id, TIEMPO, await T([
      timeRow({ id: null, logged_hours: 1, logged_minutes: 0, hour: hourAt(9, 0) }),
      timeRow({ id: null, logged_hours: 0, logged_minutes: 30, hour: hourAt(11, 0) }),
    ]));
    expect(await count("ZdTimeEntry")).toBe(2);
    expect(await sumHours()).toBeCloseTo(1.5, 12);
  });

  it("un id reutilizado en trabajos distintos no descarta ninguno ni impone unicidad global", async () => {
    const b = await importZd(admin.id, TIEMPO, await T([
      timeRow({ id: "77", ticket_id: "1", logged_minutes: 10 }),
      timeRow({ id: "77", ticket_id: "2", user_id: "5002", user_name: "Otra", date: day("2024-04-01"), logged_hours: 2, logged_minutes: 0 }),
    ]));
    expect(await count("ZdTimeEntry")).toBe(2);
    expect(await count("ZdTimeEntry", `"sourceId" = '77'`)).toBe(2);
    expect(await bucketsOf(b.id)).not.toHaveProperty("PENDING_DECISION");
  });

  it("la misma fila en dos lotes computa una vez y conserva ambas procedencias; también dentro del archivo", async () => {
    const row = timeRow({ id: "5" });
    const a = await importZd(admin.id, TIEMPO, await T([row, row]));
    const b = await importZd(admin.id, TIEMPO, await T([row, timeRow({ id: "6", logged_minutes: 0, logged_hours: 3, hour: hourAt(14, 0) })]));
    expect(await count("ZdTimeEntry")).toBe(2);
    expect(await sumHours()).toBeCloseTo(1.5 + 3, 12);
    const sources = await prisma.uploadRecordSource.findMany({ where: { fingerprint: (await prisma.zdTimeEntry.findFirstOrThrow({ where: { sourceId: "5" } })).originFingerprint } });
    expect(sources.map((s) => s.batchId).sort()).toEqual([a.id, b.id].sort());
    expect(a.rowsDuplicate).toBe(1);
    expect(b.rowsDuplicate).toBe(1);
  });

  it("el solapamiento entre exports (enero–junio y mayo–octubre) se deduplica sin intervalo ni año como ámbito", async () => {
    const mk = (m: number) => timeRow({ date: day(`2024-${String(m).padStart(2, "0")}-10`), hour: hourAt(9, m) });
    await importZd(admin.id, TIEMPO, await T([1, 2, 3, 4, 5, 6].map(mk)), { declared: { desde: "2024-01-01", hasta: "2024-06-30" } });
    await importZd(admin.id, TIEMPO, await T([5, 6, 7, 8, 9, 10].map(mk)), { declared: { desde: "2024-05-01", hasta: "2024-10-31" } });
    expect(await count("ZdTimeEntry")).toBe(10);
  });

  it("una posible corrección (mismo id y contexto, duración distinta) se advierte y no se aplica ni suma por defecto", async () => {
    await importZd(admin.id, TIEMPO, await T([timeRow({ id: "88", logged_hours: 1, logged_minutes: 0 }), timeRow({ id: "89", ticket_id: "2", logged_hours: 2, logged_minutes: 0 })]));
    const b = await prepareZd(admin.id, TIEMPO, await T([timeRow({ id: "88", logged_hours: 2, logged_minutes: 0 }), timeRow({ id: "90", ticket_id: "3", logged_hours: 4, logged_minutes: 0 })]));
    expect(await bucketsOf(b.id)).toMatchObject({ PENDING_DECISION: 1 });
    const cands = await listCorrectionCandidates(admin.id, b.id);
    expect(cands).toHaveLength(1);
    expect(cands[0]).toMatchObject({ source_id: "88", new_hours: "2" });
    expect(cands[0].matches.map((m) => m.hours)).toEqual(["1"]);
    // Se confirma sin decidir: el resto válido se activa, la fila pendiente conserva su bruto y no añade actividad.
    await confirmUpload(admin.id, b.id);
    await drain();
    expect((await batch(b.id)).status).toBe("COMPLETED");
    expect(await sumHours()).toBeCloseTo(1 + 2 + 4, 12);
    expect(await count("ZdTimeEntry", `"sourceId" = '88'`)).toBe(1);
    const staged = await prisma.uploadStagedRow.findFirstOrThrow({ where: { batchId: b.id, disposition: "PENDING_DECISION" } });
    expect(staged.raw).toBeTruthy();
    // La fila pendiente no cuenta como importada ni como fuente aportada.
    expect(await prisma.uploadRecordSource.count({ where: { batchId: b.id, fingerprint: staged.fingerprint ?? "" } })).toBe(0);
  });

  it("corrección explícita: sustituye la duración, conserva el contenido anterior como revisión y no suma ambas", async () => {
    await importZd(admin.id, TIEMPO, await T([timeRow({ id: "88", logged_hours: 1, logged_minutes: 0 })]));
    const b = await prepareZd(admin.id, TIEMPO, await T([timeRow({ id: "88", logged_hours: 2, logged_minutes: 0 })]));
    const [cand] = await listCorrectionCandidates(admin.id, b.id);
    await decideCorrection(admin.id, b.id, cand.fingerprint, cand.matches[0].id);
    expect((await timesSummary(admin.id, b.id))?.pendingCorrections).toBe(0);
    await confirmUpload(admin.id, b.id);
    await drain();
    expect(await count("ZdTimeEntry")).toBe(1);
    expect(await sumHours()).toBeCloseTo(2, 12);
    const c = await prisma.zdTimeCorrection.findFirstOrThrow();
    expect([Number(c.minutesBefore), Number(c.minutesAfter), c.batchId]).toEqual([60, 120, b.id]);
    expect((c.previous as { loggedHours: string }).loggedHours).toBe("1");
    const audit = await prisma.auditEvent.findFirst({ where: { batchId: b.id, entityType: "TimeDecision" } });
    expect(audit?.summary).toMatch(/1 h → 2 h/);
    // Cargar de nuevo el contenido antiguo no lo restituye ni lo duplica.
    await importZd(admin.id, TIEMPO, await T([timeRow({ id: "88", logged_hours: 1, logged_minutes: 0 })]));
    expect(await sumHours()).toBeCloseTo(2, 12);
  });

  it("«es otro trabajo» materializa la fila como distinta; sin id no hay revisión automática por parecido", async () => {
    await importZd(admin.id, TIEMPO, await T([timeRow({ id: "88", logged_hours: 1, logged_minutes: 0 }), timeRow({ id: null, logged_hours: 0, logged_minutes: 20, hour: hourAt(7, 0) })]));
    const b = await prepareZd(admin.id, TIEMPO, await T([timeRow({ id: "88", logged_hours: 2, logged_minutes: 0 }), timeRow({ id: null, logged_hours: 0, logged_minutes: 40, hour: hourAt(7, 0) })]));
    expect(await bucketsOf(b.id)).toMatchObject({ PENDING_DECISION: 1 });
    const [cand] = await listCorrectionCandidates(admin.id, b.id);
    await decideTimeCorrection(admin.id, b.id, { fingerprint: cand.fingerprint, decision: "DIFFERENT" });
    await confirmUpload(admin.id, b.id);
    await drain();
    expect(await sumHours()).toBeCloseTo(1 + 2 + 20 / 60 + 40 / 60, 12);
    expect(await count("ZdTimeCorrection")).toBe(0);
  });

  it("una decisión solo vale en un lote listo, con objetivo activo de la misma fuente, revisión vista y confirmación expresa", async () => {
    await importZd(admin.id, TIEMPO, await T([timeRow({ id: "88" }), timeRow({ id: "91", ticket_id: "9" })]));
    const b = await prepareZd(admin.id, TIEMPO, await T([timeRow({ id: "88", logged_hours: 2 })]));
    const [cand] = await listCorrectionCandidates(admin.id, b.id);
    const target = cand.matches[0].id;
    const rev = (await prisma.zdTimeEntry.findUniqueOrThrow({ where: { id: target } })).revision;
    await expect(decideTimeCorrection(admin.id, b.id, { fingerprint: cand.fingerprint, decision: "CORRECTION" })).rejects.toThrow(/Seleccione el registro/);
    await expect(decideTimeCorrection(admin.id, b.id, { fingerprint: cand.fingerprint, decision: "CORRECTION", targetEntryId: target, expectedEntryRevision: rev })).rejects.toThrow(/Confirme expresamente/);
    await expect(decideTimeCorrection(admin.id, b.id, { fingerprint: cand.fingerprint, decision: "CORRECTION", targetEntryId: target, confirmReplace: true })).rejects.toThrow(/revisión/);
    await expect(decideTimeCorrection(admin.id, b.id, { fingerprint: cand.fingerprint, decision: "CORRECTION", targetEntryId: target, expectedEntryRevision: rev + 5, confirmReplace: true })).rejects.toThrow(/cambió/);
    await expect(decideCorrection(admin.id, b.id, cand.fingerprint, "no-existe")).rejects.toThrow();
    expect(await count("ZdTimeDecision")).toBe(0);
    await confirmUpload(admin.id, b.id);
    await expect(decideTimeCorrection(admin.id, b.id, { fingerprint: cand.fingerprint, decision: "DIFFERENT" })).rejects.toThrow(/listo para revisar/);
  });

  it("revertir el lote que corrigió restituye el contenido anterior; el origen revertido después retira el registro", async () => {
    const a = await importZd(admin.id, TIEMPO, await T([timeRow({ id: "88", logged_hours: 1, logged_minutes: 0 })]));
    const b = await prepareZd(admin.id, TIEMPO, await T([timeRow({ id: "88", logged_hours: 2, logged_minutes: 0 })]));
    const [cand] = await listCorrectionCandidates(admin.id, b.id);
    await decideCorrection(admin.id, b.id, cand.fingerprint, cand.matches[0].id);
    await confirmUpload(admin.id, b.id);
    await drain();
    expect(await sumHours()).toBeCloseTo(2, 12);
    await revertUpload(admin.id, b.id);
    await drain();
    expect(await sumHours()).toBeCloseTo(1, 12);
    expect(await count("ZdTimeEntry")).toBe(1);
    await revertUpload(admin.id, a.id);
    await drain();
    expect(await count("ZdTimeEntry")).toBe(0);
  });
});

describe("corte histórico PMO (ZTM 03)", () => {
  async function seed() {
    const group = await addGroup("Grupo");
    await addClient({ name: "Cliente", orgId: "9001", groupId: group.id });
    await importZd(admin.id, TICKETS, await ticketsBuffer([ticket()]));
  }

  it("2 h de PMO en diciembre de 2024 son permitidas; 3 h en enero de 2025 quedan excluidas pero se conservan", async () => {
    await seed();
    await addPerson({ name: "Ana PMO", zdId: "5001", pmo: [[null, null, true]] });
    const b = await importZd(admin.id, TIEMPO, await T([
      timeRow({ date: day("2024-12-31"), logged_hours: 2, logged_minutes: 0, hour: hourAt(9, 0) }),
      timeRow({ date: day("2025-01-01"), logged_hours: 3, logged_minutes: 0, hour: hourAt(9, 0) }),
    ]));
    const e = await entries();
    expect(e.map((x) => [x.workDate, x.bucket])).toEqual([["2024-12-31", "ATTRIBUTABLE"], ["2025-01-01", "EXCLUDED_PMO"]]);
    expect(await count("ZdTimeEntry")).toBe(2);
    const s = await timesSummary(admin.id, b.id);
    expect(Object.fromEntries(s!.buckets.filter((x) => x.rows).map((x) => [x.bucket, x.hours]))).toEqual({ ATTRIBUTABLE: "2", EXCLUDED_PMO: "3" });
    expect(s?.reconciled).toBe(true);
  });

  it("IT/Plataforma no PMO desde 2025 siguen elegibles; PMO desconocido queda pendiente y explicado; antes de 2025 una persona desconocida no prohíbe la fuente", async () => {
    await seed();
    await addPerson({ name: "Ivan IT", zdId: "5001", pmo: [[null, null, false]] });
    await addPerson({ name: "Pat sin dato", zdId: "5002" });
    const b = await importZd(admin.id, TIEMPO, await T([
      timeRow({ date: day("2025-02-10") }),
      timeRow({ user_id: "5002", user_name: "Pat sin dato", date: day("2025-02-10") }),
      timeRow({ user_id: "9999", user_name: "Desconocida", date: day("2025-02-10") }),
      timeRow({ user_id: "9999", user_name: "Desconocida", date: day("2024-06-10") }),
    ]));
    const e = await entries();
    expect(e.map((x) => x.bucket)).toEqual(["NO_PERSON", "ATTRIBUTABLE", "PENDING_ELIGIBILITY", "PENDING_ELIGIBILITY"]);
    const s = await timesSummary(admin.id, b.id);
    expect(s?.buckets.find((x) => x.bucket === "PENDING_ELIGIBILITY")?.rows).toBe(2);
    expect(s?.reconciled).toBe(true);
  });

  it("la pertenencia es la vigente a la fecha del trabajo, no la actual: sale de PMO en marzo de 2025", async () => {
    await seed();
    await addPerson({ name: "Eli", zdId: "5001", pmo: [[null, "2025-03-01", true], ["2025-03-01", null, false]] });
    await importZd(admin.id, TIEMPO, await T([
      timeRow({ date: day("2025-02-10") }),
      timeRow({ date: day("2025-03-10") }),
    ]));
    expect((await entries()).map((x) => x.bucket)).toEqual(["EXCLUDED_PMO", "ATTRIBUTABLE"]);
  });
});

describe("relaciones tardías y reproceso (IMP 03)", () => {
  it("tiempos antes que tickets: se resuelven después sin recrear ni doblar los tiempos", async () => {
    const group = await addGroup("G");
    await addClient({ name: "Cliente", orgId: "9001", groupId: group.id });
    await addPerson({ name: "Ana", zdId: "5001", pmo: [[null, null, false]] });
    const t = await importZd(admin.id, TIEMPO, await T([timeRow(), timeRow({ ticket_id: "1002", logged_hours: 2, logged_minutes: 0 })]));
    const before = await entries();
    expect(before.map((x) => x.bucket)).toEqual(["NO_TICKET", "NO_TICKET"]);
    expect(before.every((x) => x.flags.includes("NO_TICKET"))).toBe(true);
    const summary = await timesSummary(admin.id, t.id);
    expect(summary?.buckets.find((x) => x.bucket === "NO_TICKET")?.hours).toBe("3.5");
    const ids = before.map((x) => x.id);
    await importZd(admin.id, TICKETS, await ticketsBuffer([ticket(), ticket({ ticket_id: "1002" })]));
    const after = await entries();
    expect(after.map((x) => x.bucket)).toEqual(["ATTRIBUTABLE", "ATTRIBUTABLE"]);
    expect(after.map((x) => x.id)).toEqual(ids);
    expect(await count("ZdTimeEntry")).toBe(2);
    expect(await sumHours()).toBeCloseTo(3.5, 12);
    // Con versión de derivados y trazabilidad: el cambio quedó anotado.
    const e = await prisma.zdTimeEntry.findFirstOrThrow({ where: { ticketId: "1001" } });
    expect(e.drvVersion).toBe(2);
    expect(e.drvBatchId).not.toBe(t.id);
  });

  it("completar alias, equivalencia o grupo permite reprocesar el lote sin tocar el archivo ni la fecha de trabajo; Cliente sin grupo no pierde su identidad", async () => {
    await importZd(admin.id, TICKETS, await ticketsBuffer([ticket()]));
    const t = await importZd(admin.id, TIEMPO, await T([timeRow({ user_id: "5001", user_name: "Ana Prueba" })]));
    expect((await entries())[0].bucket).toBe("NO_ORGANIZATION".replace("NO_ORGANIZATION", "NO_CLIENT"));
    const client = await addClient({ name: "Cliente sin grupo" });
    await prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: "9001", searchValue: "9001", clientId: client.id } });
    await reprocessUpload(admin.id, t.id);
    await drain();
    let e = (await entries())[0];
    expect(e.bucket).toBe("NO_PERSON");
    expect(e.clientId).toBe(client.id);
    expect(e.flags).toContain("NO_GROUP");
    const person = await addPerson({ name: "Ana", zdName: "Ana Prueba", pmo: [[null, null, false]] });
    await reprocessUpload(admin.id, t.id);
    await drain();
    e = (await entries())[0];
    expect(e.bucket).toBe("ATTRIBUTABLE");
    expect(e.personId).toBe(person.id);
    expect(e.flags).toEqual(expect.arrayContaining(["PERSON_BY_NAME", "NO_GROUP"]));
    expect(e.workDate).toBe("2024-03-06");
    expect(await count("ZdTimeEntry")).toBe(1);
    const stagedRaw = await prisma.uploadStagedRow.count({ where: { batchId: t.id } });
    expect(stagedRaw).toBe(1);
    const audit = await prisma.auditEvent.findMany({ where: { batchId: t.id, action: "REPROCESS" } });
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });

  it("completar el Grupo BC de un Cliente permite reprocesar: se actualiza la agrupación y la atribución al Cliente no cambia", async () => {
    await importZd(admin.id, TICKETS, await ticketsBuffer([ticket()]));
    const client = await addClient({ name: "Cliente sin grupo", orgId: "9001" });
    await addPerson({ name: "Ana", zdId: "5001", pmo: [[null, null, false]] });
    const t = await importZd(admin.id, TIEMPO, await T([timeRow()]));
    let e = await prisma.zdTimeEntry.findFirstOrThrow();
    expect([e.drvBucket, e.drvClientId, e.drvGroupId, e.drvFlags]).toEqual(["ATTRIBUTABLE", client.id, null, ["NO_GROUP"]]);
    const group = await addGroup("Grupo BC");
    await prisma.client.update({ where: { id: client.id }, data: { groupId: group.id } });
    await reprocessUpload(admin.id, t.id);
    await drain();
    e = await prisma.zdTimeEntry.findFirstOrThrow();
    expect([e.drvBucket, e.drvClientId, e.drvGroupId, e.drvFlags, e.drvVersion]).toEqual(["ATTRIBUTABLE", client.id, group.id, [], 2]);
  });

  it("el nombre solo vale como alias explícito: nunca por parecido; un ID reconocido no se reasigna por el nombre", async () => {
    await importZd(admin.id, TICKETS, await ticketsBuffer([ticket()]));
    const ana = await addPerson({ name: "Ana", zdId: "5001", pmo: [[null, null, false]] });
    const bea = await addPerson({ name: "Bea", zdName: "ana prueba", pmo: [[null, null, false]] });
    await addClient({ name: "Cliente", orgId: "9001" });
    await importZd(admin.id, TIEMPO, await T([
      timeRow({ user_id: "5001", user_name: "Ana Prueba" }),
      timeRow({ user_id: null, user_name: "Ana Pruebas", hour: hourAt(10, 0) }),
      timeRow({ user_id: null, user_name: "Ana Prueba", hour: hourAt(11, 0) }),
    ]));
    const rows = await prisma.zdTimeEntry.findMany({ orderBy: { hourText: "asc" } });
    expect(rows[0]).toMatchObject({ drvPersonId: ana.id, drvPersonVia: "ID" });
    expect(rows[0].drvFlags).toContain("NAME_ID_CONFLICT");
    expect(rows[1].drvPersonId).toBeNull();
    expect(rows[2]).toMatchObject({ drvPersonId: bea.id, drvPersonVia: "NAME" });
  });

  it("los alias con vigencia: un ID asignado a otra persona después de la fecha no se aplica", async () => {
    await importZd(admin.id, TICKETS, await ticketsBuffer([ticket()]));
    await addClient({ name: "Cliente", orgId: "9001" });
    const p = await addPerson({ name: "Ana" });
    await prisma.personAlias.create({ data: { personId: p.id, system: "ZENDESK", kind: "ID", rawValue: "5001", searchValue: "5001", validFrom: new Date("2025-01-01T00:00:00Z") } });
    await importZd(admin.id, TIEMPO, await T([timeRow({ date: day("2024-12-31") }), timeRow({ date: day("2025-01-02"), hour: hourAt(9, 0) })]));
    expect((await entries()).map((x) => !!x.personId)).toEqual([false, true]);
  });
});

describe("reversión (IMP 06)", () => {
  it("respeta filas compartidas con otro lote activo y no borra tiempos de otro lote; el orden de reversión es indiferente", async () => {
    const shared = timeRow({ id: "1", logged_minutes: 15 });
    const a = await importZd(admin.id, TIEMPO, await T([shared, timeRow({ id: "2", ticket_id: "2" })]));
    const b = await importZd(admin.id, TIEMPO, await T([shared, timeRow({ id: "3", ticket_id: "3" })]));
    await revertUpload(admin.id, a.id);
    await drain();
    expect((await entries()).map((x) => x.sourceId).sort()).toEqual(["1", "3"]);
    await revertUpload(admin.id, b.id);
    await drain();
    expect(await count("ZdTimeEntry")).toBe(0);
  });

  it("revertir tickets no borra tiempos: actualiza su atribución con las observaciones que siguen vigentes", async () => {
    const group = await addGroup("G");
    await addClient({ name: "Cliente", orgId: "9001", groupId: group.id });
    await addPerson({ name: "Ana", zdId: "5001", pmo: [[null, null, false]] });
    const tk = await importZd(admin.id, TICKETS, await ticketsBuffer([ticket()]));
    await importZd(admin.id, TIEMPO, await T([timeRow()]));
    expect((await entries())[0].bucket).toBe("ATTRIBUTABLE");
    await revertUpload(admin.id, tk.id);
    await drain();
    expect(await count("ZdTimeEntry")).toBe(1);
    expect((await entries())[0].bucket).toBe("NO_TICKET");
  });

  it("un cambio de organización del ticket reatribuye sus tiempos sin releer el log", async () => {
    const g = await addGroup("G");
    const c1 = await addClient({ name: "Cliente 1", orgId: "9001", groupId: g.id });
    const c2 = await addClient({ name: "Cliente 2", orgId: "9002", groupId: g.id });
    await addPerson({ name: "Ana", zdId: "5001", pmo: [[null, null, false]] });
    await importZd(admin.id, TICKETS, await ticketsBuffer([ticket({ organization_id: "9001" })]), { declared: { extraccion: "2026-01-01" } });
    await importZd(admin.id, TIEMPO, await T([timeRow()]));
    expect((await entries())[0].clientId).toBe(c1.id);
    await importZd(admin.id, TICKETS, await ticketsBuffer([ticket({ organization_id: "9002" })]), { declared: { extraccion: "2026-02-01" } });
    const e = (await entries())[0];
    expect(e.clientId).toBe(c2.id);
    expect(await count("ZdTimeEntry")).toBe(1);
  });
});

describe("resumen verificable y listado con motivos (IMP 01, 07)", () => {
  it("la partición contable reconcilia filas y horas; las filas pueden filtrarse por motivo y llevan a su fila de origen", async () => {
    const group = await addGroup("G");
    await addClient({ name: "Cliente", orgId: "9001", groupId: group.id });
    await addPerson({ name: "Ana", zdId: "5001", pmo: [[null, null, true]] });
    await addPerson({ name: "Ivan", zdId: "5002", pmo: [[null, null, false]] });
    await importZd(admin.id, TICKETS, await ticketsBuffer([ticket()]));
    const dup = timeRow({ user_id: "5002", logged_hours: 1, logged_minutes: 0 });
    const b = await prepareZd(admin.id, TIEMPO, await T([
      dup,
      dup,
      timeRow({ user_id: "5002", ticket_id: "7777", hour: hourAt(10, 0), logged_hours: 0, logged_minutes: 30 }),
      timeRow({ user_id: "5001", date: day("2025-05-05"), hour: hourAt(10, 0), logged_hours: 2, logged_minutes: 0 }),
      timeRow({ user_id: null, user_name: null, hour: hourAt(11, 0), logged_hours: 0, logged_minutes: 15 }),
    ]));
    const pre = await timesSummary(admin.id, b.id);
    expect(pre?.source).toBe("previsualizacion");
    expect(pre?.reconciled).toBe(true);
    expect(pre?.validRows).toBe(5);
    expect(pre?.buckets.filter((x) => x.rows).map((x) => [x.bucket, x.rows, x.hours])).toEqual([
      ["DUPLICATE_FILE", 1, "1"],
      ["EXCLUDED_PMO", 1, "2"],
      ["NO_TICKET", 1, "0.5"],
      ["NO_PERSON", 1, "0.25"],
      ["ATTRIBUTABLE", 1, "1"],
    ]);
    await confirmUpload(admin.id, b.id);
    await drain();
    const post = await timesSummary(admin.id, b.id);
    expect(post?.source).toBe("registros");
    expect(post?.buckets.map((x) => [x.bucket, x.rows, x.minutes])).toEqual(pre?.buckets.map((x) => [x.bucket, x.rows, x.minutes]));
    expect(post?.reconciled).toBe(true);
    const filtered = await listBatchTimes(admin.id, b.id, { bucket: "NO_TICKET" });
    expect(filtered.total).toBe(1);
    expect(filtered.rows[0]).toMatchObject({ ticket_id: "7777", sourceRow: 4, hours: "0.5" });
    const byFlag = await listBatchTimes(admin.id, b.id, { flag: "NO_USER_ID" });
    expect(byFlag.rows.length).toBeGreaterThan(0);
    // No se cuenta nada como cero de un Cliente: lo no atribuible no entra en ATTRIBUTABLE.
    const clientHours = await prisma.$queryRaw<{ h: string }[]>`SELECT (sum(minutes)/60)::text AS h FROM "ZdTimeEntry" WHERE "drvBucket" = 'ATTRIBUTABLE'`;
    expect(Number(clientHours[0].h)).toBe(1);
  });
});

describe("instantánea de previsualización", () => {
  it("avisa cuando los maestros cambian después de preparar y Reprocesar la renueva; al activar se deriva con los datos actuales", async () => {
    const g = await addGroup("G");
    await addClient({ name: "Cliente", orgId: "9001", groupId: g.id });
    await importZd(admin.id, TICKETS, await ticketsBuffer([ticket()]));
    const b = await prepareZd(admin.id, TIEMPO, await T([timeRow()]));
    let s = await timesSummary(admin.id, b.id);
    expect(s?.preview?.stale).toBe(false);
    expect(s?.buckets.find((x) => x.bucket === "NO_PERSON")?.rows).toBe(1);
    await addPerson({ name: "Ana", zdId: "5001", pmo: [[null, null, false]] });
    s = await timesSummary(admin.id, b.id);
    expect(s?.preview?.stale).toBe(true);
    expect(s?.buckets.find((x) => x.bucket === "NO_PERSON")?.rows).toBe(1);
    await reprocessUpload(admin.id, b.id);
    await drain();
    s = await timesSummary(admin.id, b.id);
    expect(s?.preview?.stale).toBe(false);
    expect(s?.buckets.find((x) => x.bucket === "ATTRIBUTABLE")?.rows).toBe(1);
    // Con la instantánea obsoleta, activar deriva igualmente con los datos actuales.
    await addPerson({ name: "Otra", zdId: "5002" });
    const c = await prepareZd(admin.id, TIEMPO, await T([timeRow({ user_id: "5002", user_name: "Otra", hour: hourAt(10, 0) })]));
    await addPersonAlias((await prisma.person.findFirstOrThrow({ where: { name: "Otra" } })).id, "NAME", "otra x");
    await prisma.personTerm.create({ data: { personId: (await prisma.person.findFirstOrThrow({ where: { name: "Otra" } })).id, attribute: "PMO_MEMBER", flag: false } });
    expect((await timesSummary(admin.id, c.id))?.preview?.stale).toBe(true);
    await confirmUpload(admin.id, c.id);
    await drain();
    expect((await prisma.zdTimeEntry.findFirstOrThrow({ where: { userId: "5002" } })).drvBucket).toBe("ATTRIBUTABLE");
  });

  it("una decisión de corrección actualiza la instantánea de esa fila sin recalcular todo el lote", async () => {
    await importZd(admin.id, TIEMPO, await T([timeRow({ id: "88", logged_hours: 1, logged_minutes: 0 })]));
    const b = await prepareZd(admin.id, TIEMPO, await T([timeRow({ id: "88", logged_hours: 2, logged_minutes: 0 }), timeRow({ id: "90", ticket_id: "3", logged_hours: 4, logged_minutes: 0 })]));
    expect(await prisma.zdTimePreview.count({ where: { batchId: b.id } })).toBe(1);
    const [cand] = await listCorrectionCandidates(admin.id, b.id);
    await decideTimeCorrection(admin.id, b.id, { fingerprint: cand.fingerprint, decision: "DIFFERENT" });
    expect(await prisma.zdTimePreview.count({ where: { batchId: b.id } })).toBe(2);
    await decideTimeCorrection(admin.id, b.id, { fingerprint: cand.fingerprint, decision: "CLEAR" });
    expect(await prisma.zdTimePreview.count({ where: { batchId: b.id } })).toBe(1);
  });
});

describe("fallos y concurrencia (IMP 06)", () => {
  it("doble confirmación y dos trabajadores a la vez no duplican ni dejan activación parcial", async () => {
    const rows = Array.from({ length: 300 }, (_, i) => timeRow({ ticket_id: String(2000 + (i % 7)), hour: hourAt(Math.floor(i / 60), i % 60), logged_minutes: (i % 59) + 1 }));
    const b = await prepareZd(admin.id, TIEMPO, await T(rows));
    const results = await Promise.allSettled([confirmUpload(admin.id, b.id), confirmUpload(admin.id, b.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await Promise.all([runOnce("w1"), runOnce("w2")]);
    await drain();
    const done = await batch(b.id);
    expect(done.status).toBe("COMPLETED");
    expect(await count("ZdTimeEntry")).toBe(300);
    expect(done.rowsImported).toBe(300);
    expect(await count("AuditEvent", `"batchId" = '${b.id}' AND action = 'ACTIVATE'`)).toBe(1);
    expect(await count("UploadJob", `"batchId" = '${b.id}' AND kind = 'ACTIVATE' AND status = 'DONE'`)).toBe(1);
  });

  it("un fallo en la activación deshace todo: sin entradas parciales y el lote reintenta", async () => {
    const b = await prepareZd(admin.id, TIEMPO, await T([timeRow(), timeRow({ ticket_id: "2", hour: hourAt(9, 0) })]));
    // Provoca el fallo con una restricción: un registro previo con la misma huella de origen pero de otro lote.
    const fp = (await prisma.uploadStagedRow.findFirstOrThrow({ where: { batchId: b.id }, orderBy: { position: "desc" } })).fingerprint!;
    const other = await prepareZd(admin.id, TIEMPO, await T([timeRow({ ticket_id: "99" })]));
    await prisma.$executeRawUnsafe(`ALTER TABLE "ZdTimeEntry" ADD CONSTRAINT "tmp_fail" CHECK ("ticketId" <> '2')`);
    try {
      await confirmUpload(admin.id, b.id);
      await runOnce("w1");
      expect(await count("ZdTimeEntry")).toBe(0);
      const mid = await batch(b.id);
      expect(["ACTIVATING", "ACTIVATION_QUEUED"]).toContain(mid.status);
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "ZdTimeEntry" DROP CONSTRAINT "tmp_fail"`);
    }
    void fp; void other;
    await prisma.uploadJob.updateMany({ where: { batchId: b.id, kind: "ACTIVATE" }, data: { runAfter: new Date(0) } });
    await drain();
    expect((await batch(b.id)).status).toBe("COMPLETED");
    expect(await count("ZdTimeEntry", `"firstBatchId" = '${b.id}'`)).toBe(2);
  });
});

