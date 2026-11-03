import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { appRoot } from "@/lib/runtime";
import { exportConfig } from "@/server/exports/config";
import { uploadConfig } from "@/server/uploads/config";

/**
 * Almacenes privados e identidad de instalación (CSAPP-10 §3, §8). Cada almacén lleva una marca `.csapp-store.json` con el identificador de la
 * instalación registrado también en la base: web y trabajador se niegan a usar un almacén de OTRA instalación (por ejemplo una carpeta equivocada tras
 * cambiar de directorio de trabajo) en vez de crear en silencio un almacén nuevo. La marca no contiene secretos.
 */
export const STORE_MARKER = ".csapp-store.json";
export type StoreKind = "uploads" | "exports";
export type StoreMarker = { kind: StoreKind; installationId: string; createdAt: string };

export const storeDirs = (): Record<StoreKind, string> => ({ uploads: uploadConfig().dir, exports: exportConfig().dir });

export async function readInstallationId(): Promise<string | null> {
  const r = await prisma.installationMeta.findUnique({ where: { key: "installation_id" } });
  return r?.value ?? null;
}
/** Crea el identificador la primera vez (idempotente y sin carreras: INSERT … ON CONFLICT DO NOTHING). */
export async function ensureInstallationId(): Promise<string> {
  const id = randomUUID();
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "InstallationMeta" (key, value) VALUES ('installation_id', ${id}) ON CONFLICT (key) DO NOTHING`);
  return (await readInstallationId())!;
}

export async function readMarker(dir: string): Promise<StoreMarker | null> {
  try { return JSON.parse(await readFile(path.join(dir, STORE_MARKER), "utf8")) as StoreMarker; } catch { return null; }
}

export type StoreVerdict = { dir: string; kind: StoreKind; state: "ok" | "creado" | "vacio-sin-marca" | "marca-ajena" | "con-datos-sin-marca" | "marca-ilegible" | "no-es-directorio"; message: string };

async function isEmptyDir(dir: string): Promise<boolean> {
  try { return (await readdir(dir)).filter((n) => n !== STORE_MARKER).length === 0; } catch { return true; }
}

/**
 * Verifica (y, si `create`, prepara) un almacén frente a la instalación. Nunca sobrescribe una marca ajena ni adopta un almacén con datos sin marca.
 */
export async function verifyStore(kind: StoreKind, installationId: string, opts: { create: boolean }): Promise<StoreVerdict> {
  const dir = storeDirs()[kind];
  let st = await stat(dir).catch(() => null);
  if (st && !st.isDirectory()) return { dir, kind, state: "no-es-directorio", message: `La ruta del almacén de ${kind === "uploads" ? "originales" : "exportaciones"} existe pero no es un directorio.` };
  if (!st) {
    if (!opts.create) return { dir, kind, state: "vacio-sin-marca", message: "El almacén aún no existe (se creará al preparar la instalación)." };
    await mkdir(dir, { recursive: true });
    st = await stat(dir);
  }
  const raw = await readFile(path.join(dir, STORE_MARKER), "utf8").catch(() => null);
  if (raw === null) {
    if (!(await isEmptyDir(dir))) return { dir, kind, state: "con-datos-sin-marca", message: "El almacén contiene archivos pero no pertenece a ninguna instalación conocida (sin marca): se rechaza para no mezclar datos. Si es el almacén correcto, adóptelo explícitamente con «npm run ops -- adoptar-almacenes»." };
    if (!opts.create) return { dir, kind, state: "vacio-sin-marca", message: "Almacén vacío sin marca." };
    await writeFile(path.join(dir, STORE_MARKER), JSON.stringify({ kind, installationId, createdAt: new Date().toISOString() } satisfies StoreMarker, null, 2) + "\n", { flag: "wx" }).catch(() => undefined);
    return { dir, kind, state: "creado", message: "Almacén preparado y enlazado a esta instalación." };
  }
  let m: StoreMarker;
  try { m = JSON.parse(raw) as StoreMarker; } catch { return { dir, kind, state: "marca-ilegible", message: "La marca del almacén es ilegible." }; }
  if (m.installationId !== installationId || m.kind !== kind) return { dir, kind, state: "marca-ajena", message: `El almacén pertenece a otra instalación o a otra clase de almacén (${m.kind}). Se rechaza: compruebe CSAPP_UPLOAD_DIR y CSAPP_EXPORT_DIR.` };
  return { dir, kind, state: "ok", message: "Almacén enlazado a esta instalación." };
}

/** Adopta explícitamente almacenes existentes (restauración o traslado deliberados). Auditable: solo escribe la marca. */
export async function adoptStores(installationId: string): Promise<StoreVerdict[]> {
  const out: StoreVerdict[] = [];
  for (const kind of ["uploads", "exports"] as const) {
    const dir = storeDirs()[kind];
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, STORE_MARKER), JSON.stringify({ kind, installationId, createdAt: new Date().toISOString() } satisfies StoreMarker, null, 2) + "\n");
    out.push({ dir, kind, state: "ok", message: "Almacén adoptado." });
  }
  return out;
}

// ---------------------------------------------------------------- Diseño de rutas (puro, probado)

export type LayoutProblem = { code: string; message: string };
const within = (child: string, parent: string) => { const r = path.relative(parent, child); return r === "" || (!r.startsWith("..") && !path.isAbsolute(r)); };

/** Reglas de ubicación de los almacenes. `operational` exige rutas absolutas explícitas y fuera de la carpeta de la aplicación. */
export function checkStoreLayout(input: { uploads: string; exports: string; root: string; operational: boolean; uploadsExplicit: boolean; exportsExplicit: boolean }): LayoutProblem[] {
  const p: LayoutProblem[] = [];
  const { uploads, exports: ex, root } = input;
  if (input.operational) {
    if (!input.uploadsExplicit) p.push({ code: "UPLOAD_DIR_FALTA", message: "Falta CSAPP_UPLOAD_DIR: una instalación operativa exige una ruta absoluta explícita para los originales." });
    if (!input.exportsExplicit) p.push({ code: "EXPORT_DIR_FALTA", message: "Falta CSAPP_EXPORT_DIR: una instalación operativa exige una ruta absoluta explícita para las exportaciones." });
  }
  if (path.resolve(uploads) === path.resolve(ex)) p.push({ code: "ALMACENES_IGUALES", message: "Originales y exportaciones deben ser directorios distintos." });
  else if (within(uploads, ex) || within(ex, uploads)) p.push({ code: "ALMACENES_ANIDADOS", message: "Un almacén no puede estar dentro del otro." });
  for (const [name, dir] of [["originales", uploads], ["exportaciones", ex]] as const) {
    if (within(dir, path.join(root, "public"))) p.push({ code: "ALMACEN_PUBLICO", message: `El almacén de ${name} está dentro de public/: sería accesible sin sesión.` });
    if (within(dir, path.join(root, ".next"))) p.push({ code: "ALMACEN_EN_BUILD", message: `El almacén de ${name} está dentro de .next/: se perdería al recompilar.` });
    if (within(dir, path.join(root, "worker-dist"))) p.push({ code: "ALMACEN_EN_BUILD", message: `El almacén de ${name} está dentro de worker-dist/: se perdería al recompilar.` });
    if (input.operational && within(dir, root)) p.push({ code: "ALMACEN_EN_RELEASE", message: `El almacén de ${name} está dentro de la carpeta de la aplicación (${root}): una actualización o reinstalación del código podría borrarlo. Use un directorio persistente fuera de ella.` });
  }
  return p;
}

export function currentLayoutProblems(operational: boolean, env: Record<string, string | undefined> = process.env): LayoutProblem[] {
  const d = storeDirs();
  const abs = (v: string | undefined) => !!v && path.isAbsolute(v);
  const out = checkStoreLayout({ uploads: d.uploads, exports: d.exports, root: appRoot(), operational, uploadsExplicit: abs(env.CSAPP_UPLOAD_DIR), exportsExplicit: abs(env.CSAPP_EXPORT_DIR) });
  if (operational) {
    if (env.CSAPP_UPLOAD_DIR && !abs(env.CSAPP_UPLOAD_DIR)) out.push({ code: "UPLOAD_DIR_RELATIVA", message: "CSAPP_UPLOAD_DIR debe ser absoluta." });
    if (env.CSAPP_EXPORT_DIR && !abs(env.CSAPP_EXPORT_DIR)) out.push({ code: "EXPORT_DIR_RELATIVA", message: "CSAPP_EXPORT_DIR debe ser absoluta." });
  }
  return out;
}

export type StoreProbe = { dir: string; exists: boolean; writable: boolean; freeBytes: number | null; error?: string };
/** Acceso real: escribe y borra un archivo de sonda propio. Nunca toca archivos del almacén. */
export async function probeStore(dir: string): Promise<StoreProbe> {
  const st = await stat(dir).catch(() => null);
  if (!st?.isDirectory()) return { dir, exists: false, writable: false, freeBytes: null, error: "El directorio no existe." };
  const probe = path.join(dir, `.sonda-${process.pid}-${randomUUID().slice(0, 8)}`);
  let writable = false;
  let error: string | undefined;
  try { await writeFile(probe, "ok"); writable = true; } catch (e) { error = (e as NodeJS.ErrnoException).code ?? "sin acceso"; } finally { await rm(probe, { force: true }).catch(() => undefined); }
  const free = await statfs(dir).then((s) => Number(s.bavail) * Number(s.bsize)).catch(() => null);
  return { dir, exists: true, writable, freeBytes: free, error };
}
