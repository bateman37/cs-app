import Link from "next/link";
import type { FichaView } from "@/server/analytics/ficha";
import { MEASURES, MONTH_SHORT, type AnnualPoint, type Cell, type Measure, type MeasureKey, type MonthRow } from "@/domain/ficha-series";
import { formatDecimalEs } from "@/lib/money";
import { ChartCard, type ChartSpec, type LegendItem, type Tip } from "./ficha-client";
import { cmpDiffText, cmpPctText, coord, dm, dmy, kilo, monthRowsText, num, pctFrac, signed } from "./ficha-format";
import { fichaUrl, type Nav } from "./links";

/** Gráficos de la zona izquierda: rentabilidad y horas mensuales (año elegido frente al anterior), PAP mensual y anuales. Todo sale de `f.series`/`f.annual`. */
const CUR = "#1f18c0";
const PREV = "#a8abdc";
const CUM = "#0f766e";

const legendYears = (y: number, py: number): LegendItem[] => [
  { label: String(y), color: CUR },
  { label: `${py} comparable`, color: PREV },
];

// ---------------------------------------------------------------- Mensuales

function monthlySpec(f: FichaView, m: Measure, rows: MonthRow[] | null, extra: { cum?: MonthRow[] | null; dev?: MonthRow[] | null; ref?: ChartSpec["ref"]; emptyText: string; height: number }): ChartSpec {
  const s = f.series;
  const base: Omit<ChartSpec, "bars" | "lines" | "tips"> = { ariaLabel: `${m.title} (${m.unit}), ${s.year} frente a ${s.prevYear}`, cats: MONTH_SHORT.map((x) => x), height: extra.height, axisDigits: m.digits, emptyText: extra.emptyText, ref: extra.ref };
  if (!rows) return { ...base, bars: [], lines: [], tips: [] };
  const mil = f.milestones.filter((x) => Number(x.date.slice(0, 4)) === s.year).map((x) => ({ at: Number(x.date.slice(5, 7)) - 1 + (Number(x.date.slice(8, 10)) - 0.5) / 31, label: `${x.type === "START" ? "Arranque" : x.type === "CLOUD_MIGRATION" ? "Migración CLOUD" : "Versión mayor"} ${dmy(x.date)} (${x.scope}: ${x.scopeName})` }));
  const tips: (Tip | null)[] = rows.map((r, i) => {
    if (r.future) return null;
    const out: [string, string][] = monthRowsText(m, r, s.year, s.prevYear, 2);
    const cumR = extra.cum?.[i];
    if (cumR && !cumR.future) out.push([`CUM ${s.year} · ${s.prevYear}`, `${cumR.cur?.v == null ? "sin dato" : num(cumR.cur.v, 2)} · ${cumR.prev?.v == null ? "sin dato" : num(cumR.prev.v, 2)}`], ["CUM variación", cmpPctText(MEASURES.cumPerDay, cumR.cmp)]);
    const devR = extra.dev?.[i];
    if (devR && !devR.future) out.push([`Desv. objetivo ${s.year} · ${s.prevYear}`, `${pctFrac(devR.cur?.v ?? null)} · ${pctFrac(devR.prev?.v ?? null)}`], ["Δ desviación", cmpDiffText(MEASURES.devTarget, devR.cmp)]);
    const why = [r.cur?.v === null ? r.cur.reason : null, r.prev && r.prev.v === null ? `Año anterior: ${r.prev.reason}` : null].filter(Boolean).join(" ");
    return { title: `${MONTH_SHORT[i]} ${s.year}${r.partial ? " · parcial" : ""}${r.provisional ? " · provisional" : ""}`, rows: out, note: why || (r.cmp && r.cmp.state !== "OK" && r.cmp.state !== "SIN_DATOS" && m.kind === "magnitude" ? CMP_NOTE(r) : undefined) };
  });
  const hollow = rows.map((r) => r.partial || r.provisional);
  return {
    ...base,
    marks: mil,
    bars: [
      { name: String(s.year), color: CUR, values: rows.map((r) => coord(r.cur?.v)), hollow },
      { name: String(s.prevYear), color: PREV, values: rows.map((r) => coord(r.prev?.v)) },
    ],
    lines: extra.cum ? [{ name: `CUM ${s.year}`, color: CUM, values: extra.cum.map((r) => coord(r.cur?.v)) }] : [],
    tips,
  };
}
const CMP_NOTE = (r: MonthRow): string | undefined => (r.cmp?.state === "BASE_CERO" ? "Año anterior en cero: variación relativa no definida." : r.cmp?.state === "SIN_ANTERIOR" ? "Sin dato del año anterior." : undefined);

