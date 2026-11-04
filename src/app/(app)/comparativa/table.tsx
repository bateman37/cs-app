import Link from "next/link";
import type { ReactNode } from "react";
import { BLOCK_PERIOD, PERIOD_BLOCKS, type PeriodBlock } from "@/domain/analytics-query";
import { comparativaParams } from "@/domain/comparativa-query";
import { type Formula } from "@/domain/finance";
import { label } from "@/components/analytics/ui";
import type { Amount, PeriodKey } from "@/server/economics/engine";
import type { MetaCell, PortfolioRow, PortfolioView } from "@/server/analytics/portfolio";
import { formatDecimalEs, formatPercentEs } from "@/lib/money";
import { qs } from "@/lib/format";
import { BAND_LABEL, economicBand, type BandFactors } from "@/domain/economic-bands";

/** Bloques y columnas de §7: Identificación + cinco periodos, todos visibles. Cabeceras de dos/tres líneas con unidades. */
const BLOCK_TITLE: Record<PeriodBlock, string> = { mes: "Mes seleccionado", anterior: "Mes anterior", cum: "Año actual CUM", anioant: "Año anterior completo", cumant: "CUM anterior comparable" };
type ColKey = "hours" | "revenue" | "perDay" | "devTarget" | "devPortfolio" | "stock" | "tariff";
const HEAD: Record<ColKey, string> = { hours: "Horas (h)", revenue: "Facturación imputada (€)", perDay: "€ / jornada", devTarget: "Desv. objetivo (%)", devPortfolio: "Desv. media filtrada (%)", stock: "Usuarios al corte", tariff: "Tarifa anual / usuario (€)" };
const COLS: Record<PeriodKey, ColKey[]> = {
  month: ["hours", "revenue", "perDay", "devTarget", "devPortfolio"],
  prevMonth: ["hours", "revenue", "perDay"],
  cum: ["hours", "revenue", "stock", "tariff", "perDay", "devTarget", "devPortfolio"],
  prevYear: ["hours", "revenue", "perDay"],
  prevCum: ["hours", "revenue", "perDay"],
};
/** Anchos fijos (px) para que la tabla compacta quepa a 1920 px con nombres y cifras grandes; las cabeceras se parten en 2–3 líneas, no el contenido. */
const COL_W: Record<ColKey, number> = { hours: 56, revenue: 84, perDay: 66, devTarget: 86, devPortfolio: 76, stock: 56, tariff: 70 };
const ID_W = [186, 112, 60];
const fdm = (iso: string) => iso.split("-").reverse().join("/");

/** Valor no disponible: «—» con la explicación breve al clic/foco (sin párrafos en la celda). Funciona sin JavaScript (`details`). */
export function Dash({ reason, partial }: { reason: string; partial?: boolean }) {
  return (
    <details className="nd">
      <summary aria-label={`Dato no disponible. ${reason}`} title={reason}>{partial ? "—*" : "—"}</summary>
      <span className="nd-pop" role="note">{reason}</span>
    </details>
  );
}

const fh = (v: string) => formatDecimalEs(v, 1);
const f0 = (v: string) => formatDecimalEs(v, 0);
const pct = (v: string) => formatPercentEs(v, 1);
const devClass = (v: string | null) => (v === null ? undefined : v.startsWith("-") ? "dev-neg" : /^0(\.0+)?$/.test(v) ? undefined : "dev-pos");
const FORMULA_REASON = (f: { reason: string | null; status: string }, dflt: string) => f.reason ?? dflt;

function Money({ a, exact }: { a: Amount; exact?: boolean }) {
  if (a.value === null) return <Dash reason={a.reason ?? "Sin ingreso conocido para este periodo."} />;
  return <span title={exact ? undefined : `${formatDecimalEs(a.value, 2)} €`}>{f0(a.value)}</span>;
}
/** €/jornada con su banda económica (color + etiqueta accesible) y el asterisco de cifra provisional (HOTFIX-03 §8-§9). */
function Ratio({ f, digits = 0, target, factors }: { f: Formula; digits?: number; target?: string; factors?: BandFactors }) {
  if (f.value === null) return <Dash reason={FORMULA_REASON(f, "No calculable con los datos cargados.")} partial={f.status === "PARTIAL"} />;
  const band = target ? economicBand(f.value, target, factors) : null;
  const prov = f.provisional === true;
  const label = [band ? BAND_LABEL[band] : null, prov ? `Cifra provisional: ${f.reason ?? ""}` : null, f.imputed ? "Imputación económica anual prorrateada" : null].filter(Boolean).join(". ");
  return (
    <span className={`${band ? `band band-${band}` : ""}${prov ? " prov-val" : ""}`.trim() || undefined} title={`${formatDecimalEs(f.value, 2)}${label ? ` — ${label}` : ""}`} aria-label={label ? `${formatDecimalEs(f.value, digits)}. ${label}` : undefined}>
      {formatDecimalEs(f.value, digits)}{prov ? "*" : ""}
    </span>
  );
}
function Dev({ f }: { f: Formula | null }) {
  if (!f) return <Dash reason="No calculable para este periodo." />;
  if (f.value === null) return <Dash reason={FORMULA_REASON(f, "No calculable con los datos cargados.")} partial={f.status === "PARTIAL"} />;
  return <span className={devClass(f.value)} title={f.provisional ? `Provisional. ${f.reason ?? ""}` : "Positivo = peor rendimiento que la referencia"}>{pct(f.value)}{f.provisional ? "*" : ""}</span>;
}

