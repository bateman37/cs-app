import { csvDocument, type CsvValue } from "@/domain/csv";
import { ECONOMIC_METHOD, type Formula } from "@/domain/finance";
import { BLOCK_PERIOD, type AnalysisQuery } from "@/domain/analytics-query";
import { VALUE_LABEL } from "@/domain/catalogs";
import type { EconomicResult, PeriodKey, PeriodSeries } from "@/server/economics/engine";
import { getPortfolioAll } from "./portfolio";
import { getFicha } from "./ficha";
import { loadTickets, type EntityRef } from "./operational";
import { MEASURES, type MeasureKey, type MonthRow } from "@/domain/ficha-series";
import { readSnapshot } from "./snapshot";
import { BAND_SHORT, economicBand, type BandFactors } from "@/domain/economic-bands";

/**
 * CSV de resúmenes (CSAPP-06 §11). Mismo servicio, orden, periodo y estados que la pantalla: nunca la página renderizada ni ratios recalculados.
 * Estructura documentada: UNA cabecera tabular; las columnas de contexto (fecha, corte, modo, servicio, método, revisión, referencia de datos,
 * cobertura) se repiten en cada fila para que el archivo sea utilizable con filtros de Excel. Desconocido = celda vacía + estado/motivo; cero = «0».
 * Decimales con coma y separador «;» (Excel en español); UTF-8 con BOM.
 */
export const PERIOD_NAME: Record<PeriodKey, string> = { month: "mes_seleccionado", prevMonth: "mes_anterior", cum: "cum_actual", prevYear: "anio_anterior_completo", prevCum: "cum_anterior_comparable" };

const n = (v: string | null | undefined): CsvValue => ({ n: v ?? null });
const label = (v: string) => VALUE_LABEL[v] ?? v;
const cell = (c: { values: string[]; heterogeneous: boolean }) => (c.values.length === 0 ? "sin informar" : c.heterogeneous ? `Mixto: ${c.values.map(label).join(" / ")}` : label(c.values[0]));

type Ctx = Pick<EconomicResult, "settings" | "reference" | "input" | "periodsDefinition">;
export const CONTEXT_HEADER = ["fecha_solicitada", "corte_efectivo", "modo", "servicio", "ambito", "metodo_ingreso", "revision_configuracion", "objetivo_eur_jornada", "jornada_horas", "version_motor", "sello_datos", "validacion", "generado"] as const;
export function contextCells(q: AnalysisQuery, e: Ctx, scope: string): CsvValue[] {
  return [
    q.date, e.input.cut, q.mode === "FULL_MONTH" ? "mes completo" : "a fecha de corte", q.service, scope, `${ECONOMIC_METHOD} (ingreso imputado)`,
    String(e.settings.revisionNo), n(e.settings.targetEurosPerDay), n(e.settings.dayHours), e.reference.engineVersion, e.reference.dataStamp.stamp,
    e.reference.validation.state === "VALIDATED" ? "validado" : "reproceso pendiente", e.reference.readAt,
  ];
}

