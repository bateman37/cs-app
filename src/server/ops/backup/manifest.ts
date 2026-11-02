import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/**
 * Manifiesto de la copia (CSAPP-10 §7). `manifest.json` describe todo lo que contiene (inventario relativo con bytes y SHA-256, incluido el volcado) y
 * `manifest.sha256` lleva el SHA-256 del propio manifiesto: alterar cualquiera de los dos se detecta. Sin secretos: ni valores de configuración,
 * ni credenciales, ni `.env`.
 */
export const BACKUP_FORMAT = "csapp-backup-v1";
export const MANIFEST_FILE = "manifest.json";
export const MANIFEST_SHA_FILE = "manifest.sha256";
export const CONFIG_INVENTORY_FILE = "config-inventory.json";
export const DUMP_PATH = "db/csapp.dump";

const sha = z.string().regex(/^[0-9a-f]{64}$/);
const tableControl = z.object({ rows: z.number().int().nonnegative(), idSum: z.string(), contentSum: z.string() });

export const manifestSchema = z.object({
  formatVersion: z.string(),
  id: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  createdAt: z.string(),
  app: z.object({ version: z.string(), sha: z.string(), dirty: z.boolean(), builtAt: z.string().nullable(), builtWithNode: z.string().nullable() }),
  versions: z.object({ node: z.string(), postgresServer: z.string(), postgresServerMajor: z.number().int(), pgDump: z.string(), pgDumpMajor: z.number().int() }),
  installationId: z.string().nullable(),
  source: z.object({ host: z.string(), port: z.string(), database: z.string() }),
  schema: z.object({ migrations: z.array(z.string()), failedMigrations: z.array(z.string()), tables: z.number().int(), foreignKeys: z.number().int(), triggers: z.array(z.string()) }),
  controls: z.object({ tables: z.record(z.string(), tableControl), groups: z.record(z.string(), z.array(z.string())) }),
  files: z.array(z.object({ path: z.string(), bytes: z.number().int().nonnegative(), sha256: sha, kind: z.enum(["dump", "config", "uploads", "exports", "marker"]) })),
  stores: z.object({
    uploads: z.object({ marker: z.unknown().nullable(), files: z.number().int(), bytes: z.number().int() }),
    exports: z.object({ marker: z.unknown().nullable(), files: z.number().int(), bytes: z.number().int() }),
  }),
  excluded: z.array(z.object({ store: z.string(), path: z.string(), reason: z.string() })),
  warnings: z.array(z.string()),
  conditions: z.object({ stopped: z.literal(true), webStoppedDeclared: z.boolean(), checks: z.array(z.object({ code: z.string(), ok: z.boolean(), message: z.string() })) }),
});
export type Manifest = z.infer<typeof manifestSchema>;
export type FileEntry = Manifest["files"][number];

export const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

/** Escribe `manifest.json` y `manifest.sha256` (formato `sha  nombre`, como `sha256sum`). */
export async function writeManifest(dir: string, m: Manifest): Promise<string> {
  const body = JSON.stringify(m, null, 2) + "\n";
  await writeFile(path.join(dir, MANIFEST_FILE), body, { flag: "wx" });
  const digest = sha256Hex(body);
  await writeFile(path.join(dir, MANIFEST_SHA_FILE), `${digest}  ${MANIFEST_FILE}\n`, { flag: "wx" });
  return digest;
}

export class ManifestError extends Error {
  constructor(message: string, public readonly code: "AUSENTE" | "SHA" | "ALTERADO" | "FORMATO" | "FORMA") {
    super(message);
    this.name = "ManifestError";
  }
}

/** Lee y valida: SHA del manifiesto (contra `manifest.sha256`), JSON, forma y versión de formato. No mira el contenido de la copia. */
export async function readManifest(dir: string): Promise<{ manifest: Manifest; sha256: string }> {
  const raw = await readFile(path.join(dir, MANIFEST_FILE)).catch(() => null);
  const shaRaw = await readFile(path.join(dir, MANIFEST_SHA_FILE), "utf8").catch(() => null);
  if (raw === null || shaRaw === null) throw new ManifestError("Falta manifest.json o manifest.sha256: no es una copia completa.", "AUSENTE");
  const expected = /^([0-9a-f]{64})\b/.exec(shaRaw.trim())?.[1];
  if (!expected) throw new ManifestError("manifest.sha256 no tiene un SHA-256 válido.", "SHA");
  const actual = sha256Hex(raw);
  if (actual !== expected) throw new ManifestError("El manifiesto no coincide con su SHA-256: ha sido alterado o está dañado.", "ALTERADO");
  let json: unknown;
  try { json = JSON.parse(raw.toString("utf8")); } catch { throw new ManifestError("manifest.json no es JSON válido.", "FORMA"); }
  const fmt = (json as { formatVersion?: unknown } | null)?.formatVersion;
  if (fmt !== BACKUP_FORMAT) throw new ManifestError(`Versión de formato de copia no soportada (${typeof fmt === "string" ? fmt : "desconocida"}); esta herramienta entiende ${BACKUP_FORMAT}.`, "FORMATO");
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) throw new ManifestError(`manifest.json no tiene la forma esperada: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, "FORMA");
  return { manifest: parsed.data, sha256: actual };
}

/** Compatibilidad del esquema de la copia con las migraciones del código instalado. */
export type SchemaCompat = "igual" | "anterior" | "posterior" | "divergente";
export function compareMigrations(inCopy: readonly string[], inCode: readonly string[]): { compat: SchemaCompat; missingInCopy: string[]; unknownToCode: string[] } {
  const c = new Set(inCopy);
  const k = new Set(inCode);
  const missingInCopy = [...k].filter((m) => !c.has(m)).sort();
  const unknownToCode = [...c].filter((m) => !k.has(m)).sort();
  const compat: SchemaCompat = !missingInCopy.length && !unknownToCode.length ? "igual" : unknownToCode.length && missingInCopy.length ? "divergente" : unknownToCode.length ? "posterior" : "anterior";
  return { compat, missingInCopy, unknownToCode };
}

export function schemaCompatMessage(r: ReturnType<typeof compareMigrations>): string {
  switch (r.compat) {
    case "igual": return "Las migraciones de la copia coinciden con las del código instalado.";
    case "anterior": return `Copia de esquema MÁS ANTIGUO que el código instalado (faltan ${r.missingInCopy.length}: ${r.missingInCopy.join(", ")}). Tras restaurar hay que aplicar «npm run db:migrar» antes de arrancar.`;
    case "posterior": return `Copia de esquema MÁS NUEVO que el código instalado (el código no conoce ${r.unknownToCode.length}: ${r.unknownToCode.join(", ")}). Restaurar con la versión de la aplicación que la creó (o posterior); este código no puede usarla.`;
    default: return `Esquema DIVERGENTE: la copia tiene migraciones que el código no conoce (${r.unknownToCode.join(", ")}) y le faltan otras (${r.missingInCopy.join(", ")}). No es una evolución lineal; no se restaura.`;
  }
}
