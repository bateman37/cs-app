import { Prisma } from "@/generated/prisma/client";
import { Dec, parseYmd } from "@/domain/finance";
import { todayMadrid } from "@/domain/vigencia";
import { DIAGNOSIS_FAMILIES, INDICATOR_KEYS, INDICATOR_NAME, UNIT_LABEL, type IndicatorKey, ageDays, diagnosisFamily, isAged, type DiagnosisFamily, type QualityConfig } from "@/domain/quality-config";
import { chooseSnapshot } from "@/domain/quality-coverage";
import { qualityPeriod, type QualityQuery } from "@/domain/quality-query";
import { INCIDENT_INFRA_CAUSE } from "@/domain/zendesk";
import { N3_DESTINATIONS, ticketSetSql, timeCol } from "@/server/pulse/sql";
import { getActive } from "@/server/pulse/config";
import { readSnapshot, type Tx } from "@/server/analytics/snapshot";
import { SERVICE_OF_SQL } from "@/server/economics/engine";
import { loadTicketBatches } from "./coverage";
import { stockSetSql, ticketFacts, validBugLinkSql, type QScopeDb } from "./facts";
import { agePercentile, computeQuality } from "./engine";
import { readDataStamp } from "@/server/analytics/stamp";

/**
 * Detalles de Calidad (CSAPP-08 §8, §10): diagnóstico por origen, backlog con filas y evolución. Los detalles paginados usan los MISMOS predicados que el
 * agregado (conjuntos de `facts.ts`) y totalizan todas sus filas, no la página. Cada uno se lee en su propia instantánea REPEATABLE READ; el llamador compara
 * el sello de datos con el del agregado y avisa si cambió.
 */
const scopeOf = (q: QualityQuery): QScopeDb => (q.scope === "group" ? "group" : "client");

async function entityIds(tx: Tx, q: QualityQuery): Promise<{ ids: string[]; name: string | null }> {
  if (q.sel) {
    const e = q.scope === "group" ? await tx.clientGroup.findUnique({ where: { id: q.sel }, select: { id: true, name: true } }) : await tx.client.findFirst({ where: { id: q.sel, isInternal: false }, select: { id: true, name: true } });
    return e ? { ids: [e.id], name: e.name } : { ids: [], name: null };
  }
  const all = q.scope === "group" ? await tx.clientGroup.findMany({ select: { id: true } }) : await tx.client.findMany({ where: { isInternal: false }, select: { id: true } });
  return { ids: all.map((x) => x.id), name: null };
}

// ---------------------------------------------------------------- Diagnóstico por origen

export type Matrix = { rows: string[]; cols: string[]; cells: Record<string, number> };
export type DiagnosisView = {
  period: { from: string; to: string };
  scopeName: string | null;
  entities: number;
  typeByFamily: Matrix;
  envByFamily: Matrix;
  n3ByFamily: Record<string, number>;
  hoursByFamily: Record<string, string>;
  pending: { noCause: number; infraNoHosting: number; unmapped: string[] };
  papByOrigin: { origin: string; count: number }[];
  papTotalUnique: number;
  totals: { tickets: number };
  mappingsVersion: number;
  notes: string[];
};

const FAM_ORDER = DIAGNOSIS_FAMILIES as readonly string[];

