import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AccessError } from "@/lib/access";
import { DomainError } from "@/server/errors";
import { confirmUpload } from "@/server/uploads/batches";
import { listSources } from "@/server/uploads/batches";
import { computeReview, decidePrecargaReview, getPrecargaReview } from "@/server/precarga/review";
import { readRefreshStatus } from "@/server/relations/refresh";
import { batch, drain, freshEnvironment, removeUploadDir, uploadText, useUploadDir } from "./cargas-helpers";
import { CLIENT_HEADER, CLIENT_ROWS, PMO_ROWS, buildBook, cliente, personalRows } from "./generators/precarga-maestros";

const PROFILE = "precarga-maestros";
let dir: string;
let admin: { id: string };
let reader: { id: string };

beforeAll(() => {
  dir = useUploadDir();
});
afterAll(() => removeUploadDir(dir));
beforeEach(async () => {
  ({ admin, reader } = await freshEnvironment());
});

async function prepare(file: Buffer, name = "hojas.xlsx") {
  const { id } = await uploadText(admin.id, file, { profileId: PROFILE, name });
  await drain();
  return batch(id);
}
async function load(file: Buffer, name = "hojas.xlsx") {
  const prepared = await prepare(file, name);
  expect(prepared.status, prepared.statusDetail ?? "").toBe("READY");
  await confirmUpload(admin.id, prepared.id);
  await drain();
  const done = await batch(prepared.id);
  expect(done.status, done.statusDetail ?? "").toBe("COMPLETED");
  return done;
}

async function snapshot() {
  const t = (n: string) => prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${n}"`).then((r) => Number(r[0].n));
  return {
    groups: await t("ClientGroup"), clients: await t("Client"), impls: await t("Implementation"), identities: await t("ExternalIdentity"), terms: await t("ServiceTerm"),
    persons: await t("Person"), aliases: await t("PersonAlias"), pterms: await t("PersonTerm"), catalog: await t("StaffCatalogItem"), users: await t("User"), accounts: await t("Account"),
  };
}

const book = () => buildBook();
const find = <T extends { key: string }>(items: T[], prefix: string): T | undefined => items.find((i) => i.key.startsWith(prefix));

describe("perfil «Precarga de maestros»: tres hojas, un lote", () => {
  it("el formulario pide solo el archivo; el perfil no lee una hoja por defecto y no tiene metadatos", async () => {
    const s = await listSources(admin.id);
    const p = s.available.find((x) => x.id === PROFILE);
    expect(p).toBeDefined();
    expect(p?.metadataFields).toEqual([]);
    expect(p?.formats).toEqual(["xlsx"]);
  });

  it("prepara las tres hojas del mismo archivo: filas por hoja, cabeceras repetidas por posición, filas vacías finales ignoradas, duplicado exacto y exclusiones", async () => {
    const b = await prepare(await book());
    expect(b.status).toBe("READY");
    // 10 filas útiles de CLIENTES (las dos finales vacías no cuentan) + 4 de PERSONAL PMO + 10 de PERSONAL.
    expect(b.rowsReceived).toBe(24);
    expect(b.rowsError).toBe(0);
    expect(b.rowsExcluded).toBe(2); // marcador (en blanco) y usuario de prueba
    expect(b.rowsDuplicate).toBe(1); // duplicado exacto de PERSONAL
    const sheets = await prisma.$queryRaw<{ sheet: string; n: bigint }[]>`SELECT sheet, count(*) AS n FROM "UploadStagedRow" WHERE "batchId" = ${b.id} GROUP BY sheet ORDER BY sheet`;
    expect(sheets.map((s) => [s.sheet, Number(s.n)])).toEqual([["CLIENTES", 10], ["PERSONAL", 10], ["PERSONAL PMO", 4]]);
    const first = await prisma.uploadStagedRow.findFirstOrThrow({ where: { batchId: b.id, sheet: "CLIENTES" }, orderBy: { position: "asc" } });
    const t = first.typed as Record<string, string | null>;
    // Las tres columnas «GRUPO CLIENTE VINCLE» y las dos de nivel de servicio no se pisan entre sí.
    expect([t.wrikeGrupo, t.zdGrupo, t.papGrupo, t.soporteE, t.soporteH, t.zdId]).toEqual(["ALFA", "ALFA", "ALFA", "Gold", "Gold", "360000000101"]);
    // No se activa nada al preparar.
    expect(await prisma.clientGroup.count()).toBe(0);
  });

  it("solo Administrador sube: Consulta no puede forjar la carga ni leer el archivo original", async () => {
    await expect(uploadText(reader.id, await book(), { profileId: PROFILE, name: "hojas.xlsx" })).rejects.toBeInstanceOf(AccessError);
    expect(await prisma.uploadBatch.count()).toBe(0);
    await expect(getPrecargaReview(reader.id, "no-existe")).rejects.toBeInstanceOf(AccessError);
  });

  it("rechaza un libro cuyas cabeceras no son las de las hojas de carga y no escribe nada", async () => {
    // Cabecera de CLIENTES con dos columnas intercambiadas (otra posición): no es la hoja esperada.
    const swapped = [...CLIENT_HEADER];
    [swapped[2], swapped[3]] = [swapped[3], swapped[2]];
    const b = await prepare(await buildBook({ clientHeader: swapped }));
    expect(["REJECTED", "FAILED"]).toContain(b.status);
    expect(await prisma.client.count()).toBe(0);
  });
});

