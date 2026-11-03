import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { databaseNameOf } from "@/lib/env";
import { confirmUpload } from "@/server/uploads/batches";
import { computeReview } from "@/server/precarga/review";
import { readRows } from "@/server/uploads/readers";
import { readerLimits } from "@/server/uploads/config";
import { batch, drain, freshEnvironment, removeUploadDir, uploadText, useUploadDir } from "./cargas-helpers";
import { buildBook } from "./generators/precarga-maestros";

/**
 * ENSAYO REAL, SOLO MANUAL: importa el libro privado «HOJAS DE CARGA.xlsx» en una base aislada (cs_app_ensayo_maestros_test), aplica lo válido,
 * repite y reordena, y comprueba conteos. Se SALTA si no se indica el archivo (no forma parte de la ejecución habitual):
 *
 *   CSAPP_ENSAYO_MAESTROS_XLSX=/ruta/HOJAS_DE_CARGA.xlsx TEST_DATABASE_URL=postgresql://…/cs_app_ensayo_maestros_test?schema=public \
 *     npx vitest run tests/ensayo-precarga-maestros.test.ts
 *
 * El informe NOMINATIVO se escribe fuera del repositorio (CSAPP_ENSAYO_INFORME o el directorio temporal); aquí solo hay cifras. El libro
 * no se copia al repositorio ni a fixtures.
 */
const FILE = process.env.CSAPP_ENSAYO_MAESTROS_XLSX ?? "";
const SHA = "daf8d61de6626c52948c0ef3cbf2dcccd1867094355a7f3f08fc1a9bd264cce8";
const enabled = FILE !== "" && existsSync(FILE);

