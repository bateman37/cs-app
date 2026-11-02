import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { qs, type SearchParams, first } from "@/lib/format";
import { parseQualityQuery, qualityToParams, type QualityQuery } from "@/domain/quality-query";
import { todayMadrid } from "@/domain/vigencia";
import { DIAGNOSIS_FAMILIES, type DiagnosisFamily } from "@/domain/quality-config";
import { Notice, Pager } from "@/components/analytics/ui";
import { getQuality, type QualityView } from "@/server/quality/engine";
import { getBacklog, getDiagnosis, diagnosisTickets, evolutionIn } from "@/server/quality/detail";
import { getHealthHistory, getHealthMatrix } from "@/server/quality/health";
import { listQualityNotes } from "@/server/quality/notes";
import { getDraft } from "@/server/pulse/config";
import { readSnapshot } from "@/server/analytics/snapshot";
import { Controls, ViewTabs } from "./controls";
import { BacklogSection, Cards, ContextCard, DiagnosisSection } from "./sections";
import { Portfolio } from "./table";
import { HealthMatrixView } from "./health";
import { EntityDetail } from "./detail";

export const metadata: Metadata = { title: "Calidad" };
export const dynamic = "force-dynamic";
const BASE = "/calidad";

function lastFinishedMonthEnd(today: string): string {
  const [y, m] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { query, invalid } = parseQualityQuery(sp);
  const isAdmin = user.role === "ADMIN";
  const today = todayMadrid();
  const products = (await prisma.product.findMany({ select: { name: true }, orderBy: { name: "asc" } })).map((p) => p.name);
  // Simulación sobre datos de la base con el BORRADOR: solo Administrador; no escribe ni publica nada.
  const draft = query.sim === "borrador" && isAdmin ? await getDraft(user.id, "QUALITY").catch(() => null) : null;
  let view: QualityView | null = null;
  let error: string | null = null;
  try {
    view = await getQuality(user.id, query, { configOverride: draft?.payload ?? null });
  } catch (e) {
    error = e instanceof Error ? e.message : "Error inesperado al calcular Calidad.";
  }
  const params = qualityToParams(query);
  const stale = view && sp.sello && first(sp.sello) !== view.stamp;
  return (
    <>
      <h1>Calidad</h1>
      <p className="muted">Seis indicadores mensuales por Grupo Cliente y Cliente, con Client Health, diagnóstico por origen y backlog por antigüedad. Un rojo indica necesidad de actuar, no culpabilidad automática de Vincle. Sin calibración se muestran magnitudes y razones, nunca un verde por defecto.</p>
      {invalid.length > 0 ? <Notice kind="warn">Se han ignorado parámetros no válidos de la dirección ({invalid.join(", ")}); se usan los valores iniciales.</Notice> : null}
      {query.sim === "borrador" ? (
        !isAdmin ? <Notice kind="error">La simulación del borrador es solo para Administradores.</Notice>
        : !draft ? <Notice kind="warn">No hay un borrador de Calidad que simular. Guarde uno en <Link href="/administracion/configuracion?seccion=calidad">Administración › Configuración › Calidad</Link>.</Notice>
        : <Notice kind="warn"><strong>SIMULACIÓN, NO PUBLICADO.</strong> Se evalúa el borrador (versión {draft.version}) sobre los datos de la base. No cambia feedback, observaciones, reglas activas ni resultados publicados. Para publicarlo, actívelo en Administración › Configuración.</Notice>
      ) : null}
      <Controls q={query} products={products} lastFinished={lastFinishedMonthEnd(today)} basePath={BASE} />
      {error ? <Notice kind="error"><strong>No se pudo calcular Calidad.</strong> {error} <Link href={`${BASE}${qs(params)}`}>Reintentar</Link> · <Link href={BASE}>Restablecer</Link></Notice> : null}
      {view ? (
        <>
          <ContextCard v={view} />
          {stale ? <Notice kind="warn">Los datos han cambiado desde el enlace con el que llegó aquí: esto es una <strong>nueva lectura</strong>, no la pantalla anterior.</Notice> : null}
          {view.notes.map((n) => <Notice key={n} kind="info">{n}</Notice>)}
          {view.config.adapterNotes.length ? <Notice kind="info"><strong>Configuración v1 leída mediante adaptador:</strong> {view.config.adapterNotes.slice(1, 4).join(" ")}</Notice> : null}
          <ViewTabs q={query} basePath={BASE} />
          {query.view === "cartera" ? <Cartera v={view} q={query} isAdmin={isAdmin} userId={user.id} today={today} /> : null}
          {query.view === "health" ? <HealthSection q={query} userId={user.id} sp={sp} isAdmin={isAdmin} cfg={view.config_payload} /> : null}
          {query.view === "diagnostico" ? <Diagnosis q={query} userId={user.id} /> : null}
          {query.view === "backlog" ? <Backlog q={query} userId={user.id} /> : null}
        </>
      ) : null}
    </>
  );
}

