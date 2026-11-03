import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, open, readdir, realpath, statfs } from "node:fs/promises";
import path from "node:path";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Utilidades de archivos para copias (CSAPP-10 §7): hash y copia por bloques (flujos; nunca un fichero entero en memoria), rutas relativas seguras y
 * comparación de directorios con enlaces simbólicos resueltos. Solo `node:path`/`node:fs` (sin shell; las rutas con espacios no se interpolan).
 */
export async function sha256File(file: string): Promise<{ sha256: string; bytes: number }> {
  const h = createHash("sha256");
  let bytes = 0;
  await pipeline(
    createReadStream(file),
    new Writable({
      write(chunk: Buffer, _e, cb) {
        bytes += chunk.length;
        h.update(chunk);
        cb();
      },
    }),
  );
  return { sha256: h.digest("hex"), bytes };
}

/** Copia por bloques calculando SHA-256 mientras escribe; el destino NO debe existir (`wx`). Termina con fsync. */
export async function copyFileHashed(src: string, dst: string): Promise<{ sha256: string; bytes: number }> {
  const h = createHash("sha256");
  let bytes = 0;
  await pipeline(
    createReadStream(src),
    new Transform({
      transform(chunk: Buffer, _e, cb) {
        bytes += chunk.length;
        h.update(chunk);
        cb(null, chunk);
      },
    }),
    createWriteStream(dst, { flags: "wx" }),
  );
  const fh = await open(dst, "r+");
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
  return { sha256: h.digest("hex"), bytes };
}

/** Archivo regular (no enlace simbólico, no directorio). */
export async function isRegularFile(p: string): Promise<boolean> {
  const st = await lstat(p).catch(() => null);
  return !!st && st.isFile() && !st.isSymbolicLink();
}

/** `child` es `parent` o está dentro (comparación léxica de rutas ya resueltas; en Windows `path.relative` ignora mayúsculas de unidad). */
export function isWithin(child: string, parent: string): boolean {
  const r = path.relative(path.resolve(parent), path.resolve(child));
  return r === "" || (!r.startsWith("..") && !path.isAbsolute(r));
}

/** Ruta real aunque aún no exista: resuelve enlaces del ancestro existente más profundo y vuelve a añadir lo que falta. */
export async function realPathLoose(p: string): Promise<string> {
  const abs = path.resolve(p);
  const rest: string[] = [];
  let cur = abs;
  for (;;) {
    try {
      return path.join(await realpath(cur), ...[...rest].reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return abs;
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

/** Relación de contención con enlaces resueltos (un enlace simbólico no permite colar un destino dentro de un almacén). */
export async function isWithinReal(child: string, parent: string): Promise<boolean> {
  return isWithin(await realPathLoose(child), await realPathLoose(parent));
}

export class UnsafePathError extends Error {}

/**
 * Ruta relativa del inventario: separador `/`, sin vacíos, `.`/`..`, sin absolutas (POSIX ni Windows: `C:`, `\\`), sin NUL ni barras invertidas.
 * Devuelve los segmentos. Lanza si escapa o no es normal.
 */
export function safeSegments(rel: string): string[] {
  if (typeof rel !== "string" || rel === "") throw new UnsafePathError("ruta vacía");
  if (rel.includes("\0") || rel.includes("\\") || rel.startsWith("/") || /^[a-zA-Z]:/.test(rel)) throw new UnsafePathError(`ruta no relativa o no portable: ${JSON.stringify(rel)}`);
  const segs = rel.split("/");
  for (const s of segs) if (s === "" || s === "." || s === "..") throw new UnsafePathError(`la ruta escapa o no es normal: ${JSON.stringify(rel)}`);
  return segs;
}

/** Une una ruta relativa segura a una base y comprueba por lstat que NINGÚN componente existente es un enlace simbólico. */
export async function resolveInside(base: string, rel: string): Promise<string> {
  const segs = safeSegments(rel);
  let cur = path.resolve(base);
  for (const s of segs) {
    cur = path.join(cur, s);
    const st = await lstat(cur).catch(() => null);
    if (st?.isSymbolicLink()) throw new UnsafePathError(`la ruta contiene un enlace simbólico: ${JSON.stringify(rel)}`);
  }
  if (!isWithin(cur, base)) throw new UnsafePathError(`la ruta escapa del directorio: ${JSON.stringify(rel)}`);
  return cur;
}

/** Espacio libre (bytes) del volumen del ancestro existente más cercano. */
export async function freeBytesAt(dir: string): Promise<number> {
  let cur = path.resolve(dir);
  for (;;) {
    try {
      const s = await statfs(cur);
      return Number(s.bavail) * Number(s.bsize);
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) throw new Error("No se pudo medir el espacio libre.");
      cur = parent;
    }
  }
}

export type ScanEntry = { name: string; kind: "file" | "dir" | "symlink" | "other" };
export async function scanDir(dir: string): Promise<ScanEntry[]> {
  const ents = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return ents.map((e) => ({ name: e.name, kind: e.isSymbolicLink() ? "symlink" : e.isFile() ? "file" : e.isDirectory() ? "dir" : "other" }));
}

/** Lista recursiva de archivos regulares con ruta relativa `/`; enlaces simbólicos y especiales se devuelven aparte (no se siguen). */
export async function walk(root: string): Promise<{ files: string[]; skipped: { rel: string; why: string }[] }> {
  const files: string[] = [];
  const skipped: { rel: string; why: string }[] = [];
  async function rec(dir: string, relDir: string) {
    for (const e of await scanDir(dir)) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.kind === "file") files.push(rel);
      else if (e.kind === "dir") await rec(path.join(dir, e.name), rel);
      else skipped.push({ rel, why: e.kind === "symlink" ? "enlace simbólico (no se sigue)" : "no es un archivo regular" });
    }
  }
  await rec(root, "");
  files.sort();
  return { files, skipped };
}
