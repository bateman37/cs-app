import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Client } from "pg";
import { appRoot } from "@/lib/runtime";
import { TEST_DB_PATTERN, assertConnectedTo, describeTarget, parseTarget, sameTarget, type DbTarget } from "@/lib/test-guard";
import { exportConfig } from "@/server/exports/config";
import { uploadConfig } from "@/server/uploads/config";
import { CONTROL_GROUPS, collectControls, collectSchemaFacts, diffControls, prepareSession } from "./controls";
import { copyFileHashed, freeBytesAt, isWithinReal, resolveInside, sha256File } from "./fsutil";
import { DUMP_PATH, compareMigrations, schemaCompatMessage, type Manifest, type SchemaCompat } from "./manifest";
import { BackupError, parsePgUrl, runTool, serverVersion, toolPath, withClient, withDatabase, type PgConn } from "./pgtools";
import { acquireBackupLock, type HeldLock } from "./lock";
import { redact, secretsFrom } from "./redact";
import { verifyBackup, type Check, expectedMigrations } from "./verify";
import { STORE_MARKER, type StoreMarker } from "../stores";
import { stateDir } from "../runfile";

/**
 * Restaurar una copia en una base y carpetas NUEVAS, vacías y aisladas (CSAPP-10 §8). Todo se valida ANTES de mutar nada: manifiesto, integridad completa,
 * compatibilidad, destino (identidad, nombre, base vacía, carpetas vacías y separadas del origen y de la aplicación). Nunca `--clean`, `DROP DATABASE`,
 * `TRUNCATE` ni reinicios para hacer sitio. Tras `pg_restore` no basta el código de salida: se comprueban migraciones, recuentos, identidades y contenido por
 * tabla frente al manifiesto, relaciones, revisiones inmutables y archivos. No arranca trabajadores ni usa conexiones al origen.
 */
