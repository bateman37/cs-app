import { csvDocument, type CsvValue } from "@/domain/csv";
import { COLOR_LABEL, HEALTH_LABEL, INDICATOR_KEYS, INDICATOR_NAME, QSCOPE_LABEL, UNIT_LABEL, type HealthState, METRIC_UNIT } from "@/domain/quality-config";
import { HEALTH_DB_LABEL } from "@/domain/quality-health";
import { QSCOPE_NAME, type QualityQuery } from "@/domain/quality-query";
import { getHealthMatrix } from "./health";
import { getQuality, type QualityRow, type QualityView } from "./engine";

/**
 * CSV de Calidad (CSAPP-08 §10). Mismo servicio, criterios y estados que la pantalla; la cartera exporta TODAS las filas del conjunto filtrado (no la página).
 * Tablas (`tabla=`): `cartera` (seis indicadores + global por entidad), `ficha` (resumen explicado de una entidad `sel`) y `health` (matriz del año).
 * Reutiliza BOM, «;», escape y neutralización de fórmulas de CSAPP-06/07; los negativos válidos y los decimales exactos no se tocan. No exporta originales de Cargas.
 */
export const QUALITY_TABLES = ["cartera", "ficha", "health"] as const;
export type QualityTable = (typeof QUALITY_TABLES)[number];
const n = (v: string | null | undefined): CsvValue => ({ n: v ?? null });
const CONTEXT = ["ambito", "mes_solicitado", "corte_solicitado", "corte_efectivo", "periodo_desde", "estado_periodo", "revision_calidad", "revision_pulse", "configuracion_origen", "sello_datos", "cobertura", "fotografia_backlog", "generado"];
const ctx = (v: QualityView): CsvValue[] => [
  QSCOPE_LABEL[v.query.scope === "group" ? "GRUPO" : "CLIENTE"], `${v.period.year}-${String(v.period.month).padStart(2, "0")}`, v.period.requested, v.period.cut, v.period.from, v.period.provisional ? "provisional" : "cerrado",
  String(v.config.revisionNo) + (v.config.persisted ? "" : " (inicial)"), String(v.pulseRevision), v.config.simulated ? "SIMULACIÓN, NO PUBLICADO (borrador)" : v.config.adapterNotes.length ? "leída de v1 mediante adaptador" : "activa", v.stamp,
  Object.values(v.coverage).map((c) => `${c.source}: ${c.state}`).join(" | "), v.backlog.exact ? `exacta ${v.backlog.observedOn}` : v.backlog.provisional ? `observada en ${v.backlog.observedOn} (provisional)` : "no disponible", v.readAt,
];
const STATUS_TEXT: Record<string, string> = { OK: "calculado", SIN_CALIBRAR: "sin calibrar", SIN_REGLA: "sin regla", SIN_REFERENCIA: "sin referencia", DATO_INVALIDO: "dato no calculable", REGLA_INVALIDA: "regla no aplicable", BLANCO: "sin feedback (blanco)", CATEGORIA: "categoría", SIN_DATO: "sin dato", PARCIAL: "parcial", INCOMPLETO: "incompleto", COMPOSICION_SIN_ELEGIR: "composición sin elegir" };
const colorText = (c: keyof typeof COLOR_LABEL | null) => (c ? COLOR_LABEL[c] : "sin color");

export type QualityCsv = { filename: string; body: string; rows: number; stamp: string };

function indicatorCells(r: QualityRow): CsvValue[] {
  return INDICATOR_KEYS.flatMap((k) => {
    const i = r.evaluation.indicators[k];
    const w = r.evaluation.weights;
    return [
      k === "HEALTH" ? (i.value ? HEALTH_LABEL[i.value as HealthState] : "") : n(i.value), UNIT_LABEL[METRIC_UNIT[k]], colorText(i.color), `${STATUS_TEXT[i.status] ?? i.status}${i.alert && !i.color ? " (alerta roja parcial)" : ""}`,
      w ? n(w.configuredPercent[k]) : "", w ? n(w.percent[k]) : "",
    ] as CsvValue[];
  });
}