describe.skipIf(!enabled)("ensayo real de la precarga de maestros (base aislada)", () => {
  let dir: string;
  let admin: { id: string };
  beforeAll(async () => {
    expect(databaseNameOf(process.env.DATABASE_URL ?? "")).toMatch(/ensayo/); // nunca una base que no sea la del ensayo
    dir = useUploadDir();
    ({ admin } = await freshEnvironment());
  });
  afterAll(() => removeUploadDir(dir));

  const count = async (t: string) => Number((await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${t}"`))[0].n);
  const snapshot = async () => Object.fromEntries(await Promise.all(["ClientGroup", "Client", "Implementation", "ExternalIdentity", "ServiceTerm", "Person", "PersonAlias", "PersonTerm", "StaffCatalogItem", "User", "Account"].map(async (t) => [t, await count(t)])));

  it("analiza, aplica lo válido, repite y reordena sin duplicar; cifras del encargo", async () => {
    const bytes = readFileSync(FILE);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(SHA);
    expect(bytes.length).toBe(27038);

    const { id } = await uploadText(admin.id, bytes, { profileId: "precarga-maestros", name: "HOJAS DE CARGA.xlsx" });
    await drain();
    const prepared = await batch(id);
    expect(prepared.status, prepared.statusDetail ?? "").toBe("READY");
    const sheets = await prisma.$queryRaw<{ sheet: string; n: bigint }[]>`SELECT sheet, count(*) AS n FROM "UploadStagedRow" WHERE "batchId" = ${id} GROUP BY sheet`;
    const bySheet = Object.fromEntries(sheets.map((s) => [s.sheet, Number(s.n)]));
    expect(bySheet).toEqual({ CLIENTES: 74, PERSONAL: 75, "PERSONAL PMO": 17 });
    expect(prepared.rowsError).toBe(0);
    expect(prepared.rowsDuplicate).toBe(1); // PERSONAL 47/75
    expect(prepared.rowsExcluded).toBe(2); // PERSONAL 58 (prueba) y 65 (marcador)
    const before = await snapshot();
    await confirmUpload(admin.id, id);
    await drain();
    const done = await batch(id);
    expect(done.status, done.statusDetail ?? "").toBe("COMPLETED");

    const review = await computeReview(prisma, done);
    // Cifras del plan = cifras del encargo (denominaciones BC, organizaciones Zendesk, alias Wrike, PAP; personas y roles).
    expect(review.plan).toMatchObject({ groups: 46, clients: 63, wrike: 38, pap: 64, persons: 72, roles: 17, excluded: 2 });
    const after = await snapshot();
    const idn = (system: string) => prisma.externalIdentity.count({ where: { system: system as never } });
    const figures = {
      grupos: after.ClientGroup, clientes: after.Client, implantaciones: after.Implementation,
      bc: await prisma.externalIdentity.count({ where: { system: "BC" } }), zendesk: await idn("ZENDESK"), wrike: await idn("WRIKE"), pap: await idn("PAP"),
      internos: await prisma.client.count({ where: { isInternal: true, groupId: null } }),
      personas: after.Person, alias: after.PersonAlias, tramos: after.PersonTerm, catalogo: after.StaffCatalogItem,
      rolesEnlazados: await prisma.personTerm.count({ where: { attribute: "PMO_ROLE" } }),
      soporte: await prisma.serviceTerm.count({ where: { attribute: "SUPPORT" } }), servidor: await prisma.serviceTerm.count({ where: { attribute: "HOSTING" } }), complejidad: await prisma.serviceTerm.count({ where: { attribute: "COMPLEXITY" } }),
      cuentasNuevas: after.User - before.User + (after.Account - before.Account),
    };
    expect(figures).toMatchObject({ grupos: 46, clientes: 63, bc: 46, zendesk: 63, internos: 4, personas: 72, rolesEnlazados: 16, cuentasNuevas: 0 });
    expect(figures.wrike).toBe(37); // 38 alias; «uno de ellos identifica 3 Grupos» queda sin asignar
    expect(figures.implantaciones).toBe(62); // 64 PAP: uno identifica 4 Grupos (revisión) y otro 2 Clientes de un Grupo (atribución al Grupo)
    expect(figures.pap).toBe(63);

    const kinds = (k: string, st?: string) => review.items.filter((i) => i.kind === k && (!st || i.state === st)).length;
    const items = {
      soporte: kinds("SUPPORT", "PENDING"), wrike: kinds("WRIKE_ALIAS", "PENDING"), pap: kinds("PAP_ALIAS", "PENDING"), variantes: kinds("PERSON_VARIANT", "PENDING"),
      rolesPorRevisar: kinds("PMO_ROLE", "PENDING"), papGrupo: review.items.filter((i) => i.key.startsWith("INFO:PAP_GRUPO:")).length, excluidas: review.items.filter((i) => i.state === "INFO" && i.key.startsWith("INFO:PERSONAL_")).length - review.items.filter((i) => i.key.startsWith("INFO:PERSONA_INCOMPLETA")).length,
    };
    expect(items).toMatchObject({ soporte: 4, wrike: 1, pap: 1, variantes: 3, rolesPorRevisar: 1, papGrupo: 1 });
    const a18 = review.items.find((i) => i.kind === "PMO_ROLE");
    expect(a18?.options.filter((o) => o.decision === "LINK")).toHaveLength(1); // A18 frente a F74: posible nombre extendido

    // Repetir el mismo archivo: ni una entidad nueva.
    const again = await uploadText(admin.id, bytes, { profileId: "precarga-maestros", name: "HOJAS DE CARGA (repetido).xlsx" });
    await drain();
    await confirmUpload(admin.id, again.id);
    await drain();
    expect((await batch(again.id)).status).toBe("COMPLETED");
    expect(await snapshot()).toEqual(after);

    // Reordenar (hojas invertidas y filas al revés) sin cambiar el contenido: tampoco crea nada.
    type Row = (string | { raw: string } | { f: string; v?: string } | null)[];
    const sheetRows: Record<string, Row[]> = {};
    for await (const r of readRows(FILE, { format: "xlsx", limits: readerLimits() })) {
      const cells: Row = r.cells.map((c) => (c.k === "empty" ? null : c.f ? { f: "X", v: c.v } : c.k === "number" ? { raw: c.v } : c.v));
      (sheetRows[r.sheet ?? ""] ??= []).push(cells);
    }
    const body = (n: string) => sheetRows[n].slice(1).reverse();
    const re = await buildBook({ order: ["PERSONAL", "PERSONAL PMO", "CLIENTES"], clients: body("CLIENTES"), personal: body("PERSONAL"), pmo: body("PERSONAL PMO") });
    const reId = await uploadText(admin.id, re, { profileId: "precarga-maestros", name: "reordenado.xlsx" });
    await drain();
    await confirmUpload(admin.id, reId.id);
    await drain();
    expect((await batch(reId.id)).status).toBe("COMPLETED");
    expect(await snapshot()).toEqual(after);

    // Informe nominativo PRIVADO (fuera del repositorio).
    const out = process.env.CSAPP_ENSAYO_INFORME ?? path.join(mkdtempSync(path.join(tmpdir(), "informe-precarga-")), "informe.txt");
    writeFileSync(
      out,
      [
        "ENSAYO PRECARGA DE MAESTROS (informe nominativo privado; no subir a Git)",
        JSON.stringify({ filasPorHoja: bySheet, contadoresLote: { recibidas: prepared.rowsReceived, errores: prepared.rowsError, duplicadas: prepared.rowsDuplicate, excluidas: prepared.rowsExcluded }, cifras: figures, revisiones: items }, null, 1),
        ...review.items.map((i) => `[${i.state}] ${i.kind} ${i.title} :: ${i.message} :: filas ${i.positions.join(",")} :: opciones ${i.options.map((o) => o.label).join(" | ")}`),
        ...(((done.summary as { precarga?: { notes: { code: string; message: string }[] } }).precarga?.notes ?? []).map((n) => `NOTA ${n.code}: ${n.message}`)),
      ].join("\n"),
    );
    console.log(`Informe nominativo privado: ${out}`);
    rmSync(dir, { recursive: true, force: true });
  });
});