describe("activación: crea lo ausente, conserva lo ambiguo en revisión", () => {
  it("Grupos, Clientes, equivalencias, implantaciones, datos de servicio y personal con cifras independientes", async () => {
    const before = await snapshot();
    const done = await load(await book());
    const s = await snapshot();
    expect(s.groups).toBe(5); // ALFA, BETA, GAMMA, DELTA, EPSILON (los internos no inventan Grupo)
    expect(s.clients).toBe(9);
    expect(s.impls).toBe(3); // ALFA - POS, ALFA - SALES, BETA - VFS: un único Cliente cada nombre PAP
    // Cuentas Better Auth: ninguna nueva.
    expect(s.users).toBe(before.users);
    expect(s.accounts).toBe(before.accounts);
    const idn = async (system: string, kind: string) => prisma.externalIdentity.count({ where: { system: system as never, kind: kind as never } });
    expect(await idn("BC", "GROUP_KEY")).toBe(5);
    expect(await idn("ZENDESK", "ORG_ID")).toBe(9);
    expect(await idn("WRIKE", "PROJECT_NAME")).toBe(2); // ALFA - CS y BETA - CS; «COMPARTIDO - CS» apunta a dos Grupos: sin asignar
    expect(await idn("PAP", "PROJECT_NAME")).toBe(4); // 3 implantaciones + «ALFA - SHARED» al Grupo (dos Clientes); «MULTI - X» (dos Grupos) sin asignar
    // El ID de Zendesk se guarda como texto exacto.
    expect(await prisma.externalIdentity.count({ where: { system: "ZENDESK", kind: "ORG_ID", rawValue: "19000000000201" } })).toBe(1);
    // Internos: sin Grupo, marcados internos, con su ID.
    const internals = await prisma.client.findMany({ where: { isInternal: true }, orderBy: { name: "asc" } });
    expect(internals.map((c) => [c.name, c.groupId])).toEqual([["Test sandbox", null], ["VINCLE TEST", null]]);
    // Wrike apunta al GRUPO, no al primer Cliente.
    const w = await prisma.externalIdentity.findFirstOrThrow({ where: { system: "WRIKE", searchValue: "alfa - cs" } });
    expect(w.groupId).not.toBeNull();
    expect(w.clientId).toBeNull();
    // PAP de un único Cliente → implantación; de dos Clientes del mismo Grupo → Grupo (un solo destino).
    const shared = await prisma.externalIdentity.findMany({ where: { system: "PAP", searchValue: "alfa - shared" } });
    expect(shared).toHaveLength(1);
    expect(shared[0].groupId).not.toBeNull();
    const pos = await prisma.externalIdentity.findFirstOrThrow({ where: { system: "PAP", searchValue: "alfa - pos" }, include: { implementation: true } });
    expect(pos.implementationId).not.toBeNull();
    expect(pos.implementation?.name).toBe("ALFA - POS");
    // La complejidad es de la implantación, no del Cliente (dos tipos distintos del mismo Cliente se conservan).
    const alfaIberia = await prisma.externalIdentity.findFirstOrThrow({ where: { system: "ZENDESK", rawValue: "360000000101" } });
    const impls = await prisma.implementation.findMany({ where: { clientId: alfaIberia.clientId as string }, orderBy: { name: "asc" } });
    const cx = await Promise.all(impls.map((i) => prisma.serviceTerm.findFirstOrThrow({ where: { implementationId: i.id, attribute: "COMPLEXITY" } })));
    expect(impls.map((i, k) => [i.name, cx[k].value])).toEqual([["ALFA - POS", "BASIC"], ["ALFA - SALES", "ENTERPRISE"]]);
    expect(await prisma.serviceTerm.count({ where: { clientId: { not: null }, attribute: "COMPLEXITY" } })).toBe(0);
    // Datos de servicio con vigencia inicial desconocida.
    expect(await prisma.serviceTerm.count({ where: { attribute: "SUPPORT" } })).toBe(6); // BETA discrepa: pendiente
    expect(await prisma.serviceTerm.count({ where: { attribute: "HOSTING" } })).toBe(7);
    expect(await prisma.serviceTerm.count({ where: { validFrom: { not: null } } })).toBe(0);
    // Personal: 7 personas distintas (duplicado exacto consolidado; prueba y marcador no se crean).
    expect(s.persons).toBe(7);
    expect(s.aliases).toBe(17);
    expect(await prisma.person.count({ where: { name: { in: ["test user 1", "(en blanco)"] } } })).toBe(0);
    expect(s.catalog).toBe(6); // TEAM CS, PMO; LEVEL N1, N3; PMO_ROLE ANA, DEV
    expect(s.pterms).toBe(18 + 2); // equipo+nivel+PMO de seis personas y dos roles
    const incompleta = await prisma.person.findFirstOrThrow({ where: { name: "Incompleta Cinco" }, include: { terms: true } });
    expect(incompleta.terms).toHaveLength(0); // sin equipo ni nivel inventados; el 0 de la fórmula con Equipo vacío no es un «No PMO»
    // Roles: solo los dos enlaces exactos por alias Wrike; rol solo en personas PMO.
    const roles = await prisma.personTerm.findMany({ where: { attribute: "PMO_ROLE" }, include: { person: true, catalogItem: true } });
    expect(roles.map((r) => [r.person.name, r.catalogItem?.name, r.validFrom]).sort()).toEqual([["Ana Uno", "ANA", null], ["Dev Seis", "DEV", null]]);
    // Vigencia inicial desconocida en todos los tramos de persona y alias.
    expect(await prisma.personTerm.count({ where: { validFrom: { not: null } } })).toBe(0);
    // Informe del lote y auditoría con el lote.
    const rep = ((done.summary as { precarga?: { created: Record<string, number> } }).precarga) ?? { created: {} };
    expect(rep.created.grupos).toBe(5);
    expect(rep.created.personas).toBe(7);
    expect(await prisma.auditEvent.count({ where: { batchId: done.id, action: "CREATE" } })).toBeGreaterThan(60);
    expect(done.rowsImported).toBe(21); // 24 filas - 2 excluidas - 1 duplicado exacto
    // Sin revertir: el perfil no lo ofrece.
    const { getUpload } = await import("@/server/uploads/batches");
    const view = await getUpload(admin.id, done.id);
    expect(view?.actions.revert.allowed).toBe(false);
  });

  it("las revisiones se muestran en la ficha del lote (sin bandeja nueva) y lo ambiguo no se asigna por semejanza", async () => {
    const done = await load(await book());
    const r = await getPrecargaReview(admin.id, done.id);
    expect(r).not.toBeNull();
    const items = r!.items;
    const pending = items.filter((i) => i.state === "PENDING");
    expect(find(pending, "SUPPORT:19000000000201")?.decidable).toBe(true); // discrepancia E/H de Beta
    expect(find(pending, "WRIKE_ALIAS:compartido - cs")?.options.filter((o) => o.decision === "ASSIGN")).toHaveLength(2);
    expect(find(pending, "PAP_ALIAS:multi - x")?.options.filter((o) => o.decision === "ASSIGN")).toHaveLength(2);
    expect(find(pending, "PERSON_VARIANT:")?.options.filter((o) => o.decision === "MERGE")).toHaveLength(2);
    // PERSONAL PMO: un candidato por nombre extendido y un caso sin candidato; ninguno se enlaza solo.
    const ext = find(pending, "PMO_ROLE:ext siete largo");
    expect(ext?.options.filter((o) => o.decision === "LINK")).toHaveLength(1);
    expect(find(pending, "PMO_ROLE:sin persona")?.options.filter((o) => o.decision === "LINK")).toHaveLength(0);
    expect(items.find((i) => i.key.startsWith("INFO:PAP_GRUPO:"))?.state).toBe("APPLIED"); // atribución a Grupo aplicada, informativa
    expect(items.filter((i) => i.key.startsWith("INFO:PERSONAL_ENTRADA_PRUEBA") || i.key.startsWith("INFO:PERSONAL_MARCADOR_BLANCO"))).toHaveLength(2);
    // Lo ambiguo NO se asignó: ninguna identidad para esos alias.
    expect(await prisma.externalIdentity.count({ where: { system: "WRIKE", searchValue: "compartido - cs" } })).toBe(0);
    expect(await prisma.externalIdentity.count({ where: { system: "PAP", searchValue: "multi - x" } })).toBe(0);
    expect(await prisma.serviceTerm.count({ where: { client: { name: "Beta" }, attribute: "SUPPORT" } })).toBe(0);
    // Las dos variantes se cargan como personas distintas (sin fusión por semejanza).
    expect(await prisma.person.count({ where: { name: { in: ["Cris Tres", "Cris Trés"] } } })).toBe(2);
    // Las filas con revisión llevan aviso en el staging.
    const warned = await prisma.uploadStagedRow.count({ where: { batchId: done.id, hasWarning: true } });
    expect(warned).toBeGreaterThan(5);
  });

  it("repetir o reordenar la misma fuente no crea entidades nuevas ni pisa ediciones manuales o inactivos", async () => {
    await load(await book());
    const first = await snapshot();
    // Ediciones posteriores: desactivar un Cliente, cambiar un dato de servicio, desactivar una equivalencia y una persona.
    const beta = await prisma.client.findFirstOrThrow({ where: { name: "Beta" } });
    await prisma.client.update({ where: { id: beta.id }, data: { isActive: false } });
    const host = await prisma.serviceTerm.findFirstOrThrow({ where: { client: { name: "Alfa Iberia" }, attribute: "HOSTING" } });
    await prisma.serviceTerm.update({ where: { id: host.id }, data: { value: "CLOUD", validFrom: new Date("2026-06-01T00:00:00Z") } });
    await prisma.externalIdentity.updateMany({ where: { system: "WRIKE", searchValue: "beta - cs" }, data: { isActive: false } });
    const beto = await prisma.person.findFirstOrThrow({ where: { name: "Beto Dos" } });
    await prisma.person.update({ where: { id: beto.id }, data: { isActive: false } });
    // Mismo libro (mismo checksum) y el mismo contenido reordenado (otra hoja primero, filas invertidas).
    const same = await book();
    const again = await load(same, "otra-vez.xlsx");
    const reordered = await load(await buildBook({ order: ["PERSONAL", "CLIENTES", "PERSONAL PMO"], clients: [...CLIENT_ROWS].reverse(), pmo: [...PMO_ROWS].reverse(), personal: [...personalRows()].reverse() }), "reordenado.xlsx");
    const after = await snapshot();
    expect(after).toEqual(first); // ni una entidad, equivalencia, tramo, alias ni catálogo nuevos
    expect((await prisma.client.findUniqueOrThrow({ where: { id: beta.id } })).isActive).toBe(false);
    expect((await prisma.serviceTerm.findUniqueOrThrow({ where: { id: host.id } })).value).toBe("CLOUD");
    expect((await prisma.serviceTerm.findUniqueOrThrow({ where: { id: host.id } })).validFrom?.toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(await prisma.externalIdentity.count({ where: { system: "WRIKE", searchValue: "beta - cs", isActive: true } })).toBe(0);
    expect((await prisma.person.findUniqueOrThrow({ where: { id: beto.id } })).isActive).toBe(false);
    const rep = (b: { summary: unknown }) => ((b.summary as { precarga?: { created: Record<string, number> } }).precarga?.created) ?? {};
    expect(Object.values(rep(again)).reduce((a, b) => a + b, 0)).toBe(0);
    expect(Object.values(rep(reordered)).reduce((a, b) => a + b, 0)).toBe(0);
    // Se deja constancia de lo que se conservó.
    const notes = ((again.summary as { precarga?: { notes: { code: string }[] } }).precarga?.notes ?? []).map((n) => n.code);
    expect(notes).toEqual(expect.arrayContaining(["PERSONA_INACTIVA", "CLIENTE_INACTIVO", "DATO_DISTINTO_EN_MAESTRO"]));
  });

  it("reutiliza maestros existentes sin duplicarlos: Cliente con ese ID, Grupo con ese nombre y persona con ese alias", async () => {
    const g = await prisma.clientGroup.create({ data: { name: "alfa" } }); // mismo nombre sin distinguir mayúsculas
    const c = await prisma.client.create({ data: { name: "Alfa Iberia", groupId: g.id } });
    await prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: "360000000101", searchValue: "360000000101", clientId: c.id } });
    const p = await prisma.person.create({ data: { name: "Ana (nombre previo)" } });
    await prisma.personAlias.create({ data: { personId: p.id, system: "PAP", kind: "EMAIL", rawValue: "Ana.Uno@x.test", searchValue: "ana.uno@x.test" } });
    await load(await book());
    expect(await prisma.clientGroup.count({ where: { name: { in: ["alfa", "ALFA"] } } })).toBe(1);
    expect(await prisma.client.count({ where: { name: "Alfa Iberia" } })).toBe(1);
    expect(await prisma.person.count({ where: { name: { in: ["Ana Uno", "Ana (nombre previo)"] } } })).toBe(1);
    const ana = await prisma.person.findUniqueOrThrow({ where: { id: p.id } });
    expect(ana.name).toBe("Ana (nombre previo)"); // no se renombra
    expect(await prisma.personAlias.count({ where: { personId: p.id } })).toBe(3); // se completan los alias que faltaban
    // Cliente que ya existía: se conserva su Grupo y se le añade la equivalencia BC al Grupo existente.
    expect(await prisma.externalIdentity.count({ where: { system: "BC", groupId: g.id } })).toBe(1);
  });

  it("un mismo ID de Zendesk con nombres distintos no crea ese Cliente ni elige uno, pero sus alias Wrike y PAP y el resto de filas siguen su camino (HOTFIX-02: la fila ya no es un error)", async () => {
    // Antes (HOTFIX-01) las tres filas pasaban a ERROR y se perdían también sus columnas Wrike y PAP, que son claves independientes de C/D/F.
    const rows = [...CLIENT_ROWS, cliente("OTRO - WRIKE", "ALFA", "360000000101", "Otro nombre", "Gold", "ALFA", "OP", "Gold", "OTRO - PAP", "ALFA", null)];
    const b = await prepare(await buildBook({ clients: rows }));
    expect(b.status).toBe("READY");
    expect(b.rowsError).toBe(0);
    await confirmUpload(admin.id, b.id);
    await drain();
    expect(await prisma.externalIdentity.count({ where: { system: "ZENDESK", rawValue: "360000000101" } })).toBe(0);
    expect(await prisma.client.count()).toBe(8); // el Cliente contradictorio no se crea
    expect(await prisma.externalIdentity.count({ where: { system: "WRIKE", searchValue: "otro - wrike" } })).toBe(1); // su alias Wrike sí (a Grupo)
    expect(await prisma.externalIdentity.count({ where: { system: "PAP", searchValue: "otro - pap" } })).toBe(1); // y su nombre PAP (a Grupo, sin implantación ficticia)
    const review = await computeReview(prisma, await batch(b.id));
    expect(review.items.some((i) => i.key.startsWith("INFO:ZENDESK_ID_CONFLICTO:"))).toBe(true);
  });

  it("alias sin conflicto por semejanza: un alias activo de otro Grupo no se reasigna", async () => {
    const other = await prisma.clientGroup.create({ data: { name: "OTRO" } });
    await prisma.externalIdentity.create({ data: { system: "WRIKE", kind: "PROJECT_NAME", rawValue: "ALFA - CS", searchValue: "alfa - cs", groupId: other.id } });
    const done = await load(await book());
    expect(await prisma.externalIdentity.count({ where: { system: "WRIKE", searchValue: "alfa - cs", isActive: true } })).toBe(1);
    expect((await prisma.externalIdentity.findFirstOrThrow({ where: { system: "WRIKE", searchValue: "alfa - cs" } })).groupId).toBe(other.id);
    expect(((done.summary as { precarga?: { notes: { code: string }[] } }).precarga?.notes ?? []).map((n) => n.code)).toContain("IDENTIDAD_EN_CONFLICTO");
  });
});

