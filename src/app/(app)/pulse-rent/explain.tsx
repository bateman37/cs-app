import Link from "next/link";
import { BandBadge, StateBadge, fmt } from "@/components/pulse/ui";
import { NORMALIZATION_FORMULA, NORMALIZATION_LABEL, BAND_LABEL } from "@/domain/pulse-stats";
import { METRIC_BY_ID } from "@/domain/pulse-catalog";
import { PERIOD_LABEL, SCOPE_LABEL, pulseToParams } from "@/domain/pulse-query";
import { qs } from "@/lib/format";
import { STATE_LABEL, type PulseView } from "@/server/pulse/service";
import { fdate } from "@/components/analytics/ui";

/** Explicación integrada de una celda: valor bruto, fórmula, denominador, ámbito, corte, origen, estado, revisión, referencia, cortes y regla de banda. */
export function Explain({ view }: { view: PulseView }) {
  const q = view.query;
  const m = q.col ? METRIC_BY_ID.get(q.col) : null;
  const row = q.sel ? view.rows.find((r) => r.id === q.sel) : undefined;
  if (!m || !row) return null;
  const c = row.cells[m.id];
  const s = view.stats[m.id];
  const detail = `/pulse-rent/detalle${qs({ ...pulseToParams(q), entidad: row.id, metrica: m.id, sel: undefined, col: undefined })}`;
  return (
    <section className="card" id="explicacion" aria-labelledby="exp-h">
      <h2 id="exp-h">{row.name} · {m.id} {m.label}</h2>
      <p>
        <strong>{fmt(c.value, c.unit)} {c.value !== null ? c.unit : ""}</strong> <StateBadge state={c.state} reason={null} /> <BandBadge band={c.band} />
        {c.band === null && c.bandReason ? <span className="muted"> {c.bandReason}</span> : null}
      </p>
      <dl className="kv">
        <dt>Estado</dt><dd>{STATE_LABEL[c.state]}{c.reason ? ` — ${c.reason}` : ""}</dd>
        <dt>Valor bruto del periodo</dt><dd>{c.raw === null ? "no calculable" : `${fmt(c.raw, m.unit)} ${m.unit}`}</dd>
        <dt>Variante aplicada</dt><dd>{NORMALIZATION_LABEL[c.variant]} · fórmula {NORMALIZATION_FORMULA[c.variant]}</dd>
        <dt>Numerador</dt><dd>{m.numerator}{c.numerator !== null ? ` = ${fmt(c.numerator, m.unit)}` : ""}</dd>
        <dt>Denominador</dt><dd>{m.denominator}{c.denominator !== null ? ` = ${fmt(c.denominator, "")}` : ""}</dd>
        <dt>Ámbito y periodo</dt><dd>{SCOPE_LABEL[row.type]} · {m.period === "prevYear" ? "Año anterior completo (periodo explícito)" : PERIOD_LABEL[q.period]} ({fdate(view.period.from)} – {fdate(view.period.to)}); corte efectivo {fdate(view.cut)}{view.period.provisional ? " · provisional" : ""}</dd>
        <dt>Origen</dt><dd>{m.source}</dd>
        <dt>Revisiones</dt><dd>Pulse Rent {view.config.revisionNo} · economía {view.manifest.economic} · Calidad {view.manifest.quality} · motor {view.engineVersion} · referencia de datos <code>{view.stamp}</code></dd>
        <dt>Referencia estadística</dt><dd>{view.reference.label} ({view.reference.origin.toLowerCase()}): {view.reference.description} N = {s?.n ?? 0}.</dd>
        <dt>Cortes usados</dt><dd>{s && s.n > 0 ? `P10 ${fmt(s.p10, s.unit)} · P25 ${fmt(s.p25, s.unit)} · mediana ${fmt(s.median, s.unit)} · P75 ${fmt(s.p75, s.unit)} · P90 ${fmt(s.p90, s.unit)}` : "sin referencia"}</dd>
        <dt>Regla de banda</dt><dd>{c.direction === "NONE" ? "Sin juicio favorable/desfavorable (contexto)." : `${c.bandRule}${c.customDirection ? " (dirección personalizada)" : ""}`}{c.band ? ` → ${BAND_LABEL[c.band]}` : ""}</dd>
      </dl>
      <p><Link className="btn btn-secondary" href={detail}>Ver el detalle que concilia con el numerador</Link></p>
    </section>
  );
}
