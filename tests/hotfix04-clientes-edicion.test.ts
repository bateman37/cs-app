import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { AccessError } from "@/lib/access";
import { detectSheet } from "@/domain/precarga-maestros";
import { editorHref, translateLegacyParams } from "@/domain/clientes-rutas";
import { changeKey, type EditChange } from "@/domain/master-edit";
import { loadMasterTable, type MasterRow } from "@/server/master-table";
import { applyMasterEdit, previewMasterEdit } from "@/server/master-edit";
import { readRefreshStatus } from "@/server/relations/refresh";
import { drain, freshEnvironment, removeUploadDir, useUploadDir } from "./cargas-helpers";
import { loadOperationalFirst, wrikeOut, zdOut, papOut, ZD_TOTAL_MINUTES, WRIKE_TOTAL_MINUTES } from "./hotfix02-helpers";

/**
 * HOTFIX-04 §4–5, §7 y §10 (casos 2–5 y 10): edición real en la tabla de Clientes con revisión previa, cancelación, atomicidad, idempotencia y reenlace automático.
 * Datos sintéticos (nada procede de los maestros reales).
 */
let dir: string;
let admin: { id: string };
let reader: { id: string };
beforeAll(() => { dir = useUploadDir(); });
afterAll(() => removeUploadDir(dir));
beforeEach(async () => { ({ admin, reader } = await freshEnvironment()); });

const op = () => randomUUID();
const save = (changes: EditChange[], operationId = op()) => applyMasterEdit(admin.id, { operationId, changes });
const preview = (changes: EditChange[]) => previewMasterEdit(admin.id, { operationId: op(), changes });
const rows = async (extra: Parameters<typeof loadMasterTable>[1] = { estado: "todos" }) => (await loadMasterTable(admin.id, extra)).rows;
const rowOf = async (name: string) => (await rows()).find((r) => r.name === name) as MasterRow;
const audits = () => prisma.auditEvent.count();

async function world() {
  const g = await prisma.clientGroup.create({ data: { name: "Alfa", bcDenomination: "Alfa" } });
  const c = await prisma.client.create({ data: { name: "Alfa Uno", groupId: g.id } });
  await prisma.externalIdentity.create({ data: { system: "BC", kind: "GROUP_KEY", rawValue: "Alfa", searchValue: "alfa", groupId: g.id } });
  await prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: "710001", searchValue: "710001", clientId: c.id } });
  await prisma.externalIdentity.create({ data: { system: "WRIKE", kind: "PROJECT_NAME", rawValue: "W-ALFA", searchValue: "w-alfa", groupId: g.id } });
  await prisma.externalIdentity.create({ data: { system: "PAP", kind: "PROJECT_NAME", rawValue: "P-ALFA", searchValue: "p-alfa", groupId: g.id } });
  await prisma.serviceTerm.create({ data: { attribute: "SUPPORT", value: "GOLD", clientId: c.id } });
  await prisma.serviceTerm.create({ data: { attribute: "HOSTING", value: "OP", clientId: c.id } });
  await prisma.serviceTerm.create({ data: { attribute: "COMPLEXITY", value: "BASIC", clientId: c.id } });
  const other = await prisma.clientGroup.create({ data: { name: "Beta" } });
  const oc = await prisma.client.create({ data: { name: "Beta Uno", groupId: other.id } });
  await prisma.externalIdentity.create({ data: { system: "WRIKE", kind: "PROJECT_NAME", rawValue: "W-BETA", searchValue: "w-beta", groupId: other.id } });
  return { g, c, other, oc };
}

