import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";

function createClient(): PrismaClient {
  const url = new URL(getEnv().DATABASE_URL);
  // "schema" es un parámetro de Prisma, no de PostgreSQL: se pasa al adaptador.
  const schema = url.searchParams.get("schema") ?? "public";
  url.searchParams.delete("schema");
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.toString() }, { schema }),
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Conexión única, solo para código de servidor. */
export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
