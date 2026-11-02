import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { appRoot, buildInfo } from "@/lib/runtime";
import { BackupError, parseVersion, runTool, toolPath, type PgConn } from "./pgtools";
import { sha256File, UnsafePathError, resolveInside, safeSegments } from "./fsutil";
import { CONFIG_INVENTORY_FILE, DUMP_PATH, MANIFEST_FILE, MANIFEST_SHA_FILE, ManifestError, compareMigrations, readManifest, schemaCompatMessage, type Manifest, type SchemaCompat } from "./manifest";

/**
 * Verificación de una copia (CSAPP-10 §7). NO necesita base de datos ni modifica nada: recalcula SHA-256 por bloques de todo el inventario, valida el manifiesto,
 * comprueba que el volcado es legible (`pg_restore --list`, sin restaurar), que las migraciones son compatibles con el código instalado y que ninguna ruta del
 * inventario escapa del directorio. Salida OK/FALLO/AVISO por comprobación; la copia es utilizable solo si no hay ningún FALLO.
 */
export type CheckStatus = "OK" | "FALLO" | "AVISO";
export type Check = { name: string; status: CheckStatus; detail: string };
export type VerifyResult = { ok: boolean; checks: Check[]; manifest?: Manifest; manifestSha256?: string; schemaCompat?: SchemaCompat; bytes: number };

const DUMMY: PgConn = { host: "localhost", port: "5432", user: "csapp", password: "", database: "csapp" };
export const ALLOWED_PREFIXES = ["db/", "uploads/", "exports/"];