export class RestoreRejected extends Error {
  constructor(public readonly problems: string[]) {
    super(`Restauración rechazada ANTES de modificar nada:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "RestoreRejected";
  }
}

export type RestoreOptions = {
  backup: string;
  /** Base destino (URL con credenciales; nunca se imprime). */
  dbUrl: string;
  uploads: string;
  exports: string;
  /** Ensayo / nueva identidad: nuevo installationId, marcas reescritas y sesiones invalidadas. Obligatorio para un ensayo. */
  nuevoOrigen?: boolean;
  normalizarTrabajos?: boolean;
  permitirEsquemaAnterior?: boolean;
  /** Origen operativo (DATABASE_URL) y carpetas del origen, para rechazar un destino que coincida con ellos. */
  originUrl?: string;
  originDirs?: { uploads: string; exports: string };
  env?: Record<string, string | undefined>;
  stateDir?: string;
  log?: (m: string) => void;
  hooks?: { afterRestore?: () => Promise<void> | void; afterCopy?: () => Promise<void> | void };
  freeBytes?: (dir: string) => Promise<number>;
};

export type RestoreReport = {
  ok: boolean;
  backupId: string;
  manifestSha256: string;
  schemaCompat: SchemaCompat;
  destination: { target: string; createdDatabase: boolean; effectiveDatabase: string; serverVersion: string };
  dirs: { uploads: string; exports: string };
  checks: Check[];
  filesCopied: { uploads: { files: number; bytes: number }; exports: { files: number; bytes: number } };
  nuevoOrigen: null | { previousInstallationId: string | null; newInstallationId: string; sessionsRemoved: number; verificationsRemoved: number; markersRewritten: string[]; secretNote: string };
  jobs: { inheritedLeases: { kind: string; id: string; status: string; leaseOwner: string | null; leaseExpiresAt: string | null }[]; normalized: boolean };
  warnings: string[];
  controlGroups: Record<string, { tables: string[]; rows: number }>;
  timingsMs: Record<string, number>;
};

const FORBIDDEN_PARAMS = ["host", "hostaddr", "port", "dbname", "database", "service", "options", "user", "target_session_attrs"];
const OPERATIONAL_PATTERN = /^cs_app(_[a-z0-9]+)+$/;
const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

/** Reglas de la base destino que no necesitan conexión (puras y probadas). Devuelve los problemas. */
export function checkTargetName(dbUrl: string, opts: { nuevoOrigen: boolean; originUrl?: string; manifest?: Manifest }): { problems: string[]; target: DbTarget | null } {
  const problems: string[] = [];
  const target = parseTarget(dbUrl);
  if (!target) return { problems: ["--db-url no es una URL postgresql://usuario:clave@host:puerto/base válida."], target: null };
  let u: URL | null = null;
  try { u = new URL(dbUrl); } catch { /* ya cubierto */ }
  for (const k of FORBIDDEN_PARAMS) if (u?.searchParams.has(k)) problems.push(`--db-url no admite el parámetro «${k}»: podría redirigir la conexión a otra base.`);
  if (target.name === "cs_app") problems.push("La base destino no puede llamarse cs_app (nombre de la base operativa).");
  else if (opts.nuevoOrigen) {
    if (!TEST_DB_PATTERN.test(target.name)) problems.push(`Un ensayo (--nuevo-origen) exige una base cs_app…_test; recibido: ${target.name}.`);
  } else if (!OPERATIONAL_PATTERN.test(target.name)) problems.push(`El nombre de la base destino debe ser cs_app_<algo> (distinto del origen); recibido: ${target.name}.`);
  if (opts.originUrl) {
    const o = parseTarget(opts.originUrl);
    if (o && sameTarget(o, target)) problems.push(`La base destino es la MISMA que el origen operativo (DATABASE_URL: ${describeTarget(o)}).`);
    else if (o && o.name === target.name) problems.push(`La base destino tiene el mismo nombre que la del origen operativo (${o.name}), aunque sea en otro servidor: use otro nombre.`);
  }
  const s = opts.manifest?.source;
  if (s && s.database === target.name && s.port === target.port && s.host === target.host) problems.push(`La base destino es la misma de la que se creó la copia (${s.host}:${s.port}/${s.database}).`);
  return { problems, target };
}

async function isEmptyDirectory(dir: string): Promise<"no-existe" | "vacia" | "con-datos" | "no-es-directorio"> {
  const st = await lstat(dir).catch(() => null);
  if (!st) return "no-existe";
  if (!st.isDirectory() || st.isSymbolicLink()) return "no-es-directorio";
  return (await readdir(dir)).length === 0 ? "vacia" : "con-datos";
}

/** Reglas de las carpetas destino. */
export async function checkTargetDirs(o: { uploads: string; exports: string; backup: string; originDirs?: { uploads: string; exports: string } }): Promise<string[]> {
  const problems: string[] = [];
  for (const [name, dir] of [["--uploads", o.uploads], ["--exports", o.exports]] as const) {
    if (!path.isAbsolute(dir)) { problems.push(`${name} debe ser una ruta absoluta (${dir}).`); continue; }
    const st = await isEmptyDirectory(dir);
    if (st === "con-datos") problems.push(`${name} (${dir}) no está vacía: la restauración solo escribe en carpetas nuevas o vacías.`);
    if (st === "no-es-directorio") problems.push(`${name} (${dir}) existe pero no es un directorio (o es un enlace simbólico).`);
  }
  if (problems.length) return problems;
  if ((await isWithinReal(o.uploads, o.exports)) || (await isWithinReal(o.exports, o.uploads))) problems.push("--uploads y --exports deben ser carpetas distintas y no estar una dentro de la otra.");
  const avoid: [string, string][] = [["la carpeta de la aplicación", appRoot()], ["la copia (backup)", o.backup]];
  if (o.originDirs) avoid.push(["el almacén de originales del origen", o.originDirs.uploads], ["el almacén de exportaciones del origen", o.originDirs.exports]);
  for (const [name, dir] of [["--uploads", o.uploads], ["--exports", o.exports]] as const) {
    for (const [what, other] of avoid) {
      if ((await isWithinReal(dir, other)) || (await isWithinReal(other, dir))) problems.push(`${name} (${dir}) está dentro de ${what} (${other}) o la contiene: se rechaza.`);
    }
  }
  return problems;
}

type DestState = { exists: boolean; effectiveDatabase?: string; serverVersion?: string };

/** Inspección SOLO de lectura del destino con una conexión propia. Rechaza una base existente con cualquier objeto de usuario. */
async function inspectDestination(conn: PgConn, target: DbTarget, nuevoOrigen: boolean, manifest: Manifest, problems: string[]): Promise<DestState> {
  // ¿Existe la base? Se pregunta al servidor por la base de mantenimiento.
  const exists = await withClient(withDatabase(conn, "postgres"), async (admin) => {
    const r = await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM pg_database WHERE datname = $1", [target.name]);
    const me = await admin.query<{ ok: boolean }>("SELECT (rolcreatedb OR rolsuper) AS ok FROM pg_roles WHERE rolname = current_user");
    const sv = await serverVersion(admin);
    if (sv.major < manifest.versions.postgresServerMajor) problems.push(`El servidor destino es PostgreSQL ${sv.raw}, anterior al de la copia (${manifest.versions.postgresServer}): no se restaura en un servidor más antiguo.`);
    if (r.rows[0].n === "0" && !me.rows[0]?.ok) problems.push("La base destino no existe y el usuario no tiene permiso CREATEDB para crearla.");
    return r.rows[0].n !== "0";
  });
  if (!exists) return { exists: false };
  return withClient(conn, async (c) => {
    const id = await c.query<{ db: string; port: number | null }>("SELECT current_database() AS db, inet_server_port() AS port");
    const eff = id.rows[0];
    if (eff.db !== target.name) problems.push(`La conexión efectiva está en «${eff.db}» y el destino pedido es «${target.name}».`);
    if (eff.port !== null && String(eff.port) !== target.port) problems.push(`La conexión efectiva usa el puerto ${eff.port} y --db-url indica ${target.port}.`);
    if (nuevoOrigen) {
      try { await assertConnectedTo({ $queryRawUnsafe: async <T>(sql: string) => (await c.query(sql)).rows as T }, target.name); } catch (e) { problems.push(e instanceof Error ? e.message : "El guard de pruebas rechazó la conexión."); }
    }
    const objs = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')`,
    );
    if (Number(objs.rows[0].n) > 0) problems.push(`La base destino «${target.name}» ya existe y contiene ${objs.rows[0].n} objeto(s) de usuario (tablas/secuencias/vistas): solo se restaura en una base nueva o completamente vacía. No se vacía ni se borra nada para hacer sitio.`);
    const sv = await serverVersion(c);
    return { exists: true, effectiveDatabase: eff.db, serverVersion: sv.raw };
  });
}

