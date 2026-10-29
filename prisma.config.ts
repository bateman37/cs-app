import "dotenv/config";
import { defineConfig } from "prisma/config";

// Solo se usa desde la línea de comandos (migraciones, generate). La aplicación
// lee su configuración validada en src/lib/env.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL || undefined,
  },
});