describe("decisiones: autor, motivo, idempotentes y ligadas al checksum", () => {
  it("Soporte: asigna el valor elegido con vigencia desconocida; repetir la misma decisión no cambia nada; otra distinta se rechaza", async () => {
    const done = await load(await book());
    const key = "SUPPORT:19000000000201";
    await expect(decidePrecargaReview(admin.id, done.id, { key, decision: "ASSIGN", value: "PLATINUM", reason: "" })).rejects.toBeInstanceOf(DomainError);
    const r1 = await decidePrecargaReview(admin.id, done.id, { key, decision: "ASSIGN", value: "PLATINUM", reason: "Confirmado con Soporte" });
    expect(r1.idempotent).toBe(false);
    const term = await prisma.serviceTerm.findFirstOrThrow({ where: { client: { name: "Beta" }, attribute: "SUPPORT" } });
    expect([term.value, term.validFrom, term.validTo]).toEqual(["PLATINUM", null, null]);
    const n = await prisma.serviceTerm.count();
    const r2 = await decidePrecargaReview(admin.id, done.id, { key, decision: "ASSIGN", value: "PLATINUM", reason: "Repetida" });
    expect(r2.idempotent).toBe(true);
    expect(await prisma.serviceTerm.count()).toBe(n);
    await expect(decidePrecargaReview(admin.id, done.id, { key, decision: "ASSIGN", value: "SILVER_ON_DEMAND", reason: "Otra" })).rejects.toBeInstanceOf(DomainError);
    const d = await prisma.masterLoadDecision.findFirstOrThrow({ where: { batchId: done.id, reviewKey: key } });
    expect(d).toMatchObject({ checksum: done.checksum, decidedById: admin.id, decidedByEmail: "admin@test.local", reason: "Confirmado con Soporte", decision: "ASSIGN" });
    // Auditoría con el lote.
    expect(await prisma.auditEvent.count({ where: { batchId: done.id, entityType: "MasterLoadDecision" } })).toBe(1);
    const review = await computeReview(prisma, done);
    expect(find(review.items, key)?.state).toBe("RESOLVED");
  });

  it("alias Wrike y PAP ambiguos: se asignan solo a un Grupo candidato elegido; descartar los deja sin asignar", async () => {
    const done = await load(await book());
    const review = await computeReview(prisma, done);
    const w = find(review.items, "WRIKE_ALIAS:compartido - cs")!;
    const gamma = w.options.find((o) => o.label.includes("GAMMA"))!;
    await expect(decidePrecargaReview(admin.id, done.id, { key: w.key, decision: "ASSIGN", value: (await prisma.clientGroup.findFirstOrThrow({ where: { name: "ALFA" } })).id, reason: "x y z" })).rejects.toBeInstanceOf(DomainError); // Grupo que no es candidato
    await decidePrecargaReview(admin.id, done.id, { key: w.key, decision: "ASSIGN", value: gamma.value, reason: "Es de Gamma" });
    const id = await prisma.externalIdentity.findFirstOrThrow({ where: { system: "WRIKE", searchValue: "compartido - cs" } });
    expect(id.groupId).toBe(gamma.value);
    expect(id.validFrom).toBeNull();
    const p = find(review.items, "PAP_ALIAS:multi - x")!;
    await decidePrecargaReview(admin.id, done.id, { key: p.key, decision: "DISMISS", reason: "Se resuelve más adelante" });
    expect(await prisma.externalIdentity.count({ where: { system: "PAP", searchValue: "multi - x" } })).toBe(0);
    expect(find((await computeReview(prisma, done)).items, p.key)?.state).toBe("DECIDED");
  });

  it("variantes de persona: la fusión es explícita, mueve alias, deja inactiva a la otra y no pierde historia", async () => {
    const done = await load(await book());
    const v = find((await computeReview(prisma, done)).items, "PERSON_VARIANT:")!;
    const keepId = (await prisma.person.findFirstOrThrow({ where: { name: "Cris Tres" } })).id;
    const dropId = (await prisma.person.findFirstOrThrow({ where: { name: "Cris Trés" } })).id;
    await decidePrecargaReview(admin.id, done.id, { key: v.key, decision: "MERGE", value: keepId, reason: "Misma persona con tilde" });
    expect((await prisma.person.findUniqueOrThrow({ where: { id: dropId } })).isActive).toBe(false);
    expect(await prisma.personAlias.count({ where: { personId: keepId, isActive: true } })).toBe(4);
    expect(await prisma.personAlias.count({ where: { personId: dropId, isActive: true } })).toBe(0);
    expect(find((await computeReview(prisma, done)).items, v.key)?.state).toBe("RESOLVED");
    // Repetir el mismo libro después de fusionar no crea nada ni reactiva a la persona fusionada.
    const snap = await snapshot();
    await load(await book());
    expect(await snapshot()).toEqual(snap);
    expect((await prisma.person.findUniqueOrThrow({ where: { id: dropId } })).isActive).toBe(false);
  });

  it("PERSONAL PMO: enlaza el nombre extendido o crea la persona solo tras decidirlo; el rol exige pertenencia a PMO", async () => {
    const done = await load(await book());
    const review = await computeReview(prisma, done);
    const ext = find(review.items, "PMO_ROLE:ext siete largo")!;
    const link = ext.options.find((o) => o.decision === "LINK")!;
    const personsBefore = await prisma.person.count();
    await decidePrecargaReview(admin.id, done.id, { key: ext.key, decision: "LINK", value: link.value, reason: "Es la misma persona (nombre completo en Wrike)" });
    expect(await prisma.person.count()).toBe(personsBefore); // sin duplicar
    const siete = await prisma.person.findFirstOrThrow({ where: { name: "Ext Siete" }, include: { aliases: true, terms: { include: { catalogItem: true } } } });
    expect(siete.aliases.map((a) => a.rawValue)).toContain("Ext Siete Largo");
    expect(siete.terms.find((t) => t.attribute === "PMO_ROLE")?.catalogItem?.name).toBe("ANA");
    const sin = find(review.items, "PMO_ROLE:sin persona")!;
    await decidePrecargaReview(admin.id, done.id, { key: sin.key, decision: "CREATE", reason: "Persona PMO nueva confirmada" });
    const nueva = await prisma.person.findFirstOrThrow({ where: { name: "Sin Persona" }, include: { terms: { include: { catalogItem: true } } } });
    expect(nueva.terms.map((t) => [t.attribute, t.validFrom]).sort()).toEqual([["PMO_MEMBER", null], ["PMO_ROLE", null]]); // sin nivel ni equipo inventados
    expect((await computeReview(prisma, done)).items.filter((i) => i.kind === "PMO_ROLE" && i.state === "PENDING")).toHaveLength(0);
  });

  it("solo Administrador decide; en un lote sin completar no se decide; las decisiones no viajan a otro checksum", async () => {
    const sameFile = await book();
    const prepared = await prepare(sameFile);
    const key = "SUPPORT:19000000000201";
    await expect(decidePrecargaReview(admin.id, prepared.id, { key, decision: "DISMISS", reason: "prueba" })).rejects.toBeInstanceOf(DomainError); // READY
    await confirmUpload(admin.id, prepared.id);
    await drain();
    await expect(decidePrecargaReview(reader.id, prepared.id, { key, decision: "DISMISS", reason: "prueba" })).rejects.toBeInstanceOf(AccessError);
    await decidePrecargaReview(admin.id, prepared.id, { key, decision: "DISMISS", reason: "Se revisa con el cliente" });
    // El mismo archivo otra vez (mismo checksum): la revisión figura decidida; reordenado (otro checksum): vuelve a estar pendiente.
    const same = await load(sameFile, "mismo.xlsx");
    expect(same.checksum).toBe(prepared.checksum);
    expect(find((await computeReview(prisma, same)).items, key)?.state).toBe("DECIDED");
    expect(find((await computeReview(prisma, same)).items, key)?.decision?.otherBatch).toBe(true);
    const other = await load(await buildBook({ clients: [...CLIENT_ROWS].reverse() }), "otro.xlsx");
    expect(other.checksum).not.toBe(prepared.checksum);
    expect(find((await computeReview(prisma, other)).items, key)?.state).toBe("PENDING");
    // Las decisiones guardan el checksum, no el número de fila.
    const d = await prisma.masterLoadDecision.findFirstOrThrow({ where: { reviewKey: key } });
    expect(d.checksum).toBe(prepared.checksum);
    expect(JSON.stringify(d.payload)).not.toMatch(/position|fila/i);
  });
});