/** Migraciones que el código instalado espera: las del build-info o, en desarrollo, las carpetas de prisma/migrations. */
export async function expectedMigrations(): Promise<string[]> {
  const b = buildInfo().migrations;
  if (b.length) return [...b].sort();
  try {
    return (await readdir(path.join(appRoot(), "prisma", "migrations"), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return [];
  }
}

export type VerifyOptions = { env?: Record<string, string | undefined>; expectedMigrations?: string[]; onProgress?: (m: string) => void; skipDump?: boolean; /** Solo la propia herramienta, al verificar su temporal antes de publicarlo. */ allowTemp?: boolean };

export async function verifyBackup(dir: string, opts: VerifyOptions = {}): Promise<VerifyResult> {
  const checks: Check[] = [];
  const add = (name: string, status: CheckStatus, detail: string) => checks.push({ name, status, detail });
  const result = (extra: Partial<VerifyResult> = {}): VerifyResult => ({ ok: !checks.some((c) => c.status === "FALLO"), checks, bytes: 0, ...extra });
  const root = path.resolve(dir);

  const st = await lstat(root).catch(() => null);
  if (!st?.isDirectory() || st.isSymbolicLink()) { add("directorio", "FALLO", "La ruta no es un directorio de copia (o es un enlace simbólico)."); return result(); }
  if (!opts.allowTemp && path.basename(root).startsWith(".tmp-")) { add("directorio", "FALLO", "Es un directorio temporal «.tmp-»: una copia incompleta o interrumpida no es recuperable."); return result(); }
  add("directorio", "OK", root);

  let manifest: Manifest;
  let manifestSha256: string;
  try {
    ({ manifest, sha256: manifestSha256 } = await readManifest(root));
  } catch (e) {
    add(e instanceof ManifestError && e.code === "FORMATO" ? "formato" : "manifiesto", "FALLO", e instanceof Error ? e.message : "manifiesto ilegible");
    return result();
  }
  add("manifiesto", "OK", `SHA-256 ${manifestSha256.slice(0, 16)}… coincide; formato ${manifest.formatVersion}; copia ${manifest.id}; creada ${manifest.createdAt}; aplicación ${manifest.app.version} (${manifest.app.sha.slice(0, 12)}).`);

  // Rutas del inventario: ninguna escapa, ninguna absoluta/Windows/enlace; prefijos permitidos; sin duplicados; el volcado y el inventario de configuración figuran.
  const bad: string[] = [];
  const seen = new Set<string>();
  const safe: Manifest["files"] = [];
  for (const f of manifest.files) {
    try {
      safeSegments(f.path);
      if (!ALLOWED_PREFIXES.some((p) => f.path.startsWith(p)) && f.path !== CONFIG_INVENTORY_FILE) throw new UnsafePathError(`fuera de las carpetas de la copia: ${JSON.stringify(f.path)}`);
      if (seen.has(f.path)) throw new UnsafePathError(`ruta duplicada: ${JSON.stringify(f.path)}`);
      seen.add(f.path);
      await resolveInside(root, f.path);
      safe.push(f);
    } catch (e) {
      bad.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (!seen.has(DUMP_PATH)) bad.push(`el inventario no incluye el volcado (${DUMP_PATH})`);
  add("rutas", bad.length ? "FALLO" : "OK", bad.length ? `${bad.length} ruta(s) no seguras: ${bad.slice(0, 5).join("; ")}` : `${manifest.files.length} rutas relativas seguras (sin «..», absolutas ni enlaces).`);

  // SHA-256 de todo el inventario, por bloques.
  const wrong: string[] = [];
  let bytes = 0;
  for (const f of safe) {
    const full = path.join(root, ...f.path.split("/"));
    const lst = await lstat(full).catch(() => null);
    if (!lst) { wrong.push(`${f.path}: ausente`); continue; }
    if (!lst.isFile() || lst.isSymbolicLink()) { wrong.push(`${f.path}: no es un archivo regular`); continue; }
    if (lst.size !== f.bytes) { wrong.push(`${f.path}: tamaño ${lst.size} ≠ ${f.bytes} (¿truncado?)`); continue; }
    const h = await sha256File(full);
    bytes += h.bytes;
    if (h.sha256 !== f.sha256) wrong.push(`${f.path}: SHA-256 distinto (corrupto)`);
  }
  add("integridad", wrong.length ? "FALLO" : "OK", wrong.length ? `${wrong.length} archivo(s) con problemas: ${wrong.slice(0, 5).join("; ")}` : `${safe.length} archivos, ${bytes} bytes: tamaño y SHA-256 coinciden con el manifiesto.`);

  // Archivos no inventariados (no se restauran): aviso.
  try {
    const extra: string[] = [];
    const rec = async (d: string, rel: string) => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await rec(path.join(d, e.name), r);
        else if (!seen.has(r) && r !== MANIFEST_FILE && r !== MANIFEST_SHA_FILE) extra.push(r);
      }
    };
    await rec(root, "");
    if (extra.length) add("extras", "AVISO", `${extra.length} archivo(s) no inventariados (no se restaurarán): ${extra.slice(0, 5).join(", ")}`);
  } catch { /* directorio ilegible: ya habría fallado */ }

  // Migraciones frente al código instalado y estado de las migraciones de la copia.
  const code = opts.expectedMigrations ?? (await expectedMigrations());
  if (manifest.schema.failedMigrations.length) add("migraciones", "FALLO", `La copia contiene migraciones fallidas o a medias: ${manifest.schema.failedMigrations.join(", ")}.`);
  else if (code.length === 0) add("migraciones", "AVISO", "No se pudo determinar las migraciones del código instalado (sin build-info.json ni prisma/migrations): compatibilidad de esquema NO comprobada.");
  else {
    const cmp = compareMigrations(manifest.schema.migrations, code);
    add("migraciones", cmp.compat === "igual" ? "OK" : cmp.compat === "anterior" ? "AVISO" : "FALLO", schemaCompatMessage(cmp));
    return finish(cmp.compat);
  }
  return finish(undefined);

  async function finish(schemaCompat: SchemaCompat | undefined): Promise<VerifyResult> {
    // Volcado legible sin restaurar. Si la integridad ya falló, aun así se intenta: el detalle ayuda a diagnosticar.
    if (!opts.skipDump && seen.has(DUMP_PATH)) {
      try {
        const r = await runTool(toolPath("pg_restore", opts.env), ["--list", path.join(root, ...DUMP_PATH.split("/"))], DUMMY, { env: opts.env, timeoutMs: 10 * 60_000 });
        const dataEntries = (r.stdout.match(/\bTABLE DATA\b/g) ?? []).length;
        if (r.code !== 0) add("volcado", "FALLO", `pg_restore --list no puede leer el volcado: ${r.stderr.split("\n").find((l) => l.trim()) ?? `código ${r.code}`}`);
        else if (dataEntries < manifest.schema.tables) add("volcado", "FALLO", `El volcado lista ${dataEntries} tablas con datos y el manifiesto declara ${manifest.schema.tables}.`);
        else add("volcado", "OK", `Legible con pg_restore --list (${dataEntries} tablas con datos; sin restaurar).`);
        const rv = await runTool(toolPath("pg_restore", opts.env), ["--version"], DUMMY, { env: opts.env, timeoutMs: 30_000 });
        const v = parseVersion(rv.stdout);
        if (v && v.major < manifest.versions.pgDumpMajor) add("herramienta", "FALLO", `pg_restore ${v.raw} es más antiguo que el pg_dump que creó la copia (${manifest.versions.pgDump}): use herramientas de versión igual o posterior.`);
      } catch (e) {
        add("volcado", "FALLO", e instanceof BackupError ? e.message : `No se pudo comprobar el volcado: ${e instanceof Error ? e.message : "error"}`);
      }
    }
    return result({ manifest, manifestSha256, schemaCompat, bytes });
  }
}

export function formatChecks(checks: readonly Check[]): string {
  return checks.map((c) => `[${c.status.padEnd(5)}] ${c.name}: ${c.detail}`).join("\n");
}
