import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lstat, mkdir, readdir, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { backupLockLive } from "@/server/ops/backup/lock";
import { parsePgUrl, pgClientConfig } from "@/server/ops/backup/pgtools";
import { RestoreRejected, checkTargetDirs, checkTargetName, restoreBackup } from "@/server/ops/backup/restore";
import { createOwnDb, dbExists, dropOwnDb, makeBackup, makeWorld, ownDbUrl, type World } from "./csapp10-backup-helpers";
import { cloneBackup, tamperManifest } from "./csapp10-backup-tamper";

/**
 * CSAPP-10 §8: rechazos. Cada caso demuestra que NO se tocó nada: la base destino no se crea (o conserva intacto lo que tenía), las carpetas destino no se
 * crean ni se escriben y no queda bloqueo. Todo se valida ANTES de mutar. Los destinos de las pruebas son bases propias cs_app_bk…_test; nunca se lanza una
 * operación real contra cs_app: los casos de nombre/origen se resuelven por las reglas puras y por rechazo previo a cualquier conexión de escritura.
 */
const NEW_DB = "cs_app_bkrechazo_test";
const FULL_DB = "cs_app_bkdatos_test";
let w: World;
let backup: string;

const dirsFor = (tag: string) => ({ uploads: path.join(w.root, `destino ${tag}`, "originales"), exports: path.join(w.root, `destino ${tag}`, "exportaciones") });
const base = (tag: string, extra: Record<string, unknown> = {}) => ({ backup, dbUrl: ownDbUrl(NEW_DB), ...dirsFor(tag), nuevoOrigen: true, originUrl: process.env.DATABASE_URL, originDirs: { uploads: w.uploads, exports: w.exports }, stateDir: w.state, ...extra });
const untouched = async (tag: string) => {
  expect(await dbExists(NEW_DB)).toBe(false);
  expect(await lstat(path.dirname(dirsFor(tag).uploads)).catch(() => null)).toBeNull();
  expect(await backupLockLive(w.state)).toBe(false);
};
const clone = () => cloneBackup(backup, path.join(w.root, "clones"));

beforeAll(async () => {
  await dropOwnDb(NEW_DB);
  await dropOwnDb(FULL_DB);
  w = await makeWorld();
  backup = (await makeBackup(w)).dir;
}, 120_000);
afterAll(async () => { await dropOwnDb(NEW_DB); await dropOwnDb(FULL_DB); await w.cleanup(); });

describe("copia no válida: se rechaza sin mutar nada", () => {
  it("copia corrupta (un byte alterado) y truncada", async () => {
    const d = await clone();
    const f = path.join(d, "uploads", "files", w.files.uploadDone.storageId);
    const buf = await readFile(f);
    buf[0] ^= 0xff;
    await writeFile(f, buf);
    await expect(restoreBackup(base("a", { backup: d }))).rejects.toThrow(/no supera la verificación[\s\S]*integridad/);
    const t = await clone();
    await truncate(path.join(t, "db", "csapp.dump"), 3000);
    await expect(restoreBackup(base("a", { backup: t }))).rejects.toThrow(/no supera la verificación/);
    await untouched("a");
  });

  it("manifiesto alterado (sin recalcular el SHA) y formato no soportado", async () => {
    const d = await clone();
    await tamperManifest(d, (m) => { m.installationId = "otro"; }, { fixSha: false });
    await expect(restoreBackup(base("b", { backup: d }))).rejects.toThrow(/alterado/);
    const f = await clone();
    await tamperManifest(f, (m) => { m.formatVersion = "csapp-backup-v9"; });
    await expect(restoreBackup(base("b", { backup: f }))).rejects.toThrow(/formato de copia no soportada/);
    await untouched("b");
  });

  it("esquema más nuevo o divergente ⇒ rechaza; más antiguo ⇒ rechaza salvo --permitir-esquema-anterior", async () => {
    const n = await clone();
    await tamperManifest(n, (m) => { m.schema.migrations = [...m.schema.migrations, "29991231235959_del_futuro"]; });
    await expect(restoreBackup(base("c", { backup: n }))).rejects.toThrow(/MÁS NUEVO/);
    const dv = await clone();
    await tamperManifest(dv, (m) => { m.schema.migrations = [...m.schema.migrations.slice(0, -1), "29991231235959_x"]; });
    await expect(restoreBackup(base("c", { backup: dv }))).rejects.toThrow(/DIVERGENTE/);
    const o = await clone();
    await tamperManifest(o, (m) => { m.schema.migrations = m.schema.migrations.slice(0, -1); });
    await expect(restoreBackup(base("c", { backup: o }))).rejects.toThrow(/MÁS ANTIGUO[\s\S]*--permitir-esquema-anterior/);
    await untouched("c");
  });

  it("rutas del inventario que escapan o enlaces dentro de la copia", async () => {
    for (const p of ["../escape.txt", "/etc/passwd", "uploads/../../x"]) {
      const d = await clone();
      await tamperManifest(d, (m) => { m.files.push({ path: p, bytes: 1, sha256: "a".repeat(64), kind: "uploads" }); });
      await expect(restoreBackup(base("d", { backup: d }))).rejects.toThrow(/rutas/);
    }
    const s = await clone();
    const f = path.join(s, "exports", "files", w.files.exportReady.storageId);
    await rm(f);
    await symlink(path.join(w.root, "ajeno.txt"), f);
    await expect(restoreBackup(base("d", { backup: s }))).rejects.toThrow(/no supera la verificación/);
    await untouched("d");
  });

  it("servidor destino más antiguo que el de la copia ⇒ rechaza antes de crear la base", async () => {
    const d = await clone();
    await tamperManifest(d, (m) => { m.versions.postgresServerMajor = 99; m.versions.postgresServer = "99.0"; });
    await expect(restoreBackup(base("e", { backup: d }))).rejects.toThrow(/servidor destino es PostgreSQL .*anterior al de la copia/);
    await untouched("e");
  });
});

