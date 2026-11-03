"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * Componentes interactivos mínimos de la ficha (HOTFIX-02 §8): cifra no disponible con explicación al clic/foco y gráficos SVG propios con tooltip
 * (sin dependencias). Los textos de tooltip, etiquetas y tabla equivalente los prepara el servidor desde el MISMO conjunto de filas
 * (`domain/ficha-series`): aquí los números solo sirven de coordenadas, nunca se calculan ni se formatean cifras de negocio.
 */

// ---------------------------------------------------------------- Cifra no disponible

export function Na({ reason, align = "right" }: { reason: string | null | undefined; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const text = reason && reason.trim() ? reason : "Sin dato disponible para este periodo.";
  return (
    <span className="fc-na-wrap">
      <button
        type="button"
        className="fc-na"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
      >
        —<span className="fc-sr"> (no disponible: pulse para ver el motivo)</span>
      </button>
      {open ? <span role="status" id={id} className={`fc-na-pop${align === "left" ? " fc-left" : ""}`}>{text}</span> : null}
    </span>
  );
}

// ---------------------------------------------------------------- Gráfico de barras y líneas

export type Tip = { title: string; rows: [string, string][]; note?: string };
export type ChartSpec = {
  ariaLabel: string;
  cats: string[];
  bars: { name: string; color: string; values: (number | null)[]; /** Etiquetas ya formateadas por el servidor (opcionales, sobre la barra). */ labels?: (string | null)[]; /** Barra hueca = mes parcial o provisional. */ hollow?: boolean[] }[];
  lines: { name: string; color: string; values: (number | null)[]; dash?: string }[];
  ref?: { value: number; label: string };
  marks?: { at: number; label: string }[];
  tips: (Tip | null)[];
  height: number;
  /** Decimales de los rótulos del eje (solo escala). */
  axisDigits: number;
  emptyText: string;
};

const nf = (d: number) => new Intl.NumberFormat("es-ES", { maximumFractionDigits: d, minimumFractionDigits: 0 });

function niceScale(min: number, max: number, count = 4): { lo: number; hi: number; ticks: number[] } {
  if (!(max > min)) { max = min + 1; }
  const raw = (max - min) / count;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const frac = raw / pow;
  const step = (frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10) * pow;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return { lo, hi, ticks };
}

export function BarsChart({ spec }: { spec: ChartSpec }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(440);
  const [active, setActive] = useState<number | null>(null);
  const live = useId();
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const set = () => setW(Math.max(220, Math.floor(el.clientWidth)));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = spec.cats.length;
  const all = [...spec.bars.flatMap((b) => b.values), ...spec.lines.flatMap((l) => l.values)].filter((v): v is number => v !== null && Number.isFinite(v));
  const empty = all.length === 0;
  const H = spec.height;
  const padL = 42, padR = 8, padT = 16, padB = 18;
  const pw = Math.max(40, w - padL - padR);
  const ph = H - padT - padB;
  const lo0 = Math.min(0, ...all, spec.ref ? spec.ref.value : 0);
  const hi0 = Math.max(0, ...all, spec.ref ? spec.ref.value : 0);
  const sc = niceScale(lo0, hi0 * 1.08 + (hi0 === 0 ? 1 : 0));
  const y = (v: number) => padT + ph - ((v - sc.lo) / (sc.hi - sc.lo)) * ph;
  const band = pw / n;
  const grp = Math.min(band * 0.78, 34 * spec.bars.length);
  const bw = spec.bars.length ? grp / spec.bars.length : 0;
  const cx = (i: number) => padL + band * i + band / 2;
  const showEvery = band < 22 ? 2 : 1;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") { e.preventDefault(); setActive((a) => Math.min(n - 1, (a ?? -1) + 1)); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setActive((a) => Math.max(0, (a ?? n) - 1)); }
    else if (e.key === "Escape") setActive(null);
  };
  const tip = active !== null ? spec.tips[active] : null;
  const tipRight = active !== null && cx(active) > w / 2;

  return (
    <div className="fc-chart" ref={box} tabIndex={0} role="group" aria-label={`${spec.ariaLabel}. Use las flechas para recorrer los datos; la tabla equivalente está disponible con el botón Tabla.`} onKeyDown={onKey} onBlur={() => setActive(null)} style={{ height: H }}>
      {empty ? (
        <div className="fc-empty" style={{ height: H }}>{spec.emptyText}</div>
      ) : (
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} aria-hidden="true" focusable="false">
          <g className="fc-axis">
            {sc.ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={padL + pw} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#9a9aa8" : "#ececf2"} strokeWidth={1} />
                <text x={padL - 4} y={y(t) + 3} textAnchor="end">{nf(spec.axisDigits).format(t)}</text>
              </g>
            ))}
          </g>
          {spec.cats.map((c, i) => (i % showEvery === 0 ? <text key={c + i} x={cx(i)} y={H - 5} textAnchor="middle" className="fc-axis">{c}</text> : null))}
          {(spec.marks ?? []).map((m, i) => (
            <g key={i}>
              <line x1={padL + band * m.at} x2={padL + band * m.at} y1={padT} y2={padT + ph} stroke="#7c3aed" strokeDasharray="2 3" strokeWidth={1} />
              <title>{m.label}</title>
            </g>
          ))}
          {spec.bars.map((b, bi) =>
            b.values.map((v, i) => {
              if (v === null || !Number.isFinite(v)) return null;
              const x = cx(i) - grp / 2 + bi * bw + 0.5;
              const yy = y(Math.max(v, 0));
              const hh = Math.max(1, Math.abs(y(v) - y(0)));
              const hollow = b.hollow?.[i];
              return (
                <g key={`${bi}-${i}`}>
                  <rect x={x} y={v >= 0 ? yy : y(0)} width={Math.max(2, bw - 1)} height={hh} fill={hollow ? "#fff" : b.color} stroke={b.color} strokeWidth={hollow ? 1.5 : 0} strokeDasharray={hollow ? "3 2" : undefined} />
                  {b.labels?.[i] ? <text x={x + (bw - 1) / 2} y={(v >= 0 ? yy : y(0)) - 2} textAnchor="middle" style={{ fontSize: 9.5 }}>{b.labels[i]}</text> : null}
                </g>
              );
            }),
          )}
          {spec.lines.map((l, li) => {
            const segs: string[] = [];
            let cur: string[] = [];
            l.values.forEach((v, i) => {
              if (v === null || !Number.isFinite(v)) { if (cur.length) segs.push(cur.join(" ")); cur = []; } else cur.push(`${cx(i)},${y(v)}`);
            });
            if (cur.length) segs.push(cur.join(" "));
            return (
              <g key={li}>
                {segs.map((s, si) => (s.includes(" ") ? <polyline key={si} points={s} fill="none" stroke={l.color} strokeWidth={1.8} strokeDasharray={l.dash} strokeLinejoin="round" /> : null))}
                {l.values.map((v, i) => (v === null || !Number.isFinite(v) ? null : <circle key={i} cx={cx(i)} cy={y(v)} r={2.4} fill="#fff" stroke={l.color} strokeWidth={1.5} />))}
              </g>
            );
          })}
          {spec.ref ? (
            <g>
              <line x1={padL} x2={padL + pw} y1={y(spec.ref.value)} y2={y(spec.ref.value)} stroke="#b45309" strokeWidth={1.6} strokeDasharray="6 3" />
              <text x={padL + pw} y={y(spec.ref.value) - 3} textAnchor="end" style={{ fill: "#b45309", fontWeight: 600 }}>{spec.ref.label}</text>
            </g>
          ) : null}
          {spec.cats.map((c, i) => (
            <rect
              key={`b${i}`}
              className="fc-band"
              x={padL + band * i}
              y={padT}
              width={band}
              height={ph}
              onMouseEnter={() => setActive(i)}
              onMouseMove={() => setActive(i)}
              onMouseLeave={() => setActive((a) => (a === i ? null : a))}
              onClick={() => setActive(i)}
            />
          ))}
        </svg>
      )}
      {tip ? (
        <div className="fc-tip" role="status" id={live} style={{ top: 2, ...(tipRight ? { right: w - cx(active as number) + 8 } : { left: cx(active as number) + 8 }) }}>
          <b>{tip.title}</b>
          {tip.rows.map(([k, v], i) => <div key={i}><span>{k}</span><span>{v}</span></div>)}
          {tip.note ? <small>{tip.note}</small> : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Tarjeta con alternancia gráfico / tabla equivalente (misma altura)

export type LegendItem = { label: string; color: string; kind?: "bar" | "line" | "dash"; hollow?: boolean };

export function ChartCard({ title, unit, legend, spec, table, detailHref }: { title: string; unit: string; legend: LegendItem[]; spec: ChartSpec; table: ReactNode; detailHref?: string }) {
  const [view, setView] = useState<"g" | "t">("g");
  return (
    <section className="fc-card" aria-label={title}>
      <div className="fc-card-h">
        <h2>{title} <span className="fc-unit">({unit})</span></h2>
        {detailHref ? <a className="fc-btn" style={{ padding: "0 7px", fontSize: 10.5 }} href={detailHref}>Detalle</a> : null}
        <div className="fc-toggle" role="group" aria-label={`Vista de ${title}`}>
          <button type="button" aria-pressed={view === "g"} onClick={() => setView("g")}>Gráfico</button>
          <button type="button" aria-pressed={view === "t"} onClick={() => setView("t")}>Tabla</button>
        </div>
      </div>
      <div className="fc-legend" aria-hidden="true">
        {legend.map((l) => (
          <span key={l.label}><i className={l.kind === "line" ? "fc-ln" : l.kind === "dash" ? "fc-ln fc-dash" : undefined} style={l.kind === "line" || l.kind === "dash" ? { borderColor: l.color } : { background: l.hollow ? "#fff" : l.color, border: l.hollow ? `1.5px dashed ${l.color}` : undefined }} />{l.label}</span>
        ))}
      </div>
      <div className="fc-card-b">
        <div hidden={view !== "g"}><BarsChart spec={spec} /></div>
        <div className="fc-eq" hidden={view !== "t"} style={{ height: spec.height, overflow: "auto" }}>{table}</div>
      </div>
    </section>
  );
}
