import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { compare, d, mk, ZERO, type Check } from "./checks";
import { bridgeChecks } from "./bridge";
export type { Check, CheckStatus } from "./checks";
import { csvDocument, type CsvValue } from "@/domain/csv";
import { authorize } from "@/server/authorize";
import { DomainError } from "@/server/errors";
import { readDataStamp } from "@/server/analytics/stamp";
import type { Tx } from "@/server/analytics/snapshot";
import { getActive, getManifest } from "@/server/pulse/config";
import { selectorsOf } from "@/server/pulse/sql";
import { hourFacts, papFacts, ticketFacts } from "@/server/quality/facts";
import { parseExportRequest, resolveParams, type ExportRequest } from "@/server/exports/service";
import { DATASETS } from "@/server/exports/datasets";
import { ENGINE_VERSION } from "@/server/exports/config";

/**
 * Conciliación compartida y comprobable (CSAPP-09 §4), en Administración. SOLO LEE: no modifica fuentes, no activa configuración ni reprocesa lotes. Cada
 * ejecución se registra con su manifiesto (fuentes, lotes, revisiones, sello y fecha de lectura) y NUNCA se reescribe: si los datos cambian después, el informe
 * conserva sus resultados y avisa. Tres niveles — 1 fuente y lote, 2 hechos elegibles, 3 resultado (servicio de Calidad ↔ conjuntos de exportación ↔ SQL directo)
 * — con IDs estables (docs/validacion/conciliacion-contrato.md). Las pertenencias solapadas se etiquetan NO ADITIVAS y no se fuerza que coincidan.
 */
export type ReconParams = Pick<ExportRequest, "scope" | "sel" | "desde" | "hasta" | "servicio">;
export type ReconRunView = { id: string; createdAt: string; actor: string; params: ReconParams; stamp: string; readAt: string; results: Check[]; manifest: Record<string, unknown>; summary: { ok: number; difference: number; informative: number; unavailable: number }; stale: boolean; currentStamp: string | null };

const q = async <T>(tx: Tx, sql: Prisma.Sql) => tx.$queryRaw<T[]>(sql);