describe("destino equivocado: se rechaza antes de conectar o de escribir", () => {
  const origin = () => process.env.DATABASE_URL as string;
  const withName = (name: string, from = origin()) => { const u = new URL(from); u.pathname = `/${name}`; return u.toString(); };

  it("la misma base que el origen operativo (DATABASE_URL), cs_app, nombre no cs_app… o no _test en un ensayo", async () => {
    const same = checkTargetName(origin(), { nuevoOrigen: true, originUrl: origin() });
    expect(same.problems.join("\n")).toMatch(/MISMA que el origen operativo/);
    for (const [name, re] of [["cs_app", /no puede llamarse cs_app/], ["otra_base", /Un ensayo.*cs_app…_test/], ["cs_app_bkx", /Un ensayo.*cs_app…_test/], ["CS_APP_X_test", /Un ensayo/], ["cs_app_test; DROP", /Un ensayo|no es una URL/]] as const) {
      const r = checkTargetName(withName(name), { nuevoOrigen: true, originUrl: origin() });
      expect(r.problems.join("\n"), name).toMatch(re);
    }
    // Sin --nuevo-origen: nombre cs_app_<algo>, nunca cs_app ni el del origen.
    expect(checkTargetName(withName("cs_app"), { nuevoOrigen: false, originUrl: origin() }).problems.join()).toMatch(/cs_app/);
    expect(checkTargetName(withName("produccion"), { nuevoOrigen: false, originUrl: origin() }).problems.join()).toMatch(/debe ser cs_app_<algo>/);
    expect(checkTargetName(withName("cs_app_bkrestvitest_test"), { nuevoOrigen: false, originUrl: origin() }).problems).toEqual([]);
    // Mismo nombre que el origen aunque sea otro servidor.
    const other = new URL(origin());
    other.hostname = "servidor-dr.example";
    expect(checkTargetName(other.toString(), { nuevoOrigen: false, originUrl: origin() }).problems.join()).toMatch(/mismo nombre que la del origen operativo/);
    // Parámetros que redirigen la conexión.
    for (const q of ["host=otro", "dbname=cs_app", "port=1", "options=-c%20x", "user=root", "service=x"]) {
      const u = new URL(withName("cs_app_bkz_test"));
      const [k, v] = q.split("=");
      u.searchParams.set(k, decodeURIComponent(v));
      expect(checkTargetName(u.toString(), { nuevoOrigen: true, originUrl: origin() }).problems.join(), q).toMatch(/no admite el parámetro/);
    }
    expect(checkTargetName("mysql://x/y", { nuevoOrigen: true }).problems[0]).toMatch(/URL postgresql/);
  });

  it("restoreBackup con destino = origen, cs_app o nombre inválido: rechazo sin ninguna conexión de escritura ni carpetas creadas", async () => {
    for (const url of [origin(), withName("cs_app"), withName("produccion"), withName("cs_app_bkfuera")]) {
      await expect(restoreBackup(base("f", { dbUrl: url }))).rejects.toBeInstanceOf(RestoreRejected);
    }
    await untouched("f");
    expect(await dbExists("produccion")).toBe(false);
    expect(await dbExists("cs_app_bkfuera")).toBe(false);
  });

  it("base destino EXISTENTE con datos (cualquier tabla): rechaza y deja la base exactamente como estaba", async () => {
    await createOwnDb(FULL_DB);
    const c = new Client(pgClientConfig(parsePgUrl(ownDbUrl(FULL_DB))));
    await c.connect();
    try {
      await c.query(`CREATE TABLE "mi_tabla" (id int primary key)`);
      await c.query(`INSERT INTO "mi_tabla" VALUES (1), (2)`);
      await expect(restoreBackup(base("g", { dbUrl: ownDbUrl(FULL_DB) }))).rejects.toThrow(/ya existe y contiene \d+ objeto\(s\) de usuario/);
      const tables = (await c.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)).rows.map((r) => r.tablename);
      expect(tables).toEqual(["mi_tabla"]);
      expect((await c.query(`SELECT count(*)::int AS n FROM mi_tabla`)).rows[0].n).toBe(2);
    } finally { await c.end(); }
    expect(await lstat(path.dirname(dirsFor("g").uploads)).catch(() => null)).toBeNull();
    // Una secuencia o una vista sueltas también cuentan como «con datos».
    const c2 = new Client(pgClientConfig(parsePgUrl(ownDbUrl(FULL_DB))));
    await c2.connect();
    try {
      await c2.query(`DROP TABLE mi_tabla; CREATE SEQUENCE solo_secuencia`);
      await expect(restoreBackup(base("g", { dbUrl: ownDbUrl(FULL_DB) }))).rejects.toThrow(/objeto\(s\) de usuario/);
    } finally { await c2.end(); }
  });
});

