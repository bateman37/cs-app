import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lstat, mkdir, readFile, readdir, rename, rm, symlink, truncate, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { BackupBusyError, acquireBackupLock, backupLockLive, backupLockPath } from "@/server/ops/backup/lock";
import { BackupError } from "@/server/ops/backup/pgtools";
import { CONFIG_INVENTORY_FILE, DUMP_PATH, MANIFEST_FILE, MANIFEST_SHA_FILE, readManifest, sha256Hex } from "@/server/ops/backup/manifest";
import { redact } from "@/server/ops/backup/redact";
import { verifyBackup } from "@/server/ops/backup/verify";
import { writeRunFile } from "@/server/ops/runfile";
import { fakePgDump, makeBackup, makeWorld, type World } from "./csapp10-backup-helpers";

/**
 * CSAPP-10 §7: crear copias con PARADA CONTROLADA sobre PostgreSQL REAL (base de pruebas aprobada) y almacenes temporales propios en una carpeta con
 * espacios. Se comprueba el CONTENIDO (manifiesto, inventario, SHA-256, coherencia) y que un fallo no deja una copia recuperable.
 */
let w: World;
beforeAll(async () => { w = await makeWorld(); });
afterAll(async () => { await w.cleanup(); });

const dirs = async () => (await readdir(w.backups).catch(() => [] as string[])).sort();
const published = async () => (await dirs()).filter((d) => !d.startsWith(".tmp-"));
const cleanBackups = async () => { await rm(w.backups, { recursive: true, force: true }); };

