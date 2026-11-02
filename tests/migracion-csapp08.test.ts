import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { TEST_DB_PATTERN, resolveTestTarget } from "@/lib/test-guard";

/**
 * Migración incremental CSAPP-07 → CSAPP-08 (Client Health, notas de revisión y cobertura declarada de lotes): se reproduce una base con las seis migraciones
 * anteriores y datos sintéticos, se aplica la nueva con `prisma migrate deploy` y se comprueba que conserva todo, crea las tablas, impone sus
 * restricciones, bloquea UPDATE/DELETE de revisiones y es repetible. La base temporal acaba en _test y es distinta de cs_app y de la de pruebas.
 */
function withDb(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}
const PREVIAS = ["20261029200318_base_acceso_y_maestros", "20261029220244_personal_usuarios_cargas", "20261030080000_zendesk_tickets_y_tiempos", "20261030120000_wrike_pap_bugs", "20261031090000_finanzas_motor_economico", "20261102090000_pulse_calidad_configuracion"];

async function withTempDb<T>(name: string, fn: (db: Client, env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const approved = resolveTestTarget(); // destino de pruebas aprobado; la base temporal se crea en su servidor
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

describe("migración CSAPP-07 → CSAPP-08", () => {
  it("sobre datos de CSAPP-07 (incluida una ConfigRevision v1) conserva todo sin tocarla, crea Health/notas/cobertura con integridad y es repetible", async () => {
    await withTempDb("cs_app_migra08_test", async (db, env) => {
      for (const m of PREVIAS) {
        await db.query(readFileSync(path.join("prisma", "migrations", m, "migration.sql"), "utf8"));
        execSync(`npx prisma migrate resolve --applied ${m}`, { env, stdio: "pipe" });
      }
      await db.query(`INSERT INTO "User"("id","name","email","role","updatedAt") VALUES ('u1','Admin','a@test.local','ADMIN',now())`);
      await db.query(`INSERT INTO "ClientGroup"("id","name","updatedAt") VALUES ('g1','Grupo',now())`);
      await db.query(`INSERT INTO "Client"("id","name","groupId","updatedAt") VALUES ('c1','Cliente','g1',now())`);
      await db.query(`INSERT INTO "UploadBatch"("id","profileId","profileVersion","status","originalName","storageId","fileFormat","createdById","updatedAt") VALUES ('b1','zendesk-tickets',1,'COMPLETED','antiguo.xlsx','st1','xlsx','u1',now())`);
      const v1 = JSON.stringify({ schema: "quality-config-v1", marca: "carga v1 intacta" });
      await db.query(`INSERT INTO "ConfigRevision"(family,"revisionNo",payload,kind,"activatedById") VALUES ('QUALITY',1,$1::jsonb,'INITIAL','u1')`, [v1]);

      execSync("npx prisma migrate deploy", { env, stdio: "pipe" });

      expect((await db.query(`SELECT payload FROM "ConfigRevision" WHERE family = 'QUALITY'`)).rows[0].payload).toEqual(JSON.parse(v1)); // la revisión v1 no se actualiza ni recalibra
      expect((await db.query(`SELECT count(*)::int AS n FROM "UploadBatch"`)).rows[0].n).toBe(1);
      for (const t of ["HealthFeedback", "HealthFeedbackEvent", "QualityNote", "UploadCoverageDeclaration"]) expect((await db.query(`SELECT to_regclass('public."${t}"') AS t`)).rows[0].t, t).not.toBeNull();
      // Client Health: destino único, mes y estado cerrados, una celda por ámbito+entidad+año+mes
      const ins = (cols: string, vals: string) => db.query(`INSERT INTO "HealthFeedback"(${cols},year,month,state,"updatedById","updatedAt") VALUES (${vals},now())`);
      await ins('"groupId"', `'g1',2026,10,'POSITIVE','u1'`);
      await expect(ins('"groupId"', `'g1',2026,10,'NEGATIVE','u1'`)).rejects.toThrow(/groupId_year_month_key/);
      await ins('"clientId"', `'c1',2026,10,'MIXED','u1'`); // el Cliente es independiente del Grupo
      await expect(ins('"groupId","clientId"', `'g1','c1',2026,11,'POSITIVE','u1'`)).rejects.toThrow(/target_check/);
      await expect(ins('"groupId"', `'g1',2026,13,'POSITIVE','u1'`)).rejects.toThrow(/month_check/);
      await expect(ins('"groupId"', `'g1',2026,9,'EXCELENTE','u1'`)).rejects.toThrow(/state_check/);
      await expect(db.query(`INSERT INTO "HealthFeedback"(year,month,state,"updatedById","updatedAt") VALUES (2026,1,'POSITIVE','u1',now())`)).rejects.toThrow(/target_check/);
      await expect(db.query(`INSERT INTO "HealthFeedback"("groupId",year,month,state,comment,"updatedById","updatedAt") VALUES ('g1',2026,8,'NONE','texto','u1',now())`)).rejects.toThrow(/none_check/); // limpiar no deja comentario
      await expect(db.query(`INSERT INTO "HealthFeedback"("groupId",year,month,state,"updatedById","updatedAt") VALUES ('inexistente',2026,7,'POSITIVE','u1',now())`)).rejects.toThrow(/foreign key|fkey/i);
      // historial y declaraciones: solo se añaden
      await db.query(`INSERT INTO "HealthFeedbackEvent"("feedbackId",version,action,state,"byId") SELECT id,1,'CREATE','POSITIVE','u1' FROM "HealthFeedback" WHERE "groupId" = 'g1'`);
      await expect(db.query(`UPDATE "HealthFeedbackEvent" SET state = 'NEGATIVE'`)).rejects.toThrow(/solo añadir/);
      await expect(db.query(`DELETE FROM "HealthFeedbackEvent"`)).rejects.toThrow(/solo añadir/);
      await db.query(`INSERT INTO "UploadCoverageDeclaration"("batchId",version,population,"statusScope","coveredFrom","coveredTo",reason,"declaredById") VALUES ('b1',1,'ALL_CLIENTS','ALL_STATUSES','2026-01-01','2026-10-31','prueba','u1')`);
      await expect(db.query(`INSERT INTO "UploadCoverageDeclaration"("batchId",version,population,"statusScope",reason,"declaredById") VALUES ('b1',1,'ALL_CLIENTS','ALL_STATUSES','otra','u1')`)).rejects.toThrow(/batchId_version_key/);
      await expect(db.query(`INSERT INTO "UploadCoverageDeclaration"("batchId",version,population,"statusScope",reason,"declaredById") VALUES ('b1',2,'TODOS','ALL_STATUSES','x','u1')`)).rejects.toThrow(/population_check/);
      await expect(db.query(`INSERT INTO "UploadCoverageDeclaration"("batchId",version,population,"statusScope","coveredFrom","coveredTo",reason,"declaredById") VALUES ('b1',2,'ALL_CLIENTS','ALL_STATUSES','2026-10-31','2026-01-01','x','u1')`)).rejects.toThrow(/range_check/);
      await expect(db.query(`DELETE FROM "UploadCoverageDeclaration"`)).rejects.toThrow(/solo añadir/);
      await expect(db.query(`INSERT INTO "QualityNote"(year,month,topic,text,"authorId") VALUES (2026,10,'X','t','u1')`)).rejects.toThrow(/target_check/);
      execSync("npx prisma migrate deploy", { env, stdio: "pipe" }); // repetible
      expect((await db.query(`SELECT count(*)::int AS n FROM "HealthFeedback"`)).rows[0].n).toBe(2);
    });
  }, 300000);

  it("sobre una base limpia aplica las siete migraciones", async () => {
    await withTempDb("cs_app_migra08b_test", async (db, env) => {
      execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
      const applied = await db.query(`SELECT migration_name FROM _prisma_migrations ORDER BY migration_name`);
      expect(applied.rows.map((r) => r.migration_name).slice(0, 7)).toEqual([...PREVIAS, "20261103090000_calidad_health_cobertura"]);
    });
  }, 240000);
});
