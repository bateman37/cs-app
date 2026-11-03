import { Prisma } from "@/generated/prisma/client";
import { Dec } from "@/domain/finance";
import { INCIDENT_APP_CAUSES, INCIDENT_INFRA_CAUSE } from "@/domain/zendesk";
import type { ServiceSelection } from "@/server/economics/engine";
import { SERVICE_OF_SQL } from "@/server/economics/engine";
import { ticketViewSql } from "@/server/zendesk/derive";
import type { Tx } from "./snapshot";

/**
 * Hechos operativos de la ficha (CSAPP-06 §7-§8): dedicación por perfil y causa, PAP, tickets y bugs vinculados. Cada resumen y su detalle
 * paginado comparten los MISMOS fragmentos SQL (`*Base`), de modo que el detalle concilia exactamente con la cifra. Sin joins que multipliquen
 * filas: las pertenencias (causas, destinos) se resuelven con EXISTS o con agregados por entidad.
 */
export type EntityRef = { type: "group" | "client" | "implementation"; id: string };
export type PeriodRange = { key: string; from: string; to: string };

const timeCol = (r: EntityRef) => Prisma.raw(r.type === "group" ? '"groupId"' : r.type === "client" ? '"clientId"' : '"implementationId"');
const papCol = (r: EntityRef) => Prisma.raw(r.type === "group" ? '"drvGroupId"' : r.type === "client" ? '"drvClientId"' : '"drvImplementationId"');
const ticketCol = (r: EntityRef) => (r.type === "group" ? Prisma.raw("tv.group_id") : r.type === "client" ? Prisma.raw("tv.client_id") : null);
const linkCol = (r: EntityRef) => (r.type === "group" ? Prisma.raw('l."drvGroupId"') : r.type === "client" ? Prisma.raw('l."drvClientId"') : null);
const periodsValues = (ps: PeriodRange[]) => Prisma.join(ps.map((p) => Prisma.sql`(${p.key}::text, ${p.from}::date, ${p.to}::date)`));
const span = (ps: PeriodRange[]) => ({ from: ps.reduce((m, p) => (p.from < m ? p.from : m), ps[0].from), to: ps.reduce((m, p) => (p.to > m ? p.to : m), ps[0].to) });
const ZERO = Dec.ZERO;
const hours = (min: Dec) => min.divInt(60).toString();

// ---------------------------------------------------------------- Dedicación (equipos/perfiles y causas)

/** Perfiles previstos, en este orden; cualquier otra dimensión se conserva con su nombre y «Sin identificar» va al final. */
export const PROFILE_ORDER = ["CS N1", "CS N2", "PMO ANA", "PMO DEV", "IT N3", "Plataforma N4"] as const;
export const UNIDENTIFIED = "Sin identificar";
export const CAUSE_CLASS_LABEL: Record<string, string> = {
  INCIDENTE_VINCLE: "Incidente Vincle confirmado",
  OTRO_SOPORTE: "Otro soporte clasificado",
  SIN_CLASIFICAR: "Sin clasificar / pendiente",
};

/** Etiqueta de perfil a partir de las dimensiones resueltas A LA FECHA DEL TRABAJO. PMO desconocido nunca llega aquí (elegibilidad pendiente). */
export function profileLabel(d: { pmo: boolean | null; team: string | null; level: string | null; role: string | null }): string {
  if (d.pmo === true) return d.role ? `PMO ${d.role.trim().toUpperCase()}` : "PMO (rol sin identificar)";
  const rawTeam = d.team?.trim() ?? "";
  const t = TEAM_DISPLAY[rawTeam.toLowerCase()] ?? rawTeam;
  const l = d.level?.trim() ?? "";
  if (!t && !l) return UNIDENTIFIED;
  // El equipo real «CS N2» ya lleva su nivel: no se repite («CS N2 N2»).
  if (t && l && t.toLowerCase().endsWith(` ${l.toLowerCase()}`)) return t;
  return `${t} ${l}`.trim();
}
/** Correspondencias semánticas EXPLÍCITAS entre la etiqueta del equipo en los maestros y el perfil analítico (HOTFIX-01 §9): PLAT es «Plataforma». Cualquier otra etiqueta se conserva tal cual. */
export const TEAM_DISPLAY: Record<string, string> = { plat: "Plataforma" };
const profileRank = (label: string): number => {
  const i = PROFILE_ORDER.findIndex((p) => p.toLowerCase() === label.toLowerCase());
  return i >= 0 ? i : label === UNIDENTIFIED ? 1000 : 500;
};

