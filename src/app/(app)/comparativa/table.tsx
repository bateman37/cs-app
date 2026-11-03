import Link from "next/link";
import { BLOCK_PERIOD, PERIOD_BLOCKS, cohortParams, queryToParams, type PeriodBlock } from "@/domain/analytics-query";
import type { PeriodKey } from "@/server/economics/engine";
import type { MetaCell, PortfolioRow, PortfolioView } from "@/server/analytics/portfolio";
import { Money, Pct, PeriodBadges, Ratio, fdate, label } from "@/components/analytics/ui";
import { formatDecimalEs } from "@/lib/money";
import { qs } from "@/lib/format";

const BLOCK_TITLE: Record<PeriodBlock, string> = { mes: "Mes seleccionado", anterior: "Mes anterior completo", cum: "CUM del año seleccionado", anioant: "Año anterior completo", cumant: "CUM anterior comparable" };
const COLS: Record<PeriodKey, { key: string; head: string; sort: string }[]> = {
  month: [{ key: "hours", head: "Horas", sort: "hours" }, { key: "revenue", head: "Ingreso imputado (€)", sort: "revenue" }, { key: "perDay", head: "€/jornada dedicada", sort: "perDay" }, { key: "devTarget", head: "Desv. objetivo", sort: "devTarget" }, { key: "devPortfolio", head: "Desv. cartera", sort: "devPortfolio" }],
  prevMonth: [{ key: "hours", head: "Horas", sort: "hours" }, { key: "revenue", head: "Ingreso imputado (€)", sort: "revenue" }, { key: "perDay", head: "€/jornada dedicada", sort: "perDay" }],
  cum: [{ key: "hours", head: "Horas", sort: "hours" }, { key: "revenue", head: "Ingreso imputado (€)", sort: "revenue" }, { key: "stock", head: "Usuarios al corte", sort: "stock" }, { key: "avgUsers", head: "Usuarios medios", sort: "avgUsers" }, { key: "perDay", head: "€/jornada dedicada", sort: "perDay" }, { key: "devTarget", head: "Desv. objetivo", sort: "devTarget" }, { key: "devPortfolio", head: "Desv. cartera", sort: "devPortfolio" }],
  prevYear: [{ key: "hours", head: "Horas", sort: "hours" }, { key: "revenue", head: "Ingreso imputado (€)", sort: "revenue" }, { key: "perDay", head: "€/jornada dedicada", sort: "perDay" }],
  prevCum: [{ key: "hours", head: "Horas", sort: "hours" }, { key: "revenue", head: "Ingreso imputado (€)", sort: "revenue" }, { key: "perDay", head: "€/jornada dedicada", sort: "perDay" }],
};

export const metaLabel = (c: MetaCell): string => (c.values.length === 0 ? "sin informar" : c.heterogeneous ? `heterogéneo: ${c.values.map(label).join(" / ")}` : label(c.values[0]));

function Meta({ c }: { c: MetaCell }) {
  if (c.values.length === 0) return <span className="muted">sin informar</span>;
  return (
    <>
      {c.heterogeneous ? <span className="badge badge-warn">heterogéneo</span> : null} {c.values.map(label).join(" / ")}
      {c.source === "clients" ? <small className="muted block">de sus Clientes ({c.clientsWith}/{c.clientsTotal} con dato)</small> : null}
    </>
  );
}

function Cell({ r, pk, col }: { r: PortfolioRow; pk: PeriodKey; col: string }) {
  const p = r.periods[pk];
  switch (col) {
    case "hours": return <>{formatDecimalEs(p.hours.inPerimeter, 2)}</>;
    case "revenue": return <Money a={p.revenue} />;
    case "perDay": return <Ratio f={p.perDay} />;
    case "devTarget": return <Pct f={p.deviationVsTarget} />;
    case "devPortfolio": return <Pct f={p.deviationVsPortfolio} />;
    case "stock": return <>{p.users.stock.value ?? <span className="muted">sin informar</span>}</>;
    case "avgUsers": return p.users.averageUsers !== null ? <>{formatDecimalEs(p.users.averageUsers, 2)}</> : <span className="muted" title="Algún mes del periodo sin informar">incompleto</span>;
  }
  return null;
}

