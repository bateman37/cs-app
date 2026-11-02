import { Prisma } from "@/generated/prisma/client";
import type { CsvValue } from "@/domain/csv";
import { SERVICE_OF_SQL } from "@/server/economics/engine";
import { N3_DESTINATIONS, papSetSql, ticketSetSql } from "@/server/pulse/sql";
import { bugUnion, predicate, stockSetSql, validBugLinkSql, type QScopeDb } from "@/server/quality/facts";
import type { Tx } from "@/server/analytics/snapshot";

/**
 * Conjuntos de exportación completa (CSAPP-09 §6). Cada archivo tiene CONTRATO: columnas con tipo y unidad, granularidad, clave, orden estable, regla de
 * conciliación y si sus filas son ADITIVAS. Las relaciones (p. ej. PAP–causas, problema–bug) van en archivos distintos o con una columna que identifica la
 * fila que cuenta, de modo que una relación uno a varios nunca multiplica un numerador. No se exportan tablas internas indiscriminadamente.
 */
export type ColKind = "text" | "number" | "date" | "bool";
export type Col = { name: string; kind: ColKind; unit?: string; doc: string };
export type Params = { scope: QScopeDb; ids: string[] | null; sel: string | null; from: string; to: string; service: "TOTAL" | "SOPORTE" | "ADMIN_DELEGADA" | "OTROS"; snapshotBatchId: string | null; snapshotObservedOn: string | null; agedThresholds: { incident: number | null; problem: number | null } };
export type FileDef = {
  fileKey: string;
  title: string;
  granularity: string;
  key: string[];
  order: string[];
  additive: boolean;
  reconciliation: string;
  columns: Col[];
  /** SELECT que devuelve las columnas del contrato (mismo nombre) en cualquier orden; la materialización las ordena por `order`. */
  sql: (p: Params) => Prisma.Sql;
};
export type DatasetDef = { key: string; label: string; description: string; files: FileDef[] };

const t = (name: string, doc: string): Col => ({ name, kind: "text", doc });
const d = (name: string, doc: string): Col => ({ name, kind: "date", doc });
const b = (name: string, doc: string): Col => ({ name, kind: "bool", doc });
const n = (name: string, unit: string, doc: string): Col => ({ name, kind: "number", unit, doc });

const entityCol = (scope: QScopeDb, alias: string) => Prisma.raw(`${alias}.${scope === "group" ? '"groupId"' : '"clientId"'}`);

// ---------------------------------------------------------------- Dedicación

const HORAS: FileDef = {
  fileKey: "horas",
  title: "Hechos de dedicación y su partición contable",
  granularity: "una fila por registro de tiempo (fuente, id_entrada)",
  key: ["fuente", "id_entrada"],
  order: ["fecha_trabajo", "fuente", "id_entrada"],
  additive: true,
  reconciliation: "Σ minutos de todas las filas = minutos del periodo en la fuente; la suma por clase_particion (ELEGIBLE, PENDIENTE, EXCLUIDA) reproduce el total sin solapes. Las filas sin Grupo/Cliente conservan su motivo y no se suman al numerador elegible.",
  columns: [
    t("fuente", "ZENDESK o WRIKE"), t("id_entrada", "identidad del registro en su fuente"), d("fecha_trabajo", "fecha del trabajo (Europe/Madrid, fecha de negocio)"),
    n("minutos", "min", "minutos exactos conservados"), n("horas", "h", "minutos ÷ 60 (conversión final; Wrike ya trae horas decimales convertidas a minutos en la carga)"),
    t("ticket_id", "ticket asociado si existe"), t("grupo_id", "Grupo Cliente atribuido o vacío"), t("cliente_id", "Cliente atribuido o vacío"), t("servicio", "servicio económico derivado (SOPORTE, ADMIN_DELEGADA, OTROS, SIN_CLASIFICAR, CONFLICTO)"),
    t("clase_particion", "ELEGIBLE | PENDIENTE | EXCLUIDA"), t("elegibilidad", "motivo de elegibilidad de origen"), t("motivo_particion", "motivo principal de inclusión/exclusión (partición contable)"), b("pmo", "pertenencia histórica a PMO en la fecha del trabajo"), b("interno", "cliente interno"),
  ],
  sql: (p) => {
    const filter = p.sel ? Prisma.sql`AND (${entityCol(p.scope, "t")} = ${p.sel})` : Prisma.empty;
    return Prisma.sql`
      WITH a0 AS (SELECT t.* FROM "TimeActivity" t WHERE t."workDate" BETWEEN ${p.from}::date AND ${p.to}::date ${filter}),
      a AS (SELECT a.*, ${SERVICE_OF_SQL} AS svc FROM a0 a)
      SELECT a.source AS fuente, a."entryId"::text AS id_entrada, a."workDate"::text AS fecha_trabajo, a.minutes::text AS minutos, (a.minutes / 60)::text AS horas,
        a."ticketId" AS ticket_id, a."groupId" AS grupo_id, a."clientId" AS cliente_id, a.svc AS servicio,
        CASE a.eligibility WHEN 'ELIGIBLE' THEN 'ELEGIBLE' WHEN 'PENDING_ELIGIBILITY' THEN 'PENDIENTE' ELSE 'EXCLUIDA' END AS clase_particion,
        a.eligibility AS elegibilidad, a.bucket AS motivo_particion, a.pmo::text AS pmo, a."isInternal"::text AS interno
      FROM a WHERE (${p.service} = 'TOTAL' OR a.svc = ${p.service})`;
  },
};

