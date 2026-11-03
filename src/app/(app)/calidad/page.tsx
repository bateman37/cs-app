import { ExportPanel } from "@/components/exports/export-panel";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePageUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { qs, type SearchParams, first } from "@/lib/format";
import { parseQualityQuery, qualityToParams, type QualityQuery } from "@/domain/quality-query";
import { todayMadrid } from "@/domain/vigencia";
import { DIAGNOSIS_FAMILIES, type DiagnosisFamily, type IndicatorKey } from "@/domain/quality-config";
import { KPI_ACCESS_NAME } from "@/domain/quality-kpi";
import { Pager } from "@/components/analytics/ui";
import { getQuality, type QualityView } from "@/server/quality/engine";
import { getBacklog, getDiagnosis, diagnosisTickets, evolutionIn } from "@/server/quality/detail";
import { getHealthHistory, getHealthMatrix } from "@/server/quality/health";
import { listQualityNotes } from "@/server/quality/notes";
import { getKpiSection } from "@/server/quality/sections";
import { getDraft } from "@/server/pulse/config";
import { readSnapshot } from "@/server/analytics/snapshot";
import { QualityBar } from "./bar";
import { KpiAccessGrid } from "./access";
import { Portfolio, kpiHref } from "./table";
import { HealthMatrixView } from "./health";
import { EntityDetail, EntityKpiHead, Evo } from "./detail";
import { BugsBody, CalcBlock, DedicationBody, IncidentsFlow, N3Body, PapBody, SelectionTable } from "./apartados";
import { BacklogBlock, DiagnosisBlock } from "./sections";
import "./calidad.css";

export const metadata: Metadata = { title: "Calidad" };
export const dynamic = "force-dynamic";
const BASE = "/calidad";

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { query, invalid, obsolete } = parseQualityQuery(sp);
  const editar = /^([A-Za-z0-9_-]{1,40})\|(1[0-2]|[1-9])$/.exec(first(sp.editar));
  // Los parámetros retirados o no válidos NO filtran en secreto: se limpian de la dirección (se conserva solo lo que sigue siendo del contrato).
  if (obsolete.length > 0 || invalid.length > 0) redirect(`${BASE}${qs({ ...qualityToParams(query), ...(editar && query.kpi === "HEALTH" ? { editar: `${editar[1]}|${editar[2]}` } : {}) })}`);
  const isAdmin = user.role === "ADMIN";
  const today = todayMadrid();
  // Simulación sobre datos de la base con el BORRADOR: solo Administrador; no escribe ni publica nada.
  const draft = query.sim === "borrador" && isAdmin ? await getDraft(user.id, "QUALITY").catch(() => null) : null;
  let view: QualityView | null = null;
  let error: string | null = null;
  try {
    view = await getQuality(user.id, query, { configOverride: draft?.payload ?? null, allRows: query.kpi !== "" && query.sel === "" });
  } catch (e) {
    error = e instanceof Error ? e.message : "Error inesperado al calcular Calidad.";
  }
  const params = qualityToParams(query);
  const kpi = query.kpi;
  const sel = view && query.sel ? view.rows.find((r) => r.id === query.sel) ?? null : null;
  const title = kpi ? KPI_ACCESS_NAME[kpi] : "Resumen de clientes";
  const csvTable = kpi === "HEALTH" ? "health" : !kpi && query.sel ? "ficha" : "cartera";
  const csvHref = view ? `/api/analitica/calidad.csv${qs({ ...params, pagina: undefined, tabla: csvTable, sello: view.stamp })}` : null;
  const period = view?.period ?? null;
  return (
    <div className="ql-page">
      {period ? <QualityBar title={title} q={query} period={period} today={today} basePath={BASE} pending={Boolean(view?.pendingData)} csvHref={csvHref} isAdmin={isAdmin} /> : <h1>{title}</h1>}
      {query.sim === "borrador" ? (
        !isAdmin ? <p className="ql-err" role="alert">La simulación del borrador es solo para Administradores.</p>
        : !draft ? <p className="ql-note">No hay un borrador de Calidad que simular. Guárdelo en <Link href="/administracion/configuracion?seccion=calidad">Administración › Configuración › Calidad</Link>.</p>
        : <p className="ql-note" role="status"><strong>SIMULACIÓN, NO PUBLICADO.</strong> Se evalúa el borrador (versión {draft.version}) sobre los datos de la base. {view?.activeCards ? <>Activa: {view.activeCards.green} verdes · {view.activeCards.yellow} amarillos · {view.activeCards.red} rojos · {view.activeCards.noGlobal} sin global. Borrador: {view.cards.green} · {view.cards.yellow} · {view.cards.red} · {view.cards.noGlobal}.</> : null} Para publicarlo, actívelo en Administración › Configuración.</p>
      ) : null}
      {error ? (
        <div className="ql-err" role="alert"><strong>No se pudo calcular Calidad.</strong> {error} <Link href={`${BASE}${qs(params)}`} prefetch={false}>Reintentar</Link> · <Link href={BASE} prefetch={false}>Restablecer</Link></div>
      ) : null}
      {view ? (
        <>
          <KpiAccessGrid access={view.access} q={query} basePath={BASE} />
          {view.totalEntities === 0 ? (
            <div className="ql-empty"><p><strong>No hay entidades.</strong></p><p>{isAdmin ? <>Cree Grupos Cliente y Clientes en <Link href="/administracion/clientes/grupos">Administración › Clientes</Link> y cargue las fuentes. No hay datos demostrativos.</> : "Un Administrador debe cargar los maestros y las fuentes. No hay datos demostrativos."}</p></div>
          ) : kpi === "" && query.sel === "" ? (
            <Resumen v={view} q={query} isAdmin={isAdmin} userId={user.id} />
          ) : kpi === "" ? (
            sel ? <Ficha v={view} r={sel} q={query} isAdmin={isAdmin} userId={user.id} today={today} /> : <p className="ql-err">La entidad seleccionada no está en este nivel o no existe. <Link href={kpiHref(query, BASE, "", "")} prefetch={false}>Volver al resumen</Link></p>
          ) : (
            <Apartado v={view} q={query} kpi={kpi} sel={sel} isAdmin={isAdmin} userId={user.id} sp={sp} />
          )}
        </>
      ) : null}
    </div>
  );
}

