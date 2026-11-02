import "dotenv/config";
import { Client } from "pg";
import { writeFileSync } from "node:fs";

/**
 * Huella de datos (CSAPP-10 §9): recuento y resumen criptográfico por tabla, para demostrar que una actualización, una vuelta atrás o una restauración
 * conservan los datos (no solo que «arranca»). Solo LEE. Excluye lo que cambia legítimamente al operar (sesiones, latidos, identidad de instalación, historial de
 * migraciones). Uso: DATABASE_URL=… npx tsx scripts/huella-datos.ts [salida.json]
 */
const EXCLUDED = new Set(["_prisma_migrations", "WorkerInstance", "InstallationMeta", "Session", "session", "Account", "account", "Verification", "verification", "RateLimit", "rateLimit"]);
async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Falta DATABASE_URL.");
  const url = new URL(raw); url.searchParams.delete("schema");
  const c = new Client({ connectionString: url.toString() });
  await c.connect();
  const tables = (await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`)).rows.map((r) => r.table_name as string).filter((t) => !EXCLUDED.has(t));
  const out: Record<string, { n: number; md5: string }> = {};
  for (const t of tables) {
    const q = `SELECT count(*)::int AS n, COALESCE(md5(string_agg(h, '' ORDER BY h)), 'vacio') AS m FROM (SELECT md5(x::text) AS h FROM "${t.replace(/"/g, "")}" x) s`;
    const r = (await c.query(q)).rows[0];
    out[t] = { n: r.n, md5: r.m };
  }
  const dbName = (await c.query("SELECT current_database() AS d")).rows[0].d;
  await c.end();
  const res = { base: dbName, tablas: out, totalFilas: Object.values(out).reduce((s, v) => s + v.n, 0) };
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(res, null, 2));
  console.log(JSON.stringify({ base: res.base, tablas: Object.keys(out).length, totalFilas: res.totalFilas }));
}
main().catch((e) => { console.error(e instanceof Error ? e.message.split("\n")[0] : "error"); process.exit(1); });