// ---------------------------------------------------------------- Tickets, backlog, bugs

const x = Prisma.raw("x");
const TICKETS: FileDef = {
  fileKey: "tickets",
  title: "Tickets del periodo (flujo, N3, afectación estándar/bugs)",
  granularity: "una fila por ticket creado en el periodo (identidad única); la fecha del escalado es la de CREACIÓN",
  key: ["ticket_id"],
  order: ["fecha_creacion", "ticket_id"],
  additive: true,
  reconciliation: "Filas = tickets únicos del periodo. es_flujo, es_n3, afectacion_union son pertenencias que se cuentan sobre estas filas; n3_pmo y n3_it son desgloses NO aditivos (un ticket con ambos destinos cuenta uno en la unión). Σ afectacion_union = numerador del sexto indicador.",
  columns: [
    t("ticket_id", "identidad Zendesk"), d("fecha_creacion", "fecha de creación (cohorte)"), t("entidad_id", "Grupo o Cliente según el ámbito"), t("tipo", "tipo del ticket"), t("estado", "estado de la revisión vigente (observación, no fecha de cierre)"),
    t("causa_raiz", "causa raíz (agrupada)"), t("destinos", "destinos de escalado separados por |"), b("es_flujo", "incidente o problema (alta del periodo)"), b("es_n3", "unión PMO N3 ∪ IT N3"), b("n3_pmo", "desglose no aditivo"), b("n3_it", "desglose no aditivo"),
    b("afect_estandar", "problema con causa estándar"), b("afect_bug", "problema con vínculo válido a Bug_"), b("afectacion_union", "unión estándar ∪ bug (numerador del sexto indicador)"), b("incidente_vinculado_bug", "incidente con vínculo válido a bug (adicional; no numerador)"),
  ],
  sql: (p) => Prisma.sql`
    SELECT x.ticket_id, x.created_on::text AS fecha_creacion, x.entity AS entidad_id, x.type AS tipo, x.status AS estado, x.cause AS causa_raiz, array_to_string(x.destinations, '|') AS destinos,
      (${predicate.incidentOrProblem})::text AS es_flujo, (${predicate.n3})::text AS es_n3, (${predicate.n3Pmo})::text AS n3_pmo, (${predicate.n3It})::text AS n3_it,
      (${predicate.bugStd})::text AS afect_estandar, (${predicate.bugLink})::text AS afect_bug, (${bugUnion})::text AS afectacion_union,
      (${predicate.incident} AND ${validBugLinkSql(Prisma.sql`x.ticket_id`)})::text AS incidente_vinculado_bug
    FROM (${ticketSetSql(p.scope, p.ids ?? [], p.from, p.to)}) x WHERE x.entity IS NOT NULL ${p.sel ? Prisma.sql`AND x.entity = ${p.sel}` : Prisma.empty}`,
};
void x; void N3_DESTINATIONS;