const f = (x: Formula | null | undefined): CsvValue[] => [n(x?.value ?? null), x?.status ?? "", x?.reason ?? ""];
/** Banda económica del €/jornada (misma escala que la pantalla), provisional e imputado: color + estado, nunca solo color. */
let CSV_BANDS: { target: string; factors: BandFactors } = { target: "550", factors: ["0.6", "0.8", "1", "1.2"] };
const bandCells = (x: Formula | null | undefined): CsvValue[] => {
  const b = economicBand(x?.value ?? null, CSV_BANDS.target, CSV_BANDS.factors);
  return [b ? BAND_SHORT[b] : "", x?.provisional ? "provisional" : "", x?.imputed ? "imputación anual prorrateada" : ""];
};
const periodCells = (p: PeriodSeries): CsvValue[] => [
  p.from, p.to, p.provisional ? "provisional" : "cerrado", p.validated ? "sí" : "no",
  n(p.hours.inPerimeter), n(p.revenue.value), p.revenue.status, n(p.revenue.known),
  ...f(p.perDay), ...f(p.deviationVsTarget), ...f(p.deviationVsPortfolio), ...f(p.deviationHours), n(p.targetHours.value),
  p.users.stock.value === null ? null : String(p.users.stock.value), n(p.users.averageUsers), n(p.users.userMonths), ...f(p.perUserPerYear), ...bandCells(p.perDay),
];
const PERIOD_COLS = ["desde", "hasta", "estado_periodo", "validado", "horas", "ingreso_imputado_eur", "estado_ingreso", "ingreso_conocido_eur", "eur_jornada", "estado_ratio", "motivo_ratio", "desv_objetivo", "estado_desv_objetivo", "motivo_desv_objetivo", "desv_cartera", "estado_desv_cartera", "motivo_desv_cartera", "desv_horas", "estado_desv_horas", "motivo_desv_horas", "horas_objetivo", "usuarios_corte", "usuarios_medios", "usuarios_mes", "tarifa_usuario_anio", "estado_tarifa", "motivo_tarifa", "banda_rentabilidad", "perimetro_cifra", "metodo_imputacion"];

export type CsvResult = { filename: string; body: string; rows: number; stamp: string };

/** Cartera COMPLETA filtrada (todas las filas, en el orden de la tabla, no solo la página) con la fila de cartera de cada periodo. */
export async function portfolioCsv(actorId: string, query: AnalysisQuery): Promise<CsvResult> {
  const v = await getPortfolioAll(actorId, query);
  const ctx = v.economics;
  CSV_BANDS = { target: ctx.settings.targetEurosPerDay, factors: ctx.settings.bandFactors };
  const header = [...CONTEXT_HEADER, "fila", "grupo_cliente", "id", "denominacion_bc", "estado_maestro", "soporte", "servidor", "complejidad", "producto", "cobertura_maestro", "periodo", ...PERIOD_COLS, "cobertura_cartera_grupos", "cobertura_cartera_completos", "grupos_afectados", "ingreso_sin_dedicacion_eur", "grupos_sin_dedicacion"];
  const rows: CsvValue[][] = [];
  const keys = Object.keys(PERIOD_NAME) as PeriodKey[];
  const sel = [query.support.length ? `soporte: ${query.support.map(label).join(" / ")}` : "", query.hosting.length ? `servidor: ${query.hosting.join(" / ")}` : ""].filter(Boolean).join("; ");
  const scope = `grupos filtrados (${v.filteredGroups} de ${v.totalGroups}) · estado: ${query.status}${sel ? ` · ${sel}` : ""}`;
  for (const k of keys) {
    const pf = ctx.portfolio?.[k];
    if (!pf) continue;
    const p = ctx.periodsDefinition[k];
    rows.push([
      ...contextCells(query, ctx, scope), "CARTERA", "(cartera filtrada)", "", "", "", "", "", "", "", "", PERIOD_NAME[k],
      p.from, p.to, p.provisional ? "provisional" : "cerrado", ctx.reference.validation.state === "VALIDATED" ? "sí" : "no",
      n(pf.hours), n(pf.revenue), pf.complete ? "AVAILABLE" : "PARTIAL", n(pf.revenue),
      ...f(pf.perDay), ...f(pf.deviationVsTarget), n(null), "", "", n(null), "", "", n(null), v.totals[k].users, n(null), n(null), n(v.totals[k].tariff), v.totals[k].tariff === null ? "NOT_COMPUTABLE" : v.totals[k].tariffMissing > 0 ? "PARTIAL" : "AVAILABLE", v.totals[k].tariffMissing > 0 ? `${v.totals[k].tariffMissing} grupo(s) sin tarifa calculable no aportan` : "", ...bandCells(pf.perDay),
      String(pf.coverage.groups), String(pf.coverage.complete), pf.affected.map((a) => `${a.code}:${a.groups}`).join(" | "), n(pf.zeroHours.income), String(pf.zeroHours.count),
    ]);
  }
  for (const r of v.allRows) {
    for (const k of keys) {
      rows.push([
        ...contextCells(query, ctx, scope), "GRUPO", r.meta.name, r.meta.id, r.meta.bcDenomination, r.meta.isActive ? "activo" : "inactivo", cell(r.meta.support), cell(r.meta.hosting), cell(r.meta.complexity), cell(r.meta.product), r.meta.coverage, PERIOD_NAME[k],
        ...periodCells(r.periods[k]), "", "", "", "", "",
      ]);
    }
  }
  return { filename: `comparativa_${query.date}_${query.service.toLowerCase()}.csv`, body: csvDocument(header, rows), rows: v.allRows.length, stamp: ctx.reference.dataStamp.stamp };
}

