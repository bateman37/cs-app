import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { databaseNameOf } from "@/lib/env";

/**
 * Migración incremental CSAPP-02 → CSAPP-03 sobre datos existentes: se reproduce una base con las dos primeras
 * migraciones y datos sintéticos (incluido un lote de cargas) y se aplica CSAPP-03 con `prisma migrate deploy`.
 * La base temporal acaba en _test y es distinta de cs_app y de la base de pruebas habitual.
 */
function withDb(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

describe("migración CSAPP-02 → CSAPP-03 sobre datos existentes", () => {
  it("conserva los datos anteriores, añade las tablas de Zendesk y es repetible", async () => {
    const base = process.env.TEST_DATABASE_URL as string;
    const name = "cs_app_migra03_test";
    expect(name).toMatch(/^cs_app(_[a-z0-9]+)*_test$/);
    expect(databaseNameOf(base)).not.toBe(name);
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
      for (const m of ["20261029200318_base_acceso_y_maestros", "20261029220244_personal_usuarios_cargas"]) {
        await db.query(readFileSync(path.join("prisma", "migrations", m, "migration.sql"), "utf8"));
        execSync(`npx prisma migrate resolve --applied ${m}`, { env, stdio: "pipe" });
      }
      await db.query(`INSERT INTO "User"("id","name","email","role","updatedAt") VALUES ('u1','Admin','a@test.local','ADMIN',now())`);
      await db.query(`INSERT INTO "Person"("id","name","updatedAt") VALUES ('p1','Persona sintética',now())`);
      await db.query(`INSERT INTO "PersonAlias"("id","personId","system","kind","rawValue","searchValue","updatedAt") VALUES ('a1','p1','ZENDESK','ID','5001','5001',now())`);
      await db.query(`INSERT INTO "ClientGroup"("id","name","updatedAt") VALUES ('g1','Grupo sintético',now())`);
      await db.query(`INSERT INTO "Client"("id","groupId","name","updatedAt") VALUES ('c1','g1','Cliente sintético',now())`);
      await db.query(`INSERT INTO "UploadBatch"("id","profileId","profileVersion","status","originalName","storageId","fileFormat","createdById","updatedAt")
        VALUES ('b1','sintetico-incorporar',1,'COMPLETED','antiguo.csv','st1','csv','u1',now())`);

      execSync("npx prisma migrate deploy", { env, stdio: "pipe" });

      const old = await db.query(`SELECT (SELECT count(*) FROM "Person") p, (SELECT count(*) FROM "PersonAlias") a, (SELECT count(*) FROM "Client") c, (SELECT count(*) FROM "UploadBatch") b`);
      expect(old.rows[0]).toEqual({ p: "1", a: "1", c: "1", b: "1" });
      for (const table of ["ZdTicket", "ZdTicketRevision", "ZdTicketObservation", "ZdTimeEntry", "ZdTimeCorrection", "ZdTimeDecision"]) {
        const r = await db.query(`SELECT to_regclass('public."${table}"') AS t`);
        expect(r.rows[0].t, table).not.toBeNull();
      }
      const kinds = await db.query(`SELECT unnest(enum_range(NULL::"UploadJobKind"))::text AS k`);
      expect(kinds.rows.map((r) => r.k)).toEqual(["PREPARE", "ACTIVATE", "REVERT", "REDERIVE"]);
      // Las restricciones de integridad de dominio están activas.
      await expect(db.query(`INSERT INTO "ZdTicket"("ticketId","firstBatchId","updatedAt") VALUES ('abc','b1',now())`)).rejects.toThrow(/ZdTicket_id_digits/);
      await expect(
        db.query(`INSERT INTO "ZdTimeEntry"("originFingerprint","firstBatchId","ticketId","workDate","loggedHours","loggedMinutes",minutes,fingerprint,"updatedAt")
          VALUES ('f','b1','1','2024-01-01',-1,0,-60,'f',now())`),
      ).rejects.toThrow(/duration_non_negative/);
      const applied = await db.query(`SELECT migration_name FROM _prisma_migrations ORDER BY migration_name`);
      expect(applied.rows.map((r) => r.migration_name)).toEqual([
        "20261029200318_base_acceso_y_maestros",
        "20261029220244_personal_usuarios_cargas",
        "20261030080000_zendesk_tickets_y_tiempos",
        "20261030120000_wrike_pap_bugs",
        "20261031090000_finanzas_motor_economico",
      ]);
      execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
      const after = await db.query(`SELECT count(*) AS n FROM "UploadBatch"`);
      expect(after.rows[0].n).toBe("1");
    } finally {
      await db.end();
      const admin2 = new Client({ connectionString: withDb(base.replace(/\?schema=.*/, ""), "postgres") });
      await admin2.connect();
      await admin2.query(`DROP DATABASE IF EXISTS ${name}`);
      await admin2.end();
    }
  }, 120000);
});