export function ComparativeTable({ view, base }: { view: PortfolioView; base: string }) {
  const q = view.query;
  const defs = view.economics.periodsDefinition;
  const pf = view.economics.portfolio;
  const blocks = PERIOD_BLOCKS.filter((b) => q.blocks.includes(b));
  const sortHref = (key: string) => `${base}${qs({ ...queryToParams({ ...q, page: 1, sort: key, dir: q.sort === key && q.dir === "asc" ? "desc" : "asc" }) })}`;
  const arrow = (key: string) => (q.sort === key ? (q.dir === "asc" ? " ▲" : " ▼") : "");
  const ariaSort = (key: string) => (q.sort === key ? (q.dir === "asc" ? "ascending" : "descending") : "none");
  const sortTh = (k: string, children: React.ReactNode, cls?: string) => (
    <th key={k} scope="col" className={cls} aria-sort={ariaSort(k)}><Link href={sortHref(k)} title="Ordenar (los vacíos van siempre al final)">{children}{arrow(k)}</Link></th>
  );
  const toggle = (b: PeriodBlock) => {
    const next = q.blocks.includes(b) ? q.blocks.filter((x) => x !== b) : [...q.blocks, b];
    return `${base}${qs(queryToParams({ ...q, blocks: next.length ? PERIOD_BLOCKS.filter((x) => next.includes(x)) : q.blocks }))}`;
  };
  const ficha = (r: PortfolioRow) =>
    `/analisis-cliente${qs({ ambito: "group", id: r.meta.id, ...cohortParams(q), volver: qs(queryToParams(q)).slice(1) })}`;
  return (
    <>
      <div className="block-toggles" role="group" aria-label="Bloques de periodo visibles">
        <strong>Bloques:</strong>
        {PERIOD_BLOCKS.map((b) => (
          <Link key={b} href={toggle(b)} aria-pressed={q.blocks.includes(b)} title={q.blocks.includes(b) ? "Ocultar bloque" : "Mostrar bloque"}>{BLOCK_TITLE[b]}</Link>
        ))}
      </div>
      <div className="cmp-scroll" tabIndex={0} role="region" aria-label="Tabla comparativa de la cartera (desplazable)">
        <table className="cmp">
          <caption className="hint" style={{ textAlign: "left", padding: "0.3rem 0.6rem" }}>
            Una fila por Grupo Cliente (BC). Ingreso imputado = facturado + potencial anual distribuido linealmente (anual/12 × días/días del mes); no son facturas mensuales reales. Desviación positiva = rendimiento por debajo (del objetivo o de la cartera filtrada).
          </caption>
          <thead>
            <tr className="groups">
              <th scope="colgroup" colSpan={6} className="sticky-col" style={{ textAlign: "left" }}>Identificación</th>
              {blocks.map((b) => {
                const pk = BLOCK_PERIOD[b];
                return <th key={b} scope="colgroup" colSpan={COLS[pk].length}>{BLOCK_TITLE[b]} · {fdate(defs[pk].from)} – {fdate(defs[pk].to)} {view.economics.periodsDefinition[pk].provisional ? <span className="badge badge-warn">provisional</span> : null}</th>;
              })}
            </tr>
            <tr className="cols">
              {sortTh("name", "Grupo Cliente (BC)", "sticky-col")}
              {sortTh("support", "Plan de soporte")}
              <th scope="col">CLOUD / OP</th><th scope="col">Producto(s)</th><th scope="col">Complejidad</th><th scope="col">Estado y cobertura</th>
              {blocks.flatMap((b) => COLS[BLOCK_PERIOD[b]].map((c) => sortTh(`${BLOCK_PERIOD[b]}.${c.sort}`, c.head, "num")))}
            </tr>
          </thead>
          <tbody>
            {pf ? (
              <tr style={{ fontWeight: 600 }}>
                <th scope="row" className="sticky-col">Cartera filtrada ({view.filteredGroups} grupos){" "}<small className="muted block">Ratio ponderado ΣR/ΣH×jornada, no media de ratios</small></th>
                <td colSpan={5} className="muted">Todos los grupos filtrados, antes de paginar</td>
                {blocks.flatMap((b) => {
                  const k = BLOCK_PERIOD[b];
                  const pp = pf[k];
                  return COLS[k].map((c) => (
                    <td key={`${b}-${c.key}`} className="num">
                      {c.key === "hours" ? formatDecimalEs(pp.hours, 2) : c.key === "revenue" ? (pp.revenue === null ? "—" : formatDecimalEs(pp.revenue, 2)) : c.key === "perDay" ? <Ratio f={pp.perDay} /> : c.key === "devTarget" ? <Pct f={pp.deviationVsTarget} /> : null}
                    </td>
                  ));
                })}
              </tr>
            ) : null}
            {view.rows.map((r) => (
              <tr key={r.meta.id} className={r.meta.isActive ? undefined : "inactive-row"}>
                <th scope="row" className="sticky-col">
                  <Link href={ficha(r)}>{r.meta.name}</Link>
                  {r.meta.bcDenomination && r.meta.bcDenomination !== r.meta.name ? <small className="muted block">BC: {r.meta.bcDenomination}</small> : null}
                  <small className="muted block">{r.meta.clients} Cliente(s) · {r.meta.implementations} implantación(es)</small>
                </th>
                <td><Meta c={r.meta.support} /></td>
                <td><Meta c={r.meta.hosting} /></td>
                <td><Meta c={r.meta.product} /></td>
                <td><Meta c={r.meta.complexity} /></td>
                <td>
                  <span className={`badge ${r.meta.isActive ? "badge-ok" : "badge-off"}`}>{r.meta.isActive ? "activo" : "inactivo"}</span>{" "}
                  <span className={`badge ${r.meta.coverage === "completa" ? "badge-ok" : "badge-warn"}`}>cobertura {r.meta.coverage.replace("_", " ")}</span>
                </td>
                {blocks.flatMap((b) => {
                  const k = BLOCK_PERIOD[b];
                  return COLS[k].map((c, i) => (
                    <td key={`${b}-${c.key}`} className="num">
                      <Cell r={r} pk={k} col={c.key} />
                      {i === 0 ? <PeriodBadges p={r.periods[k]} /> : null}
                    </td>
                  ));
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Los números se alinean a la derecha; «—» o una etiqueta indica un dato desconocido o no calculable (nunca un cero).</p>
    </>
  );
}

