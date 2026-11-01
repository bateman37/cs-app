import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { parseAnalysisQuery, queryToParams, type PeriodBlock } from "@/domain/analytics-query";
import { first, qs, type SearchParams } from "@/lib/format";
import { formatDecimalEs } from "@/lib/money";
import { getPortfolio, type PortfolioView } from "@/server/analytics/portfolio";
import { Notice, Pager, Ratio, Pct, fdate, hrs, eur } from "@/components/analytics/ui";
import { Filters } from "./filters";
import { ComparativeTable } from "./table";

export const metadata: Metadata = { title: "Comparativa" };
export const dynamic = "force-dynamic";
const BASE = "/comparativa";
const SERVICE_LABEL = { SOPORTE: "Soporte", ADMIN_DELEGADA: "Administración delegada", OTROS: "Otros", TOTAL: "Total (los tres)" } as const;

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { query, invalid } = parseAnalysisQuery(sp);
  const products = (await prisma.product.findMany({ select: { name: true }, orderBy: { name: "asc" } })).map((p) => p.name);
  let view: PortfolioView | null = null;
  let error: string | null = null;
  try {
    view = await getPortfolio(user.id, query);
  } catch (e) {
    error = e instanceof Error ? e.message : "Error inesperado al leer la cartera.";
  }
  const hidden: Record<string, string> = {};
  if (query.sort !== "name") hidden.orden = query.sort;
  if (query.dir !== "asc") hidden.dir = query.dir;
  if (query.blocks.join() !== "mes,cum") hidden.bloques = query.blocks.join(",");
  if (query.ref !== "mes") hidden.ref = query.ref;
  const isAdmin = user.role === "ADMIN";
  const fresh = view && query.stamp && query.stamp !== view.economics.reference.dataStamp.stamp;
  const params = queryToParams(query);

  return (
    <>
      <h1>Comparativa</h1>
      <p className="muted">
        Cartera económica por <strong>Grupo Cliente (BC)</strong>. El dinero es <strong>ingreso imputado</strong>: facturado + potencial anual distribuido linealmente
        (no son facturas mensuales reales ni beneficio neto). La rentabilidad se expresa en <strong>€/jornada dedicada</strong>.
      </p>
      {invalid.length > 0 ? <Notice kind="warn">Se han ignorado parámetros no válidos de la dirección ({invalid.join(", ")}); se usan los valores iniciales.</Notice> : null}
      <Filters q={query} products={products} basePath={BASE} hidden={hidden} />
      {error ? (
        <Notice kind="error">
          <strong>No se pudo leer la cartera.</strong> {error}{" "}
          <Link href={`${BASE}${qs(params)}`}>Reintentar</Link> · <Link href={BASE}>Restablecer filtros</Link>
        </Notice>
      ) : null}
      {view ? <Body view={view} isAdmin={isAdmin} stale={Boolean(fresh)} params={params} /> : null}
    </>
  );
}