/** Los ocho campos del Excel + estado, como el cliente los envía. */
const allFields = (g: { id: string }, c: { id: string }): EditChange[] => [
  { op: "name", entity: "group", id: g.id, before: "Alfa", after: "Alfa Global" },
  { op: "aliases", scope: "group", id: g.id, system: "WRIKE", before: ["W-ALFA"], after: ["W-ALFA CS"] },
  { op: "aliases", scope: "client", id: c.id, system: "ZENDESK_ID", before: ["710001"], after: ["360534144557"] },
  { op: "name", entity: "client", id: c.id, before: "Alfa Uno", after: "AB PARFUMS" },
  { op: "term", scope: "client", id: c.id, attribute: "SUPPORT", before: "GOLD", after: "PLATINUM" },
  { op: "term", scope: "client", id: c.id, attribute: "HOSTING", before: "OP", after: "CLOUD" },
  { op: "aliases", scope: "group", id: g.id, system: "PAP", before: ["P-ALFA"], after: ["ANGELINI - VSW SALES", "P-ALFA"] },
  { op: "term", scope: "client", id: c.id, attribute: "COMPLEXITY", before: "BASIC", after: "MEDIUM" },
  { op: "active", entity: "client", id: c.id, before: true, after: false },
];

describe("editar cada campo de la tabla (ocho columnas + estado) con revisión previa", () => {
  it("la vista previa muestra antes→después y NO escribe: otra lectura sigue viendo los valores anteriores y no hay auditoría", async () => {
    const { g, c } = await world();
    const a0 = await audits();
    const p = await preview(allFields(g, c));
    expect(p.ok).toBe(true);
    expect(p.items.map((i) => i.field)).toEqual(expect.arrayContaining(["Grupo Cliente (nombre)", "Wrike", "ID de organización Zendesk", "Zendesk (nombre del Cliente)", "Nivel de Servicio", "Servidor", "PAP", "Tipo (complejidad)", "Estado"]));
    expect(p.items.find((i) => i.field === "Nivel de Servicio")).toMatchObject({ before: "Gold", after: "Platinum" });
    expect(p.items.find((i) => i.field === "ID de organización Zendesk")).toMatchObject({ before: "710001", after: "360534144557" });
    // Una segunda lectura (otra «sesión») sigue viendo lo anterior: nada se escribió.
    const r = await rowOf("Alfa Uno");
    expect(r.own).toMatchObject({ zdIds: ["710001"], support: "GOLD", hosting: "OP", complexity: "BASIC" });
    expect(r.groupName).toBe("Alfa");
    expect(await audits()).toBe(a0);
    expect(await prisma.externalIdentity.count({ where: { rawValue: "360534144557" } })).toBe(0);
  });

  it("confirmar guarda TODO una vez, con auditoría antes/después y de forma persistente; un doble envío o reintento no duplica nada", async () => {
    const { g, c } = await world();
    const id = op();
    const a0 = await audits();
    const first = await save(allFields(g, c), id);
    expect(first.ok).toBe(true);
    const a1 = await audits();
    expect(a1).toBeGreaterThan(a0);
    const again = await save(allFields(g, c), id); // reintento con la misma operación
    expect(again).toMatchObject({ ok: true, alreadyApplied: true });
    expect(await audits()).toBe(a1);
    // Valores persistidos (lectura nueva)
    const r = await rowOf("AB PARFUMS");
    expect(r).toMatchObject({ groupName: "Alfa Global", isActive: false });
    expect(r.own).toMatchObject({ zdIds: ["360534144557"], support: "PLATINUM", hosting: "CLOUD", complexity: "MEDIUM" });
    const grp = (await rows()).find((x) => x.kind === "group" && x.id === g.id) as MasterRow;
    expect(grp.own.wrike).toEqual(["W-ALFA CS"]);
    expect([...grp.own.pap].sort()).toEqual(["ANGELINI - VSW SALES", "P-ALFA"]);
    // El ID Zendesk es texto exacto, sin conversión numérica.
    expect((await prisma.externalIdentity.findFirstOrThrow({ where: { clientId: c.id, system: "ZENDESK", isActive: true, validTo: null } })).rawValue).toBe("360534144557");
    // Auditoría con actor humano y antes/después.
    const ev = await prisma.auditEvent.findMany({ where: { entityType: "ServiceTerm", actorId: admin.id } });
    expect(ev.some((e) => JSON.stringify(e.before).includes("GOLD") && JSON.stringify(e.after).includes("PLATINUM"))).toBe(true);
    expect(await prisma.auditEvent.count({ where: { entityType: "EditOperation", entityId: id } })).toBe(1);
  });

  it("las claves anteriores no se borran: se cierra su vigencia y se conserva el historial; el nombre BC anterior sigue siendo clave del Grupo", async () => {
    const { g } = await world();
    await save(allFields(g, (await prisma.client.findFirstOrThrow({ where: { groupId: g.id } }))));
    const old = await prisma.externalIdentity.findFirstOrThrow({ where: { groupId: g.id, system: "WRIKE", rawValue: "W-ALFA" } });
    expect(old.isActive).toBe(true);
    expect(old.validTo).not.toBeNull(); // cerrada, no borrada
    expect(await prisma.externalIdentity.count({ where: { system: "BC", kind: "GROUP_KEY", groupId: g.id, isActive: true } })).toBe(2); // «Alfa» (anterior) y «Alfa Global»
    expect((await prisma.clientGroup.findUniqueOrThrow({ where: { id: g.id } })).bcDenomination).toBe("Alfa Global");
  });

  it("campos vacíos: un Cliente sin datos de servicio se completa; una lista vacía retira solo lo que había; Soporte sin valor válido se rechaza junto al campo", async () => {
    const g = await prisma.clientGroup.create({ data: { name: "Vacío" } });
    const c = await prisma.client.create({ data: { name: "Vacío Uno", groupId: g.id } });
    const bad = await save([{ op: "term", scope: "client", id: c.id, attribute: "SUPPORT", before: null, after: "DIAMANTE" }]);
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]).toMatchObject({ key: `c:${c.id}:SUPPORT`, kind: "VALIDATION" });
    expect((await save([{ op: "term", scope: "client", id: c.id, attribute: "SUPPORT", before: null, after: "SILVER_ON_DEMAND" }])).ok).toBe(true);
    expect((await rowOf("Vacío Uno")).own.support).toBe("SILVER_ON_DEMAND");
    // «No aplica» es una decisión explícita y también pasa por el guardado.
    expect((await save([{ op: "na", scope: "group", id: g.id, system: "WRIKE", before: false, after: true }])).ok).toBe(true);
    expect((await rows()).find((r) => r.id === g.id)!.own.na).toEqual(["WRIKE"]);
  });
});

