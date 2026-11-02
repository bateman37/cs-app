import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lstat, readFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { prisma } from "@/lib/db";
import { collectControls, diffControls } from "@/server/ops/backup/controls";
import { backupLockLive } from "@/server/ops/backup/lock";
import { parsePgUrl, pgClientConfig } from "@/server/ops/backup/pgtools";
import { restoreBackup } from "@/server/ops/backup/restore";
import { readManifest } from "@/server/ops/backup/manifest";
import { createOwnDb, dbExists, dropOwnDb, makeBackup, makeWorld, ownDbUrl, sha, type World } from "./csapp10-backup-helpers";
import { tamperManifest, cloneBackup } from "./csapp10-backup-tamper";

/**
 * CSAPP-10 §8: restauración REAL en base y carpetas nuevas (PostgreSQL real, pg_restore real). Se comprueba el CONTENIDO restaurado frente al manifiesto,
 * no solo el código de salida; que el origen queda intacto; la nueva identidad del ensayo y las sesiones invalidadas; y rutas con espacios.
 */
const DB1 = "cs_app_bkrestvitest_test";
const DB2 = "cs_app_bkrestvitest2_test";
const DB3 = "cs_app_bkrestvitest3_test";
let w: World;
let backup: string;
let originalControls: Awaited<ReturnType<typeof collectControls>>;

const connect = async (url: string) => { const c = new Client(pgClientConfig(parsePgUrl(url))); await c.connect(); return c; };
const dirsFor = (tag: string) => ({ uploads: path.join(w.root, `restaurado ${tag}`, "Mis Datos", "originales"), exports: path.join(w.root, `restaurado ${tag}`, "Mis Datos", "exportaciones") });
const opts = (db: string, tag: string, extra: Record<string, unknown> = {}) => ({ backup, dbUrl: ownDbUrl(db), ...dirsFor(tag), originUrl: process.env.DATABASE_URL, originDirs: { uploads: w.uploads, exports: w.exports }, stateDir: w.state, ...extra });
const cleanDbs = async () => { for (const d of [DB1, DB2, DB3]) await dropOwnDb(d); };

beforeAll(async () => {
  await cleanDbs();
  w = await makeWorld();
  backup = (await makeBackup(w)).dir;
  const c = await connect(process.env.DATABASE_URL as string);
  try { originalControls = await collectControls(c); } finally { await c.end(); }
}, 120_000);
afterAll(async () => { await cleanDbs(); await w.cleanup(); });

