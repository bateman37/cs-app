import { Prisma } from "@/generated/prisma/client";
import { Dec, buildPeriods } from "@/domain/finance";
import { todayMadrid } from "@/domain/vigencia";
import { METRIC_BY_ID, PROFILE_LABEL, type PulseMetric } from "@/domain/pulse-catalog";
import { PERIOD_KEY, type PulseQuery } from "@/domain/pulse-query";
import { effectiveCut } from "@/domain/finance";
import { DomainError } from "@/server/errors";
import { readSnapshot } from "@/server/analytics/snapshot";
import { readDataStamp } from "@/server/analytics/stamp";
import { getActive } from "./config";
import { CLS_VALUE, classifiedActivitySql, papPredicate, papSetSql, selectorsOf, ticketPredicate, ticketSetSql } from "./sql";

/**
 * Detalle paginado autorizado que concilia con el NUMERADOR de una celda (CSAPP-07 §7). El selector de métrica cambia el predicado real:
 * un incidente de N1 no abre «todas las horas», un PAP estándar no abre todos los PAP. Usa los mismos fragmentos SQL que el resumen.
 */
export type DetailRow = Record<string, string | number | null>;
export type PulseDetail = {
  metric: PulseMetric;
  entity: { id: string; name: string };
  period: { from: string; to: string; label: string };
  kind: "hours" | "pap" | "tickets" | "none";
  /** Predicado aplicado, en palabras. */
  predicate: string;
  columns: { key: string; label: string }[];
  rows: DetailRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Suma del detalle completo (no solo de la página) en la unidad del numerador. */
  numerator: string | null;
  numeratorUnit: string;
  note: string | null;
  stamp: string;
};