const BACKLOG: FileDef = {
  fileKey: "backlog",
  title: "Backlog observado de la fotografía elegida",
  granularity: "una fila por ticket activo observado en la fotografía compatible con el corte",
  key: ["ticket_id"],
  order: ["fecha_creacion", "ticket_id"],
  additive: true,
  reconciliation: "Filas = tickets activos (new/open/pending/hold) incidente/problema de la fotografía; Σ envejecido = numerador del stock envejecido. La fotografía anterior es provisional y conserva su fecha. Sin fotografía compatible el archivo queda vacío con su motivo en el manifiesto.",
  columns: [
    t("ticket_id", "identidad Zendesk"), t("entidad_id", "Grupo o Cliente"), t("tipo", "incident o problem"), t("estado", "estado observado"), d("fecha_creacion", "creación"), d("fecha_observacion", "fecha de la fotografía"),
    n("edad_dias", "días", "fecha de observación − fecha de creación (nunca el estado actual)"), b("envejecido", "edad > umbral configurado (vacío si no hay umbral)"),
  ],
  sql: (p) => {
    if (!p.snapshotBatchId || !p.snapshotObservedOn) return Prisma.sql`SELECT NULL::text AS ticket_id, NULL::text AS entidad_id, NULL::text AS tipo, NULL::text AS estado, NULL::text AS fecha_creacion, NULL::text AS fecha_observacion, NULL::text AS edad_dias, NULL::text AS envejecido WHERE false`;
    const sel = p.sel ? [p.sel] : (p.ids ?? []);
    return Prisma.sql`
      SELECT s.ticket_id, s.entity AS entidad_id, s.type AS tipo, s.status AS estado, s.created_on AS fecha_creacion, ${p.snapshotObservedOn}::text AS fecha_observacion,
        (${p.snapshotObservedOn}::date - s.created_on::date)::text AS edad_dias,
        CASE WHEN s.type = 'incident' AND ${p.agedThresholds.incident}::int IS NOT NULL THEN ((${p.snapshotObservedOn}::date - s.created_on::date) > ${p.agedThresholds.incident}::int)::text
             WHEN s.type = 'problem' AND ${p.agedThresholds.problem}::int IS NOT NULL THEN ((${p.snapshotObservedOn}::date - s.created_on::date) > ${p.agedThresholds.problem}::int)::text ELSE NULL END AS envejecido
      FROM (${stockSetSql(p.scope, sel, p.snapshotBatchId, { activeOnly: true })}) s
      WHERE s.entity IS NOT NULL AND s.status_known AND s.status IN ('new', 'open', 'pending', 'hold') AND s.type IN ('incident', 'problem')`;
  },
};

const BUGS: FileDef = {
  fileKey: "problemas_bugs",
  title: "Problemas externos y sus vínculos a Bug_",
  granularity: "una fila por vínculo ticket–Work Item (relación uno a varios); los problemas sin vínculo aparecen con una fila vacía de bug",
  key: ["ticket_id", "producto", "work_item_id"],
  order: ["ticket_id", "producto", "work_item_id"],
  additive: false,
  reconciliation: "La relación NO es aditiva: Σ cuenta_numerador = problemas únicos de la unión (estándar ∪ vínculo válido a Bug_); un problema con dos bugs cuenta una vez (solo su primera fila tiene cuenta_numerador = true) y un bug con dos problemas aparece en dos filas.",
  columns: [
    t("ticket_id", "problema (ticket)"), d("fecha_creacion", "creación del ticket"), t("entidad_id", "Grupo o Cliente"), b("causa_estandar", "causa estándar"), t("producto", "VFS o VSW"), t("work_item_id", "identidad del Work Item en su producto"),
    b("es_bug", "Work Item Type = Bug_"), t("estado_vinculo", "estado derivado del vínculo"), t("revision_manual", "CONFIRMED, REJECTED o vacío"), b("vinculo_valido", "bug + resuelto + no rechazado + evidencia vigente o confirmación manual"), b("cuenta_numerador", "la fila que sustenta el problema en el numerador (una por ticket)"),
  ],
  sql: (p) => Prisma.sql`
    WITH x AS (SELECT * FROM (${ticketSetSql(p.scope, p.ids ?? [], p.from, p.to)}) q WHERE q.type = 'problem' AND q.entity IS NOT NULL ${p.sel ? Prisma.sql`AND q.entity = ${p.sel}` : Prisma.empty}),
    r AS (
      SELECT x.ticket_id, x.created_on, x.entity, x.cause, w.product, w."workItemId" AS work_item_id, wr."isBug" AS is_bug, l."drvState" AS drv_state, l."manualState" AS manual_state,
        (wr."isBug" AND l."drvState" = 'RESOLVED_EXTERNAL' AND COALESCE(l."manualState", '') <> 'REJECTED'
          AND (l."manualState" = 'CONFIRMED' OR EXISTS (SELECT 1 FROM "WorkItemLinkEvidence" e JOIN "UploadBatch" eb ON eb.id = e."batchId" AND eb.status = 'COMPLETED' WHERE e."linkId" = l.id))) AS valid
      FROM x
      LEFT JOIN "WorkItemLink" l ON l."ticketId" = x.ticket_id
      LEFT JOIN "WorkItem" w ON w.id = l."workItemId"
      LEFT JOIN "WorkItemRevision" wr ON wr.id = w."currentRevisionId")
    SELECT r.ticket_id, r.created_on::text AS fecha_creacion, r.entity AS entidad_id, (lower(r.cause) = ${"incidente_estándar_plataforma"})::text AS causa_estandar,
      COALESCE(r.product, '') AS producto, COALESCE(r.work_item_id, '') AS work_item_id, r.is_bug::text AS es_bug, r.drv_state AS estado_vinculo, r.manual_state AS revision_manual, COALESCE(r.valid, false)::text AS vinculo_valido,
      (row_number() OVER (PARTITION BY r.ticket_id ORDER BY (COALESCE(r.valid, false)) DESC, r.product, r.work_item_id) = 1
        AND (lower(r.cause) = ${"incidente_estándar_plataforma"} OR bool_or(COALESCE(r.valid, false)) OVER (PARTITION BY r.ticket_id)))::text AS cuenta_numerador
    FROM r`,
};

