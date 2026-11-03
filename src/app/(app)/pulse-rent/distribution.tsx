import { BandLegend, fmt } from "@/components/pulse/ui";
import { NORMALIZATION_LABEL } from "@/domain/pulse-stats";
import { METRIC_BY_ID } from "@/domain/pulse-catalog";
import type { PulseView } from "@/server/pulse/service";

/**
 * Distribución de la referencia de una columna: gráfico sencillo con P10/P25/mediana/P75/P90, N y la posición de la entidad seleccionada, y su tabla
 * equivalente accesible. El número → coordenada es SOLO para dibujar; los textos usan el decimal exacto del servidor. Con N=0 o valores iguales no
 * se dibuja una curva inventada.
 */
export function Distribution({ view }: { view: PulseView }) {
  const q = view.query;
  const m = q.col ? METRIC_BY_ID.get(q.col) : null;
  if (!m) return <p id="distribucion" className="hint">Elija «Ver distribución» en la cabecera de una columna para ver la referencia de esa métrica.</p>;
  const s = view.stats[m.id];
  const sel = q.sel ? view.rows.find((r) => r.id === q.sel) : undefined;
  const cell = sel?.cells[m.id];
  const x0 = s.min === null ? 0 : Number(s.min);
  const x1 = s.max === null ? 1 : Number(s.max);
  const W = 640;
  const pad = 30;
  const px = (v: number) => (x1 === x0 ? W / 2 : pad + ((W - 2 * pad) * (v - x0)) / (x1 - x0));
  const pts = [["P10", s.p10], ["P25", s.p25], ["Mediana", s.median], ["P75", s.p75], ["P90", s.p90]] as const;
  return (
    <section className="card" id="distribucion" aria-labelledby="dist-h">
      <h2 id="dist-h">Distribución de {m.id} · {m.label}</h2>
      <p className="muted">
        Referencia <strong>{view.reference.label}</strong> · {NORMALIZATION_LABEL[s.variant]} · unidad {s.unit} · N = <strong>{s.n}</strong> entidad(es) válidas, {s.excluded} excluida(s).
        {s.customDirection ? <> Dirección <span className="badge badge-int">personalizada</span>.</> : null}
      </p>
      {s.n === 0 ? (
        <p className="notice notice-warn">Sin referencia: ninguna entidad tiene un valor válido en esta columna. {s.excludedReasons.map((r) => `${r.reason}: ${r.count}`).join(" · ")}</p>
      ) : (
        <svg viewBox={`0 0 ${W} 110`} className="dist-svg" role="img" aria-label={`Distribución de ${m.label}: mínimo ${fmt(s.min, s.unit)}, P10 ${fmt(s.p10, s.unit)}, mediana ${fmt(s.median, s.unit)}, P75 ${fmt(s.p75, s.unit)}, P90 ${fmt(s.p90, s.unit)}, máximo ${fmt(s.max, s.unit)}. La tabla equivalente está debajo.`}>
          <line x1={pad} x2={W - pad} y1={60} y2={60} stroke="#8c8ca0" strokeWidth={1} />
          {s.p10 !== null && s.p90 !== null ? <line x1={px(Number(s.p10))} x2={px(Number(s.p90))} y1={60} y2={60} stroke="#1f18c0" strokeWidth={3} /> : null}
          {s.p25 !== null && s.p75 !== null ? <rect x={px(Number(s.p25))} y={44} width={Math.max(2, px(Number(s.p75)) - px(Number(s.p25)))} height={32} fill="#e4e3fb" stroke="#1f18c0" strokeWidth={1.5} /> : null}
          {pts.map(([label, v], i) => v === null ? null : (
            <g key={label}>
              <line x1={px(Number(v))} x2={px(Number(v))} y1={label === "Mediana" ? 40 : 48} y2={label === "Mediana" ? 80 : 72} stroke="#111114" strokeWidth={label === "Mediana" ? 3 : 1.5} />
              <text className="chart-axis" x={px(Number(v))} y={i % 2 === 0 ? 30 : 98} textAnchor="middle">{label}</text>
            </g>
          ))}
          {cell && cell.value !== null ? (
            <g>
              <polygon points={`${px(Number(cell.value))},84 ${px(Number(cell.value)) - 6},96 ${px(Number(cell.value)) + 6},96`} fill="#c2410c" />
              <text className="chart-axis" x={px(Number(cell.value))} y={108} textAnchor="middle">{sel?.name}</text>
            </g>
          ) : null}
        </svg>
      )}
      {s.warning ? <p className="hint">{s.warning}</p> : null}
      <div className="table-wrap">
        <table>
          <caption className="skip">Estadísticas de la referencia para {m.label}</caption>
          <thead><tr><th>N válidas</th><th>Excluidas</th><th>Media</th><th>P10</th><th>P25</th><th>Mediana</th><th>P75</th><th>P90</th><th>Mín.</th><th>Máx.</th></tr></thead>
          <tbody><tr>{[String(s.n), String(s.excluded), fmt(s.mean, s.unit), fmt(s.p10, s.unit), fmt(s.p25, s.unit), fmt(s.median, s.unit), fmt(s.p75, s.unit), fmt(s.p90, s.unit), fmt(s.min, s.unit), fmt(s.max, s.unit)].map((v, i) => <td key={i} className="num">{v}</td>)}</tr></tbody>
        </table>
      </div>
      {s.excludedReasons.length > 0 ? <p className="hint">Excluidas de la referencia: {s.excludedReasons.map((r) => `${r.reason} (${r.count})`).join(" · ")}. Una entidad con cero confirmado participa; un valor ausente no.</p> : null}
      <BandLegend direction={s.direction} />
      {cell ? <p>Posición de <strong>{sel?.name}</strong>: {fmt(cell.value, cell.unit)} {cell.unit}.</p> : null}
    </section>
  );
}