export type ProfileRow = {
  profile: string; minutes: string; hours: string; incident: string; other: string; unclassified: string;
  /** Minutos exactos por clase (las horas se derivan al presentar; permiten reagrupar perfiles sin acumular redondeos). */
  incidentMinutes: string; otherMinutes: string; unclassifiedMinutes: string;
};
export type CauseRow = { cause: string; cls: string; minutes: string; hours: string };
export type DedicationPeriod = {
  totalMinutes: string;
  totalHours: string;
  profiles: ProfileRow[];
  causes: CauseRow[];
  byClass: { incident: string; other: string; unclassified: string };
  withoutImplementationHours: string;
};

export async function loadDedication(tx: Tx, ref: EntityRef, periods: PeriodRange[], service: ServiceSelection): Promise<Record<string, DedicationPeriod>> {
  const { from, to } = span(periods);
  const rows = await tx.$queryRaw<
    { period: string; team: string | null; level: string | null; role: string | null; pmo: boolean | null; cause: string | null; cls: string; no_impl: boolean; minutes: string }[]
  >(Prisma.sql`
    WITH periods(key, pfrom, pto) AS (VALUES ${periodsValues(periods)}),
    a0 AS (SELECT t.* FROM "TimeActivity" t WHERE t.${timeCol(ref)} = ${ref.id} AND t."isEligible" AND t."workDate" BETWEEN ${from}::date AND ${to}::date),
    a AS (SELECT a.*, ${SERVICE_OF_SQL} AS svc FROM a0 a),
    c AS (
      SELECT a.*, tm.name AS team, lv.name AS level, rl.name AS role, rv."causaRaiz" AS cause, rv.id AS rev_id, h.value AS hosting
      FROM a
      LEFT JOIN "StaffCatalogItem" tm ON tm.id = a."teamId"
      LEFT JOIN "StaffCatalogItem" lv ON lv.id = a."levelId"
      LEFT JOIN "StaffCatalogItem" rl ON rl.id = a."roleId"
      LEFT JOIN "ZdTicket" zt ON zt."ticketId" = a."ticketId"
      LEFT JOIN "ZdTicketRevision" rv ON rv.id = zt."currentRevisionId"
      LEFT JOIN LATERAL (
        SELECT st.value FROM "ServiceTerm" st
        WHERE st.attribute = 'HOSTING' AND (st."clientId" = a."clientId" OR (a."groupId" IS NOT NULL AND st."groupId" = a."groupId"))
          AND (st."validFrom" IS NULL OR st."validFrom" <= a."workDate") AND (st."validTo" IS NULL OR a."workDate" < st."validTo")
        ORDER BY (st."clientId" IS NOT NULL) DESC LIMIT 1) h ON true
      WHERE (${service} = 'TOTAL' OR a.svc = ${service}))
    SELECT p.key AS period, c.team, c.level, c.role, c.pmo, lower(c.cause) AS cause,
      CASE WHEN c.rev_id IS NULL OR c.cause IS NULL THEN 'SIN_CLASIFICAR'
           WHEN lower(c.cause) = ANY(${[...INCIDENT_APP_CAUSES]}::text[]) THEN 'INCIDENTE_VINCLE'
           WHEN lower(c.cause) = ${INCIDENT_INFRA_CAUSE} THEN CASE c.hosting WHEN 'CLOUD' THEN 'INCIDENTE_VINCLE' WHEN 'OP' THEN 'OTRO_SOPORTE' ELSE 'SIN_CLASIFICAR' END
           ELSE 'OTRO_SOPORTE' END AS cls,
      (c."implementationId" IS NULL) AS no_impl, sum(c.minutes)::text AS minutes
    FROM c JOIN periods p ON c."workDate" BETWEEN p.pfrom AND p.pto
    GROUP BY 1, 2, 3, 4, 5, 6, 7, 8`);
  const out: Record<string, DedicationPeriod> = {};
  for (const p of periods) {
    const mine = rows.filter((r) => r.period === p.key);
    const prof = new Map<string, { m: Dec; i: Dec; o: Dec; u: Dec }>();
    const caus = new Map<string, { cls: string; m: Dec }>();
    let total = ZERO;
    let noImpl = ZERO;
    const cls = { i: ZERO, o: ZERO, u: ZERO };
    for (const r of mine) {
      const m = Dec.parse(r.minutes) as Dec;
      total = total.add(m);
      if (r.no_impl) noImpl = noImpl.add(m);
      const label = profileLabel({ pmo: r.pmo, team: r.team, level: r.level, role: r.role });
      const cur = prof.get(label) ?? { m: ZERO, i: ZERO, o: ZERO, u: ZERO };
      cur.m = cur.m.add(m);
      if (r.cls === "INCIDENTE_VINCLE") {
        cur.i = cur.i.add(m);
        cls.i = cls.i.add(m);
      } else if (r.cls === "OTRO_SOPORTE") {
        cur.o = cur.o.add(m);
        cls.o = cls.o.add(m);
      } else {
        cur.u = cur.u.add(m);
        cls.u = cls.u.add(m);
      }
      prof.set(label, cur);
      const ck = `${r.cause ?? "(sin causa informada)"}|${r.cls}`;
      const cc = caus.get(ck) ?? { cls: r.cls, m: ZERO };
      cc.m = cc.m.add(m);
      caus.set(ck, cc);
    }
    out[p.key] = {
      totalMinutes: total.toString(),
      totalHours: hours(total),
      profiles: [...prof.entries()]
        .sort((a, b) => profileRank(a[0]) - profileRank(b[0]) || a[0].localeCompare(b[0], "es"))
        .map(([profile, v]) => ({ profile, minutes: v.m.toString(), hours: hours(v.m), incident: hours(v.i), other: hours(v.o), unclassified: hours(v.u), incidentMinutes: v.i.toString(), otherMinutes: v.o.toString(), unclassifiedMinutes: v.u.toString() })),
      causes: [...caus.entries()].map(([k, v]) => ({ cause: k.split("|")[0], cls: v.cls, minutes: v.m.toString(), hours: hours(v.m) })).sort((a, b) => (Dec.parse(b.minutes) as Dec).cmp(Dec.parse(a.minutes) as Dec) || a.cause.localeCompare(b.cause)),
      byClass: { incident: hours(cls.i), other: hours(cls.o), unclassified: hours(cls.u) },
      withoutImplementationHours: hours(noImpl),
    };
  }
  return out;
}