export async function restoreBackup(opts: RestoreOptions): Promise<RestoreReport> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? (() => undefined);
  const timings: Record<string, number> = {};
  const phase = async <T>(name: string, fn: () => Promise<T>): Promise<T> => { const s = Date.now(); try { return await fn(); } finally { timings[name] = (timings[name] ?? 0) + Date.now() - s; } };
  const warnings: string[] = [];
  const backup = path.resolve(opts.backup);
  const secrets = secretsFrom([opts.dbUrl, opts.originUrl], env);
  let conn: PgConn;
  try { conn = parsePgUrl(opts.dbUrl); } catch (e) { throw new RestoreRejected([e instanceof Error ? e.message : "--db-url no válida"]); }
  const originDirs = opts.originDirs ?? { uploads: uploadConfig().dir, exports: exportConfig().dir };

  // ---- 1) Validación completa, SIN mutar nada (integridad, compatibilidad, destino).
  const v = await phase("verificar", () => verifyBackup(backup, { env }));
  const manifest = v.manifest;
  if (!v.ok || !manifest) throw new RestoreRejected([`La copia no supera la verificación:\n${v.checks.filter((c) => c.status === "FALLO").map((c) => `    · ${c.name}: ${c.detail}`).join("\n")}`]);
  const problems: string[] = [];
  const code = await expectedMigrations();
  const cmp = compareMigrations(manifest.schema.migrations, code);
  if (code.length && cmp.compat === "anterior" && !opts.permitirEsquemaAnterior) problems.push(`${schemaCompatMessage(cmp)} Repita con --permitir-esquema-anterior si va a aplicar las migraciones después de restaurar.`);
  if (code.length && (cmp.compat === "posterior" || cmp.compat === "divergente")) problems.push(schemaCompatMessage(cmp));
  const nuevoOrigen = !!opts.nuevoOrigen;
  const named = checkTargetName(opts.dbUrl, { nuevoOrigen, originUrl: opts.originUrl ?? env.DATABASE_URL, manifest });
  problems.push(...named.problems);
  problems.push(...(await checkTargetDirs({ uploads: opts.uploads, exports: opts.exports, backup, originDirs })));
  let dest: DestState = { exists: false };
  if (named.target && !named.problems.length) {
    try { dest = await phase("inspeccionar", () => inspectDestination(conn, named.target!, nuevoOrigen, manifest, problems)); } catch (e) { problems.push(redact(e instanceof Error ? e.message : String(e), secrets)); }
  }
  // Espacio de las carpetas destino.
  const need = (k: "uploads" | "exports") => manifest.files.filter((f) => f.kind === k || (f.kind === "marker" && f.path.startsWith(`${k}/`))).reduce((a, f) => a + f.bytes, 0);
  for (const k of ["uploads", "exports"] as const) {
    const target = k === "uploads" ? opts.uploads : opts.exports;
    if (path.isAbsolute(target)) {
      const free = await (opts.freeBytes ?? freeBytesAt)(target).catch(() => null);
      if (free !== null && free < need(k) * 1.05 + 1024 * 1024) problems.push(`Espacio insuficiente para ${k} en ${target}: libres ${free} B, necesarios ≈ ${need(k)} B.`);
    }
  }
  if (problems.length) throw new RestoreRejected(problems.map((p) => redact(p, secrets)));
  const target = named.target!;
  log(`Validación completa superada (${v.checks.length} comprobaciones). Destino ${describeTarget(target)}${dest.exists ? " (existe y está vacío)" : " (se creará)"}.`);

  // ---- 2) Mutación: bloqueo, base (CREATE DATABASE solo si no existe y el nombre pasó el guard), pg_restore, comprobaciones, archivos.
  let lock: HeldLock | null = null;
  try {
    lock = await acquireBackupLock("restaurar", opts.stateDir ?? stateDir(env));
    let created = false;
    if (!dest.exists) {
      if (!(nuevoOrigen ? TEST_DB_PATTERN.test(target.name) : OPERATIONAL_PATTERN.test(target.name)) || target.name === "cs_app") throw new BackupError("Nombre de base destino no válido (guard).", "DESTINO");
      await withClient(withDatabase(conn, "postgres"), (admin) => admin.query(`CREATE DATABASE ${q(target.name)}`));
      created = true;
      log(`Base ${target.name} creada.`);
    }
    const dumpFile = path.join(backup, ...DUMP_PATH.split("/"));
    await phase("pg_restore", async () => {
      // Transacción única: o entra todo o no entra nada. Sin --clean. Propietarios y permisos de origen no se reproducen.
      const r = await runTool(toolPath("pg_restore", env), ["--no-owner", "--no-acl", "--no-password", "--exit-on-error", "--single-transaction", "-d", target.name, dumpFile], conn, { env, timeoutMs: 60 * 60_000 });
      if (r.code !== 0) throw new BackupError(`pg_restore falló (código ${r.code}); con --single-transaction la base ${created ? "creada quedó vacía" : "no se modificó"}. ${r.stderr.split("\n").find((l) => l.trim()) ?? ""}`.trim(), "PG_RESTORE");
    });
    await opts.hooks?.afterRestore?.();

    const checks: Check[] = [...v.checks];
    const add = (name: string, status: Check["status"], detail: string) => { checks.push({ name, status, detail }); log(`[${status}] ${name}: ${detail}`); };
    const report = await withClient(conn, async (db) => {
      await prepareSession(db);
      const effective = (await db.query<{ db: string }>("SELECT current_database() AS db")).rows[0].db;
      if (effective !== target.name) throw new BackupError(`La conexión de verificación está en «${effective}», no en ${target.name}.`, "DESTINO");
      add("destino", "OK", `Conexión efectiva en ${effective} (${describeTarget(target)}); no es el origen operativo ni cs_app.`);

      // Esquema y contenido frente al manifiesto.
      const facts = await phase("comprobar-db", () => collectSchemaFacts(db));
      const sameMig = JSON.stringify(facts.migrations) === JSON.stringify(manifest.schema.migrations);
      add("migraciones aplicadas", sameMig ? "OK" : "FALLO", sameMig ? `${facts.migrations.length} migraciones aplicadas, idénticas al manifiesto.` : `Las migraciones aplicadas difieren del manifiesto (${facts.migrations.length} frente a ${manifest.schema.migrations.length}).`);
      const controls = await phase("comprobar-db", () => collectControls(db));
      const diffs = diffControls(manifest.controls.tables, controls);
      const rows = Object.values(controls).reduce((a, c) => a + c.rows, 0);
      add("recuentos, identidades y contenido", diffs.length ? "FALLO" : "OK", diffs.length ? `${diffs.length} diferencia(s): ${diffs.slice(0, 6).map((d) => `${d.table}.${d.field}`).join(", ")}` : `${Object.keys(controls).length} tablas, ${rows} filas: recuento, suma de identidades y suma de contenido iguales al manifiesto.`);
      const trgOk = JSON.stringify(facts.triggers) === JSON.stringify(manifest.schema.triggers);
      add("disparadores", trgOk ? "OK" : "FALLO", trgOk ? `${facts.triggers.length} disparadores presentes (${facts.triggers.filter((t) => t.startsWith("ConfigRevision.")).join(", ") || "sin ConfigRevision"}).` : `Los disparadores difieren: esperados ${manifest.schema.triggers.join(", ")}; hay ${facts.triggers.join(", ")}.`);
      const fkOk = facts.foreignKeys === manifest.schema.foreignKeys && facts.unvalidatedConstraints.length === 0 && facts.tables === manifest.schema.tables;
      add("relaciones", fkOk ? "OK" : "FALLO", fkOk ? `${facts.foreignKeys} claves foráneas, todas validadas; ${facts.tables} tablas.` : `Claves foráneas ${facts.foreignKeys}/${manifest.schema.foreignKeys}, sin validar: ${facts.unvalidatedConstraints.join(", ") || "ninguna"}, tablas ${facts.tables}/${manifest.schema.tables}.`);
      const orphans = await orphanForeignKeys(db);
      add("integridad referencial", orphans.length ? "FALLO" : "OK", orphans.length ? `Filas huérfanas: ${orphans.join("; ")}` : "Ninguna fila huérfana en las relaciones de ExportFile, UploadJob, UploadBatch y ConfigRevision.");
      const im = await immutabilityResult(db, controls);
      add(im.name, im.status, im.detail);

      // Lotes activos y colas pendientes (informativo; la igualdad exacta ya está en el contenido por tabla).
      const act = await db.query<{ status: string; n: string }>(`SELECT status::text, count(*)::text AS n FROM "UploadBatch" GROUP BY 1 ORDER BY 1`);
      add("lotes", "OK", `Lotes por estado: ${act.rows.map((r) => `${r.status}=${r.n}`).join(", ") || "ninguno"}.`);
      const exp = await db.query<{ status: string; n: string }>(`SELECT status::text, count(*)::text AS n FROM "ExportJob" GROUP BY 1 ORDER BY 1`);
      add("exportaciones", "OK", `Trabajos de exportación por estado: ${exp.rows.map((r) => `${r.status}=${r.n}`).join(", ") || "ninguno"}.`);
      return { facts, controls };
    });

    // Archivos: copia por bloques al destino nuevo y comprobación de SHA-256 frente al manifiesto.
    const copied = { uploads: { files: 0, bytes: 0 }, exports: { files: 0, bytes: 0 } };
    const bad: string[] = [];
    await phase("archivos", async () => {
      for (const k of ["uploads", "exports"] as const) await mkdir(k === "uploads" ? opts.uploads : opts.exports, { recursive: true });
      for (const f of manifest.files) {
        if (f.kind !== "uploads" && f.kind !== "exports" && f.kind !== "marker") continue;
        const store = f.path.split("/")[0] as "uploads" | "exports";
        const baseDir = store === "uploads" ? opts.uploads : opts.exports;
        const rel = f.path.split("/").slice(1).join("/");
        const src = await resolveInside(backup, f.path);
        const dst = await resolveInside(baseDir, rel);
        await mkdir(path.dirname(dst), { recursive: true });
        const h = await copyFileHashed(src, dst);
        if (h.sha256 !== f.sha256 || h.bytes !== f.bytes) bad.push(`${f.path}: copia ≠ manifiesto`);
        if (f.kind !== "marker") { copied[store].files++; copied[store].bytes += h.bytes; }
      }
    });
    add("archivos copiados", bad.length ? "FALLO" : "OK", bad.length ? bad.join("; ") : `originales: ${copied.uploads.files} archivos / ${copied.uploads.bytes} B; exportaciones: ${copied.exports.files} archivos / ${copied.exports.bytes} B; SHA-256 de lo copiado = manifiesto.`);
    await opts.hooks?.afterCopy?.();

    // Base ↔ archivos restaurados.
    const rel = await withClient(conn, (db) => checkFilesAgainstDb(db, opts.uploads, opts.exports, manifest));
    add("base y archivos", rel.problems.length ? "FALLO" : "OK", rel.problems.length ? rel.problems.slice(0, 6).join("; ") : rel.detail);

    // Trabajos con lease heredado.
    const jobs: RestoreReport["jobs"] = { inheritedLeases: [], normalized: false };
    await withClient(conn, async (db) => {
      jobs.inheritedLeases = await inheritedLeases(db);
      if (jobs.inheritedLeases.length && opts.normalizarTrabajos) {
        // Normalización EXPLÍCITA y registrada: solo caduca el lease (el trabajador reclamará y retomará); nunca se marca nada como completado.
        await db.query(`UPDATE "UploadJob" SET "leaseExpiresAt" = now() - interval '1 second' WHERE status = 'RUNNING' AND "leaseExpiresAt" > now()`);
        await db.query(`UPDATE "ExportJob" SET "leaseExpiresAt" = now() - interval '1 second' WHERE status IN ('PREPARING', 'GENERATING') AND "leaseExpiresAt" > now()`);
        jobs.normalized = true;
        warnings.push(`NORMALIZADOS ${jobs.inheritedLeases.length} trabajo(s) con lease heredado (solo se caducó el lease; ningún trabajo se marcó como completado): ${jobs.inheritedLeases.map((j) => `${j.kind}:${j.id}`).join(", ")}.`);
      } else if (jobs.inheritedLeases.length) warnings.push(`Hay ${jobs.inheritedLeases.length} trabajo(s) con lease vigente heredado de la copia; no se tocan sin --normalizar-trabajos (el lease caducará solo): ${jobs.inheritedLeases.map((j) => `${j.kind}:${j.id}`).join(", ")}.`);
    });
    add("trabajos heredados", "OK", jobs.inheritedLeases.length ? `${jobs.inheritedLeases.length} con lease vigente (${jobs.normalized ? "normalizados de forma explícita" : "sin tocar"}).` : "Ninguno con lease vigente; la cola pendiente se conserva y la retomará el trabajador cuando se arranque (no se arranca aquí).");

    // Nueva identidad (ensayo).
    let nuevo: RestoreReport["nuevoOrigen"] = null;
    if (nuevoOrigen) {
      nuevo = await phase("nuevo-origen", () => applyNuevoOrigen(conn, opts.uploads, opts.exports, manifest));
      add("nuevo origen", "OK", `installationId ${nuevo.previousInstallationId ?? "(ninguno)"} → ${nuevo.newInstallationId}; ${nuevo.sessionsRemoved} sesión(es) y ${nuevo.verificationsRemoved} verificación(es) pendientes eliminadas; marcas reescritas: ${nuevo.markersRewritten.join(", ")}.`);
    } else warnings.push("Restauración SIN --nuevo-origen: conserva la identidad y las sesiones del origen; no la use a la vez que el origen.");

    const failed = checks.filter((c) => c.status === "FALLO");
    const groups = Object.fromEntries(Object.entries(CONTROL_GROUPS).map(([g, tables]) => [g, { tables, rows: tables.reduce((a, t) => a + (report.controls[t]?.rows ?? 0), 0) }]));
    return {
      ok: failed.length === 0,
      backupId: manifest.id,
      manifestSha256: v.manifestSha256!,
      schemaCompat: cmp.compat,
      destination: { target: describeTarget(target), createdDatabase: created, effectiveDatabase: target.name, serverVersion: dest.serverVersion ?? manifest.versions.postgresServer },
      dirs: { uploads: opts.uploads, exports: opts.exports },
      checks,
      filesCopied: copied,
      nuevoOrigen: nuevo,
      jobs,
      warnings,
      controlGroups: groups,
      timingsMs: timings,
    } satisfies RestoreReport;
  } catch (e) {
    throw new BackupError(redact(e instanceof Error ? e.message : String(e), secrets), e instanceof BackupError ? e.code : "ERROR");
  } finally {
    await (lock as HeldLock | null)?.release().catch(() => undefined);
  }
}