export async function pulseDetail(actorId: string, q: PulseQuery, entityId: string, metricId: string, page: number, pageSize = 25): Promise<PulseDetail> {
  const metric = METRIC_BY_ID.get(metricId);
  if (!metric) throw new DomainError("Métrica desconocida.");
  return readSnapshot(actorId, async (tx) => {
    const cfg = (await getActive(tx, "PULSE", q.pulseRevision ?? undefined)).payload;
    const cut = effectiveCut(q.base.date, q.base.mode);
    void cut;
    const periods = buildPeriods(q.base.date, q.base.mode, todayMadrid());
    const per = periods[metric.period === "prevYear" ? "prevYear" : PERIOD_KEY[q.period]];
    const name = await entityName(tx, q.scope, entityId);
    const stamp = (await readDataStamp(tx)).stamp;
    const base = { metric, entity: { id: entityId, name }, period: { from: per.from, to: per.to, label: per.label }, page, pageSize, stamp };
    const spec = metric.spec;
    const off = (page - 1) * pageSize;

    if (spec.t === "hours" || spec.t === "hours_total") {
      const src = classifiedActivitySql({ scope: q.scope, ids: [entityId], from: per.from, to: per.to, service: q.base.service, selectors: selectorsOf(cfg) });
      let where = Prisma.sql`true`;
      let predicate = "Todas las horas elegibles del perímetro del servicio";
      if (spec.t === "hours") {
        where = Prisma.sql`x.profile = ${spec.profile}`;
        predicate = `Perfil ${PROFILE_LABEL[spec.profile]}`;
        if (spec.cls !== "total") {
          where = Prisma.sql`x.profile = ${spec.profile} AND x.cls = ${CLS_VALUE[spec.cls]}`;
          predicate += ` · clase ${spec.cls === "incident" ? "incidente Vincle confirmado" : spec.cls === "other" ? "otro soporte clasificado" : "sin clasificar / pendiente"}`;
        }
      }
      // Sentencias en serie: una transacción interactiva usa una sola conexión.
      const rows = await tx.$queryRaw<{ source: string; workDate: string; ticketId: string | null; profile: string; cls: string; minutes: string }[]>(Prisma.sql`
          SELECT x.source, to_char(x."workDate", 'YYYY-MM-DD') AS "workDate", x."ticketId", x.profile, x.cls, x.minutes::text AS minutes
          FROM (${src}) x WHERE ${where} ORDER BY x."workDate", x.source, x."entryId" LIMIT ${pageSize} OFFSET ${off}`);
      const agg = await tx.$queryRaw<{ n: bigint; m: string | null }[]>(Prisma.sql`SELECT count(*) AS n, sum(x.minutes)::text AS m FROM (${src}) x WHERE ${where}`);
      const minutes = Dec.parse(agg[0].m ?? "0") as Dec;
      return {
        ...base, kind: "hours", predicate,
        columns: [{ key: "workDate", label: "Fecha" }, { key: "source", label: "Fuente" }, { key: "ticketId", label: "Ticket" }, { key: "profile", label: "Perfil" }, { key: "cls", label: "Clase de causa" }, { key: "minutes", label: "Minutos" }],
        rows: rows.map((r) => ({ ...r, minutes: (Dec.parse(r.minutes) as Dec).toString() })), total: Number(agg[0].n), numerator: minutes.divInt(60).toString(), numeratorUnit: "horas",
        note: "Las horas con elegibilidad pendiente (PMO desconocido) y las de otros servicios quedan fuera del perímetro y se explican en Análisis Cliente.",
      };
    }
    if (spec.t === "pap") {
      const pred = papPredicate(spec.kind);
      if (pred === null) {
        return { ...base, kind: "none", predicate: "Sin evidencia positiva de no facturación", columns: [], rows: [], total: 0, numerator: null, numeratorUnit: "PAP", note: "Los PAP evolutivos observados se abren desde M37; esta métrica no está disponible sin evidencia de facturación." };
      }
      const src = Prisma.sql`SELECT x.* FROM (${papSetSql(q.scope, [entityId])}) x WHERE x."productionDate" BETWEEN ${per.from}::date AND ${per.to}::date AND ${pred}`;
      const rows = await tx.$queryRaw<DetailRow[]>(Prisma.sql`
          SELECT y."listKey", y."papId", y.title, to_char(y."productionDate", 'YYYY-MM-DD') AS production, y.result, y.state,
            (SELECT string_agg(c."rawToken", ' · ' ORDER BY c.normalized) FROM "PapCause" c WHERE c."revisionId" = y.rev_id) AS causes
          FROM (${src}) y ORDER BY y."productionDate", y."listKey", y."papId" LIMIT ${pageSize} OFFSET ${off}`);
      const tot = await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM (${src}) y`);
      return {
        ...base, kind: "pap", predicate: `PAP únicos (lista + ID) con fecha de producción en el periodo y categoría «${metric.label}»`,
        columns: [{ key: "listKey", label: "Lista" }, { key: "papId", label: "ID" }, { key: "title", label: "Título" }, { key: "production", label: "Producción" }, { key: "result", label: "Resultado" }, { key: "state", label: "Estado correctivo" }, { key: "causes", label: "Causas" }],
        rows, total: Number(tot[0].n), numerator: String(Number(tot[0].n)), numeratorUnit: "PAP únicos",
        note: "Un PAP con varias causas cuenta una vez en el total; puede pertenecer a varias categorías (las categorías no suman el total único).",
      };
    }
    // Tickets y escalados.
    if (q.scope === "implementation") {
      return { ...base, kind: "none", predicate: "Sin atribución de tickets a implantaciones", columns: [], rows: [], total: 0, numerator: null, numeratorUnit: "tickets", note: "Los tickets se atribuyen a Cliente y Grupo Cliente." };
    }
    const kind = spec.t === "n2_to_n3" ? "n2_to_n3" : spec.t === "n3_tickets" ? "n3" : spec.t === "n3_pct_all" ? "n3" : null;
    if (kind === null) return { ...base, kind: "none", predicate: "Magnitud derivada del motor económico o de la matriz de usuarios", columns: [], rows: [], total: 0, numerator: null, numeratorUnit: "", note: "El detalle de ingresos, horas y usuarios está en Análisis Cliente (ficha y detalle que concilia)." };
    const src = Prisma.sql`SELECT x.* FROM (${ticketSetSql(q.scope, [entityId], per.from, per.to)}) x WHERE ${ticketPredicate(kind)}`;
    const rows = await tx.$queryRaw<DetailRow[]>(Prisma.sql`
        SELECT y.ticket_id AS "ticketId", to_char(y.created_on, 'YYYY-MM-DD') AS created, y.type, y.status, y.cause, array_to_string(y.destinations, ' · ') AS destinations
        FROM (${src}) y ORDER BY y.created_on, y.ticket_id LIMIT ${pageSize} OFFSET ${off}`);
    const tot = await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM (${src}) y`);
    return {
      ...base, kind: "tickets",
      predicate: spec.t === "n2_to_n3" ? "Tickets únicos con destino N2 y N3 (numerador de N2→N3; el denominador son los tickets con N2)" : "Tickets únicos con destino N3 (PMO o IT) creados en el periodo; dos tags N3 cuentan uno",
      columns: [{ key: "ticketId", label: "Ticket" }, { key: "created", label: "Creación" }, { key: "type", label: "Tipo" }, { key: "status", label: "Estado" }, { key: "cause", label: "Causa raíz" }, { key: "destinations", label: "Destinos" }],
      rows, total: Number(tot[0].n), numerator: String(Number(tot[0].n)), numeratorUnit: "tickets",
      note: "El mes es el de creación del ticket: las etiquetas no aportan la fecha real del escalado.",
    };
  });
}

async function entityName(tx: Prisma.TransactionClient, scope: PulseQuery["scope"], id: string): Promise<string> {
  if (scope === "group") return (await tx.clientGroup.findUnique({ where: { id }, select: { name: true } }))?.name ?? "(desconocido)";
  if (scope === "client") return (await tx.client.findUnique({ where: { id }, select: { name: true } }))?.name ?? "(desconocido)";
  const i = await tx.implementation.findUnique({ where: { id }, select: { name: true, client: { select: { name: true } } } });
  return i ? `${i.client.name} › ${i.name}` : "(desconocido)";
}
