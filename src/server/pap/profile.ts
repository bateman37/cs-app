import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { cleanText } from "@/domain/normalize";
import { todayMadrid } from "@/domain/vigencia";
import { PAP_HEADERS, PAP_PROFILE, PAP_RULES, correctiveState, parseBugRefs, parseCauses, parsePapTitle } from "@/domain/pap";
import { parseTicketRefList } from "@/domain/refs";
import { zendeskHosts } from "@/domain/wrike";
import { mapHeaders, parseDateCell, parseHourCell } from "@/domain/zendesk";
import type { ActivationContext, HeaderMatch, ImportProfile, Issue, Json, ParsedRow } from "../uploads/profile";
import type { Cell } from "../uploads/readers/types";
import { lockDerivation } from "../zendesk/derive";
import { writeStamp } from "../zendesk/preview";

type Tx = Prisma.TransactionClient;
type Header = (typeof PAP_HEADERS)[number];

const err = (code: string, message: string, column: string): Issue => ({ severity: "error", code, message, column });
const warn = (code: string, message: string, column: string): Issue => ({ severity: "warning", code, message, column });
const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

/** Lista de origen: identificador estable y validado del ámbito de los IDs de PAP (nunca inventado por archivo, año o posición). */
export const papListKey = (lista: string) => lista.trim().toLowerCase();

function matchHeaders(row: string[]): HeaderMatch {
  const m = mapHeaders(row, PAP_HEADERS);
  if (!m.ok) {
    return { ok: false, message: `El archivo no corresponde al perfil PAP (XLSX CARGA PAP, 29 columnas A–AC): ${m.message}.` };
  }
  const notes = m.extras.length > 0 ? [`Columnas adicionales informadas (se conservan en el bruto; no se usan): ${m.extras.join(", ")}.`] : [];
  return { ok: true, schemaVersion: "v1-29-columnas", context: { index: m.index }, notes };
}