function MonthEq({ f, m, rows, cum, dev }: { f: FichaView; m: Measure; rows: MonthRow[] | null; cum?: MonthRow[] | null; dev?: MonthRow[] | null }) {
  const s = f.series;
  if (!rows) return <p className="fc-note">{s.missing[m.key] ?? "Serie no disponible."}</p>;
  const d = 2;
  return (
    <table className="fc-tbl">
      <caption className="fc-sr">{m.title} ({m.unit}), {s.year} frente a {s.prevYear}. {m.direction}.</caption>
      <thead>
        <tr>
          <th className="fc-l" scope="col">Mes</th><th scope="col">{s.year}</th><th scope="col">{s.prevYear}</th><th scope="col">Dif.</th><th scope="col">Var. %</th>
          {cum ? <><th scope="col" className="fc-sep">CUM {s.year}</th><th scope="col">CUM {s.prevYear}</th><th scope="col">Var. %</th></> : null}
          {dev ? <><th scope="col" className="fc-sep">Desv. obj. {s.year}</th><th scope="col">Desv. obj. {s.prevYear}</th><th scope="col">Δ pp</th></> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.month} className={r.future ? "fc-future" : undefined}>
            <th scope="row">{r.short}{r.partial ? <span title={`Mes parcial: ${s.year} hasta ${dmy(r.curTo)}, ${s.prevYear} hasta ${dmy(r.prevTo)}`}> *</span> : null}</th>
            {r.future ? <td colSpan={4} aria-label="mes futuro, sin datos" /> : (
              <>
                <td>{r.cur?.v == null ? "—" : num(r.cur.v, d)}</td>
                <td>{r.prev?.v == null ? "—" : num(r.prev.v, d)}</td>
                <td>{r.cmp?.diff == null ? "—" : signed(r.cmp.diff, d)}</td>
                <td title={r.cmp && r.cmp.state !== "OK" && r.cmp.state !== "SIN_DATOS" ? cmpPctText(m, r.cmp) : undefined}>{r.cmp?.pct == null ? (r.cmp?.state === "BASE_CERO" ? "base 0" : "—") : cmpPctText(m, r.cmp)}</td>
              </>
            )}
            {cum ? (cum[i].future ? <td colSpan={3} className="fc-sep" /> : <><td className="fc-sep">{cum[i].cur?.v == null ? "—" : num(cum[i].cur?.v, d)}</td><td>{cum[i].prev?.v == null ? "—" : num(cum[i].prev?.v, d)}</td><td>{cum[i].cmp?.pct == null ? (cum[i].cmp?.state === "BASE_CERO" ? "base 0" : "—") : cmpPctText(MEASURES.cumPerDay, cum[i].cmp)}</td></>) : null}
            {dev ? (dev[i].future ? <td colSpan={3} className="fc-sep" /> : <><td className="fc-sep">{pctFrac(dev[i].cur?.v ?? null)}</td><td>{pctFrac(dev[i].prev?.v ?? null)}</td><td>{dev[i].cmp?.diff == null ? "—" : signed(dev[i].cmp?.diff, 1)}</td></>) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------- Anuales

function annualSpecs(f: FichaView, kind: "revenue" | "perDay") {
  const pts = f.annual;
  const pick = (c: AnnualPointCell | null): Cell | null => (c ? (kind === "revenue" ? c.revenue : c.perDay) : null);
  const full = pts.map((p) => pick(p.full));
  const cum = pts.map((p) => pick(p.cum));
  const label = (c: Cell | null) => (c?.v == null ? null : kind === "revenue" ? kilo(c.v) : formatDecimalEs(c.v, 0));
  const target = coord(f.economics.settings.targetEurosPerDay) as number;
  const tips: (Tip | null)[] = pts.map((p) => {
    const rowsT: [string, string][] = [
      ["Año completo", p.full ? (pick(p.full)?.v == null ? "sin dato" : `${num(pick(p.full)?.v, 2)} ${kind === "revenue" ? "€" : "€/jornada"}`) : "en curso"],
      [`CUM hasta ${dm(p.cum?.to)}`, p.cum ? (pick(p.cum)?.v == null ? "sin dato" : `${num(pick(p.cum)?.v, 2)} ${kind === "revenue" ? "€" : "€/jornada"}`) : "—"],
    ];
    if (kind === "perDay") rowsT.push(["Horas completo · CUM", `${p.full ? num(p.full.hours.v, 2) : "—"} · ${p.cum ? num(p.cum.hours.v, 2) : "—"} h`]);
    const why = [p.full && pick(p.full)?.v === null ? pick(p.full)?.reason : null, p.cum && pick(p.cum)?.v === null ? pick(p.cum)?.reason : null].filter(Boolean).join(" ");
    return { title: p.currentYear ? `${p.year} · en curso (solo CUM)` : String(p.year), rows: rowsT, note: why || undefined };
  });
  const spec: ChartSpec = {
    ariaLabel: kind === "revenue" ? "Ingreso imputado anual: año completo y CUM comparable" : "Rentabilidad anual en euros por jornada: año completo y CUM comparable",
    cats: pts.map((p) => String(p.year)),
    bars: [
      { name: "Año completo", color: CUR, values: full.map((c) => coord(c?.v)), labels: full.map(label) },
      { name: "CUM comparable", color: PREV, values: cum.map((c) => coord(c?.v)), labels: cum.map(label) },
    ],
    lines: [],
    ref: kind === "perDay" ? { value: target, label: `Obj. ${formatDecimalEs(f.economics.settings.targetEurosPerDay, 0)}` } : undefined,
    tips,
    height: 190,
    axisDigits: 0,
    emptyText: "Sin datos anuales.",
  };
  return spec;
}
type AnnualPointCell = NonNullable<AnnualPoint["full"]>;

function AnnualEq({ f, kind }: { f: FichaView; kind: "revenue" | "perDay" }) {
  return (
    <table className="fc-tbl">
      <caption className="fc-sr">{kind === "revenue" ? "Ingreso imputado" : "Rentabilidad"} por año: completo y CUM comparable</caption>
      <thead>
        <tr><th className="fc-l" scope="col">Año</th><th scope="col">{kind === "revenue" ? "Ingreso (€)" : "€/jornada"} completo</th><th scope="col">CUM comparable</th><th scope="col">Horas completo</th><th scope="col">Horas CUM</th></tr>
      </thead>
      <tbody>
        {f.annual.map((p) => {
          const g = (c: AnnualPointCell | null) => (c === null ? "—" : (kind === "revenue" ? c.revenue : c.perDay).v === null ? "—" : num((kind === "revenue" ? c.revenue : c.perDay).v, 2));
          return (
            <tr key={p.year}>
              <th scope="row">{p.year}{p.currentYear ? " *" : ""}</th>
              <td>{p.full ? g(p.full) : "en curso"}</td><td title={p.cum ? `hasta ${dmy(p.cum.to)}` : undefined}>{g(p.cum)}</td>
              <td>{p.full ? num(p.full.hours.v, 2) : "—"}</td><td>{p.cum ? num(p.cum.hours.v, 2) : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------- Zona izquierda

export function ChartsZone({ f, nav }: { f: FichaView; nav: Nav }) {
  const s = f.series;
  const own = s.economicOwner;
  const ctxName = own && own.kind === "group" ? " · Grupo (contexto)" : "";
  const target = coord(f.economics.settings.targetEurosPerDay) as number;
  const perDay = s.rows.perDay;
  const emptyEco = s.missing.perDay ?? "Sin datos.";
  const specRent = monthlySpec(f, MEASURES.perDay, perDay, { cum: s.rows.cumPerDay, dev: s.rows.devTarget, ref: { value: target, label: `Objetivo ${formatDecimalEs(f.economics.settings.targetEurosPerDay, 0)}` }, emptyText: emptyEco, height: 250 });
  const specHours = monthlySpec(f, MEASURES.hours, s.rows.hours, { emptyText: "Sin horas.", height: 250 });
  const specPap = monthlySpec(f, MEASURES.pap, s.rows.pap, { emptyText: "Sin PAP atribuidos a este ámbito.", height: 190 });
  const lg = legendYears(s.year, s.prevYear);
  const href = (extra: Record<string, string>) => fichaUrl({ ...nav }, f.context.ref, { ...extra, sello: f.economics.reference.dataStamp.stamp });
  const annualRevenue = annualSpecs(f, "revenue");
  const annualPerDay = annualSpecs(f, "perDay");
  const annLegend: LegendItem[] = [{ label: "Año completo", color: CUR }, { label: "CUM comparable", color: PREV }];
  return (
    <div className="fc-left">
      <div className="fc-row-2">
        <ChartCard
          title={`Rentabilidad mensual${ctxName}`}
          unit="€/jornada"
          legend={[...lg, { label: "CUM año", color: CUM, kind: "line" }, { label: "Objetivo", color: "#b45309", kind: "dash" }, { label: "Mes parcial", color: CUR, hollow: true }]}
          spec={specRent}
          table={<MonthEq f={f} m={MEASURES.perDay} rows={perDay} cum={s.rows.cumPerDay} dev={s.rows.devTarget} />}
          detailHref={href({ det: "ratio", periodo: "month", metrica: "perDay" })}
        />
        <ChartCard
          title="Horas mensuales"
          unit="h"
          legend={[...lg, { label: "Mes parcial", color: CUR, hollow: true }]}
          spec={specHours}
          table={<MonthEq f={f} m={MEASURES.hours} rows={s.rows.hours} />}
          detailHref={href({ det: "horas", periodo: "cum" })}
        />
      </div>
      <div className="fc-row-3">
        <ChartCard title="PAP mensual" unit="PAP, no son horas" legend={lg} spec={specPap} table={<MonthEq f={f} m={MEASURES.pap} rows={s.rows.pap} />} detailHref={href({ det: "pap", periodo: "cum" })} />
        <ChartCard title={`Ingreso imputado anual${ctxName ? " · Grupo" : ""}`} unit="€" legend={annLegend} spec={annualRevenue} table={<AnnualEq f={f} kind="revenue" />} />
        <ChartCard title={`Rentabilidad anual${ctxName ? " · Grupo" : ""}`} unit="€/jornada" legend={[...annLegend, { label: "Objetivo", color: "#b45309", kind: "dash" }]} spec={annualPerDay} table={<AnnualEq f={f} kind="perDay" />} />
      </div>
    </div>
  );
}

export { Link };
export type { MeasureKey };