function Cell({ r, pk, col, target, factors }: { r: PortfolioRow; pk: PeriodKey; col: ColKey; target: string; factors: BandFactors }): ReactNode {
  const p = r.periods[pk];
  switch (col) {
    case "hours": return <span title={`${formatDecimalEs(p.hours.inPerimeter, 2)} h`}>{fh(p.hours.inPerimeter)}</span>;
    case "revenue": return <Money a={p.revenue} />;
    case "perDay": return <Ratio f={p.perDay} target={target} factors={factors} />;
    case "devTarget": return <Dev f={p.deviationVsTarget} />;
    case "devPortfolio": return <Dev f={p.deviationVsPortfolio} />;
    case "stock": return p.users.stock.value === null ? <Dash reason="Usuarios del corte sin informar en la matriz de usuarios." /> : <>{formatDecimalEs(String(p.users.stock.value), 0)}</>;
    case "tariff": return p.perUserPerYear.value === null ? <Dash reason={FORMULA_REASON(p.perUserPerYear, "No calculable: faltan usuarios o ingreso.")} /> : <span title={formatDecimalEs(p.perUserPerYear.value, 2)}>{f0(p.perUserPerYear.value)}</span>;
  }
}

/** «Mixto» corto cuando los Clientes del Grupo difieren; el detalle se explica al pasar el puntero o enfocar. */
function Meta({ c }: { c: MetaCell }) {
  if (c.values.length === 0) return <Dash reason="Soporte/servidor sin informar en los maestros de Clientes." />;
  if (c.heterogeneous) {
    const detail = `Los Clientes del Grupo tienen valores distintos: ${c.values.map(label).join(", ")}.`;
    return <span className="mixto" tabIndex={0} title={detail} aria-label={`Mixto. ${detail}`}>Mixto</span>;
  }
  return <>{label(c.values[0])}</>;
}

