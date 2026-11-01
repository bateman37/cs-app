import type { ReactNode } from "react";

/**
 * Gráficos SVG de servidor (CSAPP-06 §7): reciben agregados mensuales ya calculados. El número → coordenada es SOLO para dibujar; los tooltips
 * (<title>), tablas equivalentes y exportaciones usan el texto decimal exacto del servidor. Los ratios ausentes interrumpen la línea (sin
 * interpolar) y el color nunca es la única señal: hay marcadores, trazos y etiquetas textuales.
 */
export type Pt = { x: number; y: number | null; tip: string; hollow?: boolean };
export type Line = { name: string; color: string; dash?: string; marker: "circle" | "square"; points: Pt[] };
export type Mark = { x: number; label: string };

const W = 640;
const H = 280;
const M = { l: 58, r: 14, t: 14, b: 38 };
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const PALETTE = ["#1f18c0", "#7a73ea", "#dbba12", "#8a6d00", "#111114", "#6c6c7c", "#c2410c", "#0f766e"];
export const color = (i: number) => PALETTE[i % PALETTE.length];

const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};
const fmtAxis = (v: number) => new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(v);

function Frame({ title, unit, children, yMax, yMin = 0 }: { title: string; unit: string; children: ReactNode; yMax: number; yMin?: number }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMin + (yMax - yMin) * f);
  const y = (v: number) => M.t + (H - M.t - M.b) * (1 - (v - yMin) / (yMax - yMin || 1));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. Unidad: ${unit}. La tabla equivalente está debajo.`} focusable="false">
      <title>{title}</title>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="#d9d9e3" strokeWidth={1} />
          <text className="chart-axis" x={M.l - 6} y={y(t) + 4} textAnchor="end">{fmtAxis(t)}</text>
        </g>
      ))}
      {MONTHS.map((m, i) => (
        <text key={m} className="chart-axis" x={xOf(i + 1)} y={H - M.b + 16} textAnchor="middle">{m}</text>
      ))}
      <text className="chart-axis" x={M.l} y={H - 4} textAnchor="start">{unit}</text>
      {children}
    </svg>
  );
}
const xOf = (month: number) => M.l + ((W - M.l - M.r) * (month - 0.5)) / 12;
const yFn = (yMax: number, yMin = 0) => (v: number) => M.t + (H - M.t - M.b) * (1 - (v - yMin) / (yMax - yMin || 1));

export function Legend({ items }: { items: { label: string; color: string; dash?: string; marker?: "circle" | "square" | "bar" }[] }) {
  return (
    <ul className="legend" aria-label="Leyenda">
      {items.map((i) => (
        <li key={i.label}>
          <svg viewBox="0 0 26 12" aria-hidden="true">
            {i.marker === "bar" ? <rect x="2" y="1" width="22" height="10" fill={i.color} /> : (
              <>
                <line x1="0" x2="26" y1="6" y2="6" stroke={i.color} strokeWidth={2} strokeDasharray={i.dash} />
                {i.marker === "square" ? <rect x="9" y="3" width="8" height="8" fill={i.color} /> : <circle cx="13" cy="6" r="4" fill={i.color} />}
              </>
            )}
          </svg>
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Líneas por mes con huecos reales (sin interpolación), objetivo opcional y hitos con fecha y ámbito. */
export function LineChart({ title, unit, lines, target, marks = [] }: { title: string; unit: string; lines: Line[]; target?: { value: number; label: string; tip: string }; marks?: Mark[] }) {
  const vals = lines.flatMap((l) => l.points.map((p) => p.y).filter((v): v is number => v !== null)).concat(target ? [target.value] : []);
  const yMax = niceMax(Math.max(...vals, 0) * 1.08);
  const y = yFn(yMax);
  return (
    <Frame title={title} unit={unit} yMax={yMax}>
      {target ? (
        <g>
          <line x1={M.l} x2={W - M.r} y1={y(target.value)} y2={y(target.value)} stroke="#555" strokeWidth={1.5} strokeDasharray="2 4"><title>{target.tip}</title></line>
          <text className="chart-axis" x={W - M.r} y={y(target.value) - 4} textAnchor="end">{target.label}</text>
        </g>
      ) : null}
      {marks.map((m, i) => (
        <g key={`${m.label}-${i}`}>
          <line x1={xOf(m.x)} x2={xOf(m.x)} y1={M.t} y2={H - M.b} stroke="#8a6d00" strokeWidth={1} strokeDasharray="5 3" />
          <text className="chart-axis" x={xOf(m.x) + 3} y={M.t + 10 + (i % 3) * 11} fill="#8a6d00">{m.label}</text>
          <title>{m.label}</title>
        </g>
      ))}
      {lines.map((l) => {
        const segs: string[][] = [[]];
        for (const p of l.points) {
          if (p.y === null) segs.push([]);
          else segs[segs.length - 1].push(`${xOf(p.x).toFixed(1)},${y(p.y).toFixed(1)}`);
        }
        return (
          <g key={l.name}>
            {segs.filter((s) => s.length > 1).map((s, i) => <polyline key={i} points={s.join(" ")} fill="none" stroke={l.color} strokeWidth={2.2} strokeDasharray={l.dash} />)}
            {l.points.filter((p) => p.y !== null).map((p) => (
              <g key={p.x}>
                {l.marker === "square" ? (
                  <rect x={xOf(p.x) - 4} y={y(p.y as number) - 4} width={8} height={8} fill={p.hollow ? "#fff" : l.color} stroke={l.color} strokeWidth={2}><title>{p.tip}</title></rect>
                ) : (
                  <circle cx={xOf(p.x)} cy={y(p.y as number)} r={4.5} fill={p.hollow ? "#fff" : l.color} stroke={l.color} strokeWidth={2}><title>{p.tip}</title></circle>
                )}
              </g>
            ))}
          </g>
        );
      })}
    </Frame>
  );
}

/** Barras apiladas por mes (dedicación por equipo/perfil). Los meses sin datos no se dibujan (no son cero). */
export function StackChart({ title, unit, series, months }: { title: string; unit: string; series: { name: string; color: string; values: ({ v: number; tip: string } | null)[] }[]; months: number }) {
  const totals = Array.from({ length: months }, (_, i) => series.reduce((s, x) => s + (x.values[i]?.v ?? 0), 0));
  const yMax = niceMax(Math.max(...totals, 0) * 1.08);
  const y = yFn(yMax);
  const bw = Math.min(34, ((W - M.l - M.r) / 12) * 0.62);
  return (
    <Frame title={title} unit={unit} yMax={yMax}>
      {Array.from({ length: months }, (_, i) => {
        let acc = 0;
        return (
          <g key={i}>
            {series.map((s) => {
              const c = s.values[i];
              if (!c || c.v <= 0) return null;
              const y0 = y(acc);
              acc += c.v;
              const y1 = y(acc);
              return <rect key={s.name} x={xOf(i + 1) - bw / 2} y={y1} width={bw} height={Math.max(y0 - y1, 0.5)} fill={s.color} stroke="#fff" strokeWidth={0.6}><title>{c.tip}</title></rect>;
            })}
          </g>
        );
      })}
    </Frame>
  );
}

/** Barras simples por mes (p. ej. PAP únicos): panel alineado y separado de las horas. */
export function BarChart({ title, unit, values, color: c = "#1f18c0" }: { title: string; unit: string; values: ({ v: number; tip: string } | null)[]; color?: string }) {
  const yMax = niceMax(Math.max(...values.map((v) => v?.v ?? 0), 0) * 1.15 || 1);
  const y = yFn(yMax);
  const bw = Math.min(34, ((W - M.l - M.r) / 12) * 0.62);
  return (
    <Frame title={title} unit={unit} yMax={yMax}>
      {values.map((c2, i) => (c2 ? <rect key={i} x={xOf(i + 1) - bw / 2} y={y(c2.v)} width={bw} height={Math.max(y(0) - y(c2.v), 0.5)} fill={c}><title>{c2.tip}</title></rect> : null))}
    </Frame>
  );
}

/** Barras agrupadas (real frente a objetivo): dos magnitudes de la MISMA unidad por periodo; una sin dato se rotula, no se dibuja como cero. */
export function GroupedBars({ title, unit, groups }: { title: string; unit: string; groups: { label: string; a: { v: number | null; tip: string }; b: { v: number | null; tip: string } }[] }) {
  const all = groups.flatMap((g) => [g.a.v, g.b.v]).filter((v): v is number => v !== null);
  const yMax = niceMax(Math.max(...all, 0) * 1.1 || 1);
  const y = yFn(yMax);
  const gw = (W - M.l - M.r) / groups.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. Unidad: ${unit}. La tabla equivalente está debajo.`} focusable="false">
      <title>{title}</title>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={M.l} x2={W - M.r} y1={y(yMax * f)} y2={y(yMax * f)} stroke="#d9d9e3" />
          <text className="chart-axis" x={M.l - 6} y={y(yMax * f) + 4} textAnchor="end">{fmtAxis(yMax * f)}</text>
        </g>
      ))}
      {groups.map((g, i) => {
        const cx = M.l + gw * (i + 0.5);
        return (
          <g key={g.label}>
            {g.a.v !== null ? <rect x={cx - 26} y={y(g.a.v)} width={24} height={Math.max(y(0) - y(g.a.v), 0.5)} fill="#1f18c0"><title>{g.a.tip}</title></rect> : <text className="chart-axis" x={cx - 14} y={y(0) - 4} textAnchor="middle">s/d</text>}
            {g.b.v !== null ? <rect x={cx + 2} y={y(g.b.v)} width={24} height={Math.max(y(0) - y(g.b.v), 0.5)} fill="#dbba12" stroke="#8a6d00"><title>{g.b.tip}</title></rect> : <text className="chart-axis" x={cx + 14} y={y(0) - 4} textAnchor="middle">s/d</text>}
            <text className="chart-axis" x={cx} y={H - M.b + 16} textAnchor="middle">{g.label}</text>
          </g>
        );
      })}
      <text className="chart-axis" x={M.l} y={H - 4}>{unit}</text>
    </svg>
  );
}
export { MONTHS };