export async function qualityCsv(actorId: string, query: QualityQuery, table: QualityTable, opts: { now?: Date } = {}): Promise<QualityCsv> {
  if (table === "health") {
    // CSAPP-09 §3: matriz COMPLETA desde UNA lectura coherente (no páginas independientes) con sello de datos y fecha de lectura.
    const m = await getHealthMatrix(actorId, { scope: query.scope, year: query.year, q: query.base.q, page: 1, pageSize: 100 }, { all: true });
    const header = ["ambito", "anio", "sello_datos", "leido_el", "id", "entidad", "grupo_padre", ...Array.from({ length: 12 }, (_, i) => [`mes${i + 1}_estado`, `mes${i + 1}_comentario`, `mes${i + 1}_fecha_feedback`, `mes${i + 1}_version`]).flat()];
    const rows = m.rows.map((r) => [QSCOPE_NAME[query.scope], String(query.year), m.stamp, m.readAt, r.id, r.name, r.parent, ...Array.from({ length: 12 }, (_, i) => {
      const c = r.cells[i + 1];
      return [c ? HEALTH_DB_LABEL[c.state] : "Sin feedback", c?.comment ?? "", c?.feedbackOn ?? "", c ? n(String(c.version)) : n(null)] as CsvValue[];
    }).flat()] as CsvValue[]);
    return { filename: `calidad_health_${query.year}_${query.scope}.csv`, body: csvDocument(header, rows), rows: rows.length, stamp: m.stamp };
  }
  const v = await getQuality(actorId, query, { allRows: true, now: opts.now });
  const header = [...CONTEXT, "id", "entidad", "grupo_padre", "usuarios_corte", "usuarios_mes", ...INDICATOR_KEYS.flatMap((k) => [`${k}_valor`, `${k}_unidad`, `${k}_color`, `${k}_estado`, `${k}_peso_configurado_pct`, `${k}_peso_efectivo_pct`]), "global_color", "global_indice", "global_estado", "cobertura_asignacion_pct", "alertas_rojas_parciales", "motivo_global"];
  const tail = (r: QualityRow): CsvValue[] => [colorText(r.evaluation.global.color), n(r.evaluation.global.score), STATUS_TEXT[r.evaluation.global.status] ?? r.evaluation.global.status, n(r.coveragePercent), r.evaluation.global.partialAlerts.map((k) => INDICATOR_NAME[k]).join(" | "), r.evaluation.global.reason];
  if (table === "ficha") {
    const r = v.rows.find((x) => x.id === query.sel);
    const head = ["clave", "valor"];
    const items: [string, string][] = [];
    if (r) {
      items.push(["entidad", r.name], ["usuarios_corte", String(r.users.stock ?? "sin informar")], ["usuarios_mes", r.users.userMonths ?? "sin informar"], ["global", `${colorText(r.evaluation.global.color)} — ${r.evaluation.global.reason}`]);
      for (const k of INDICATOR_KEYS) {
        const i = r.evaluation.indicators[k];
        const e = r.explain[k];
        items.push([`${k}.valor`, `${i.value ?? ""} ${UNIT_LABEL[i.unit]}`.trim()], [`${k}.color`, `${colorText(i.color)} (${STATUS_TEXT[i.status] ?? i.status})`], [`${k}.formula`, e.formula], [`${k}.numerador`, e.numerator ?? ""], [`${k}.denominador`, e.denominator ?? ""]);
        for (const [bk, bv] of Object.entries(e.breakdown)) items.push([`${k}.desglose.${bk}`, bv]);
        for (const c of i.components ?? []) items.push([`${k}.componente.${c.id}`, `${c.value ?? ""} → ${colorText(c.color)} (${STATUS_TEXT[c.status] ?? c.status})`]);
      }
    }
    const rows = items.map(([k, val]) => [...ctx(v), k, val] as CsvValue[]);
    return { filename: `calidad_ficha_${v.period.cut}.csv`, body: csvDocument([...CONTEXT, ...head], rows), rows: rows.length, stamp: v.stamp };
  }
  const rows = v.rows.map((r) => [...ctx(v), r.id, r.name, r.parent, n(r.users.stock === null ? null : String(r.users.stock)), n(r.users.userMonths), ...indicatorCells(r), ...tail(r)] as CsvValue[]);
  return { filename: `calidad_cartera_${v.period.cut}.csv`, body: csvDocument(header, rows), rows: rows.length, stamp: v.stamp };
}
