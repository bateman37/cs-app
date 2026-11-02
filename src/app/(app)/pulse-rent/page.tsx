import { ExportPanel } from "@/components/exports/export-panel";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { parsePulseQuery, pulseToParams, PERIOD_LABEL, SCOPE_LABEL } from "@/domain/pulse-query";
import { qs, type SearchParams } from "@/lib/format";
import { Notice, Pager, fdate, eur } from "@/components/analytics/ui";
import { formatDecimalEs } from "@/lib/money";
import { getActive } from "@/server/pulse/config";
import { getPulse, type PulseView } from "@/server/pulse/service";
import { Controls } from "./controls";
import { PulseTable } from "./table";
import { Distribution } from "./distribution";
import { Explain } from "./explain";
import { BandLegend } from "@/components/pulse/ui";

export const metadata: Metadata = { title: "Pulse Rent" };
export const dynamic = "force-dynamic";
const BASE = "/pulse-rent";

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { query, invalid } = parsePulseQuery(sp);
  const products = (await prisma.product.findMany({ select: { name: true }, orderBy: { name: "asc" } })).map((p) => p.name);
  const cfg = await getActive(prisma, "PULSE", query.pulseRevision ?? undefined).catch(() => null);
  let view: PulseView | null = null;
  let error: string | null = null;
  try {
    view = await getPulse(user.id, query);
  } catch (e) {
    error = e instanceof Error ? e.message : "Error inesperado al calcular Pulse Rent.";
  }
  const params = pulseToParams(query);
  const csv = (tabla: string) => `/api/analitica/pulse.csv${qs({ ...params, pagina: undefined, tabla })}`;
  const isAdmin = user.role === "ADMIN";
  const stale = view && query.base.stamp && query.base.stamp !== view.stamp;
  return (
    <>
      <h1>Pulse Rent</h1>
      <p className="muted">
        Cuánta carga de soporte, PAP y escalados genera cada cliente <strong>por usuario</strong>, comparada con una <strong>referencia estadística explícita</strong>. Las bandas son descriptivas (carga y rendimiento económico); no son por sí solas una valoración de la calidad del cliente ni un séptimo indicador.
      </p>
      {invalid.length > 0 ? <Notice kind="warn">Se han ignorado parámetros no válidos de la dirección ({invalid.join(", ")}); se usan los valores iniciales.</Notice> : null}
      <Controls q={query} products={products} references={cfg?.payload.references ?? []} basePath={BASE} />
      {error ? <Notice kind="error"><strong>No se pudo calcular Pulse Rent.</strong> {error} <Link href={`${BASE}${qs(params)}`}>Reintentar</Link> · <Link href={BASE}>Restablecer</Link></Notice> : null}
      {view ? (
        <>
          <div className="card" aria-label="Contexto del cálculo">
            <dl className="kv">
              <dt>Ámbito y periodo</dt><dd>{SCOPE_LABEL[query.scope]} · {PERIOD_LABEL[query.period]} ({fdate(view.period.from)} – {fdate(view.period.to)}) · corte efectivo {fdate(view.cut)}{view.period.provisional ? <> <span className="badge badge-warn">provisional</span></> : null}</dd>
              <dt>Normalización</dt><dd>{query.historic ? "Equivalencia histórica de horas (supone usuarios constantes y meses completos; no sustituye la normalización correcta)" : query.norm === "anual" ? "Equivalente anual: horas 12·H/UM por usuario; eventos 1200·E/UM por 100 usuarios (UM = usuarios mes; no es una predicción ni una tarifa contractual)" : query.norm === "periodo" ? "Del periodo: H/UM por usuario y mes; 100·E/UM por 100 usuarios y mes" : "Bruto del periodo (sin normalizar)"}</dd>
              <dt>Referencia estadística</dt><dd><strong>{view.reference.label}</strong> <span className={`badge ${view.reference.origin === "CONFIRMADA" ? "badge-ok" : "badge-int"}`}>{view.reference.origin === "CONFIRMADA" ? "confirmada" : "personalizada"}</span> — {view.reference.description} {view.reference.members} entidad(es) del ámbito; metadatos al {fdate(view.reference.metadataCut)}.</dd>
              <dt>Filas</dt><dd>{view.filteredEntities} de {view.totalEntities} visibles con los filtros de filas (no cambian la referencia)</dd>
              <dt>Revisiones</dt><dd>Pulse Rent {view.config.revisionNo}{view.config.persisted ? "" : " (inicial)"} · economía {view.manifest.economic} · Calidad {view.manifest.quality} · motor {view.engineVersion} · datos <code>{view.stamp}</code> · leído {new Date(view.readAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}</dd>
            </dl>
          </div>
          {stale ? <Notice kind="warn">Los datos han cambiado desde el enlace con el que llegó aquí: esto es una <strong>nueva lectura</strong>, no la pantalla anterior.</Notice> : null}
          {view.notes.map((n) => <Notice key={n} kind="info">{n}</Notice>)}
          {view.reference.exclusions.length > 0 ? <p className="hint">Fuera de la referencia por criterios ({view.reference.exclusions.reduce((s, e) => s + e.count, 0)} grupos): {view.reference.exclusions.slice(0, 6).map((e) => `${e.reason} (${e.count})`).join(" · ")}.</p> : null}
          {view.unconfiguredProfiles.length > 0 ? (
            <Notice kind="warn">
              Perfiles sin configurar: <strong>{view.unconfiguredProfiles.join(", ")}</strong>. Sus métricas muestran «Perfil sin configurar» (no un cero).{" "}
              {isAdmin ? <Link href="/administracion/configuracion?seccion=pulse">Configurar perfiles en Administración</Link> : "Un Administrador puede resolverlo en Administración › Configuración."}
            </Notice>
          ) : null}
          {view.economicReference ? (
            <div className="card" aria-label="Referencia económica">
              <h2>Referencia económica (cartera)</h2>
              <p className="muted">
                Grupos de «{view.economicReference.label}» ({view.economicReference.groups}). Ratio económico <strong>ΣR/ΣH × jornada</strong> de grupos completos; la media aritmética de los €/jornada de los clientes es otra cosa.
              </p>
              <dl className="kv">
                <dt>Cartera</dt>
                <dd>{view.economicReference.portfolio.perDay !== null ? <strong>{formatDecimalEs(view.economicReference.portfolio.perDay, 2)} €/jornada</strong> : <span className="badge badge-warn">no se publica como completa</span>} {view.economicReference.portfolio.reason && view.economicReference.portfolio.perDay === null ? view.economicReference.portfolio.reason : ""}</dd>
                <dt>Ingreso y horas</dt><dd>{view.economicReference.portfolio.revenue === null ? "—" : eur(view.economicReference.portfolio.revenue)} · {formatDecimalEs(view.economicReference.portfolio.hours, 2)} h</dd>
                <dt>Media aritmética de ratios</dt><dd>{view.economicReference.meanOfRatios === null ? "—" : `${formatDecimalEs(view.economicReference.meanOfRatios, 2)} €/jornada`} (no es la cartera)</dd>
              </dl>
            </div>
          ) : null}
          {view.totalEntities === 0 ? (
            <div className="empty">
              <p><strong>Aún no hay {{ group: "Grupos Cliente", client: "Clientes", implementation: "implantaciones" }[query.scope]}.</strong> Pulse Rent se rellena con los maestros y las cargas; no muestra datos de muestra.</p>
              {isAdmin ? <p><Link href="/administracion/clientes">Maestros</Link> · <Link href="/administracion/cargas">Cargas</Link></p> : <p className="muted">Pida a un Administrador que cargue los maestros y las fuentes.</p>}
            </div>
          ) : (
            <>
              <div className="quick" style={{ margin: "0.5rem 0" }}>
                <a className="btn btn-secondary" href={csv("filas")} download>CSV de las {view.filteredEntities} filas filtradas</a>
                <a className="btn btn-secondary" href={csv("estadisticas")} download>CSV de estadísticas de la referencia</a>
                <a className="btn btn-secondary" href={csv("criterios")} download>CSV de criterios y método</a>
                <span className="hint">Exporta todas las filas filtradas (no solo la página), con valores, estados, bandas en texto, N, corte, método y revisión.</span>
              </div>
              <details className="chart-table" open>
                <summary>Leyenda de bandas</summary>
                <p className="muted">Magnitudes de carga (menor = menor carga):</p><BandLegend direction="LOWER" />
                <p className="muted">€/jornada y tarifa (mayor = mejor rendimiento económico):</p><BandLegend direction="HIGHER" />
                <p className="hint">Las desviaciones conservan su signo (positivo = por debajo del objetivo/cartera). Las horas brutas y el stock de usuarios son contexto, sin juicio. Un valor parcial, ausente o sin referencia nunca se colorea.</p>
              </details>
              {view.filteredEntities === 0 ? (
                <div className="empty"><p><strong>Sin coincidencias.</strong> Ninguna fila cumple los filtros (la referencia no ha cambiado).</p><p><Link href={BASE}>Restablecer</Link></p></div>
              ) : (
                <>
                  <PulseTable view={view} />
                  <Pager base={BASE} params={{ ...params, pagina: undefined }} page={view.page} pageCount={view.pageCount} total={view.filteredEntities} noun="filas" />
                </>
              )}
              <Distribution view={view} />
              <Explain view={view} />
            </>
          )}
        </>
      ) : null}
      {view ? <ExportPanel userId={user.id} scope={query.scope === "group" ? "group" : "client"} sel="" from={`${view.cut.slice(0, 4)}-01-01`} to={view.cut} service="TOTAL" stamp={view.stamp} /> : null}
      <p className="hint">Interpretaciones pendientes de aceptación (no cambian por este módulo): ZDT 11–13, ZTM 06–08, lista de origen PAP, estados de bugs, signo de «Diferencia» y tratamiento de Silver. Sin evidencia de facturación, los PAP evolutivos no se califican como no facturables.</p>
    </>
  );
}
