import Link from "next/link";
import { ActionForm, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form-kit";
import { DIAGNOSIS_FAMILIES, DIAGNOSIS_LABEL, INDICATOR_KEYS, INDICATOR_NAME, UNIT_LABEL, type QualityConfig } from "@/domain/quality-config";
import { qualityToParams, type QualityQuery } from "@/domain/quality-query";
import { HEALTH_DB_LABEL, type HealthDbState } from "@/domain/quality-health";
import { qs } from "@/lib/format";
import { MONTH_SHORT } from "@/domain/usuarios";
import { LineChart, Legend, color } from "@/components/analytics/charts";
import { fdate } from "@/components/analytics/ui";
import type { QualityRow } from "@/server/quality/engine";
import type { Evolution } from "@/server/quality/detail";
import type { QualityNoteView } from "@/server/quality/notes";
import { addNoteAction } from "./actions";
import { ColorBadge, KpiCell, STATUS_TEXT, num } from "./ui";

const pct = (v: string | null | undefined) => (v === null || v === undefined ? "—" : `${num(v, 2)} %`);

export function EntityDetail({ r, q, cfg, basePath, evolution, notes, isAdmin, milestones }: { r: QualityRow; q: QualityQuery; cfg: QualityConfig; basePath: string; evolution: Evolution | null; notes: QualityNoteView[]; isAdmin: boolean; milestones: { date: string; type: string; note: string | null; where: string }[] }) {
  const w = r.evaluation.weights;
  const g = r.evaluation.global;
  const href = (extra: Partial<QualityQuery>) => `${basePath}${qs(qualityToParams({ ...q, ...extra }))}`;
  return (
    <section className="card" aria-labelledby="d-title">
      <h2 id="d-title">{r.name} <small className="muted">{q.scope === "group" ? "Grupo Cliente" : "Cliente"}</small></h2>
      <p className="quick">
        <Link href={href({ sel: "" })}>← Volver a la cartera</Link> · <Link href={href({ view: "diagnostico" })}>Diagnóstico de esta entidad</Link> · <Link href={href({ view: "backlog" })}>Backlog por antigüedad</Link> ·{" "}
        <Link href={`/analisis-cliente${qs({ ambito: q.scope, id: r.id, fecha: q.base.date, modo: q.base.mode, volver: "calidad" })}`}>Análisis Cliente</Link> · <a href={`/api/analitica/calidad.csv${qs({ ...qualityToParams(q), tabla: "ficha" })}`}>CSV de la ficha</a>
      </p>

      <h3>Resultado global del mes</h3>
      <p>
        {g.color ? <ColorBadge color={g.color} /> : <span className="badge badge-off">{g.status === "SIN_METODO" ? "Sin calibrar" : "Incompleto"}</span>} {g.partialAlerts.length ? <ColorBadge color={null} alert /> : null}{" "}
        {g.score ? <>índice configurado {num(g.score, 2)} (no es una probabilidad de fallo)</> : null} — {g.reason}
      </p>
      {w ? (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Pesos y contribución (desplazable)">
          <table>
            <caption className="visually-hidden">Pesos configurados y efectivos, valores y contribución</caption>
            <thead><tr><th scope="col">Indicador</th><th scope="col">Peso configurado</th><th scope="col">Peso asignado</th><th scope="col">Valor</th><th scope="col">Estado</th></tr></thead>
            <tbody>
              {INDICATOR_KEYS.map((k) => {
                const i = r.evaluation.indicators[k];
                const cov = w.uncovered.some((u) => u.key === k);
                return (
                  <tr key={k}>
                    <th scope="row">{INDICATOR_NAME[k]}</th>
                    <td>{pct(w.configuredPercent[k])}</td>
                    <td>{pct(w.percent[k])}{w.percent[k] === "0" && w.configuredPercent[k] !== "0" ? <small> (redistribuido)</small> : null}</td>
                    <td><KpiCell i={i} /></td>
                    <td>{cov ? <span className="badge badge-warn">sin cubrir</span> : w.percent[k] === "0" ? <span className="badge badge-off">no influye</span> : <span className="badge badge-ok">cubierto</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="notice notice-warn">Los pesos configurados no son válidos: revise Administración › Configuración › Calidad.</p>}
      {w ? <p className="hint">Asignación efectiva (con Client Health en blanco se redistribuye solo su peso), contribución disponible y <strong>cobertura calculable: {pct(w.coveragePercent)}</strong> de la asignación. {w.reasons.length ? `Pendiente: ${w.reasons.join(" ")}` : ""}</p> : null}

      <h3>Seis indicadores explicados</h3>
      {INDICATOR_KEYS.map((k) => {
        const i = r.evaluation.indicators[k];
        const e = r.explain[k];
        return (
          <details key={k} open={q.det === k} className="kpi-detail">
            <summary><strong>{INDICATOR_NAME[k]}</strong> — <KpiCell i={i} /></summary>
            <dl className="kv">
              <dt>Fórmula</dt><dd>{e.formula}</dd>
              <dt>Numerador / denominador</dt><dd>{e.numerator ?? "—"} / {e.denominator ?? "—"} <small>({UNIT_LABEL[i.unit]})</small></dd>
              <dt>Periodo</dt><dd>{e.period} ({q.base.mode === "FULL_MONTH" ? "mes completo" : "corte diario"})</dd>
              <dt>Estado</dt><dd>{STATUS_TEXT[i.status] ?? i.status} — {i.reason}{i.cuts ? <> · cortes a={i.cuts.a}, b={i.cuts.b}{i.n !== undefined ? `, N=${i.n}` : ""}</> : null}</dd>
              <dt>Fuentes y cobertura</dt><dd>{e.sources.join(", ") || "—"}{e.coverage.map((c) => <div key={c.source}><span className={`badge ${c.state === "COMPLETE" ? "badge-ok" : "badge-warn"}`}>{c.source}: {c.state === "COMPLETE" ? "cobertura declarada" : c.state === "UNKNOWN" ? "sin declaración" : "parcial"}</span> <small>{c.reason}</small></div>)}</dd>
              {Object.keys(e.breakdown).length ? <><dt>Desglose</dt><dd><ul>{Object.entries(e.breakdown).map(([bk, bv]) => <li key={bk}>{bk}: <strong>{bv}</strong></li>)}</ul></dd></> : null}
              {i.components ? <><dt>Componentes</dt><dd><ul>{i.components.map((c) => <li key={c.id}>{c.label}: {c.value ?? "—"} <small>({UNIT_LABEL[c.unit]})</small> → {c.color ? <ColorBadge color={c.color} /> : STATUS_TEXT[c.status] ?? c.status}{c.cuts ? <small> (a={c.cuts.a}, b={c.cuts.b})</small> : null} <small>{c.reason}</small></li>)}</ul></dd></> : null}
              {e.notes.length ? <><dt>Avisos</dt><dd><ul>{e.notes.map((n) => <li key={n}>{n}</li>)}</ul></dd></> : null}
              <dt>Revisión de reglas</dt><dd>Calidad {q.qrev ?? "activa"}; regla del ámbito {q.scope === "group" ? "Grupo" : "Cliente"}.</dd>
            </dl>
          </details>
        );
      })}

      <h3>Client Health del mes</h3>
      <p>{r.health.state && r.health.state !== "NONE" ? <>{HEALTH_DB_LABEL[r.health.state as HealthDbState]}{r.health.comment ? <> — «{r.health.comment}»</> : null} <small>(versión {r.health.version}; {r.health.use?.note})</small></> : <span className="badge badge-off">Sin feedback (en blanco)</span>}</p>

      <h3>Evolución mensual</h3>
      {evolution ? <Evo e={evolution} /> : <p className="muted">Sin datos de evolución.</p>}
      {milestones.length ? <p className="hint">Hitos del año (anotados; no se excluyen eventos automáticamente): {milestones.map((m) => `${fdate(m.date)} · ${m.type}${m.note ? ` (${m.note})` : ""} · ${m.where}`).join(" — ")}.</p> : null}

      <h3>Notas de revisión de calidad</h3>
      {notes.length === 0 ? <p className="muted">Sin notas.</p> : <ul>{notes.map((n) => <li key={n.id}><strong>{DIAGNOSIS_LABEL[n.topic as keyof typeof DIAGNOSIS_LABEL] ?? INDICATOR_NAME[n.topic as keyof typeof INDICATOR_NAME] ?? n.topic}</strong> · {n.month}/{n.year}{n.evidence ? ` · evidencia: ${n.evidence}` : ""} — {n.text} <small>({n.author}, {fdate(n.createdAt.slice(0, 10))})</small></li>)}</ul>}
      {isAdmin ? (
        <ActionForm action={addNoteAction} hidden={{ scope: q.scope, entityId: r.id, year: q.base.date.slice(0, 4), month: Number(q.base.date.slice(5, 7)) }}>
          <SelectField name="topic" label="Tema" initial="CONFIGURACION" options={[...DIAGNOSIS_FAMILIES.map((f) => ({ value: f, label: DIAGNOSIS_LABEL[f] })), ...INDICATOR_KEYS.map((k) => ({ value: k, label: INDICATOR_NAME[k] }))]} />
          <TextField name="evidence" label="Evidencia (IDs de ticket, PAP…)" />
          <TextAreaField name="text" label="Nota de revisión" help="Una hipótesis de QA confirmada o descartada; no crea tareas ni planes de pruebas." />
          <div className="form-actions"><SubmitButton>Añadir nota</SubmitButton></div>
        </ActionForm>
      ) : null}
      <p className="hint">Mapeo de Client Health {cfg.health.confirmed ? "confirmado" : "sin confirmar"} · plantilla del global {cfg.global.enabled ? "activada" : "sin elegir"}.</p>
    </section>
  );
}

function Evo({ e }: { e: Evolution }) {
  const rows = e.points;
  const COLOR_TEXT: Record<string, string> = { green: "verde", yellow: "amarillo", red: "rojo" };
  const numOf = (p: Evolution["points"][number], k: (typeof INDICATOR_KEYS)[number]): number | null => {
    const v = p.indicators[k].numerator;
    return v === null || Number.isNaN(Number(v)) ? null : Number(v);
  };
  const pts = (k: (typeof INDICATOR_KEYS)[number], label: string, unit: string) => rows.map((p) => ({ x: p.month - 1, y: numOf(p, k), tip: `${MONTH_SHORT[p.month - 1]} ${e.year}: ${numOf(p, k) ?? "sin dato"} ${unit} (${label})` }));
  const lines = [
    { name: "Incidentes y problemas (altas)", color: color(0), marker: "circle" as const, points: pts("INCIDENTS_PROBLEMS", "altas por creación", "tickets") },
    { name: "Escalados N3", color: color(1), marker: "square" as const, points: pts("N3_ESCALATIONS", "tickets únicos", "tickets") },
    { name: "PAP correctivos", color: color(2), marker: "circle" as const, points: pts("PAP_CORRECTIVE", "PAP únicos", "PAP") },
    { name: "Bugs/estándar", color: color(3), marker: "square" as const, points: pts("BUGS_STANDARD", "problemas únicos", "problemas") },
  ];
  return (
    <>
      <p className="hint" role="note">
        Serie <strong>recalculada</strong> con la revisión de Calidad {e.series.qualityRevision}{e.series.qualityPersisted ? "" : " (inicial)"}{e.series.simulated ? " (borrador: simulación, no publicado)" : ""} y de Pulse {e.series.pulseRevision}; referencia de serie <code>{e.series.reference}</code>. No es el color publicado históricamente.
      </p>
      <Legend items={lines.map((l) => ({ label: l.name, color: l.color, marker: l.marker }))} />
      <LineChart title="Numeradores mensuales de los indicadores (conteos, no tasas)" unit="conteos por mes" lines={lines} />
      <details open>
        <summary>Tabla equivalente: seis indicadores, global y estado de cada mes</summary>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Evolución mensual (desplazable)">
          <table>
            <caption className="visually-hidden">Evolución mensual de {e.year}: valor, color o motivo, muestra de referencia y backlog observado</caption>
            <thead><tr><th scope="col">Mes</th><th scope="col">Usuarios (corte / mes)</th>{INDICATOR_KEYS.map((k) => <th key={k} scope="col">{INDICATOR_NAME[k]}</th>)}<th scope="col">Global</th><th scope="col">Backlog observado</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.month}>
                  <th scope="row">{MONTH_SHORT[p.month - 1]}{p.period.provisional ? " (provisional)" : ""}</th>
                  <td>{p.users.stock ?? "sin informar"} / {p.users.userMonths ?? "—"}</td>
                  {INDICATOR_KEYS.map((k) => {
                    const i = p.indicators[k];
                    return (
                      <td key={k}>
                        {i.value !== null ? `${num(i.value, 2)} ${i.unit}` : "sin valor"} · {i.color ? COLOR_TEXT[i.color] : (STATUS_TEXT[i.status] ?? i.status)}
                        {i.sampleN !== null ? ` · muestra ${i.sampleN}` : ""}
                        {i.numerator !== null || i.denominator !== null ? <span className="muted"> (num. {i.numerator ?? "—"} / den. {i.denominator ?? "—"})</span> : null}
                        {i.value === null && i.reason ? <span className="muted"> {i.reason}</span> : null}
                      </td>
                    );
                  })}
                  <td>{p.global.color ? COLOR_TEXT[p.global.color] : `sin global: ${p.global.reason}`}</td>
                  <td>{p.backlog.observedOn ? `${p.backlog.exact ? "exacta" : "provisional"} ${fdate(p.backlog.observedOn)}` : <span className="muted">hueco: {p.backlog.note}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="hint">{e.note} CUM al {fdate(e.cum.cut)}: {Object.entries(e.cum.current).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"} · mismo corte del año anterior ({fdate(e.cum.previousCut)}): {Object.entries(e.cum.previousComparable).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"}.</p>
    </>
  );
}