function parseRow(cells: Cell[], context?: unknown): ParsedRow {
  const { index } = context as { index: Record<Header, number> };
  const cell = (h: Header) => cells[index[h]];
  const text = (h: Header) => cleanText(cell(h)?.v ?? "") || null;
  const issues: Issue[] = [];

  const title = text("Title");
  const id = title ? parsePapTitle(title) : null;
  if (!id) {
    issues.push(err("PAP_ID_NO_RECONOCIDO", title === null ? "Title está vacío: no hay identidad de PAP." : "Title no empieza por «ID número:» ni «número:»: no se reconoce la identidad (no se usa un hash del título ni otro número).", "Title"));
  }

  const date = (h: Header, label: string) => {
    const c = cell(h);
    if (!c || c.v.trim() === "") return { date: null as string | null, text: null as string | null };
    const d = parseDateCell(c);
    if (d.ok) return { date: d.value.date, text: null };
    issues.push(warn("FECHA_ILEGIBLE", `${label}: ${d.reason}; se conserva el texto y el PAP queda sin esa fecha.`, h));
    return { date: null, text: cleanText(c.v) };
  };
  const solicitud = date("Fecha de Solicitud", "Fecha de Solicitud");
  const produccion = date("Fecha puesta en producción", "Fecha puesta en producción");
  const hora = parseHourCell(cell("Hora"));

  const causes = parseCauses(cell("Causa raíz")?.v ?? "");
  const hosts = zendeskHosts();
  const refs: { kind: string; refId: string | null; product: string | null; raw: string; reason: string | null; key: string }[] = [];
  const addTickets = (header: Header, kind: string) => {
    const raw = cell(header)?.v ?? "";
    if (raw.trim() === "") return;
    const r = parseTicketRefList(raw, hosts);
    for (const x of r.refs) refs.push({ kind, refId: x.id, product: null, raw: x.raw, reason: null, key: x.id });
    for (const u of r.unparsed) refs.push({ kind: "TEXT", refId: null, product: null, raw: u.text, reason: `${header}: ${u.reason}`, key: `${kind}:${hash(u.text)}` });
  };
  addTickets("Tickets asociados", "TICKET_ASSOCIATED");
  addTickets("Ticket PAP Asociado", "TICKET_PAP");
  const bug = cell("Nº de BUG")?.v ?? "";
  if (bug.trim() !== "") {
    const r = parseBugRefs(bug);
    for (const x of r.refs) refs.push({ kind: "BUG", refId: x.id, product: x.product, raw: x.raw, reason: x.reason, key: `${x.product ?? "?"}|${x.id}` });
    for (const u of r.unparsed) refs.push({ kind: "TEXT", refId: null, product: null, raw: u.text, reason: `Nº de BUG: ${u.reason}`, key: `BUG:${hash(u.text)}` });
  }
  const cal = text("CAL's asociados");
  if (cal !== null) refs.push({ kind: "CAL", refId: null, product: null, raw: cal, reason: "CAL's asociados no son tickets Zendesk", key: hash(cal) });

  const typed: Record<string, Json> = {
    fecha_solicitud: solicitud.date,
    fecha_solicitud_texto: solicitud.text,
    title,
    proyecto: text("Proyecto"),
    resultado: text("Resultado"),
    responsable_tecnico: text("Responsable Técnico"),
    project_manager: text("Project Manager"),
    fecha_produccion: produccion.date,
    fecha_produccion_texto: produccion.text,
    hora: hora.value,
    duracion: text("Duración"),
    plataforma: text("Plataforma"),
    tipologia: text("Tipología"),
    changelog: text("Changelog"),
    urgente: text("Urgente"),
    version_remoto: text("Versión del remoto"),
    tareas_cs: text("Tareas Asociadas al CS"),
    afectaciones: text("Afectaciones al servicio"),
    requiere_formacion: text("¿Requiere formación?"),
    tickets_asociados: text("Tickets asociados"),
    cals: cal,
    notificar_ka: text("¿Notificar a Key Account?"),
    key_account: text("Key Account"),
    seguidores: text("Seguidores del ticket"),
    ticket_pap: text("Ticket PAP Asociado"),
    causa_raiz: causes.length > 0 ? causes.map((c) => c.raw).join(";#") : null,
    workaround: text("Workaround"),
    n_bug: text("Nº de BUG"),
    motivo_incidente: text("Motivo incidente"),
    tipo_elemento: text("Tipo de elemento"),
    ruta_acceso: text("Ruta de acceso"),
  };
  if (produccion.date === null && produccion.text === null) {
    issues.push(warn("SIN_FECHA_PRODUCCION", "Sin fecha de producción: se conserva y se muestra sin fecha de producción (no se inventa una ejecución).", "Fecha puesta en producción"));
  }
  if (causes.length === 0) issues.push(warn("SIN_CAUSA", "Causa raíz vacía: el PAP queda sin clasificar (no es «no correctivo» confirmado).", "Causa raíz"));
  else if (causes.some((c) => c.category === "OTHER")) {
    issues.push(warn("CAUSA_NO_CLASIFICADA", `Causa raíz con etiqueta no reconocida (${causes.filter((c) => c.category === "OTHER").map((c) => c.raw).join("; ")}): se conserva y requiere revisión.`, "Causa raíz"));
  }

  return {
    typed,
    derived: {
      papId: id?.id ?? null,
      causes: causes as unknown as Json,
      corrective: correctiveState(causes),
      refs: refs as unknown as Json,
    },
    issues,
    entityKey: id?.id,
  };
}

const staged = (batchId: string) => Prisma.sql`
  SELECT r.fingerprint, r.typed, r.derived, r.position FROM "UploadStagedRow" r
  WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' AND r."duplicateInFile" = false`;

async function recomputeCurrent(tx: Tx, ids: Prisma.Sql) {
  await tx.$executeRaw(Prisma.sql`
    UPDATE "PapItem" t SET "currentObservationId" = c.oid, "currentRevisionId" = c.rid, "updatedAt" = now()
    FROM (
      SELECT DISTINCT ON (o."itemId") o."itemId", o.id AS oid, o."revisionId" AS rid
      FROM "PapObservation" o WHERE o."itemId" IN (${ids})
      ORDER BY o."itemId", o."observedOn" DESC, o."receivedAt" DESC, o.id DESC) c
    WHERE t.id = c."itemId" AND (t."currentObservationId" IS DISTINCT FROM c.oid OR t."currentRevisionId" IS DISTINCT FROM c.rid)`);
}

