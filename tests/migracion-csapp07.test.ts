import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { TEST_DB_PATTERN, resolveTestTarget } from "@/lib/test-guard";

/**
 * Migración incremental CSAPP-06 → CSAPP-07 (configuración versionada de Pulse Rent y Calidad): se reproduce una base con las cinco migraciones
 * anteriores y datos sintéticos, se aplica la nueva con `prisma migrate deploy` y se comprueba que conserva todo, crea las tablas, impone sus
 * restricciones, bloquea UPDATE/DELETE de revisiones y es repetible. La base temporal acaba en _test y es distinta de cs_app y de la de pruebas.
 */
function withDb(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}
const PREVIAS = ["20261029200318_base_acceso_y_maestros", "20261029220244_personal_usuarios_cargas", "20261030080000_zendesk_tickets_y_tiempos", "20261030120000_wrike_pap_bugs", "20261031090000_finanzas_motor_economico"];

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

describe("migración CSAPP-06 → CSAPP-07", () => {
  it("sobre datos de CSAPP-06 conserva todo, crea la configuración versionada con integridad e inmutabilidad y es repetible", async () => {
    await withTempDb("cs_app_migra07_test", async (db, env) => {
      for (const m of PREVIAS) {
        await db.query(readFileSync(path.join("prisma", "migrations", m, "migration.sql"), "utf8"));
        execSync(`npx prisma migrate resolve --applied ${m}`, { env, stdio: "pipe" });
      }
      await db.query(`INSERT INTO "User"("id","name","email","role","updatedAt") VALUES ('u1','Admin','a@test.local','ADMIN',now())`);
      await db.query(`INSERT INTO "ClientGroup"("id","name","updatedAt") VALUES ('g1','Grupo',now())`);
      await db.query(`INSERT INTO "UploadBatch"("id","profileId","profileVersion","status","originalName","storageId","fileFormat","createdById","updatedAt") VALUES ('b1','zendesk-tiempo',1,'COMPLETED','antiguo.xlsx','st1','xlsx','u1',now())`);
      await db.query(`INSERT INTO "ZdTimeEntry"("id","originFingerprint","firstBatchId","ticketId","workDate","loggedHours","loggedMinutes",minutes,fingerprint,"drvGroupId","drvEligibility","updatedAt") VALUES ('e1','f1','b1','100','2026-02-03',2,30,150,'f1','g1','ELIGIBLE',now())`);

      execSync("npx prisma migrate deploy", { env, stdio: "pipe" });

      expect((await db.query(`SELECT count(*)::int AS n FROM "ZdTimeEntry"`)).rows[0].n).toBe(1);
      expect((await db.query(`SELECT count(*)::int AS n FROM "EconomicSettingsRevision"`)).rows[0].n).toBe(1); // la economía no se reinicia
      for (const t of ["ConfigRevision", "ConfigDraft"]) expect((await db.query(`SELECT to_regclass('public."${t}"') AS t`)).rows[0].t, t).not.toBeNull();
      expect((await db.query(`SELECT count(*)::int AS n FROM "ConfigRevision"`)).rows[0].n).toBe(0); // sin semilla: la inicial se persiste al activar
      const ins = (family: string, no: number, kind = "ACTIVATION", restored: string = "NULL") =>
        db.query(`INSERT INTO "ConfigRevision"(family,"revisionNo",payload,kind,"restoredFromRevisionNo","activatedById") VALUES ('${family}',${no},'{}','${kind}',${restored},'u1')`);
      await ins("PULSE", 1, "INITIAL");
      await ins("QUALITY", 1, "INITIAL");
      await expect(ins("PULSE", 1)).rejects.toThrow(/family_revisionNo_key/); // una revisión por número y familia
      await expect(ins("OTRA", 2)).rejects.toThrow(/family_check/);
      await expect(ins("PULSE", 2, "RARO")).rejects.toThrow(/kind_check/);
      await expect(ins("PULSE", 0)).rejects.toThrow(/no_check/);
      await expect(ins("PULSE", 2, "ROLLBACK")).rejects.toThrow(/rollback_check/); // una reversión identifica su origen
      await expect(ins("PULSE", 3, "ACTIVATION", "1")).rejects.toThrow(/rollback_check/);
      await ins("PULSE", 2, "ROLLBACK", "1");
      await expect(db.query(`UPDATE "ConfigRevision" SET reason = 'x'`)).rejects.toThrow(/inmutables/);
      await expect(db.query(`DELETE FROM "ConfigRevision"`)).rejects.toThrow(/inmutables/);
      await db.query(`INSERT INTO "ConfigDraft"(family,payload,"baseRevisionNo","updatedAt") VALUES ('PULSE','{}',1,now())`);
      await expect(db.query(`INSERT INTO "ConfigDraft"(family,payload,"baseRevisionNo","updatedAt") VALUES ('PULSE','{}',1,now())`)).rejects.toThrow(/family_key/); // un borrador por familia
      await expect(db.query(`INSERT INTO "ConfigDraft"(family,payload,"baseRevisionNo","updatedAt") VALUES ('X','{}',1,now())`)).rejects.toThrow(/family_check/);
      execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
      expect((await db.query(`SELECT count(*)::int AS n FROM "ConfigRevision"`)).rows[0].n).toBe(3);
    });
  }, 240000);

  it("sobre una base limpia aplica las seis migraciones (y las posteriores)", async () => {
    await withTempDb("cs_app_migra07b_test", async (db, env) => {
      execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
      const applied = await db.query(`SELECT migration_name FROM _prisma_migrations ORDER BY migration_name`);
      expect(applied.rows.length).toBeGreaterThanOrEqual(6); // las seis anteriores intactas; las posteriores las cubre su propia prueba
      expect(applied.rows[5].migration_name).toBe("20261102090000_pulse_calidad_configuracion");
    });
  }, 240000);
});