export async function runChecks(tx: Tx, p: ReconParams): Promise<{ checks: Check[]; manifest: Record<string, unknown> }> {
  const { params, context } = await resolveParams(tx, { ...p, dataset: "horas" } as ExportRequest);
  const { from, to } = params;
  const ids = params.ids ?? [];
  const checks: Check[] = [];
  const entFilter = (alias: string) => (p.sel ? Prisma.sql`AND ${Prisma.raw(`${alias}.${p.scope === "group" ? '"groupId"' : '"clientId"'}`)} = ${p.sel}` : Prisma.empty);

  // ---------------- Nivel 1: fuente y lote
  const srcMin = async (table: string) => (await q<{ n: bigint; m: string | null }>(tx, Prisma.sql`SELECT count(*) AS n, COALESCE(sum(minutes), 0)::text AS m FROM ${Prisma.raw(`"${table}"`)} WHERE "workDate" BETWEEN ${from}::date AND ${to}::date`))[0];
  const actMin = async (source: string) => (await q<{ n: bigint; m: string | null; u: bigint }>(tx, Prisma.sql`SELECT count(*) AS n, COALESCE(sum(minutes), 0)::text AS m, count(DISTINCT "entryId") AS u FROM "TimeActivity" t WHERE source = ${source} AND "workDate" BETWEEN ${from}::date AND ${to}::date`))[0];
  for (const [src, table, id] of [["ZENDESK", "ZdTimeEntry", "REC-N1-01"], ["WRIKE", "WrikeTimeEntry", "REC-N1-02"]] as const) {
    const s = await srcMin(table);
    const a = await actMin(src);
    let c = mk({ id, level: 1, title: `Horas ${src}: minutos conservados en la fuente = minutos de la proyección común de dedicación`, unit: "min", sources: [table, "TimeActivity"], notes: [`Filas fuente ${s.n}; filas proyectadas ${a.n}; identidades (source, entryId) distintas ${a.u}.`, "La conversión a horas es final (minutos ÷ 60); Wrike ya trae horas decimales convertidas a minutos en la carga: no se divide dos veces."] });
    c = compare(c, d(s.m), d(a.m));
    if (Number(a.n) !== Number(a.u)) c = { ...c, status: "DIFERENCIA", notes: [...c.notes, "Hay identidades (source, entryId) repetidas."] };
    checks.push(c);
  }
  const batches = await q<{ profileId: string; status: string; n: bigint; received: bigint; valid: bigint; err: bigint; dup: bigint; excl: bigint; imp: bigint }>(tx, Prisma.sql`
    SELECT "profileId", status::text, count(*) AS n, COALESCE(sum("rowsReceived"), 0) AS received, COALESCE(sum("rowsValid"), 0) AS valid, COALESCE(sum("rowsError"), 0) AS err, COALESCE(sum("rowsDuplicate"), 0) AS dup, COALESCE(sum("rowsExcluded"), 0) AS excl, COALESCE(sum("rowsImported"), 0) AS imp
    FROM "UploadBatch" WHERE status IN ('COMPLETED', 'REVERTED') GROUP BY 1, 2 ORDER BY 1, 2`);
  checks.push(mk({ id: "REC-N1-03", level: 1, title: "Lotes completados y revertidos por perfil: filas recibidas, válidas, con error, repetidas, excluidas e importadas", unit: "filas", additive: false, sources: ["UploadBatch"],
    notes: ["Particiones aditivas por lote: recibidas = válidas + con error + repetidas + excluidas se concilia en el resumen de cada carga (Administración › Cargas); aquí se informa para trazabilidad."],
    exclusions: batches.map((b) => ({ reason: `${b.profileId} · ${b.status} · ${b.n} lote(s): recibidas ${b.received}, válidas ${b.valid}, error ${b.err}, repetidas ${b.dup}, excluidas ${b.excl}, importadas ${b.imp}`, count: Number(b.n), amount: null })) }));
  const fin = await q<{ year: number; category: string; batch: string; income: string; control: string | null; tol: string; rows: bigint }>(tx, Prisma.sql`
    SELECT s.year, s.category, fb."batchId" AS batch, COALESCE(sum(r.income), 0)::text AS income, fb."controlIncome"::text AS control, fb.tolerance::text AS tol, count(r.id) AS rows
    FROM "FinanceScope" s JOIN "FinanceBatch" fb ON fb."batchId" = s."activeBatchId" LEFT JOIN "FinanceRow" r ON r."batchId" = fb."batchId"
    WHERE s.year BETWEEN extract(year FROM ${from}::date)::int AND extract(year FROM ${to}::date)::int GROUP BY 1, 2, 3, fb."controlIncome", fb.tolerance ORDER BY 1, 2`);
  if (fin.length === 0) checks.push(mk({ id: "REC-N1-04", level: 1, title: "Finanzas: suma de líneas activas = Total de origen (por año y categoría)", unit: "€", status: "NO_DISPONIBLE", notes: ["No hay conjunto financiero activo en los años del periodo: no se inventa ningún resultado."] }));
  for (const f of fin) {
    checks.push(compare(mk({ id: `REC-N1-04:${f.year}:${f.category}`, level: 1, title: `Finanzas ${f.year} ${f.category}: Σ líneas activas = Total de origen`, unit: "€", sources: ["FinanceScope", "FinanceBatch", "FinanceRow"], identities: [`lote ${f.batch}`], notes: [`${f.rows} líneas activas. Vta Potencial y Budget se conservan separados y no intervienen; el importe anual no se vuelve a sumar con sus meses. La tolerancia monetaria es la capturada por el lote (${f.tol} €); no se aplica a horas ni conteos.`] }), f.control === null ? null : d(f.control), d(f.income), d(f.tol)));
  }

  // ---------------- Nivel 2: hechos elegibles
  const part = await q<{ cls: string; bucket: string; n: bigint; m: string; ungrouped: bigint }>(tx, Prisma.sql`
    SELECT CASE eligibility WHEN 'ELIGIBLE' THEN 'ELEGIBLE' WHEN 'PENDING_ELIGIBILITY' THEN 'PENDIENTE' ELSE 'EXCLUIDA' END AS cls, bucket, count(*) AS n, COALESCE(sum(minutes), 0)::text AS m,
      count(*) FILTER (WHERE "groupId" IS NULL) AS ungrouped
    FROM "TimeActivity" t WHERE "workDate" BETWEEN ${from}::date AND ${to}::date ${entFilter("t")} GROUP BY 1, 2 ORDER BY 1, 2`);
  const total = part.reduce((s, r) => s.add(d(r.m)), ZERO);
  const totalDirect = d((await q<{ m: string }>(tx, Prisma.sql`SELECT COALESCE(sum(minutes), 0)::text AS m FROM "TimeActivity" t WHERE "workDate" BETWEEN ${from}::date AND ${to}::date ${entFilter("t")}`))[0].m);
  checks.push(compare(mk({ id: "REC-N2-01", level: 2, title: "Partición contable de horas: ELEGIBLE + PENDIENTE + EXCLUIDA = total del periodo (sin solapes)", unit: "min", sources: ["TimeActivity"],
    exclusions: part.map((r) => ({ reason: `${r.cls} · motivo ${r.bucket}`, count: Number(r.n), amount: `${r.m} min` })),
    notes: ["Antes del 01/01/2025 la elegibilidad usa Zendesk; desde esa fecha, por la FECHA DEL TRABAJO y la pertenencia histórica a PMO en ella: PMO viene de Wrike y el resto de Zendesk. Exclusiones y desconocidos se conservan separados: no se suman al numerador elegible ni se ocultan."] }), totalDirect, total));
  const eligibleUngrouped = part.filter((r) => r.cls === "ELEGIBLE").reduce((s, r) => s + Number(r.ungrouped), 0);
  checks.push(mk({ id: "REC-N2-02", level: 2, title: "Atribución de horas elegibles a Grupo/Cliente: filas elegibles sin Grupo (sin relación)", unit: "filas", status: eligibleUngrouped === 0 ? "OK" : "INFORMATIVO", expected: "0", observed: String(eligibleUngrouped), difference: String(eligibleUngrouped), sources: ["TimeActivity"], notes: ["Las horas elegibles sin Grupo no entran en ninguna cartera; se listan en el conjunto de exportación «horas» (grupo_id vacío) para su revisión."] }));
  const tk = await q<{ total: bigint; unattributed: bigint }>(tx, Prisma.sql`
    SELECT count(*) AS total, count(*) FILTER (WHERE x.entity IS NULL) AS unattributed FROM (${ticketSetSqlAll(params.scope, from, to)}) x`);
  checks.push(mk({ id: "REC-N2-03", level: 2, title: "Tickets creados en el periodo: atribuidos a una entidad frente a sin atribución", unit: "tickets", sources: ["ZdTicket", "ZdTicketRevision"], expected: tk[0].total.toString(), observed: String(Number(tk[0].total) - Number(tk[0].unattributed)), difference: String(-Number(tk[0].unattributed)), status: "INFORMATIVO",
    notes: ["Los tickets sin horas permanecen para Calidad. La diferencia son tickets sin organización resoluble (internos, sin relación): se conservan, no se descartan.", "El mes del escalado es la cohorte de CREACIÓN."] }));

  // ---------------- Nivel 3: resultado (servicio de Calidad ↔ conjuntos de exportación)
  const pulse = await getActive(tx, "PULSE");
  const scopeIds = ids;
  const hf = await hourFacts(tx, params.scope, scopeIds, from, to, selectorsOf(pulse.payload));
  const hfEligible = hf.filter((r) => r.bucketClass === "ELIGIBLE" && (p.servicio === "TOTAL" || r.svc === p.servicio)).reduce((s, r) => s.add(r.minutes), ZERO);
  const horas = DATASETS[0].files[0];
  const rowsH = await q<{ m: string }>(tx, Prisma.sql`SELECT COALESCE(sum(q.minutos::numeric), 0)::text AS m FROM (${horas.sql(params)}) q WHERE q.clase_particion = 'ELEGIBLE' AND (q.grupo_id IS NOT NULL OR q.cliente_id IS NOT NULL)`);
  checks.push(compare(mk({ id: "REC-N3-01", level: 3, title: "Horas elegibles: servicio de Calidad (hourFacts) = conjunto de exportación «horas» (ELEGIBLE atribuido) del mismo universo", unit: "min", sources: ["hourFacts", "export:horas"], notes: ["Misma consulta de dedicación para pantalla, detalle y CSV; el filtro de servicio aplica a ambos."] }), hfEligible, d(rowsH[0].m)));
  const tf = await ticketFacts(tx, params.scope, scopeIds, from, to);
  const sum = (k: "total" | "n3" | "union" | "inc") => [...tf.values()].reduce((s, r) => s + (k === "inc" ? r.inc + r.prob : r[k]), 0);
  const tickets = DATASETS[1].files[0];
  const tx1 = (await q<{ total: bigint; n3: bigint; flow: bigint; uni: bigint }>(tx, Prisma.sql`
    SELECT count(*) AS total, count(*) FILTER (WHERE q.es_n3 = 'true') AS n3, count(*) FILTER (WHERE q.es_flujo = 'true') AS flow, count(*) FILTER (WHERE q.afectacion_union = 'true') AS uni FROM (${tickets.sql(params)}) q`))[0];
  checks.push(compare(mk({ id: "REC-N3-02", level: 3, title: "Tickets creados: servicio de Calidad = conjunto «tickets»", unit: "tickets", sources: ["ticketFacts", "export:tickets"] }), d(String(sum("total"))), d(tx1.total.toString())));
  checks.push(compare(mk({ id: "REC-N3-03", level: 3, title: "Escalados N3 (unión PMO ∪ IT, un ticket una vez): servicio = conjunto", unit: "tickets", sources: ["ticketFacts", "export:tickets"], notes: ["PMO N3 e IT N3 son desgloses NO aditivos de esta unión."] }), d(String(sum("n3"))), d(tx1.n3.toString())));
  checks.push(compare(mk({ id: "REC-N3-04", level: 3, title: "Flujo de incidentes y problemas: servicio = conjunto", unit: "tickets", sources: ["ticketFacts", "export:tickets"] }), d(String(sum("inc"))), d(tx1.flow.toString())));
  const bugsFile = DATASETS[3].files[0];
  const bugCount = (await q<{ n: bigint }>(tx, Prisma.sql`SELECT count(*) AS n FROM (${bugsFile.sql(params)}) q WHERE q.cuenta_numerador = 'true'`))[0].n;
  checks.push(compare(mk({ id: "REC-N3-05", level: 3, title: "Sexto indicador: problemas únicos (causa estándar ∪ vínculo válido a Bug_) = filas que cuentan del conjunto «problemas_bugs» y = unión de «tickets»", unit: "problemas", sources: ["ticketFacts", "export:problemas_bugs"], additive: false, notes: ["Un problema con dos bugs cuenta una vez; un bug con dos problemas cuenta dos problemas. Bugs de producto y afectación a clientes son magnitudes separadas."] }), d(String(sum("union"))), d(bugCount.toString())));
  checks.push(compare(mk({ id: "REC-N3-06", level: 3, title: "Unión de «tickets» (afectacion_union) = unión del servicio", unit: "problemas", sources: ["ticketFacts", "export:tickets"] }), d(String(sum("union"))), d(tx1.uni.toString())));
  const pf = await papFacts(tx, params.scope, scopeIds, from, to);
  const papCorr = [...pf.values()].reduce((s, r) => s + r.corrective, 0);
  const papFile = DATASETS[2].files[0];
  const pc = (await q<{ n: bigint }>(tx, Prisma.sql`SELECT count(*) AS n FROM (${papFile.sql(params)}) q WHERE q.es_correctivo = 'true'`))[0].n;
  checks.push(compare(mk({ id: "REC-N3-07", level: 3, title: "PAP correctivos únicos (lista+ID; cualquier causa correctiva; sin filtro silencioso Resultado=OK): servicio = conjunto «pap»", unit: "PAP", sources: ["papFacts", "export:pap"], notes: ["Varias causas no multiplican el PAP; el origen cliente participa (desglose no aditivo)."] }), d(String(papCorr)), d(pc.toString())));
  // ---------------- Nivel 4: puente Comparativa / Análisis Cliente / Pulse Rent / Calidad (misma lectura, mismo periodo, servicio y ámbito)
  checks.push(...(await bridgeChecks(tx, { p: { scope: p.scope, sel: p.sel, desde: p.desde, hasta: p.hasta, servicio: p.servicio }, from, to, ids: scopeIds, hf, tf, pf })));
  const finFile = DATASETS[4].files[0];
  const ff = await q<{ m: string }>(tx, Prisma.sql`SELECT COALESCE(sum(q.ingreso::numeric), 0)::text AS m FROM (${finFile.sql(params)}) q`);
  const finDirect = fin.reduce((s, f) => s.add(d(f.income)), ZERO);
  checks.push(compare(mk({ id: "REC-N3-08", level: 3, title: "Ingreso de las líneas activas: conjunto «finanzas_lineas» = suma directa de líneas activas (años del periodo)", unit: "€", sources: ["export:finanzas_lineas", "FinanceRow"], notes: p.sel && p.scope === "group" ? ["Con un Grupo seleccionado el conjunto se limita a sus líneas; la suma directa de nivel 1 es de todo el año: se informa sin forzar igualdad."] : [] }), p.sel ? null : finDirect, p.sel ? null : d(ff[0].m)));

  const stampNow = (await readDataStamp(tx)).stamp;
  const batchesRead = await q<{ id: string; profileId: string; status: string; extracted: string | null; version: number }>(tx, Prisma.sql`SELECT id, "profileId", status::text, to_char("declaredExtractionDate", 'YYYY-MM-DD') AS extracted, version FROM "UploadBatch" WHERE status IN ('COMPLETED', 'REVERTED') ORDER BY "createdAt", id`);
  const manifest = { motor: ENGINE_VERSION, ambito: context, params: p, revisiones: await getManifest(tx), sello_datos: stampNow, fuentes: ["TimeActivity", "ZdTimeEntry", "WrikeTimeEntry", "ZdTicket", "ZdTicketRevision", "PapItem", "WorkItemLink", "FinanceScope", "FinanceRow", "UploadBatch"], lotes: batchesRead };
  return { checks, manifest };
}

