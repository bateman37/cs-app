import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

/**
 * Migración incremental CSAPP-04 → CSAPP-05 sobre datos existentes: se reproduce una base con las cuatro migraciones anteriores y datos
 * sintéticos (grupo, equivalencias, tiempos de Zendesk y Wrike con la vista común) y se aplica la migración financiera con
 * `prisma migrate deploy`. La base temporal acaba en _test y es distinta de cs_app y de la base de pruebas habitual.
 */
function withDb(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}
const PREVIAS = ["20261029200318_base_acceso_y_maestros", "20261029220244_personal_usuarios_cargas", "20261030080000_zendesk_tickets_y_tiempos", "20261030120000_wrike_pap_bugs"];

async function withTempDb<T>(name: string, fn: (db: Client, env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const base = process.env.TEST_DATABASE_URL as string;
  expect(name).toMatch(/^cs_app(_[a-z0-9]+)*_test$/);
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

describe("migración CSAPP-04 → CSAPP-05", () => {
  it("sobre datos de CSAPP-04: conserva todo, amplía la vista y las equivalencias, siembra la configuración y es repetible", async () => {
    await withTempDb("cs_app_migra05_test", async (db, env) => {
      for (const m of PREVIAS) {
        await db.query(readFileSync(path.join("prisma", "migrations", m, "migration.sql"), "utf8"));
        execSync(`npx prisma migrate resolve --applied ${m}`, { env, stdio: "pipe" });
      }
      await db.query(`INSERT INTO "User"("id","name","email","role","updatedAt") VALUES ('u1','Admin','a@test.local','ADMIN',now())`);
      await db.query(`INSERT INTO "ClientGroup"("id","name","updatedAt") VALUES ('g1','Grupo',now())`);
      await db.query(`INSERT INTO "ExternalIdentity"("id","system","kind","rawValue","searchValue","groupId","updatedAt") VALUES ('i1','BC','GROUP_KEY','Acme','acme','g1',now())`);
      await db.query(`INSERT INTO "UploadBatch"("id","profileId","profileVersion","status","originalName","storageId","fileFormat","createdById","updatedAt")
        VALUES ('b1','zendesk-tiempo',1,'COMPLETED','antiguo.xlsx','st1','xlsx','u1',now())`);
      await db.query(`INSERT INTO "ZdTimeEntry"("id","originFingerprint","firstBatchId","ticketId","workDate","loggedHours","loggedMinutes",minutes,fingerprint,"drvGroupId","drvEligibility","updatedAt")
        VALUES ('e1','f1','b1','100','2025-02-03',2,30,150,'f1','g1','ELIGIBLE',now())`);
      await db.query(`INSERT INTO "WrikeTimeEntry"("id","originFingerprint","firstBatchId","taskName","projectName","explicitState","workDate",hours,minutes,fingerprint,"drvGroupId","drvEligibility","updatedAt")
        VALUES ('w1','w1','b1','tarea','Proyecto X','NONE','2025-02-03',0.5,30,'w1','g1','ELIGIBLE',now())`);

      execSync("npx prisma migrate deploy", { env, stdio: "pipe" });

      expect((await db.query(`SELECT count(*)::int AS n FROM "ZdTimeEntry"`)).rows[0].n).toBe(1);
      const v = await db.query(`SELECT source, minutes::float AS m, "groupId", "projectName", "ticketEntorno", "isInternal" FROM "TimeActivity" ORDER BY source`);
      expect(v.rows).toEqual([
        { source: "WRIKE", m: 30, groupId: "g1", projectName: "Proyecto X", ticketEntorno: null, isInternal: null },
        { source: "ZENDESK", m: 150, groupId: "g1", projectName: null, ticketEntorno: null, isInternal: null },
      ]);
      for (const t of ["FinanceBatch", "FinanceRow", "FinanceScope", "FinanceDecision", "EconomicSettingsRevision", "ServiceAssignment"]) {
        expect((await db.query(`SELECT to_regclass('public."${t}"') AS t`)).rows[0].t, t).not.toBeNull();
      }
      const cfg = await db.query(`SELECT "revisionNo", "targetEurosPerDay"::float AS t, "dayHours"::float AS h, "reconciliationTolerance"::float AS tol FROM "EconomicSettingsRevision"`);
      expect(cfg.rows).toEqual([{ revisionNo: 1, t: 550, h: 8, tol: 0.01 }]);
      // Wrike/PAP pueden apuntar a un Grupo con tipos de proyecto; el resto de combinaciones siguen prohibidas.
      await db.query(`INSERT INTO "ExternalIdentity"("id","system","kind","rawValue","searchValue","groupId","updatedAt") VALUES ('i2','WRIKE','PROJECT_NAME','Proyecto X','proyecto x','g1',now())`);
      await db.query(`INSERT INTO "ExternalIdentity"("id","system","kind","rawValue","searchValue","groupId","updatedAt") VALUES ('i3','PAP','PROJECT_ID','P1','P1','g1',now())`);
      await expect(db.query(`INSERT INTO "ExternalIdentity"("id","system","kind","rawValue","searchValue","groupId","updatedAt") VALUES ('i4','WRIKE','ORG_NAME','x','x','g1',now())`)).rejects.toThrow(/system_kind_target/);
      await expect(db.query(`INSERT INTO "ExternalIdentity"("id","system","kind","rawValue","searchValue","groupId","updatedAt") VALUES ('i5','ZENDESK','ORG_ID','9','9','g1',now())`)).rejects.toThrow(/system_kind_target/);
      await expect(db.query(`INSERT INTO "ExternalIdentity"("id","system","kind","rawValue","searchValue","groupId","updatedAt") VALUES ('i6','WRIKE','PROJECT_NAME','PROYECTO X','proyecto x','g1',now())`)).rejects.toThrow(/no_overlap/);
      // Restricciones financieras y de servicio.
      await expect(db.query(`INSERT INTO "FinanceScope"(year, category) VALUES (2026, 'OTRA')`)).rejects.toThrow(/category_check/);
      await expect(db.query(`INSERT INTO "EconomicSettingsRevision"("revisionNo","targetEurosPerDay","dayHours","reconciliationTolerance") VALUES (2, 0, 8, 0.01)`)).rejects.toThrow(/values_check/);
      await db.query(`INSERT INTO "ServiceAssignment"("id","matchKind","matchValue","searchValue","service","updatedAt") VALUES ('s1','ENTORNO','X','x','SOPORTE',now())`);
      await expect(db.query(`INSERT INTO "ServiceAssignment"("id","matchKind","matchValue","searchValue","service","updatedAt") VALUES ('s2','ENTORNO','X','x','OTROS',now())`)).rejects.toThrow(/no_overlap/);
      execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
      expect((await db.query(`SELECT count(*)::int AS n FROM "EconomicSettingsRevision"`)).rows[0].n).toBe(1);
    });
  }, 180000);

  it("sobre una base limpia aplica las cinco migraciones", async () => {
    await withTempDb("cs_app_migra05b_test", async (db, env) => {
      execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
      const applied = await db.query(`SELECT migration_name FROM _prisma_migrations ORDER BY migration_name`);
      expect(applied.rows).toHaveLength(5);
      expect((await db.query(`SELECT count(*)::int AS n FROM "EconomicSettingsRevision"`)).rows[0].n).toBe(1);
    });
  }, 180000);
});