describe("ID Zendesk exacto, conflictos y atomicidad", () => {
  it("un ID con decimales o notación científica se rechaza en su celda; no se redondea", async () => {
    const { c } = await world();
    for (const v of ["3.60534144557e11", "360534144557.0", "36 05", "abc"]) {
      const r = await save([{ op: "aliases", scope: "client", id: c.id, system: "ZENDESK_ID", before: ["710001"], after: [v] }]);
      expect(r.ok).toBe(false);
      expect(r.errors[0].key).toBe(`c:${c.id}:ZENDESK_ID`);
    }
    expect((await rowOf("Alfa Uno")).own.zdIds).toEqual(["710001"]);
  });

  it("conflicto con otra edición: se localiza en la celda, NADA se guarda (sin éxito parcial) y el resto del borrador sigue siendo válido", async () => {
    const { g, c } = await world();
    // Otra persona cambia el soporte mientras tanto.
    await prisma.serviceTerm.updateMany({ where: { clientId: c.id, attribute: "SUPPORT" }, data: { value: "SILVER_RECURRENTE", version: { increment: 1 } } });
    const changes: EditChange[] = [
      { op: "term", scope: "client", id: c.id, attribute: "SUPPORT", before: "GOLD", after: "PLATINUM" },
      { op: "term", scope: "client", id: c.id, attribute: "HOSTING", before: "OP", after: "CLOUD" },
      { op: "name", entity: "group", id: g.id, before: "Alfa", after: "Alfa Nuevo" },
    ];
    const r = await save(changes);
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual([expect.objectContaining({ key: `c:${c.id}:SUPPORT`, kind: "CONFLICT" })]);
    // Atomicidad: ni el servidor ni el nombre se aplicaron.
    expect((await rowOf("Alfa Uno")).own).toMatchObject({ support: "SILVER_RECURRENTE", hosting: "OP" });
    expect((await rowOf("Alfa Uno")).groupName).toBe("Alfa");
    // Quitado el campo en conflicto, el resto se guarda.
    expect((await save(changes.slice(1))).ok).toBe(true);
    expect((await rowOf("Alfa Uno")).own.hosting).toBe("CLOUD");
  });

  it("una clave asignada a otro Grupo es un conflicto explícito: no se reasigna por parecido y el resto no se guarda", async () => {
    const { g } = await world();
    const r = await save([{ op: "aliases", scope: "group", id: g.id, system: "WRIKE", before: ["W-ALFA"], after: ["W-ALFA", "w-beta"] }]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ key: `g:${g.id}:WRIKE`, kind: "CONFLICT" });
    expect(r.errors[0].message).toContain("Beta");
    expect(await prisma.externalIdentity.count({ where: { groupId: g.id, system: "WRIKE" } })).toBe(1);
  });

  it("un campo compartido figura una sola vez: el mismo ID de campo dos veces se rechaza en vez de enviar escrituras contradictorias", async () => {
    const { g } = await world();
    const ch: EditChange = { op: "name", entity: "group", id: g.id, before: "Alfa", after: "X" };
    const r = await save([ch, { ...ch, after: "Y" }]);
    expect(r.ok).toBe(false);
    expect(changeKey(ch)).toBe(`g:${g.id}:name`);
  });

  it("el nombre de un Grupo duplicado y el de otra denominación BC se rechazan sin tocar nada", async () => {
    const { g, other } = await world();
    const dup = await save([{ op: "name", entity: "group", id: g.id, before: "Alfa", after: "beta" }]);
    expect(dup.errors[0].key).toBe(`g:${g.id}:name`);
    await prisma.externalIdentity.create({ data: { system: "BC", kind: "GROUP_KEY", rawValue: "BETA GLOBAL", searchValue: "beta global", groupId: other.id } });
    const bc = await save([{ op: "name", entity: "group", id: g.id, before: "Alfa", after: "BETA GLOBAL" }]);
    expect(bc.ok).toBe(false);
    expect(bc.errors[0].kind).toBe("CONFLICT");
    expect((await prisma.clientGroup.findUniqueOrThrow({ where: { id: g.id } })).name).toBe("Alfa");
  });

  it("solo un Administrador puede previsualizar o guardar (petición forjada de Consulta)", async () => {
    const { g } = await world();
    const ch: EditChange[] = [{ op: "name", entity: "group", id: g.id, before: "Alfa", after: "Forjado" }];
    await expect(applyMasterEdit(reader.id, { operationId: op(), changes: ch })).rejects.toBeInstanceOf(AccessError);
    await expect(previewMasterEdit(reader.id, { operationId: op(), changes: ch })).rejects.toBeInstanceOf(AccessError);
    expect((await prisma.clientGroup.findUniqueOrThrow({ where: { id: g.id } })).name).toBe("Alfa");
  });

  it("un digest de otro borrador impide guardar lo que no se revisó", async () => {
    const { g } = await world();
    const ch: EditChange[] = [{ op: "name", entity: "group", id: g.id, before: "Alfa", after: "Revisado" }];
    const p = await previewMasterEdit(admin.id, { operationId: op(), changes: ch });
    await expect(applyMasterEdit(admin.id, { operationId: op(), changes: [{ ...ch[0], after: "Otro" } as EditChange], digest: p.digest })).rejects.toThrow(/cambió después de revisarlo/);
    expect((await applyMasterEdit(admin.id, { operationId: op(), changes: ch, digest: p.digest })).ok).toBe(true);
  });
});

