import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { confirmUpload, getUpload } from "@/server/uploads/batches";
import { batch, drain, freshEnvironment, removeUploadDir, useUploadDir } from "./cargas-helpers";
import { excelSerial, ticket, ticketsBuffer, type TicketRow } from "./generators/zendesk";
import { addClient, addGroup, addHosting, count, importZd, prepareZd, ticketCurrent, TICKETS } from "./zendesk-helpers";
import { revertUpload } from "@/server/uploads/batches";
import { ticketsSummary, listBatchTickets } from "@/server/zendesk/summary";

let dir: string;
let admin: { id: string };
beforeAll(() => { dir = useUploadDir(); });
afterAll(() => removeUploadDir(dir));
beforeEach(async () => { ({ admin } = await freshEnvironment()); });

const day = (iso: string) => ({ date: excelSerial(iso) });
const buf = (rows: TicketRow[], o = {}) => ticketsBuffer(rows, o);

async function issueCodes(batchId: string): Promise<string[]> {
  const b = await batch(batchId);
  return ((b.summary as { issues?: { code: string }[] } | null)?.issues ?? []).map((i) => i.code);
}

describe("esquema y validación del libro (ZDT 01)", () => {
  it("un perfil antiguo sin status se rechaza y conserva los activos", async () => {
    await importZd(admin.id, TICKETS, await buf([ticket()]));
    const before = await count("ZdTicket");
    const old = await buf([ticket()], { headers: ["ticket_id", "organization_id", "Entorno y Tipología", "CausaRaiz(Agr)", "tags", "fecha_creación", "type", "estado"] });
    const b = await prepareZd(admin.id, TICKETS, old);
    expect(b.status).toBe("REJECTED");
    expect(b.statusDetail).toMatch(/status/);
    expect(await count("ZdTicket")).toBe(before);
  });

  it("falta cualquier otra cabecera obligatoria: rechazo con motivo, sin filas en staging", async () => {
    const b = await prepareZd(admin.id, TICKETS, await buf([ticket()], { headers: ["ticket_id", "organization_id", "Entorno y Tipología", "CausaRaiz(Agr)", "tags", "fecha_creación", "type", "status_x"] }));
    expect(b.status).toBe("REJECTED");
    expect(await count("UploadStagedRow", `"batchId" = '${b.id}'`)).toBe(0);
  });

  it("orden de columnas variable, columnas extra informadas, ID exacto y fechas 1900/1904 sin desplazar", async () => {
    const rows = [
      ticket({ ticket_id: "12345678901234", organization_id: "98765432109876", creada: day("2024-02-29") }),
      ticket({ ticket_id: "2002", creada: "05/03/2024" }),
      ticket({ ticket_id: "2003", creada: "2024-03-07" }),
    ];
    for (const date1904 of [false, true]) {
      ({ admin } = await freshEnvironment());
      const order = [7, 6, 5, 4, 3, 2, 1, 0];
      const rows2 = date1904
        ? [ticket({ ticket_id: "12345678901234", organization_id: "98765432109876", creada: { date: excelSerial("2024-02-29", true) } }), rows[1], rows[2]]
        : rows;
      await importZd(admin.id, TICKETS, await buf(rows2, { order, extraColumn: true, date1904 }));
      const r = await prisma.$queryRaw<{ ticketId: string; org: string; on: string }[]>`
        SELECT t."ticketId", r."organizationId" AS org, to_char(r."createdOn",'YYYY-MM-DD') AS "on"
        FROM "ZdTicket" t JOIN "ZdTicketRevision" r ON r.id = t."currentRevisionId" ORDER BY t."ticketId"`;
      expect(r.map((x) => [x.ticketId, x.org, x.on])).toEqual([
        ["12345678901234", "98765432109876", "2024-02-29"],
        ["2002", "9001", "2024-03-05"],
        ["2003", "9001", "2024-03-07"],
      ]);
      const b = await prisma.uploadBatch.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
      expect((b.summary as { notes?: string[] }).notes?.[0]).toMatch(/columna_extra/);
    }
  });

  it("cabeceras duplicadas o ambiguas se rechazan", async () => {
    const b = await prepareZd(admin.id, TICKETS, await buf([ticket()], { headers: ["ticket_id", "ticket_id", "Entorno y Tipología", "CausaRaiz(Agr)", "tags", "fecha_creación", "type", "status"] }));
    expect(b.status).toBe("REJECTED");
    expect(b.statusDetail).toMatch(/duplicadas|ambiguas|faltan/);
  });

  it("varias hojas compatibles exigen selección explícita; con una sola compatible se lee solo esa", async () => {
    const header = ["ticket_id", "organization_id", "Entorno y Tipología", "CausaRaiz(Agr)", "tags", "fecha_creación", "type", "status"];
    const body = [["1", "1", "e", "c", "[]", "2024-01-01", "incident", "open"]];
    const two = await buf([ticket()], { extraSheets: [{ name: "Copia", rows: [header, ...body] }] });
    const rej = await prepareZd(admin.id, TICKETS, two);
    expect(rej.status).toBe("REJECTED");
    expect(rej.statusDetail).toMatch(/varias hojas compatibles/);
    expect(await count("UploadStagedRow", `"batchId" = '${rej.id}'`)).toBe(0);
    const chosen = await prepareZd(admin.id, TICKETS, two, { metadata: { hoja: "Copia" } });
    expect(chosen.status).toBe("READY");
    expect(chosen.rowsReceived).toBe(1);
    const mixed = await buf([ticket()], { extraSheets: [{ name: "Resumen", rows: [["a", "b"], ["1", "2"]] }] });
    const ok = await prepareZd(admin.id, TICKETS, mixed);
    expect(ok.status).toBe("READY");
    expect(ok.rowsReceived).toBe(1);
  });

  it("filas ilegibles se informan con fila y campo y bloquean la confirmación; los datos válidos no se activan por la fuerza", async () => {
    const b = await prepareZd(admin.id, TICKETS, await buf([
      ticket({ ticket_id: "1" }),
      ticket({ ticket_id: "x1" }),
      ticket({ ticket_id: "3", creada: "no-es-fecha" }),
      ticket({ ticket_id: "4", tags: "a,b" }),
      ticket({ ticket_id: "5", status: "" }),
    ]));
    expect(b.status).toBe("READY");
    expect(b.rowsError).toBe(4);
    expect(await issueCodes(b.id)).toEqual(expect.arrayContaining(["TICKET_ID_ILEGIBLE", "FECHA_INVALIDA", "TAGS_INVALIDOS", "STATUS_VACIO"]));
    const detail = await getUpload(admin.id, b.id);
    expect(detail?.actions.confirm.allowed).toBe(false);
    await expect(confirmUpload(admin.id, b.id)).rejects.toThrow(/errores obligatorios/);
    expect(await count("ZdTicket")).toBe(0);
    const rows = await prisma.uploadStagedRow.findMany({ where: { batchId: b.id, classification: "ERROR" }, orderBy: { position: "asc" } });
    expect((rows[0].issues as { column: string }[])[0].column).toBe("ticket_id");
    expect(rows[0].sourceRow).toBe(3);
  });

  it("organización vacía y entorno o causa vacíos son válidos y se conservan sin informar; JSON malformado no se sustituye por []", async () => {
    const b = await importZd(admin.id, TICKETS, await buf([ticket({ ticket_id: "7", organization_id: null, entorno: null, causa: null, tags: "[]" })]));
    expect(b.rowsError).toBe(0);
    const cur = await prisma.zdTicketRevision.findFirstOrThrow({ where: { ticketId: "7" } });
    expect(cur.organizationId).toBeNull();
    expect(cur.entorno).toBeNull();
    expect(cur.causaRaiz).toBeNull();
    expect(cur.tags).toEqual([]);
    const bad = await prepareZd(admin.id, TICKETS, await buf([ticket({ ticket_id: "8", tags: '["a"' })]));
    expect(bad.rowsError).toBe(1);
  });

  it("type/status desconocidos se informan como no clasificados sin convertirse en otro valor", async () => {
    const b = await importZd(admin.id, TICKETS, await buf([ticket({ ticket_id: "9", type: "epic", status: "archived" })]));
    expect(await issueCodes(b.id)).toEqual(expect.arrayContaining(["TYPE_NO_CLASIFICADO", "STATUS_NO_CLASIFICADO"]));
    const r = await prisma.zdTicketRevision.findFirstOrThrow({ where: { ticketId: "9" } });
    expect([r.ticketType, r.status, r.typeKnown, r.statusKnown]).toEqual(["epic", "archived", false, false]);
  });
});

