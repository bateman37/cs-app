import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Identidad del artefacto compilado y raíz de la aplicación (CSAPP-10 §3-4). Sin dependencias de servidor ni de la base: lo usan la web, el trabajador
 * compilado y las herramientas. La raíz NO depende del directorio de trabajo cuando se conoce el artefacto (trabajador: `worker-dist/..`) o `CSAPP_HOME`.
 */
export type BuildInfo = { version: string; sha: string; dirty: boolean; builtAt: string | null; node: string | null; migrations: string[]; known: boolean };

export function appRoot(): string {
  const home = process.env.CSAPP_HOME;
  if (home) return path.resolve(/*turbopackIgnore: true*/ home);
  const entry = process.argv[1] ? path.resolve(/*turbopackIgnore: true*/ process.argv[1]) : "";
  if (entry && path.basename(path.dirname(entry)) === "worker-dist") return path.dirname(path.dirname(entry));
  return path.resolve(/*turbopackIgnore: true*/ process.cwd());
}

let cached: BuildInfo | undefined;
export function buildInfo(): BuildInfo {
  if (cached) return cached;
  const file = path.join(appRoot(), "build-info.json");
  try {
    if (existsSync(file)) {
      const j = JSON.parse(readFileSync(file, "utf8")) as Partial<BuildInfo>;
      cached = { version: String(j.version ?? "0.0.0"), sha: String(j.sha ?? "desconocido"), dirty: !!j.dirty, builtAt: j.builtAt ?? null, node: j.node ?? null, migrations: Array.isArray(j.migrations) ? j.migrations.map(String) : [], known: true };
      return cached;
    }
  } catch { /* se cae al valor desconocido */ }
  cached = { version: "0.0.0", sha: "desconocido", dirty: false, builtAt: null, node: null, migrations: [], known: false };
  return cached;
}
/** Solo pruebas. */
export function resetBuildInfoCache(): void { cached = undefined; }

/**
 * Modo operativo: web/trabajador compilados con NODE_ENV=production que NO corren contra un destino de pruebas aprobado por el guard central (`CSAPP_APPROVED_TEST_DB`).
 * En modo operativo las opciones de prueba (perfiles sintéticos, contador de consultas) son un error de arranque, no se ignoran en silencio.
 */
export function isOperational(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "production" && !env.CSAPP_APPROVED_TEST_DB;
}