describe("altas en la tabla: sin entidades duplicadas ni producto cartesiano", () => {
  it("Grupo nuevo + Cliente nuevo en un borrador: se crean una vez, con su clave BC, ID y datos; el mismo ID en otro Cliente no crea un segundo", async () => {
    const r = await save([
      { op: "newGroup", tempId: "tg1", name: "Gamma", bcDenomination: null, active: true },
      { op: "newClient", tempId: "tc1", group: { tempId: "tg1" }, name: "Gamma Org", zdId: "720001", support: "GOLD", hosting: "CLOUD", complexity: "MEDIUM", wrike: ["W-GAMMA"], pap: ["P-GAMMA"] },
    ]);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.created).sort()).toEqual(["tc1", "tg1"]);
    expect(await prisma.clientGroup.count({ where: { name: "Gamma" } })).toBe(1);
    expect(await prisma.client.count({ where: { name: "Gamma Org" } })).toBe(1);
    const grp = await prisma.clientGroup.findFirstOrThrow({ where: { name: "Gamma" } });
    expect(await prisma.externalIdentity.count({ where: { groupId: grp.id, isActive: true } })).toBe(2); // BC + Wrike del Grupo; el PAP es del Cliente (no se fabrica Wrike×Zendesk×PAP)
    const dup = await save([{ op: "newClient", tempId: "tc2", group: { id: grp.id }, name: "Gamma Otra", zdId: "720001", support: "", hosting: "", complexity: "", wrike: [], pap: [] }]);
    expect(dup.ok).toBe(false);
    expect(dup.errors[0]).toMatchObject({ key: "new:tc2:zdId", kind: "CONFLICT" });
    expect(await prisma.client.count({ where: { groupId: grp.id } })).toBe(1);
    // Grupo sin Cliente: solo nombre/BC/estado.
    expect((await save([{ op: "newGroup", tempId: "tg9", name: "Solo grupo", bcDenomination: "SOLO GRP", active: true }])).ok).toBe(true);
    expect((await rows()).find((x) => x.name === "Solo grupo")).toMatchObject({ kind: "group", clients: 0 });
  });

  it("un reintento del alta con la misma operación no duplica el Grupo ni la auditoría", async () => {
    const id = op();
    const ch: EditChange[] = [{ op: "newGroup", tempId: "t", name: "Delta", bcDenomination: null, active: true }];
    await save(ch, id);
    const a = await audits();
    expect(await save(ch, id)).toMatchObject({ alreadyApplied: true });
    expect(await prisma.clientGroup.count({ where: { name: "Delta" } })).toBe(1);
    expect(await audits()).toBe(a);
  });
});