/**
 * Ámbito de un proyecto PAP a la FECHA DE PRODUCCIÓN (sin fecha: solo equivalencias sin vigencia acotada). `src` produce: key, project,
 * production_date. Equivalencia PAP de Cliente o implantación; o, solo si no hay, la clave BC de un Grupo Cliente (solo grupo).
 * Un grupo solo no autoriza reparto entre hijos; no se inventa cliente ni implantación.
 */
export function papScopeSql(src: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT s.key,
      CASE WHEN s.project IS NULL THEN 'NO_PROJECT' WHEN pj.id IS NULL AND pg."groupId" IS NULL THEN 'UNMAPPED'
           WHEN pj."implementationId" IS NOT NULL THEN 'IMPLEMENTATION' WHEN pj."clientId" IS NOT NULL THEN 'CLIENT' ELSE 'GROUP_ONLY' END AS scope,
      COALESCE(pj."clientId", im."clientId") AS client_id, pj."implementationId" AS impl_id,
      COALESCE(pc."groupId", pg."groupId") AS group_id
    FROM (${src}) s
    LEFT JOIN LATERAL (
      SELECT e.id, e."clientId", e."implementationId" FROM "ExternalIdentity" e
      WHERE s.project IS NOT NULL AND e.system = 'PAP' AND e.kind IN ('PROJECT_NAME', 'PROJECT_ID') AND e."isActive"
        AND e."searchValue" IN (lower(s.project), s.project)
        AND (CASE WHEN s.production_date IS NULL THEN e."validFrom" IS NULL AND e."validTo" IS NULL
                  ELSE (e."validFrom" IS NULL OR e."validFrom" <= s.production_date) AND (e."validTo" IS NULL OR s.production_date < e."validTo") END)
      LIMIT 1) pj ON true
    LEFT JOIN LATERAL (
      SELECT e."groupId" FROM "ExternalIdentity" e
      WHERE s.project IS NOT NULL AND pj.id IS NULL AND e.system = 'BC' AND e.kind = 'GROUP_KEY' AND e."isActive" AND e."searchValue" = lower(s.project)
        AND (CASE WHEN s.production_date IS NULL THEN e."validFrom" IS NULL AND e."validTo" IS NULL
                  ELSE (e."validFrom" IS NULL OR e."validFrom" <= s.production_date) AND (e."validTo" IS NULL OR s.production_date < e."validTo") END)
      LIMIT 1) pg ON true
    LEFT JOIN "Implementation" im ON im.id = pj."implementationId"
    LEFT JOIN "Client" pc ON pc.id = COALESCE(pj."clientId", im."clientId")`;
}

/** Recalcula el ámbito de los PAP indicados con sus equivalencias actuales; solo escribe y versiona los que cambian. */
export async function rederivePapItems(tx: Tx, where: Prisma.Sql): Promise<number> {
  await tx.$executeRaw(Prisma.sql`DROP TABLE IF EXISTS "_pap_drv"`);
  await tx.$executeRaw(Prisma.sql`
    CREATE TEMP TABLE "_pap_drv" ON COMMIT DROP AS ${papScopeSql(Prisma.sql`
      SELECT t.id AS key, rv.project AS project, rv."productionDate" AS production_date
      FROM "PapItem" t LEFT JOIN "PapRevision" rv ON rv.id = t."currentRevisionId" WHERE ${where}`)}`);
  await tx.$executeRaw(Prisma.sql`CREATE INDEX ON "_pap_drv" (key)`);
  return tx.$executeRaw(Prisma.sql`
    UPDATE "PapItem" t SET "drvScope" = d.scope, "drvClientId" = d.client_id, "drvImplementationId" = d.impl_id, "drvGroupId" = d.group_id,
      "drvVersion" = t."drvVersion" + 1, "drvAt" = now(), "updatedAt" = now()
    FROM "_pap_drv" d
    WHERE t.id = d.key AND (t."drvScope", t."drvClientId", t."drvImplementationId", t."drvGroupId") IS DISTINCT FROM (d.scope, d.client_id, d.impl_id, d.group_id)`);
}

async function activate(tx: Tx, ctx: ActivationContext) {
  await lockDerivation(tx);
  const listKey = ctx.scopeKey ?? "";
  const observedOn = ctx.batch.declaredExtractionDate ?? todayMadrid(ctx.batch.createdAt);
  const kind = ctx.batch.declaredExtractionDate ? "DECLARED" : "RECEIVED";

  const newItems = await tx.$executeRaw(Prisma.sql`
    INSERT INTO "PapItem" ("listKey", "papId", "firstBatchId", "updatedAt")
    SELECT DISTINCT ${listKey}, s.derived->>'papId', ${ctx.batchId}, now() FROM (${staged(ctx.batchId)}) s
    ON CONFLICT ("listKey", "papId") DO NOTHING`);

  await tx.$executeRaw(Prisma.sql`DROP TABLE IF EXISTS "_pap_rev"`);
  await tx.$executeRaw(Prisma.sql`
    CREATE TEMP TABLE "_pap_rev" ON COMMIT DROP AS
    SELECT it.id AS iid, s.fingerprint, s.typed AS t, s.derived AS d, COALESCE(p."revisionNo", 0) + 1 AS rev_no, p.id AS prev_id,
      CASE WHEN p.id IS NULL THEN ARRAY[]::text[]
           ELSE ARRAY(SELECT k FROM jsonb_object_keys(s.typed) k WHERE p.data->k IS DISTINCT FROM s.typed->k ORDER BY k) END AS changed
    FROM (${staged(ctx.batchId)}) s
    JOIN "PapItem" it ON it."listKey" = ${listKey} AND it."papId" = s.derived->>'papId'
    LEFT JOIN LATERAL (SELECT x.id, x."revisionNo", x.data FROM "PapRevision" x WHERE x."itemId" = it.id ORDER BY x."revisionNo" DESC LIMIT 1) p ON true`);
  const revisions = await tx.$executeRaw(Prisma.sql`
    INSERT INTO "PapRevision" ("itemId", fingerprint, "revisionNo", title, project, result, "requestDate", "productionDate", "correctiveState", data,
      "previousRevisionId", "changedFields", "batchId")
    SELECT iid, fingerprint, rev_no, t->>'title', t->>'proyecto', t->>'resultado', (t->>'fecha_solicitud')::date, (t->>'fecha_produccion')::date,
      d->>'corrective', t, prev_id, changed, ${ctx.batchId}
    FROM "_pap_rev"
    ON CONFLICT ("itemId", fingerprint) DO NOTHING`);
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "PapCause" ("revisionId", "rawToken", normalized, category, origin)
    SELECT rv.id, c->>'raw', c->>'normalized', c->>'category', c->>'origin'
    FROM "_pap_rev" r JOIN "PapRevision" rv ON rv."itemId" = r.iid AND rv.fingerprint = r.fingerprint
    CROSS JOIN LATERAL jsonb_array_elements(r.d->'causes') c
    ON CONFLICT ("revisionId", normalized) DO NOTHING`);
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "PapReference" ("revisionId", kind, "refKey", "refId", product, "rawText", reason)
    SELECT rv.id, x->>'kind', x->>'key', x->>'refId', x->>'product', x->>'raw', x->>'reason'
    FROM "_pap_rev" r JOIN "PapRevision" rv ON rv."itemId" = r.iid AND rv.fingerprint = r.fingerprint
    CROSS JOIN LATERAL jsonb_array_elements(r.d->'refs') x
    ON CONFLICT ("revisionId", kind, "refKey") DO NOTHING`);
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "PapObservation" ("itemId", "batchId", "revisionId", "observedOn", "observedKind", "receivedAt")
    SELECT r.iid, ${ctx.batchId}, rv.id, ${observedOn}::date, ${kind}, ${ctx.batch.createdAt}
    FROM "_pap_rev" r JOIN "PapRevision" rv ON rv."itemId" = r.iid AND rv.fingerprint = r.fingerprint
    ON CONFLICT ("batchId", "itemId") DO NOTHING`);
  await recomputeCurrent(tx, Prisma.sql`SELECT iid FROM "_pap_rev"`);
  await rederivePapItems(tx, Prisma.sql`t.id IN (SELECT iid FROM "_pap_rev")`);
  await writeStamp(tx, ctx.batchId, "pap");
  return { inserted: newItems, revised: revisions - newItems };
}