function Resumen({ v, q, isAdmin, userId }: { v: QualityView; q: QualityQuery; isAdmin: boolean; userId: string }) {
  const params = qualityToParams(q);
  return (
    <>
      {v.filteredEntities === 0 ? <div className="ql-empty">Ninguna entidad cumple Soporte y Servidor a la vez en el mismo Cliente. <Link href={`${BASE}${qs({ ...params, soporte: undefined, servidor: undefined })}`} prefetch={false}>Quitar los segmentadores</Link></div> : (
        <>
          <Portfolio rows={v.rows} q={q} basePath={BASE} />
          <Pager base={BASE} params={params} page={v.page} pageCount={v.pageCount} total={v.filteredEntities} noun={q.scope === "group" ? "Grupos Cliente" : "Clientes"} />
        </>
      )}
      <p className="ql-note">
        {isAdmin ? <><Link href="/administracion/configuracion?seccion=calidad" prefetch={false}>Configuración de Calidad</Link> (pesos, umbrales, perfiles y calibración){v.query.sim ? "" : <> · <Link href={`${BASE}${qs({ ...params, sim: "borrador" })}`} prefetch={false}>Simular el borrador</Link></>}</> : null}
      </p>
      {v.totalEntities > 0 ? (
        <details className="ql-calc">
          <summary>Exportar detalle completo</summary>
          <ExportPanel userId={userId} scope={q.scope} sel={q.sel} selName={null} from={`${v.period.year}-01-01`} to={v.period.cut} service={q.base.service} stamp={v.stamp} />
        </details>
      ) : null}
    </>
  );
}

