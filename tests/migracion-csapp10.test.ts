import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { TEST_DB_PATTERN, resolveTestTarget } from "@/lib/test-guard";

/**
 * Migración incremental CSAPP-09 → CSAPP-10 (latido de trabajador e identidad de instalación): una base con las OCHO migraciones anteriores y datos sintéticos de 09
 * (revisiones inmutables, cobertura, exportación LISTA y un informe de conciliación) recibe la nueva con `prisma migrate deploy` SIN reset; se conservan los datos, la migración
 * solo AÑADE (código de 09 compatible con el esquema nuevo: se demuestra comprobando que no altera ninguna tabla anterior) y es repetible. La base temporal acaba en _test.
 */
function withDb(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}
const PREVIAS = ["20261029200318_base_acceso_y_maestros", "20261029220244_personal_usuarios_cargas", "20261030080000_zendesk_tickets_y_tiempos", "20261030120000_wrike_pap_bugs", "20261031090000_finanzas_motor_economico", "20261102090000_pulse_calidad_configuracion", "20261103090000_calidad_health_cobertura", "20261104090000_exportaciones_conciliacion"];
const NUEVA = "20261105090000_operacion_latido_instalacion";

async function withTempDb<T>(name: string, fn: (db: Client, env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const approved = resolveTestTarget();
  expect(name).toMatch(TEST_DB_PATTERN);
  expect(name).not.toBe(approved.target.name);
  const base = approved.url;
  const admin = new Client({ connectionString: withDb(base.replace(/\?schema=.*/, ""), "postgres") });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = withDb(base, name);
  const db = new Client({ connectionString: url.replace(/\?schema=.*/, "") });
  await db.connect();
  try {
    return await fn(db, { ...process.env, DATABASE_URL: url, SHADOW_DATABASE_URL: "" });
  } finally {
    await db.end();
    const a2 = new Client({ connectionString: withDb(base.replace(/\?schema=.*/, ""), "postgres") });
    await a2.connect();
    await a2.query(`DROP DATABASE IF EXISTS ${name}`);
    await a2.end();
  }
}

describe("migración CSAPP-09 → CSAPP-10", () => {
  it("sobre datos de 09 conserva todo y solo añade WorkerInstance e InstallationMeta; no toca tablas anteriores; repetible", async () => {
    await withTempDb("cs_app_migra10_test", async (db, env) => {
      for (const m of PREVIAS) {
        await db.query(readFileSync(path.join("prisma", "migrations", m, "migration.sql"), "utf8"));
        execSync(`npx prisma migrate resolve --applied ${m}`, { env, stdio: "pipe" });
      }
      await db.query(`INSERT INTO "User"("id","name","email","role","updatedAt") VALUES ('u1','Admin','a@test.local','ADMIN',now())`);
      await db.query(`INSERT INTO "ClientGroup"("id","name","updatedAt") VALUES ('g1','Grupo',now())`);
      const v2 = JSON.stringify({ schema: "quality-config-v2", marca: "revisión v2 intacta" });
      await db.query(`INSERT INTO "ConfigRevision"(family,"revisionNo",payload,kind,"activatedById") VALUES ('QUALITY',1,$1::jsonb,'INITIAL','u1')`, [v2]);
      await db.query(`INSERT INTO "ExportJob"(id,"ownerId",dataset,query,status,"formatVersion","engineVersion","configRevisions","requestedStamp","requestedReadAt","requestedTotals") VALUES ('j1','u1','horas','{}'::jsonb,'READY','csv-v1','eco-v2+calidad-v2','{}'::jsonb,'abc',now(),'{}'::jsonb)`);
      await db.query(`INSERT INTO "ReconRun"(id,"actorId",params,stamp,"readAt",results,manifest,summary) VALUES ('r1','u1','{}'::jsonb,'abc',now(),'[]'::jsonb,'{}'::jsonb,'{}'::jsonb)`);
      const before = (await db.query(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, 2`)).rows;

      execSync("npx prisma migrate deploy", { env, stdio: "pipe" }); // sin reset

      expect((await db.query(`SELECT payload FROM "ConfigRevision" WHERE family = 'QUALITY'`)).rows[0].payload).toEqual(JSON.parse(v2));
      await expect(db.query(`UPDATE "ConfigRevision" SET reason = 'cambio'`)).rejects.toThrow(); // la revisión sigue siendo inmutable
      for (const [t, n] of [["ExportJob", 1], ["ReconRun", 1], ["User", 1], ["ClientGroup", 1]] as const) expect((await db.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n, t).toBe(n);
      // Solo se añaden las dos tablas nuevas: ninguna columna anterior cambia (el código de 09 sigue siendo compatible con este esquema).
      const after = (await db.query(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, 2`)).rows;
      const added = after.filter((r) => !before.some((b) => b.table_name === r.table_name && b.column_name === r.column_name));
      // Migraciones posteriores (p. ej. CSAPP-HOTFIX-01) añaden sus propias tablas: aquí solo se exige que estas dos estén y que ninguna columna anterior cambie.
      expect([...new Set(added.map((r) => r.table_name))].sort()).toEqual(expect.arrayContaining(["InstallationMeta", "WorkerInstance"]));
      expect(before.every((b) => after.some((a) => a.table_name === b.table_name && a.column_name === b.column_name && a.data_type === b.data_type))).toBe(true);
      // Integridad de las tablas nuevas
      await db.query(`INSERT INTO "WorkerInstance"(id,pid,host,version,sha) VALUES ('w1',1,'h','0.1.0','abc')`);
      await expect(db.query(`INSERT INTO "WorkerInstance"(id,pid,host,version,sha) VALUES ('w1',2,'h','0.1.0','abc')`)).rejects.toThrow(/WorkerInstance_pkey/);
      await expect(db.query(`INSERT INTO "WorkerInstance"(id,pid,host,version,sha,state) VALUES ('w2',2,'h','0.1.0','abc','CORRIENDO')`)).rejects.toThrow(/WorkerState|enum/i);
      await db.query(`INSERT INTO "InstallationMeta"(key,value) VALUES ('installation_id','x')`);
      await expect(db.query(`INSERT INTO "InstallationMeta"(key,value) VALUES ('installation_id','y')`)).rejects.toThrow(/InstallationMeta_pkey/);
      execSync("npx prisma migrate deploy", { env, stdio: "pipe" }); // repetible
    });
  }, 300000);

  it("sobre una base limpia aplica las nueve migraciones y el esquema no tiene deriva", async () => {
    await withTempDb("cs_app_migra10b_test", async (db, env) => {
      execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
      const applied = await db.query(`SELECT migration_name FROM _prisma_migrations ORDER BY migration_name`);
      expect(applied.rows.map((r) => r.migration_name).slice(0, 9)).toEqual([...PREVIAS, NUEVA]);
      const diff = execSync("npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script", { env, stdio: "pipe" }).toString();
      expect(diff).toMatch(/empty migration|-- This is an empty migration/i);
    });
  }, 240000);
});