describe("completar enlaces en la tabla actualiza lo ya cargado sin volver a Cargas (HOTFIX-02)", () => {
  it("operativos antes del maestro → altas en la tabla → reenlace automático → tickets, Wrike y PAP atribuidos, cantidades conciliadas y sin dobles sumas", async () => {
    await loadOperationalFirst(admin.id);
    await drain();
    const base = { zd: ZD_TOTAL_MINUTES, wr: WRIKE_TOTAL_MINUTES };
    const sum = (xs: { minutes: string }[]) => xs.reduce((a, x) => a + Number(x.minutes), 0);
    expect((await zdOut()).every((x) => x.group === null)).toBe(true);
    expect(sum(await zdOut())).toBe(base.zd);
    // Dennis completa Grupo + Cliente + claves en la propia tabla.
    const r = await save([
      { op: "newGroup", tempId: "g", name: "GRP ALFA", bcDenomination: null, active: true },
      { op: "newClient", tempId: "c1", group: { tempId: "g" }, name: "Alfa Uno", zdId: "710001", support: "GOLD", hosting: "OP", complexity: "BASIC", wrike: ["W-ALFA"], pap: ["P-ALFA-1"] },
      { op: "newClient", tempId: "c2", group: { tempId: "g" }, name: "Alfa Dos", zdId: "710002", support: "GOLD", hosting: "OP", complexity: "MEDIUM", wrike: [], pap: ["P-ALFA-2"] },
    ]);
    expect(r.ok).toBe(true);
    expect((await readRefreshStatus()).state).not.toBe("UP_TO_DATE"); // el guardado solicita el reenlace
    await drain();
    expect((await readRefreshStatus()).state).toBe("UP_TO_DATE");
    const zd = await zdOut();
    expect(zd.find((x) => x.ticket === "3001")).toMatchObject({ group: "GRP ALFA", client: "Alfa Uno" });
    expect(zd.find((x) => x.ticket === "3005")).toMatchObject({ group: "GRP ALFA", client: "Alfa Dos" });
    expect(zd.find((x) => x.ticket === "3002")?.group).toBeNull(); // otro Grupo aún sin maestro
    expect(sum(zd)).toBe(base.zd); // misma cantidad: se movió de «sin asignar» a su destino, sin duplicar
    const wr = await wrikeOut();
    expect(wr.find((x) => x.task === "Sin ticket en Grupo")).toMatchObject({ group: "GRP ALFA", client: null }); // solo Grupo: sigue sumando al Grupo
    expect(sum(wr)).toBe(base.wr);
    const pap = await papOut();
    expect(pap.find((x) => x.pap === "501")).toMatchObject({ group: "GRP ALFA", client: "Alfa Uno" });
    expect(pap.filter((x) => x.pap === "501")).toHaveLength(1);
    // Corregir una clave Wrike: lo nuevo se atribuye; la clave retirada cierra su vigencia hoy (histórico conservado) y la suma no cambia.
    const grp = await prisma.clientGroup.findFirstOrThrow({ where: { name: "GRP ALFA" } });
    expect((await save([{ op: "aliases", scope: "group", id: grp.id, system: "WRIKE", before: ["W-ALFA"], after: ["W-ALFA", "W-BETA"] }])).ok).toBe(true);
    await drain();
    const wr2 = await wrikeOut();
    expect(wr2.find((x) => x.task === "Con ticket de Beta")).toBeDefined();
    expect(sum(wr2)).toBe(base.wr);
  });
});

