import { execFile } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";
import { statfs, stat } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { databaseNameOf } from "@/lib/env";
import { appRoot } from "@/lib/runtime";
import { checkStoreLayout } from "./stores";
import { FORBIDDEN_IN_OPERATION } from "./startup";

const pexec = promisify(execFile);

/**
 * Comprobación previa de instalación (CSAPP-10 §3.1). No imprime nunca credenciales: los mensajes nombran la variable, no su valor. Cada hallazgo
 * es accionable. «ensayado» = lo que se ha ejecutado de verdad; fuera de eso se avisa, no se declara compatible.
 */
export type Finding = { level: "ok" | "warn" | "error"; code: string; message: string };
export const TESTED = { nodeMajor: 22, nodeTested: "22.22", postgresMajor: 16 };
export const ENGINES = ">=22.18.0 <23 || >=24.11.0";

export function nodeSupported(v: string): boolean {
  const [maj, min] = v.replace(/^v/, "").split(".").map(Number);
  return (maj === 22 && min >= 18) || (maj === 24 && min >= 11) || maj > 24;
}

export function parseDbUrl(raw: string): { host: string; port: number; name: string; user: string } | null {
  try {
    const u = new URL(raw);
    return { host: u.hostname, port: Number(u.port || 5432), name: databaseNameOf(raw), user: decodeURIComponent(u.username) };
  } catch { return null; }
}

export function portOf(env: Record<string, string | undefined>): number {
  const p = Number(env.CSAPP_PORT || env.PORT);
  if (Number.isInteger(p) && p > 0) return p;
  try { const u = new URL(env.BETTER_AUTH_URL ?? ""); if (u.port) return Number(u.port); } catch { /* sin URL */ }
  return 3000;
}

export async function portFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, host);
  });
}

async function toolVersion(bin: string): Promise<string | null> {
  try { const r = await pexec(bin, ["--version"], { timeout: 10_000, windowsHide: true }); return r.stdout.trim(); } catch { return null; }
}