// ---------------------------------------------------------------- PAP

const PAP: FileDef = {
  fileKey: "pap",
  title: "PAP únicos del periodo",
  granularity: "una fila por PAP (lista + id) con producción en el periodo o sin fecha",
  key: ["lista", "pap_id"],
  order: ["lista", "pap_id"],
  additive: true,
  reconciliation: "Filas = PAP únicos. Σ es_correctivo (fecha dentro del periodo) = numerador correctivo; cualquier causa correctiva lo clasifica y varias causas no lo multiplican. Los PAP sin fecha se conservan con fecha vacía y no se ubican en el periodo.",
  columns: [t("lista", "lista de origen"), t("pap_id", "ID del PAP"), t("entidad_id", "Grupo o Cliente"), d("fecha_produccion", "fecha de producción"), t("resultado", "resultado de origen (sin filtro silencioso)"), t("estado_correctivo", "CORRECTIVE | NON_CORRECTIVE | UNKNOWN"), b("es_correctivo", "correctivo con producción en el periodo"), b("en_periodo", "producción dentro del periodo")],
  sql: (p) => Prisma.sql`
    SELECT x."listKey" AS lista, x."papId" AS pap_id, x.entity AS entidad_id, x."productionDate"::text AS fecha_produccion, x.result AS resultado, x.state AS estado_correctivo,
      (x.state = 'CORRECTIVE' AND x."productionDate" BETWEEN ${p.from}::date AND ${p.to}::date)::text AS es_correctivo, (x."productionDate" BETWEEN ${p.from}::date AND ${p.to}::date)::text AS en_periodo
    FROM (${papSetSql(p.scope, p.ids ?? [])}) x WHERE (x."productionDate" IS NULL OR x."productionDate" BETWEEN ${p.from}::date AND ${p.to}::date) ${p.sel ? Prisma.sql`AND x.entity = ${p.sel}` : Prisma.empty}`,
};
const PAP_CAUSAS: FileDef = {
  fileKey: "pap_causas",
  title: "Causas de los PAP",
  granularity: "una fila por causa de cada PAP (relación uno a varios)",
  key: ["lista", "pap_id", "orden"],
  order: ["lista", "pap_id", "orden"],
  additive: false,
  reconciliation: "NO aditivo: un PAP con varias causas aparece en varias filas; el recuento de PAP sale del archivo «pap», no de este. Las pertenencias (estándar, proyecto, origen cliente) pueden solaparse.",
  columns: [t("lista", "lista de origen"), t("pap_id", "ID del PAP"), n("orden", "n", "orden de la causa en el PAP"), t("categoria", "CORRECTIVE | EVOLUTIVE | …"), t("origen", "STANDARD | CUSTOMIZATION | CONFIG_DATA | PROCESSES | INFRASTRUCTURE | CLIENT_ORIGIN | vacío"), t("causa_normalizada", "causa normalizada")],
  sql: (p) => Prisma.sql`
    SELECT x."listKey" AS lista, x."papId" AS pap_id, c.ord::text AS orden, c.category AS categoria, c.origin AS origen, c.normalized AS causa_normalizada
    FROM (${papSetSql(p.scope, p.ids ?? [])}) x
    JOIN LATERAL (SELECT row_number() OVER (ORDER BY pc.id) AS ord, pc.category, pc.origin, pc.normalized FROM "PapCause" pc WHERE pc."revisionId" = x.rev_id) c ON true
    WHERE (x."productionDate" IS NULL OR x."productionDate" BETWEEN ${p.from}::date AND ${p.to}::date) ${p.sel ? Prisma.sql`AND x.entity = ${p.sel}` : Prisma.empty}`,
};

