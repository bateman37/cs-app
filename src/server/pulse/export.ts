import { csvDocument, type CsvValue } from "@/domain/csv";
import { METRIC_BY_ID } from "@/domain/pulse-catalog";
import { BAND_LABEL, NORMALIZATION_LABEL } from "@/domain/pulse-stats";
import { NORM_MODE_LABEL, PERIOD_LABEL, SCOPE_LABEL, type PulseQuery } from "@/domain/pulse-query";
import { STATE_LABEL, getPulse, type PulseView } from "./service";

/**
 * CSV de Pulse Rent (CSAPP-07 §7). Mismo servicio, criterios, orden, periodo y estados que la pantalla; exporta TODAS las filas visibles filtradas
 * (no la página). Tres tablas documentadas (`tabla=`): `filas` (valor, estado y banda textual por métrica), `estadisticas` (distribución de la
 * referencia por métrica) y `criterios` (referencia, método y revisión). Las columnas de contexto se repiten en cada fila. Reutiliza BOM, «;»,
 * escape y neutralización de fórmulas de CSAPP-06; negativos válidos y decimales exactos no se tocan. No exporta archivos originales de Cargas.
 */
export const PULSE_TABLES = ["filas", "estadisticas", "criterios"] as const;
export type PulseTable = (typeof PULSE_TABLES)[number];
const n = (v: string | null | undefined): CsvValue => ({ n: v ?? null });
const CONTEXT = ["corte", "periodo", "desde", "hasta", "estado_periodo", "ambito", "servicio", "normalizacion", "referencia", "revision_pulse", "revision_economia", "revision_calidad", "sello_datos", "validacion", "generado"];
const ctx = (v: PulseView): CsvValue[] => [
  v.cut, PERIOD_LABEL[v.query.period], v.period.from, v.period.to, v.period.provisional ? "provisional" : "cerrado", SCOPE_LABEL[v.query.scope], v.query.base.service,
  v.query.historic ? "equivalencia histórica (supone usuarios constantes y meses completos)" : NORM_MODE_LABEL[v.query.norm], `${v.reference.label} (${v.reference.origin.toLowerCase()})`,
  String(v.config.revisionNo), String(v.manifest.economic), String(v.manifest.quality), v.stamp, v.validated ? "validado" : "reproceso pendiente", v.readAt,
];

export type PulseCsv = { filename: string; body: string; rows: number; stamp: string };

export async function pulseCsv(actorId: string, query: PulseQuery, table: PulseTable): Promise<PulseCsv> {
  const v = await getPulse(actorId, query, { allRows: true });
  const name = `pulse_${v.cut}_${table}.csv`;
  if (table === "estadisticas") {
    const header = [...CONTEXT, "metrica", "etiqueta", "variante", "unidad", "direccion", "n_validas", "excluidas", "motivos_exclusion", "media", "mediana_p50", "p10", "p25", "p75", "p90", "minimo", "maximo", "valores_iguales", "aviso"];
    const rows = v.metrics.map((m) => {
      const s = v.stats[m.id];
      return [
        ...ctx(v), m.id, m.label, NORMALIZATION_LABEL[s.variant], s.unit, s.direction === "LOWER" ? "menor = mejor" : s.direction === "HIGHER" ? "mayor = mejor" : "sin juicio", String(s.n), String(s.excluded),
        s.excludedReasons.map((r) => `${r.reason}: ${r.count}`).join(" | "), n(s.mean), n(s.median), n(s.p10), n(s.p25), n(s.p75), n(s.p90), n(s.min), n(s.max), s.constant ? "sí" : "no", s.warning,
      ] as CsvValue[];
    });
    return { filename: name, body: csvDocument(header, rows), rows: rows.length, stamp: v.stamp };
  }
  if (table === "criterios") {
    const header = [...CONTEXT, "clave", "valor"];
    const items: [string, string][] = [
      ["referencia_estadistica", v.reference.label], ["origen_referencia", v.reference.origin], ["descripcion_referencia", v.reference.description],
      ["entidades_en_referencia", String(v.reference.members)], ["exclusiones", v.reference.exclusions.map((e) => `${e.reason}: ${e.count}`).join(" | ")], ["fecha_metadatos", v.reference.metadataCut],
      ["referencia_economica", v.economicReference?.label ?? "no aplica en este ámbito"],
      ["cartera_eur_jornada", v.economicReference?.portfolio.perDay ?? ""], ["cartera_estado", v.economicReference ? (v.economicReference.portfolio.complete ? "completa" : "incompleta") : ""],
      ["media_aritmetica_de_ratios", v.economicReference?.meanOfRatios ?? ""], ["filas_filtradas", String(v.filteredEntities)], ["entidades_ambito", String(v.totalEntities)],
      ["metricas", v.metrics.map((m) => m.id).join(" ")], ["version_motor", v.engineVersion],
    ];
    const rows = items.map(([k, val]) => [...ctx(v), k, val] as CsvValue[]);
    return { filename: name, body: csvDocument(header, rows), rows: rows.length, stamp: v.stamp };
  }
  const header = [...CONTEXT, "id", "entidad", "grupo_padre", ...v.metrics.flatMap((m) => [`${m.id}_valor`, `${m.id}_bruto`, `${m.id}_estado`, `${m.id}_banda`, `${m.id}_unidad`])];
  const rows = v.rows.map((r) => [
    ...ctx(v), r.id, r.name, r.parent,
    ...v.metrics.flatMap((m) => {
      const c = r.cells[m.id];
      return [n(c.value), n(c.raw), `${STATE_LABEL[c.state]}${c.reason ? ` — ${c.reason}` : ""}`, c.band ? BAND_LABEL[c.band] : c.bandReason ?? "", c.unit] as CsvValue[];
    }),
  ]);
  void METRIC_BY_ID;
  return { filename: name, body: csvDocument(header, rows), rows: rows.length, stamp: v.stamp };
}