async function Ficha({ v, r, q, isAdmin, userId, today }: { v: QualityView; r: QualityView["rows"][number]; q: QualityQuery; isAdmin: boolean; userId: string; today: string }) {
  const milestones = (await prisma.milestone.findMany({
    where: { isActive: true, date: { gte: new Date(`${q.base.date.slice(0, 4)}-01-01T00:00:00Z`), lte: new Date(`${q.base.date.slice(0, 4)}-12-31T00:00:00Z`) }, ...(q.scope === "group" ? { OR: [{ groupId: r.id }, { client: { groupId: r.id } }] } : { clientId: r.id }) },
    include: { client: { select: { name: true } }, group: { select: { name: true } } }, orderBy: { date: "asc" },
  })).map((m) => ({ date: m.date.toISOString().slice(0, 10), type: m.type, note: m.note, where: m.client?.name ?? m.group?.name ?? "" }));
  const notes = await listQualityNotes(userId, q.scope, r.id).catch(() => []);
  return (
    <>
      <p className="ql-crumb"><Link href={kpiHref({ ...q, sel: "" }, BASE, "", "")} prefetch={false}>← Volver al resumen de clientes</Link></p>
      <EntityDetail r={r} view={v} q={q} basePath={BASE} notes={notes} isAdmin={isAdmin} milestones={milestones}
        evolutionSlot={<Suspense fallback={<p role="status" className="ql-note">Calculando la evolución mensual…</p>}><EvolutionSection userId={userId} q={q} id={r.id} cfg={v.config_payload} today={today} /></Suspense>} />
    </>
  );
}

async function Apartado({ v, q, kpi, sel, isAdmin, userId, sp }: { v: QualityView; q: QualityQuery; kpi: IndicatorKey; sel: QualityView["rows"][number] | null; isAdmin: boolean; userId: string; sp: SearchParams }) {
  const back = kpiHref({ ...q, sel: "" }, BASE, "", "");
  const list = kpiHref({ ...q, sel: "" }, BASE, kpi, "");
  const noSel = q.sel !== "" && sel === null;
  return (
    <>
      <p className="ql-crumb">
        <Link href={back} prefetch={false}>← Volver al resumen de clientes</Link>
        {sel ? <><span>·</span><span>{sel.name}</span><Link href={list} prefetch={false}>{KPI_ACCESS_NAME[kpi]} de toda la selección</Link><Link href={kpiHref(q, BASE, "", sel.id)} prefetch={false}>Ficha de {sel.name}</Link></> : <span>Selección actual: {v.filteredEntities} {q.scope === "group" ? "Grupos Cliente" : "Clientes"}{q.filters.soporte.length || q.filters.servidor.length ? ` · ${[q.filters.soporte.length ? `Soporte ${q.filters.soporte.join("/")}` : "", q.filters.servidor.length ? `Servidor ${q.filters.servidor.join("/")}` : ""].filter(Boolean).join(" · ")}` : ""}</span>}
      </p>
      {noSel ? <p className="ql-err">La entidad seleccionada no está en este nivel o no existe. <Link href={list} prefetch={false}>Ver la selección</Link></p> : null}
      {sel ? <EntityKpiHead r={sel} k={kpi} /> : v.filteredEntities > 0 ? <SelectionTable rows={v.rows} k={kpi} q={q} basePath={BASE} /> : <div className="ql-empty">Ninguna entidad cumple Soporte y Servidor a la vez en el mismo Cliente.</div>}
      {!noSel ? <Body v={v} q={q} kpi={kpi} isAdmin={isAdmin} userId={userId} sp={sp} /> : null}
      {!noSel ? <CalcBlock k={kpi} row={sel} view={v} /> : null}
    </>
  );
}

type BodyData =
  | { kind: "HEALTH"; m: Awaited<ReturnType<typeof getHealthMatrix>>; edit: { entityId: string; month: number } | null; history: Awaited<ReturnType<typeof getHealthHistory>> }
  | { kind: "INCIDENTS"; s: Awaited<ReturnType<typeof getKpiSection>>; d: Awaited<ReturnType<typeof getDiagnosis>>; rows: Awaited<ReturnType<typeof diagnosisTickets>> | null; b: Awaited<ReturnType<typeof getBacklog>> }
  | { kind: "SECTION"; s: Awaited<ReturnType<typeof getKpiSection>> };

