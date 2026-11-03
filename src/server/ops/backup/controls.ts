import type { Client } from "pg";
import type { Manifest } from "./manifest";

/**
 * Controles de contenido por tabla (CSAPP-10 §7). Para TODAS las tablas del esquema `public` (salvo el historial de migraciones de Prisma): recuento,
 * suma de comprobación de IDENTIDADES (clave primaria) y de CONTENIDO (fila completa). Las sumas son independientes del orden y se calculan en el servidor
 * (sin traer filas): `sum` de los primeros 60 bits de md5. Una sesión fija formato y zona horaria para que origen y restaurado den el mismo texto.
 */
export type Controls = Manifest["controls"]["tables"];

/** Agrupación documental de las tablas principales (informe de copia y de restauración). */
export const CONTROL_GROUPS: Record<string, string[]> = {
  usuarios: ["User", "Account", "Session", "Verification"],
  "clientes-grupos": ["ClientGroup", "Client", "Implementation", "ExternalIdentity", "ServiceTerm", "Milestone", "UserMatrix", "UserMatrixMonth", "HistoricGroupOrigin", "HistoricUserBase", "HistoricUserResolution"],
  personal: ["Person", "PersonAlias", "PersonTerm", "StaffCatalogItem"],
  lotes: ["UploadBatch", "UploadJob", "UploadStagedRow", "UploadRecordSource", "FinanceBatch"],
  "tickets-revisiones-observaciones": ["ZdTicket", "ZdTicketRevision", "ZdTicketObservation", "PapItem", "PapRevision", "PapObservation", "WorkItem", "WorkItemRevision", "WorkItemObservation", "WorkItemLink", "WorkItemLinkEvidence"],
  tiempos: ["ZdTimeEntry", "ZdTimeCorrection", "ZdTimeDecision", "WrikeTimeEntry", "WrikeTimeCorrection", "WrikeTimeDecision"],
  finanzas: ["FinanceRow", "FinanceScope", "FinanceDecision", "EconomicSettingsRevision", "ServiceAssignment"],
  "cobertura-health": ["UploadCoverageDeclaration", "HealthFeedback", "HealthFeedbackEvent", "QualityNote"],
  configuracion: ["ConfigRevision", "ConfigDraft"],
  auditoria: ["AuditEvent"],
  conciliacion: ["ReconRun"],
  exportaciones: ["ExportJob", "ExportFile", "ExportRow"],
  operacion: ["WorkerInstance", "InstallationMeta"],
};

export async function prepareSession(c: Client): Promise<void> {
  await c.query("SET datestyle = 'ISO, MDY'; SET intervalstyle = 'postgres'; SET extra_float_digits = 1; SET TimeZone = 'UTC'; SET bytea_output = 'hex'");
}

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

export async function listTables(c: Client): Promise<string[]> {
  const r = await c.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> '_prisma_migrations' ORDER BY c.relname`,
  );
  return r.rows.map((x) => x.relname);
}

async function pkColumns(c: Client, table: string): Promise<string[]> {
  const r = await c.query<{ attname: string }>(
    `SELECT a.attname FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace
     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (i.indkey)
     WHERE i.indisprimary AND n.nspname = 'public' AND t.relname = $1 ORDER BY array_position(i.indkey::int2[], a.attnum)`,
    [table],
  );
  return r.rows.map((x) => x.attname);
}

export async function collectControls(c: Client, opts: { countsOnly?: boolean; tables?: string[] } = {}): Promise<Controls> {
  await prepareSession(c);
  const out: Controls = {};
  for (const t of opts.tables ?? (await listTables(c))) {
    if (opts.countsOnly) {
      const r = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${q(t)}`);
      out[t] = { rows: Number(r.rows[0].n), idSum: "", contentSum: "" };
      continue;
    }
    const pk = await pkColumns(c, t);
    const idExpr = pk.length ? `concat_ws('|', ${pk.map((k) => `x.${q(k)}::text`).join(", ")})` : "x::text";
    const r = await c.query<{ n: string; ids: string; content: string }>(
      `SELECT count(*)::text AS n,
              coalesce(sum(('x' || substr(md5(${idExpr}), 1, 15))::bit(60)::bigint::numeric), 0)::text AS ids,
              coalesce(sum(('x' || substr(md5(x::text), 1, 15))::bit(60)::bigint::numeric), 0)::text AS content
       FROM ${q(t)} x`,
    );
    out[t] = { rows: Number(r.rows[0].n), idSum: r.rows[0].ids, contentSum: r.rows[0].content };
  }
  return out;
}

export type SchemaFacts = { migrations: string[]; failedMigrations: string[]; tables: number; foreignKeys: number; unvalidatedConstraints: string[]; triggers: string[] };

export async function collectSchemaFacts(c: Client): Promise<SchemaFacts> {
  const mig = await c.query<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>(`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name`).then((r) => r.rows, () => []);
  const tables = (await listTables(c)).length;
  const fk = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM pg_constraint k JOIN pg_namespace n ON n.oid = k.connamespace WHERE k.contype = 'f' AND n.nspname = 'public'`);
  const bad = await c.query<{ conname: string }>(`SELECT k.conname FROM pg_constraint k JOIN pg_namespace n ON n.oid = k.connamespace WHERE n.nspname = 'public' AND NOT k.convalidated`);
  const trg = await c.query<{ name: string }>(
    `SELECT c.relname || '.' || t.tgname AS name FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT t.tgisinternal AND n.nspname = 'public' ORDER BY 1`,
  );
  return {
    migrations: mig.filter((m) => m.finished_at && !m.rolled_back_at).map((m) => m.migration_name),
    failedMigrations: mig.filter((m) => !m.finished_at && !m.rolled_back_at).map((m) => m.migration_name),
    tables,
    foreignKeys: Number(fk.rows[0].n),
    unvalidatedConstraints: bad.rows.map((r) => r.conname),
    triggers: trg.rows.map((r) => r.name),
  };
}

export type ControlDiff = { table: string; field: "rows" | "idSum" | "contentSum" | "ausente" | "sobrante"; expected?: string; actual?: string };
export function diffControls(expected: Controls, actual: Controls, opts: { ignore?: Partial<Record<string, ("contentSum" | "idSum" | "rows")[]>> } = {}): ControlDiff[] {
  const diffs: ControlDiff[] = [];
  for (const [t, e] of Object.entries(expected)) {
    const a = actual[t];
    if (!a) { diffs.push({ table: t, field: "ausente" }); continue; }
    for (const f of ["rows", "idSum", "contentSum"] as const) {
      if (opts.ignore?.[t]?.includes(f)) continue;
      if (String(e[f]) !== String(a[f])) diffs.push({ table: t, field: f, expected: String(e[f]), actual: String(a[f]) });
    }
  }
  for (const t of Object.keys(actual)) if (!(t in expected)) diffs.push({ table: t, field: "sobrante" });
  return diffs;
}
