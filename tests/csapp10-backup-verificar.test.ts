import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendFile, readFile, rm, symlink, truncate, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { DUMP_PATH, MANIFEST_FILE, MANIFEST_SHA_FILE, compareMigrations, schemaCompatMessage } from "@/server/ops/backup/manifest";
import { expectedMigrations, formatChecks, verifyBackup } from "@/server/ops/backup/verify";
import { makeBackup, makeWorld, type World } from "./csapp10-backup-helpers";
import { cloneBackup, tamperManifest } from "./csapp10-backup-tamper";

/** CSAPP-10 §7 «Verificar»: cada comprobación da OK/FALLO/AVISO y una copia dañada, truncada o manipulada NO es utilizable. Se altera siempre un clon. */
let w: World;
let good: string;
beforeAll(async () => {
  w = await makeWorld();
  good = (await makeBackup(w)).dir;
}, 120_000);
afterAll(async () => { await w.cleanup(); });

const clone = () => cloneBackup(good, path.join(w.root, "clones"));
const failures = (r: Awaited<ReturnType<typeof verifyBackup>>) => r.checks.filter((c) => c.status === "FALLO");

describe("verificar", () => {
  it("una copia íntegra: todas las comprobaciones OK, salida legible y bytes recalculados", async () => {
    const r = await verifyBackup(good);
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.name)).toEqual(expect.arrayContaining(["directorio", "manifiesto", "rutas", "integridad", "migraciones", "volcado"]));
    expect(formatChecks(r.checks)).toMatch(/\[OK   \] integridad: 7 archivos/);
    expect(r.bytes).toBeGreaterThan(1000);
    expect(r.schemaCompat).toBe("igual");
  });

  it("un byte alterado en un original (mismo tamaño) ⇒ FALLO de integridad con el nombre del archivo", async () => {
    const d = await clone();
    const f = path.join(d, "uploads", "files", w.files.uploadDone.storageId);
    const buf = await readFile(f);
    buf[3] ^= 0x01;
    await writeFile(f, buf);
    const r = await verifyBackup(d);
    expect(r.ok).toBe(false);
    expect(failures(r).map((c) => c.name)).toContain("integridad");
    expect(failures(r)[0].detail).toContain(w.files.uploadDone.storageId);
    expect(failures(r)[0].detail).toMatch(/SHA-256 distinto/);
  });

  it("copia TRUNCADA (volcado o archivo cortado) ⇒ FALLO; con el volcado cortado pg_restore --list también falla", async () => {
    const d = await clone();
    await truncate(path.join(d, ...DUMP_PATH.split("/")), 2000);
    const r = await verifyBackup(d);
    expect(r.ok).toBe(false);
    expect(failures(r).some((c) => c.name === "integridad" && /tamaño .*¿truncado\?/.test(c.detail))).toBe(true);
    expect(failures(r).some((c) => c.name === "volcado")).toBe(true);
    const d2 = await clone();
    await truncate(path.join(d2, "exports", "files", w.files.exportReady.storageId), 5);
    expect(failures(await verifyBackup(d2))[0].detail).toMatch(/¿truncado\?/);
  });

  it("archivo del inventario ausente ⇒ FALLO", async () => {
    const d = await clone();
    await rm(path.join(d, "uploads", "files", w.files.uploadQueued.storageId));
    expect(failures(await verifyBackup(d))[0].detail).toMatch(/ausente/);
  });

  it("manifiesto alterado sin recalcular su SHA ⇒ FALLO; SHA ausente o ilegible ⇒ FALLO", async () => {
    const d = await clone();
    await tamperManifest(d, (m) => { m.controls.tables.User.rows = 99; }, { fixSha: false });
    const r = await verifyBackup(d);
    expect(r.ok).toBe(false);
    expect(failures(r)[0]).toMatchObject({ name: "manifiesto" });
    expect(failures(r)[0].detail).toMatch(/alterado/);
    const d2 = await clone();
    await rm(path.join(d2, MANIFEST_SHA_FILE));
    expect(failures(await verifyBackup(d2))[0].detail).toMatch(/Falta manifest/);
    const d3 = await clone();
    await writeFile(path.join(d3, MANIFEST_SHA_FILE), "no es un sha\n");
    expect(failures(await verifyBackup(d3))[0].detail).toMatch(/no tiene un SHA-256 válido/);
    const d4 = await clone();
    await writeFile(path.join(d4, MANIFEST_FILE), "{ esto no es json");
    expect(failures(await verifyBackup(d4)).length).toBeGreaterThan(0);
  });

  it("versión de formato no soportada (más nueva o desconocida) ⇒ FALLO claro", async () => {
    for (const fmt of ["csapp-backup-v2", "csapp-backup-v0", "otra-cosa"]) {
      const d = await clone();
      await tamperManifest(d, (m) => { m.formatVersion = fmt; });
      const r = await verifyBackup(d);
      expect(r.ok).toBe(false);
      expect(failures(r)[0]).toMatchObject({ name: "formato" });
      expect(failures(r)[0].detail).toContain(fmt);
    }
  });

  it("esquema: «más antiguo» (AVISO con orden de migrar) y «más nuevo»/«divergente» (FALLO) con mensajes DISTINTOS", async () => {
    const code = await expectedMigrations();
    const older = await clone();
    await tamperManifest(older, (m) => { m.schema.migrations = m.schema.migrations.slice(0, -2); });
    const ro = await verifyBackup(older);
    const mo = ro.checks.find((c) => c.name === "migraciones")!;
    expect(ro.ok).toBe(true);
    expect(mo.status).toBe("AVISO");
    expect(mo.detail).toMatch(/MÁS ANTIGUO.*db:migrar/);
    const newer = await clone();
    await tamperManifest(newer, (m) => { m.schema.migrations = [...m.schema.migrations, "29991231235959_del_futuro"]; });
    const rn = await verifyBackup(newer);
    const mn = rn.checks.find((c) => c.name === "migraciones")!;
    expect(rn.ok).toBe(false);
    expect(mn.status).toBe("FALLO");
    expect(mn.detail).toMatch(/MÁS NUEVO.*29991231235959_del_futuro/);
    expect(mn.detail).not.toMatch(/MÁS ANTIGUO/);
    const diverg = await clone();
    await tamperManifest(diverg, (m) => { m.schema.migrations = [...m.schema.migrations.slice(0, -1), "29991231235959_del_futuro"]; });
    const md = (await verifyBackup(diverg)).checks.find((c) => c.name === "migraciones")!;
    expect(md.status).toBe("FALLO");
    expect(md.detail).toMatch(/DIVERGENTE/);
    expect(compareMigrations(code, code).compat).toBe("igual");
    expect(schemaCompatMessage(compareMigrations(code.slice(1), code))).toMatch(/MÁS ANTIGUO/);
    // Migraciones fallidas en el origen.
    const failed = await clone();
    await tamperManifest(failed, (m) => { m.schema.failedMigrations = ["20260101_rota"]; });
    expect(failures(await verifyBackup(failed)).some((c) => c.name === "migraciones" && /fallidas/.test(c.detail))).toBe(true);
  });

  it("rutas del inventario que escapan (.., absolutas POSIX/Windows, barras invertidas, fuera de las carpetas, duplicadas) ⇒ FALLO sin leer fuera", async () => {
    const bad = ["../fuera.txt", "uploads/../../fuera.txt", "/etc/passwd", "C:/Windows/system.ini", "C:\\Windows\\system.ini", "uploads\\files\\x", "uploads//x", "uploads/./x", "secretos/leeme.txt", ""];
    for (const p of bad) {
      const d = await clone();
      await tamperManifest(d, (m) => { m.files.push({ path: p, bytes: 1, sha256: "a".repeat(64), kind: "uploads" }); });
      const r = await verifyBackup(d);
      expect(r.ok, `la ruta ${JSON.stringify(p)} debe rechazarse`).toBe(false);
      expect(r.checks.find((c) => c.name === "rutas")!.status).toBe("FALLO");
    }
    const dup = await clone();
    await tamperManifest(dup, (m) => { m.files.push({ ...m.files[1] }); });
    expect(failures(await verifyBackup(dup)).some((c) => /duplicada/.test(c.detail))).toBe(true);
    const nodump = await clone();
    await tamperManifest(nodump, (m) => { m.files = m.files.filter((f) => f.kind !== "dump"); });
    expect(failures(await verifyBackup(nodump)).some((c) => /no incluye el volcado/.test(c.detail))).toBe(true);
  });

  it("un enlace simbólico dentro de la copia (archivo o carpeta) ⇒ FALLO: no se sigue hacia fuera", async () => {
    const outside = path.join(w.root, "fuera-de-la-copia.txt");
    await writeFile(outside, "contenido ajeno");
    const d = await clone();
    const f = path.join(d, "uploads", "files", w.files.uploadQueued.storageId);
    await rm(f);
    await symlink(outside, f);
    const r = await verifyBackup(d);
    expect(r.ok).toBe(false);
    expect(failures(r).some((c) => /enlace simbólico/.test(c.detail))).toBe(true);
    // Una carpeta enlazada.
    const d2 = await clone();
    await rm(path.join(d2, "exports"), { recursive: true });
    await mkdir(path.join(w.root, "exports-ajeno", "files"), { recursive: true });
    await symlink(path.join(w.root, "exports-ajeno"), path.join(d2, "exports"));
    expect(failures(await verifyBackup(d2)).some((c) => /enlace simbólico/.test(c.detail))).toBe(true);
    // La propia carpeta de la copia como enlace.
    const link = path.join(w.root, "enlace-a-la-copia");
    await symlink(good, link);
    expect((await verifyBackup(link)).ok).toBe(false);
  });

  it("archivos no inventariados dentro de la copia ⇒ AVISO (no se restaurarán); carpeta inexistente ⇒ FALLO", async () => {
    const d = await clone();
    await appendFile(path.join(d, "nota.txt"), "x");
    const r = await verifyBackup(d);
    expect(r.ok).toBe(true);
    expect(r.checks.find((c) => c.name === "extras")?.status).toBe("AVISO");
    expect((await verifyBackup(path.join(w.root, "no-existe"))).ok).toBe(false);
  });
});
