import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { parseAnalysisQuery, parseEntityRef, queryToParams, TAB_VALUES, type AnalysisQuery } from "@/domain/analytics-query";
import { first, qs, sanitizeBack, type SearchParams } from "@/lib/format";
import { formatDecimalEs } from "@/lib/money";
import { getFicha, searchEntitiesView, type FichaView } from "@/server/analytics/ficha";
import { Notice, Pager, fdate, label } from "@/components/analytics/ui";
import { BACK_KEYS, BASE, backHref, fichaHref } from "./links";
import { Detail, isDetailKind } from "./detalle";
import { Charts, PeriodCards } from "./resumen";
import { Datos, Dedicacion, Pap, Tickets } from "./sections";
import { CalidadFicha } from "./calidad";

export const metadata: Metadata = { title: "Análisis Cliente" };
export const dynamic = "force-dynamic";

const TYPE_LABEL = { group: "Grupo Cliente", client: "Cliente", implementation: "Implantación" } as const;
const TAB_LABEL: Record<(typeof TAB_VALUES)[number], string> = { resumen: "Resumen y evolución", dedicacion: "Dedicación", pap: "PAP", tickets: "Tickets y bugs vinculados", datos: "Datos y cobertura" };
const SERVICE_LABEL = { SOPORTE: "Soporte", ADMIN_DELEGADA: "Administración delegada", OTROS: "Otros", TOTAL: "Total (los tres)" } as const;

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { query, invalid } = parseAnalysisQuery(sp);
  const ref = parseEntityRef(first(sp.ambito), first(sp.id));
  const back = sanitizeBack(first(sp.volver), BACK_KEYS);
  return (
    <>
      <h1>Análisis Cliente</h1>
      {invalid.length > 0 ? <Notice kind="warn">Se han ignorado parámetros no válidos de la dirección ({invalid.join(", ")}).</Notice> : null}
      {ref ? <FichaPage userId={user.id} isAdmin={user.role === "ADMIN"} query={query} target={ref} back={back} sp={sp} /> : <Selector userId={user.id} query={query} back={back} sp={sp} />}
    </>
  );
}

