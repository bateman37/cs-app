import { execFile } from "node:child_process";
import path from "node:path";
import { Client, type ClientConfig } from "pg";
import { redact } from "./redact";

/**
 * Herramientas oficiales de PostgreSQL (CSAPP-10 §7): `pg_dump -Fc` y `pg_restore` por `execFile` (SIN shell, sin interpolación; rutas con espacios y
 * comillas pasan como argumentos). La conexión viaja en el ENTORNO del hijo (PGHOST/PGPORT/PGUSER/PGDATABASE/PGPASSWORD): la contraseña no aparece nunca
 * en argv, en registros ni en errores. Sin pruebas en Windows: allí el ejecutable se resuelve por `CSAPP_PG_BIN` o PATH (`.exe`).
 */
export class BackupError extends Error {
  constructor(message: string, public readonly code: string = "ERROR") {
    super(message);
    this.name = "BackupError";
  }
}

export type PgConn = { host: string; port: string; user: string; password: string; database: string; sslmode?: string };

export function parsePgUrl(raw: string): PgConn {
  let u: URL;
  try { u = new URL(raw); } catch { throw new BackupError("La URL de la base no es válida (postgresql://usuario:clave@host:puerto/base).", "URL"); }
  if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") throw new BackupError("La URL de la base debe usar postgresql://.", "URL");
  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!u.hostname || !database || database.includes("/")) throw new BackupError("La URL de la base debe incluir host y nombre de base.", "URL");
  return { host: u.hostname, port: u.port || "5432", user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database, sslmode: u.searchParams.get("sslmode") ?? undefined };
}

export const connTarget = (c: PgConn) => `${c.host.toLowerCase()}:${c.port}/${c.database}`;
export const withDatabase = (c: PgConn, database: string): PgConn => ({ ...c, database });

/** Entorno del proceso hijo: el del padre SIN credenciales de la aplicación y con la conexión indicada por variables PG*. */
export function childEnv(conn: PgConn, base: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    if (/^PG/i.test(k) || ["DATABASE_URL", "TEST_DATABASE_URL", "SHADOW_DATABASE_URL", "BETTER_AUTH_SECRET"].includes(k)) continue;
    env[k] = v;
  }
  env.PGHOST = conn.host;
  env.PGPORT = conn.port;
  env.PGUSER = conn.user;
  env.PGDATABASE = conn.database;
  if (conn.password) env.PGPASSWORD = conn.password;
  if (conn.sslmode) env.PGSSLMODE = conn.sslmode;
  env.PGCONNECT_TIMEOUT = "15";
  env.LC_MESSAGES = "C";
  return env;
}

export function pgClientConfig(conn: PgConn): ClientConfig {
  return { host: conn.host, port: Number(conn.port), user: conn.user, password: conn.password || undefined, database: conn.database, ssl: conn.sslmode && conn.sslmode !== "disable" && conn.sslmode !== "prefer" ? { rejectUnauthorized: conn.sslmode === "verify-full" || conn.sslmode === "verify-ca" } : undefined };
}

export async function withClient<T>(conn: PgConn, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ ...pgClientConfig(conn), connectionTimeoutMillis: 15_000 });
  c.on("error", () => undefined);
  try {
    await c.connect();
  } catch (e) {
    throw new BackupError(`No se pudo conectar a ${connTarget(conn)}: ${redact(e instanceof Error ? e.message : String(e), [conn.password])}`, "CONEXION");
  }
  try {
    return await fn(c);
  } finally {
    await c.end().catch(() => undefined);
  }
}

// ---------------------------------------------------------------- Herramientas

export type PgTool = "pg_dump" | "pg_restore" | "psql";
const ENV_OF: Record<PgTool, string> = { pg_dump: "CSAPP_PG_DUMP", pg_restore: "CSAPP_PG_RESTORE", psql: "CSAPP_PSQL" };

/** Ejecutable: variable específica, o `CSAPP_PG_BIN/<nombre>`, o el nombre pelado (PATH). */
export function toolPath(tool: PgTool, env: Record<string, string | undefined> = process.env): string {
  const own = env[ENV_OF[tool]];
  if (own) return own;
  const bin = env.CSAPP_PG_BIN;
  const exe = process.platform === "win32" ? `${tool}.exe` : tool;
  return bin ? path.join(bin, exe) : exe;
}

export type ToolResult = { code: number; stdout: string; stderr: string };

/** Ejecuta sin shell y sin lanzar por código ≠ 0 (el llamador decide). La salida se devuelve YA redactada. */
export function runTool(file: string, args: readonly string[], conn: PgConn, opts: { env?: Record<string, string | undefined>; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { env: childEnv(conn, opts.env) as NodeJS.ProcessEnv, windowsHide: true, maxBuffer: 256 * 1024 * 1024, timeout: opts.timeoutMs ?? 0, shell: false, signal: opts.signal }, (err, stdout, stderr) => {
      const clean = (s: string) => redact(s, [conn.password]);
      if (err && err.name === "AbortError") return reject(new BackupError("Interrumpido por la persona operadora.", "ABORTADO"));
      if (err && (err as NodeJS.ErrnoException).code === "ENOENT") return reject(new BackupError(`No se encontró la herramienta «${path.basename(file)}». Instale las herramientas cliente de PostgreSQL o indique su ubicación con CSAPP_PG_BIN.`, "HERRAMIENTA"));
      if (err && typeof (err as { code?: unknown }).code !== "number") return reject(new BackupError(`No se pudo ejecutar «${path.basename(file)}»: ${clean(err.message).split("\n")[0]}`, "HERRAMIENTA"));
      resolve({ code: err ? ((err as { code: number }).code) : 0, stdout: clean(String(stdout)), stderr: clean(String(stderr)) });
    });
  });
}

export type PgVersion = { raw: string; major: number; minor: number };
export function parseVersion(text: string): PgVersion | null {
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(text.replace(/^.*\(PostgreSQL\)\s*/i, ""));
  if (!m) return null;
  const major = Number(m[1]);
  // Desde PostgreSQL 10 la versión es «mayor.menor»; antes «x.y.z».
  return { raw: m[0], major: major >= 10 ? major : Number(`${m[1]}${m[2] ?? 0}`), minor: major >= 10 ? Number(m[2] ?? 0) : Number(m[3] ?? 0) };
}

export async function toolVersion(tool: PgTool, conn: PgConn, env: Record<string, string | undefined> = process.env): Promise<PgVersion> {
  const r = await runTool(toolPath(tool, env), ["--version"], conn, { env, timeoutMs: 30_000 });
  const v = r.code === 0 ? parseVersion(r.stdout) : null;
  if (!v) throw new BackupError(`No se pudo determinar la versión de ${tool}.`, "HERRAMIENTA");
  return v;
}

export async function serverVersion(c: Client): Promise<{ raw: string; major: number }> {
  const r = await c.query<{ v: string; n: string }>("SELECT current_setting('server_version') AS v, current_setting('server_version_num') AS n");
  const num = Number(r.rows[0].n);
  return { raw: r.rows[0].v, major: Math.floor(num / 10000) };
}

/** pg_dump no puede ser más antiguo que el servidor. */
export function assertDumpCompatible(dump: PgVersion, server: { raw: string; major: number }): void {
  if (dump.major < server.major) throw new BackupError(`pg_dump ${dump.raw} es más antiguo que el servidor PostgreSQL ${server.raw}: instale herramientas cliente de la misma versión (o posterior) y repita. No se crea ninguna copia.`, "VERSION");
}