export async function diagnosisIn(tx: Tx, q: QualityQuery, cfg: QualityConfig, revisionNo: number, today = todayMadrid()): Promise<DiagnosisView> {
  const per = qualityPeriod(q.base.date, q.base.mode, today);
  const { ids, name } = await entityIds(tx, q);
  const scope = scopeOf(q);
  const empty: DiagnosisView = { period: { from: per.from, to: per.cut }, scopeName: name, entities: ids.length, typeByFamily: { rows: [], cols: [], cells: {} }, envByFamily: { rows: [], cols: [], cells: {} }, n3ByFamily: {}, hoursByFamily: {}, pending: { noCause: 0, infraNoHosting: 0, unmapped: [] }, papByOrigin: [], papTotalUnique: 0, totals: { tickets: 0 }, mappingsVersion: revisionNo, notes: [] };
  if (per.future || ids.length === 0) return { ...empty, notes: per.future ? ["El mes elegido todavía no ha empezado."] : [] };
  // Una sola agregación por tipo × entorno × causa × alojamiento: tickets creados en el periodo; cada ticket cuenta UNA vez (identidad), con su fecha contractual de creación.
  const rows = await tx.$queryRaw<{ type: string; entorno: string | null; cause: string | null; hosting: string | null; n: bigint; n3: bigint }[]>(Prisma.sql`
    SELECT x.type, rv.entorno, x.cause, tv.hosting, count(*) AS n, count(*) FILTER (WHERE x.destinations && ${N3_DESTINATIONS}::text[]) AS n3
    FROM (${ticketSetSql(scope, ids, per.from, per.cut)}) x
    JOIN "ZdTicketRevision" rv ON rv."ticketId" = x.ticket_id AND rv.id = (SELECT "currentRevisionId" FROM "ZdTicket" WHERE "ticketId" = x.ticket_id)
    JOIN LATERAL (SELECT hosting FROM (${ticketViewHosting()}) hv) tv ON true
    WHERE x.entity IS NOT NULL GROUP BY 1, 2, 3, 4`);
  const mappings = cfg.diagnosis.mappings;
  const typeM: Matrix = { rows: [], cols: [], cells: {} };
  const envM: Matrix = { rows: [], cols: [], cells: {} };
  const n3: Record<string, number> = {};
  const pending = { noCause: 0, infraNoHosting: 0, unmapped: new Set<string>() };
  const addTo = (m: Matrix, r: string, c: string, n: number) => {
    if (!m.rows.includes(r)) m.rows.push(r);
    if (!m.cols.includes(c)) m.cols.push(c);
    m.cells[`${r}|${c}`] = (m.cells[`${r}|${c}`] ?? 0) + n;
  };
  let tickets = 0;
  for (const r of rows) {
    const f = diagnosisFamily(r.cause, r.hosting as "CLOUD" | "OP" | null, mappings);
    const n = Number(r.n);
    tickets += n;
    addTo(typeM, r.type, f.family, n);
    addTo(envM, r.entorno ?? "(sin entorno/tipología)", f.family, n);
    n3[f.family] = (n3[f.family] ?? 0) + Number(r.n3);
    if (f.family === "SIN_CAUSA") pending.noCause += n;
    if (f.pending && f.family === "OTROS" && (r.cause ?? "").toLowerCase() === INCIDENT_INFRA_CAUSE) pending.infraNoHosting += n;
    else if (f.pending && f.family === "OTROS") pending.unmapped.add(r.cause ?? "");
  }
  typeM.cols.sort((a, b) => FAM_ORDER.indexOf(a) - FAM_ORDER.indexOf(b));
  envM.cols.sort((a, b) => FAM_ORDER.indexOf(a) - FAM_ORDER.indexOf(b));
  // Horas: agregan por ticket (identidad) antes de relacionar con la causa; el alojamiento es el vigente en la FECHA DEL TRABAJO.
  const hrs = await tx.$queryRaw<{ cause: string | null; hosting: string | null; minutes: string }[]>(Prisma.sql`
    WITH a0 AS (SELECT t.* FROM "TimeActivity" t WHERE t."isEligible" AND t."workDate" BETWEEN ${per.from}::date AND ${per.cut}::date AND t.${timeCol(scope)} = ANY(${ids})),
    a AS (SELECT a.*, ${SERVICE_OF_SQL} AS svc FROM a0 a WHERE true)
    SELECT rv."causaRaiz" AS cause, h.value AS hosting, sum(a.minutes)::text AS minutes
    FROM a
    LEFT JOIN "ZdTicket" zt ON zt."ticketId" = a."ticketId" LEFT JOIN "ZdTicketRevision" rv ON rv.id = zt."currentRevisionId"
    LEFT JOIN LATERAL (SELECT st.value FROM "ServiceTerm" st WHERE st.attribute = 'HOSTING' AND (st."clientId" = a."clientId" OR (a."groupId" IS NOT NULL AND st."groupId" = a."groupId"))
      AND (st."validFrom" IS NULL OR st."validFrom" <= a."workDate") AND (st."validTo" IS NULL OR a."workDate" < st."validTo") ORDER BY (st."clientId" IS NOT NULL) DESC LIMIT 1) h ON true
    GROUP BY 1, 2`);
  const hours: Record<string, Dec> = {};
  for (const r of hrs) {
    const f = diagnosisFamily(r.cause, r.hosting as "CLOUD" | "OP" | null, mappings).family;
    hours[f] = (hours[f] ?? Dec.ZERO).add(Dec.parse(r.minutes) as Dec);
  }
  const pap = await tx.$queryRaw<{ origin: string; n: bigint; total: bigint }[]>(Prisma.sql`
    WITH items AS (SELECT t.id, v.id AS rev FROM "PapItem" t JOIN "PapRevision" v ON v.id = t."currentRevisionId"
      WHERE t.${scope === "group" ? Prisma.raw('"drvGroupId"') : Prisma.raw('"drvClientId"')} = ANY(${ids}) AND v."productionDate" BETWEEN ${per.from}::date AND ${per.cut}::date)
    SELECT COALESCE(c.origin, c.category) AS origin, count(DISTINCT i.id) AS n, (SELECT count(*) FROM items) AS total FROM items i JOIN "PapCause" c ON c."revisionId" = i.rev GROUP BY 1 ORDER BY 1`);
  return {
    ...empty,
    typeByFamily: typeM, envByFamily: envM, n3ByFamily: n3,
    hoursByFamily: Object.fromEntries(Object.entries(hours).map(([k, v]) => [k, v.divInt(60).toString()])),
    pending: { noCause: pending.noCause, infraNoHosting: pending.infraNoHosting, unmapped: [...pending.unmapped].sort() },
    papByOrigin: pap.map((p) => ({ origin: p.origin, count: Number(p.n) })), papTotalUnique: Number(pap[0]?.total ?? 0), totals: { tickets },
    notes: [
      "Entorno/tipología es una señal y la causa raíz el diagnóstico registrado: ninguno sobrescribe al otro. Un vínculo a bug no cambia la causa registrada.",
      "Las familias de PAP por origen pueden solaparse (un PAP con varias causas pertenece a varias); el total por identidad es único y no es la suma.",
      "La orientación es una hipótesis de revisión: la etiqueta no demuestra falta de pruebas ni culpa.",
    ],
  };
}
function ticketViewHosting(): Prisma.Sql {
  // Alojamiento vigente a la fecha de CREACIÓN del ticket (contrato de clasificación): se resuelve por organización y fecha igual que la vista de tickets.
  return Prisma.sql`
    SELECT h.value AS hosting FROM "ZdTicket" zt2 JOIN "ZdTicketRevision" r2 ON r2.id = zt2."currentRevisionId"
    LEFT JOIN "ExternalIdentity" e ON e.system = 'ZENDESK' AND e.kind = 'ORG_ID' AND e."isActive" AND e."searchValue" = r2."organizationId"
      AND (e."validFrom" IS NULL OR e."validFrom" <= r2."createdOn") AND (e."validTo" IS NULL OR r2."createdOn" < e."validTo")
    LEFT JOIN "Client" c ON c.id = e."clientId"
    LEFT JOIN LATERAL (SELECT st.value FROM "ServiceTerm" st WHERE st.attribute = 'HOSTING' AND c.id IS NOT NULL AND (st."clientId" = c.id OR (c."groupId" IS NOT NULL AND st."groupId" = c."groupId"))
      AND (st."validFrom" IS NULL OR st."validFrom" <= r2."createdOn") AND (st."validTo" IS NULL OR r2."createdOn" < st."validTo") ORDER BY (st."clientId" IS NOT NULL) DESC LIMIT 1) h ON true
    WHERE zt2."ticketId" = x.ticket_id LIMIT 1`;
}