// ---------------------------------------------------------------- PAP

/** PAP del ámbito por identidad estable (lista + ID), con su revisión vigente. Compartido por resumen y detalle. */
export const papBase = (ref: EntityRef) => Prisma.sql`
  SELECT t.id AS item_id, t."listKey", t."papId", v.id AS rev_id, v.title, v.result, v."productionDate", v."requestDate", v."correctiveState" AS state, t."drvScope" AS scope
  FROM "PapItem" t JOIN "PapRevision" v ON v.id = t."currentRevisionId"
  WHERE t.${papCol(ref)} = ${ref.id}`;

const hasCause = (cat: string, origin?: string) =>
  origin
    ? Prisma.sql`EXISTS (SELECT 1 FROM "PapCause" c WHERE c."revisionId" = x.rev_id AND c.category = ${cat} AND c.origin = ${origin})`
    : Prisma.sql`EXISTS (SELECT 1 FROM "PapCause" c WHERE c."revisionId" = x.rev_id AND c.category = ${cat})`;

export type PapPeriod = {
  total: number;
  corrective: number;
  standard: number;
  project: number;
  clientOrigin: number;
  evolutive: number;
  unclassified: number;
  nonOk: number;
  clientRequest: number;
  memberships: { category: string; pap: number }[];
  /** Falso si algún PAP pertenece a varias categorías: las filas de pertenencia NO suman el total. */
  additive: boolean;
};
export type PapSummary = { periods: Record<string, PapPeriod>; withoutProductionDate: number; results: { result: string; pap: number }[]; observedOn: string | null };

