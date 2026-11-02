import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";
import { APPROVED_ENV, parseTarget, registerClientTarget } from "@/lib/test-guard";

function createClient(): PrismaClient {
  const raw = getEnv().DATABASE_URL;
  // Protección de pruebas (CSAPP-07 §3): si el entorno declara una base de pruebas aprobada, ninguna conexión puede abrirse a otra.
  const approved = process.env[APPROVED_ENV];
  const target = parseTarget(raw);
  if (approved && target?.name !== approved) {
    throw new Error(`La conexión apunta a «${target?.name ?? "?"}» y el entorno de pruebas aprobó «${approved}»: no se abre.`);
  }
  registerClientTarget(target);
  const url = new URL(raw);
  // "schema" es un parámetro de Prisma, no de PostgreSQL: se pasa al adaptador.
  const schema = url.searchParams.get("schema") ?? "public";
  url.searchParams.delete("schema");
  // Solo para las medidas de volumen: cuenta las consultas ejecutadas (el motor económico no debe hacer una por grupo/mes).
  if (process.env.CSAPP_COUNT_QUERIES === "1") {
    const client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url.toString() }, { schema }),
      log: [{ emit: "event", level: "query" }],
    });
    const g = globalThis as unknown as { csappQueryCount?: number };
    g.csappQueryCount = 0;
    (client as unknown as { $on: (e: "query", cb: () => void) => void }).$on("query", () => {
      g.csappQueryCount = (g.csappQueryCount ?? 0) + 1;
    });
    return client as unknown as PrismaClient;
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.toString() }, { schema }),
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function real(): PrismaClient {
  return (globalForPrisma.prisma ??= createClient());
}

/**
 * Conexión única, solo para código de servidor. Se crea en el PRIMER uso, no al importar el módulo: una importación estática anticipada
 * (p. ej. un módulo de casos de prueba) ya no abre la base de trabajo antes de que el entorno de pruebas esté fijado (CSAPP-07 §3).
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_t, prop) {
    const c = real();
    const v = Reflect.get(c, prop, c);
    return typeof v === "function" ? v.bind(c) : v;
  },
});