export async function getDiagnosis(actorId: string, q: QualityQuery, now: Date = new Date()): Promise<DiagnosisView> {
  return readSnapshot(actorId, async (tx) => {
    const rev = await getActive(tx, "QUALITY", q.qrev ?? undefined);
    return diagnosisIn(tx, q, rev.payload, rev.revisionNo, todayMadrid(now));
  });
}

/** Tickets de una familia de diagnóstico (detalle paginado con los mismos predicados que la matriz). */
export type DiagRow = { ticketId: string; type: string; created: string; status: string; entorno: string | null; cause: string | null; family: DiagnosisFamily; n3: boolean; bugLink: boolean };
export async function diagnosisTickets(actorId: string, q: QualityQuery, family: DiagnosisFamily, page: number, pageSize = 50, now: Date = new Date()): Promise<{ rows: DiagRow[]; total: number; page: number; pageCount: number }> {
  return readSnapshot(actorId, async (tx) => {
    const rev = await getActive(tx, "QUALITY", q.qrev ?? undefined);
    const per = qualityPeriod(q.base.date, q.base.mode, todayMadrid(now));
    const { ids } = await entityIds(tx, q);
    if (per.future || ids.length === 0) return { rows: [], total: 0, page: 1, pageCount: 1 };
    const rows = await tx.$queryRaw<{ ticket_id: string; type: string; created_on: Date; status: string; entorno: string | null; cause: string | null; hosting: string | null; n3: boolean; bug: boolean }[]>(Prisma.sql`
      SELECT x.ticket_id, x.type, x.created_on, x.status, rv.entorno, x.cause, tv.hosting, (x.destinations && ${N3_DESTINATIONS}::text[]) AS n3, ${validBugLinkSql(Prisma.sql`x.ticket_id`)} AS bug
      FROM (${ticketSetSql(scopeOf(q), ids, per.from, per.cut)}) x
      JOIN "ZdTicketRevision" rv ON rv.id = (SELECT "currentRevisionId" FROM "ZdTicket" WHERE "ticketId" = x.ticket_id)
      JOIN LATERAL (SELECT hosting FROM (${ticketViewHosting()}) hv) tv ON true
      WHERE x.entity IS NOT NULL ORDER BY x.created_on, x.ticket_id`);
    const all = rows.map((r) => ({ ticketId: r.ticket_id, type: r.type, created: r.created_on.toISOString().slice(0, 10), status: r.status, entorno: r.entorno, cause: r.cause, family: diagnosisFamily(r.cause, r.hosting as "CLOUD" | "OP" | null, rev.payload.diagnosis.mappings).family, n3: r.n3, bugLink: r.bug })).filter((r) => r.family === family);
    const pageCount = Math.max(1, Math.ceil(all.length / pageSize));
    const p = Math.min(Math.max(1, page), pageCount);
    return { rows: all.slice((p - 1) * pageSize, p * pageSize), total: all.length, page: p, pageCount };
  });
}