describe("restaurar (ensayo: --nuevo-origen) en base y carpetas nuevas", () => {
  let report: Awaited<ReturnType<typeof restoreBackup>>;
  const logs: string[] = [];

  it("restaura, verifica TODO frente al manifiesto y no deja bloqueo ni trabajadores", async () => {
    expect(await dbExists(DB1)).toBe(false);
    report = await restoreBackup({ ...opts(DB1, "1"), nuevoOrigen: true, log: (m) => logs.push(m) });
    expect(report.checks.filter((c) => c.status === "FALLO")).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.destination).toMatchObject({ createdDatabase: true, effectiveDatabase: DB1 });
    const names = report.checks.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["destino", "migraciones aplicadas", "recuentos, identidades y contenido", "disparadores", "relaciones", "integridad referencial", "revisiones inmutables", "archivos copiados", "base y archivos", "nuevo origen"]));
    expect(report.checks.find((c) => c.name === "revisiones inmutables")!.status).toBe("OK");
    expect(report.checks.find((c) => c.name === "revisiones inmutables")!.detail).toMatch(/rechaza una modificación/);
    expect(report.filesCopied.uploads.files).toBe(2);
    expect(report.filesCopied.exports.files).toBe(1);
    expect(await backupLockLive(w.state)).toBe(false);
    expect(logs.join("\n")).not.toContain(new URL(process.env.DATABASE_URL as string).password);
  });

  it("la base restaurada tiene los mismos recuentos, identidades y contenido que el origen (salvo identidad y sesiones del nuevo origen), y ningún trabajador", async () => {
    const c = await connect(ownDbUrl(DB1));
    try {
      const restored = await collectControls(c);
      const diffs = diffControls(originalControls, restored);
      // Lo ÚNICO que cambia es lo que el nuevo origen modifica deliberadamente.
      expect(diffs.map((d) => `${d.table}.${d.field}`).sort()).toEqual(["InstallationMeta.contentSum", "Session.contentSum", "Session.idSum", "Session.rows"].sort());
      expect(restored.User.rows).toBe(originalControls.User.rows);
      expect(restored.ConfigRevision.contentSum).toBe(originalControls.ConfigRevision.contentSum);
      expect(restored.ExportFile.contentSum).toBe(originalControls.ExportFile.contentSum);
      expect(restored.WorkerInstance.rows).toBe(0);
      const trg = await c.query("SELECT tgname FROM pg_trigger WHERE tgname = 'ConfigRevision_immutable'");
      expect(trg.rowCount).toBe(1);
    } finally { await c.end(); }
  });

  it("nuevo installationId, marcas de los almacenes reescritas y sesiones del origen invalidadas, con constancia en el informe", async () => {
    expect(report.nuevoOrigen).not.toBeNull();
    const n = report.nuevoOrigen!;
    expect(n.previousInstallationId).toBe(w.installationId);
    expect(n.newInstallationId).not.toBe(w.installationId);
    expect(n.sessionsRemoved).toBe(1);
    expect(n.markersRewritten).toEqual(["uploads/.csapp-store.json", "exports/.csapp-store.json"]);
    expect(n.secretNote).toMatch(/BETTER_AUTH_SECRET/);
    const c = await connect(ownDbUrl(DB1));
    try {
      expect((await c.query(`SELECT value FROM "InstallationMeta" WHERE key = 'installation_id'`)).rows[0].value).toBe(n.newInstallationId);
      expect((await c.query(`SELECT count(*)::int AS n FROM "Session"`)).rows[0].n).toBe(0);
    } finally { await c.end(); }
    for (const [kind, dir] of [["uploads", report.dirs.uploads], ["exports", report.dirs.exports]] as const) {
      const m = JSON.parse(await readFile(path.join(dir, ".csapp-store.json"), "utf8"));
      expect(m).toMatchObject({ kind, installationId: n.newInstallationId });
    }
    // El origen sigue con SU identidad y su sesión.
    expect((await prisma.installationMeta.findUniqueOrThrow({ where: { key: "installation_id" } })).value).toBe(w.installationId);
    expect(await prisma.session.count()).toBe(1);
    expect(JSON.parse(await readFile(path.join(w.uploads, ".csapp-store.json"), "utf8")).installationId).toBe(w.installationId);
  });

  it("los archivos restaurados son idénticos (SHA-256) y las carpetas con espacios funcionan; temporales y caducadas NO se restauran", async () => {
    const { uploads, exports } = report.dirs;
    expect(uploads).toContain(" ");
    expect(sha(await readFile(path.join(uploads, "files", w.files.uploadDone.storageId)))).toBe(w.files.uploadDone.sha);
    expect(sha(await readFile(path.join(uploads, "files", w.files.uploadQueued.storageId)))).toBe(w.files.uploadQueued.sha);
    expect(sha(await readFile(path.join(exports, "files", w.files.exportReady.storageId)))).toBe(w.files.exportReady.sha);
    expect(await readdir(uploads)).not.toContain("incoming");
    expect(await readdir(exports)).not.toEqual(expect.arrayContaining(["tmp"]));
    expect((await readdir(exports)).some((n) => n.startsWith(".sonda"))).toBe(false);
    const c = await connect(ownDbUrl(DB1));
    try {
      const expired = await c.query(`SELECT status::text AS s, (SELECT count(*)::int FROM "ExportFile" f WHERE f."jobId" = j.id) AS files FROM "ExportJob" j WHERE id = $1`, [w.files.exportExpiredJobId]);
      expect(expired.rows[0]).toEqual({ s: "EXPIRED", files: 0 }); // la caducada sigue caducada y sin archivo
      const ready = await c.query(`SELECT j.status::text AS s FROM "ExportJob" j JOIN "ExportFile" f ON f."jobId" = j.id WHERE f."storageId" = $1`, [w.files.exportReady.storageId]);
      expect(ready.rows[0].s).toBe("READY");
      const queue = await c.query(`SELECT (SELECT count(*)::int FROM "ExportJob" WHERE status = 'QUEUED') AS ex, (SELECT count(*)::int FROM "UploadJob" WHERE status = 'PENDING') AS up`);
      expect(queue.rows[0]).toEqual({ ex: 1, up: 1 }); // la cola pendiente se conserva
    } finally { await c.end(); }
  });

  it("el origen queda INTACTO: mismos recuentos, identidades y contenido, y mismos archivos", async () => {
    const c = await connect(process.env.DATABASE_URL as string);
    try { expect(diffControls(originalControls, await collectControls(c))).toEqual([]); } finally { await c.end(); }
    expect(sha(await readFile(path.join(w.uploads, "files", w.files.uploadDone.storageId)))).toBe(w.files.uploadDone.sha);
    expect((await readdir(path.join(w.uploads, "incoming"))).length).toBe(1);
  });

  it("una segunda restauración sobre la misma base (ya con datos) se rechaza sin tocar nada", async () => {
    const before = await connect(ownDbUrl(DB1));
    let ctrl1;
    try { ctrl1 = await collectControls(before); } finally { await before.end(); }
    await expect(restoreBackup({ ...opts(DB1, "1b"), nuevoOrigen: true })).rejects.toThrow(/ya existe y contiene \d+ objeto\(s\) de usuario/);
    expect(await lstat(dirsFor("1b").uploads).catch(() => null)).toBeNull();
    const after = await connect(ownDbUrl(DB1));
    try { expect(diffControls(ctrl1, await collectControls(after))).toEqual([]); } finally { await after.end(); }
  });
});

