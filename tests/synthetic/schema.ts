import { prisma } from "@/lib/db";
import { resetRegistryCache } from "@/server/uploads/registry";

/**
 * Esquema auxiliar del perfil sintético. Vive SOLO en la base de test (lo crea el arranque de
 * pruebas); no hay migración de producción para estas tablas ficticias.
 */
const STATEMENTS = [
  `CREATE SCHEMA IF NOT EXISTS csapp_synthetic`,
  `CREATE TABLE IF NOT EXISTS csapp_synthetic.settings (key text PRIMARY KEY, value text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS csapp_synthetic.record (
     id bigserial PRIMARY KEY, fingerprint text NOT NULL UNIQUE, entity_key text, name text, fecha date,
     importe numeric, categoria text, batch_id text NOT NULL, is_current boolean NOT NULL DEFAULT true)`,
  `CREATE TABLE IF NOT EXISTS csapp_synthetic.scoped (
     id bigserial PRIMARY KEY, scope text NOT NULL, batch_id text NOT NULL, fingerprint text NOT NULL, entity_key text,
     name text, fecha date, importe numeric, categoria text)`,
  `INSERT INTO csapp_synthetic.settings (key, value) VALUES ('marker', 'synthetic'), ('rules_version', '1') ON CONFLICT DO NOTHING`,
];

export async function setupSyntheticSchema() {
  for (const s of STATEMENTS) await prisma.$executeRawUnsafe(s);
  resetRegistryCache();
}

export async function resetSynthetic() {
  await prisma.$executeRawUnsafe(`TRUNCATE csapp_synthetic.record, csapp_synthetic.scoped RESTART IDENTITY`);
  await prisma.$executeRawUnsafe(`UPDATE csapp_synthetic.settings SET value = '1' WHERE key = 'rules_version'`);
}

export async function setRulesVersion(v: string) {
  await prisma.$executeRawUnsafe(`UPDATE csapp_synthetic.settings SET value = '${v.replace(/'/g, "")}' WHERE key = 'rules_version'`);
}

export async function dropSyntheticSchema() {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS csapp_synthetic CASCADE`);
  resetRegistryCache();
}

export async function syntheticRecords() {
  return prisma.$queryRawUnsafe<{ entity_key: string; name: string; importe: string; is_current: boolean; batch_id: string }[]>(
    `SELECT entity_key, name, importe::text AS importe, is_current, batch_id FROM csapp_synthetic.record ORDER BY id`,
  );
}

export async function scopedRecords(scope: string) {
  return prisma.$queryRawUnsafe<{ entity_key: string; name: string; batch_id: string }[]>(
    `SELECT entity_key, name, batch_id FROM csapp_synthetic.scoped WHERE scope = '${scope.replace(/'/g, "")}' ORDER BY id`,
  );
}
