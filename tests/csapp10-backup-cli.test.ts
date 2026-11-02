import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { dbExists, makeBackup, makeWorld, type World } from "./csapp10-backup-helpers";
import { cloneBackup, tamperManifest } from "./csapp10-backup-tamper";

/** CSAPP-10 §7: la CLI (`scripts/backup.ts`, invocada como `npm run backup:*`) devuelve códigos de salida correctos y jamás imprime credenciales. Proceso real, sin shell. */
let w: World;
let good: string;
const TSX = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const SCRIPT = path.join(process.cwd(), "scripts", "backup.ts");
const run = (args: string[], env: Record<string, string> = {}) =>
  new Promise<{ code: number; out: string; err: string }>((resolve) => {
    execFile(process.execPath, [TSX, SCRIPT, ...args], { env: { ...process.env, ...env }, cwd: process.cwd() }, (e, out, err) => resolve({ code: e ? ((e as { code?: number }).code ?? 1) : 0, out, err }));
  });
const password = () => new URL(process.env.DATABASE_URL as string).password;

beforeAll(async () => {
  w = await makeWorld();
  good = (await makeBackup(w)).dir;
}, 120_000);
afterAll(async () => { await w.cleanup(); });

describe("CLI scripts/backup.ts", () => {
  it("verificar: copia íntegra ⇒ código 0 y OK por comprobación; copia manipulada ⇒ código 1 y FALLO", async () => {
    const ok = await run(["verificar", good]);
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/\[OK   \] integridad/);
    expect(ok.out).toMatch(/RESULTADO: OK/);
    const bad = await cloneBackup(good, path.join(w.root, "clones"));
    await tamperManifest(bad, (m) => { m.formatVersion = "csapp-backup-v7"; });
    const r = await run(["verificar", bad]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/\[FALLO\] formato/);
    expect(r.out).toMatch(/RESULTADO: FALLO/);
    expect((await run(["verificar"])).code).toBe(2);
  });

  it("crear por la CLI (rutas con espacios): código 0, copia publicada y ninguna credencial en la salida; sin destino ⇒ código 2", async () => {
    const dest = path.join(w.root, "copias cli");
    const env = { DATABASE_URL: process.env.DATABASE_URL as string, CSAPP_UPLOAD_DIR: w.uploads, CSAPP_EXPORT_DIR: w.exports, CSAPP_STATE_DIR: w.state, BETTER_AUTH_URL: "http://127.0.0.1:1" };
    const r = await run(["crear", "--destino", dest], env);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/COPIA COHERENTE CREADA Y VERIFICADA/);
    expect(r.out).toContain("Custodia aparte");
    expect(r.out + r.err).not.toContain(password());
    expect((await readdir(dest)).filter((n) => n.startsWith("csapp-backup-"))).toHaveLength(1);
    expect((await run(["crear"], env)).code).toBe(2);
    expect((await run(["crear", "--destino", dest, "--esperar", "abc"], env)).code).toBe(2);
  });

  it("restaurar: destino equivocado ⇒ código 1, mensaje claro, sin crear la base y sin imprimir la contraseña", async () => {
    const r = await run(["restaurar", good, "--db-url", process.env.DATABASE_URL as string, "--uploads", path.join(w.root, "ru"), "--exports", path.join(w.root, "re"), "--nuevo-origen"], { DATABASE_URL: process.env.DATABASE_URL as string });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Restauración rechazada ANTES de modificar nada/);
    expect(r.err).toMatch(/MISMA que el origen operativo/);
    expect(r.out + r.err).not.toContain(password());
    expect(await dbExists("cs_app_bkrechazo_test")).toBe(false);
    expect((await run(["restaurar", good])).code).toBe(2);
    expect((await run(["nada"])).code).toBe(2);
  });
});
