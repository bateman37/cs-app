import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createBackup } from "../src/server/ops/backup/create";
import { BackupError } from "../src/server/ops/backup/pgtools";
import { redact, secretsFrom } from "../src/server/ops/backup/redact";
import { RestoreRejected, restoreBackup } from "../src/server/ops/backup/restore";
import { formatChecks, verifyBackup } from "../src/server/ops/backup/verify";

/**
 * Copias de seguridad de CS App (CSAPP-10 §7-8). Node puro, sin Bash; funciona en PowerShell. Uso (vea docs/operacion/copia-restauracion.md):
 *   npm run backup:crear -- --destino <carpeta> [--esperar <segundos>] [--web-parada] [--aceptar-originales-ausentes] [--json]
 *   npm run backup:verificar -- <carpeta-de-la-copia> [--json]
 *   npm run backup:restaurar -- <carpeta-de-la-copia> --db-url <url> --uploads <carpeta> --exports <carpeta> [--nuevo-origen]
 *                              [--normalizar-trabajos] [--permitir-esquema-anterior] [--informe <archivo.json>] [--json]
 * Las credenciales nunca se imprimen. La URL de la base destino puede darse también con la variable CSAPP_RESTORE_DATABASE_URL (recomendado: no queda
 * en el historial de la consola). Código de salida 0 = correcto; 1 = fallo o rechazo; 2 = uso incorrecto.
 */
const [cmd = "ayuda", ...rest] = process.argv.slice(2);
const BOOLEANS = new Set(["web-parada", "nuevo-origen", "normalizar-trabajos", "permitir-esquema-anterior", "aceptar-originales-ausentes", "json"]);

function parseArgs(args: string[]): { flags: Map<string, string | true>; positional: string[] } {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) { positional.push(a); continue; }
    const eq = a.indexOf("=");
    const name = a.slice(2, eq === -1 ? undefined : eq);
    if (eq !== -1) flags.set(name, a.slice(eq + 1));
    else if (BOOLEANS.has(name)) flags.set(name, true);
    else { const v = args[++i]; if (v === undefined || v.startsWith("--")) throw new UsageError(`Falta el valor de --${name}.`); flags.set(name, v); }
  }
  return { flags, positional };
}
class UsageError extends Error {}
const str = (f: Map<string, string | true>, n: string): string | undefined => { const v = f.get(n); return typeof v === "string" ? v : undefined; };
const secrets = () => secretsFrom([process.env.DATABASE_URL, process.env.CSAPP_RESTORE_DATABASE_URL, str(parseSafe(), "db-url")]);
function parseSafe() { try { return parseArgs(rest).flags; } catch { return new Map<string, string | true>(); } }
const out = (s: string) => console.log(redact(s, secrets()));
const err = (s: string) => console.error(redact(s, secrets()));
const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;

