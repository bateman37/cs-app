import { csvDocument, type CsvValue } from "@/domain/csv";
import { ECONOMIC_METHOD, type Formula } from "@/domain/finance";
import { BLOCK_PERIOD, type AnalysisQuery } from "@/domain/analytics-query";
import { VALUE_LABEL } from "@/domain/catalogs";
import type { EconomicResult, PeriodKey, PeriodSeries } from "@/server/economics/engine";
import { getPortfolioAll } from "./portfolio";
import { getFicha } from "./ficha";
import type { EntityRef } from "./operational";

/**
 * CSV de resúmenes (CSAPP-06 §11). Mismo servicio, orden, periodo y estados que la pantalla: nunca la página renderizada ni ratios recalculados.
 * Estructura documentada: UNA cabecera tabular; las columnas de contexto (fecha, corte, modo, servicio, método, revisión, referencia de datos,
 * cobertura) se repiten en cada fila para que el archivo sea utilizable con filtros de Excel. Desconocido = celda vacía + estado/motivo; cero = «0».
 * Decimales con coma y separador «;» (Excel en español); UTF-8 con BOM.
 */
export const PERIOD_NAME: Record<PeriodKey, string> = { month: "mes_seleccionado", prevMonth: "mes_anterior", cum: "cum_actual", prevYear: "anio_anterior_completo", prevCum: "cum_anterior_comparable" };

const n = (v: string | null | undefined): CsvValue => ({ n: v ?? null });
const label = (v: string) => VALUE_LABEL[v] ?? v;
const cell = (c: { values: string[]; heterogeneous: boolean }) => (c.values.length === 0 ? "sin informar" : c.heterogeneous ? `heterogéneo: ${c.values.map(label).join(" / ")}` : label(c.values[0]));

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
const periodCells = (p: PeriodSeries): CsvValue[] => [
  p.from, p.to, p.provisional ? "provisional" : "cerrado", p.validated ? "sí" : "no",
  n(p.hours.inPerimeter), n(p.revenue.value), p.revenue.status, n(p.revenue.known),
  ...f(p.perDay), ...f(p.deviationVsTarget), ...f(p.deviationVsPortfolio), ...f(p.deviationHours), n(p.targetHours.value),
  p.users.stock.value === null ? null : String(p.users.stock.value), n(p.users.averageUsers), n(p.users.userMonths), ...f(p.perUserPerYear),
];
const PERIOD_COLS = ["desde", "hasta", "estado_periodo", "validado", "horas", "ingreso_imputado_eur", "estado_ingreso", "ingreso_conocido_eur", "eur_jornada", "estado_ratio", "motivo_ratio", "desv_objetivo", "estado_desv_objetivo", "motivo_desv_objetivo", "desv_cartera", "estado_desv_cartera", "motivo_desv_cartera", "desv_horas", "estado_desv_horas", "motivo_desv_horas", "horas_objetivo", "usuarios_corte", "usuarios_medios", "usuarios_mes", "tarifa_usuario_anio", "estado_tarifa", "motivo_tarifa"];

export type CsvResult = { filename: string; body: string; rows: number };

