import Link from "next/link";
import { Dec } from "@/domain/finance";
import { PERIOD_KEYS, type PeriodKey, type PeriodSeries } from "@/server/economics/engine";
import type { FichaView } from "@/server/analytics/ficha";
import { BarChart, GroupedBars, Legend, LineChart, StackChart, color, MONTHS, type Line, type Mark } from "@/components/analytics/charts";
import { Money, Notice, Pct, PeriodBadges, Ratio, eur, fdate, hrs, monthName } from "@/components/analytics/ui";
import { formatDecimalEs } from "@/lib/money";
import { fichaHref } from "./links";

const PERIOD_TITLE: Record<PeriodKey, string> = { month: "Mes seleccionado", prevMonth: "Mes anterior completo", cum: "CUM del año seleccionado", prevYear: "Año anterior completo", prevCum: "CUM anterior comparable" };
const num = (s: string | null | undefined): number | null => (s === null || s === undefined ? null : Number.parseFloat(s)); // solo para coordenadas

type Ctx = { f: FichaView; back: string };
const link = (c: Ctx, extra: Record<string, string>) => fichaHref(c.f.query, c.f.context.ref, c.back, { pestana: c.f.query.tab === "resumen" ? undefined : c.f.query.tab, ...extra });

export function PeriodCards({ c }: { c: Ctx }) {
  const e = c.f.entity;
  const isGroup = c.f.context.ref.type === "group";
  return (
    <section aria-label="Cinco periodos">
      <div className="period-cards">
        {PERIOD_KEYS.map((k) => {
          const p = e.periods[k];
          const L = (det: string, metrica?: string) => link(c, { det, periodo: k, ...(metrica ? { metrica } : {}) });
          return (
            <article className="card" key={k} aria-label={PERIOD_TITLE[k]}>
              <h3>{PERIOD_TITLE[k]} <PeriodBadges p={p} /></h3>
              <div className="hint">{fdate(p.from)} – {fdate(p.to)}{p.partial ? " (último mes parcial)" : ""}</div>
              <dl>
                <dt>Horas dedicadas</dt><dd><Link href={L("horas")}>{hrs(p.hours.inPerimeter)}</Link></dd>
                {isGroup ? (
                  <>
                    <dt>Ingreso imputado</dt><dd><Link href={L("ingreso")}><Money a={p.revenue} /> {p.revenue.value !== null ? "€" : ""}</Link></dd>
                    <dt>€/jornada dedicada</dt><dd><Link href={L("ratio", "perDay")}><Ratio f={p.perDay} /></Link></dd>
                    <dt>Desv. contra objetivo</dt><dd><Link href={L("ratio", "devTarget")}><Pct f={p.deviationVsTarget} /></Link></dd>
                    <dt>Desv. contra cartera</dt><dd>{p.deviationVsPortfolio ? <Link href={L("ratio", "devPortfolio")}><Pct f={p.deviationVsPortfolio} /></Link> : "—"}</dd>
                    <dt>Horas objetivo</dt><dd><Link href={L("ratio", "targetHours")}>{p.targetHours.value !== null ? hrs(p.targetHours.value) : <Ratio f={p.targetHours} />}</Link></dd>
                    <dt>Desv. de horas</dt><dd><Link href={L("ratio", "devHours")}><Pct f={p.deviationHours} /></Link></dd>
                    <dt>Tarifa anual/usuario</dt><dd><Link href={L("ratio", "tariff")}>{p.perUserPerYear.value !== null ? `${formatDecimalEs(p.perUserPerYear.value, 2)} €` : <Ratio f={p.perUserPerYear} />}</Link></dd>
                  </>
                ) : (
                  <>
                    <dt>Ingreso</dt><dd><span className="muted">agrupado en Grupo</span></dd>
                    <dt>Horas objetivo</dt><dd><span className="muted">sin ingreso propio</span></dd>
                  </>
                )}
                <dt>Usuarios al corte</dt><dd>{p.users.stock.value ?? <span className="muted">sin informar</span>}</dd>
                <dt>Usuarios medios</dt><dd>{p.users.averageUsers !== null ? formatDecimalEs(p.users.averageUsers, 2) : <span className="muted">incompleto</span>}</dd>
              </dl>
            </article>
          );
        })}
      </div>
      {!isGroup ? (
        <Notice kind="info">
          <strong>Ingreso agrupado en Grupo Cliente.</strong> {e.incomeNote}. Aquí se muestran las horas, usuarios y hechos operativos de este ámbito; no se reparte el ingreso ni se inventa un ratio propio.
          {c.f.context.group ? <> <Link href={fichaHref(c.f.query, { type: "group", id: c.f.context.group.id }, c.back)}>Abrir el contexto económico completo del grupo</Link>.</> : <> Este Cliente no tiene grupo asignado: se muestran sus hechos operativos y la falta de asignación económica.</>}
        </Notice>
      ) : null}
      {c.f.groupContext ? (
        <div className="card" aria-label="Contexto económico del grupo">
          <h3>Contexto del grupo «{c.f.groupContext.name}» <span className="badge badge-int">del grupo</span></h3>
          <p className="hint">Resultado económico del Grupo Cliente (no se suma al resultado operativo de este Cliente).</p>
          <dl className="kv">
            <dt>Ingreso imputado del grupo (mes)</dt><dd><Money a={c.f.groupContext.periods.month.revenue} /> €</dd>
            <dt>€/jornada del grupo (mes)</dt><dd><Ratio f={c.f.groupContext.periods.month.perDay} /></dd>
            <dt>Horas del grupo (mes)</dt><dd>{hrs(c.f.groupContext.periods.month.hours.inPerimeter)}</dd>
          </dl>
        </div>
      ) : null}
      {c.f.cohort.note ? <p className="hint">{c.f.cohort.note}</p> : null}
    </section>
  );
}