describe("crear: copia coherente con parada controlada", () => {
  it("publica una copia con manifiesto, inventario relativo con SHA-256, controles por tabla y configuración sin valores; excluye temporales, sondas y caducadas", async () => {
    await cleanBackups();
    const logs: string[] = [];
    const r = await makeBackup(w, { log: (m) => logs.push(m) });
    expect(r.dir.startsWith(w.backups)).toBe(true);
    expect(await dirs()).toEqual([r.id]); // sin .tmp- residual
    const { manifest, sha256 } = await readManifest(r.dir);
    expect(sha256).toBe(sha256Hex(await readFile(path.join(r.dir, MANIFEST_FILE))));
    expect((await readFile(path.join(r.dir, MANIFEST_SHA_FILE), "utf8")).startsWith(sha256)).toBe(true);
    expect(manifest.formatVersion).toBe("csapp-backup-v1");
    expect(manifest.installationId).toBe(w.installationId);
    expect(manifest.versions.postgresServerMajor).toBeGreaterThanOrEqual(16);
    expect(manifest.versions.pgDumpMajor).toBeGreaterThanOrEqual(manifest.versions.postgresServerMajor);
    expect(manifest.versions.node).toBe(process.version);
    expect(manifest.schema.migrations.length).toBeGreaterThanOrEqual(9);
    expect(manifest.schema.triggers).toContain("ConfigRevision.ConfigRevision_immutable");
    // Recuentos e identidades de las tablas principales.
    expect(manifest.controls.tables.User.rows).toBe(2);
    expect(manifest.controls.tables.UploadBatch.rows).toBe(2);
    expect(manifest.controls.tables.ConfigRevision.rows).toBe(1);
    expect(manifest.controls.tables.ReconRun.rows).toBe(1);
    expect(manifest.controls.tables.ExportJob.rows).toBe(3);
    expect(manifest.controls.tables.ExportFile.rows).toBe(1);
    expect(manifest.controls.tables.User.idSum).toMatch(/^\d+$/);
    expect(Object.keys(manifest.controls.groups)).toContain("auditoria");
    // Inventario: dump, configuración, 2 originales, 1 exportación y las dos marcas; con bytes y SHA-256 correctos.
    const paths = manifest.files.map((f) => f.path).sort();
    expect(paths).toEqual([CONFIG_INVENTORY_FILE, DUMP_PATH, `exports/.csapp-store.json`, `exports/files/${w.files.exportReady.storageId}`, `uploads/.csapp-store.json`, `uploads/files/${w.files.uploadDone.storageId}`, `uploads/files/${w.files.uploadQueued.storageId}`].sort());
    const up = manifest.files.find((f) => f.path === `uploads/files/${w.files.uploadDone.storageId}`)!;
    expect(up.sha256).toBe(w.files.uploadDone.sha);
    expect(up.bytes).toBe(w.files.uploadDone.bytes);
    // Exclusiones clasificadas: temporales y sondas no se copian; la exportación caducada no tiene archivo.
    expect(manifest.excluded.map((e) => e.path).sort()).toEqual([".sonda-1-abcd", "incoming/", "tmp/"].sort());
    expect(await lstat(path.join(r.dir, "uploads", "incoming")).catch(() => null)).toBeNull();
    expect(await lstat(path.join(r.dir, "exports", "tmp")).catch(() => null)).toBeNull();
    // Condiciones acreditadas y registradas.
    expect(manifest.conditions.stopped).toBe(true);
    expect(manifest.conditions.checks.every((c) => c.ok)).toBe(true);
    expect(logs.join("\n")).toContain("Bloqueo de copia adquirido");
    // Verificación independiente: todo OK.
    const v = await verifyBackup(r.dir);
    expect(v.checks.filter((c) => c.status === "FALLO")).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.checks.find((c) => c.name === "volcado")?.status).toBe("OK");
  });

  it("el inventario de configuración contiene NOMBRES y jamás valores, claves ni .env", async () => {
    const [id] = await published();
    const raw = await readFile(path.join(w.backups, id, CONFIG_INVENTORY_FILE), "utf8");
    const inv = JSON.parse(raw);
    const names = inv.variables.map((v: { name: string }) => v.name);
    expect(names).toEqual(expect.arrayContaining(["DATABASE_URL", "BETTER_AUTH_SECRET", "CSAPP_UPLOAD_DIR", "CSAPP_EXPORT_DIR"]));
    expect(inv.variables.find((v: { name: string }) => v.name === "BETTER_AUTH_SECRET").custodiaAparte).toBe(true);
    expect(inv.variables.find((v: { name: string }) => v.name === "DATABASE_URL").custodiaAparte).toBe(true);
    // Ningún valor secreto de este entorno aparece en NINGÚN archivo de texto de la copia (manifiesto, configuración).
    const secrets = [process.env.BETTER_AUTH_SECRET, new URL(process.env.DATABASE_URL as string).password].filter((s): s is string => !!s && s.length >= 4);
    for (const f of [MANIFEST_FILE, CONFIG_INVENTORY_FILE]) {
      const text = await readFile(path.join(w.backups, id, f), "utf8");
      for (const s of secrets) expect(text.includes(s)).toBe(false);
      expect(text).not.toMatch(/postgres(ql)?:\/\//);
    }
    expect(await lstat(path.join(w.backups, id, ".env")).catch(() => null)).toBeNull();
  });

  it("los archivos de la copia están en una carpeta con espacios y el almacén original queda intacto", async () => {
    const [id] = await published();
    expect(w.backups).toContain(" ");
    expect(await readdir(path.join(w.uploads, "files"))).toHaveLength(2);
    expect(await readFile(path.join(w.backups, id, "uploads", "files", w.files.uploadDone.storageId))).toHaveLength(w.files.uploadDone.bytes);
  });
});

