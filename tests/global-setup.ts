import { execSync } from "node:child_process";
import { testDatabaseUrl } from "./test-db";

/** Aplica las migraciones a la base de pruebas desde cero (instalación limpia) y la vacía. */
export default function setup() {
  const url = testDatabaseUrl();
  const env = { ...process.env, DATABASE_URL: url, SHADOW_DATABASE_URL: "" };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
}