describe("rutas y cabeceras", () => {
  it("las listas antiguas se traducen al editor sin bucles y sin propagar parámetros desconocidos", () => {
    expect(translateLegacyParams({ q: "alfa", status: "inactive", sort: "name", dir: "desc", page: "3" })).toBe("?q=alfa&estado=inactivos");
    expect(translateLegacyParams({ status: "all", groupId: "g1", pending: "1", internal: "yes", evil: "1" })).toBe("?estado=todos&grupo=g1&pendientes=1");
    expect(translateLegacyParams({ status: "active" })).toBe("");
    expect(editorHref({})).toBe("/administracion/clientes");
    expect(editorHref({ q: "x" })).not.toContain("/grupos");
    expect(editorHref({ nuevo: "grupo" })).toBe("/administracion/clientes?nuevo=grupo");
  });

  it("la precarga acepta las cabeceras legibles del adjunto y las técnicas antiguas con la misma interpretación", () => {
    const legibles = ["Grupo Cliente", "Wrike", "Id_Zendesk", "Zendesk", "Nivel de Servicio", "SERVIDOR", "PAP", "TIPO"];
    const tecnicas = ["GRUPO CLIENTE VINCLE", "organization_wrike", "organization_id_zendesk", "Organization_name_zendesk", "Nivel_Servicio_acutal", "SERVIDOR", "Organization_name_PAP", "TIPO"];
    expect(detectSheet(legibles)).toMatchObject({ kind: "CLIENTES", layout: "v2", extras: [] });
    expect(detectSheet(tecnicas)).toMatchObject({ kind: "CLIENTES", layout: "v2", extras: [] });
    expect(detectSheet(["Wrike", "Grupo Cliente", ...legibles.slice(2)]).kind).toBeNull(); // las posiciones no se intercambian
  });
});
