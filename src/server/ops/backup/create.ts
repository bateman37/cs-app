import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Client } from "pg";
import { appRoot, buildInfo } from "@/lib/runtime";
import { exportConfig } from "@/server/exports/config";
import { uploadConfig } from "@/server/uploads/config";
import { allOk, checkStopConditions, type Condition, type ConditionDeps } from "./conditions";
import { buildConfigInventory } from "./config-inventory";
import { CONTROL_GROUPS, collectControls, collectSchemaFacts, diffControls, listTables } from "./controls";
import { copyFileHashed, freeBytesAt, isRegularFile, isWithinReal, scanDir, sha256File } from "./fsutil";
import { BACKUP_FORMAT, CONFIG_INVENTORY_FILE, DUMP_PATH, writeManifest, type FileEntry, type Manifest } from "./manifest";
import { BackupError, assertDumpCompatible, parsePgUrl, runTool, serverVersion, toolPath, toolVersion, withClient } from "./pgtools";
import { acquireBackupLock, type HeldLock } from "./lock";
import { redact, secretsFrom } from "./redact";
import { verifyBackup, type Check } from "./verify";
import { STORE_MARKER } from "../stores";
import { stateDir } from "../runfile";

/**
 * Crear una copia (CSAPP-10 §7, vía inicial: copia con PARADA CONTROLADA, sin copia en caliente). La herramienta no anuncia una copia coherente si no
 * acredita las condiciones de parada, y publica por RENOMBRADO solo cuando todo está completo y verificado: cualquier interrupción (fallo de pg_dump, falta de
 * espacio, corte) deja a lo sumo un `.tmp-<id>` propio que NO es recuperable, nunca una copia a medias con aspecto de válida.
 */