const ticketSetSqlAll = (scope: "group" | "client", from: string, to: string) => {
  const col = scope === "group" ? Prisma.raw("tv.group_id") : Prisma.raw("tv.client_id");
  return Prisma.sql`SELECT ${col} AS entity FROM (${ticketViewSql(Prisma.sql`
    SELECT zt."ticketId" AS key, NULL::jsonb AS payload, rv0."organizationId" AS org_id, rv0."createdOn" AS created_on, rv0."causaRaiz" AS cause, rv0."typeKnown" AS type_known, rv0."statusKnown" AS status_known
    FROM "ZdTicket" zt JOIN "ZdTicketRevision" rv0 ON rv0.id = zt."currentRevisionId" WHERE rv0."createdOn" BETWEEN ${from}::date AND ${to}::date`)}) tv`;
};
import { ticketViewSql } from "@/server/zendesk/derive";

// ---------------------------------------------------------------- Ejecución registrada y lectura de informes

function summarize(checks: Check[]) {
  return { ok: checks.filter((c) => c.status === "OK").length, difference: checks.filter((c) => c.status === "DIFERENCIA").length, informative: checks.filter((c) => c.status === "INFORMATIVO").length, unavailable: checks.filter((c) => c.status === "NO_DISPONIBLE").length };
}

