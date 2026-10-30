import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { databaseNameOf } from "@/lib/env";

/**
 * Migración incremental: se reproduce una base con el esquema y datos sintéticos de CSAPP-01
 * (solo la migración inicial) y se aplica CSAPP-02 por encima con `prisma migrate deploy`.
 * La base temporal es distinta de cs_app y de la base de pruebas habitual y su nombre acaba en _test.
 */
function withDb(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

describe("migración CSAPP-01 → CSAPP-02 sobre datos existentes", () => {
  it("conserva los datos de CSAPP-01 y añade las tablas nuevas sin reiniciar nada", async () => {
    const base = process.env.TEST_DATABASE_URL as string; // ya validada por global-setup
    const name = "cs_app_migra_test";
    expect(name).toMatch(/^cs_app(_[a-z0-9]+)*_test$/);
    expect(databaseNameOf(base)).not.toBe(name);
    const admin = new Client({ connectionString: withDb(base.replace(/\?schema=.*/, ""), "postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();

    const url = withDb(base, name);
    const raw = url.replace(/\?schema=.*/, "");
    const db = new Client({ connectionString: raw });
    await db.connect();
    try {
      const initial = readFileSync(path.join("prisma", "migrations", "20261029200318_base_acceso_y_maestros", "migration.sql"), "utf8");
      await db.query(initial);
      const env = { ...process.env, DATABASE_URL: url, SHADOW_DATABASE_URL: "" };
      execSync("npx prisma migrate resolve --applied 20261029200318_base_acceso_y_maestros", { env, stdio: "pipe" });
      // Datos sintéticos de CSAPP-01.
      await db.query(`INSERT INTO "User"("id","name","email","role","updatedAt") VALUES ('u1','Admin','a@test.local','ADMIN',now())`);
      await db.query(`INSERT INTO "ClientGroup"("id","name","updatedAt") VALUES ('g1','Grupo sintético',now())`);
      await db.query(`INSERT INTO "Client"("id","groupId","name","updatedAt") VALUES ('c1','g1','Cliente sintético',now())`);
      await db.query(`INSERT INTO "ServiceTerm"("id","attribute","value","clientId","validFrom","updatedAt") VALUES ('t1','HOSTING','OP','c1','2025-01-01',now())`);
      await db.query(`INSERT INTO "AuditEvent"("id","actorId","actorEmail","action","entityType","entityId","summary") VALUES ('e1','u1','a@test.local','CREATE','Client','c1','Alta sintética')`);

      execSync("npx prisma migrate deploy", { env, stdio: "pipe" });

      const counts = await db.query(`SELECT (SELECT count(*) FROM "ClientGroup") g, (SELECT count(*) FROM "Client") c, (SELECT count(*) FROM "ServiceTerm") t, (SELECT count(*) FROM "AuditEvent") a`);
      expect(counts.rows[0]).toEqual({ g: "1", c: "1", t: "1", a: "1" });
      const audit = await db.query(`SELECT "personId","batchId" FROM "AuditEvent" WHERE id='e1'`);
      expect(audit.rows[0]).toEqual({ personId: null, batchId: null });
      for (const table of ["Person", "PersonAlias", "PersonTerm", "StaffCatalogItem", "UserMatrix", "UserMatrixMonth", "UploadBatch", "UploadJob", "UploadStagedRow", "UploadRecordSource", "ZdTicket", "ZdTicketRevision", "ZdTicketObservation", "ZdTimeEntry", "ZdTimeCorrection", "ZdTimeDecision"]) {
        const r = await db.query(`SELECT to_regclass('public."${table}"') AS t`);
        expect(r.rows[0].t, table).not.toBeNull();
      }
      const roles = await db.query(`SELECT name FROM "StaffCatalogItem" WHERE kind='PMO_ROLE' ORDER BY name`);
      expect(roles.rows.map((r) => r.name)).toEqual(["ANA", "DEV"]);
      const applied = await db.query(`SELECT migration_name FROM _prisma_migrations ORDER BY migration_name`);
      expect(applied.rows).toHaveLength(3);
      // Repetir el despliegue no cambia nada.
      execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
    } finally {
      await db.end();
      const admin2 = new Client({ connectionString: withDb(base.replace(/\?schema=.*/, ""), "postgres") });
      await admin2.connect();
      await admin2.query(`DROP DATABASE IF EXISTS ${name}`);
      await admin2.end();
    }
  }, 120000);
});