describe("carpetas destino: se rechazan antes de crear nada", () => {
  it("no vacías, no directorio, relativas, dentro del origen o de la aplicación, anidadas entre sí o dentro de la copia", async () => {
    const full = path.join(w.root, "no-vacia");
    await mkdir(full, { recursive: true });
    await writeFile(path.join(full, "dato.txt"), "x");
    expect((await checkTargetDirs({ uploads: full, exports: path.join(w.root, "e1"), backup })).join()).toMatch(/--uploads .* no está vacía/);
    const file = path.join(w.root, "soy-un-archivo");
    await writeFile(file, "x");
    expect((await checkTargetDirs({ uploads: file, exports: path.join(w.root, "e2"), backup })).join()).toMatch(/no es un directorio/);
    expect((await checkTargetDirs({ uploads: "relativa/u", exports: path.join(w.root, "e3"), backup })).join()).toMatch(/ruta absoluta/);
    const origin = { uploads: w.uploads, exports: w.exports };
    expect((await checkTargetDirs({ uploads: path.join(w.uploads, "files", "nuevo"), exports: path.join(w.root, "e4"), backup, originDirs: origin })).join()).toMatch(/se superpone con el almacén de originales del origen/);
    expect((await checkTargetDirs({ uploads: path.join(w.root, "u5"), exports: w.exports, backup, originDirs: origin })).join()).toMatch(/no está vacía/);
    expect((await checkTargetDirs({ uploads: path.join(w.root, "u5b"), exports: path.join(w.exports, "files"), backup, originDirs: origin })).join()).toMatch(/no está vacía/);
    expect((await checkTargetDirs({ uploads: path.dirname(w.uploads), exports: path.join(w.root, "e6"), backup, originDirs: origin })).join()).toMatch(/no está vacía/);
    expect((await checkTargetDirs({ uploads: path.join(process.cwd(), "u7"), exports: path.join(w.root, "e7"), backup, originDirs: origin })).join()).toMatch(/se superpone con la carpeta de la aplicación/);
    expect((await checkTargetDirs({ uploads: path.join(w.root, "x8"), exports: path.join(w.root, "x8", "dentro"), backup })).join()).toMatch(/distintas y no estar una dentro de la otra/);
    expect((await checkTargetDirs({ uploads: path.join(w.root, "x9"), exports: path.join(w.root, "x9"), backup })).join()).toMatch(/distintas/);
    expect((await checkTargetDirs({ uploads: path.join(backup, "uploads2"), exports: path.join(w.root, "e10"), backup })).join()).toMatch(/se superpone con la copia/);
    // Enlace simbólico a un almacén del origen: se resuelve y se rechaza.
    const link = path.join(w.root, "enlace-al-origen");
    await symlink(w.uploads, link);
    expect((await checkTargetDirs({ uploads: path.join(link, "sub"), exports: path.join(w.root, "e11"), backup, originDirs: origin })).join()).toMatch(/se superpone con el almacén de originales del origen/);
    expect((await checkTargetDirs({ uploads: link, exports: path.join(w.root, "e12"), backup, originDirs: origin })).join()).toMatch(/no es un directorio \(o es un enlace simbólico\)/);
  });

  it("con carpetas inválidas, restoreBackup rechaza sin crear la base ni tocar el origen", async () => {
    const before = (await readdir(path.join(w.uploads, "files"))).length;
    await expect(restoreBackup(base("h", { uploads: w.uploads }))).rejects.toThrow(/no está vacía|dentro del almacén de originales/);
    await expect(restoreBackup(base("h", { exports: path.join(w.exports, "nuevo") }))).rejects.toThrow(/se superpone con el almacén de exportaciones/);
    expect(await dbExists(NEW_DB)).toBe(false);
    expect((await readdir(path.join(w.uploads, "files"))).length).toBe(before);
    expect(await backupLockLive(w.state)).toBe(false);
  });

  it("falta de espacio en las carpetas destino ⇒ rechaza sin crear nada", async () => {
    await expect(restoreBackup(base("i", { freeBytes: async () => 10 }))).rejects.toThrow(/Espacio insuficiente/);
    await untouched("i");
  });
});