// ---------------------------------------------------------------- Comprobaciones sobre la base restaurada

async function orphanForeignKeys(db: Client): Promise<string[]> {
  const probes: [string, string][] = [
    ["ExportFile sin ExportJob", `SELECT count(*)::int AS n FROM "ExportFile" f LEFT JOIN "ExportJob" j ON j.id = f."jobId" WHERE j.id IS NULL`],
    ["UploadJob sin UploadBatch", `SELECT count(*)::int AS n FROM "UploadJob" t LEFT JOIN "UploadBatch" b ON b.id = t."batchId" WHERE b.id IS NULL`],
    ["UploadBatch sin autor", `SELECT count(*)::int AS n FROM "UploadBatch" t LEFT JOIN "User" u ON u.id = t."createdById" WHERE u.id IS NULL`],
    ["ConfigRevision con autor inexistente", `SELECT count(*)::int AS n FROM "ConfigRevision" t LEFT JOIN "User" u ON u.id = t."activatedById" WHERE t."activatedById" IS NOT NULL AND u.id IS NULL`],
    ["ExportJob sin propietario", `SELECT count(*)::int AS n FROM "ExportJob" t LEFT JOIN "User" u ON u.id = t."ownerId" WHERE u.id IS NULL`],
  ];
  const out: string[] = [];
  for (const [label, sql] of probes) {
    try { const r = await db.query<{ n: number }>(sql); if (r.rows[0].n > 0) out.push(`${label}: ${r.rows[0].n}`); } catch { /* columna distinta en otra versión de esquema: la validación de claves ya lo cubre */ }
  }
  return out;
}