// ---------------------------------------------------------------- Finanzas

const FINANZAS: FileDef = {
  fileKey: "finanzas_lineas",
  title: "Líneas financieras vigentes del perímetro (sin copiar el archivo original)",
  granularity: "una fila por línea activa de cada año y categoría",
  key: ["anio", "categoria", "posicion"],
  order: ["anio", "categoria", "posicion"],
  additive: true,
  reconciliation: "Σ ingreso por anio+categoria = ingreso de las líneas activas (Total de origen se concilia en Administración). El importe anual no se suma otra vez con sus meses; Vta Potencial y Budget no forman parte de este archivo.",
  columns: [n("anio", "año", "año del conjunto vigente"), t("categoria", "SOPORTE | ADMIN_DELEGADA | OTROS"), n("posicion", "n", "posición de la línea en el lote"), t("etiqueta_origen", "etiqueta de Grupo en la fuente"), t("grupo_id", "Grupo Cliente atribuido o vacío"), n("ingreso", "€", "ingreso anual de la línea (decimal exacto)"), t("atribucion", "RESOLVED | UNRESOLVED | …"), b("ingreso_cero_derivado", "cero derivado por la regla de importación")],
  sql: (p) => Prisma.sql`
    SELECT s.year::text AS anio, s.category AS categoria, r.position::text AS posicion, r."groupLabel" AS etiqueta_origen, r."groupId" AS grupo_id, r.income::text AS ingreso, r.resolution AS atribucion, r."incomeDerivedZero"::text AS ingreso_cero_derivado
    FROM "FinanceScope" s JOIN "FinanceRow" r ON r."batchId" = s."activeBatchId"
    WHERE s.year BETWEEN extract(year FROM ${p.from}::date)::int AND extract(year FROM ${p.to}::date)::int ${p.sel && p.scope === "group" ? Prisma.sql`AND r."groupId" = ${p.sel}` : Prisma.empty}`,
};

export const DATASETS: DatasetDef[] = [
  { key: "horas", label: "Hechos de dedicación y partición contable", description: "Cada registro de tiempo del periodo con su fuente, identidad, fecha, minutos/horas, ámbito y motivo de inclusión o exclusión.", files: [HORAS] },
  { key: "tickets", label: "Tickets, escalados N3, afectación y backlog", description: "Tickets creados en el periodo (flujo, N3, estándar/bugs) y el backlog observado de la fotografía compatible con el corte.", files: [TICKETS, BACKLOG] },
  { key: "pap", label: "PAP únicos y sus causas", description: "PAP por lista+ID con su clasificación y, aparte, sus causas (relación no aditiva).", files: [PAP, PAP_CAUSAS] },
  { key: "bugs", label: "Problemas y vínculos a bugs de producto", description: "Problemas externos con producto e identidad inequívoca; el numerador no se multiplica por la relación uno a varios.", files: [BUGS] },
  { key: "finanzas", label: "Líneas financieras del perímetro", description: "Líneas activas por año y categoría que explican el ingreso imputado (importes de la carga, sin el archivo original).", files: [FINANZAS] },
];
export const DATASET_KEYS = DATASETS.map((s) => s.key) as [string, ...string[]];
export const datasetOf = (key: string): DatasetDef | undefined => DATASETS.find((s) => s.key === key);

/** Celdas del archivo con su tipo de contrato (el cliente no controla ningún predicado): decimales exactos, fechas, textos neutralizados por `csvCell`. */
export function toCsvCells(cols: Col[], cells: (string | null)[]): CsvValue[] {
  return cols.map((c, i) => {
    const v = cells[i] ?? null;
    if (c.kind === "number") return { n: v };
    if (c.kind === "bool") return v === "true" ? "sí" : v === "false" ? "no" : "";
    return v;
  });
}
export type { Tx };
