import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

/**
 * Migración incremental CSAPP-03 → CSAPP-04 sobre datos existentes: se reproduce una base con las tres primeras migraciones y
 * datos sintéticos de Zendesk (ticket, registro de tiempo, decisión y corrección) y se aplica la migración de Wrike, PAP y bugs
 * con `prisma migrate deploy`. La base temporal acaba en _test y es distinta de cs_app y de la base de pruebas habitual.
 */
function withDb(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

describe("migración CSAPP-03 → CSAPP-04 sobre datos existentes", () => {
  it("conserva los datos de Zendesk, añade Wrike/PAP/bugs, la vista común y es repetible", async () => {
    const base = process.env.TEST_DATABASE_URL as string;
    const name = "cs_app_migra04_test";
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
      const env = { ...process.env, DATABASE_URL: url, SHADOW_DATABASE_URL: "" };
      for (const m of ["20261029200318_base_acceso_y_maestros", "20261029220244_personal_usuarios_cargas", "20261030080000_zendesk_tickets_y_tiempos"]) {
        await db.query(readFileSync(path.join("prisma", "migrations", m, "migration.sql"), "utf8"));
        execSync(`npx prisma migrate resolve --applied ${m}`, { env, stdio: "pipe" });
      }
      await db.query(`INSERT INTO "User"("id","name","email","role","updatedAt") VALUES ('u1','Admin','a@test.local','ADMIN',now())`);
      await db.query(`INSERT INTO "UploadBatch"("id","profileId","profileVersion","status","originalName","storageId","fileFormat","createdById","updatedAt")
        VALUES ('b1','zendesk-tiempo',1,'COMPLETED','antiguo.xlsx','st1','xlsx','u1',now())`);
      await db.query(`INSERT INTO "ZdTimeEntry"("id","originFingerprint","firstBatchId","ticketId","workDate","loggedHours","loggedMinutes",minutes,fingerprint,"sourceId","updatedAt")
        VALUES ('e1','f1','b1','100','2025-02-03',2,30,150,'f1','88',now())`);
      await db.query(`INSERT INTO "ZdTimeDecision"("batchId","fingerprint","decision","targetEntryId","decidedById") VALUES ('b1','f1','CORRECTION','e1','u1')`);

      execSync("npx prisma migrate deploy", { env, stdio: "pipe" });

      const old = await db.query(`SELECT (SELECT count(*) FROM "ZdTimeEntry") e, (SELECT count(*) FROM "ZdTimeDecision") d, (SELECT "targetRevision" FROM "ZdTimeDecision") r`);
      expect(old.rows[0]).toEqual({ e: "1", d: "1", r: null });
      for (const t of ["WrikeTimeEntry", "WrikeTimeCorrection", "WrikeTimeDecision", "PapItem", "PapRevision", "PapObservation", "PapCause", "PapReference", "WorkItem", "WorkItemRevision", "WorkItemObservation", "WorkItemLink", "WorkItemLinkEvidence"]) {
        expect((await db.query(`SELECT to_regclass('public."${t}"') AS t`)).rows[0].t, t).not.toBeNull();
      }
      // La vista común distingue el origen y conserva los minutos decimales de los registros anteriores.
      await db.query(`INSERT INTO "WrikeTimeEntry"("originFingerprint","firstBatchId","taskName","explicitState","workDate",hours,minutes,fingerprint,"updatedAt")
        VALUES ('w1','b1','tarea','NONE','2025-02-03',0.5,30,'w1',now())`);
      const v = await db.query(`SELECT source, minutes::float AS m FROM "TimeActivity" ORDER BY source`);
      expect(v.rows).toEqual([{ source: "WRIKE", m: 30 }, { source: "ZENDESK", m: 150 }]);
      // Restricciones de dominio activas.
      await expect(
        db.query(`INSERT INTO "WrikeTimeEntry"("originFingerprint","firstBatchId","taskName","explicitState","workDate",hours,minutes,fingerprint,"updatedAt")
          VALUES ('w2','b1','t','NONE','2025-02-03',1,1,'w2',now())`),
      ).rejects.toThrow(/minutes_exact/);
      await expect(db.query(`INSERT INTO "WorkItem"("product","scopeKey","workItemId","firstBatchId","updatedAt") VALUES ('XXX','s','1','b1',now())`)).rejects.toThrow(/WorkItem_product/);
      await expect(db.query(`INSERT INTO "PapItem"("listKey","papId","firstBatchId","updatedAt") VALUES ('l','abc','b1',now())`)).rejects.toThrow(/PapItem_id_digits/);
      // Un registro no puede ser objetivo de dos filas del mismo lote.
      await expect(db.query(`INSERT INTO "ZdTimeDecision"("batchId","fingerprint","decision","targetEntryId","decidedById") VALUES ('b1','f2','CORRECTION','e1','u1')`)).rejects.toThrow(/one_target_per_batch/);

      execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
      expect((await db.query(`SELECT count(*) AS n FROM "ZdTimeEntry"`)).rows[0].n).toBe("1");
    } finally {
      await db.end();
      const admin2 = new Client({ connectionString: withDb(base.replace(/\?schema=.*/, ""), "postgres") });
      await admin2.connect();
      await admin2.query(`DROP DATABASE IF EXISTS ${name}`);
      await admin2.end();
    }
  }, 120000);
});