async function crear(): Promise<number> {
  const { flags } = parseArgs(rest);
  const destino = str(flags, "destino") ?? process.env.CSAPP_BACKUP_DIR;
  if (!destino) throw new UsageError("Falta --destino <carpeta> (o la variable CSAPP_BACKUP_DIR).");
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new UsageError("Falta DATABASE_URL (la base de la que se hace la copia).");
  const wait = str(flags, "esperar");
  if (wait !== undefined && !/^\d+$/.test(wait)) throw new UsageError("--esperar debe ser un número entero de segundos.");
  const ac = new AbortController();
  for (const s of ["SIGINT", "SIGTERM"] as const) process.once(s, () => { err(`Recibido ${s}: se interrumpe la copia; no se publica nada.`); ac.abort(); });
  if (flags.get("web-parada")) err("AVISO: --web-parada: se da la web por parada sin comprobarlo; si no lo está, la copia puede no ser coherente.");
  const r = await createBackup({ destino, dbUrl, webStopped: !!flags.get("web-parada"), waitSeconds: wait ? Number(wait) : 0, acceptMissingOriginals: !!flags.get("aceptar-originales-ausentes"), log: (m) => out(m), signal: ac.signal });
  if (flags.get("json")) out(JSON.stringify({ id: r.id, dir: r.dir, bytes: r.bytes, requiredBytes: r.requiredBytes, timingsMs: r.timingsMs, warnings: r.warnings, manifestSha256: r.checks.find((c) => c.name === "manifiesto")?.detail }, null, 2));
  else {
    out(`\nCOPIA COHERENTE CREADA Y VERIFICADA: ${r.dir}`);
    out(`  id ${r.id} · aplicación ${r.manifest.app.version} (${r.manifest.app.sha.slice(0, 12)}) · PostgreSQL ${r.manifest.versions.postgresServer} / pg_dump ${r.manifest.versions.pgDump}`);
    out(`  volcado ${mb(r.bytes.dump)} · originales ${mb(r.bytes.uploads)} · exportaciones ${mb(r.bytes.exports)} · total ${mb(r.bytes.total)} (espacio estimado necesario ${mb(r.requiredBytes)})`);
    out(`  tiempos (ms): ${Object.entries(r.timingsMs).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
    out("  Custodia aparte (NO incluidos en la copia): DATABASE_URL y BETTER_AUTH_SECRET. Vea config-inventory.json.");
  }
  return 0;
}

async function verificar(): Promise<number> {
  const { flags, positional } = parseArgs(rest);
  const dir = positional[0] ?? str(flags, "copia");
  if (!dir) throw new UsageError("Indique la carpeta de la copia: npm run backup:verificar -- <carpeta>.");
  const r = await verifyBackup(path.resolve(dir), { env: process.env });
  if (flags.get("json")) out(JSON.stringify({ ok: r.ok, checks: r.checks, bytes: r.bytes }, null, 2));
  else {
    out(formatChecks(r.checks));
    out(r.ok ? `\nRESULTADO: OK (${mb(r.bytes)} verificados).` : "\nRESULTADO: FALLO: la copia NO es utilizable.");
  }
  return r.ok ? 0 : 1;
}

async function restaurar(): Promise<number> {
  const { flags, positional } = parseArgs(rest);
  const backup = positional[0] ?? str(flags, "copia");
  const dbUrl = str(flags, "db-url") ?? process.env.CSAPP_RESTORE_DATABASE_URL;
  const uploads = str(flags, "uploads");
  const exports = str(flags, "exports");
  if (!backup || !dbUrl || !uploads || !exports) throw new UsageError("Uso: npm run backup:restaurar -- <copia> --db-url <url> (o CSAPP_RESTORE_DATABASE_URL) --uploads <carpeta> --exports <carpeta> [--nuevo-origen].");
  const report = await restoreBackup({
    backup: path.resolve(backup), dbUrl, uploads: path.resolve(uploads), exports: path.resolve(exports),
    nuevoOrigen: !!flags.get("nuevo-origen"), normalizarTrabajos: !!flags.get("normalizar-trabajos"), permitirEsquemaAnterior: !!flags.get("permitir-esquema-anterior"),
    originUrl: process.env.DATABASE_URL, log: (m) => out(m),
  });
  const informe = str(flags, "informe");
  if (informe) {
    await mkdir(path.dirname(path.resolve(informe)), { recursive: true });
    await writeFile(path.resolve(informe), redact(JSON.stringify(report, null, 2), secrets()) + "\n");
  }
  if (flags.get("json")) out(JSON.stringify(report, null, 2));
  else {
    out(`\n${formatChecks(report.checks)}`);
    for (const w of report.warnings) out(`[AVISO ] ${w}`);
    out(report.ok ? `\nRESTAURACIÓN CORRECTA en ${report.destination.target} (base ${report.destination.createdDatabase ? "creada" : "preexistente vacía"}). No se ha arrancado ningún trabajador.` : "\nRESTAURACIÓN CON FALLOS: no use la base restaurada.");
  }
  return report.ok ? 0 : 1;
}

async function main(): Promise<number> {
  switch (cmd) {
    case "crear": return crear();
    case "verificar": return verificar();
    case "restaurar": return restaurar();
    default:
      out("Uso: npm run backup:crear | backup:verificar | backup:restaurar  (vea docs/operacion/copia-restauracion.md)");
      return cmd === "ayuda" || cmd === "--help" ? 0 : 2;
  }
}

main().then((code) => process.exit(code), (e: unknown) => {
  if (e instanceof UsageError) { err(`Uso incorrecto: ${e.message}`); process.exit(2); }
  if (e instanceof RestoreRejected) { err(e.message); process.exit(1); }
  err(`ERROR${e instanceof BackupError ? ` (${e.code})` : ""}: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
