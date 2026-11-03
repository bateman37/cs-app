import { isOperational } from "@/lib/runtime";
import { currentLayoutProblems, ensureInstallationId, readInstallationId, verifyStore } from "./stores";

/**
 * Comprobación de arranque de web y trabajador (CSAPP-10 §3). Solo en modo OPERATIVO (producción sin opciones de prueba): impide un arranque con
 * configuración peligrosa en vez de crear en silencio otro almacén. Los fallos de configuración son fatales; una base momentáneamente caída NO lo es
 * (la web arranca y lo muestra en la comprobación de salud; el trabajador reintenta).
 */
export type StartupIssue = { code: string; message: string; fatal: boolean };

/** Opciones que CAMBIAN el comportamiento de la aplicación: en una instalación operativa impiden el arranque. */
export const FORBIDDEN_IN_OPERATION = ["CSAPP_ENABLE_SYNTHETIC_PROFILES", "CSAPP_APPROVED_TEST_DB", "CSAPP_COUNT_QUERIES"] as const;
/** Bases de pruebas y de desarrollo de migraciones: inertes en operación (ningún código operativo las lee), pero no deben heredarse; se avisa y `ops iniciar` las vacía en los procesos hijos. */
export const NOT_INHERITED_IN_OPERATION = ["TEST_DATABASE_URL", "SHADOW_DATABASE_URL"] as const;

export function operationalEnvIssues(env: Record<string, string | undefined> = process.env): StartupIssue[] {
  const out: StartupIssue[] = [];
  for (const k of FORBIDDEN_IN_OPERATION) {
    if (env[k]) out.push({ code: "OPCION_DE_PRUEBA", fatal: true, message: `${k} está definida en una instalación operativa: las opciones de prueba no se habilitan en producción. Retírela del entorno.` });
  }
  for (const k of NOT_INHERITED_IN_OPERATION) {
    if (env[k]) out.push({ code: "BASE_DE_PRUEBAS_HEREDADA", fatal: false, message: `${k} está definida en el entorno operativo: no se usa en producción, pero no debería heredarse. Retírela del .env de producción.` });
  }
  return out;
}

export async function startupIssues(role: "web" | "worker", env: Record<string, string | undefined> = process.env): Promise<StartupIssue[]> {
  if (!isOperational(env)) return [];
  const issues: StartupIssue[] = operationalEnvIssues(env);
  if (issues.some((i) => i.fatal)) return issues;
  for (const p of currentLayoutProblems(true, env)) issues.push({ code: p.code, message: p.message, fatal: true });
  if (issues.some((i) => i.fatal)) return issues;
  try {
    const id = (await readInstallationId()) ?? (role === "worker" ? await ensureInstallationId() : null);
    if (!id) {
      issues.push({ code: "INSTALACION_SIN_PREPARAR", fatal: false, message: "La instalación no está preparada: ejecute «npm run ops -- preparar»." });
    } else {
      for (const kind of ["uploads", "exports"] as const) {
        const v = await verifyStore(kind, id, { create: false });
        if (v.state === "marca-ajena" || v.state === "con-datos-sin-marca" || v.state === "marca-ilegible" || v.state === "no-es-directorio") issues.push({ code: `ALMACEN_${v.state.toUpperCase().replace(/-/g, "_")}`, fatal: true, message: v.message });
      }
    }
  } catch {
    issues.push({ code: "BASE_NO_DISPONIBLE_EN_ARRANQUE", fatal: false, message: "La base de datos no respondió durante la comprobación de arranque; se continúa y se reintentará." });
  }
  return issues;
}

/** Lanza si hay un problema fatal; los demás se devuelven para registrarlos. */
export async function assertStartup(role: "web" | "worker", log: (level: "INFO" | "WARN" | "ERROR", m: string) => void = () => {}): Promise<void> {
  const issues = await startupIssues(role);
  for (const i of issues) log(i.fatal ? "ERROR" : "WARN", `[${i.code}] ${i.message}`);
  const fatal = issues.filter((i) => i.fatal);
  if (fatal.length) throw new Error(`Arranque rechazado (${fatal.map((f) => f.code).join(", ")}). ${fatal[0].message}`);
}
