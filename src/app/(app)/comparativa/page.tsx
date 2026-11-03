import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { parseComparativaQuery, comparativaParams } from "@/domain/comparativa-query";
import { todayMadrid } from "@/domain/vigencia";
import { type SearchParams, qs } from "@/lib/format";
import { formatDecimalEs } from "@/lib/money";
import { getPortfolio, type PortfolioView } from "@/server/analytics/portfolio";
import { FiltrosComunes } from "@/components/filtros-comunes";
import { PeriodBar } from "./period-bar";
import { ComparativeTable } from "./table";

export const metadata: Metadata = { title: "Comparativa" };
export const dynamic = "force-dynamic";
const BASE = "/comparativa";
const DIAGNOSTICO = "/administracion/conciliacion#diagnostico";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const monthLabel = (iso: string) => `${MESES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { query, filters } = parseComparativaQuery(sp);
  let view: PortfolioView | null = null;
  let error: string | null = null;
  try {
    view = await getPortfolio(user.id, query);
  } catch (e) {
    error = e instanceof Error ? e.message : "Error inesperado al leer la cartera.";
  }
  const params = comparativaParams(query);
  const today = todayMadrid();
  const periodParams = { ...params };
  const isAdmin = user.role === "ADMIN";
  const e = view?.economics;
  const month = e?.periodsDefinition.month;
  const cum = e?.periodsDefinition.cum;
  const pf = e?.portfolio;
  const ratio = (k: "month" | "cum") => {
    const p = pf?.[k];
    if (!p) return "—";
    if (p.perDay.value !== null) return formatDecimalEs(p.perDay.value, 0);
    return p.knownSet.perDay ? `${formatDecimalEs(p.knownSet.perDay, 0)}*` : "—";
  };
  const year = view ? Number(view.cut.slice(0, 4)) : Number(today.slice(0, 4));
  const finPending = (e?.reference.finance ?? []).filter((f) => f.year === year && f.category === "SOPORTE" && f.coverage !== "COMPLETA");
  const pending = Boolean(e && (e.reference.validation.state === "PENDING_RECALC" || finPending.length > 0 || (pf && (!pf.month.complete || !pf.cum.complete))));
  const hrefFor = (next: typeof filters) => `${BASE}${qs(comparativaParams({ ...query, page: 1, support: next.soporte, hosting: next.servidor }))}`;

  return (
    <div className="cmp-page">
      <header className="cmp-head">
        <h1>Comparativa</h1>
        {view && month && cum ? (
          <p className="cmp-sum">
            <span>{monthLabel(month.to)}</span>
            <span aria-hidden="true">·</span>
            <span>Objetivo {formatDecimalEs(e!.settings.targetEurosPerDay, 0)} €/jornada</span>
            <span aria-hidden="true">·</span>
            <span title="Rentabilidad agregada de todo el filtrado: Σ ingreso imputado / Σ horas × jornada. * = conjunto sin los grupos con datos pendientes">Rentabilidad agregada: mes <strong>{ratio("month")}</strong> · CUM <strong>{ratio("cum")}</strong> €/jornada</span>
          </p>
        ) : null}
        {pending ? (
          <span className="pend">
            {isAdmin ? <Link href={DIAGNOSTICO} title="Hay datos sin cargar o sin enlazar que dejan algunas cifras en «—». Abre el diagnóstico con la acción concreta.">Datos pendientes</Link> : <span title="Hay datos sin cargar o sin enlazar que dejan algunas cifras en «—». Pida a un Administrador revisar Administración › Conciliación › Diagnóstico de datos.">Datos pendientes</span>}
          </span>
        ) : null}
      </header>
      <div className="cmp-controls">
        <FiltrosComunes value={filters} hrefFor={hrefFor} />
        <PeriodBar base={BASE} params={periodParams} date={query.date} mode={query.mode} today={today} provisional={Boolean(month?.provisional)} />
      </div>
      {error ? (
        <div className="cmp-error" role="alert">
          <strong>No se pudo leer la cartera.</strong> <span>{error}</span>{" "}
          <Link href={`${BASE}${qs(params)}`} className="btn btn-secondary btn-sm" prefetch={false}>Reintentar</Link>
        </div>
      ) : null}
      {view && view.totalGroups === 0 ? (
        <div className="empty">
          <p><strong>Aún no hay Grupos Cliente.</strong> Esta vista se rellena con los maestros y las cargas.</p>
          {isAdmin ? <p><Link href="/administracion/clientes/grupos">Crear o importar maestros</Link> · <Link href="/administracion/cargas">Cargas</Link></p> : <p className="muted">Pida a un Administrador que cargue los maestros y las fuentes.</p>}
        </div>
      ) : null}
      {view && view.totalGroups > 0 && view.filteredGroups === 0 ? (
        <div className="empty"><p><strong>Sin coincidencias.</strong> Ningún Grupo tiene un Cliente con esa combinación de Soporte y Servidor.</p><p><Link href={`${BASE}${qs({ ...params, soporte: undefined, servidor: undefined })}`}>Quitar la selección</Link></p></div>
      ) : null}
      {view && view.filteredGroups > 0 ? (
        <>
          <ComparativeTable view={view} base={BASE} />
          <div className="cmp-foot">
            <span className="muted">{view.filteredGroups} {view.filteredGroups === 1 ? "grupo" : "grupos"}{view.pageCount > 1 ? ` · página ${view.page} de ${view.pageCount}` : ""} · desviación positiva = peor rendimiento · * total parcial (pase el puntero)</span>
            {view.pageCount > 1 ? (
              <nav className="pager" aria-label="Paginación">
                {view.page > 1 ? <Link href={`${BASE}${qs({ ...params, pagina: view.page > 2 ? view.page - 1 : undefined })}`} rel="prev" prefetch={false}>← Anterior</Link> : <span className="muted">← Anterior</span>}
                {view.page < view.pageCount ? <Link href={`${BASE}${qs({ ...params, pagina: view.page + 1 })}`} rel="next" prefetch={false}>Siguiente →</Link> : <span className="muted">Siguiente →</span>}
              </nav>
            ) : null}
            <a className="btn btn-secondary btn-sm" href={`/api/analitica/comparativa.csv${qs({ ...params, pagina: undefined })}`} download title="Todo el filtrado (no solo la página), mismo periodo, selección y orden que la pantalla">Descargar CSV</a>
          </div>
        </>
      ) : null}
    </div>
  );
}
