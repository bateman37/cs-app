import { testDatabaseUrl } from "./test-db";

// Antes de que cualquier módulo lea la configuración: la aplicación apunta a la base de pruebas.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.BETTER_AUTH_SECRET ||= "test-secret-0123456789abcdef0123456789abcdef";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