/** Cartera COMPLETA filtrada (todas las filas, en el orden de la tabla, no solo la página) con la fila de cartera de cada periodo. */
export async function portfolioCsv(actorId: string, query: AnalysisQuery): Promise<CsvResult> {
  const v = await getPortfolioAll(actorId, query);
  const ctx = v.economics;
  const header = [...CONTEXT_HEADER, "fila", "grupo_cliente", "id", "denominacion_bc", "estado_maestro", "plan_soporte", "alojamiento", "complejidad", "producto", "cobertura_maestro", "periodo", ...PERIOD_COLS, "cobertura_cartera_grupos", "cobertura_cartera_completos", "grupos_afectados", "ingreso_sin_dedicacion_eur", "grupos_sin_dedicacion"];
  const rows: CsvValue[][] = [];
  const keys = Object.keys(PERIOD_NAME) as PeriodKey[];
  const scope = `grupos filtrados (${v.filteredGroups} de ${v.totalGroups})`;
  for (const k of keys) {
    const pf = ctx.portfolio?.[k];
    if (!pf) continue;
    const p = ctx.periodsDefinition[k];
    rows.push([
      ...contextCells(query, ctx, scope), "CARTERA", "(cartera filtrada)", "", "", "", "", "", "", "", "", PERIOD_NAME[k],
      p.from, p.to, p.provisional ? "provisional" : "cerrado", ctx.reference.validation.state === "VALIDATED" ? "sí" : "no",
      n(pf.hours), n(pf.revenue), pf.complete ? "AVAILABLE" : "PARTIAL", n(pf.revenue),
      ...f(pf.perDay), ...f(pf.deviationVsTarget), n(null), "", "", n(null), "", "", n(null), n(null), n(null), n(null), ...f(null),
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
  return { filename: `comparativa_${query.date}_${query.service.toLowerCase()}.csv`, body: csvDocument(header, rows), rows: v.allRows.length };
}

export const FICHA_TABLES = ["series", "dedicacion", "pap", "tickets"] as const;
export type FichaTable = (typeof FICHA_TABLES)[number];

export async function fichaCsv(actorId: string, query: AnalysisQuery, ref: EntityRef, table: FichaTable): Promise<CsvResult | null> {
  // Cada tabla necesita su pestaña: se fuerza para que la lectura traiga los datos de ese resumen.
  const tab = table === "dedicacion" ? "dedicacion" : table === "pap" ? "pap" : table === "tickets" ? "tickets" : "resumen";
  const v = await getFicha(actorId, { ...query, tab }, ref);
  if (!v) return null;
  const ctx = v.economics;
  const scope = `${ref.type === "group" ? "grupo" : ref.type === "client" ? "cliente" : "implantación"}: ${v.context.name}`;
  const base = (): CsvValue[] => [...contextCells(query, ctx, scope), v.context.ref.type, v.context.name, v.context.ref.id];
  const head = [...CONTEXT_HEADER, "tipo_ambito", "ambito", "id"];
  const periodDefs = ctx.periodsDefinition;
  let header: string[];
  const rows: CsvValue[][] = [];
  if (table === "series") {
    header = [...head, "serie", "periodo", ...PERIOD_COLS];
    for (const k of Object.keys(PERIOD_NAME) as PeriodKey[]) rows.push([...base(), "PERIODO", PERIOD_NAME[k], ...periodCells(v.entity.periods[k])]);
    for (const m of v.entity.monthly) rows.push([...base(), "MENSUAL_ACTUAL", m.label, ...periodCells(m)]);
    for (const m of v.entity.prevMonthly) rows.push([...base(), "MENSUAL_ANTERIOR_COMPARABLE", m.label, ...periodCells(m)]);
  } else if (table === "dedicacion") {
    header = [...head, "periodo", "perfil", "horas", "incidente_vincle_h", "otro_soporte_h", "sin_clasificar_h"];
    for (const [pk, d] of Object.entries(v.dedication ?? {})) {
      if (!(pk in periodDefs) && !/^\d{4}-\d{2}$/.test(pk)) continue;
      const pname = pk in PERIOD_NAME ? PERIOD_NAME[pk as PeriodKey] : pk;
      for (const p of d.profiles) rows.push([...base(), pname, p.profile, n(p.hours), n(p.incident), n(p.other), n(p.unclassified)]);
    }
  } else if (table === "pap") {
    header = [...head, "periodo", "pap_unicos", "correctivos", "correctivo_estandar", "correctivo_proyecto_personalizacion_config_procesos_infra", "origen_cliente", "evolutivos_sin_evidencia_de_facturacion", "sin_clasificar", "resultado_no_ok", "tabla_aditiva"];
    for (const [pk, p] of Object.entries(v.pap?.periods ?? {})) rows.push([...base(), pk in PERIOD_NAME ? PERIOD_NAME[pk as PeriodKey] : pk, String(p.total), String(p.corrective), String(p.standard), String(p.project), String(p.clientOrigin), String(p.evolutive), String(p.unclassified), String(p.nonOk), p.additive ? "sí" : "no (un PAP en varias categorías)"]);
    rows.push([...base(), "SIN_FECHA_DE_PRODUCCION", String(v.pap?.withoutProductionDate ?? 0), "", "", "", "", "", "", "", ""]);
  } else {
    header = [...head, "periodo", "tickets_creados", "incident", "problem", "otros_tipos", "escalados_n2", "escalados_n3_union", "n3_pmo", "n3_it", "n4_union", "n4_vfs", "n4_arq", "n4_vsw", "nota"];
    if (!v.tickets?.supported) rows.push([...base(), "(no disponible)", "", "", "", "", "", "", "", "", "", "", "", "", "Las implantaciones no identifican tickets: solo Grupo y Cliente."]);
    for (const [pk, t] of Object.entries(v.tickets?.periods ?? {})) {
      rows.push([...base(), PERIOD_NAME[pk as PeriodKey], String(t.total), String(t.incident), String(t.problem), String(t.other), String(t.escalations.n2), String(t.escalations.n3), String(t.escalations.pmoN3), String(t.escalations.itN3), String(t.escalations.n4), String(t.escalations.vfsN4), String(t.escalations.arqN4), String(t.escalations.vswN4), "Cohorte por fecha de creación del ticket; no es la fecha del escalado. Desgloses no aditivos."]);
    }
  }
  return { filename: `ficha_${table}_${v.context.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 40)}_${query.date}.csv`, body: csvDocument(header, rows), rows: rows.length };
}

export { BLOCK_PERIOD };