async function Selector({ userId, query, back, sp }: { userId: string; query: AnalysisQuery; back: string; sp: SearchParams }) {
  const text = first(sp.buscar).slice(0, 100);
  const bp = Math.max(1, Number(first(sp.bp)) || 1);
  const r = await searchEntitiesView(userId, text, bp).catch(() => null);
  const keep = queryToParams({ ...query, page: 1 });
  return (
    <>
      <p className="muted">Seleccione un <strong>Grupo Cliente</strong>, un <strong>Cliente</strong> o una <strong>implantación</strong>. La búsqueda se hace en el servidor; no se cargan listas enteras en el navegador.</p>
      <form method="get" action={BASE} className="card toolbar" aria-label="Buscar ámbito">
        {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <div className="field"><label htmlFor="buscar">Buscar por nombre</label><input id="buscar" type="search" name="buscar" defaultValue={text} maxLength={100} /></div>
        <button className="btn btn-primary" type="submit">Buscar</button>
      </form>
      {!r ? <Notice kind="error">No se pudo leer la lista. <Link href={BASE}>Reintentar</Link></Notice> : r.total === 0 ? (
        <div className="empty">{text ? <>Sin coincidencias para «{text}».</> : <>Todavía no hay Grupos Cliente, Clientes ni implantaciones. Un Administrador puede crearlos en <Link href="/administracion/clientes/grupos">Administración › Clientes</Link>.</>}</div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <caption className="visually-hidden">Resultados</caption>
              <thead><tr><th scope="col">Tipo</th><th scope="col">Nombre</th><th scope="col">Pertenece a</th><th scope="col">Estado</th></tr></thead>
              <tbody>{r.rows.map((x) => (
                <tr key={`${x.type}-${x.id}`} className={x.isActive ? undefined : "inactive-row"}>
                  <td>{TYPE_LABEL[x.type]}</td>
                  <td><Link href={fichaHref(query, { type: x.type, id: x.id }, back)}>{x.name}</Link></td>
                  <td>{x.parent ?? <span className="muted">—</span>}</td>
                  <td><span className={`badge ${x.isActive ? "badge-ok" : "badge-off"}`}>{x.isActive ? "activo" : "inactivo"}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <Pager base={BASE} params={{ ...keep, buscar: text || undefined }} page={bp} pageCount={Math.max(1, Math.ceil(r.total / 25))} total={r.total} noun="ámbitos" param="bp" />
        </>
      )}
    </>
  );
}

async function FichaPage({ userId, isAdmin, query, target, back, sp }: { userId: string; isAdmin: boolean; query: AnalysisQuery; target: { type: "group" | "client" | "implementation"; id: string }; back: string; sp: SearchParams }) {
  const ref = target;
  let f: FichaView | null = null;
  let error: string | null = null;
  try {
    f = await getFicha(userId, query, ref);
  } catch (e) {
    error = e instanceof Error ? e.message : "Error inesperado al leer la ficha.";
  }
  const self = `${BASE}${qs({ ambito: ref.type, id: ref.id, ...queryToParams(query), volver: back || undefined })}`;
  if (error) return <Notice kind="error"><strong>No se pudo leer la ficha.</strong> {error} <Link href={self}>Reintentar</Link> · <Link href={BASE}>Elegir otro ámbito</Link></Notice>;
  if (!f) return <div className="empty"><p><strong>Ámbito no encontrado.</strong></p><p><Link href={BASE}>Buscar otro</Link></p></div>;
  const c = { f, back };
  const ctx = f.context;
  const tabHref = (t: (typeof TAB_VALUES)[number]) => fichaHref(query, ref, back, { pestana: t === "resumen" ? undefined : t });
  const detKind = first(sp.det);
  const csv = (tabla: string) => `/api/analitica/ficha.csv${qs({ ambito: ref.type, id: ref.id, ...queryToParams({ ...query, tab: "resumen" }), tabla })}`;
  const gm = ctx.groupMeta;
  const ownRow = (name: string, vals: string[], groupVals: string[] | undefined) => (
    <>
      <dt>{name}</dt>
      <dd>{vals.length ? vals.map(label).join(" / ") : <span className="muted">sin informar</span>}{ref.type !== "group" && groupVals?.length ? <small className="muted block"><span className="badge badge-int">del grupo</span> {groupVals.map(label).join(" / ")}</small> : null}</dd>
    </>
  );
  const own = ctx.own;
  const users = f.entity.periods.cum.users;
  return (
    <>
      <p>{back || sp.volver ? <Link href={backHref(back)}>← Volver a Comparativa (conserva búsqueda, orden, página y bloques)</Link> : <Link href={BASE}>← Elegir otro ámbito</Link>}</p>
      <div className="card">
        <h2>{ctx.name} <span className="badge badge-int">{TYPE_LABEL[ref.type]}</span> <span className={`badge ${ctx.isActive ? "badge-ok" : "badge-off"}`}>{ctx.isActive ? "activo" : "inactivo"}</span></h2>
        <dl className="kv">
          <dt>Pertenece a</dt>
          <dd>
            {ctx.group ? <>Grupo Cliente: <Link href={fichaHref(query, { type: "group", id: ctx.group.id }, back)}>{ctx.group.name}</Link></> : ref.type === "group" ? "—" : <span className="muted">sin Grupo Cliente asignado (se muestran sus hechos operativos; no hay asignación económica)</span>}
            {ctx.client && ref.type === "implementation" ? <> · Cliente: <Link href={fichaHref(query, { type: "client", id: ctx.client.id }, back)}>{ctx.client.name}</Link></> : null}
          </dd>
          {ref.type !== "implementation" ? (
            <>
              <dt>Hijos</dt>
              <dd>
                {ref.type === "group" ? <>{ctx.children.clientsTotal} Cliente(s){ctx.children.clientsTotal > ctx.children.clients.length ? ` (primeros ${ctx.children.clients.length})` : ""}: {ctx.children.clients.map((x) => <span key={x.id}><Link href={fichaHref(query, { type: "client", id: x.id }, back)}>{x.name}</Link>{" · "}</span>)}</> : null}
                {ctx.children.implementationsTotal} implantación(es): {ctx.children.implementations.length ? ctx.children.implementations.map((x) => <span key={x.id}><Link href={fichaHref(query, { type: "implementation", id: x.id }, back)}>{x.name}</Link>{" · "}</span>) : <span className="muted">ninguna identificada («sin implantación»)</span>}
              </dd>
            </>
          ) : null}
          {ownRow("Plan de soporte", ref.type === "group" && own.support.length === 0 && gm ? gm.support.values : own.support, gm?.support.values)}
          {ownRow("Alojamiento", ref.type === "group" && own.hosting.length === 0 && gm ? gm.hosting.values : own.hosting, gm?.hosting.values)}
          {ownRow("Producto", ref.type === "group" && own.product.length === 0 && gm ? gm.product.values : own.product, gm?.product.values)}
          {ownRow("Complejidad", ref.type === "group" && own.complexity.length === 0 && gm ? gm.complexity.values : own.complexity, gm?.complexity.values)}
          {ref.type === "group" && gm && (gm.support.heterogeneous || gm.hosting.heterogeneous) ? <><dt>Heterogeneidad</dt><dd><span className="badge badge-warn">grupo heterogéneo</span> Sus Clientes tienen valores distintos; no se toma el de un primer hijo. Cobertura del maestro: {gm.coverage.replace("_", " ")}.</dd></> : null}
          <dt>Usuarios al corte</dt>
          <dd>{users.stock.value ?? <span className="muted">sin informar</span>} <span className="hint">({users.stock.status}; mes {fdate(f.cut).slice(3)}; usuarios medios CUM {users.averageUsers !== null ? formatDecimalEs(users.averageUsers, 2) : "incompletos"}; no se suman los de implantaciones al grupo)</span></dd>
        </dl>
      </div>
      <form method="get" action={BASE} className="card toolbar" aria-label="Periodo del análisis">
        <input type="hidden" name="ambito" value={ref.type} /><input type="hidden" name="id" value={ref.id} />
        {back ? <input type="hidden" name="volver" value={back} /> : null}
        {query.tab !== "resumen" ? <input type="hidden" name="pestana" value={query.tab} /> : null}
        {Object.entries(queryToParams({ ...query, date: "", mode: "CUTOFF", service: "SOPORTE", revision: null, tab: "resumen", stamp: "" })).filter(([k]) => !["fecha", "modo", "servicio"].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <div className="field"><label htmlFor="a-fecha">Fecha de análisis</label><input id="a-fecha" type="date" name="fecha" defaultValue={query.date} /></div>
        <div className="field"><label htmlFor="a-modo">Modo</label><select id="a-modo" name="modo" defaultValue={query.mode}><option value="CUTOFF">A fecha de corte</option><option value="FULL_MONTH">Mes completo</option></select></div>
        <div className="field"><label htmlFor="a-serv">Servicio económico</label><select id="a-serv" name="servicio" defaultValue={query.service}>{Object.entries(SERVICE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <button className="btn btn-primary" type="submit">Aplicar</button>
        <span className="hint">Solicitada {fdate(query.date)} · corte efectivo {fdate(f.cut)} · {query.mode === "FULL_MONTH" ? "mes completo" : "a fecha de corte"} · {f.economics.reference.method} · objetivo {formatDecimalEs(f.economics.settings.targetEurosPerDay, 0)} €/jornada (revisión {f.economics.settings.revisionNo}) · datos <code>{f.economics.reference.dataStamp.stamp}</code></span>
      </form>
      <p className="hint">El dinero es <strong>ingreso imputado</strong> (facturado + potencial anual distribuido linealmente), no facturas mensuales reales. La rentabilidad se presenta en <strong>€/jornada dedicada</strong>. La jornada y el objetivo son los de la revisión indicada en todos los bloques.</p>
      {f.economics.reference.validation.state === "PENDING_RECALC" ? <Notice kind="warn"><strong>Reproceso pendiente.</strong> {f.economics.reference.pendingRecalc.reason} Las magnitudes se conservan, marcadas «no validado».{isAdmin ? <> <Link href="/administracion/cargas">Ir a Cargas</Link>.</> : null}</Notice> : null}
      <nav aria-label="Secciones de la ficha"><ul className="tabs">{TAB_VALUES.map((t) => <li key={t}><Link href={tabHref(t)} aria-current={query.tab === t ? "page" : undefined}>{TAB_LABEL[t]}</Link></li>)}</ul></nav>
      {detKind && isDetailKind(detKind) ? (
        <Detail actorId={userId} f={f} back={back} kind={detKind} period={first(sp.periodo) || "month"} metric={first(sp.metrica)} mode={first(sp.modoh)} page={Math.max(1, Number(first(sp.dpag)) || 1)} isAdmin={isAdmin} />
      ) : (
        <>
          {query.tab === "resumen" ? (<><div className="quick" style={{ marginBottom: "0.75rem" }}><a className="btn btn-secondary btn-sm" href={csv("series")} download>CSV de periodos y series</a></div><PeriodCards c={c} /><Charts c={c} /></>) : null}
          {query.tab === "dedicacion" ? (<><div className="quick" style={{ marginBottom: "0.75rem" }}><a className="btn btn-secondary btn-sm" href={csv("dedicacion")} download>CSV de dedicación</a></div><Dedicacion c={c} /></>) : null}
          {query.tab === "pap" ? (<><div className="quick" style={{ marginBottom: "0.75rem" }}><a className="btn btn-secondary btn-sm" href={csv("pap")} download>CSV de PAP</a></div><Pap c={c} /></>) : null}
          {query.tab === "tickets" ? (<><div className="quick" style={{ marginBottom: "0.75rem" }}><a className="btn btn-secondary btn-sm" href={csv("tickets")} download>CSV de tickets</a></div><Tickets c={c} /></>) : null}
          {query.tab === "datos" ? <Datos c={c} isAdmin={isAdmin} /> : null}
        </>
      )}
      <CalidadFicha userId={userId} query={query} target={ref} />
    </>
  );
}