export async function loadPap(tx: Tx, ref: EntityRef, periods: PeriodRange[]): Promise<PapSummary> {
  const rows = await tx.$queryRaw<Record<string, bigint | string>[]>(Prisma.sql`
    WITH periods(key, pfrom, pto) AS (VALUES ${periodsValues(periods)}), x AS (${papBase(ref)})
    SELECT p.key,
      count(*) AS total,
      count(*) FILTER (WHERE x.state = 'CORRECTIVE') AS corrective,
      count(*) FILTER (WHERE ${hasCause("CORRECTIVE", "STANDARD")}) AS standard,
      count(*) FILTER (WHERE ${hasCause("CORRECTIVE", "CUSTOMIZATION")} OR ${hasCause("CORRECTIVE", "CONFIG_DATA")} OR ${hasCause("CORRECTIVE", "PROCESSES")} OR ${hasCause("CORRECTIVE", "INFRASTRUCTURE")}) AS project,
      count(*) FILTER (WHERE ${hasCause("CORRECTIVE", "CLIENT_ORIGIN")}) AS client_origin,
      count(*) FILTER (WHERE ${hasCause("EVOLUTIVE")}) AS evolutive,
      count(*) FILTER (WHERE x.state = 'UNKNOWN' OR NOT EXISTS (SELECT 1 FROM "PapCause" c WHERE c."revisionId" = x.rev_id)) AS unclassified,
      count(*) FILTER (WHERE x.result IS NOT NULL AND lower(x.result) NOT IN ('ok', 'correcto', 'éxito', 'exito')) AS non_ok,
      count(*) FILTER (WHERE ${hasCause("MAINTENANCE")}) AS maintenance,
      count(*) FILTER (WHERE ${hasCause("CLIENT_REQUEST")}) AS client_request,
      count(*) FILTER (WHERE ${hasCause("OTHER")}) AS other_cause,
      count(*) FILTER (WHERE (SELECT count(DISTINCT c.category) FROM "PapCause" c WHERE c."revisionId" = x.rev_id) > 1) AS multi
    FROM x JOIN periods p ON x."productionDate" BETWEEN p.pfrom AND p.pto
    GROUP BY p.key`);
  const n = (v: bigint | string | undefined) => Number(v ?? 0);
  const periodsOut: Record<string, PapPeriod> = {};
  for (const p of periods) {
    const r = rows.find((x) => x.key === p.key);
    periodsOut[p.key] = {
      total: n(r?.total), corrective: n(r?.corrective), standard: n(r?.standard), project: n(r?.project), clientOrigin: n(r?.client_origin), evolutive: n(r?.evolutive),
      unclassified: n(r?.unclassified), nonOk: n(r?.non_ok), clientRequest: n(r?.client_request),
      memberships: [
        { category: "Correctivo", pap: n(r?.corrective) },
        { category: "Evolutivo", pap: n(r?.evolutive) },
        { category: "Mantenimiento", pap: n(r?.maintenance) },
        { category: "Petición cliente", pap: n(r?.client_request) },
        { category: "Otra causa", pap: n(r?.other_cause) },
      ],
      additive: n(r?.multi) === 0,
    };
  }
  const [noDate, results, obs] = await Promise.all([
    tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM (${papBase(ref)}) x WHERE x."productionDate" IS NULL`),
    tx.$queryRaw<{ result: string | null; n: bigint }[]>(Prisma.sql`SELECT x.result, count(*) AS n FROM (${papBase(ref)}) x GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 12`),
    tx.$queryRaw<{ d: string | null }[]>(Prisma.sql`
      SELECT to_char(max(o."observedOn"), 'YYYY-MM-DD') AS d FROM "PapObservation" o JOIN (${papBase(ref)}) x ON x.item_id = o."itemId"`),
  ]);
  return { periods: periodsOut, withoutProductionDate: n(noDate[0].n), results: results.map((r) => ({ result: r.result ?? "(sin resultado)", pap: n(r.n) })), observedOn: obs[0]?.d ?? null };
}

export type PapRow = { listKey: string; papId: string; title: string; production: string | null; request: string | null; result: string | null; state: string; causes: string | null; scope: string };
export async function listPap(tx: Tx, ref: EntityRef, period: PeriodRange | null, page: number, pageSize: number): Promise<{ rows: PapRow[]; total: number }> {
  const where = period ? Prisma.sql`WHERE x."productionDate" BETWEEN ${period.from}::date AND ${period.to}::date` : Prisma.sql`WHERE x."productionDate" IS NULL`;
  const [rows, tot] = await Promise.all([
    tx.$queryRaw<PapRow[]>(Prisma.sql`
      SELECT x."listKey", x."papId", x.title, to_char(x."productionDate", 'YYYY-MM-DD') AS production, to_char(x."requestDate", 'YYYY-MM-DD') AS request, x.result, x.state, x.scope,
        (SELECT string_agg(c."rawToken", ' · ' ORDER BY c.normalized) FROM "PapCause" c WHERE c."revisionId" = x.rev_id) AS causes
      FROM (${papBase(ref)}) x ${where} ORDER BY x."productionDate" NULLS LAST, x."listKey", x."papId" LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM (${papBase(ref)}) x ${where}`),
  ]);
  return { rows, total: Number(tot[0].n) };
}

// ---------------------------------------------------------------- Tickets y escalados

/** Tickets del ámbito creados en el rango, con la clasificación común (ticketViewSql). La cohorte mensual es la CREACIÓN del ticket. */
export const ticketBase = (ref: EntityRef, from: string, to: string): Prisma.Sql | null => {
  const col = ticketCol(ref);
  if (!col) return null;
  return Prisma.sql`
    SELECT tv.key AS ticket_id, tv.created_on, tv.incident_class, tv.cause, lower(rv."ticketType") AS type, rv.status, rv.tags, rv.destinations, rv."entorno",
      to_char(obs."observedOn", 'YYYY-MM-DD') AS observed_on, obs."observedKind" AS observed_kind
    FROM (${ticketViewSql(Prisma.sql`
      SELECT zt."ticketId" AS key, NULL::jsonb AS payload, rv0."organizationId" AS org_id, rv0."createdOn" AS created_on, rv0."causaRaiz" AS cause, rv0."typeKnown" AS type_known, rv0."statusKnown" AS status_known
      FROM "ZdTicket" zt JOIN "ZdTicketRevision" rv0 ON rv0.id = zt."currentRevisionId" WHERE rv0."createdOn" BETWEEN ${from}::date AND ${to}::date`)}) tv
    JOIN "ZdTicket" zt2 ON zt2."ticketId" = tv.key JOIN "ZdTicketRevision" rv ON rv.id = zt2."currentRevisionId"
    LEFT JOIN "ZdTicketObservation" obs ON obs.id = zt2."currentObservationId"
    WHERE ${col} = ${ref.id}`;
};

export const N3_DEST = ["PMO_N3", "IT_N3"];
export type TicketPeriod = {
  total: number;
  incident: number;
  problem: number;
  other: number;
  withEvidenceIncomplete: number;
  escalations: { n2: number; n3: number; pmoN3: number; itN3: number; n4: number; vfsN4: number; arqN4: number; vswN4: number };
  statuses: { status: string; tickets: number }[];
  observedFrom: string | null;
  observedTo: string | null;
};

export async function loadTickets(tx: Tx, ref: EntityRef, periods: PeriodRange[]): Promise<{ supported: boolean; periods: Record<string, TicketPeriod> }> {
  const { from, to } = span(periods);
  const base = ticketBase(ref, from, to);
  if (!base) return { supported: false, periods: {} };
  const rows = await tx.$queryRaw<Record<string, bigint | string | null>[]>(Prisma.sql`
    WITH periods(key, pfrom, pto) AS (VALUES ${periodsValues(periods)}), x AS (${base})
    SELECT p.key, count(*) AS total, count(*) FILTER (WHERE x.type = 'incident') AS incident, count(*) FILTER (WHERE x.type = 'problem') AS problem,
      count(*) FILTER (WHERE x.type IS DISTINCT FROM 'incident' AND x.type IS DISTINCT FROM 'problem') AS other,
      count(*) FILTER (WHERE x.cause IS NULL) AS no_cause,
      count(*) FILTER (WHERE x.destinations && ARRAY['CS_N2']) AS n2,
      count(*) FILTER (WHERE x.destinations && ${N3_DEST}::text[]) AS n3,
      count(*) FILTER (WHERE x.destinations && ARRAY['PMO_N3']) AS pmo_n3, count(*) FILTER (WHERE x.destinations && ARRAY['IT_N3']) AS it_n3,
      count(*) FILTER (WHERE x.destinations && ARRAY['VFS_N4', 'ARQ_VFS_N4', 'VSW_N4']) AS n4,
      count(*) FILTER (WHERE x.destinations && ARRAY['VFS_N4']) AS vfs_n4, count(*) FILTER (WHERE x.destinations && ARRAY['ARQ_VFS_N4']) AS arq_n4, count(*) FILTER (WHERE x.destinations && ARRAY['VSW_N4']) AS vsw_n4,
      min(x.observed_on) AS obs_from, max(x.observed_on) AS obs_to
    FROM x JOIN periods p ON x.created_on BETWEEN p.pfrom AND p.pto GROUP BY p.key`);
  const st = await tx.$queryRaw<{ key: string; status: string; n: bigint }[]>(Prisma.sql`
    WITH periods(key, pfrom, pto) AS (VALUES ${periodsValues(periods)}), x AS (${base})
    SELECT p.key, x.status, count(*) AS n FROM x JOIN periods p ON x.created_on BETWEEN p.pfrom AND p.pto GROUP BY 1, 2 ORDER BY 1, 3 DESC, 2`);
  const n = (v: bigint | string | null | undefined) => Number(v ?? 0);
  const out: Record<string, TicketPeriod> = {};
  for (const p of periods) {
    const r = rows.find((x) => x.key === p.key);
    out[p.key] = {
      total: n(r?.total), incident: n(r?.incident), problem: n(r?.problem), other: n(r?.other), withEvidenceIncomplete: n(r?.no_cause),
      escalations: { n2: n(r?.n2), n3: n(r?.n3), pmoN3: n(r?.pmo_n3), itN3: n(r?.it_n3), n4: n(r?.n4), vfsN4: n(r?.vfs_n4), arqN4: n(r?.arq_n4), vswN4: n(r?.vsw_n4) },
      statuses: st.filter((s) => s.key === p.key).map((s) => ({ status: s.status, tickets: n(s.n) })),
      observedFrom: (r?.obs_from as string | null) ?? null,
      observedTo: (r?.obs_to as string | null) ?? null,
    };
  }
  return { supported: true, periods: out };
}

export type TicketRow = { ticketId: string; created: string; type: string; status: string; cause: string | null; incidentClass: string; destinations: string[]; observedOn: string | null; observedKind: string | null };
export async function listTickets(tx: Tx, ref: EntityRef, period: PeriodRange, page: number, pageSize: number): Promise<{ supported: boolean; rows: TicketRow[]; total: number }> {
  const base = ticketBase(ref, period.from, period.to);
  if (!base) return { supported: false, rows: [], total: 0 };
  const [rows, tot] = await Promise.all([
    tx.$queryRaw<TicketRow[]>(Prisma.sql`
      SELECT x.ticket_id AS "ticketId", to_char(x.created_on, 'YYYY-MM-DD') AS created, x.type, x.status, x.cause, x.incident_class AS "incidentClass", x.destinations,
        x.observed_on AS "observedOn", x.observed_kind AS "observedKind"
      FROM (${base}) x ORDER BY x.created_on, x.ticket_id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM (${base}) x`),
  ]);
  return { supported: true, rows, total: Number(tot[0].n) };
}

// ---------------------------------------------------------------- Bugs vinculados

/**
 * Pares bug–ticket del ámbito cuyo TICKET se creó en el rango («bugs vinculados a tickets creados en el periodo»: cohorte de tickets, no
 * fecha de aparición del defecto). Confirmado = vínculo explícito resuelto a un Cliente externo y no rechazado manualmente. Los tickets
 * centrales internos son contexto y no identifican clientes; los vínculos pendientes o rechazados quedan fuera del conteo confirmado.
 */
export const bugLinkBase = (ref: EntityRef, from: string, to: string): Prisma.Sql | null => {
  const col = linkCol(ref);
  if (!col) return null;
  return Prisma.sql`
    SELECT l.id AS link_id, w.id AS wi, w.product, w."scopeKey", w."workItemId", wr.title, wr.state, wr."stateCategory", wr."stateKnown", l."ticketId",
      lower(rv."ticketType") AS ticket_type, rv."createdOn" AS ticket_created
    FROM "WorkItemLink" l
    JOIN "WorkItem" w ON w.id = l."workItemId" JOIN "WorkItemRevision" wr ON wr.id = w."currentRevisionId" AND wr."isBug"
    JOIN "ZdTicket" zt ON zt."ticketId" = l."ticketId" JOIN "ZdTicketRevision" rv ON rv.id = zt."currentRevisionId"
    WHERE ${col} = ${ref.id} AND l."drvState" = 'RESOLVED_EXTERNAL' AND l."manualState" IS DISTINCT FROM 'REJECTED'
      AND rv."createdOn" BETWEEN ${from}::date AND ${to}::date`;
};

export type BugPeriod = { bugs: number; problems: number; incidents: number; otherTickets: number };
export type BugSummary = {
  supported: boolean;
  periods: Record<string, BugPeriod>;
  /** Fuera del conteo confirmado: no atribuibles a un ámbito o descartados. */
  outside: { rejectedInScope: number; pendingTicketGlobal: number; centralInternalGlobal: number };
};

export async function loadBugs(tx: Tx, ref: EntityRef, periods: PeriodRange[]): Promise<BugSummary> {
  const { from, to } = span(periods);
  const base = bugLinkBase(ref, from, to);
  if (!base) return { supported: false, periods: {}, outside: { rejectedInScope: 0, pendingTicketGlobal: 0, centralInternalGlobal: 0 } };
  const rows = await tx.$queryRaw<{ key: string; bugs: bigint; problems: bigint; incidents: bigint; other: bigint }[]>(Prisma.sql`
    WITH periods(key, pfrom, pto) AS (VALUES ${periodsValues(periods)}), x AS (${base})
    SELECT p.key, count(DISTINCT x.wi) AS bugs, count(DISTINCT x."ticketId") FILTER (WHERE x.ticket_type = 'problem') AS problems,
      count(DISTINCT x."ticketId") FILTER (WHERE x.ticket_type = 'incident') AS incidents,
      count(DISTINCT x."ticketId") FILTER (WHERE x.ticket_type IS DISTINCT FROM 'problem' AND x.ticket_type IS DISTINCT FROM 'incident') AS other
    FROM x JOIN periods p ON x.ticket_created BETWEEN p.pfrom AND p.pto GROUP BY p.key`);
  const col = linkCol(ref) as Prisma.Sql;
  const ext = await tx.$queryRaw<{ rejected: bigint; pending: bigint; central: bigint }[]>(Prisma.sql`
    SELECT (SELECT count(*) FROM "WorkItemLink" l WHERE ${col} = ${ref.id} AND l."manualState" = 'REJECTED') AS rejected,
      (SELECT count(*) FROM "WorkItemLink" l WHERE l."drvState" = 'PENDING_TICKET' AND l."manualState" IS DISTINCT FROM 'REJECTED') AS pending,
      (SELECT count(*) FROM "WorkItemLink" l WHERE l."drvState" = 'CENTRAL_INTERNAL' AND l."manualState" IS DISTINCT FROM 'REJECTED') AS central`);
  const n = (v: bigint | undefined) => Number(v ?? 0);
  return {
    supported: true,
    periods: Object.fromEntries(periods.map((p) => {
      const r = rows.find((x) => x.key === p.key);
      return [p.key, { bugs: n(r?.bugs), problems: n(r?.problems), incidents: n(r?.incidents), otherTickets: n(r?.other) }];
    })),
    outside: { rejectedInScope: n(ext[0].rejected), pendingTicketGlobal: n(ext[0].pending), centralInternalGlobal: n(ext[0].central) },
  };
}

export type BugRow = { product: string; scopeKey: string; workItemId: string; title: string; state: string; stateKnown: boolean; tickets: { ticketId: string; type: string | null; created: string }[] };
export async function listBugs(tx: Tx, ref: EntityRef, period: PeriodRange, page: number, pageSize: number): Promise<{ supported: boolean; rows: BugRow[]; total: number }> {
  const base = bugLinkBase(ref, period.from, period.to);
  if (!base) return { supported: false, rows: [], total: 0 };
  const [rows, tot] = await Promise.all([
    tx.$queryRaw<{ product: string; scopeKey: string; workItemId: string; title: string; state: string; stateKnown: boolean; tickets: BugRow["tickets"] }[]>(Prisma.sql`
      SELECT x.product, x."scopeKey", x."workItemId", min(x.title) AS title, min(x.state) AS state, bool_and(x."stateKnown") AS "stateKnown",
        jsonb_agg(DISTINCT jsonb_build_object('ticketId', x."ticketId", 'type', x.ticket_type, 'created', to_char(x.ticket_created, 'YYYY-MM-DD'))) AS tickets
      FROM (${base}) x GROUP BY x.wi, x.product, x."scopeKey", x."workItemId" ORDER BY x.product, x."workItemId" LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(DISTINCT x.wi) AS n FROM (${base}) x`),
  ]);
  return { supported: true, rows, total: Number(tot[0].n) };
}
