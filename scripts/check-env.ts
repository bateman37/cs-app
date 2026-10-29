import "dotenv/config";
import { describeDatabase, getEnv } from "../src/lib/env";
import { prisma } from "../src/lib/db";

/** Comprueba configuración y destino de la base sin mostrar credenciales. */
async function main() {
  const env = getEnv();
  console.log(`Configuración válida. Base de datos de destino: ${describeDatabase(env.DATABASE_URL)}`);
  console.log(`URL pública de la aplicación: ${env.BETTER_AUTH_URL}`);
  const [{ current_database }] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  console.log(`Conexión correcta con la base «${current_database}».`);
  const migrations = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM information_schema.tables WHERE table_name = '_prisma_migrations'`;
  console.log(
    migrations[0].n > 0n
      ? "La base tiene el historial de migraciones de Prisma."
      : "La base está vacía: ejecute «npm run db:migrar» para crear las tablas.",
  );
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message.split("\n")[0].replace(/postgres(ql)?:\/\/\S+/g, "(URL oculta)") : "Error desconocido.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
