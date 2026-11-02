// Escribe build-info.json (versión, SHA y migraciones esperadas) junto a la aplicación: web y trabajador lo leen para identificarse y para comprobar
// que el esquema aplicado coincide con el código compilado. Node puro (sin shell). El SHA sale de CSAPP_BUILD_SHA o de `git rev-parse HEAD`.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let sha = process.env.CSAPP_BUILD_SHA || "";
if (!sha) {
  try {
    sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    sha = "desconocido";
  }
}
let dirty = false;
try {
  dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() !== "";
} catch { /* sin git */ }
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const migrations = readdirSync(path.join(root, "prisma", "migrations"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const info = { version: pkg.version, sha, dirty, builtAt: new Date().toISOString(), node: process.version, migrations };
writeFileSync(path.join(root, "build-info.json"), JSON.stringify(info, null, 2) + "\n");
console.log(`build-info.json: versión ${info.version}, SHA ${sha.slice(0, 12)}${dirty ? " (con cambios sin confirmar)" : ""}, ${migrations.length} migraciones.`);