export async function runReconciliation(actorId: string, raw: unknown): Promise<ReconRunView> {
  await authorize(prisma, actorId, "ADMIN");
  const req = parseExportRequest({ dataset: "horas", ...(raw as object) });
  const params: ReconParams = { scope: req.scope, sel: req.sel, desde: req.desde, hasta: req.hasta, servicio: req.servicio };
  // Una sola lectura coherente de todo el informe; solo después se registra la ejecución (la comprobación no escribe en ninguna fuente).
  const out = await prisma.$transaction(
    async (tx) => {
      await authorize(tx, actorId, "ADMIN");
      const r = await runChecks(tx, params);
      const stamp = (await readDataStamp(tx)).stamp;
      const readAt = (await tx.$queryRaw<{ t: Date }[]>(Prisma.sql`SELECT now() AS t`))[0].t;
      return { ...r, stamp, readAt };
    },
    { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 600_000 },
  );
  const row = await prisma.reconRun.create({ data: { actorId, params: params as unknown as Prisma.InputJsonValue, stamp: out.stamp, readAt: out.readAt, results: out.checks as unknown as Prisma.InputJsonValue, manifest: out.manifest as unknown as Prisma.InputJsonValue, summary: summarize(out.checks) }, include: { actor: { select: { email: true } } } });
  return toView(row, out.stamp);
}

