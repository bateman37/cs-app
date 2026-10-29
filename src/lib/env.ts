import { z } from "zod";

/** Nombre de base permitido: exclusivo de CS App (cs_app, cs_app_test, cs_app_prod...). */
const DB_NAME_PATTERN = /^cs_app(_[a-z0-9]+)*$/;

export function databaseNameOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

const dbUrl = (nombre: string) =>
  z
    .string({ error: `Falta la variable ${nombre}.` })
    .refine((v) => /^postgres(ql)?:\/\//.test(v), `${nombre} debe ser una URL postgresql://usuario:clave@host:puerto/base.`)
    .refine(
      (v) => DB_NAME_PATTERN.test(databaseNameOf(v)),
      `${nombre} debe apuntar a una base exclusiva de CS App (nombre cs_app, cs_app_test...). No se usan otras bases.`,
    );

const schema = z.object({
  DATABASE_URL: dbUrl("DATABASE_URL"),
  BETTER_AUTH_SECRET: z
    .string({ error: "Falta la variable BETTER_AUTH_SECRET." })
    .min(32, "BETTER_AUTH_SECRET debe tener 32 caracteres o más (genere uno al azar)."),
  BETTER_AUTH_URL: z
    .string({ error: "Falta la variable BETTER_AUTH_URL." })
    .url("BETTER_AUTH_URL debe ser la URL pública de la aplicación, por ejemplo http://localhost:3000."),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Valida las variables obligatorias; el error nunca incluye sus valores. */
export function getEnv(): Env {
  if (cached) return cached;
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const detalles = result.error.issues.map((i) => `- ${i.message}`).join("\n");
    throw new Error(
      `Configuración incompleta o inválida. Revise el archivo .env (modelo en .env.example):\n${detalles}`,
    );
  }
  cached = result.data;
  return cached;
}

/** Descripción del destino sin credenciales, para comprobaciones y registros. */
export function describeDatabase(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}/${databaseNameOf(url)}`;
  } catch {
    return "(URL no válida)";
  }
}