// ---------------------------------------------------------------- Backlog con filas y estadísticos por tipo

export type BacklogRow = { ticketId: string; entity: string; type: string; status: string; created: string; observedOn: string; age: number; aged: boolean; reason: string; family: DiagnosisFamily };
export type TypeStats = { count: number; aged: number; agedPct: string | null; median: string | null; p90: string | null; max: number | null; bands: { label: string; n: number }[]; per100: string | null; agedPer100: string | null };
export type BacklogView = {
  choice: ReturnType<typeof chooseSnapshot>;
  observedOn: string | null;
  usersAtD: number | null;
  scopeName: string | null;
  entities: number;
  stats: { incident: TypeStats; problem: TypeStats } | null;
  other: { resolved: number; questionTask: number; unknownStatus: number; invalidDates: number };
  thresholds: { incident: number | null; problem: number | null };
  rows: BacklogRow[];
  total: number;
  page: number;
  pageCount: number;
  notes: string[];
};

export async function getBacklog(actorId: string, q: QualityQuery, page: number, pageSize = 50, now: Date = new Date()): Promise<BacklogView> {
  return readSnapshot(actorId, async (tx) => {
    const rev = await getActive(tx, "QUALITY", q.qrev ?? undefined);
    const cfg = rev.payload;
    const per = qualityPeriod(q.base.date, q.base.mode, todayMadrid(now));
    const { ids, name } = await entityIds(tx, q);
    const batches = await loadTicketBatches(tx);
    const choice = chooseSnapshot(per.cut, batches.map((b) => ({ batchId: b.batchId, observedOn: b.observedOn, extractionKnown: b.extractionKnown, population: b.population, statusScope: b.statusScope })), cfg.snapshotPolicy);
    const base: BacklogView = { choice, observedOn: null, usersAtD: null, scopeName: name, entities: ids.length, stats: null, other: { resolved: 0, questionTask: 0, unknownStatus: 0, invalidDates: 0 }, thresholds: cfg.incidents.concerningDays, rows: [], total: 0, page: 1, pageCount: 1, notes: [choice.note] };
    // La fotografía «anterior» sin política elegida se muestra aparte como observada en D (nunca como R).
    const used = choice.kind === "EXACT" || choice.kind === "EARLIER" ? choice : choice.kind === "NONE" && choice.earlier ? { batchId: choice.earlier.batchId, observedOn: choice.earlier.observedOn } : null;
    if (!used || ids.length === 0 || per.future) return base;
    const exact = choice.kind === "EXACT";
    const D = used.observedOn;
    const rows = await tx.$queryRaw<{ ticket_id: string; entity: string; type: string; status: string; created_on: string; status_known: boolean; cause: string | null; hosting: string | null }[]>(Prisma.sql`
      SELECT s.ticket_id, s.entity, s.type, s.status, s.created_on, s.status_known, s.cause, s.hosting FROM (${stockSetSql(scopeOf(q), ids, used.batchId, { activeOnly: true })}) s
      WHERE s.entity IS NOT NULL ORDER BY s.created_on, s.ticket_id`);
    const resolvedN = Number((await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM (${stockSetSql(scopeOf(q), ids, used.batchId)}) s WHERE s.entity IS NOT NULL AND s.status_known AND s.status NOT IN ('new', 'open', 'pending', 'hold')`))[0].n);
    const active = new Set(["new", "open", "pending", "hold"]);
    const th = cfg.incidents.concerningDays;
    const out: BacklogRow[] = [];
    const acc = { incident: [] as number[], problem: [] as number[] };
    const aged = { incident: 0, problem: 0 };
    const other = { resolved: resolvedN, questionTask: 0, unknownStatus: 0, invalidDates: 0 };
    for (const r of rows) {
      if (!r.status_known) { other.unknownStatus++; continue; }
      if (!active.has(r.status)) continue;
      if (r.type !== "incident" && r.type !== "problem") { other.questionTask++; continue; }
      const age = ageDays(r.created_on, D);
      if (age === null) { other.invalidDates++; continue; }
      const t = r.type as "incident" | "problem";
      acc[t].push(age);
      const limit = th[t];
      const isOld = limit !== null && isAged(age, limit);
      if (isOld) aged[t]++;
      out.push({ ticketId: r.ticket_id, entity: r.entity, type: r.type, status: r.status, created: r.created_on, observedOn: D, age, aged: isOld, family: diagnosisFamily(r.cause, r.hosting as "CLOUD" | "OP" | null, cfg.diagnosis.mappings).family,
        reason: limit === null ? "Sin umbral preocupante configurado." : isOld ? `Edad ${age} > umbral ${limit} días.` : `Edad ${age} ≤ umbral ${limit} días.` });
    }
    const usersMonth = parseYmd(D);
    const usersRows = await tx.$queryRaw<{ v: number | null }[]>(Prisma.sql`
      SELECT COALESCE(sum(mm.value), NULL)::int AS v FROM "UserMatrix" m JOIN "UserMatrixMonth" mm ON mm."matrixId" = m.id
      WHERE m.year = ${usersMonth.y} AND mm.month = ${usersMonth.m} AND m.${q.scope === "group" ? Prisma.raw('"groupId"') : Prisma.raw('"clientId"')} = ANY(${ids})`);
    const usersAtD = ids.length === 1 || usersRows[0]?.v !== undefined ? usersRows[0]?.v ?? null : null;
    const stat = (t: "incident" | "problem"): TypeStats => {
      const a = acc[t];
      const dec = (d: Dec | null) => (d === null ? null : d.toString());
      const per100 = (n: number) => (usersAtD && usersAtD > 0 ? Dec.int(n).mulInt(100).divInt(usersAtD).toString() : null);
      return {
        count: a.length, aged: aged[t], agedPct: a.length === 0 ? null : Dec.int(aged[t]).mulInt(100).divInt(a.length).toString(),
        median: dec(agePercentile(a, 0.5)), p90: dec(agePercentile(a, 0.9)), max: a.length === 0 ? null : Math.max(...a),
        bands: cfg.incidents.ageBands.map((b) => ({ label: `${b.from}–${b.to ?? "…"} d`, n: a.filter((x) => x >= b.from && (b.to === null || x <= b.to)).length })),
        per100: per100(a.length), agedPer100: per100(aged[t]),
      };
    };
    const total = out.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const p = Math.min(Math.max(1, page), pageCount);
    const notes = [choice.note];
    if (!exact) notes.push(`Los datos del backlog son «observado en ${D}» con la edad y los usuarios de ${D}; no son el valor del ${per.cut}.`);
    if (usersAtD === null) notes.push(`Usuarios de ${String(usersMonth.m).padStart(2, "0")}/${usersMonth.y} sin informar: se muestran conteos sin tasas.`);
    if (ids.length > 1) notes.push("Cartera completa: las tasas por 100 usuarios del conjunto suman los usuarios propios de cada entidad (el grupo no suma los compartidos de sus hijos).");
    return { ...base, observedOn: D, usersAtD, stats: { incident: stat("incident"), problem: stat("problem") }, other, rows: out.slice((p - 1) * pageSize, p * pageSize), total, page: p, pageCount, notes };
  });
}

// ---------------------------------------------------------------- Evolución mensual de una entidad (CSAPP-09 §3)

export type EvolutionIndicator = {
  key: IndicatorKey; name: string; value: string | null; unit: string; color: string | null; status: string; availability: string; reason: string;
  /** Tamaño de la muestra de referencia de ESE mes (cohorte propia del mes), cuando la regla es por percentiles. */
  sampleN: number | null; cuts: { a: string; b: string } | null;
  numerator: string | null; denominator: string | null; breakdown: Record<string, string>; notes: string[]; coverage: { source: string; state: string }[];
  components: { id: string; label: string; value: string | null; color: string | null; status: string; n: number | null }[];
};
export type EvolutionPoint = {
  month: number; period: { from: string; cut: string; provisional: boolean };
  users: { stock: number | null; userMonths: string | null };
  indicators: Record<IndicatorKey, EvolutionIndicator>;
  global: { color: string | null; score: string | null; status: string; reason: string };
  backlog: { kind: string; observedOn: string | null; exact: boolean; provisional: boolean; usersMonth: { year: number; month: number } | null; note: string };
  healthState: string | null;
  uncalibrated: boolean;
};
export type Evolution = {
  year: number;
  /** Política de la serie: se RECALCULA con la revisión activa al solicitarla; no es el color publicado históricamente (no existe archivo de ese cálculo). */
  series: { basis: "RECALCULADA_CON_REVISION_ACTIVA"; qualityRevision: number; qualityPersisted: boolean; pulseRevision: number; simulated: boolean; reference: string; stamp: string };
  points: EvolutionPoint[];
  cum: { current: Record<string, number>; previousComparable: Record<string, number>; cut: string; previousCut: string };
  note: string;
};

/**
 * Evolución: CADA mes se evalúa con la MISMA función que la ficha mensual (`computeQuality`) sobre su propia cohorte, usuarios, cobertura, fotografía y referencias
 * (percentiles recalculados con la cohorte de ese mes); nunca se prestan umbrales de otro mes. Todos los puntos usan la misma revisión de configuración y se leen
 * en la misma instantánea. Un mes sin cobertura no es un cero confirmado; el stock sigue la política de fotografía (EXACT/antigüedad máxima) y una foto anterior
 * conserva su fecha y su carácter provisional. Coste: un número constante de consultas por mes (documentado), no una por entidad/indicador.
 */
export async function evolutionIn(tx: Tx, q: QualityQuery, id: string, cfg: QualityConfig, today = todayMadrid()): Promise<Evolution> {
  const per = qualityPeriod(q.base.date, q.base.mode, today);
  const year = per.year;
  const lastM = per.future ? 0 : per.month;
  const now = new Date(`${today}T12:00:00Z`);
  const points: EvolutionPoint[] = [];
  let meta: { qualityRevision: number; qualityPersisted: boolean; pulseRevision: number; simulated: boolean } | null = null;
  for (let m = 1; m <= lastM; m++) {
    const date = m === lastM ? q.base.date : `${year}-${String(m).padStart(2, "0")}-01`;
    const mode = m === lastM ? q.base.mode : "FULL_MONTH";
    const qm: QualityQuery = { ...q, base: { ...q.base, date, mode, q: "", page: 1, pageSize: 1, status: "todos" }, sel: id, color: "", sim: "" };
    const v = await computeQuality(tx, qm, { now, configOverride: cfg, skipActiveCompare: true, skipStamp: true, focusIds: [id] });
    meta ??= { qualityRevision: v.config.revisionNo, qualityPersisted: v.config.persisted, pulseRevision: v.pulseRevision, simulated: q.sim === "borrador" };
    const r = v.rows.find((x) => x.id === id);
    if (!r) continue;
    const indicators = {} as Record<IndicatorKey, EvolutionIndicator>;
    for (const k of INDICATOR_KEYS) {
      const i = r.evaluation.indicators[k];
      const e = r.explain[k];
      indicators[k] = {
        key: k, name: INDICATOR_NAME[k], value: i.value, unit: UNIT_LABEL[i.unit], color: i.color, status: i.status, availability: i.availability, reason: i.reason, sampleN: i.n ?? null, cuts: i.cuts ?? null,
        numerator: e.numerator, denominator: e.denominator, breakdown: e.breakdown, notes: e.notes, coverage: e.coverage.map((c) => ({ source: c.source, state: c.state })),
        components: (i.components ?? []).map((c) => ({ id: c.id, label: c.label, value: c.value, color: c.color, status: c.status, n: c.n ?? null })),
      };
    }
    points.push({
      month: m, period: { from: v.period.from, cut: v.period.cut, provisional: v.period.provisional }, users: r.users, indicators,
      global: { color: r.evaluation.global.color, score: r.evaluation.global.score, status: r.evaluation.global.status, reason: r.evaluation.global.reason },
      backlog: { kind: v.backlog.choice.kind, observedOn: v.backlog.observedOn, exact: v.backlog.exact, provisional: v.backlog.provisional, usersMonth: v.backlog.usersMonth, note: v.backlog.note },
      healthState: r.health.state, uncalibrated: r.flags.uncalibrated,
    });
  }
  // CUM técnico: mismo corte del año anterior (magnitudes; NO un global anual ni un promedio de semáforos).
  const scope = scopeOf(q);
  const ymFrom = `${year}-01-01`;
  const prevCut = `${year - 1}${per.cut.slice(4)}`;
  const prevCutOk = new Date(Date.UTC(year - 1, Number(per.cut.slice(5, 7)), 0)).toISOString().slice(0, 10) < prevCut ? new Date(Date.UTC(year - 1, Number(per.cut.slice(5, 7)), 0)).toISOString().slice(0, 10) : prevCut;
  const sum = async (a: string, b: string) => {
    const f = await ticketFacts(tx, scope, [id], a, b);
    const r = f.get(id);
    return { flujo: (r?.inc ?? 0) + (r?.prob ?? 0), n3: r?.n3 ?? 0, "problemas estándar/bug": r?.union ?? 0 };
  };
  const cum = lastM === 0 ? { cut: per.cut, previousCut: prevCutOk, current: {}, previousComparable: {} } : { cut: per.cut, previousCut: prevCutOk, current: await sum(ymFrom, per.cut), previousComparable: await sum(`${year - 1}-01-01`, prevCutOk) };
  // Referencia de la serie: cambia con la revisión usada y con CUALQUIER cambio retroactivo de datos, Health o maestros (sello de la misma instantánea).
  const stamp = (await readDataStamp(tx)).stamp;
  const mt = meta ?? { qualityRevision: 0, qualityPersisted: false, pulseRevision: 0, simulated: q.sim === "borrador" };
  const ref = (await tx.$queryRaw<{ h: string }[]>(Prisma.sql`SELECT md5(${`${mt.qualityRevision}|${mt.pulseRevision}|${mt.simulated}|${stamp}|${year}|${lastM}`}) AS h`))[0].h.slice(0, 12);
  return {
    year, series: { basis: "RECALCULADA_CON_REVISION_ACTIVA", ...mt, reference: ref, stamp }, points, cum,
    note: "Serie RECALCULADA con la revisión de configuración indicada (la misma para todos los meses) y con los datos actuales: cada mes usa su cohorte, usuarios, cobertura, reglas y referencias propias. No es el color publicado históricamente (no existe archivo de ese cálculo) y un cambio retroactivo de datos, Health o maestros puede modificarla. Un mes sin cobertura no es un cero confirmado; el stock sigue la política de fotografía. El CUM es técnico (magnitudes), separado del global mensual; no hay global anual ni promedio de colores.",
  };
}
