import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { databaseNameOf } from "@/lib/env";
import { confirmUpload } from "@/server/uploads/batches";
import { batch, drain, freshEnvironment, removeUploadDir, uploadText, useUploadDir } from "./cargas-helpers";

/**
 * ENSAYO REAL, SOLO MANUAL (HOTFIX-03 §5): importa los dos archivos privados de gestión («Tabla de Clientes.xlsx» de 8 columnas y «Tabla de Personal.xlsx» de 6) en una base
 * aislada, repite y comprueba que no se duplica nada. Se SALTA sin las dos rutas. Solo cifras: ningún nombre ni ID real se escribe ni se versiona.
 *
 *   CSAPP_ENSAYO_TABLA_CLIENTES=/ruta/clientes.xlsx CSAPP_ENSAYO_TABLA_PERSONAL=/ruta/personal.xlsx TEST_DATABASE_URL=postgresql://…/cs_app_ensayo_hf03_test?schema=public \
 *     npx vitest run tests/ensayo-hotfix03-tablas.test.ts
 */
const CLIENTES = process.env.CSAPP_ENSAYO_TABLA_CLIENTES ?? "";
const PERSONAL = process.env.CSAPP_ENSAYO_TABLA_PERSONAL ?? "";
const SHA_CLIENTES = "e49c814ba588dfcf3040d9a145331bf930fd693ec2981198a84451c43c9c9aef";
const SHA_PERSONAL = "09f73c43789959549d2eade9008d2f0206899320e54e678155acfdf12c1d4e9b";
const enabled = existsSync(CLIENTES) && existsSync(PERSONAL);

describe.skipIf(!enabled)("ensayo real de las tablas de gestión (base aislada)", () => {
  let dir: string;
  let admin: { id: string };
  beforeAll(async () => {
    expect(databaseNameOf(process.env.DATABASE_URL ?? "")).toMatch(/ensayo/);
    dir = useUploadDir();
    ({ admin } = await freshEnvironment());
  });
  afterAll(() => removeUploadDir(dir));
  const count = async (t: string) => Number((await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${t}"`))[0].n);
  const snapshot = async () => Object.fromEntries(await Promise.all(["ClientGroup", "Client", "ExternalIdentity", "ServiceTerm", "Person", "PersonAlias", "PersonTerm", "User", "Account"].map(async (t) => [t, await count(t)])));

  async function run(file: string, name: string) {
    const { id } = await uploadText(admin.id, readFileSync(file), { profileId: "precarga-maestros", name });
    await drain();
    const prepared = await batch(id);
    expect(prepared.status, prepared.statusDetail ?? "").toBe("READY");
    await confirmUpload(admin.id, id);
    await drain();
    return { prepared, done: await batch(id) };
  }

  it("Clientes de 8 columnas y Personal de 6: analiza, aplica, repite sin duplicar y no crea cuentas", async () => {
    expect(createHash("sha256").update(readFileSync(CLIENTES)).digest("hex")).toBe(SHA_CLIENTES);
    expect(createHash("sha256").update(readFileSync(PERSONAL)).digest("hex")).toBe(SHA_PERSONAL);
    const before = await snapshot();
    const c1 = await run(CLIENTES, "Tabla de Clientes.xlsx");
    console.log("CLIENTES valid/error/dup/excl:", c1.prepared.rowsValid, c1.prepared.rowsError, c1.prepared.rowsDuplicate, c1.prepared.rowsExcluded);
    const p1 = await run(PERSONAL, "Tabla de Personal.xlsx");
    console.log("PERSONAL valid/error/dup/excl:", p1.prepared.rowsValid, p1.prepared.rowsError, p1.prepared.rowsDuplicate, p1.prepared.rowsExcluded);
    const after = await snapshot();
    console.log("antes", JSON.stringify(before), "después", JSON.stringify(after));
    expect(after.User).toBe(before.User);
    expect(after.Account).toBe(before.Account);
    expect(p1.prepared.rowsDuplicate).toBe(1); // Personal 47/75
    // Repetir no duplica nada.
    await run(CLIENTES, "Tabla de Clientes.xlsx");
    await run(PERSONAL, "Tabla de Personal.xlsx");
    expect(await snapshot()).toEqual(after);
  });
});
