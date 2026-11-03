import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { TEST_DB_PATTERN, resolveTestTarget } from "@/lib/test-guard";

/**
 * Migración HOTFIX-01 → HOTFIX-02 (enlace automático): una base con TODAS las migraciones anteriores y datos (lotes completados, maestros, decisión de precarga,
 * hechos con atribución antigua) recibe `20261110090000_hotfix02_enlace_automatico` con `prisma migrate deploy` SIN reset. Se comprueba que no recalcula filas
 * dentro de la migración (los derivados siguen como estaban), que deja PROGRAMADA la reparación con estado verificable, que las claves de nombre se normalizan
 * (NFC) sin perder datos y que es repetible y sin deriva.
 */
function withDb(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}
const NEW = "20261110090000_hotfix02_enlace_automatico";
const PREVIAS = readdirSync("prisma/migrations").filter((d) => /^\d{14}_/.test(d) && d < NEW).sort();

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

describe("migración HOTFIX-01 → HOTFIX-02", () => {
  it("programa la reparación sin recalcular, normaliza las claves de nombre, conserva los datos y es repetible y sin deriva", async () => {
    expect(PREVIAS.length).toBeGreaterThanOrEqual(12);
    await withTempDb("cs_app_migrahf2_test", async (db, env) => {
      for (const m of PREVIAS) {
        await db.query(readFileSync(path.join("prisma", "migrations", m, "migration.sql"), "utf8"));
        execSync(`npx prisma migrate resolve --applied ${m}`, { env, stdio: "pipe" });
      }
      await db.query(`INSERT INTO "User"("id","name","email","role","updatedAt") VALUES ('u1','Admin','a@test.local','ADMIN',now())`);
      const batch = (id: string, profile: string, status = "COMPLETED") =>
        db.query(`INSERT INTO "UploadBatch"(id,"profileId","profileVersion",status,"originalName","storageId","fileFormat","createdById","receptionSeq","updatedAt") VALUES ($1,$2,1,$3::"UploadStatus",'x',$1,'xlsx','u1',nextval('"UploadBatch_receptionSeq_seq"'),now())`, [id, profile, status]);
      await batch("bt", "zendesk-tickets");
      await batch("bz", "zendesk-tiempo");
      await batch("bw", "wrike");
      await batch("bp", "precarga-maestros");
      await db.query(`INSERT INTO "ClientGroup"(id,name,"updatedAt") VALUES ('g1','GRP ALFA',now())`);
      await db.query(`INSERT INTO "Client"(id,name,"groupId","updatedAt") VALUES ('c1','Alfa Uno','g1',now())`);
      // Equivalencias: una con tilde DESCOMPUESTA en la clave (escrita con la normalización anterior) y una de ID (no se toca).
      const nfd = "w-álamo sur";
      await db.query(`INSERT INTO "ExternalIdentity"(id,system,kind,"rawValue","searchValue","groupId","clientId","updatedAt") VALUES ('e1','WRIKE','PROJECT_NAME','W-Álamo  Sur',$1,'g1',NULL,now()), ('e2','ZENDESK','ORG_ID','710001','710001',NULL,'c1',now())`, [nfd]);
      await db.query(`INSERT INTO "MasterLoadDecision"(id,"batchId","checksum","reviewKey","kind","decision","reason","decidedById","decidedByEmail") VALUES ('d1','bp','sum','WRIKE_ALIAS:x','WRIKE_ALIAS','DISMISS','prueba','u1','a@test.local')`);
      await db.query(`INSERT INTO "ZdTicket"("ticketId","firstBatchId","updatedAt") VALUES ('1','bt',now())`);
      await db.query(`INSERT INTO "ZdTimeEntry"("originFingerprint","firstBatchId","ticketId","workDate","loggedHours","loggedMinutes",minutes,fingerprint,"updatedAt","drvBucket","drvVersion") VALUES ('t1','bz','1','2026-01-02',1,0,60,'t1',now(),'NO_CLIENT',7)`);
      await db.query(`INSERT INTO "AuditEvent"(id,"actorId","actorEmail",action,"entityType","entityId",summary) VALUES ('a1','u1','a@test.local','UPLOAD','UploadBatch','bt','auditoría que se conserva')`).catch(() => undefined);
      const counts = async () => (await db.query(`SELECT (SELECT count(*) FROM "ExternalIdentity")::int AS ids, (SELECT count(*) FROM "Client")::int AS clients, (SELECT count(*) FROM "ZdTimeEntry")::int AS zd, (SELECT count(*) FROM "MasterLoadDecision")::int AS dec, (SELECT count(*) FROM "UploadBatch")::int AS batches`)).rows[0];
      const before = await counts();

      execSync("npx prisma migrate deploy", { env, stdio: "pipe" }); // sin reset

      expect(await counts()).toEqual(before);
      // NO recalcula dentro de la migración: la fila de tiempo conserva su derivado antiguo y su versión.
      const e = (await db.query(`SELECT "drvBucket", "drvVersion" FROM "ZdTimeEntry"`)).rows[0];
      expect(e).toEqual({ drvBucket: "NO_CLIENT", drvVersion: 7 });
      // Reparación PROGRAMADA y verificable (hay lotes completados): pendiente, sin publicar nada.
      const rr = (await db.query(`SELECT status, reason, "requestedGeneration"::int AS req, "completedGeneration"::int AS done, "leaseOwner" FROM "RelationRefresh" WHERE scope = 'global'`)).rows[0];
      expect(rr).toEqual({ status: "PENDING", reason: "MIGRACION_HOTFIX02", req: expect.any(Number), done: 0, leaseOwner: null });
      expect(rr.req).toBeGreaterThanOrEqual(1);
      // La clave de nombre pasa a NFC y minúsculas con espacios colapsados; el original y la de ID no cambian.
      const k = (await db.query(`SELECT id, "rawValue", "searchValue" FROM "ExternalIdentity" ORDER BY id`)).rows;
      expect(k[0].searchValue).toBe("w-álamo sur");
      expect(k[0].rawValue).toBe("W-Álamo  Sur");
      expect(k[1].searchValue).toBe("710001");
      // Gemela de `nameKey`/`normalizeName` y disparador: una alta posterior de maestros solicita otra generación.
      expect((await db.query(`SELECT csapp_norm_name(E'  Caf\\u00e9\\u00a0  SA ') AS n`)).rows[0].n).toBe("café sa");
      await db.query(`INSERT INTO "ClientGroup"(id,name,"updatedAt") VALUES ('g2','GRP BETA',now())`);
      expect((await db.query(`SELECT "requestedGeneration"::int AS req FROM "RelationRefresh"`)).rows[0].req).toBeGreaterThan(rr.req);
      // Instalación vacía de lotes: no se programa nada (la primera alta de maestros crea la fila).
      expect((await db.query(`SELECT count(*)::int AS n FROM "AliasCandidate"`)).rows[0].n).toBe(0);
      const diff = execSync("npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script", { env, stdio: "pipe" }).toString();
      expect(diff).toMatch(/empty migration|-- This is an empty migration/i);
      execSync("npx prisma migrate deploy", { env, stdio: "pipe" }); // repetible
    });
  }, 300000);
});