async function loadBody(v: QualityView, q: QualityQuery, kpi: IndicatorKey, isAdmin: boolean, userId: string, sp: SearchParams): Promise<BodyData> {
  if (kpi === "HEALTH") {
    const m = await getHealthMatrix(userId, { scope: q.scope, year: q.year, q: "", page: q.base.page, pageSize: 50, filters: q.filters, cut: v.period.cut, ...(q.sel ? { ids: [q.sel] } : {}) });
    const e = /^([A-Za-z0-9_-]{1,40})\|(1[0-2]|[1-9])$/.exec(first(sp.editar));
    const edit = isAdmin && e ? { entityId: e[1], month: Number(e[2]) } : null;
    return { kind: "HEALTH", m, edit, history: edit ? await getHealthHistory(userId, q.scope, edit.entityId, q.year, edit.month) : [] };
  }
  if (kpi === "INCIDENTS_PROBLEMS") {
    const fam = (DIAGNOSIS_FAMILIES as readonly string[]).includes(q.fam) ? (q.fam as DiagnosisFamily) : null;
    return { kind: "INCIDENTS", s: await getKpiSection(userId, q, kpi), d: await getDiagnosis(userId, q), rows: fam ? await diagnosisTickets(userId, q, fam, q.base.page) : null, b: await getBacklog(userId, q, q.base.page) };
  }
  return { kind: "SECTION", s: await getKpiSection(userId, q, kpi) };
}

async function Body({ v, q, kpi, isAdmin, userId, sp }: { v: QualityView; q: QualityQuery; kpi: IndicatorKey; isAdmin: boolean; userId: string; sp: SearchParams }) {
  let data: BodyData | null = null;
  let failure: string | null = null;
  try {
    data = await loadBody(v, q, kpi, isAdmin, userId, sp);
  } catch (e) {
    failure = e instanceof Error ? e.message : "Error inesperado.";
  }
  // Un fallo real del apartado sigue visible y se puede reintentar; no se disfraza de cero ni de verde.
  if (data === null) return <div className="ql-err" role="alert"><strong>No se pudo cargar el detalle de {KPI_ACCESS_NAME[kpi]}.</strong> {failure} <Link href={`${BASE}${qs(qualityToParams(q))}`} prefetch={false}>Reintentar</Link></div>;
  if (data.kind === "HEALTH") {
    const access = q.sel ? { ...v.access.HEALTH, health: healthOf(v, q.sel) } : v.access.HEALTH;
    return <HealthMatrixView m={data.m} q={q} cfg={v.config_payload} basePath={BASE} edit={data.edit} history={data.history} canEdit={isAdmin} access={access} monthLabel={`${String(v.period.month).padStart(2, "0")}/${v.period.year}`} />;
  }
  if (data.kind === "INCIDENTS") {
    return (
      <>
        {data.s.kind === "INCIDENTS_PROBLEMS" ? <IncidentsFlow s={data.s.data} /> : null}
        <BacklogBlock b={data.b} q={q} basePath={BASE} />
        <DiagnosisBlock d={data.d} q={q} basePath={BASE} rows={data.rows} />
      </>
    );
  }
  const s = data.s;
  switch (s.kind) {
    case "DEDICATION": return <DedicationBody s={s.data} isAdmin={isAdmin} />;
    case "PAP_CORRECTIVE": return <PapBody s={s.data} list={s.list} q={q} basePath={BASE} />;
    case "N3_ESCALATIONS": return <N3Body s={s.data} list={s.list} q={q} basePath={BASE} />;
    case "BUGS_STANDARD": return <BugsBody s={s.data} list={s.list} openBugs={s.openBugs} q={q} basePath={BASE} />;
    default: return null;
  }
}
function healthOf(v: QualityView, id: string) {
  const r = v.rows.find((x) => x.id === id);
  const i = r?.evaluation.indicators.HEALTH;
  const h = { positive: 0, mixed: 0, negative: 0, blank: 0 };
  if (!i || i.availability === "BLANK" || i.value === null) h.blank++; else h[i.value as "positive" | "mixed" | "negative"]++;
  return h;
}

/** Evolución mensual: se calcula aparte (streaming) para que el coste de recalcular cada mes con su cohorte no retrase el resto de la ficha. */
async function EvolutionSection({ userId, q, id, cfg, today }: { userId: string; q: QualityQuery; id: string; cfg: QualityView["config_payload"]; today: string }) {
  const evolution = await readSnapshot(userId, (tx) => evolutionIn(tx, q, id, cfg, today)).catch(() => null);
  return evolution ? <Evo e={evolution} /> : <p className="ql-note">No se ha podido calcular la evolución mensual (sin datos o error de lectura). <Link href={`${BASE}${qs(qualityToParams(q))}`} prefetch={false}>Reintentar</Link></p>;
}