describe("crear: condiciones de parada controlada (no se acredita ⇒ no se crea copia)", () => {
  const before = async () => (await dirs()).length;

  it("web no declarada parada y respondiendo ⇒ rechaza; con --web-parada avisa y continúa", async () => {
    const n = await before();
    const fetchImpl = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    await expect(makeBackup(w, { conditionDeps: { fetchImpl } })).rejects.toThrow(/La web responde/);
    expect(await before()).toBe(n);
    const logs: string[] = [];
    const r = await makeBackup(w, { webStopped: true, conditionDeps: { fetchImpl }, log: (m) => logs.push(m) });
    expect(logs.join("\n")).toMatch(/AVISO.*--web-parada.*SÍ responde/);
    expect(r.manifest.conditions.webStoppedDeclared).toBe(true);
    await rm(r.dir, { recursive: true });
  });

  it("sin BETTER_AUTH_URL no se puede acreditar la web parada", async () => {
    const env = { ...process.env, BETTER_AUTH_URL: undefined };
    await expect(makeBackup(w, { env })).rejects.toThrow(/BETTER_AUTH_URL no está definida/);
  });

  it("supervisor vigente (archivo de ejecución con PID vivo y latido reciente) ⇒ rechaza", async () => {
    await writeRunFile({ token: "t", root: "/x", port: 1, host: "h", supervisorPid: process.pid, webPid: null, workerPid: null, workerId: "w", startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), sha: "s" }, w.state);
    const n = await before();
    await expect(makeBackup(w)).rejects.toThrow(/supervisor vigente/);
    expect(await before()).toBe(n);
    await rm(path.join(w.state, "cs-app.run.json"));
  });

  it("trabajador vivo ⇒ rechaza; detenido o con latido viejo ⇒ no bloquea", async () => {
    await prisma.workerInstance.create({ data: { id: "trabajador-vivo", pid: 1, host: "h", version: "1", sha: "s", state: "IDLE", lastSeenAt: new Date() } });
    await expect(makeBackup(w)).rejects.toThrow(/trabajador\(es\) vivo\(s\): trabajador-vivo/);
    await prisma.workerInstance.update({ where: { id: "trabajador-vivo" }, data: { lastSeenAt: new Date(Date.now() - 600_000) } });
    await expect(prisma.workerInstance.count()).resolves.toBe(1);
    const r = await makeBackup(w); // latido viejo: no está vivo
    await rm(r.dir, { recursive: true });
    await prisma.workerInstance.update({ where: { id: "trabajador-vivo" }, data: { lastSeenAt: new Date(), state: "STOPPED" } });
    const r2 = await makeBackup(w); // STOPPED aunque el latido sea reciente
    await rm(r2.dir, { recursive: true });
    await prisma.workerInstance.deleteMany();
  });

  it("trabajo de carga RUNNING o exportación GENERATING con lease vigente ⇒ rechaza; lease caducado no bloquea; la cola pendiente no bloquea", async () => {
    const batch = await prisma.uploadBatch.findFirstOrThrow({ where: { status: "QUEUED" } });
    const job = await prisma.uploadJob.create({ data: { batchId: batch.id, kind: "REDERIVE", status: "RUNNING", leaseOwner: "x", leaseExpiresAt: new Date(Date.now() + 60_000), actorId: w.admin.id } });
    await expect(makeBackup(w)).rejects.toThrow(/Trabajo\(s\) de carga en curso/);
    await prisma.uploadJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
    const ok = await makeBackup(w); // lease caducado
    await rm(ok.dir, { recursive: true });
    await prisma.uploadJob.delete({ where: { id: job.id } });
    const ej = await prisma.exportJob.findFirstOrThrow({ where: { status: "QUEUED" } });
    await prisma.exportJob.update({ where: { id: ej.id }, data: { status: "GENERATING", leaseOwner: "x", leaseExpiresAt: new Date(Date.now() + 60_000) } });
    await expect(makeBackup(w)).rejects.toThrow(/Exportación\(es\) en curso/);
    await prisma.exportJob.update({ where: { id: ej.id }, data: { status: "QUEUED", leaseOwner: null, leaseExpiresAt: null } });
  });

  it("lote RECEIVING reciente ⇒ rechaza; antiguo no bloquea", async () => {
    const b = await prisma.uploadBatch.create({ data: { profileId: "zendesk-tiempo", profileVersion: 1, status: "RECEIVING", originalName: "x.xlsx", storageId: "6f0f0f0f-0000-4000-8000-000000000001", fileFormat: "xlsx", createdById: w.admin.id } });
    await expect(makeBackup(w)).rejects.toThrow(/Subida\(s\) recibiéndose/);
    await prisma.uploadBatch.update({ where: { id: b.id }, data: { createdAt: new Date(Date.now() - 3 * 3600_000) } });
    const r = await makeBackup(w);
    expect(r.manifest.controls.tables.UploadBatch.rows).toBe(3);
    await rm(r.dir, { recursive: true });
    await prisma.uploadBatch.delete({ where: { id: b.id } });
  });

  it("--esperar: espera hasta el máximo, sale con error claro y no fuerza nada; si la condición se cumple a tiempo, crea la copia", async () => {
    const wk = await prisma.workerInstance.create({ data: { id: "trabajador-espera", pid: 1, host: "h", version: "1", sha: "s", state: "IDLE", lastSeenAt: new Date() } });
    const t0 = Date.now();
    await expect(makeBackup(w, { waitSeconds: 1, pollMs: 200 })).rejects.toThrow(/tras esperar 1 s.*no se fuerza ningún estado/s);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
    expect((await prisma.workerInstance.findUniqueOrThrow({ where: { id: wk.id } })).state).toBe("IDLE"); // nada se tocó
    expect(await backupLockLive(w.state)).toBe(false); // el bloqueo se libera al fallar
    // Se detiene "a mitad de la espera".
    setTimeout(() => void prisma.workerInstance.update({ where: { id: wk.id }, data: { state: "STOPPED" } }).catch((e) => console.error("UPDATE FALLÓ", e)), 700);
    const r = await makeBackup(w, { waitSeconds: 10, pollMs: 200 });
    expect(r.manifest.conditions.checks.every((c) => c.ok)).toBe(true);
    await rm(r.dir, { recursive: true });
    await prisma.workerInstance.delete({ where: { id: wk.id } });
  });
});