function milestoneMarks(f: FichaView): Mark[] {
  const cutY = Number(f.cut.slice(0, 4));
  return f.milestones
    .filter((m) => Number(m.date.slice(0, 4)) === cutY)
    .map((m) => ({ x: Number(m.date.slice(5, 7)) + (Number(m.date.slice(8, 10)) - 1) / 31, label: `${m.type === "START" ? "Arranque" : m.type === "CLOUD_MIGRATION" ? "Migración CLOUD" : "Versión mayor"} ${fdate(m.date)} (${m.scope}: ${m.scopeName})` }));
}

function MonthTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <details className="chart-table">
      <summary>Tabla equivalente: {caption}</summary>
      <div className="table-wrap">
        <table>
          <caption className="hint">{caption}</caption>
          <thead><tr>{head.map((h) => <th key={h} scope="col" className={h === head[0] ? undefined : "num"}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}><th scope="row">{r[0]}</th>{r.slice(1).map((x, j) => <td key={j} className="num">{x}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

export function Charts({ c }: { c: Ctx }) {
  const f = c.f;
  const e = f.entity;
  const isGroup = f.context.ref.type === "group";
  const cur = e.monthly;
  const prev = e.prevMonthly;
  const cutY = Number(f.cut.slice(0, 4));
  const marks = milestoneMarks(f);
  const target = num(f.economics.settings.targetEurosPerDay) as number;
  const mkTip = (p: PeriodSeries, what: string, v: string | null, unit: string, status?: string) =>
    `${p.label}${p.provisional ? " (provisional)" : ""}${p.partial ? " (hasta " + fdate(p.to) + ")" : ""}: ${what} ${v === null ? "sin dato" : `${formatDecimalEs(v, 2)} ${unit}`}${status ? ` · ${status}` : ""}`;

  const perDayLine = (series: PeriodSeries[], name: string, col: string, dash: string | undefined, marker: "circle" | "square"): Line => ({
    name, color: col, dash, marker,
    points: series.map((p, i) => ({ x: i + 1, y: num(p.perDay.value), hollow: p.provisional, tip: mkTip(p, "€/jornada", p.perDay.value, "€/jornada", p.perDay.value === null ? p.perDay.reason ?? p.perDay.status : "dato disponible") })),
  });
  // Acumulados: una curva se interrumpe en el primer mes sin dato (un acumulado con huecos no es comparable).
  const cumLine = (series: PeriodSeries[], pick: (p: PeriodSeries) => string | null, name: string, col: string, dash: string | undefined, marker: "circle" | "square", unit: string): Line => {
    let acc: Dec | null = Dec.ZERO;
    return {
      name, color: col, dash, marker,
      points: series.map((p, i) => {
        const v = pick(p);
        acc = acc !== null && v !== null ? acc.add(Dec.parse(v) as Dec) : null;
        return { x: i + 1, y: acc === null ? null : num(acc.toString()), hollow: p.provisional, tip: `${p.label} (acumulado hasta ${fdate(p.to)})${p.provisional ? " provisional" : ""}: ${acc === null ? "sin dato" : `${formatDecimalEs(acc.toString(), 2)} ${unit}`}` };
      }),
    };
  };
  const hoursOf = (p: PeriodSeries) => p.hours.inPerimeter;
  const revOf = (p: PeriodSeries) => p.revenue.value;
  const curLabel = `${cutY}`;
  const prevLabel = `${cutY - 1} comparable (hasta ${fdate(f.economics.periodsDefinition.prevCum.to)})`;
  const baseLegend = [{ label: curLabel, color: color(0), marker: "circle" as const }, { label: prevLabel, color: color(3), dash: "6 4", marker: "square" as const }];

  const monthKeys = cur.map((m) => m.label);
  const profiles = [...new Set(monthKeys.flatMap((k) => (f.dedication?.[k]?.profiles ?? []).map((p) => p.profile)))];
  const stack = profiles.map((name, idx) => ({
    name, color: color(idx),
    values: monthKeys.map((k) => {
      const row = f.dedication?.[k]?.profiles.find((p) => p.profile === name);
      return row ? { v: num(row.hours) as number, tip: `${monthName(k)} · ${name}: ${formatDecimalEs(row.hours, 2)} h` } : null;
    }),
  }));
  const papBars = monthKeys.map((k) => {
    const pp = f.pap?.periods[k];
    return pp ? { v: pp.total, tip: `${monthName(k)} · PAP únicos con puesta en producción: ${pp.total}` } : null;
  });
  const gb = (["month", "cum", "prevCum", "prevYear"] as PeriodKey[]).map((k) => {
    const p = e.periods[k];
    return { label: PERIOD_TITLE[k].replace(" del año seleccionado", "").replace(" anterior comparable", " ant."), a: { v: num(p.hours.inPerimeter), tip: `${PERIOD_TITLE[k]}: horas reales ${formatDecimalEs(p.hours.inPerimeter, 2)} h` }, b: { v: num(p.targetHours.value), tip: `${PERIOD_TITLE[k]}: horas objetivo ${p.targetHours.value === null ? "sin dato" : `${formatDecimalEs(p.targetHours.value, 2)} h`}` } };
  });

  return (
    <section aria-label="Gráficos">
      <div className="card chart-card">
        <figure>
          <figcaption>Rentabilidad mensual (€/jornada dedicada) · {curLabel} frente a {prevLabel}</figcaption>
          {isGroup ? (
            <>
              <LineChart title="Rentabilidad mensual en euros por jornada" unit="€/jornada" lines={[perDayLine(cur, curLabel, color(0), undefined, "circle"), perDayLine(prev, prevLabel, color(3), "6 4", "square")]} target={{ value: target, label: `Objetivo ${formatDecimalEs(f.economics.settings.targetEurosPerDay, 0)} €/jornada (revisión ${f.economics.settings.revisionNo})`, tip: `Objetivo de la revisión ${f.economics.settings.revisionNo}: ${f.economics.settings.targetEurosPerDay} €/jornada` }} marks={marks} />
              <Legend items={[...baseLegend, { label: "Objetivo", color: "#555", dash: "2 4", marker: "circle" }]} />
              <p className="hint">Los círculos huecos son meses provisionales. Un mes sin ratio (sin horas, ingreso desconocido, restricción Silver On Demand) interrumpe la línea: no se interpola. Los meses futuros no tienen datos.</p>
              <MonthTable caption="Rentabilidad mensual" head={["Mes", `${curLabel} €/jornada`, "Estado", `${cutY - 1} comparable €/jornada`, "Estado"]} rows={MONTHS.slice(0, cur.length).map((_, i) => [cur[i].label, cur[i].perDay.value === null ? "—" : formatDecimalEs(cur[i].perDay.value as string, 2), `${cur[i].perDay.status}${cur[i].provisional ? " · provisional" : ""}`, prev[i]?.perDay.value == null ? "—" : formatDecimalEs(prev[i].perDay.value as string, 2), prev[i]?.perDay.status ?? "—"])} />
            </>
          ) : <p className="muted">Sin ingreso propio no hay rentabilidad mensual a este nivel: consulte el contexto económico del grupo.</p>}
        </figure>
      </div>
      <div className="grid-2">
        <div className="card chart-card">
          <figure>
            <figcaption>Horas CUM comparables</figcaption>
            <LineChart title="Horas acumuladas del año y del año anterior comparable" unit="horas" lines={[cumLine(cur, hoursOf, curLabel, color(0), undefined, "circle", "h"), cumLine(prev, hoursOf, prevLabel, color(3), "6 4", "square", "h")]} marks={marks} />
            <Legend items={baseLegend} />
            <p className="hint">Alineadas por mes y corte. El año anterior completo ({hrs(e.periods.prevYear.hours.inPerimeter)}) es una referencia separada en las cifras.</p>
            <MonthTable caption="Horas por mes" head={["Mes", curLabel, `${cutY - 1} comparable`]} rows={cur.map((m, i) => [m.label, formatDecimalEs(m.hours.inPerimeter, 2), prev[i] ? formatDecimalEs(prev[i].hours.inPerimeter, 2) : "—"])} />
          </figure>
        </div>
        <div className="card chart-card">
          <figure>
            <figcaption>Ingreso imputado CUM comparable</figcaption>
            {isGroup ? (
              <>
                <LineChart title="Ingreso imputado acumulado del año y del año anterior comparable" unit="€" lines={[cumLine(cur, revOf, curLabel, color(0), undefined, "circle", "€"), cumLine(prev, revOf, prevLabel, color(3), "6 4", "square", "€")]} marks={marks} />
                <Legend items={baseLegend} />
                <p className="hint">Imputación analítica anual/12 (facturado + potencial anual distribuido linealmente), no facturación mensual real.</p>
                <MonthTable caption="Ingreso imputado por mes (€)" head={["Mes", curLabel, `${cutY - 1} comparable`]} rows={cur.map((m, i) => [m.label, m.revenue.value === null ? "—" : formatDecimalEs(m.revenue.value, 2), prev[i]?.revenue.value == null ? "—" : formatDecimalEs(prev[i].revenue.value as string, 2)])} />
              </>
            ) : <p className="muted">Ingreso agrupado en el Grupo Cliente.</p>}
          </figure>
        </div>
      </div>
      <div className="card chart-card">
        <figure>
          <figcaption>Dedicación mensual por equipo y perfil (horas) · PAP en panel aparte</figcaption>
          {stack.length > 0 ? (
            <>
              <StackChart title="Horas por equipo y perfil por mes" unit="horas" series={stack} months={cur.length} />
              <Legend items={stack.map((s) => ({ label: s.name, color: s.color, marker: "bar" as const }))} />
            </>
          ) : <p className="muted">Sin horas elegibles en el periodo.</p>}
          <MonthTable caption="Horas por perfil y mes" head={["Mes", ...profiles]} rows={monthKeys.map((k) => [k, ...profiles.map((pn) => { const r = f.dedication?.[k]?.profiles.find((p) => p.profile === pn); return r ? formatDecimalEs(r.hours, 2) : "—"; })])} />
          <h3>PAP únicos por mes de puesta en producción (no se apilan sobre las horas)</h3>
          <BarChart title="PAP únicos por mes de puesta en producción" unit="PAP" values={papBars} color={color(2)} />
          <MonthTable caption="PAP únicos por mes" head={["Mes", "PAP"]} rows={monthKeys.map((k) => [k, String(f.pap?.periods[k]?.total ?? "—")])} />
        </figure>
      </div>
      <div className="card chart-card">
        <figure>
          <figcaption>Real frente a objetivo del periodo (horas) y magnitudes anuales</figcaption>
          {isGroup ? <GroupedBars title="Horas reales frente a horas objetivo" unit="horas" groups={gb} /> : <p className="muted">Sin ingreso propio no hay horas objetivo a este nivel.</p>}
          {isGroup ? <Legend items={[{ label: "Horas reales", color: "#1f18c0", marker: "bar" }, { label: "Horas objetivo", color: "#dbba12", marker: "bar" }]} /> : null}
          <MonthTable
            caption="Magnitudes por periodo, cada una en su unidad"
            head={["Periodo", "Horas reales (h)", "Horas objetivo (h)", "Ingreso imputado (€)", "€/jornada"]}
            rows={(["month", "prevMonth", "cum", "prevYear", "prevCum"] as PeriodKey[]).map((k) => { const p = e.periods[k]; return [PERIOD_TITLE[k], formatDecimalEs(p.hours.inPerimeter, 2), p.targetHours.value === null ? "—" : formatDecimalEs(p.targetHours.value, 2), p.revenue.value === null ? "—" : formatDecimalEs(p.revenue.value, 2), p.perDay.value === null ? "—" : formatDecimalEs(p.perDay.value, 2)]; })}
          />
        </figure>
      </div>
      {f.milestones.length > 0 ? (
        <div className="card"><h3>Hitos con fecha y ámbito</h3>
          <ul>{f.milestones.map((m, i) => <li key={i}>{fdate(m.date)} · {m.type === "START" ? "Arranque" : m.type === "CLOUD_MIGRATION" ? "Migración a CLOUD" : "Cambio mayor de versión"} · {m.scope}: {m.scopeName}{m.note ? ` — ${m.note}` : ""}</li>)}</ul>
          <p className="hint">Los hitos anotan las curvas pero no excluyen automáticamente horas ni eventos.</p></div>
      ) : null}
    </section>
  );
}
export { eur };