export function ComparativeTable({ view, base }: { view: PortfolioView; base: string }) {
  const q = view.query;
  const defs = view.economics.periodsDefinition;
  const pf = view.economics.portfolio;
  const targetStr = view.economics.settings.targetEurosPerDay;
  const factors = view.economics.settings.bandFactors;
  const sortHref = (key: string) => `${base}${qs(comparativaParams({ ...q, page: 1, sort: key, dir: q.sort === key && q.dir === "asc" ? "desc" : "asc" }))}`;
  const arrow = (key: string) => (q.sort === key ? (q.dir === "asc" ? " ▲" : " ▼") : "");
  const ariaSort = (key: string): "ascending" | "descending" | "none" => (q.sort === key ? (q.dir === "asc" ? "ascending" : "descending") : "none");
  const sortTh = (k: string, children: ReactNode, cls?: string) => (
    <th key={k} scope="col" className={cls} aria-sort={ariaSort(k)}><Link href={sortHref(k)} title="Ordenar (los vacíos van siempre al final)" prefetch={false}>{children}{arrow(k)}</Link></th>
  );
  const ficha = (r: PortfolioRow) =>
    `/analisis-cliente${qs({ ambito: "group", id: r.meta.id, fecha: q.date, modo: q.mode, soporte: q.support.join(",") || undefined, servidor: q.hosting.join(",") || undefined, volver: qs({ ...comparativaParams({ ...q, page: view.page }), fecha: q.date, modo: q.mode }).slice(1) })}`;

  function totalCell(k: PeriodKey, col: ColKey): ReactNode {
    const p = pf?.[k];
    if (!p) return <Dash reason="Sin cartera calculable." />;
    const t = view.totals[k];
    switch (col) {
      case "hours": return <span title={`${formatDecimalEs(p.hours, 2)} h`}>{fh(p.hours)}</span>;
      case "revenue": return p.revenue === null ? <Dash reason="Ningún Grupo del filtrado tiene ingreso conocido." /> : p.groupsUnknownIncome > 0 ? <span title={`${formatDecimalEs(p.revenue, 2)} € · ${p.groupsUnknownIncome} grupo(s) sin ingreso conocido no suman`}>{f0(p.revenue)}*</span> : <span title={`${formatDecimalEs(p.revenue, 2)} €`}>{f0(p.revenue)}</span>;
      case "perDay":
        if (p.perDay.value !== null) return <span title={`ΣR/ΣH × jornada = ${formatDecimalEs(p.perDay.value, 2)}${p.complete ? "" : ` — ${p.perDay.reason ?? ""}`}`}>{formatDecimalEs(p.perDay.value, 0)}{p.complete ? "" : "*"}</span>;
        return <Dash reason={p.perDay.reason ?? "Sin ratio de cartera."} />;
      case "devTarget":
        return p.deviationVsTarget.value !== null ? <span className={devClass(p.deviationVsTarget.value)} title={p.deviationVsTarget.reason ?? undefined}>{pct(p.deviationVsTarget.value)}{p.complete ? "" : "*"}</span> : <Dash reason={p.deviationVsTarget.reason ?? "Sin ratio de cartera."} />;
      case "devPortfolio": return <Dash reason="La media filtrada es la propia referencia del total: no se compara consigo misma." />;
      case "stock": return t.users === null ? <Dash reason="Ningún Grupo del filtrado tiene usuarios informados al corte." /> : t.usersMissing > 0 ? <span title={`Suma de los usuarios informados; ${t.usersMissing} grupo(s) sin dato no suman.`}>{formatDecimalEs(t.users, 0)}*</span> : <>{formatDecimalEs(t.users, 0)}</>;
      case "tariff": return t.tariff === null ? <Dash reason="Ningún Grupo del filtrado tiene tarifa calculable." /> : <span title={t.tariffMissing > 0 ? `12 × ΣR / Σ usuarios·mes de los ${t.groups - t.tariffMissing} grupos con tarifa; ${t.tariffMissing} no aportan.` : "12 × ΣR / Σ usuarios·mes"}>{f0(t.tariff)}{t.tariffMissing > 0 ? "*" : ""}</span>;
    }
  }

  const blocks = PERIOD_BLOCKS;
  return (
    <div className="cmp-scroll cmp2-scroll" tabIndex={0} role="region" aria-label="Tabla comparativa de la cartera, desplazable">
      <table className="cmp2">
        <colgroup>
          {ID_W.map((w, i) => <col key={`id${i}`} style={{ width: w }} />)}
          {PERIOD_BLOCKS.flatMap((b) => COLS[BLOCK_PERIOD[b]].map((c) => <col key={`${b}-${c}`} style={{ width: COL_W[c] }} />))}
        </colgroup>
        <caption className="visually-hidden">Comparativa por Grupo Cliente: una fila por Grupo, con mes seleccionado, mes anterior, año actual acumulado, año anterior completo y acumulado anterior comparable. Desviación positiva: peor rendimiento.</caption>
        <thead>
          <tr className="groups">
            <th scope="colgroup" colSpan={3} className="sticky-col">Identificación</th>
            {blocks.map((b) => {
              const pk = BLOCK_PERIOD[b];
              return <th key={b} scope="colgroup" colSpan={COLS[pk].length} className="blk">{BLOCK_TITLE[b]}<span className="blk-dates">{fdm(defs[pk].from)} – {fdm(defs[pk].to)}</span></th>;
            })}
          </tr>
          <tr className="cols">
            {sortTh("name", "Cliente (Grupo BC)", "sticky-col")}
            {sortTh("support", "Soporte")}
            {sortTh("hosting", "Servidor")}
            {blocks.flatMap((b) => COLS[BLOCK_PERIOD[b]].map((c, i) => sortTh(`${BLOCK_PERIOD[b]}.${c}`, HEAD[c], `num${i === 0 ? " blk-start" : ""}`)))}
          </tr>
        </thead>
        <tbody>
          {view.rows.map((r) => (
            <tr key={r.meta.id} className={r.meta.isActive ? undefined : "inactive-row"}>
              <th scope="row" className="sticky-col name"><Link href={ficha(r)} title={`${r.meta.name} — abrir Análisis Cliente`} prefetch={false}>{r.meta.name}</Link></th>
              <td className="meta"><Meta c={r.meta.support} /></td>
              <td className="meta"><Meta c={r.meta.hosting} /></td>
              {blocks.flatMap((b) => {
                const k = BLOCK_PERIOD[b];
                return COLS[k].map((c, i) => <td key={`${b}-${c}`} className={`num${i === 0 ? " blk-start" : ""}`}><Cell r={r} pk={k} col={c} target={targetStr} factors={factors} /></td>);
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="sticky-col name" title="Totales de todo el filtrado, no solo de esta página. Rentabilidad y desviaciones salen de los componentes agregados (ΣR/ΣH), nunca de sumar o promediar porcentajes.">Total filtrado ({view.filteredGroups} {view.filteredGroups === 1 ? "grupo" : "grupos"})</th>
            <td className="meta" />
            <td className="meta" />
            {blocks.flatMap((b) => {
              const k = BLOCK_PERIOD[b];
              return COLS[k].map((c, i) => <td key={`${b}-${c}`} className={`num${i === 0 ? " blk-start" : ""}`}>{totalCell(k, c)}</td>);
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