/** Reversión (lote ya REVERTED): retira sus observaciones y solo las revisiones que ningún otro lote sustenta. Nunca restaura una revisión por encima de otra posterior vigente. */
async function revert(tx: Tx, ctx: ActivationContext) {
  await lockDerivation(tx);
  await tx.$executeRaw(Prisma.sql`DROP TABLE IF EXISTS "_pap_ids"`);
  await tx.$executeRaw(Prisma.sql`CREATE TEMP TABLE "_pap_ids" ON COMMIT DROP AS SELECT DISTINCT "itemId" AS iid FROM "PapObservation" WHERE "batchId" = ${ctx.batchId}`);
  await tx.$executeRaw(Prisma.sql`DELETE FROM "PapObservation" WHERE "batchId" = ${ctx.batchId}`);
  await tx.$executeRaw(Prisma.sql`
    DELETE FROM "PapRevision" r WHERE r."itemId" IN (SELECT iid FROM "_pap_ids")
      AND NOT EXISTS (SELECT 1 FROM "PapObservation" o WHERE o."revisionId" = r.id)`);
  await tx.$executeRaw(Prisma.sql`UPDATE "PapItem" t SET "currentObservationId" = NULL, "currentRevisionId" = NULL WHERE t.id IN (SELECT iid FROM "_pap_ids")`);
  await recomputeCurrent(tx, Prisma.sql`SELECT iid FROM "_pap_ids"`);
  await tx.$executeRaw(Prisma.sql`
    DELETE FROM "PapItem" t WHERE t.id IN (SELECT iid FROM "_pap_ids") AND NOT EXISTS (SELECT 1 FROM "PapRevision" r WHERE r."itemId" = t.id)`);
  await rederivePapItems(tx, Prisma.sql`t.id IN (SELECT iid FROM "_pap_ids")`);
}