function Body({ view, isAdmin, stale, params }: { view: PortfolioView; isAdmin: boolean; stale: boolean; params: Record<string, string> }) {
  const q = view.query;
  const e = view.economics;
  const pk = q.ref === "mes" ? "month" : "cum";
  const pf = e.portfolio?.[pk];
  const def = e.periodsDefinition[pk];
  const finMissing = e.reference.finance.filter((f) => f.year === Number(view.cut.slice(0, 4)) && (q.service === "TOTAL" || f.category === q.service)).filter((f) => f.coverage !== "COMPLETA");
  const csvHref = `/api/analitica/comparativa.csv${qs({ ...params, pagina: undefined })}`;
  return (
    <>
      <div className="card" aria-label="Contexto del cálculo">
        <dl className="kv">
          <dt>Fecha solicitada</dt><dd>{fdate(q.date)}</dd>
          <dt>Corte efectivo</dt><dd>{fdate(view.cut)} — {q.mode === "FULL_MONTH" ? "mes completo" : "a fecha de corte"}{def.provisional ? " (provisional: no certifica cierre ni inventa horas de días futuros)" : ""}</dd>
          <dt>Método de ingreso</dt><dd>{e.reference.method}</dd>
          <dt>Objetivo y jornada</dt><dd>{eur(e.settings.targetEurosPerDay)}/jornada de {formatDecimalEs(e.settings.dayHours, 0)} h · revisión {e.settings.revisionNo}{e.recalculatedWithOlderSettings ? " (recálculo con una revisión anterior)" : ""}</dd>
          <dt>Servicio</dt><dd>{SERVICE_LABEL[q.service]} (independiente del plan) · motor {e.reference.engineVersion}</dd>
          <dt>Referencia de datos</dt><dd><code>{e.reference.dataStamp.stamp}</code> · leído {new Date(e.reference.readAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}</dd>
        </dl>
      </div>
      {stale ? <Notice kind="warn">Los datos han cambiado desde el enlace con el que llegó aquí (referencia distinta): esto es una <strong>nueva lectura</strong>, no la pantalla anterior.</Notice> : null}
      {e.reference.validation.state === "PENDING_RECALC" ? (
        <Notice kind="warn">
          <strong>Reproceso pendiente.</strong> {e.reference.pendingRecalc.reason ?? "Hay derivados obsoletos."} Las magnitudes se conservan pero se marcan «no validado» hasta que un Administrador reprocese{isAdmin ? <> (<Link href="/administracion/cargas">Cargas</Link>)</> : null}. Visitar esta pantalla no reprocesa nada.
        </Notice>
      ) : null}
      {view.totalGroups === 0 ? (
        <div className="empty">
          <p><strong>Aún no hay Grupos Cliente.</strong> Esta vista se rellena con los maestros y las cargas; no muestra datos de muestra.</p>
          {isAdmin ? <p><Link href="/administracion/clientes/grupos">Crear o importar maestros</Link> · <Link href="/administracion/cargas">Cargas</Link></p> : <p className="muted">Pida a un Administrador que cargue los maestros y las fuentes.</p>}
        </div>
      ) : (
        <>
          {finMissing.length > 0 ? (
            <Notice kind="warn">
              Fuentes financieras sin cobertura completa para {view.cut.slice(0, 4)}: {finMissing.map((f) => `${f.category} (${f.coverage.toLowerCase().replace("_", " ")})`).join(", ")}. El ingreso de esos grupos es <strong>desconocido, no cero</strong>.{" "}
              {isAdmin ? <Link href="/administracion/cargas">Cargar o revisar fuentes</Link> : "Un Administrador puede cargarlas en Administración › Cargas."}
            </Notice>
          ) : null}
          <section aria-label="Resumen de la cartera filtrada">
            <div className="quick" style={{ marginBottom: "0.5rem" }}>
              <strong>Periodo principal de las tarjetas:</strong>
              <Link className="btn btn-secondary btn-sm" aria-current={q.ref === "mes" ? "true" : undefined} href={`${BASE}${qs({ ...params, ref: undefined })}`} style={q.ref === "mes" ? { background: "var(--blue)", color: "#fff" } : undefined}>Mes seleccionado</Link>
              <Link className="btn btn-secondary btn-sm" aria-current={q.ref === "cum" ? "true" : undefined} href={`${BASE}${qs({ ...params, ref: "cum" })}`} style={q.ref === "cum" ? { background: "var(--blue)", color: "#fff" } : undefined}>CUM del año</Link>
              <span className="muted">{fdate(def.from)} – {fdate(def.to)}</span>
            </div>
            {pf ? (
              <div className="cards">
                <div className="card"><div className="stat-label">Grupos del conjunto filtrado</div><div className="stat-value">{view.filteredGroups}<span className="stat-unit"> de {view.totalGroups}</span></div></div>
                <div className="card"><div className="stat-label">Ingreso imputado (conocido)</div><div className="stat-value">{pf.revenue === null ? "—" : formatDecimalEs(pf.revenue, 2)}<span className="stat-unit"> €</span></div>
                  <small className="muted">{pf.groupsUnknownIncome > 0 ? `${pf.groupsUnknownIncome} grupo(s) sin ingreso conocido` : "todos con ingreso conocido"}</small></div>
                <div className="card"><div className="stat-label">Horas dedicadas del periodo</div><div className="stat-value">{formatDecimalEs(pf.hours, 2)}<span className="stat-unit"> h</span></div></div>
                <div className="card"><div className="stat-label">Ratio ponderado de cartera</div>
                  <div className="stat-value">{pf.perDay.value !== null ? <>{formatDecimalEs(pf.perDay.value, 2)}<span className="stat-unit"> €/jornada</span></> : <Ratio f={pf.perDay} />}</div>
                  <small className="muted">Cobertura: {pf.coverage.complete} de {pf.coverage.groups} grupos sin restricción · desviación contra objetivo: <Pct f={pf.deviationVsTarget} /></small></div>
              </div>
            ) : null}
            {pf && !pf.complete && pf.groups > 0 ? (
              <Notice kind="warn">
                <strong>La cartera no se publica como completa.</strong> {pf.perDay.reason}
                <ul>{pf.affected.map((a) => <li key={a.code}>{a.groups} grupo(s) — {a.label} (ingreso afectado {eur(a.income)})</li>)}</ul>
                {pf.knownSet.perDay ? <>Ratio del conjunto sin afectados ({pf.knownSet.groups} grupos, {eur(pf.knownSet.revenue)}, {hrs(pf.knownSet.hours)}): <strong>{formatDecimalEs(pf.knownSet.perDay, 2)} €/jornada</strong> — no es la cartera completa.</> : null}
              </Notice>
            ) : null}
            {pf && pf.zeroHours.count > 0 ? <Notice kind="info">{pf.zeroHours.count} grupo(s) con ingreso confirmado y <strong>sin dedicación registrada</strong> ({eur(pf.zeroHours.income)}): su ingreso permanece en la cartera y no tienen ratio propio.</Notice> : null}
            {e.unattributed && Number(e.unattributed.eligibleHours) > 0 ? <p className="hint">Horas elegibles del CUM sin Grupo Cliente (internos, conflictos y sin ticket), conciliables y no repartidas: {hrs(e.unattributed.eligibleHours)}.</p> : null}
          </section>
          <div className="quick" style={{ margin: "0.75rem 0" }}>
            <a className="btn btn-secondary" href={csvHref} download>Descargar CSV de la cartera filtrada completa ({view.filteredGroups} grupos)</a>
            <span className="hint">UTF-8, separador «;» y decimales con coma (abre en Excel en español); incluye el contexto de cada fila. No es una descarga de hechos brutos (CSAPP-09).</span>
          </div>
          {view.filteredGroups === 0 ? (
            <div className="empty"><p><strong>Sin coincidencias.</strong> Ningún Grupo Cliente cumple los filtros.</p><p><Link href={BASE}>Restablecer filtros</Link></p></div>
          ) : (
            <>
              <ComparativeTable view={view} base={BASE} />
              <Pager base={BASE} params={params} page={view.page} pageCount={view.pageCount} total={view.filteredGroups} noun="grupos" />
            </>
          )}
        </>
      )}
      <p className="hint">Silver Recurrente y Silver On Demand son planes distintos: la rentabilidad mensual recurrente de Silver On Demand no está activada (ECO 08, propuesta pendiente). Interpretaciones ZDT 11–13 y ZTM 06–08, lista de origen PAP, estados de bugs, convención de «Diferencia» y propuestas de Silver siguen pendientes de aceptación (ver docs/decisiones/pendientes.md).</p>
    </>
  );
}

export type { PeriodBlock };
export { first };
