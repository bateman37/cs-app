import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { TEST_DB_PATTERN, resolveTestTarget } from "@/lib/test-guard";

/**
 * Migración incremental CSAPP-10 → HOTFIX-01 (última carga manda, PAP con identidad única, instantánea activa de tiempos): una base con las nueve migraciones anteriores y datos
 * sintéticos recibe la nueva con `prisma migrate deploy` SIN reset; se conservan los datos y la auditoría, los PAP de listas distintas se consolidan por ID y es repetible.
 */
function withDb(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}
const PREVIAS = ["20261029200318_base_acceso_y_maestros", "20261029220244_personal_usuarios_cargas", "20261030080000_zendesk_tickets_y_tiempos", "20261030120000_wrike_pap_bugs", "20261031090000_finanzas_motor_economico", "20261102090000_pulse_calidad_configuracion", "20261103090000_calidad_health_cobertura", "20261104090000_exportaciones_conciliacion", "20261105090000_operacion_latido_instalacion"];

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


describe("migración CSAPP-10 → HOTFIX-01", () => {
  it("consolida PAP duplicados por ID sin perder revisiones, asigna la secuencia de recepción, marca la base heredada y reclasifica «Petición cliente»", async () => {
    await withTempDb("cs_app_migrahf_test", async (db, env) => {
      for (const m of PREVIAS) {
        await db.query(readFileSync(path.join("prisma", "migrations", m, "migration.sql"), "utf8"));
        execSync(`npx prisma migrate resolve --applied ${m}`, { env, stdio: "pipe" });
      }
      await db.query(`INSERT INTO "User"("id","name","email","role","updatedAt") VALUES ('u1','Admin','a@test.local','ADMIN',now())`);
      const batch = (id: string, profile: string, at: string, scope: string | null, status = "COMPLETED") =>
        db.query(`INSERT INTO "UploadBatch"(id,"profileId","profileVersion",status,"originalName","storageId","fileFormat","scopeKey","createdById","createdAt","updatedAt") VALUES ($1,$2,1,$3::"UploadStatus",'x',$1,'xlsx',$4,'u1',$5::timestamptz,now())`, [id, profile, status, scope, at]);
      await batch("b1", "pap", "2026-01-01T10:00:00Z", "lista-a");
      await batch("b2", "pap", "2026-02-01T10:00:00Z", "lista-b");
      await batch("b3", "pap", "2026-03-01T10:00:00Z", "lista-a");
      await batch("bz1", "zendesk-tiempo", "2026-01-05T10:00:00Z", null);
      await batch("bx", "pap", "2026-04-01T10:00:00Z", "lista-a", "REJECTED");
      const item = (id: string, list: string, pap: string, first: string) =>
        db.query(`INSERT INTO "PapItem"(id,"listKey","papId","firstBatchId","updatedAt") VALUES ($1,$2,$3,$4,now())`, [id, list, pap, first]);
      await item("i-a42", "lista-a", "42", "b1");
      await item("i-b42", "lista-b", "42", "b2");
      await item("i-a7", "lista-a", "7", "b1");
      const rev = (item: string, fp: string, no: number, batchId: string, title: string, state = "UNKNOWN") =>
        db.query(`INSERT INTO "PapRevision"(id,"itemId",fingerprint,"revisionNo",title,"correctiveState",data,"batchId") VALUES (DEFAULT,$1,$2,$3,$4,$5,'{}'::jsonb,$6) RETURNING id`, [item, fp, no, title, state, batchId]);
      const r1 = (await rev("i-a42", "fp-v1", 1, "b1", "ID 42: v1")).rows[0].id;
      const r2 = (await rev("i-b42", "fp-v2", 1, "b2", "ID 42: v2")).rows[0].id; // otra lista, contenido nuevo (la última por orden de carga)
      const r3 = (await rev("i-a42", "fp-v3", 2, "b3", "ID 42: v3")).rows[0].id; // lista-a, aún más reciente
      const r7 = (await rev("i-a7", "fp-7", 1, "b1", "ID 7: x")).rows[0].id;
      const obs = (item: string, b: string, r: string) => db.query(`INSERT INTO "PapObservation"("itemId","batchId","revisionId","observedOn","observedKind","receivedAt") VALUES ($1,$2,$3,'2026-01-01','RECEIVED',now())`, [item, b, r]);
      await obs("i-a42", "b1", r1); await obs("i-b42", "b2", r2); await obs("i-a42", "b3", r3); await obs("i-a7", "b1", r7);
      await db.query(`UPDATE "PapItem" SET "currentRevisionId" = $1, "currentObservationId" = (SELECT id FROM "PapObservation" WHERE "itemId" = 'i-a42' AND "batchId" = 'b3') WHERE id = 'i-a42'`, [r3]);
      await db.query(`UPDATE "PapItem" SET "currentRevisionId" = $1, "currentObservationId" = (SELECT id FROM "PapObservation" WHERE "itemId" = 'i-b42') WHERE id = 'i-b42'`, [r2]);
      await db.query(`INSERT INTO "PapCause"("revisionId","rawToken",normalized,category) VALUES ($1,'Petición Cliente','petición  cliente','OTHER'), ($1,'Evolutivo','evolutivo','EVOLUTIVE'), ($2,'Petición cliente','petición cliente','OTHER'), ($3,'Etiqueta nueva','etiqueta nueva','OTHER')`, [r3, r7, r2]);
      await db.query(`INSERT INTO "AuditEvent"(id,"actorId","actorEmail",action,"entityType","entityId",summary) VALUES ('a1','u1','a@test.local','UPLOAD','UploadBatch','b1','auditoría que se conserva')`).catch(() => undefined);
      await db.query(`INSERT INTO "ZdTimeEntry"("originFingerprint","firstBatchId","ticketId","workDate","loggedHours","loggedMinutes",minutes,fingerprint,"updatedAt") VALUES ('t1','bz1','1','2026-01-02',1,0,60,'t1',now()), ('t2','bz1','2','2026-01-03',2,0,120,'t2',now())`);
      await db.query(`INSERT INTO "UploadRecordSource"("batchId","profileId","dedupeKey",fingerprint,"firstPosition") VALUES ('bz1','zendesk-tiempo','','t1',1), ('bz1','zendesk-tiempo','','t2',2)`);

      execSync("npx prisma migrate deploy", { env, stdio: "pipe" }); // sin reset

      // Secuencia por orden de creación para los lotes recibidos; los rechazados no reciben; todos son base heredada.
      const seq = (await db.query(`SELECT id, "receptionSeq"::int AS s, "legacyBase" FROM "UploadBatch" ORDER BY "createdAt"`)).rows;
      expect(seq.map((r) => [r.id, r.s, r.legacyBase])).toEqual([["b1", 1, true], ["bz1", 2, true], ["b2", 3, true], ["b3", 4, true], ["bx", null, true]]);
      // Un solo PAP 42 y el 7; la versión activa es la de la última carga (b3), no la de «lista-b»; ninguna revisión ni observación se pierde.
      const items = (await db.query(`SELECT id, "papId", "listKey" FROM "PapItem" ORDER BY "papId"`)).rows;
      expect(items.map((r) => [r.papId, r.listKey])).toEqual([["42", "pap"], ["7", "pap"]]);
      expect(items[0].id).toBe("i-a42");
      const revs = (await db.query(`SELECT title, "revisionNo" FROM "PapRevision" WHERE "itemId" = 'i-a42' ORDER BY "revisionNo"`)).rows;
      expect(revs).toEqual([{ title: "ID 42: v1", revisionNo: 1 }, { title: "ID 42: v2", revisionNo: 2 }, { title: "ID 42: v3", revisionNo: 3 }]);
      expect((await db.query(`SELECT count(*)::int AS n FROM "PapObservation" WHERE "itemId" = 'i-a42'`)).rows[0].n).toBe(3);
      const cur = (await db.query(`SELECT r.title FROM "PapItem" t JOIN "PapRevision" r ON r.id = t."currentRevisionId" WHERE t.id = 'i-a42'`)).rows[0].title;
      expect(cur).toBe("ID 42: v3");
      expect((await db.query(`SELECT count(*)::int AS n FROM "UploadBatch" WHERE "profileId" = 'pap' AND "scopeKey" IS DISTINCT FROM 'pap'`)).rows[0].n).toBe(0);
      // «Petición cliente» (con variantes) queda reclasificada; las etiquetas desconocidas siguen OTHER; el estado correctivo se deriva.
      const causes = (await db.query(`SELECT "rawToken", category FROM "PapCause" ORDER BY id`)).rows;
      expect(causes.map((c) => c.category)).toEqual(["CLIENT_REQUEST", "EVOLUTIVE", "CLIENT_REQUEST", "OTHER"]);
      expect((await db.query(`SELECT "correctiveState" FROM "PapRevision" WHERE id = $1`, [r7])).rows[0].correctiveState).toBe("NON_CORRECTIVE");
      expect((await db.query(`SELECT "correctiveState" FROM "PapRevision" WHERE id = $1`, [r2])).rows[0].correctiveState).toBe("UNKNOWN");
      // La actividad heredada sigue activa (sin instantánea nueva) y las vistas la leen.
      expect((await db.query(`SELECT count(*)::int AS n FROM "TimeActivity" WHERE source = 'ZENDESK'`)).rows[0].n).toBe(2);
      expect((await db.query(`SELECT "batchId" FROM "ActiveTimeBatch" WHERE "profileId" = 'zendesk-tiempo'`)).rows[0].batchId).toBeNull();
      // Con un lote nuevo (no heredado) completado que solo trae una entrada, esa es la activa; las demás se conservan.
      await db.query(`INSERT INTO "UploadBatch"(id,"profileId","profileVersion",status,"originalName","storageId","fileFormat","createdById","receptionSeq","updatedAt") VALUES ('bz2','zendesk-tiempo',1,'COMPLETED','x','bz2','xlsx','u1',nextval('"UploadBatch_receptionSeq_seq"'),now())`);
      await db.query(`INSERT INTO "UploadRecordSource"("batchId","profileId","dedupeKey",fingerprint,"firstPosition") VALUES ('bz2','zendesk-tiempo','','t2',1)`);
      expect((await db.query(`SELECT count(*)::int AS n FROM "TimeActivity" WHERE source = 'ZENDESK'`)).rows[0].n).toBe(1);
      expect((await db.query(`SELECT count(*)::int AS n FROM "ZdTimeEntry"`)).rows[0].n).toBe(2);
      const diff = execSync("npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script", { env, stdio: "pipe" }).toString();
      expect(diff).toMatch(/empty migration|-- This is an empty migration/i);
      execSync("npx prisma migrate deploy", { env, stdio: "pipe" }); // repetible
    });
  }, 300000);
});
