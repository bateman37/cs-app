import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { TEST_DB_PATTERN, resolveTestTarget } from "@/lib/test-guard";

/**
 * Migración incremental CSAPP-08 → CSAPP-09 (exportaciones y conciliación): una base con las siete migraciones anteriores y datos sintéticos (incluida una
 * ConfigRevision v2 y una declaración de cobertura) recibe la nueva con `prisma migrate deploy` SIN reset; se conservan los datos y las revisiones inmutables,
 * se crean las cuatro tablas con su integridad y la migración es repetible. La base temporal acaba en _test y es distinta de cs_app y de la de pruebas.
 */
function withDb(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}
const PREVIAS = ["20261029200318_base_acceso_y_maestros", "20261029220244_personal_usuarios_cargas", "20261030080000_zendesk_tickets_y_tiempos", "20261030120000_wrike_pap_bugs", "20261031090000_finanzas_motor_economico", "20261102090000_pulse_calidad_configuracion", "20261103090000_calidad_health_cobertura"];
const NUEVA = "20261104090000_exportaciones_conciliacion";

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

describe("migración CSAPP-08 → CSAPP-09", () => {
  it("sobre datos de CSAPP-08 conserva todo (revisiones inmutables, cobertura, Health) y crea exportaciones y conciliación con integridad; repetible", async () => {
    await withTempDb("cs_app_migra09_test", async (db, env) => {
      for (const m of PREVIAS) {
        await db.query(readFileSync(path.join("prisma", "migrations", m, "migration.sql"), "utf8"));
        execSync(`npx prisma migrate resolve --applied ${m}`, { env, stdio: "pipe" });
      }
      await db.query(`INSERT INTO "User"("id","name","email","role","updatedAt") VALUES ('u1','Admin','a@test.local','ADMIN',now())`);
      await db.query(`INSERT INTO "ClientGroup"("id","name","updatedAt") VALUES ('g1','Grupo',now())`);
      await db.query(`INSERT INTO "UploadBatch"("id","profileId","profileVersion","status","originalName","storageId","fileFormat","createdById","updatedAt") VALUES ('b1','zendesk-tickets',1,'COMPLETED','antiguo.xlsx','st1','xlsx','u1',now())`);
      const v2 = JSON.stringify({ schema: "quality-config-v2", marca: "revisión v2 intacta" });
      await db.query(`INSERT INTO "ConfigRevision"(family,"revisionNo",payload,kind,"activatedById") VALUES ('QUALITY',1,$1::jsonb,'INITIAL','u1')`, [v2]);
      await db.query(`INSERT INTO "HealthFeedback"("groupId",year,month,state,"updatedById","updatedAt") VALUES ('g1',2026,10,'POSITIVE','u1',now())`);
      await db.query(`INSERT INTO "UploadCoverageDeclaration"("batchId",version,population,"statusScope",reason,"declaredById") VALUES ('b1',1,'ALL_CLIENTS','ALL_STATUSES','prueba','u1')`);

      execSync("npx prisma migrate deploy", { env, stdio: "pipe" }); // sin reset

      expect((await db.query(`SELECT payload FROM "ConfigRevision" WHERE family = 'QUALITY'`)).rows[0].payload).toEqual(JSON.parse(v2));
      await expect(db.query(`UPDATE "ConfigRevision" SET reason = 'cambio'`)).rejects.toThrow(); // la revisión sigue siendo inmutable
      expect((await db.query(`SELECT count(*)::int AS n FROM "UploadBatch"`)).rows[0].n).toBe(1);
      expect((await db.query(`SELECT count(*)::int AS n FROM "HealthFeedback"`)).rows[0].n).toBe(1);
      expect((await db.query(`SELECT count(*)::int AS n FROM "UploadCoverageDeclaration"`)).rows[0].n).toBe(1);
      for (const t of ["ExportJob", "ExportFile", "ExportRow", "ReconRun"]) expect((await db.query(`SELECT to_regclass('public."${t}"') AS t`)).rows[0].t, t).not.toBeNull();
      // Integridad de las nuevas tablas
      const job = (id: string, status = "QUEUED") => db.query(`INSERT INTO "ExportJob"(id,"ownerId",dataset,query,status,"formatVersion","engineVersion","configRevisions","requestedStamp","requestedReadAt","requestedTotals") VALUES ($1,'u1','horas','{}'::jsonb,$2::"ExportStatus",'csv-v1','eco','{}'::jsonb,'s',now(),'{}'::jsonb)`, [id, status]);
      await job("j1");
      await expect(job("j2", "GENERANDO")).rejects.toThrow(/ExportStatus|enum/i);
      await expect(db.query(`INSERT INTO "ExportJob"(id,"ownerId",dataset,query,"formatVersion","engineVersion","configRevisions","requestedStamp","requestedReadAt","requestedTotals") VALUES ('j3','nadie','horas','{}'::jsonb,'x','x','{}'::jsonb,'s',now(),'{}'::jsonb)`)).rejects.toThrow(/foreign key|fkey/i);
      await db.query(`INSERT INTO "ExportFile"(id,"jobId","fileKey",kind,name,rows,bytes,checksum,"storageId") VALUES ('f1','j1','horas','DATA','h.csv',1,10,'abc','11111111-1111-4111-8111-111111111111')`);
      await expect(db.query(`INSERT INTO "ExportFile"(id,"jobId","fileKey",kind,name,rows,bytes,checksum,"storageId") VALUES ('f2','j1','horas','DATA','h2.csv',1,10,'abc','22222222-2222-4222-8222-222222222222')`)).rejects.toThrow(/jobId_fileKey_part_key/); // un archivo vigente por parte
      await expect(db.query(`INSERT INTO "ExportFile"(id,"jobId","fileKey",part,kind,name,rows,bytes,checksum,"storageId") VALUES ('f3','j1','horas',2,'DATA','h3.csv',1,10,'abc','11111111-1111-4111-8111-111111111111')`)).rejects.toThrow(/storageId_key/);
      await db.query(`INSERT INTO "ExportRow"("jobId","fileKey",seq,cells) VALUES ('j1','horas',1,'["a"]'::jsonb)`);
      await expect(db.query(`INSERT INTO "ExportRow"("jobId","fileKey",seq,cells) VALUES ('j1','horas',1,'["b"]'::jsonb)`)).rejects.toThrow(/ExportRow_pkey/); // sin filas repetidas
      await db.query(`DELETE FROM "ExportJob" WHERE id = 'j1'`); // borrar el trabajo borra sus archivos registrados, no datos de negocio
      expect((await db.query(`SELECT count(*)::int AS n FROM "ExportFile"`)).rows[0].n).toBe(0);
      expect((await db.query(`SELECT count(*)::int AS n FROM "UploadBatch"`)).rows[0].n).toBe(1);
      execSync("npx prisma migrate deploy", { env, stdio: "pipe" }); // repetible
    });
  }, 300000);

  it("sobre una base limpia aplica las ocho migraciones", async () => {
    await withTempDb("cs_app_migra09b_test", async (db, env) => {
      execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
      const applied = await db.query(`SELECT migration_name FROM _prisma_migrations ORDER BY migration_name`);
      expect(applied.rows.map((r) => r.migration_name).slice(0, 8)).toEqual([...PREVIAS, NUEVA]);
      // El esquema real coincide con prisma/schema.prisma (sin deriva): `migrate diff` no propone cambios.
      const diff = execSync("npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script", { env, stdio: "pipe" }).toString();
      expect(diff).toMatch(/empty migration|-- This is an empty migration/i);
    });
  }, 240000);
});