export const FICHA_TABLES = ["series", "interanual", "dedicacion", "pap", "tickets"] as const;
export type FichaTable = (typeof FICHA_TABLES)[number];

export async function fichaCsv(actorId: string, query: AnalysisQuery, ref: EntityRef, table: FichaTable): Promise<CsvResult | null> {
  const v = await getFicha(actorId, query, ref);
  if (!v) return null;
  const ctx = v.economics;
  CSV_BANDS = { target: ctx.settings.targetEurosPerDay, factors: ctx.settings.bandFactors };
  const scope = `${ref.type === "group" ? "grupo" : ref.type === "client" ? "cliente" : "implantación"}: ${v.context.name}`;
  const base = (): CsvValue[] => [...contextCells(query, ctx, scope), v.context.ref.type, v.context.name, v.context.ref.id];
  const head = [...CONTEXT_HEADER, "tipo_ambito", "ambito", "id"];
  let header: string[];
  const rows: CsvValue[][] = [];
  if (table === "series") {
    header = [...head, "serie", "periodo", ...PERIOD_COLS];
    for (const k of Object.keys(PERIOD_NAME) as PeriodKey[]) rows.push([...base(), "PERIODO", PERIOD_NAME[k], ...periodCells(v.entity.periods[k])]);
    for (const m of v.entity.monthly) rows.push([...base(), "MENSUAL_ACTUAL", m.label, ...periodCells(m)]);
    for (const m of v.entity.prevMonthly) rows.push([...base(), "MENSUAL_ANTERIOR_COMPARABLE", m.label, ...periodCells(m)]);
  } else if (table === "interanual") {
    // El MISMO conjunto de filas que el gráfico, el tooltip y la tabla equivalente de la ficha (domain/ficha-series).
    header = [...head, "medida", "unidad", "mes", "actual", "mismo_mes_anterior", "diferencia", "unidad_diferencia", "variacion_pct", "estado_variacion", "actual_hasta", "anterior_hasta", "mes_parcial"];
    for (const [key, list] of Object.entries(v.series.rows) as [MeasureKey, MonthRow[] | null][]) {
      const m = MEASURES[key];
      if (!list) {
        rows.push([...base(), m.title, m.unit, "", "", "", "", "", "", v.series.missing[key] ?? "no disponible", "", "", ""]);
        continue;
      }
      for (const r of list) {
        if (r.future) continue; // meses futuros: sin fila (no son ceros)
        rows.push([...base(), m.title, m.unit, `${r.month}`, n(r.cur?.v ?? null), n(r.prev?.v ?? null), n(r.cmp?.diff ?? null), m.kind === "fraction" ? "puntos porcentuales" : m.unit, n(r.cmp?.pct ?? null), r.cmp?.state ?? "", r.curTo ?? "", r.prevTo ?? "", r.partial ? "sí" : "no"]);
      }
    }
  } else if (table === "dedicacion") {
    header = [...head, "cuadro", "fila", "perfil", "periodo", "horas", "porcentaje"];
    const per = ["month", "prevMonth", "cum", "prevCum", "prevYear"] as const;
    const pct = (f: string | null): CsvValue => n(f);
    for (const r of v.tables.equipo.rows) for (const k of per) rows.push([...base(), "equipo_y_perfil", r.profile, r.profile, PERIOD_NAME[k], n(r.periods[k].hours), pct(r.share[k])]);
    for (const k of per) rows.push([...base(), "equipo_y_perfil", "Total", "", PERIOD_NAME[k], n(v.tables.equipo.total[k].hours), ""]);
    for (const g of v.tables.ticket.groups) {
      for (const k of per) rows.push([...base(), "tipo_de_ticket_y_perfil", g.label, "(tipo)", PERIOD_NAME[k], n(g.total[k].hours), ""]);
      for (const r of g.profiles) for (const k of per) rows.push([...base(), "tipo_de_ticket_y_perfil", g.label, r.profile, PERIOD_NAME[k], n(r.periods[k].hours), pct(r.share[k])]);
    }
    for (const k of per) rows.push([...base(), "tipo_de_ticket_y_perfil", "Total", "", PERIOD_NAME[k], n(v.tables.ticket.total[k].hours), ""]);
    for (const r of [...v.tables.problema.rows, v.tables.problema.total]) {
      rows.push([...base(), "tipo_de_problema_vincle", r.label, "", "cum_actual", n(r.cum.hours), pct(r.shareOfDedicated)]);
      rows.push([...base(), "tipo_de_problema_vincle", r.label, "", "cum_actual_sobre_horas_objetivo", n(r.cum.hours), pct(r.shareOfTarget)]);
      rows.push([...base(), "tipo_de_problema_vincle", r.label, "", "cum_anterior_comparable", n(r.prevCum.hours), ""]);
    }
  } else if (table === "pap") {
    header = [...head, "periodo", "pap_unicos", "correctivos", "correctivo_estandar", "correctivo_proyecto_personalizacion_config_procesos_infra", "origen_cliente", "evolutivos_sin_evidencia_de_facturacion", "peticion_cliente", "sin_clasificar", "resultado_no_ok", "tabla_aditiva"];
    for (const [pk, p] of Object.entries(v.pap.periods)) {
      if (!(pk in PERIOD_NAME)) continue;
      rows.push([...base(), PERIOD_NAME[pk as PeriodKey], String(p.total), String(p.corrective), String(p.standard), String(p.project), String(p.clientOrigin), String(p.evolutive), String(p.clientRequest), String(p.unclassified), String(p.nonOk), p.additive ? "sí" : "no (un PAP en varias categorías)"]);
    }
    rows.push([...base(), "SIN_FECHA_DE_PRODUCCION", String(v.pap.withoutProductionDate), "", "", "", "", "", "", "", "", ""]);
  } else {
    header = [...head, "periodo", "tickets_creados", "incident", "problem", "otros_tipos", "escalados_n2", "escalados_n3_union", "n3_pmo", "n3_it", "n4_union", "n4_vfs", "n4_arq", "n4_vsw", "nota"];
    const periods = (Object.keys(PERIOD_NAME) as PeriodKey[]).map((k) => ({ key: k as string, from: ctx.periodsDefinition[k].from, to: ctx.periodsDefinition[k].to }));
    const t = await readSnapshot(actorId, (tx) => loadTickets(tx, ref, periods));
    if (!t.supported) rows.push([...base(), "(no disponible)", "", "", "", "", "", "", "", "", "", "", "", "", "Las implantaciones no identifican tickets: solo Grupo y Cliente."]);
    for (const [pk, x] of Object.entries(t.periods)) {
      rows.push([...base(), PERIOD_NAME[pk as PeriodKey], String(x.total), String(x.incident), String(x.problem), String(x.other), String(x.escalations.n2), String(x.escalations.n3), String(x.escalations.pmoN3), String(x.escalations.itN3), String(x.escalations.n4), String(x.escalations.vfsN4), String(x.escalations.arqN4), String(x.escalations.vswN4), "Cohorte por fecha de creación del ticket; no es la fecha del escalado. Desgloses no aditivos."]);
    }
  }
  return { filename: `ficha_${table}_${v.context.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 40)}_${query.date}.csv`, body: csvDocument(header, rows), rows: rows.length, stamp: ctx.reference.dataStamp.stamp };
}

export { BLOCK_PERIOD };