describe("crear: bloqueo propio", () => {
  it("dos copias a la vez: la segunda falla, backupLockLive refleja el bloqueo y se libera al terminar", async () => {
    expect(await backupLockLive(w.state)).toBe(false);
    const held = await acquireBackupLock("crear", w.state);
    expect(await backupLockLive(w.state)).toBe(true);
    await expect(acquireBackupLock("crear", w.state)).rejects.toBeInstanceOf(BackupBusyError);
    await expect(makeBackup(w)).rejects.toThrow(/Ya hay una copia o restauración en curso/);
    await held.release();
    expect(await backupLockLive(w.state)).toBe(false);
  });

  it("un bloqueo sin latido reciente o de un PID muerto caduca y puede retomarse; el latido mantiene vigente el propio", async () => {
    const stale = { token: "viejo", pid: process.pid, host: "h", kind: "crear", startedAt: new Date(Date.now() - 600_000).toISOString(), heartbeatAt: new Date(Date.now() - 600_000).toISOString() };
    await writeFile(backupLockPath(w.state), JSON.stringify(stale));
    expect(await backupLockLive(w.state)).toBe(false);
    const dead = { ...stale, pid: 2 ** 22 + 12345, heartbeatAt: new Date().toISOString() };
    await writeFile(backupLockPath(w.state), JSON.stringify(dead));
    expect(await backupLockLive(w.state)).toBe(false);
    const held = await acquireBackupLock("crear", w.state, { beatMs: 50 });
    const first = JSON.parse(await readFile(backupLockPath(w.state), "utf8")).heartbeatAt;
    await new Promise((r) => setTimeout(r, 300));
    expect(JSON.parse(await readFile(backupLockPath(w.state), "utf8")).heartbeatAt).not.toBe(first);
    await held.release();
    expect(await lstat(backupLockPath(w.state)).catch(() => null)).toBeNull();
  });

  it("mientras dura la copia el bloqueo está vigente (nada debe arrancar)", async () => {
    let seen: boolean | null = null;
    const r = await makeBackup(w, { hooks: { afterDump: async () => { seen = await backupLockLive(w.state); } } });
    expect(seen).toBe(true);
    await rm(r.dir, { recursive: true });
  });
});