export type CreateHooks = { afterDump?: () => Promise<void> | void; afterFile?: (rel: string, n: number) => Promise<void> | void; beforePublish?: () => Promise<void> | void };
export type CreateOptions = {
  /** Directorio que contendrá las copias (se crea la carpeta de cada copia dentro). Fuera de los almacenes y de la carpeta de la aplicación. */
  destino: string;
  dbUrl: string;
  uploadsDir?: string;
  exportsDir?: string;
  webStopped?: boolean;
  waitSeconds?: number;
  pollMs?: number;
  /** Acepta (y deja constancia de) originales de cargas ausentes del almacén; por defecto una referencia sin archivo hace fallar la copia. */
  acceptMissingOriginals?: boolean;
  env?: Record<string, string | undefined>;
  stateDir?: string;
  log?: (m: string) => void;
  signal?: AbortSignal;
  hooks?: CreateHooks;
  /** Pruebas: espacio libre simulado del destino y reloj. */
  freeBytes?: () => Promise<number>;
  conditionDeps?: ConditionDeps;
};
export type CreateResult = { id: string; dir: string; manifest: Manifest; checks: Check[]; bytes: { dump: number; uploads: number; exports: number; total: number }; requiredBytes: number; timingsMs: Record<string, number>; warnings: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REQUIRED_UPLOAD_STATUSES = new Set(["QUEUED", "PREPARING", "READY", "ACTIVATION_QUEUED", "ACTIVATING", "COMPLETED", "REVERTED"]);
type Store = "uploads" | "exports";
type Planned = { store: Store; storageId: string; bytes: number; expectSha: string | null; expectBytes: number | null };

export const newBackupId = (now = new Date()) => `csapp-backup-${now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")}-${randomBytes(4).toString("hex")}`;

/** El destino no puede estar en un almacén, contener uno, ni dentro de la carpeta de la aplicación (una reinstalación la borraría). */
export async function assertDestinationOutside(destino: string, stores: Record<Store, string>): Promise<void> {
  if (!path.isAbsolute(destino)) throw new BackupError("El destino de la copia debe ser una ruta absoluta.", "DESTINO");
  for (const [kind, dir] of Object.entries(stores)) {
    if ((await isWithinReal(destino, dir)) || (await isWithinReal(dir, destino))) throw new BackupError(`El destino de la copia (${destino}) no puede estar dentro del almacén de ${kind} ni contenerlo.`, "DESTINO");
  }
  if (await isWithinReal(destino, appRoot())) throw new BackupError(`El destino de la copia no puede estar dentro de la carpeta de la aplicación (${appRoot()}): una actualización podría borrarla.`, "DESTINO");
}

async function readMarker(dir: string): Promise<{ kind?: string; installationId?: string } | null> {
  try { return JSON.parse(await readFile(path.join(dir, STORE_MARKER), "utf8")); } catch { return null; }
}

export async function createBackup(opts: CreateOptions): Promise<CreateResult> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? (() => undefined);
  const conn = parsePgUrl(opts.dbUrl);
  const secrets = secretsFrom([opts.dbUrl], env);
  const stores: Record<Store, string> = { uploads: path.resolve(opts.uploadsDir ?? uploadConfig().dir), exports: path.resolve(opts.exportsDir ?? exportConfig().dir) };
  const destino = path.resolve(opts.destino);
  const timings: Record<string, number> = {};
  const t0 = Date.now();
  const phase = async <T>(name: string, fn: () => Promise<T>): Promise<T> => { const s = Date.now(); try { return await fn(); } finally { timings[name] = (timings[name] ?? 0) + Date.now() - s; } };
  const aborted = () => { if (opts.signal?.aborted) throw new BackupError("Copia interrumpida: no se publica nada.", "ABORTADO"); };

  if (!path.isAbsolute(opts.destino)) throw new BackupError("El destino de la copia debe ser una ruta absoluta.", "DESTINO");
  await assertDestinationOutside(destino, stores);
  await mkdir(destino, { recursive: true });

  const id = newBackupId();
  const tmp = path.join(destino, `.tmp-${id}`);
  const finalDir = path.join(destino, id);
  let lock: HeldLock | null = null;
  let tmpCreated = false;
  try {
    return await withClient(conn, async (db) => {
      // 1) Herramientas y versiones.
      const server = await serverVersion(db);
      const dumpV = await toolVersion("pg_dump", conn, env);
      assertDumpCompatible(dumpV, server);
      log(`PostgreSQL servidor ${server.raw}; pg_dump ${dumpV.raw}; Node ${process.version}.`);

      // 2) Bloqueo propio (impide dos copias y el arranque mientras dura). Se mantiene también mientras se espera la parada.
      lock = await acquireBackupLock("crear", opts.stateDir ?? stateDir(env));
      log("Bloqueo de copia adquirido (backup.lock): nada debe arrancar hasta terminar.");

      // 3) Condiciones de parada controlada; con --esperar se sondea hasta el máximo y se sale con error claro (nunca se fuerza un estado).
      const deadline = Date.now() + (opts.waitSeconds ?? 0) * 1000;
      let conditions: Condition[];
      for (;;) {
        aborted();
        conditions = await checkStopConditions(db, { webStopped: !!opts.webStopped, env, stateDir: opts.stateDir, ...opts.conditionDeps });
        if (allOk(conditions) || Date.now() >= deadline) break;
        log(`Esperando la parada controlada: ${conditions.filter((c) => !c.ok).map((c) => c.code).join(", ")}…`);
        await sleep(Math.min(opts.pollMs ?? 2000, Math.max(50, deadline - Date.now())), undefined, { signal: opts.signal }).catch(() => undefined);
      }
      for (const c of conditions) log(`${c.ok ? (c.warning ? "AVISO" : "OK   ") : "FALLO"} ${c.code}: ${c.message}`);
      if (!allOk(conditions)) throw new BackupError(`No se acredita la parada controlada${opts.waitSeconds ? ` tras esperar ${opts.waitSeconds} s` : ""}; no se crea ninguna copia (no se fuerza ningún estado):\n${conditions.filter((c) => !c.ok).map((c) => `  - ${c.message}`).join("\n")}`, "CONDICIONES");

      // 4) Coherencia base ↔ archivos, ANTES de escribir nada: qué se copia, qué se excluye y qué falta.
      const installation = (await db.query<{ value: string }>(`SELECT value FROM "InstallationMeta" WHERE key = 'installation_id'`)).rows[0]?.value ?? null;
      const plan = await phase("planificar", () => planStores(db, stores, installation, !!opts.acceptMissingOriginals));
      if (plan.problems.length) throw new BackupError(`Incoherencia entre la base y los archivos; no se crea la copia:\n${plan.problems.map((p) => `  - ${p}`).join("\n")}`, "COHERENCIA");
      for (const w of plan.warnings) log(`AVISO ${w}`);

      // 5) Espacio libre antes de empezar.
      const dbBytes = Number((await db.query<{ n: string }>("SELECT pg_database_size(current_database())::text AS n")).rows[0].n);
      const fileBytes = plan.files.reduce((a, f) => a + f.bytes, 0);
      const requiredBytes = Math.ceil((dbBytes + fileBytes) * 1.05) + 64 * 1024 * 1024;
      const free = await (opts.freeBytes ?? (() => freeBytesAt(destino)))();
      if (free < requiredBytes) throw new BackupError(`Espacio insuficiente en el destino: libres ${free} B y se estiman necesarios ${requiredBytes} B (base ${dbBytes} B + archivos ${fileBytes} B + margen). No se crea la copia.`, "ESPACIO");
      aborted();

      // 6) Destino temporal propio, fuera de los almacenes.
      await mkdir(tmp);
      tmpCreated = true;
      await mkdir(path.join(tmp, "db"));

      // 7) Controles, esquema y volcado.
      const facts = await phase("controles", () => collectSchemaFacts(db));
      if (facts.failedMigrations.length) throw new BackupError(`La base tiene migraciones fallidas o a medias (${facts.failedMigrations.join(", ")}): no se copia un esquema incierto.`, "ESQUEMA");
      if (facts.unvalidatedConstraints.length) throw new BackupError(`La base tiene restricciones sin validar (${facts.unvalidatedConstraints.join(", ")}): no se copia.`, "ESQUEMA");
      const controls = await phase("controles", () => collectControls(db));
      const dumpFile = path.join(tmp, "db", "csapp.dump");
      await phase("pg_dump", async () => {
        const r = await runTool(toolPath("pg_dump", env), ["-Fc", "--no-owner", "--no-acl", "--no-password", "--lock-wait-timeout=60000", "-f", dumpFile], conn, { env, signal: opts.signal });
        if (r.code !== 0) throw new BackupError(`pg_dump falló (código ${r.code}); no se crea la copia. ${redact(r.stderr, secrets).split("\n").find((l) => l.trim()) ?? ""}`.trim(), "PG_DUMP");
      });
      if (!(await isRegularFile(dumpFile)) || (await stat(dumpFile)).size === 0) throw new BackupError("pg_dump no produjo un volcado válido; no se crea la copia.", "PG_DUMP");
      await opts.hooks?.afterDump?.();
      aborted();

      // 8) Archivos: copia por bloques con SHA-256, comparando con lo que dice la base.
      const entries: FileEntry[] = [];
      const copyProblems: string[] = [];
      let n = 0;
      await phase("archivos", async () => {
        for (const f of plan.files) {
          aborted();
          const rel = `${f.store}/files/${f.storageId}`;
          const src = path.join(stores[f.store], "files", f.storageId);
          await mkdir(path.join(tmp, f.store, "files"), { recursive: true });
          const dst = path.join(tmp, f.store, "files", f.storageId);
          const h = await copyFileHashed(src, dst);
          if (f.expectBytes !== null && f.expectBytes !== h.bytes) copyProblems.push(`${rel}: ${h.bytes} B en el almacén y la base registra ${f.expectBytes} B`);
          else if (f.expectSha && f.expectSha.toLowerCase() !== h.sha256) copyProblems.push(`${rel}: el SHA-256 del archivo no coincide con el registrado en la base (archivo alterado o dañado)`);
          entries.push({ path: rel, bytes: h.bytes, sha256: h.sha256, kind: f.store });
          await opts.hooks?.afterFile?.(rel, ++n);
        }
        for (const store of ["uploads", "exports"] as const) {
          if (!plan.markers[store]) continue;
          await mkdir(path.join(tmp, store), { recursive: true });
          const h = await copyFileHashed(path.join(stores[store], STORE_MARKER), path.join(tmp, store, STORE_MARKER));
          entries.push({ path: `${store}/${STORE_MARKER}`, bytes: h.bytes, sha256: h.sha256, kind: "marker" });
        }
      });
      if (copyProblems.length) throw new BackupError(`Archivos que no coinciden con la base; no se crea la copia:\n${copyProblems.map((p) => `  - ${p}`).join("\n")}`, "COHERENCIA");

      // 9) Inventario de configuración (solo nombres), volcado y manifiesto.
      const cfgBody = JSON.stringify(buildConfigInventory(env), null, 2) + "\n";
      await writeFile(path.join(tmp, CONFIG_INVENTORY_FILE), cfgBody, { flag: "wx" });
      const dumpHash = await sha256File(dumpFile);
      const cfgHash = await sha256File(path.join(tmp, CONFIG_INVENTORY_FILE));
      entries.unshift({ path: DUMP_PATH, bytes: dumpHash.bytes, sha256: dumpHash.sha256, kind: "dump" }, { path: CONFIG_INVENTORY_FILE, bytes: cfgHash.bytes, sha256: cfgHash.sha256, kind: "config" });
      const bi = buildInfo();
      const sumOf = (s: Store) => ({ files: entries.filter((e) => e.kind === s).length, bytes: entries.filter((e) => e.kind === s).reduce((a, e) => a + e.bytes, 0) });
      const manifest: Manifest = {
        formatVersion: BACKUP_FORMAT,
        id,
        createdAt: new Date().toISOString(),
        app: { version: bi.version, sha: bi.sha, dirty: bi.dirty, builtAt: bi.builtAt, builtWithNode: bi.node },
        versions: { node: process.version, postgresServer: server.raw, postgresServerMajor: server.major, pgDump: dumpV.raw, pgDumpMajor: dumpV.major },
        installationId: installation,
        source: { host: conn.host.toLowerCase(), port: conn.port, database: conn.database },
        schema: { migrations: facts.migrations, failedMigrations: facts.failedMigrations, tables: facts.tables, foreignKeys: facts.foreignKeys, triggers: facts.triggers },
        controls: { tables: controls, groups: CONTROL_GROUPS },
        files: entries,
        stores: { uploads: { marker: plan.markerData.uploads ?? null, ...sumOf("uploads") }, exports: { marker: plan.markerData.exports ?? null, ...sumOf("exports") } },
        excluded: plan.excluded,
        warnings: plan.warnings,
        conditions: { stopped: true, webStoppedDeclared: !!opts.webStopped, checks: conditions },
      };
      await writeManifest(tmp, manifest);

      // 10) Verificación COMPLETA del temporal antes de publicar.
      const v = await phase("verificar", () => verifyBackup(tmp, { env, allowTemp: true }));
      if (!v.ok) throw new BackupError(`La verificación de la copia recién creada falló; no se publica:\n${v.checks.filter((c) => c.status === "FALLO").map((c) => `  - ${c.name}: ${c.detail}`).join("\n")}`, "VERIFICACION");

      // 11) Nada cambió durante la copia (las condiciones siguen y los recuentos coinciden); si no, no se publica.
      aborted();
      const again = await checkStopConditions(db, { webStopped: !!opts.webStopped, env, stateDir: opts.stateDir, ...opts.conditionDeps });
      if (!allOk(again)) throw new BackupError(`Durante la copia dejó de cumplirse la parada controlada; no se publica:\n${again.filter((c) => !c.ok).map((c) => `  - ${c.message}`).join("\n")}`, "CONDICIONES");
      const after = await collectControls(db, { countsOnly: true, tables: await listTables(db) });
      const drift = diffControls(Object.fromEntries(Object.entries(controls).map(([t, c]) => [t, { rows: c.rows, idSum: "", contentSum: "" }])), after);
      if (drift.length) throw new BackupError(`La base cambió durante la copia (${drift.map((d) => d.table).join(", ")}); no se publica.`, "CONDICIONES");
      await opts.hooks?.beforePublish?.();

      // 12) Publicación atómica por renombrado.
      await rename(tmp, finalDir);
      tmpCreated = false;
      timings.total = Date.now() - t0;
      const sum = (k: FileEntry["kind"]) => entries.filter((e) => e.kind === k).reduce((a, e) => a + e.bytes, 0);
      log(`Copia publicada: ${finalDir}`);
      return { id, dir: finalDir, manifest, checks: v.checks, bytes: { dump: dumpHash.bytes, uploads: sum("uploads"), exports: sum("exports"), total: entries.reduce((a, e) => a + e.bytes, 0) }, requiredBytes, timingsMs: timings, warnings: plan.warnings };
    });
  } catch (e) {
    if (e instanceof BackupError) throw new BackupError(redact(e.message, secrets), e.code);
    throw new BackupError(redact(e instanceof Error ? e.message : String(e), secrets), "ERROR");
  } finally {
    // Solo se limpia lo propio (el temporal de ESTA copia); jamás una copia publicada ni nada de los almacenes.
    if (tmpCreated) await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    await (lock as HeldLock | null)?.release().catch(() => undefined);
  }
}