async function Cartera({ v, q, isAdmin, userId, today }: { v: QualityView; q: QualityQuery; isAdmin: boolean; userId: string; today: string }) {
  const params = qualityToParams(q);
  const csv = (tabla: string) => `/api/analitica/calidad.csv${qs({ ...params, pagina: undefined, tabla, sello: v.stamp })}`;
  const sel = q.sel ? v.rows.find((r) => r.id === q.sel) : null;
  const milestones = sel
    ? (await prisma.milestone.findMany({
        where: { isActive: true, date: { gte: new Date(`${q.base.date.slice(0, 4)}-01-01T00:00:00Z`), lte: new Date(`${q.base.date.slice(0, 4)}-12-31T00:00:00Z`) }, ...(q.scope === "group" ? { OR: [{ groupId: sel.id }, { client: { groupId: sel.id } }] } : { clientId: sel.id }) },
        include: { client: { select: { name: true } }, group: { select: { name: true } } }, orderBy: { date: "asc" },
      })).map((m) => ({ date: m.date.toISOString().slice(0, 10), type: m.type, note: m.note, where: m.client?.name ?? m.group?.name ?? "" }))
    : [];
  const [evolution, notes] = sel
    ? await Promise.all([
        readSnapshot(userId, (tx) => evolutionIn(tx, q, sel.id, v.config_payload, today)).catch(() => null),
        listQualityNotes(userId, q.scope, sel.id).catch(() => []),
      ])
    : [null, []];
  const noSetup = v.totalEntities === 0;
  return (
    <>
      {v.activeCards ? (
        <div className="card">
          <h3>Comparación activa ↔ borrador (simulación, no publicado)</h3>
          <p>Activa: {v.activeCards.green} verdes · {v.activeCards.yellow} amarillos · {v.activeCards.red} rojos · {v.activeCards.noGlobal} sin global. Borrador: {v.cards.green} · {v.cards.yellow} · {v.cards.red} · {v.cards.noGlobal}.</p>
        </div>
      ) : null}
      <Cards c={v.cards} />
      {noSetup ? (
        <div className="empty"><p><strong>No hay entidades.</strong></p><p>{isAdmin ? <>Cree Grupos Cliente y Clientes en <Link href="/administracion/clientes/grupos">Administración › Clientes</Link>, cargue las fuentes y declare su cobertura. No hay datos demostrativos.</> : "Un Administrador debe cargar los maestros y las fuentes. No hay datos demostrativos."}</p></div>
      ) : (
        <>
          <p className="quick"><a href={csv("cartera")}>Descargar CSV de la cartera completa filtrada</a> ({v.filteredEntities} entidades; no solo la página){isAdmin ? <> · <Link href={`${BASE}${qs({ ...params, sim: "borrador" })}`}>Simular el borrador sobre estos datos</Link></> : null}</p>
          <Portfolio rows={v.rows} q={q} basePath={BASE} sort={q.sort} />
          <Pager base={BASE} params={params} page={v.page} pageCount={v.pageCount} total={v.filteredEntities} noun="entidades" />
          {isAdmin && v.notes.length ? <p className="hint">Siguientes acciones: calibrar umbrales y mapeo de Client Health, elegir perfiles de Dedicación y plantilla del global en <Link href="/administracion/configuracion?seccion=calidad">Administración › Configuración</Link>; declarar la cobertura de los lotes en <Link href="/administracion/cargas">Cargas</Link>.</p> : v.notes.length ? <p className="hint">Los pendientes de calibración y cobertura los resuelve un Administrador; usted puede consultar los motivos y descargar el CSV.</p> : null}
        </>
      )}
      {sel ? <EntityDetail r={sel} q={q} cfg={v.config_payload} basePath={BASE} evolution={evolution} notes={notes} isAdmin={isAdmin} milestones={milestones} /> : q.sel ? <Notice kind="warn">La entidad seleccionada no está en este ámbito o no existe.</Notice> : null}
    </>
  );
}
async function HealthSection({ q, userId, sp, isAdmin, cfg }: { q: QualityQuery; userId: string; sp: SearchParams; isAdmin: boolean; cfg: QualityView["config_payload"] }) {
  const m = await getHealthMatrix(userId, { scope: q.scope, year: q.year, q: q.base.q, page: q.base.page, pageSize: Math.min(q.base.pageSize, 50) });
  const e = /^([A-Za-z0-9_-]{1,40})\|(1[0-2]|[1-9])$/.exec(first(sp.editar));
  const edit = isAdmin && e ? { entityId: e[1], month: Number(e[2]) } : null;
  const history = edit ? await getHealthHistory(userId, q.scope, edit.entityId, q.year, edit.month) : [];
  return <HealthMatrixView m={m} q={q} cfg={cfg} basePath={BASE} edit={edit} history={history} canEdit={isAdmin} />;
}

async function Diagnosis({ q, userId }: { q: QualityQuery; userId: string }) {
  const d = await getDiagnosis(userId, q);
  const fam = (DIAGNOSIS_FAMILIES as readonly string[]).includes(q.fam) ? (q.fam as DiagnosisFamily) : null;
  const rows = fam ? await diagnosisTickets(userId, q, fam, q.base.page) : null;
  return <DiagnosisSection d={d} q={q} basePath={BASE} rows={rows} />;
}

async function Backlog({ q, userId }: { q: QualityQuery; userId: string }) {
  const b = await getBacklog(userId, q, q.base.page);
  return <BacklogSection b={b} q={q} basePath={BASE} />;
}
