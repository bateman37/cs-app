import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";

function createClient(): PrismaClient {
  const url = new URL(getEnv().DATABASE_URL);
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

/** Conexión única, solo para código de servidor. */
export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