// ---------------------------------------------------------------- Coherencia base ↔ archivos

type Plan = { files: Planned[]; excluded: Manifest["excluded"]; warnings: string[]; problems: string[]; markers: Record<Store, boolean>; markerData: Partial<Record<Store, unknown>> };

export async function planStores(db: Client, stores: Record<Store, string>, installationId: string | null, acceptMissing: boolean): Promise<Plan> {
  const plan: Plan = { files: [], excluded: [], warnings: [], problems: [], markers: { uploads: false, exports: false }, markerData: {} };
  const exclude = (store: Store, p: string, reason: string) => plan.excluded.push({ store, path: p, reason });

  const batches = (await db.query<{ storageId: string; status: string; checksum: string | null; size: string }>(`SELECT "storageId", status::text AS status, checksum, "sizeBytes"::text AS size FROM "UploadBatch"`)).rows;
  const efiles = (await db.query<{ storageId: string; bytes: string; checksum: string; status: string; expired: boolean }>(
    `SELECT f."storageId", f.bytes::text AS bytes, f.checksum, j.status::text AS status, (j."expiresAt" IS NOT NULL AND j."expiresAt" < now()) AS expired FROM "ExportFile" f JOIN "ExportJob" j ON j.id = f."jobId"`,
  )).rows;

  for (const store of ["uploads", "exports"] as const) {
    const dir = stores[store];
    const st = await stat(dir).catch(() => null);
    const label = store === "uploads" ? "originales" : "exportaciones";
    const referenced = store === "uploads"
      ? new Map(batches.map((b) => [b.storageId, { required: REQUIRED_UPLOAD_STATUSES.has(b.status), sha: b.checksum, bytes: b.checksum ? Number(b.size) : null, note: b.status }]))
      : new Map(efiles.map((f) => [f.storageId, { required: f.status === "READY", sha: f.checksum, bytes: Number(f.bytes), note: f.status === "READY" && f.expired ? "READY caducada pendiente de barrido: se copia por coherencia con el estado de la base (no se amplía su vida útil)" : f.status }]));
    if (!st?.isDirectory()) {
      const missingReq = [...referenced].filter(([, r]) => r.required).map(([id]) => id);
      if (missingReq.length) plan.problems.push(`El almacén de ${label} (${dir}) no existe y la base referencia ${missingReq.length} archivo(s).`);
      else plan.warnings.push(`El almacén de ${label} no existe: no hay archivos que copiar.`);
      continue;
    }
    // Marca de instalación: si existe y es de otra instalación, es la carpeta equivocada.
    const marker = await readMarker(dir);
    if (marker) {
      if (installationId && marker.installationId !== installationId) plan.problems.push(`El almacén de ${label} pertenece a otra instalación (marca ${String(marker.installationId).slice(0, 8)}… ≠ ${installationId.slice(0, 8)}…): carpeta equivocada.`);
      else if (marker.kind !== store) plan.problems.push(`La marca del almacén de ${label} es de otra clase (${String(marker.kind)}).`);
      else { plan.markers[store] = true; plan.markerData[store] = marker; }
    } else plan.warnings.push(`El almacén de ${label} no tiene marca de instalación (.csapp-store.json): se copia sin ella.`);

    const present = new Set<string>();
    for (const e of await scanDir(dir)) {
      if (e.name === STORE_MARKER) continue;
      if (e.name === "files" && e.kind === "dir") continue;
      const rel = e.name;
      if (e.kind === "symlink") { exclude(store, rel, "enlace simbólico (no se sigue)"); plan.warnings.push(`${label}: «${rel}» es un enlace simbólico en la raíz del almacén; se ignora (no se sigue).`); }
      else if ((e.name === "tmp" || e.name === "incoming") && e.kind === "dir") {
        const inner = await scanDir(path.join(dir, e.name));
        exclude(store, `${rel}/`, `temporal (${inner.length} elemento(s)): trabajo en vuelo o intento caído; no forma parte del estado restaurado`);
      } else if (e.name.startsWith(".sonda-")) exclude(store, rel, "sonda de comprobación de acceso");
      else { exclude(store, rel, "elemento desconocido del almacén (no referenciado por la base)"); plan.warnings.push(`${label}: elemento desconocido «${rel}» no copiado.`); }
    }
    for (const e of await scanDir(path.join(dir, "files"))) {
      if (e.kind !== "file") { exclude(store, `files/${e.name}`, e.kind === "symlink" ? "enlace simbólico (no se sigue)" : "no es un archivo regular"); plan.warnings.push(`${label}: «files/${e.name}» es ${e.kind === "symlink" ? "un enlace simbólico" : "un elemento no regular"}; se ignora.`); continue; }
      if (!UUID.test(e.name)) { exclude(store, `files/${e.name}`, "nombre no reconocido (no es un identificador interno)"); plan.warnings.push(`${label}: «files/${e.name}» no tiene nombre de identificador interno; no se copia.`); continue; }
      present.add(e.name);
    }
    const missing: string[] = [];
    for (const [sid, r] of referenced) {
      if (!UUID.test(sid)) { plan.problems.push(`${label}: identificador de archivo no válido en la base («${sid.slice(0, 40)}»).`); continue; }
      if (present.has(sid)) {
        const s = await stat(path.join(dir, "files", sid));
        plan.files.push({ store, storageId: sid, bytes: s.size, expectSha: r.sha, expectBytes: r.bytes });
        present.delete(sid);
        if (r.note.startsWith("READY caducada")) plan.warnings.push(`exportación ${sid}: ${r.note}.`);
      } else if (r.required) missing.push(`${sid} (${r.note})`);
    }
    if (missing.length) {
      if (acceptMissing && store === "uploads") {
        plan.warnings.push(`ACEPTADO por la persona operadora: ${missing.length} original(es) referenciado(s) ausente(s) del almacén: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""}.`);
        for (const m of missing) exclude(store, `files/${m.split(" ")[0]}`, "original referenciado ausente (aceptado explícitamente)");
      } else plan.problems.push(`${label}: ${missing.length} archivo(s) referenciado(s) por la base AUSENTE(S) del almacén: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""}.`);
    }
    for (const orphan of [...present].sort()) exclude(store, `files/${orphan}`, "huérfano: ninguna fila de la base lo referencia; no forma parte del estado restaurado");
  }
  plan.files.sort((a, b) => (a.store + a.storageId).localeCompare(b.store + b.storageId));
  return plan;
}
