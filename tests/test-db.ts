import "dotenv/config";
import { databaseNameOf } from "@/lib/env";

/**
 * Protección explícita: las pruebas solo corren contra una base aislada cuyo nombre
 * acaba en _test y que es distinta de la de desarrollo.
 */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Falta TEST_DATABASE_URL (base aislada para pruebas, p. ej. cs_app_test).");
  const name = databaseNameOf(url);
  if (!/^cs_app(_[a-z0-9]+)*_test$/.test(name)) {
    throw new Error(`TEST_DATABASE_URL debe apuntar a una base cuyo nombre acabe en _test (cs_app_test). Recibido: ${name || "(vacío)"}.`);
  }
  if (process.env.DATABASE_URL && databaseNameOf(process.env.DATABASE_URL) === name) {
    throw new Error("TEST_DATABASE_URL no puede ser la misma base que DATABASE_URL.");
  }
  return url;
}