describe("restaurar sin --nuevo-origen en una base preexistente VACÍA", () => {
  it("usa la base vacía (no la crea), conserva identidad y sesiones del origen y lo avisa; el estado normalizable queda registrado", async () => {
    await createOwnDb(DB2);
    let leaseInfo: unknown;
    const r = await restoreBackup({
      ...opts(DB2, "2"),
      hooks: {
        // Simula el estado heredado de un lease vigente tras copiar (las copias coherentes no lo traen): solo para probar la normalización.
        afterCopy: async () => {
          const c = await connect(ownDbUrl(DB2));
          try {
            await c.query(`INSERT INTO "UploadJob" (id, "batchId", kind, status, "leaseOwner", "leaseExpiresAt", "actorId") SELECT 'job-heredado', b.id, 'REDERIVE', 'RUNNING', 'trabajador-origen', now() + interval '1 hour', b."createdById" FROM "UploadBatch" b WHERE b.status = 'COMPLETED' LIMIT 1`);
            leaseInfo = (await c.query(`SELECT status::text, "leaseExpiresAt" FROM "UploadJob" WHERE id = 'job-heredado'`)).rows[0];
          } finally { await c.end(); }
        },
      },
    });
    expect(leaseInfo).toBeDefined();
    expect(r.ok).toBe(true);
    expect(r.destination.createdDatabase).toBe(false);
    expect(r.nuevoOrigen).toBeNull();
    expect(r.warnings.join("\n")).toMatch(/SIN --nuevo-origen/);
    expect(r.jobs.inheritedLeases.map((j) => j.id)).toEqual(["job-heredado"]);
    expect(r.jobs.normalized).toBe(false);
    expect(r.warnings.join("\n")).toMatch(/no se tocan sin --normalizar-trabajos/);
    const c = await connect(ownDbUrl(DB2));
    try {
      expect((await c.query(`SELECT value FROM "InstallationMeta" WHERE key = 'installation_id'`)).rows[0].value).toBe(w.installationId);
      expect((await c.query(`SELECT count(*)::int AS n FROM "Session"`)).rows[0].n).toBe(1);
      expect((await c.query(`SELECT status::text, "leaseExpiresAt" > now() AS vigente FROM "UploadJob" WHERE id = 'job-heredado'`)).rows[0]).toEqual({ status: "RUNNING", vigente: true });
    } finally { await c.end(); }
    expect(JSON.parse(await readFile(path.join(r.dirs.uploads, ".csapp-store.json"), "utf8")).installationId).toBe(w.installationId);
  });

  it("--normalizar-trabajos caduca SOLO el lease (explícito y registrado) y jamás completa el trabajo", async () => {
    const r = await restoreBackup({
      ...opts(DB3, "3"),
      nuevoOrigen: true,
      normalizarTrabajos: true,
      hooks: {
        afterCopy: async () => {
          const c = await connect(ownDbUrl(DB3));
          try {
            await c.query(`INSERT INTO "UploadJob" (id, "batchId", kind, status, "leaseOwner", "leaseExpiresAt", attempts, "actorId") SELECT 'job-heredado', b.id, 'REDERIVE', 'RUNNING', 'trabajador-origen', now() + interval '1 hour', 1, b."createdById" FROM "UploadBatch" b WHERE b.status = 'COMPLETED' LIMIT 1`);
            await c.query(`INSERT INTO "ExportJob" (id, "ownerId", dataset, query, status, "formatVersion", "engineVersion", "configRevisions", "requestedStamp", "requestedReadAt", "requestedTotals", "leaseOwner", "leaseExpiresAt", attempts) SELECT 'exp-heredada', u.id, 'horas', '{}', 'GENERATING', 'csv-v1', 'e', '{}', 's', now(), '{}', 'trabajador-origen', now() + interval '1 hour', 1 FROM "User" u LIMIT 1`);
          } finally { await c.end(); }
        },
      },
    });
    expect(r.ok).toBe(true);
    expect(r.jobs.normalized).toBe(true);
    expect(r.jobs.inheritedLeases.map((j) => `${j.kind}:${j.id}`).sort()).toEqual(["carga:job-heredado", "exportacion:exp-heredada"]);
    expect(r.warnings.join("\n")).toMatch(/NORMALIZADOS 2 trabajo\(s\).*ningún trabajo se marcó como completado/);
    const c = await connect(ownDbUrl(DB3));
    try {
      const up = (await c.query(`SELECT status::text AS status, "leaseExpiresAt" < now() AS caducado, attempts FROM "UploadJob" WHERE id = 'job-heredado'`)).rows[0];
      expect(up).toEqual({ status: "RUNNING", caducado: true, attempts: 1 }); // sigue RUNNING (lo reclamará el trabajador); nunca DONE
      const ex = (await c.query(`SELECT status::text AS status, "leaseExpiresAt" < now() AS caducado FROM "ExportJob" WHERE id = 'exp-heredada'`)).rows[0];
      expect(ex).toEqual({ status: "GENERATING", caducado: true });
    } finally { await c.end(); }
  });
});

describe("detección posterior a la restauración (no basta el código de salida)", () => {
  it("un manifiesto coherente pero que no refleja el contenido real ⇒ el informe marca FALLO en recuentos y no declara éxito", async () => {
    await dropOwnDb(DB1);
    const d = await cloneBackup(backup, path.join(w.root, "clones"));
    await tamperManifest(d, (m) => { m.controls.tables.User.rows += 1; });
    const r = await restoreBackup({ ...opts(DB1, "4"), backup: d, nuevoOrigen: true });
    expect(r.ok).toBe(false);
    const bad = r.checks.filter((c) => c.status === "FALLO");
    expect(bad.map((c) => c.name)).toEqual(["recuentos, identidades y contenido"]);
    expect(bad[0].detail).toContain("User.rows");
  });

  it("el manifiesto original de la copia es legible tras todas las restauraciones (la copia no se modifica)", async () => {
    const { manifest } = await readManifest(backup);
    expect(manifest.id).toBeTruthy();
    expect((await readdir(backup)).sort()).toEqual(["config-inventory.json", "db", "exports", "manifest.json", "manifest.sha256", "uploads"]);
    await mkdir(path.join(w.root, "x"), { recursive: true });
  });
});