describe("ficha de la carga", () => {
  it("la sección de la precarga se pinta en la ficha con el informe, las revisiones decidibles y el estado de la actualización automática de relaciones (sin bandeja nueva)", async () => {
    const done = await load(await book());
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { MaestrosPanel } = await import("@/app/(app)/administracion/cargas/[id]/maestros-panel");
    const html = renderToStaticMarkup(await MaestrosPanel({ userId: admin.id, batch: { id: done.id, profileId: done.profileId, status: done.status } }));
    expect(html).toContain("Precarga de maestros");
    expect(html).toContain("Revertir no se ofrece");
    // HOTFIX-02: ya no se remite a «Reprocesar» lote a lote; la ficha informa del estado de la actualización automática de relaciones.
    expect(html).not.toContain("Reproceso necesario");
    expect(html).toMatch(/Relaciones al día|Actualizando relaciones/);
    expect(html).toContain("Alias Wrike «COMPARTIDO - CS»");
    expect(html).toContain("Guardar decisión");
    expect(html).toContain("Motivo (obligatorio)");
    // Otro perfil no pinta nada.
    expect(await MaestrosPanel({ userId: admin.id, batch: { id: done.id, profileId: "pap", status: "COMPLETED" } })).toBeNull();
    // Un lote sin completar muestra las revisiones pero sin formularios de decisión.
    const prepared = await prepare(await book(), "preparado.xlsx");
    const html2 = renderToStaticMarkup(await MaestrosPanel({ userId: admin.id, batch: { id: prepared.id, profileId: prepared.profileId, status: prepared.status } }));
    expect(html2).toContain("Se podrá decidir cuando la carga esté completada");
    expect(html2).not.toContain("Guardar decisión");
  });
});

describe("actualización automática en lugar de «reproceso necesario»", () => {
  it("la precarga que crea o decide maestros solicita la actualización de relaciones de TODO lo cargado (sin lista de 100 lotes) y la deja publicada", async () => {
    // Antes (HOTFIX-01) la ficha listaba como máximo 100 lotes y pedía «Reprocesar» en cada uno; ahora basta confirmar el libro.
    for (let i = 0; i < 105; i++) {
      await prisma.uploadBatch.create({
        data: { profileId: "pap", profileVersion: 1, status: "COMPLETED", originalName: `pap-${i}.xlsx`, storageId: `test-storage-pap-${i}`, fileFormat: "xlsx", createdById: admin.id, finishedAt: new Date(Date.now() - 86_400_000) },
      });
    }
    const done = await load(await book());
    const status = await readRefreshStatus();
    expect(status.requestedGeneration).toBeGreaterThan(0);
    expect(status.state).toBe("UP_TO_DATE"); // el trabajador (drain) ya la publicó
    expect(status.completedGeneration).toBe(status.requestedGeneration);
    expect(done.status).toBe("COMPLETED");
  });
});