describe("tickets sin horas, revisiones y observaciones (ZDT 02, 04)", () => {
  it("un ticket sin tiempos persiste (no necesita join con tiempos)", async () => {
    await importZd(admin.id, TICKETS, await buf([ticket({ ticket_id: "55" })]));
    expect(await count("ZdTicket", `"ticketId" = '55'`)).toBe(1);
    expect(await count("ZdTimeEntry")).toBe(0);
  });

  it("el mismo ticket_id pasa de open a solved sin crear otro ticket ni inventar solved_at", async () => {
    await importZd(admin.id, TICKETS, await buf([ticket({ status: "open" })]), { declared: { extraccion: "2026-01-10" } });
    await importZd(admin.id, TICKETS, await buf([ticket({ status: "solved" })]), { declared: { extraccion: "2026-02-10" } });
    expect(await count("ZdTicket")).toBe(1);
    expect(await count("ZdTicketRevision")).toBe(2);
    const cur = await ticketCurrent("1001");
    expect(cur).toMatchObject({ status: "solved", rev: 2, observations: 2, observedOn: "2026-02-10" });
    const rev2 = await prisma.zdTicketRevision.findFirstOrThrow({ where: { ticketId: "1001", revisionNo: 2 } });
    expect(rev2.changedFields).toEqual(["status"]);
    const cols = await prisma.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name IN ('ZdTicket','ZdTicketRevision','ZdTicketObservation')`;
    expect(cols.some((c) => /solved|resol|closed_at/i.test(c.column_name))).toBe(false);
  });

  it("una nueva extracción sin cambios registra presencia sin duplicar ticket ni revisión", async () => {
    await importZd(admin.id, TICKETS, await buf([ticket(), ticket({ ticket_id: "1002" })]), { declared: { extraccion: "2026-01-10" } });
    const second = await importZd(admin.id, TICKETS, await buf([ticket(), ticket({ ticket_id: "1002" })]), { declared: { extraccion: "2026-03-10" } });
    expect(await count("ZdTicket")).toBe(2);
    expect(await count("ZdTicketRevision")).toBe(2);
    expect(await count("ZdTicketObservation")).toBe(4);
    expect(second.rowsImported).toBe(0);
    const cur = await ticketCurrent("1001");
    expect(cur?.observedOn).toBe("2026-03-10");
    const sum = await ticketsSummary(admin.id, second.id);
    expect(sum).toMatchObject({ newTickets: 0, revised: 0, unchanged: 2, observations: 2 });
  });

  it("repetir el mismo archivo no duplica entidades ni revisiones", async () => {
    const file = await buf([ticket(), ticket({ ticket_id: "1002", status: "closed" })]);
    await importZd(admin.id, TICKETS, file);
    await importZd(admin.id, TICKETS, file);
    expect([await count("ZdTicket"), await count("ZdTicketRevision")]).toEqual([2, 2]);
  });

  it("un export viejo no pisa el estado reciente; reprocesar conserva la observación original", async () => {
    await importZd(admin.id, TICKETS, await buf([ticket({ status: "solved" })]), { declared: { extraccion: "2026-06-01" } });
    const old = await prepareZd(admin.id, TICKETS, await buf([ticket({ status: "open" })]), { declared: { extraccion: "2026-01-01" } });
    const sum = await ticketsSummary(admin.id, old.id);
    expect(sum?.olderThanCurrent).toBe(1);
    await confirmUpload(admin.id, old.id);
    await drain();
    expect((await ticketCurrent("1001"))?.status).toBe("solved");
    expect(await count("ZdTicketRevision")).toBe(2);
    const obs = await prisma.zdTicketObservation.findMany({ where: { batchId: old.id } });
    expect(obs[0].observedOn.toISOString().slice(0, 10)).toBe("2026-01-01");
    // Reprocesar el lote viejo (recalcula lo derivado) no revierte el estado de uno nuevo ni cambia su observación.
    const { reprocessUpload } = await import("@/server/uploads/batches");
    await reprocessUpload(admin.id, old.id);
    await drain();
    expect((await ticketCurrent("1001"))?.status).toBe("solved");
    const obs2 = await prisma.zdTicketObservation.findMany({ where: { batchId: old.id } });
    expect(obs2[0].observedOn.toISOString()).toBe(obs[0].observedOn.toISOString());
    expect(obs2[0].id).toBe(obs[0].id);
  });

  it("sin extracción declarada se registra observación recibida y se advierte frescura desconocida", async () => {
    const b = await importZd(admin.id, TICKETS, await buf([ticket()]));
    const obs = await prisma.zdTicketObservation.findFirstOrThrow({ where: { batchId: b.id } });
    expect(obs.observedKind).toBe("RECEIVED");
    const sum = await ticketsSummary(admin.id, b.id);
    expect(sum?.freshnessKnown).toBe(false);
    const declared = await importZd(admin.id, TICKETS, await buf([ticket({ ticket_id: "2" })]), { declared: { extraccion: "2026-05-05" } });
    expect((await prisma.zdTicketObservation.findFirstOrThrow({ where: { batchId: declared.id } })).observedKind).toBe("DECLARED");
  });

  it("la ausencia en otro export no elimina ni cierra un ticket", async () => {
    await importZd(admin.id, TICKETS, await buf([ticket({ ticket_id: "1" }), ticket({ ticket_id: "2" })]), { declared: { extraccion: "2026-01-01" } });
    await importZd(admin.id, TICKETS, await buf([ticket({ ticket_id: "1" })]), { declared: { extraccion: "2026-02-01" } });
    expect(await count("ZdTicket")).toBe(2);
    expect((await ticketCurrent("2"))?.status).toBe("open");
  });

  it("dos filas contradictorias del mismo ticket en un archivo no activan ninguna elección arbitraria", async () => {
    const b = await prepareZd(admin.id, TICKETS, await buf([ticket({ status: "open" }), ticket({ status: "solved" }), ticket({ ticket_id: "2" })]));
    expect(b.rowsError).toBe(2);
    expect(await issueCodes(b.id)).toContain("CONFLICTO_EN_ARCHIVO");
    await expect(confirmUpload(admin.id, b.id)).rejects.toThrow();
    expect(await count("ZdTicket")).toBe(0);
  });

  it("filas idénticas se deduplican; solo cambiar el orden o repetir un tag no crea revisión", async () => {
    await importZd(admin.id, TICKETS, await buf([ticket({ tags: '["team_n3_pmo","team_it"]' })]));
    const b = await importZd(admin.id, TICKETS, await buf([ticket({ tags: '["team_it","team_n3_pmo","team_it"]' }), ticket({ tags: '["team_n3_pmo","team_it"]' })]));
    expect(await count("ZdTicketRevision")).toBe(1);
    expect(b.rowsDuplicate).toBeGreaterThanOrEqual(1);
    await importZd(admin.id, TICKETS, await buf([ticket({ tags: '["team_it"]' })]));
    expect(await count("ZdTicketRevision")).toBe(2);
    expect((await prisma.zdTicketRevision.findFirstOrThrow({ where: { revisionNo: 2 } })).changedFields).toEqual(["tags"]);
  });
});

describe("tags, causas y clasificación (ZDT 07-08)", () => {
  it("destinos por tag exacto: PMO e IT cuentan una vez en N3 y aparecen en ambos; una subcadena parecida no cuenta", async () => {
    const b = await importZd(admin.id, TICKETS, await buf([
      ticket({ ticket_id: "1", tags: '["team_n3_pmo","team_it"]' }),
      ticket({ ticket_id: "2", tags: '["team_n3_pmo"]' }),
      ticket({ ticket_id: "3", tags: '["team_n3_pmo_extra","xteam_it","bug"]' }),
      ticket({ ticket_id: "4", tags: '["team_plataforma"]' }),
      ticket({ ticket_id: "5", tags: '["team_plataformavfs","team_plataformavsw","team_plataformaarq","team_n2"]' }),
    ]));
    const s = await ticketsSummary(admin.id, b.id);
    expect(s?.tagsDestinations).toMatchObject({ PMO_N3: 2, IT_N3: 1, N3_UNION: 2, VFS_N4: 2, VSW_N4: 1, ARQ_VFS_N4: 1, CS_N2: 1 });
    const r = await prisma.zdTicketRevision.findFirstOrThrow({ where: { ticketId: "3" } });
    expect(r.destinations).toEqual([]);
    expect(r.tags).toEqual(["bug", "team_n3_pmo_extra", "xteam_it"]);
  });

  it("Sistemas del Cliente y Uso Indebido se conservan; entorno y causa quedan separados del tipo; Admin delegada por cadena", async () => {
    await importZd(admin.id, TICKETS, await buf([
      ticket({ ticket_id: "1", causa: "Sistemas del Cliente", entorno: "Producción · Admin Delegada" }),
      ticket({ ticket_id: "2", causa: "Uso Indebido", entorno: "Pruebas" }),
      ticket({ ticket_id: "3", causa: null, entorno: null }),
    ]));
    const rows = await prisma.zdTicketRevision.findMany({ orderBy: { ticketId: "asc" } });
    expect(rows.map((r) => [r.causaRaiz, r.entorno, r.ticketType, r.adminDelegada])).toEqual([
      ["Sistemas del Cliente", "Producción · Admin Delegada", "incident", true],
      ["Uso Indebido", "Pruebas", "incident", false],
      [null, null, "incident", null],
    ]);
  });

  it("incidente_infraestructura depende del alojamiento a la fecha: OP no cuenta, CLOUD sí y el histórico desconocido queda pendiente", async () => {
    const op = await addClient({ name: "Cliente OP", orgId: "9101" });
    const cloud = await addClient({ name: "Cliente CLOUD", orgId: "9102" });
    const migrated = await addClient({ name: "Cliente migrado", orgId: "9103" });
    const unknown = await addClient({ name: "Cliente sin dato", orgId: "9104" });
    await addHosting(op.id, "OP", null, null);
    await addHosting(cloud.id, "CLOUD", null, null);
    await addHosting(migrated.id, "OP", null, "2026-06-01");
    await addHosting(migrated.id, "CLOUD", "2026-06-01", null);
    void unknown;
    const infra = "incidente_infraestructura";
    const b = await importZd(admin.id, TICKETS, await buf([
      ticket({ ticket_id: "1", organization_id: "9101", causa: infra }),
      ticket({ ticket_id: "2", organization_id: "9102", causa: infra }),
      ticket({ ticket_id: "3", organization_id: "9103", causa: infra, creada: day("2026-03-01") }),
      ticket({ ticket_id: "4", organization_id: "9103", causa: infra, creada: day("2026-07-01") }),
      ticket({ ticket_id: "5", organization_id: "9104", causa: infra }),
      ticket({ ticket_id: "6", organization_id: "9101", causa: "incidente_estándar_plataforma" }),
    ]));
    const list = await listBatchTickets(admin.id, b.id, { pageSize: 50 });
    const byId = Object.fromEntries(list.rows.map((r) => [r.ticket_id, r.incident_class]));
    expect(byId).toEqual({ "1": "NO_INCIDENTE_VINCLE", "2": "INCIDENTE_VINCLE", "3": "NO_INCIDENTE_VINCLE", "4": "INCIDENTE_VINCLE", "5": "PENDIENTE", "6": "INCIDENTE_VINCLE" });
    const incomplete = await listBatchTickets(admin.id, b.id, { filter: "incomplete", pageSize: 50 });
    expect(incomplete.rows.map((r) => r.ticket_id)).toEqual(["5"]);
  });
});

describe("organizaciones, Cliente y Grupo (ZDT 05-06)", () => {
  it("resuelve por equivalencia; no crea clientes; Cliente sin grupo sigue identificado; internos aparte", async () => {
    const group = await addGroup("Grupo BC A");
    await addClient({ name: "Cliente A1", orgId: "100", groupId: group.id });
    await addClient({ name: "Cliente A2", orgId: "101", groupId: group.id });
    await addClient({ name: "Cliente sin grupo", orgId: "102" });
    await addClient({ name: "VINCLE BUGS", orgId: "103", internal: true });
    const clientsBefore = await count("Client");
    const b = await importZd(admin.id, TICKETS, await buf([
      ticket({ ticket_id: "1", organization_id: "100" }),
      ticket({ ticket_id: "2", organization_id: "101" }),
      ticket({ ticket_id: "3", organization_id: "102" }),
      ticket({ ticket_id: "4", organization_id: "103" }),
      ticket({ ticket_id: "5", organization_id: "999" }),
      ticket({ ticket_id: "6", organization_id: null }),
    ]));
    expect(await count("Client")).toBe(clientsBefore);
    const s = await ticketsSummary(admin.id, b.id);
    expect(s).toMatchObject({ orgNone: 1, orgNoClient: 1, clientNoGroup: 1, internal: 1, external: 3, unresolvedClient: 2, distinctTickets: 6 });
    const noGroup = await listBatchTickets(admin.id, b.id, { filter: "client_no_group" });
    expect(noGroup.rows.map((r) => [r.ticket_id, r.client_name, r.group_name])).toEqual([["3", "Cliente sin grupo", null]]);
    const internal = await listBatchTickets(admin.id, b.id, { filter: "internal" });
    expect(internal.rows.map((r) => r.client_name)).toEqual(["VINCLE BUGS"]);
    // Organizaciones que comparten grupo no se mezclan.
    const a1 = await listBatchTickets(admin.id, b.id, { pageSize: 50 });
    expect(new Set(a1.rows.filter((r) => r.group_name).map((r) => r.client_name))).toEqual(new Set(["Cliente A1", "Cliente A2"]));
  });
});

describe("reversión y reproceso", () => {
  it("revertir respeta observaciones de otros lotes y no restaura una revisión antigua sobre una posterior vigente", async () => {
    const a = await importZd(admin.id, TICKETS, await buf([ticket({ status: "open" })]), { declared: { extraccion: "2026-01-01" } });
    const b = await importZd(admin.id, TICKETS, await buf([ticket({ status: "solved" })]), { declared: { extraccion: "2026-02-01" } });
    // Revertir el lote antiguo: el estado vigente sigue siendo el posterior.
    await revertUpload(admin.id, a.id);
    await drain();
    expect((await batch(a.id)).status).toBe("REVERTED");
    expect((await ticketCurrent("1001"))?.status).toBe("solved");
    expect(await count("ZdTicketObservation")).toBe(1);
    // Revertir el posterior: el ticket queda sin sustento y desaparece; nada ajeno se borra.
    await revertUpload(admin.id, b.id);
    await drain();
    expect(await count("ZdTicket")).toBe(0);
    expect(await count("ZdTicketRevision")).toBe(0);
  });

  it("revertir el lote reciente devuelve la vigencia a la observación anterior que aún se sustenta", async () => {
    await importZd(admin.id, TICKETS, await buf([ticket({ status: "open" })]), { declared: { extraccion: "2026-01-01" } });
    const b = await importZd(admin.id, TICKETS, await buf([ticket({ status: "solved" })]), { declared: { extraccion: "2026-02-01" } });
    await revertUpload(admin.id, b.id);
    await drain();
    expect((await ticketCurrent("1001"))).toMatchObject({ status: "open", revisions: 1, observations: 1 });
  });

  it("un lote que comparte contenido con otro no retira su revisión al revertirse", async () => {
    const a = await importZd(admin.id, TICKETS, await buf([ticket()]), { declared: { extraccion: "2026-01-01" } });
    await importZd(admin.id, TICKETS, await buf([ticket()]), { declared: { extraccion: "2026-02-01" } });
    await revertUpload(admin.id, a.id);
    await drain();
    expect(await count("ZdTicketRevision")).toBe(1);
    expect(await count("ZdTicket")).toBe(1);
  });

  it("el recorrido de listado paginado de tickets del lote lleva a su fila de origen", async () => {
    const rows = Array.from({ length: 45 }, (_, i) => ticket({ ticket_id: String(5000 + i) }));
    const b = await importZd(admin.id, TICKETS, await buf(rows));
    const p2 = await listBatchTickets(admin.id, b.id, { page: 2, pageSize: 20 });
    expect(p2.total).toBe(45);
    expect(p2.rows).toHaveLength(20);
    expect(p2.rows[0].sourceRow).toBe(22);
  });
});

