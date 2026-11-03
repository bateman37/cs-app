import type { Metadata } from "next";
import Link from "next/link";
import { ExportPanel } from "@/components/exports/export-panel";
import { requirePageUser } from "@/lib/session";
import { parseAnalysisQuery, parseEntityRef, type AnalysisQuery } from "@/domain/analytics-query";
import { commonFiltersToParams, parseCommonFilters, type CommonFilters } from "@/domain/filtros-comunes";
import { lastDayOfMonth } from "@/domain/finance";
import { todayMadrid } from "@/domain/vigencia";
import { first, qs, sanitizeBack, type SearchParams } from "@/lib/format";
import { getFicha, searchEntitiesView, type FichaView } from "@/server/analytics/ficha";
import { Notice, Pager } from "@/components/analytics/ui";
import { BACK_KEYS, BASE, fichaUrl, periodParams, type Nav } from "./links";
import { Detail, isDetailKind } from "./detalle";
import { Head, Summary } from "./ficha-head";
import { ChartsZone } from "./ficha-charts";
import { EquipoCard, ProblemaCard, TicketCard } from "./ficha-tables";
import { dmy } from "./ficha-format";
import "./ficha.css";

export const metadata: Metadata = { title: "Análisis Cliente" };
export const dynamic = "force-dynamic";

const TYPE_LABEL = { group: "Grupo Cliente", client: "Cliente", implementation: "Implantación" } as const;
const MILESTONE = { START: "Arranque", CLOUD_MIGRATION: "Migración a CLOUD", MAJOR_VERSION: "Cambio mayor de versión" } as Record<string, string>;

/** `mes=AAAA-MM` (control de periodo) → fecha de análisis: hoy si es el mes en curso; si no, el último día de ese mes. */
function applyMonth(query: AnalysisQuery, mes: string, today: string): AnalysisQuery {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(mes);
  if (!m) return query;
  const y = Number(m[1]); const mo = Number(m[2]);
  const date = mes === today.slice(0, 7) ? today : `${y}-${m[2]}-${String(lastDayOfMonth(y, mo)).padStart(2, "0")}`;
  return { ...query, date };
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const today = todayMadrid();
  const parsed = parseAnalysisQuery(sp).query;
  const query = applyMonth(parsed, first(sp.mes), today);
  const filters: CommonFilters = parseCommonFilters(sp);
  const back = sanitizeBack(first(sp.volver), BACK_KEYS);
  const ref = parseEntityRef(first(sp.ambito), first(sp.id));
  const nav: Nav = { query, filters, back };
  return (
    <div className="fc-root">
      {ref ? <FichaPage userId={user.id} isAdmin={user.role === "ADMIN"} nav={nav} target={ref} hasBack={Boolean(back || first(sp.volver))} sp={sp} /> : <Selector userId={user.id} nav={nav} sp={sp} />}
    </div>
  );
}