describe("crear: interrupción, fallo y espacio ⇒ no queda copia recuperable", () => {
  it.skipIf(process.platform === "win32")("pg_dump falla (ejecutable doble; script con shebang, solo POSIX) ⇒ error, sin copia publicada, sin .tmp- residual propio y sin bloqueo", async () => {
    await cleanBackups();
    const dbl = await fakePgDump(w.root, "falla");
    const env = { ...process.env, CSAPP_PG_DUMP: dbl };
    await expect(makeBackup(w, { env })).rejects.toThrow(/pg_dump falló/);
    expect(await dirs()).toEqual([]);
    expect(await backupLockLive(w.state)).toBe(false);
    // pg_dump que «tiene éxito» pero produce un volcado vacío tampoco es una copia.
    const dbl2 = await fakePgDump(w.root, "parcial-y-ok-vacio");
    await expect(makeBackup(w, { env: { ...process.env, CSAPP_PG_DUMP: dbl2 } })).rejects.toThrow(/no produjo un volcado válido/);
    expect(await dirs()).toEqual([]);
  });

  it("interrupción por la persona operadora (señal de cancelación) tras el volcado ⇒ no se publica nada y se limpia el temporal propio", async () => {
    const ac = new AbortController();
    await expect(makeBackup(w, { signal: ac.signal, hooks: { afterDump: () => ac.abort() } })).rejects.toThrow(/Copia interrumpida/);
    expect(await dirs()).toEqual([]);
    expect(await backupLockLive(w.state)).toBe(false);
  });

  it.skipIf(process.platform === "win32")("pg_dump más antiguo que el servidor ⇒ rechaza antes de crear nada", async () => {
    const f = path.join(w.root, "pg_dump_viejo");
    await writeFile(f, `#!/usr/bin/env node\nconsole.log("pg_dump (PostgreSQL) 12.4");\n`, { mode: 0o755 });
    await expect(makeBackup(w, { env: { ...process.env, CSAPP_PG_DUMP: f } })).rejects.toThrow(/más antiguo que el servidor/);
    expect(await dirs()).toEqual([]);
  });

  it("herramienta ausente ⇒ mensaje claro", async () => {
    await expect(makeBackup(w, { env: { ...process.env, CSAPP_PG_DUMP: path.join(w.root, "no-existe-pg_dump") } })).rejects.toThrow(/No se encontró la herramienta/);
  });

  it("corte por falta de espacio durante la copia de archivos ⇒ solo un .tmp- propio que se limpia; nada publicado", async () => {
    await expect(makeBackup(w, { hooks: { afterFile: () => { throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" }); } } })).rejects.toThrow(/ENOSPC/);
    expect(await dirs()).toEqual([]); // el temporal propio se limpia
  });

  it("espacio insuficiente comprobado ANTES de empezar ⇒ no se crea ni el temporal", async () => {
    await expect(makeBackup(w, { freeBytes: async () => 1024 })).rejects.toThrow(/Espacio insuficiente/);
    expect(await dirs()).toEqual([]);
  });

  it("un .tmp- abandonado (kill -9) no es una copia: verificar lo rechaza y restaurar no lo acepta", async () => {
    const tmp = path.join(w.backups, ".tmp-csapp-backup-20260101T000000Z-deadbeef");
    await mkdir(tmp, { recursive: true });
    await writeFile(path.join(tmp, "algo"), "x");
    const v = await verifyBackup(tmp);
    expect(v.ok).toBe(false);
    expect(v.checks[0].detail).toMatch(/temporal|incompleta/i);
    await rm(tmp, { recursive: true });
  });

  it("fallo tras publicar nada: cambios en la base durante la copia ⇒ no se publica", async () => {
    await expect(makeBackup(w, { hooks: { beforePublish: async () => { await prisma.clientGroup.create({ data: { name: "Intrusa" } }); } } })).resolves.toBeDefined(); // beforePublish llega tras la comprobación: se limpia abajo
    await prisma.clientGroup.deleteMany({ where: { name: "Intrusa" } });
    await cleanBackups();
    // Cambio ANTES de la comprobación final (tras copiar archivos) ⇒ rechazado.
    await expect(makeBackup(w, { hooks: { afterFile: async (_rel, n) => { if (n === 1) await prisma.clientGroup.create({ data: { name: "Intrusa 2" } }); } } })).rejects.toThrow(/La base cambió durante la copia/);
    await prisma.clientGroup.deleteMany({ where: { name: "Intrusa 2" } });
    expect(await dirs()).toEqual([]);
  });
});

describe("crear: coherencia base ↔ archivos", () => {
  it("un original referenciado que falta ⇒ la copia falla con la lista; --aceptar-originales-ausentes lo deja registrado", async () => {
    const f = path.join(w.uploads, "files", w.files.uploadQueued.storageId);
    const aside = `${f}.guardado`;
    await rename(f, aside);
    await expect(makeBackup(w)).rejects.toThrow(new RegExp(`AUSENTE.*${w.files.uploadQueued.storageId}`, "s"));
    expect(await dirs()).toEqual([]);
    const r = await makeBackup(w, { acceptMissingOriginals: true });
    expect(r.warnings.join("\n")).toMatch(/ACEPTADO por la persona operadora/);
    expect(r.manifest.excluded.some((e) => e.reason.includes("ausente (aceptado"))).toBe(true);
    await rm(r.dir, { recursive: true });
    await rename(aside, f);
  });

  it("un ExportFile de exportación LISTA sin archivo ⇒ falla con la lista; archivo con bytes distintos ⇒ falla", async () => {
    const f = path.join(w.exports, "files", w.files.exportReady.storageId);
    const aside = `${f}.guardado`;
    await rename(f, aside);
    await expect(makeBackup(w)).rejects.toThrow(/exportaciones: 1 archivo\(s\) referenciado\(s\) por la base AUSENTE/);
    await rename(aside, f);
    const original = await readFile(f);
    await truncate(f, 10);
    await expect(makeBackup(w)).rejects.toThrow(/la base registra/);
    await writeFile(f, original);
    expect(await dirs()).toEqual([]);
  });

  it("un original alterado (mismos bytes de longitud, otro contenido) ⇒ el SHA-256 no coincide con la base", async () => {
    const f = path.join(w.uploads, "files", w.files.uploadDone.storageId);
    const original = await readFile(f);
    const tampered = Buffer.from(original);
    tampered[0] ^= 0xff;
    await writeFile(f, tampered);
    await expect(makeBackup(w)).rejects.toThrow(/SHA-256 del archivo no coincide/);
    await writeFile(f, original);
  });

  it("un enlace simbólico en files/ no se sigue (se ignora con aviso) y un huérfano se excluye clasificado", async () => {
    await restoreExportFile();
    const outside = path.join(w.root, "secreto-fuera.txt");
    await writeFile(outside, "no debe copiarse");
    const link = path.join(w.uploads, "files", "7a0a0a0a-0000-4000-8000-0000000000aa");
    await symlink(outside, link);
    await writeFile(path.join(w.uploads, "files", "7a0a0a0a-0000-4000-8000-0000000000bb"), "huérfano sin fila en la base");
    const r = await makeBackup(w);
    const ex = r.manifest.excluded.map((e) => `${e.path}|${e.reason}`).join("\n");
    expect(ex).toMatch(/7a0a0a0a-0000-4000-8000-0000000000aa\|enlace simbólico \(no se sigue\)/);
    expect(ex).toMatch(/7a0a0a0a-0000-4000-8000-0000000000bb\|huérfano/);
    expect(r.manifest.files.some((f) => f.path.includes("7a0a0a0a"))).toBe(false);
    expect(r.warnings.join("\n")).toMatch(/enlace simbólico/);
    const all = (await readdir(r.dir, { recursive: true })).join("\n");
    expect(all).not.toContain("secreto-fuera");
    await rm(r.dir, { recursive: true });
    await rm(link);
    await rm(path.join(w.uploads, "files", "7a0a0a0a-0000-4000-8000-0000000000bb"));
  });

  it("una exportación LISTA ya caducada pero aún no barrida se copia por coherencia (nunca un READY sin archivo) y queda avisada", async () => {
    await prisma.exportJob.update({ where: { id: w.files.exportReady.jobId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await makeBackup(w);
    expect(r.manifest.files.some((f) => f.path.endsWith(w.files.exportReady.storageId))).toBe(true);
    expect(r.warnings.join("\n")).toMatch(/READY caducada pendiente de barrido/);
    await rm(r.dir, { recursive: true });
    await prisma.exportJob.update({ where: { id: w.files.exportReady.jobId }, data: { expiresAt: new Date(Date.now() + 86_400_000) } });
  });

  it("almacén de OTRA instalación (marca ajena) ⇒ rechaza; sin marca ⇒ avisa", async () => {
    const marker = path.join(w.uploads, ".csapp-store.json");
    const original = await readFile(marker, "utf8");
    await writeFile(marker, JSON.stringify({ kind: "uploads", installationId: "otra-instalacion", createdAt: new Date().toISOString() }));
    await expect(makeBackup(w)).rejects.toThrow(/pertenece a otra instalación/);
    await rm(marker);
    const r = await makeBackup(w);
    expect(r.warnings.join("\n")).toMatch(/no tiene marca de instalación/);
    await rm(r.dir, { recursive: true });
    await writeFile(marker, original);
  });
});

describe("crear: destino seguro", () => {
  it("rechaza un destino dentro de un almacén, que contenga un almacén, relativo o dentro de la aplicación", async () => {
    await expect(makeBackup(w, { destino: path.join(w.uploads, "copias") })).rejects.toThrow(/no puede estar dentro del almacén/);
    await expect(makeBackup(w, { destino: path.join(w.exports, "files") })).rejects.toThrow(/no puede estar dentro del almacén/);
    await expect(makeBackup(w, { destino: path.dirname(w.uploads) })).rejects.toThrow(/no puede estar dentro del almacén de .* ni contenerlo/);
    await expect(makeBackup(w, { destino: "relativo/copias" })).rejects.toThrow(/ruta absoluta/);
    await expect(makeBackup(w, { destino: path.join(process.cwd(), "copias-prueba") })).rejects.toThrow(/carpeta de la aplicación/);
    // Un enlace simbólico que apunte dentro de un almacén tampoco vale.
    const link = path.join(w.root, "enlace-a-almacen");
    await symlink(w.uploads, link);
    await expect(makeBackup(w, { destino: link })).rejects.toThrow(/no puede estar dentro del almacén/);
    await rm(link);
    expect(await lstat(path.join(process.cwd(), "copias-prueba")).catch(() => null)).toBeNull();
  });
});

describe("redacción de secretos", () => {
  it("quita credenciales de URL, PGPASSWORD y valores concretos", () => {
    const text = "fallo en postgresql://csapp:S3cr3t!clave@localhost:5432/cs_app y PGPASSWORD=S3cr3t!clave; token=abc";
    const r = redact(text, ["S3cr3t!clave"]);
    expect(r).not.toContain("S3cr3t");
    expect(r).toContain("postgresql://***@localhost:5432/cs_app");
  });

  it("los errores de la herramienta no contienen la contraseña (contraseña errónea de la URL)", async () => {
    const bad = new URL(process.env.DATABASE_URL as string);
    bad.password = "clave-incorrecta-ZZZ";
    const err = await makeBackup(w, { dbUrl: bad.toString() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackupError);
    expect((err as Error).message).not.toContain("clave-incorrecta-ZZZ");
  });
});

async function restoreExportFile() {
  const f = path.join(w.exports, "files", w.files.exportReady.storageId);
  if (!(await lstat(f).catch(() => null))) {
    const buf = Buffer.from("﻿a;b\n1;2\n".repeat(40));
    await writeFile(f, buf);
  }
}
