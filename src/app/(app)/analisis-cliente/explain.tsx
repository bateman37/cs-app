import Link from "next/link";
import type { Formula } from "@/domain/finance";
import type { PeriodSeries } from "@/server/economics/engine";
import { formatDecimalEs, formatPercentEs } from "@/lib/money";
import { Missing, STATUS_LABEL, eur, fdate, hrs } from "@/components/analytics/ui";

export const METRICS = {
  perDay: { title: "Euros por jornada dedicada", get: (p: PeriodSeries) => p.perDay, unit: "€/jornada", frac: false },
  devTarget: { title: "Desviación contra objetivo", get: (p: PeriodSeries) => p.deviationVsTarget, unit: "", frac: true },
  devPortfolio: { title: "Desviación contra la cartera filtrada", get: (p: PeriodSeries) => p.deviationVsPortfolio, unit: "", frac: true },
  devHours: { title: "Desviación de horas (reales frente a objetivo)", get: (p: PeriodSeries) => p.deviationHours, unit: "", frac: true },
  targetHours: { title: "Horas objetivo", get: (p: PeriodSeries) => p.targetHours, unit: "h", frac: false },
  tariff: { title: "Tarifa anual por usuario (TAR RUN)", get: (p: PeriodSeries) => p.perUserPerYear, unit: "€/usuario·año", frac: false },
} as const;
export type MetricKey = keyof typeof METRICS;

const fmt = (v: string | null | undefined) => (v === null || v === undefined ? "—" : formatDecimalEs(v, 4));

/** Explicación de un ratio: numerador, denominador, factores, fórmula, referencia y estado, con enlaces a sus componentes. */
export function RatioExplanation({ metric, p, links, reference }: { metric: MetricKey; p: PeriodSeries; links: { income: string; hours: string }; reference: { engine: string; stamp: string; settings: number; method: string; cut: string } }) {
  const m = METRICS[metric];
  const f: Formula | null = m.get(p);
  return (
    <section className="card" aria-label={`Explicación: ${m.title}`}>
      <h2>{m.title} · {p.label} ({fdate(p.from)} – {fdate(p.to)})</h2>
      {!f ? <p className="muted">No aplica a este ámbito.</p> : (
        <dl className="explain">
          <dt>Estado</dt><dd><span className={`badge ${f.status === "AVAILABLE" ? "badge-ok" : "badge-warn"}`}>{STATUS_LABEL[f.status]}</span>{p.provisional ? <> <span className="badge badge-warn">provisional</span></> : null}{!p.validated ? <> <span className="badge badge-warn">no validado (reproceso pendiente)</span></> : null}</dd>
          <dt>Valor</dt><dd>{f.value === null ? <Missing f={f} /> : <strong>{m.frac ? `${formatPercentEs(f.value, 2)} (fracción ${fmt(f.value)})` : `${fmt(f.value)} ${m.unit}`}</strong>}</dd>
          <dt>Fórmula</dt><dd>{f.expression ?? "—"}</dd>
          <dt>Numerador</dt><dd>{fmt(f.numerator)}</dd>
          <dt>Denominador</dt><dd>{fmt(f.denominator)}</dd>
          {f.operands ? Object.entries(f.operands).map(([k, v]) => (<><dt key={`k${k}`}>Operando · {k}</dt><dd key={`v${k}`}>{fmt(v)}</dd></>)) : null}
          <dt>Unidad</dt><dd>{f.unit || "fracción (se presenta en %)"}</dd>
          {f.reason ? (<><dt>Motivo</dt><dd>{f.reason}</dd></>) : null}
          <dt>Componentes</dt>
          <dd>
            Ingreso imputado: {p.revenue.value === null ? <Missing f={{ status: p.revenue.status, reason: p.revenue.reason, numerator: null, denominator: null, unit: "€" }} compact /> : eur(p.revenue.value)}
            {" · "}Horas del perímetro: {hrs(p.hours.inPerimeter)} (minutos exactos {p.hours.perimeterMinutes})
            <ul className="link-list"><li><Link href={links.income}>Detalle del ingreso</Link></li><li><Link href={links.hours}>Detalle de las horas</Link></li></ul>
          </dd>
          <dt>Referencia</dt><dd>motor {reference.engine} · método «{reference.method}» · revisión de configuración {reference.settings} · corte {fdate(reference.cut)} · datos <code>{reference.stamp}</code></dd>
        </dl>
      )}
    </section>
  );
}