async function Selector({ userId, nav, sp }: { userId: string; nav: Nav; sp: SearchParams }) {
  const text = first(sp.buscar).slice(0, 100);
  const bp = Math.max(1, Number(first(sp.bp)) || 1);
  const r = await searchEntitiesView(userId, text, bp).catch(() => null);
  const keep = { ...periodParams(nav.query), ...commonFiltersToParams(nav.filters) };
  return (
    <>
      <h1 className="fc-title" style={{ margin: "6px 0 8px" }}>Análisis Cliente</h1>
      <form method="get" action={BASE} className="fc-period" aria-label="Buscar objeto" style={{ marginBottom: 8 }}>
        {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <label htmlFor="buscar">Grupo, Cliente o implantación</label>
        <input id="buscar" type="search" name="buscar" defaultValue={text} maxLength={100} style={{ font: "inherit", padding: "2px 6px", border: "1px solid var(--border)", borderRadius: 4, minWidth: 240 }} />
        <button className="fc-btn" type="submit">Buscar</button>
      </form>
      {!r ? <Notice kind="error">No se pudo leer la lista. <Link href={BASE}>Reintentar</Link></Notice> : r.total === 0 ? (
        <p className="fc-note">{text ? <>Sin coincidencias para «{text}».</> : <>Todavía no hay Grupos Cliente, Clientes ni implantaciones. Un Administrador puede crearlos en <Link href="/administracion/clientes/grupos">Administración › Clientes</Link>.</>}</p>
      ) : (
        <>
          <div className="fc-tcard">
            <div className="fc-scroll">
              <table className="fc-tbl">
                <caption className="fc-sr">Resultados</caption>
                <thead><tr><th scope="col" className="fc-l">Tipo</th><th scope="col" className="fc-l">Nombre</th><th scope="col" className="fc-l">Pertenece a</th><th scope="col" className="fc-l">Estado</th></tr></thead>
                <tbody>{r.rows.map((x) => (
                  <tr key={`${x.type}-${x.id}`}>
                    <td className="fc-l">{TYPE_LABEL[x.type]}</td>
                    <td className="fc-l"><Link href={fichaUrl(nav, { type: x.type, id: x.id })}>{x.name}</Link></td>
                    <td className="fc-l">{x.parent ?? "—"}</td>
                    <td className="fc-l">{x.isActive ? "activo" : "inactivo"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
          <Pager base={BASE} params={{ ...keep, buscar: text || undefined }} page={bp} pageCount={Math.max(1, Math.ceil(r.total / 25))} total={r.total} noun="objetos" param="bp" />
        </>
      )}
    </>
  );
}

async function FichaPage({ userId, isAdmin, nav, target, hasBack, sp }: { userId: string; isAdmin: boolean; nav: Nav; target: { type: "group" | "client" | "implementation"; id: string }; hasBack: boolean; sp: SearchParams }) {
  let f: FichaView | null = null;
  let error: string | null = null;
  try {
    f = await getFicha(userId, nav.query, target);
  } catch (e) {
    error = e instanceof Error ? e.message : "Error inesperado al leer la ficha.";
  }
  const self = fichaUrl(nav, target);
  if (error) return <Notice kind="error"><strong>No se pudo leer la ficha.</strong> {error} <Link href={self}>Reintentar</Link> · <Link href={BASE}>Elegir otro objeto</Link></Notice>;
  if (!f) return <div className="fc-empty" style={{ minHeight: 120 }}><p><strong>Objeto no encontrado.</strong> <Link href={BASE}>Buscar otro</Link></p></div>;

  const detKind = first(sp.det);
  if (detKind === "exportar" && target.type !== "implementation") {
    return (
      <>
        <p><Link className="fc-back" href={self}>← Volver a la ficha</Link></p>
        <ExportPanel userId={userId} scope={target.type} sel={target.id} selName={f.context.name} from={`${f.cut.slice(0, 4)}-01-01`} to={f.cut} service={nav.query.service} stamp={f.economics.reference.dataStamp.stamp} />
      </>
    );
  }
  if (detKind && isDetailKind(detKind)) {
    return <Detail actorId={userId} f={f} nav={nav} kind={detKind} period={first(sp.periodo) || "month"} metric={first(sp.metrica)} mode={first(sp.modoh)} page={Math.max(1, Number(first(sp.dpag)) || 1)} isAdmin={isAdmin} />;
  }
  return (
    <>
      <Head f={f} nav={nav} hasBack={hasBack} />
      <Summary f={f} nav={nav} />
      <div className="fc-zones">
        <ChartsZone f={f} nav={nav} />
        <div className="fc-right">
          <div className="fc-pair">
            <EquipoCard f={f} nav={nav} />
            <ProblemaCard f={f} />
          </div>
          <TicketCard f={f} nav={nav} />
        </div>
      </div>
      {f.milestones.length > 0 ? (
        <p className="fc-foot" aria-label="Hitos">
          <span>Hitos:</span>
          {f.milestones.map((m, i) => <span key={i}>{dmy(m.date)} {MILESTONE[m.type] ?? m.type} ({m.scope}: {m.scopeName}){m.note ? ` — ${m.note}` : ""}</span>)}
        </p>
      ) : null}
    </>
  );
}

export { qs };
