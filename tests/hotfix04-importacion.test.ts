import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { applyMasterEdit } from "@/server/master-edit";
import { loadMasterTable } from "@/server/master-table";
import { confirmUpload } from "@/server/uploads/batches";
import { batch, drain, freshEnvironment, removeUploadDir, uploadText, useUploadDir } from "./cargas-helpers";
import { buildBook } from "./generators/precarga-maestros";

/**
 * HOTFIX-04 §3 y §10 (caso 5): la hoja CLIENTES de ocho columnas se importa igual con las cabeceras legibles del archivo de gestión que con las técnicas, y una
 * organización que figura con Grupos distintos NO genera dos Clientes ni elige la última fila: se resuelve explícitamente creando el Cliente una vez en la tabla.
 * Datos SINTÉTICOS con la estructura del archivo (no se versiona el Excel real ni nada de sus Clientes).
 */
let dir: string;
let admin: { id: string };
beforeAll(() => { dir = useUploadDir(); });
afterAll(() => removeUploadDir(dir));
beforeEach(async () => { ({ admin } = await freshEnvironment()); });

const LEGIBLE = ["Grupo Cliente", "Wrike", "Id_Zendesk", "Zendesk", "Nivel de Servicio", "SERVIDOR", "PAP", "TIPO"];
const TECNICA = ["GRUPO CLIENTE VINCLE", "organization_wrike", "organization_id_zendesk", "Organization_name_zendesk", "Nivel_Servicio_acutal", "SERVIDOR", "Organization_name_PAP", "TIPO"];
const ROWS = [
  ["SINT ALFA", "SINT ALFA - CS", "910000000001", "Sint Alfa Org", "Platinum", "OP", "SINT ALFA - VSW", "Medium"],
  ["SINT BETA", "SINT BETA - CS", "910000000002", "Sint Beta Org", "Gold", "CLOUD", "SINT BETA - PAP", "Basic"],
  // Misma organización en dos filas con Grupo y servidor distintos (caso de las filas 63/82 del archivo real).
  ["SINT GAMMA", "SINT GAMMA - CS", "910000000003", "Sint Gamma Org", "Silver Recurrente", "CLOUD", "SINT GAMMA - PAP", "Enterprise"],
  ["SINT DELTA", "SINT DELTA - CS", "910000000003", "Sint Gamma Org", "Silver Recurrente", "OP", "SINT DELTA - PAP", "Enterprise"],
];

async function importBook(header: string[]) {
  const book = await buildBook({ omit: ["PERSONAL", "PERSONAL PMO"], clientHeader: header, clients: ROWS });
  const { id } = await uploadText(admin.id, book, { profileId: "precarga-maestros", name: "Clientes.xlsx" });
  await drain();
  const prepared = await batch(id);
  expect(prepared.status, prepared.statusDetail ?? "").toBe("READY");
  await confirmUpload(admin.id, id);
  await drain();
  expect((await batch(id)).status).toBe("COMPLETED");
}

const snapshot = async () => ({
  groups: (await prisma.clientGroup.findMany({ select: { name: true }, orderBy: { name: "asc" } })).map((g) => g.name),
  clients: (await prisma.client.findMany({ select: { name: true, group: { select: { name: true } } }, orderBy: { name: "asc" } })).map((c) => `${c.name}|${c.group?.name}`),
  ids: (await prisma.externalIdentity.findMany({ where: { system: "ZENDESK" }, select: { rawValue: true }, orderBy: { rawValue: "asc" } })).map((i) => i.rawValue),
  terms: (await prisma.serviceTerm.findMany({ select: { attribute: true, value: true, client: { select: { name: true } } }, orderBy: [{ attribute: "asc" }, { value: "asc" }] })).map((t) => `${t.attribute}:${t.value}:${t.client?.name}`),
  wrike: (await prisma.externalIdentity.findMany({ where: { system: "WRIKE" }, select: { rawValue: true }, orderBy: { rawValue: "asc" } })).map((i) => i.rawValue),
  pap: (await prisma.externalIdentity.findMany({ where: { system: "PAP" }, select: { rawValue: true }, orderBy: { rawValue: "asc" } })).map((i) => i.rawValue),
});

describe("cabeceras legibles y técnicas del archivo de gestión", () => {
  it("el mismo libro con las cabeceras legibles y con las técnicas produce exactamente las mismas entidades, claves y datos; el ID Zendesk sigue siendo texto exacto", async () => {
    await importBook(LEGIBLE);
    const a = await snapshot();
    ({ admin } = await freshEnvironment());
    await importBook(TECNICA);
    const b = await snapshot();
    expect(a).toEqual(b);
    expect(a.ids).toContain("910000000001");
    expect(a.groups).toEqual(expect.arrayContaining(["SINT ALFA", "SINT BETA"]));
  });

  it("la organización con Grupos y servidor distintos no se importa dos veces ni se elige la última fila: no hay Cliente para ese ID hasta resolverlo explícitamente en la tabla, una sola vez", async () => {
    await importBook(LEGIBLE);
    expect(await prisma.externalIdentity.count({ where: { system: "ZENDESK", rawValue: "910000000003" } })).toBe(0);
    expect(await prisma.client.count({ where: { name: "Sint Gamma Org" } })).toBe(0);
    const gamma = await prisma.clientGroup.findFirstOrThrow({ where: { name: "SINT GAMMA" } });
    // Resolución explícita desde el editor: se elige el Grupo y los datos y se crea UNA vez.
    const ok = await applyMasterEdit(admin.id, { operationId: randomUUID(), changes: [{ op: "newClient", tempId: "r", group: { id: gamma.id }, name: "Sint Gamma Org", zdId: "910000000003", support: "SILVER_RECURRENTE", hosting: "CLOUD", complexity: "ENTERPRISE", wrike: [], pap: [] }] });
    expect(ok.ok).toBe(true);
    expect(await prisma.client.count({ where: { name: "Sint Gamma Org" } })).toBe(1);
    // Intentar crear otro Cliente con el mismo ID en el otro Grupo se rechaza.
    const delta = await prisma.clientGroup.findFirstOrThrow({ where: { name: "SINT DELTA" } });
    const dup = await applyMasterEdit(admin.id, { operationId: randomUUID(), changes: [{ op: "newClient", tempId: "d", group: { id: delta.id }, name: "Sint Gamma Org", zdId: "910000000003", support: "", hosting: "OP", complexity: "", wrike: [], pap: [] }] });
    expect(dup.ok).toBe(false);
    expect(dup.errors[0]).toMatchObject({ key: "new:d:zdId", kind: "CONFLICT" });
    expect(await prisma.client.count({ where: { name: "Sint Gamma Org" } })).toBe(1);
    // La tabla muestra el Cliente en su Grupo con el ID exacto.
    const t = await loadMasterTable(admin.id, { estado: "todos" });
    expect(t.rows.find((r) => r.kind === "client" && r.name === "Sint Gamma Org")?.own.zdIds).toEqual(["910000000003"]);
  });
});
