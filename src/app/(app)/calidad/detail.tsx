import type { ReactNode } from "react";
import Link from "next/link";
import { ActionForm, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form-kit";
import { DIAGNOSIS_FAMILIES, DIAGNOSIS_LABEL, INDICATOR_KEYS, INDICATOR_NAME } from "@/domain/quality-config";
import { KPI_ACCESS_NAME, rateUnit } from "@/domain/quality-kpi";
import { qualityToParams, type QualityQuery } from "@/domain/quality-query";
import { HEALTH_DB_LABEL, type HealthDbState } from "@/domain/quality-health";
import { qs } from "@/lib/format";
import { MONTH_SHORT } from "@/domain/usuarios";
import { LineChart, Legend, color } from "@/components/analytics/charts";
import { fdate } from "@/components/analytics/ui";
import type { QualityRow, QualityView } from "@/server/quality/engine";
import type { Evolution } from "@/server/quality/detail";
import type { QualityNoteView } from "@/server/quality/notes";
import { addNoteAction } from "./actions";
import { NeutralTag, STATUS_TEXT, StateTag, cellInfo, num, reasonOf } from "./ui";
import { CalcBlock } from "./apartados";
import { kpiHref } from "./table";

const pct = (v: string | null | undefined) => (v === null || v === undefined ? "—" : `${num(v, 2)} %`);

/** Ficha de un Grupo o Cliente (resultado global): seis indicadores con enlace a su detalle, pesos, evolución y notas. Lo técnico va en «Ver cálculo». */
export function EntityDetail({ r, view, q, basePath, evolutionSlot, notes, isAdmin, milestones }: { r: QualityRow; view: QualityView; q: QualityQuery; basePath: string; evolutionSlot: ReactNode; notes: QualityNoteView[]; isAdmin: boolean; milestones: { date: string; type: string; note: string | null; where: string }[] }) {
  const w = r.evaluation.weights;
  const g = r.evaluation.global;
  return (
    <>
      <section className="ql-panel" aria-labelledby="d-title">
        <h2 id="d-title">{r.name} <small className="ql-muted">{q.scope === "group" ? "Grupo Cliente" : "Cliente"}{r.parent ? ` · ${r.parent}` : ""}</small></h2>
        <p className="ql-links" style={{ margin: "0 0 0.4rem" }}>
          <Link href={`/analisis-cliente${qs({ ambito: q.scope, id: r.id, fecha: q.base.date, modo: q.base.mode, volver: "calidad" })}`}>Análisis Cliente</Link>
          <a href={`/api/analitica/calidad.csv${qs({ ...kpiParams(q), tabla: "ficha" })}`}>CSV de la ficha</a>
        </p>
        <p>
          Resultado global del mes: {g.color ? <StateTag color={g.color} /> : <NeutralTag>{g.status === "SIN_METODO" ? "Sin método del global" : "Parcial"}</NeutralTag>} {g.partialAlerts.length ? <StateTag color="red" text="Alerta roja parcial" /> : null}{" "}
          {g.score ? <>índice {num(g.score, 2)} <small className="ql-muted">(no es una probabilidad de fallo)</small></> : null} <small className="ql-muted">{g.reason}</small>
        </p>
        <div className="ql-wrap" tabIndex={0} role="region" aria-label="Seis indicadores del mes (desplazable)">
          <table className="ql-table">
            <caption className="visually-hidden">Seis indicadores del mes con su peso</caption>
            <thead><tr><th scope="col">Indicador</th><th scope="col" className="ql-r">Valor</th><th scope="col">Estado</th><th scope="col" className="ql-r">Peso configurado</th><th scope="col" className="ql-r">Peso asignado</th><th scope="col">Detalle</th></tr></thead>
            <tbody>
              {INDICATOR_KEYS.map((k) => {
                const i = r.evaluation.indicators[k];
                const c = cellInfo(i, r.explain[k].observed);
                const uncovered = w?.uncovered.some((u) => u.key === k);
                return (
                  <tr key={k}>
                    <th scope="row">{KPI_ACCESS_NAME[k]}</th>
                    <td className="ql-r">{c.main === null ? <span className="ql-muted">—</span> : <><strong>{c.kind === "PARTIAL" ? "≥ " : ""}{k === "HEALTH" ? c.main : num(c.main)}</strong> <span className="ql-u">{rateUnit(k, i.unit)}</span></>}</td>
                    <td>{c.color ? <StateTag color={c.color} /> : <NeutralTag partial={c.kind === "PARTIAL"} title={reasonOf(i)}>{c.label || "Sin dato"}</NeutralTag>}</td>
                    <td className="ql-r">{w ? pct(w.configuredPercent[k]) : "—"}</td>
                    <td className="ql-r">{w ? <>{pct(w.percent[k])}{w.percent[k] === "0" && w.configuredPercent[k] !== "0" ? <small> (redistribuido)</small> : uncovered ? <small> (sin cubrir)</small> : null}</> : "—"}</td>
                    <td><Link href={kpiHref(q, basePath, k, r.id)} prefetch={false}>Abrir {KPI_ACCESS_NAME[k]}</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {w ? <p className="ql-note">Sin Client Health informado el resto pesa 20 %; un indicador técnico sin datos conserva su peso. Cobertura calculable: {pct(w.coveragePercent)} de la asignación. {w.reasons.length ? w.reasons.join(" ") : ""}</p> : <p className="ql-err">Los pesos configurados no son válidos: revise Administración › Configuración › Calidad.</p>}
        <CalcBlock k="HEALTH" row={null} view={view} />
        {evolutionSlot}
        {milestones.length ? <p className="ql-note">Hitos del año (anotados; no se excluyen eventos automáticamente): {milestones.map((m) => `${fdate(m.date)} · ${m.type}${m.note ? ` (${m.note})` : ""} · ${m.where}`).join(" — ")}.</p> : null}
      </section>
      <section className="ql-panel" aria-label="Notas de revisión">
        <h2>Notas de revisión de calidad</h2>
        {notes.length === 0 ? <p className="ql-note">Sin notas.</p> : <ul>{notes.map((n) => <li key={n.id}><strong>{DIAGNOSIS_LABEL[n.topic as keyof typeof DIAGNOSIS_LABEL] ?? INDICATOR_NAME[n.topic as keyof typeof INDICATOR_NAME] ?? n.topic}</strong> · {n.month}/{n.year}{n.evidence ? ` · evidencia: ${n.evidence}` : ""} — {n.text} <small>({n.author}, {fdate(n.createdAt.slice(0, 10))})</small></li>)}</ul>}
        {isAdmin ? (
          <ActionForm action={addNoteAction} hidden={{ scope: q.scope, entityId: r.id, year: q.base.date.slice(0, 4), month: Number(q.base.date.slice(5, 7)) }}>
            <SelectField name="topic" label="Tema" initial="CONFIGURACION" options={[...DIAGNOSIS_FAMILIES.map((f) => ({ value: f, label: DIAGNOSIS_LABEL[f] })), ...INDICATOR_KEYS.map((k) => ({ value: k, label: INDICATOR_NAME[k] }))]} />
            <TextField name="evidence" label="Evidencia (IDs de ticket, PAP…)" />
            <TextAreaField name="text" label="Nota de revisión" help="Una hipótesis de QA confirmada o descartada; no crea tareas ni planes de pruebas." />
            <div className="form-actions"><SubmitButton>Añadir nota</SubmitButton></div>
          </ActionForm>
        ) : null}
      </section>
    </>
  );
}

const kpiParams = (q: QualityQuery) => qualityToParams(q);

/** Cabecera de un indicador para UN objeto: valor, estado, motivo, y sus datos básicos (el resto del apartado lo aporta el cuerpo del indicador). */
export function EntityKpiHead({ r, k }: { r: QualityRow; k: (typeof INDICATOR_KEYS)[number] }) {
  const i = r.evaluation.indicators[k];
  const c = cellInfo(i, r.explain[k].observed);
  const e = r.explain[k];
  return (
    <section className="ql-panel" aria-label={`${KPI_ACCESS_NAME[k]} de ${r.name}`}>
      <h2>{r.name} · {KPI_ACCESS_NAME[k]} <small className="ql-muted">{r.parent ? `${r.parent} · ` : ""}{r.scope === "group" ? "Grupo Cliente" : "Cliente"}</small></h2>
      <p>
        {c.main === null ? <strong>—</strong> : <strong style={{ fontSize: "1.15em" }}>{c.kind === "PARTIAL" ? "≥ " : ""}{k === "HEALTH" ? c.main : num(c.main)}</strong>} <span className="ql-u">{rateUnit(k, i.unit)}</span>{" "}
        {c.color ? <StateTag color={c.color} /> : i.alert && i.value !== null ? <StateTag color="red" text="Alerta parcial" /> : <NeutralTag partial={c.kind === "PARTIAL"}>{c.label || "Sin dato"}</NeutralTag>}
        {k !== "HEALTH" && e.observed !== null ? <> <span className="ql-obs">Observado: {num(e.observed, 1)}</span></> : null}
      </p>
      {c.color === null ? <p className="ql-note">{reasonOf(i)}</p> : null}
      {r.users.stock === null ? <p className="ql-note">Usuarios del mes sin informar en la matriz: no se calculan tasas; los conteos se conservan.</p> : null}
      {k === "HEALTH" ? (
        <p className="ql-note">{r.health.state && r.health.state !== "NONE" ? <>{HEALTH_DB_LABEL[r.health.state as HealthDbState]}{r.health.comment ? <> — «{r.health.comment}»</> : null} <small>(versión {r.health.version}; {r.health.use?.note})</small></> : "Sin feedback en el mes (celda en blanco)."}</p>
      ) : null}
    </section>
  );
}

/** Evolución mensual de la ficha (valor, color o motivo por mes; recalculada con la revisión indicada). */
export function Evo({ e }: { e: Evolution }) {
  const rows = e.points;
  const COLOR_TEXT: Record<string, string> = { green: "verde", yellow: "amarillo", red: "rojo" };
  const numOf = (p: Evolution["points"][number], k: (typeof INDICATOR_KEYS)[number]): number | null => {
    const v = p.indicators[k].numerator;
    return v === null || Number.isNaN(Number(v)) ? null : Number(v);
  };
  const pts = (k: (typeof INDICATOR_KEYS)[number], label: string, unit: string) => rows.map((p) => ({ x: p.month, y: numOf(p, k), tip: `${MONTH_SHORT[p.month - 1]} ${e.year}: ${numOf(p, k) ?? "sin dato"} ${unit} (${label})` }));
  const lines = [
    { name: "Incidentes y problemas (altas)", color: color(0), marker: "circle" as const, points: pts("INCIDENTS_PROBLEMS", "altas por creación", "tickets") },
    { name: "Escalados a N3", color: color(1), marker: "square" as const, points: pts("N3_ESCALATIONS", "tickets únicos", "tickets") },
    { name: "PAP correctivos", color: color(2), marker: "circle" as const, points: pts("PAP_CORRECTIVE", "PAP únicos", "PAP") },
    { name: "Problemas con bug o estándar", color: color(3), marker: "square" as const, points: pts("BUGS_STANDARD", "problemas únicos", "problemas") },
  ];
  return (
    <details className="ql-calc" open>
      <summary>Evolución mensual {e.year}</summary>
      <div className="ql-cols">
        <div className="ql-chart">
          <Legend items={lines.map((l) => ({ label: l.name, color: l.color, marker: l.marker }))} />
          <LineChart title="Numeradores mensuales (conteos, no tasas)" unit="conteos por mes" lines={lines} />
        </div>
        <div className="ql-wrap" tabIndex={0} role="region" aria-label="Evolución mensual (desplazable)">
          <table className="ql-table">
            <caption className="visually-hidden">Evolución mensual de {e.year}: estado de cada indicador y global</caption>
            <thead><tr><th scope="col">Mes</th><th scope="col" className="ql-r">Usuarios</th>{INDICATOR_KEYS.map((k) => <th key={k} scope="col">{KPI_ACCESS_NAME[k]}</th>)}<th scope="col">Global</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.month}>
                  <th scope="row">{MONTH_SHORT[p.month - 1]}{p.period.provisional ? " (prov.)" : ""}</th>
                  <td className="ql-r">{p.users.stock ?? "—"}</td>
                  {INDICATOR_KEYS.map((k) => {
                    const i = p.indicators[k];
                    return <td key={k} title={i.reason}>{i.value !== null ? num(i.value, 2) : "—"} · {i.color ? COLOR_TEXT[i.color] : (STATUS_TEXT[i.status] ?? i.status)}</td>;
                  })}
                  <td>{p.global.color ? COLOR_TEXT[p.global.color] : "sin global"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="ql-note">Serie recalculada con la revisión de Calidad {e.series.qualityRevision}{e.series.qualityPersisted ? "" : " (inicial)"} y la de Pulse {e.series.pulseRevision}; no es el color publicado históricamente. CUM al {fdate(e.cum.cut)}: {Object.entries(e.cum.current).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"} · mismo corte del año anterior ({fdate(e.cum.previousCut)}): {Object.entries(e.cum.previousComparable).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"}.</p>
    </details>
  );
}