type RunRow = Prisma.ReconRunGetPayload<{ include: { actor: { select: { email: true } } } }>;
function toView(r: RunRow, currentStamp: string | null): ReconRunView {
  return { id: r.id, createdAt: r.createdAt.toISOString(), actor: r.actor.email, params: r.params as unknown as ReconParams, stamp: r.stamp, readAt: r.readAt.toISOString(), results: r.results as unknown as Check[], manifest: r.manifest as Record<string, unknown>, summary: r.summary as ReconRunView["summary"], stale: currentStamp !== null && currentStamp !== r.stamp, currentStamp };
}

/** Informe anterior: conserva sus resultados y AVISA si los datos actuales han cambiado (no se reescribe en silencio). */
export async function getReconRun(actorId: string, id: string): Promise<ReconRunView> {
  await authorize(prisma, actorId, "ADMIN");
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new DomainError("Informe no encontrado.");
  const r = await prisma.reconRun.findUnique({ where: { id }, include: { actor: { select: { email: true } } } });
  if (!r) throw new DomainError("Informe no encontrado.");
  const now = await prisma.$transaction((tx) => readDataStamp(tx), { isolationLevel: "RepeatableRead" });
  return toView(r, now.stamp);
}
export async function listReconRuns(actorId: string, limit = 10): Promise<{ id: string; createdAt: string; actor: string; params: ReconParams; summary: ReconRunView["summary"]; stamp: string }[]> {
  await authorize(prisma, actorId, "ADMIN");
  const rows = await prisma.reconRun.findMany({ orderBy: { createdAt: "desc" }, take: limit, include: { actor: { select: { email: true } } } });
  return rows.map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString(), actor: r.actor.email, params: r.params as unknown as ReconParams, summary: r.summary as ReconRunView["summary"], stamp: r.stamp }));
}

export function reconCsv(run: ReconRunView): string {
  const header = ["id_comprobacion", "nivel", "titulo", "resultado", "aditivo", "unidad", "esperado", "observado", "diferencia", "tolerancia", "identidades", "exclusiones", "fuentes", "notas", "sello_datos", "leido_el", "periodo_desde", "periodo_hasta", "ambito", "servicio"];
  const n = (v: string | null): CsvValue => ({ n: v });
  const rows = run.results.map((c) => [c.id, String(c.level), c.title, c.status, c.additive ? "sí" : "no (pertenencias solapadas)", c.unit, n(c.expected), n(c.observed), n(c.difference), n(c.tolerance), c.identities.join(" | "), c.exclusions.map((e) => `${e.reason}: ${e.count}${e.amount ? ` (${e.amount})` : ""}`).join(" | "), c.sources.join(" | "), c.notes.join(" "), run.stamp, run.readAt, run.params.desde, run.params.hasta, run.params.scope, run.params.servicio] as CsvValue[]);
  return csvDocument(header, rows);
}