export async function runPreflight(env: Record<string, string | undefined> = process.env, opts: { checkPort?: boolean } = {}): Promise<Finding[]> {
  const f: Finding[] = [];
  const add = (level: Finding["level"], code: string, message: string) => f.push({ level, code, message });
  // Node
  if (!nodeSupported(process.version)) add("error", "NODE", `Node ${process.version} no cumple engines (${ENGINES}).`);
  else if (!process.version.startsWith(`v${TESTED.nodeTested}`)) add("warn", "NODE_NO_ENSAYADO", `Node ${process.version} cumple engines pero la versión ensayada es ${TESTED.nodeTested}.x.`);
  else add("ok", "NODE", `Node ${process.version}.`);
  // Variables
  for (const k of ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"]) if (!env[k]) add("error", "VARIABLE_FALTA", `Falta la variable ${k} (modelo en .env.example).`);
  const secret = env.BETTER_AUTH_SECRET;
  if (secret) {
    if (secret.length < 32) add("error", "SECRETO_CORTO", "BETTER_AUTH_SECRET tiene menos de 32 caracteres.");
    else if (new Set(secret).size < 8) add("error", "SECRETO_DEBIL", "BETTER_AUTH_SECRET es demasiado repetitivo: genere uno al azar.");
    else add("ok", "SECRETO", "BETTER_AUTH_SECRET presente (longitud suficiente).");
  }
  const origin = env.BETTER_AUTH_URL;
  if (origin) {
    try {
      const u = new URL(origin);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
      if (u.protocol !== "https:" && !local) add("warn", "ORIGEN_SIN_TLS", `BETTER_AUTH_URL (${u.origin}) no es https ni local: las cookies de sesión seguras exigen TLS (termínelo en el proxy).`);
      else add("ok", "ORIGEN", `Origen de la aplicación: ${u.origin}.`);
      if (u.pathname !== "/" && u.pathname !== "") add("warn", "ORIGEN_RUTA", "BETTER_AUTH_URL incluye una ruta; debe ser solo el origen.");
    } catch { add("error", "ORIGEN_INVALIDO", "BETTER_AUTH_URL no es una URL válida."); }
  }
  for (const k of FORBIDDEN_IN_OPERATION) if (env[k]) add(k === "CSAPP_APPROVED_TEST_DB" ? "error" : "warn", "OPCION_DE_PRUEBA", `${k} está definida: no se hereda en una instalación operativa (el arranque operativo la rechaza). Retírela del .env de producción.`);
  // Base de datos
  const db = env.DATABASE_URL ? parseDbUrl(env.DATABASE_URL) : null;
  if (env.DATABASE_URL && !db) add("error", "DB_URL", "DATABASE_URL no es una URL postgresql:// válida.");
  if (db) {
    if (!/^cs_app(_[a-z0-9]+)*$/.test(db.name)) add("error", "DB_NOMBRE", `La base «${db.name}» no es exclusiva de CS App (cs_app…).`);
    const url = new URL(env.DATABASE_URL!);
    url.searchParams.delete("schema");
    const c = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 8000 });
    try {
      await c.connect();
      const v = (await c.query("SHOW server_version_num")).rows[0].server_version_num as string;
      const major = Math.floor(Number(v) / 10000);
      add(major === TESTED.postgresMajor ? "ok" : "warn", "PG_VERSION", major === TESTED.postgresMajor ? `PostgreSQL ${major}.` : `PostgreSQL ${major}: la versión ensayada es ${TESTED.postgresMajor}.`);
      const cur = (await c.query("SELECT current_database() AS d, has_schema_privilege(current_user, 'public', 'CREATE') AS can_create")).rows[0];
      if (cur.d !== db.name) add("error", "DB_DESTINO", "La conexión no termina en la base indicada por DATABASE_URL.");
      if (!cur.can_create) add("error", "DB_PERMISOS", `El usuario de la base no puede crear objetos en el esquema public (necesario para «npm run db:migrar»).`);
      else add("ok", "DB_PERMISOS", "Conexión correcta y permiso de migración en el esquema public.");
      const mig = await c.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = '_prisma_migrations'`);
      add("ok", "DB_ESTADO", mig.rows[0].n > 0 ? "La base tiene historial de migraciones (instalación existente)." : "La base está vacía: «npm run db:migrar» creará el esquema.");
    } catch (e) {
      const code = (e as { code?: string }).code;
      add("error", "DB_CONEXION", `No se pudo conectar a ${db.host}:${db.port}/${db.name} (${code ?? "error"}). Compruebe que PostgreSQL esté en marcha, el usuario, la clave y el puerto.`);
    } finally { await c.end().catch(() => undefined); }
  }
  // Almacenes
  const uploads = env.CSAPP_UPLOAD_DIR, exports = env.CSAPP_EXPORT_DIR, root = appRoot();
  const op = env.NODE_ENV === "production" || env.CSAPP_OPERATIVA === "1";
  const lay = checkStoreLayout({ uploads: path.resolve(uploads || path.join(root, "almacen-cargas")), exports: path.resolve(exports || path.join(root, "almacen-exportaciones")), root, operational: op, uploadsExplicit: !!uploads && path.isAbsolute(uploads), exportsExplicit: !!exports && path.isAbsolute(exports) });
  for (const l of lay) add(op ? "error" : "warn", l.code, l.message);
  if (lay.length === 0) add("ok", "ALMACENES", "Originales y exportaciones son directorios privados distintos, fuera de public/, .next/ y de la carpeta de la aplicación.");
  for (const [name, dir] of [["originales", uploads], ["exportaciones", exports]] as const) {
    if (!dir) continue;
    let probe = path.resolve(dir);
    for (let i = 0; i < 6; i++) { if (await stat(probe).then((s) => s.isDirectory()).catch(() => false)) break; probe = path.dirname(probe); }
    const free = await statfs(probe).then((s) => Number(s.bavail) * Number(s.bsize)).catch(() => null);
    if (free === null) add("warn", "ESPACIO", `No se pudo medir el espacio libre del almacén de ${name}.`);
    else if (free < 1024 ** 3) add("warn", "ESPACIO", `Almacén de ${name}: solo ${(free / 1048576).toFixed(0)} MB libres (un export de un millón de hechos ocupa ≈ 230 MB y las cargas hasta 200 MB por archivo).`);
    else add("ok", "ESPACIO", `Almacén de ${name}: ${(free / 1073741824).toFixed(1)} GB libres.`);
  }
  // Puerto
  if (opts.checkPort) {
    const port = portOf(env);
    const host = env.CSAPP_HOST || "127.0.0.1";
    add((await portFree(port, host)) ? "ok" : "error", "PUERTO", (await portFree(port, host)) ? `Puerto ${port} libre.` : `El puerto ${port} está ocupado: otro proceso lo usa (¿otra instancia de CS App?). Cambie CSAPP_PORT o deténgala con «npm run ops -- parar».`);
  }
  // Herramientas de copia
  for (const bin of ["pg_dump", "pg_restore"]) {
    const v = await toolVersion(bin);
    add(v ? "ok" : "warn", "HERRAMIENTA", v ? `${bin}: ${v}.` : `${bin} no está en el PATH: necesario para «npm run backup:*» (instale las herramientas cliente de PostgreSQL ${TESTED.postgresMajor}).`);
  }
  return f;
}