/** Las revisiones de configuración siguen siendo inmutables en la base restaurada: disparador presente y una modificación real es rechazada (en una transacción que se revierte). */
async function immutabilityResult(db: Client, controls: Record<string, { rows: number }>): Promise<Check> {
  const trg = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relname = 'ConfigRevision' AND t.tgname = 'ConfigRevision_immutable' AND NOT t.tgisinternal`);
  if (trg.rows[0].n === "0") return { name: "revisiones inmutables", status: "FALLO", detail: "Falta el disparador ConfigRevision_immutable." };
  const rows = controls["ConfigRevision"]?.rows ?? 0;
  if (rows === 0) return { name: "revisiones inmutables", status: "AVISO", detail: "Disparador presente, pero no hay ConfigRevision que probar." };
  await db.query("BEGIN");
  try {
    let rejected = false;
    try { await db.query(`UPDATE "ConfigRevision" SET id = id WHERE ctid = (SELECT ctid FROM "ConfigRevision" LIMIT 1)`); } catch (e) { rejected = (e as { code?: string }).code === "23514"; }
    if (rejected) { await db.query("ROLLBACK"); return { name: "revisiones inmutables", status: "OK", detail: `${rows} ConfigRevision intactas (contenido = manifiesto); el disparador está presente y rechaza una modificación (probado en una transacción revertida).` }; }
    await db.query("ROLLBACK");
    return { name: "revisiones inmutables", status: "FALLO", detail: "Una modificación de ConfigRevision NO fue rechazada." };
  } catch (e) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw e;
  }
}

async function inheritedLeases(db: Client): Promise<RestoreReport["jobs"]["inheritedLeases"]> {
  const u = await db.query(`SELECT 'carga' AS kind, id, status::text AS status, "leaseOwner", "leaseExpiresAt" FROM "UploadJob" WHERE status = 'RUNNING' AND "leaseExpiresAt" > now()`);
  const e = await db.query(`SELECT 'exportacion' AS kind, id, status::text AS status, "leaseOwner", "leaseExpiresAt" FROM "ExportJob" WHERE status IN ('PREPARING', 'GENERATING') AND "leaseExpiresAt" > now()`);
  return [...u.rows, ...e.rows].map((r) => ({ kind: r.kind, id: r.id, status: r.status, leaseOwner: r.leaseOwner, leaseExpiresAt: r.leaseExpiresAt ? new Date(r.leaseExpiresAt).toISOString() : null }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REQUIRED_UPLOAD_STATUSES = ["QUEUED", "PREPARING", "READY", "ACTIVATION_QUEUED", "ACTIVATING", "COMPLETED", "REVERTED"];

/** Todo archivo referenciado por la base restaurada existe en el almacén restaurado con el checksum registrado; ningún ExportFile apunta a un archivo inexistente. */
async function checkFilesAgainstDb(db: Client, uploads: string, exports: string, manifest: Manifest): Promise<{ problems: string[]; detail: string }> {
  const problems: string[] = [];
  const acceptedMissing = new Set(manifest.excluded.filter((e) => e.reason.startsWith("original referenciado ausente")).map((e) => e.path.replace("files/", "")));
  let checked = 0;
  const b = await db.query<{ storageId: string; status: string; checksum: string | null }>(`SELECT "storageId", status::text AS status, checksum FROM "UploadBatch" WHERE status::text = ANY ($1)`, [REQUIRED_UPLOAD_STATUSES]);
  for (const r of b.rows) {
    if (!UUID.test(r.storageId)) { problems.push(`lote con identificador de archivo no válido`); continue; }
    if (acceptedMissing.has(r.storageId)) continue;
    const f = path.join(uploads, "files", r.storageId);
    const h = await sha256File(f).catch(() => null);
    checked++;
    if (!h) problems.push(`original ${r.storageId} (${r.status}) ausente`);
    else if (r.checksum && h.sha256 !== r.checksum.toLowerCase()) problems.push(`original ${r.storageId}: SHA-256 distinto del registrado`);
  }
  const x = await db.query<{ storageId: string; checksum: string; status: string }>(`SELECT f."storageId", f.checksum, j.status::text AS status FROM "ExportFile" f JOIN "ExportJob" j ON j.id = f."jobId"`);
  for (const r of x.rows) {
    if (!UUID.test(r.storageId)) { problems.push(`exportación con identificador de archivo no válido`); continue; }
    const h = await sha256File(path.join(exports, "files", r.storageId)).catch(() => null);
    checked++;
    if (!h) problems.push(`ExportFile ${r.storageId} (${r.status}) apunta a un archivo inexistente`);
    else if (h.sha256 !== r.checksum.toLowerCase()) problems.push(`ExportFile ${r.storageId}: SHA-256 distinto del registrado`);
  }
  const readyNoFile = await db.query<{ id: string }>(`SELECT j.id FROM "ExportJob" j WHERE j.status = 'READY' AND NOT EXISTS (SELECT 1 FROM "ExportFile" f WHERE f."jobId" = j.id)`);
  for (const r of readyNoFile.rows) problems.push(`ExportJob ${r.id} está LISTO pero no tiene ningún archivo`);
  return { problems, detail: `${checked} archivos referenciados (originales requeridos y ExportFile) existen en los almacenes restaurados con el SHA-256 registrado en la base; ningún ExportJob READY sin archivo.` };
}

async function applyNuevoOrigen(conn: PgConn, uploads: string, exports: string, manifest: Manifest): Promise<NonNullable<RestoreReport["nuevoOrigen"]>> {
  const newId = randomUUID();
  const out = await withClient(conn, async (db) => {
    await db.query("BEGIN");
    try {
      const prev = (await db.query<{ value: string }>(`SELECT value FROM "InstallationMeta" WHERE key = 'installation_id'`)).rows[0]?.value ?? null;
      await db.query(`INSERT INTO "InstallationMeta" (key, value, "updatedAt") VALUES ('installation_id', $1, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`, [newId]);
      const s = await db.query(`DELETE FROM "Session"`);
      const vr = await db.query(`DELETE FROM "Verification"`);
      await db.query("COMMIT");
      return { previousInstallationId: prev ?? manifest.installationId, sessionsRemoved: s.rowCount ?? 0, verificationsRemoved: vr.rowCount ?? 0 };
    } catch (e) {
      await db.query("ROLLBACK").catch(() => undefined);
      throw e;
    }
  });
  const markersRewritten: string[] = [];
  for (const [kind, dir] of [["uploads", uploads], ["exports", exports]] as const) {
    const m: StoreMarker = { kind, installationId: newId, createdAt: new Date().toISOString() };
    await writeFile(path.join(dir, STORE_MARKER), JSON.stringify(m, null, 2) + "\n");
    markersRewritten.push(`${kind}/${STORE_MARKER}`);
  }
  return { ...out, newInstallationId: newId, markersRewritten, secretNote: "BETTER_AUTH_SECRET del origen NO se toca ni se reutiliza: la instalación restaurada debe arrancar con su propio secreto, suministrado por canal separado." };
}
