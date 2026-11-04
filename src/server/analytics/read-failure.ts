import "server-only";
import { schemaState } from "@/server/ops/health";
import { buildInfo } from "@/lib/runtime";

/**
 * Diagnóstico de un fallo de lectura de una vista (HOTFIX-04 §8). Clasifica la excepción real SIN esconderla ni convertirla en una cartera de ceros:
 *  - SCHEMA: el código compilado pide una tabla/columna que la base no tiene (migración sin aplicar), p. ej. `EconomicSettingsRevision.bandFactors` de
 *    `20261111090000_hotfix03_bandas_economicas`. La solución es aplicar las migraciones con el recorrido de actualización, nunca inventar la columna.
 *  - CONNECTION: la base no responde.
 *  - UNKNOWN: cualquier otra excepción; se muestra su tipo y primera línea (sin URL, credenciales ni datos nominativos).
 * El registro del servidor lleva el mismo diagnóstico seguro; al Administrador se le ofrece además el contexto de versión y migraciones.
 */
export type ReadFailure = {
  kind: "SCHEMA" | "CONNECTION" | "UNKNOWN";
  code: string | null;
  title: string;
  /** Líneas técnicas para el Administrador (ya redactadas). */
  detail: string[];
  /** Acción concreta y segura. */
  action: string;
};

const COLUMN_MIGRATION: Record<string, string> = { "EconomicSettingsRevision.bandFactors": "20261111090000_hotfix03_bandas_economicas", "MasterLinkDecision": "20261111090000_hotfix03_bandas_economicas" };

/** Quita URLs de conexión, credenciales y rutas de usuario; recorta. */
export function redactMessage(text: string): string {
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "(URL oculta)")
    .replace(/(password|passwd|pwd|secret|token)\s*[=:]\s*\S+/gi, "$1=(oculto)")
    .replace(/[A-Za-z]:\\[^\s"']+|\/(?:home|root|Users)\/[^\s"']+/g, "(ruta oculta)")
    .trim();
}

type PrismaLike = { code?: unknown; name?: unknown; message?: unknown; meta?: { column?: unknown; table?: unknown; modelName?: unknown } };

export function classifyReadError(e: unknown): Omit<ReadFailure, "detail"> & { detail: string[]; migration: string | null } {
  const x = (e ?? {}) as PrismaLike;
  const code = typeof x.code === "string" ? x.code : null;
  const name = typeof x.name === "string" ? x.name : "Error";
  const message = redactMessage(typeof x.message === "string" ? x.message : String(e));
  const lines = message.split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  const first = lines[0] ?? "";
  if (code === "P2022" || code === "P2021") {
    const col = typeof x.meta?.column === "string" ? x.meta.column : null;
    const table = typeof x.meta?.table === "string" ? x.meta.table : null;
    const what = (col ?? table ?? last.match(/`([^`]+)`/)?.[1] ?? "").replace(/^public\./, "");
    const migration = COLUMN_MIGRATION[what] ?? (what.startsWith("EconomicSettingsRevision.") ? COLUMN_MIGRATION["EconomicSettingsRevision.bandFactors"] : null);
    return {
      kind: "SCHEMA", code, migration,
      title: "El esquema de la base de datos no está actualizado para esta versión de la aplicación.",
      detail: [`${name} ${code}: ${last || first}`.slice(0, 400)],
      action: "Pare la aplicación, haga una copia verificada y ejecute «npm.cmd run db:migrar» (sin reset ni db push); después «npm.cmd run hotfix03:preparar», compile y arranque. Guía: docs/plan/guia-powershell-hotfix04.md.",
    };
  }
  if (code === "P1001" || code === "P1002" || code === "P1017" || /ECONNREFUSED|ECONNRESET|connect ETIMEDOUT|terminating connection|Can't reach database/i.test(message)) {
    return { kind: "CONNECTION", code, migration: null, title: "No hay conexión con la base de datos.", detail: [`${name}${code ? ` ${code}` : ""}: ${first}`.slice(0, 300)], action: "Compruebe que PostgreSQL está en marcha y que DATABASE_URL es correcta; después pulse Reintentar." };
  }
  const cause = last && last !== first ? ` → ${last}` : "";
  return { kind: "UNKNOWN", code, migration: null, title: "La lectura de la cartera lanzó una excepción inesperada.", detail: [`${name}${code ? ` ${code}` : ""}: ${first}${cause}`.slice(0, 500)], action: "Pulse Reintentar. Si persiste, copie este detalle: el registro del servidor contiene el mismo diagnóstico." };
}

/** Diagnóstico para el Administrador: clasificación + versión compilada y migraciones pendientes (solo si la base responde). Registra en el servidor. */
export async function diagnoseReadFailure(scope: string, e: unknown, admin: boolean): Promise<ReadFailure> {
  const c = classifyReadError(e);
  const stack = e instanceof Error ? redactMessage((e.stack ?? "").split("\n").slice(1, 4).join(" | ")) : "";
  console.error(`[${scope}] lectura fallida: ${c.kind} ${c.detail.join(" ")} ${stack}`.slice(0, 1200));
  const detail = [...c.detail];
  if (admin) {
    const b = buildInfo();
    detail.push(`Compilación: versión ${b.version}, SHA ${b.known ? b.sha.slice(0, 12) : "desconocido"}${b.dirty ? " (con cambios locales)" : ""}.`);
    if (c.kind === "SCHEMA") {
      if (c.migration) detail.push(`Migración esperada que falta: ${c.migration}.`);
      try {
        const s = await schemaState();
        detail.push(s.missing.length > 0 ? `Migraciones pendientes en la base: ${s.missing.join(", ")}.` : `Migraciones: ${s.applied}/${s.expected} aplicadas${s.failed.length ? `; fallidas: ${s.failed.join(", ")}` : ""}.`);
      } catch { detail.push("No se pudo comprobar el estado de las migraciones."); }
    }
  }
  return { kind: c.kind, code: c.code, title: c.title, detail, action: c.action };
}
