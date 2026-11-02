import "dotenv/config";
import { resolveTestTarget } from "@/lib/test-guard";

/**
 * Protección explícita (CSAPP-07 §3, guard central en src/lib/test-guard.ts): las pruebas solo corren contra una base aislada
 * declarada en TEST_DATABASE_URL (nombre cs_app…_test tomado del PATH de la URL) y distinta de la de trabajo.
 */
export function testDatabaseUrl(): string {
  return resolveTestTarget().url;
}
