import { randomBytes } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MANIFEST_FILE, MANIFEST_SHA_FILE, sha256Hex, type Manifest } from "@/server/ops/backup/manifest";

/** Manipulación de copias para las pruebas NEGATIVAS (CSAPP-10 §7-8): se altera siempre un clon, nunca la copia original. */
export async function cloneBackup(src: string, parent: string, name = `clon-${randomBytes(3).toString("hex")}`): Promise<string> {
  const dst = path.join(parent, name);
  await mkdir(parent, { recursive: true });
  await cp(src, dst, { recursive: true });
  return dst;
}

/** Reescribe el manifiesto aplicando `fn` y RECALCULA manifest.sha256 (un atacante coherente): solo así llega la prueba a las comprobaciones de contenido. */
export async function tamperManifest(dir: string, fn: (m: Manifest) => void, opts: { fixSha?: boolean } = {}): Promise<void> {
  const m = JSON.parse(await readFile(path.join(dir, MANIFEST_FILE), "utf8")) as Manifest;
  fn(m);
  const body = JSON.stringify(m, null, 2) + "\n";
  await writeFile(path.join(dir, MANIFEST_FILE), body);
  if (opts.fixSha !== false) await writeFile(path.join(dir, MANIFEST_SHA_FILE), `${sha256Hex(body)}  ${MANIFEST_FILE}\n`);
}