export const pap: ImportProfile = {
  id: PAP_PROFILE,
  label: "PAP",
  description:
    "XLSX CARGA PAP (29 columnas A–AC; la consulta IQY no se ejecuta). La identidad es la lista de origen + el ID del inicio del título («ID 42:» o «42:»). " +
    "Una revisión no crea otra intervención; todas las causas se conservan y un PAP con varias cuenta una sola vez. El periodo es la fecha de puesta en producción.",
  version: 1,
  formats: ["xlsx"],
  policy: "INCORPORATE",
  metadataFields: [
    { name: "lista", label: "Lista de origen de los PAP (ámbito estable de los IDs, p. ej. «pap-principal»)", type: "text", required: true },
    { name: "hoja", label: "Hoja del libro (solo si hay varias hojas compatibles)", type: "text", required: false },
  ],
  metadataSchema: z
    .object({
      lista: z.string({ error: "Indique la lista de origen." }).trim().min(2, "Indique la lista de origen.").max(60).regex(/^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u, "La lista de origen solo admite letras, números, espacios, «_», «.» y «-»."),
      hoja: z.string().trim().max(120).optional(),
    })
    .strict(),
  scopeKey: (m) => papListKey(String(m.lista)),
  selectsSheet: true,
  blocksConfirmOnErrors: true,
  entityConflictPolicy: "conflict_all",
  matchHeaders,
  parseRow,
  async rulesFingerprint() {
    return PAP_RULES;
  },
  async postPrepare(tx, batchId) {
    await writeStamp(tx, batchId, "pap");
  },
  activate,
  revert,
  async rederive(tx, ctx) {
    await lockDerivation(tx);
    const updated = await rederivePapItems(
      tx,
      Prisma.sql`t.id IN (SELECT o."itemId" FROM "PapObservation" o WHERE o."batchId" = ${ctx.batchId})`,
    );
    await writeStamp(tx, ctx.batchId, "pap");
    return { updated };
  },
};
