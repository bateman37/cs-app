import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { runEconomics, PERIOD_KEYS, SERVICES, type PeriodSeries, type ServiceSelection } from "@/server/economics/engine";
import { listSettingsRevisions } from "@/server/economics/settings";
import { listHoursDetail, listIncomeDetail } from "@/server/economics/detail";
import { CATEGORY_LABEL, type FinanceCategory, type Formula } from "@/domain/finance";
import { isIsoDate, todayMadrid } from "@/domain/vigencia";
import { first, qs, type SearchParams } from "@/lib/format";
import { Pager } from "@/components/list";
import { formatDecimalEs } from "@/lib/money";

export const metadata: Metadata = { title: "Comprobación económica" };
const BASE = "/administracion/economia";

const SERVICE_LABEL: Record<ServiceSelection, string> = { SOPORTE: "Soporte", ADMIN_DELEGADA: "Administración delegada", OTROS: "Otros", TOTAL: "Total (los tres)" };
const fmt = (v: string | null | undefined, d = 2) => (v === null || v === undefined ? "—" : formatDecimalEs(v, d));
const STATUS: Record<string, string> = { AVAILABLE: "dato disponible", PARTIAL: "parcial / incompleto", NO_SOURCE: "sin fuente", NOT_COMPUTABLE: "no calculable" };

function F({ f, d = 2, unit }: { f: Formula; d?: number; unit?: string }) {
  if (f.value !== null) return <>{fmt(f.value, d)}{unit ? ` ${unit}` : ""}</>;
  return (
    <span title={f.reason ?? undefined}>
      <span className="badge badge-warn">{STATUS[f.status]}</span>
      {f.reason ? <small className="muted" style={{ display: "block", maxWidth: "26rem" }}>{f.reason}</small> : null}
      {f.numerator !== null ? <small className="muted" style={{ display: "block" }}>numerador {fmt(f.numerator)}{f.denominator !== null ? ` · denominador ${fmt(f.denominator)}` : ""}</small> : null}
    </span>
  );
}

function Row({ p }: { p: PeriodSeries }) {
  return (
    <tr>
      <th scope="row">{p.label}{p.provisional ? <span className="badge"> provisional</span> : null}<br /><small className="muted">{p.from} a {p.to}</small></th>
      <td>
        {p.revenue.value !== null ? `${fmt(p.revenue.value)} €` : <><span className="badge badge-warn">{STATUS[p.revenue.status]}</span><small className="muted" style={{ display: "block" }}>{p.revenue.reason}</small>{p.revenue.known !== "0" ? <small className="muted">conocido: {fmt(p.revenue.known)} €</small> : null}</>}
      </td>
      <td>{fmt(p.hours.inPerimeter)} h<small className="muted" style={{ display: "block" }}>elegibles {fmt(p.hours.eligible)} · excluidas {fmt(p.hours.excluded)} · pend. {fmt(p.hours.pendingEligibility)}</small></td>
      <td><F f={p.perDay} unit="€/jornada" /></td>
      <td><F f={p.deviationVsTarget} d={4} /></td>
      <td>{p.users.stock.value ?? "—"} <small className="muted">({p.users.stock.status})</small><small className="muted" style={{ display: "block" }}>{p.users.userMonths !== null ? `${fmt(p.users.userMonths)} usuarios mes · medios ${fmt(p.users.averageUsers)}` : `exposición incompleta (${p.users.missingMonths.map((m) => `${m.month}/${m.year}`).join(", ") || "—"})`}</small></td>
    </tr>
  );
}

export default async function EconomiaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const isAdmin = user.role === "ADMIN";
  const groups = await prisma.clientGroup.findMany({ select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 2000 });
  const revisions = await listSettingsRevisions(user.id);
  const groupId = first(sp.grupo);
  const service = (SERVICES.includes(first(sp.servicio) as ServiceSelection) ? first(sp.servicio) : "SOPORTE") as ServiceSelection;
  const date = isIsoDate(first(sp.fecha)) ? first(sp.fecha) : todayMadrid();
  const mode = first(sp.modo) === "FULL_MONTH" ? "FULL_MONTH" : "CUTOFF";
  const rev = Number(first(sp.revision)) || undefined;
  const dp = Number(first(sp.dp)) || 1;
  const hp = Number(first(sp.hp)) || 1;

  const result = groupId
    ? await runEconomics(user.id, { scope: { type: "groups", ids: [groupId] }, service, date, mode, settingsRevision: rev }).catch((e: unknown) => ({ error: e instanceof Error ? e.message : "Error" }))
    : null;
  const ok = result && !("error" in result) ? result : null;
  const e = ok?.entities[0];
  const keep = { grupo: groupId, servicio: service, fecha: date, modo: mode, revision: rev };
  const [incomeDetail, hoursDetail] =
    ok && isAdmin && e
      ? await Promise.all([
          listIncomeDetail(user.id, { groupId, page: dp, pageSize: 10 }),
          listHoursDetail(user.id, { groupId, from: ok.periodsDefinition.cum.from, to: ok.periodsDefinition.cum.to, page: hp, pageSize: 10 }),
        ])
      : [null, null];

  return (
    <>
      <h1>Comprobación económica</h1>
      <p className="muted">
        Herramienta para validar la entrega: invoca el <strong>motor económico de producción</strong> (no calcula nada en el navegador). Los dashboards de Comparativa y
        Análisis Cliente llegan en CSAPP-06 y consumirán este mismo motor.
      </p>
      <section className="card" aria-labelledby="sec-consulta">
        <h2 id="sec-consulta">Consulta</h2>
        <form className="toolbar" action={BASE} method="get">
          <div className="field"><label htmlFor="grupo">Grupo Cliente</label>
            <select id="grupo" name="grupo" defaultValue={groupId} required><option value="">Seleccione…</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
          <div className="field"><label htmlFor="servicio">Servicio</label>
            <select id="servicio" name="servicio" defaultValue={service}>{SERVICES.map((s) => <option key={s} value={s}>{SERVICE_LABEL[s]}</option>)}</select></div>
          <div className="field"><label htmlFor="fecha">Fecha de análisis</label><input id="fecha" name="fecha" type="date" defaultValue={date} /></div>
          <div className="field"><label htmlFor="modo">Modo</label>
            <select id="modo" name="modo" defaultValue={mode}><option value="CUTOFF">A fecha de corte</option><option value="FULL_MONTH">Mes completo</option></select></div>
          <div className="field"><label htmlFor="revision">Configuración</label>
            <select id="revision" name="revision" defaultValue={rev ? String(rev) : ""}><option value="">Última revisión ({revisions[0].revisionNo})</option>{revisions.slice(1).map((r) => <option key={r.revisionNo} value={r.revisionNo}>Revisión {r.revisionNo}</option>)}</select></div>
          <button className="btn btn-primary" type="submit">Calcular</button>
        </form>
      </section>
      {result && "error" in result ? <p className="notice notice-error" role="alert">{result.error}</p> : null}
      {ok && e ? (
        <>
          <section className="card" aria-labelledby="sec-ref">
            <h2 id="sec-ref">{e.name} · {SERVICE_LABEL[ok.input.service]}</h2>
            <dl className="kv">
              <dt>Fecha de análisis / corte efectivo</dt><dd>{ok.input.date} / {ok.input.cut} ({ok.input.mode === "FULL_MONTH" ? "mes completo" : "a fecha de corte"})</dd>
              <dt>Configuración usada</dt><dd>revisión {ok.settings.revisionNo}: objetivo {fmt(ok.settings.targetEurosPerDay)} €/jornada, jornada {fmt(ok.settings.dayHours, 0)} h{ok.recalculatedWithOlderSettings ? " — recálculo identificado con una revisión anterior" : ""}</dd>
              <dt>Método y versión</dt><dd>{ok.reference.method} · {ok.reference.engineVersion}</dd>
              <dt>Lectura</dt><dd>{ok.reference.readIsolation}, {ok.reference.readAt}</dd>
              <dt>Plan / alojamiento al corte</dt><dd>{e.metadata.support} / {e.metadata.hosting}{e.eco08 ? " — Silver On Demand: la rentabilidad mensual recurrente no está activada (ECO 08 pendiente)" : ""}</dd>
              <dt>Conjuntos financieros usados</dt>
              <dd>{ok.reference.finance.filter((f) => f.batchId).length === 0 ? "ninguno activo (ingreso desconocido, no cero)" : ok.reference.finance.filter((f) => f.batchId).map((f) => (
                <span key={`${f.year}${f.category}`} style={{ display: "block" }}>{CATEGORY_LABEL[f.category]} {f.year}: <Link href={`/administracion/cargas/${f.batchId}`}>lote</Link> v{f.version}, cobertura {f.coverage.toLowerCase().replace("_", " ")}{f.extractionDate ? `, extracción ${f.extractionDate}` : ""}</span>
              ))}</dd>
              <dt>Recálculo pendiente</dt><dd>{ok.reference.pendingRecalc.reason ?? "no"}</dd>
            </dl>
          </section>
          <section className="card" aria-labelledby="sec-periodos">
            <h2 id="sec-periodos">Periodos</h2>
            <div className="table-wrap">
              <table>
                <caption className="skip">Periodos del motor económico</caption>
                <thead><tr><th>Periodo</th><th>Ingreso imputado</th><th>Horas elegibles del perímetro</th><th>€ por jornada</th><th>Desviación contra objetivo*</th><th>Usuarios (stock al corte / flujo)</th></tr></thead>
                <tbody>{PERIOD_KEYS.map((k) => <Row key={k} p={e.periods[k]} />)}</tbody>
              </table>
            </div>
            <p className="muted">* Positivo = rendimiento por debajo del objetivo. El ingreso mensual es una <strong>imputación analítica</strong> de la «Vta Potencial» anual (anual/12 × días / días reales), no la facturación real de ese mes.</p>
          </section>
          <section className="card" aria-labelledby="sec-servicio">
            <h2 id="sec-servicio">Horas por servicio (CUM actual) y componentes</h2>
            <dl className="kv">
              {Object.entries(e.periods.cum.hours.byService).map(([k, v]) => <><dt key={`k${k}`}>{k.replace("_", " ").toLowerCase()}</dt><dd key={`v${k}`}>{fmt(v)} h</dd></>)}
              <dt>Excluidas por política (PMO...)</dt><dd>{fmt(e.periods.cum.hours.excluded)} h</dd>
              <dt>Elegibilidad pendiente</dt><dd>{fmt(e.periods.cum.hours.pendingEligibility)} h</dd>
              <dt>Horas elegibles sin Grupo Cliente (toda la cartera)</dt><dd>{fmt(ok.unattributed?.eligibleHours)} h {ok.unattributed ? Object.entries(ok.unattributed.byBucket).map(([b, h]) => `· ${b}: ${fmt(h)}`).join(" ") : ""}</dd>
              {Object.entries(e.periods.cum.incomeByCategory).map(([c, v]) => <><dt key={`i${c}`}>Ingreso {CATEGORY_LABEL[c as FinanceCategory]}</dt><dd key={`j${c}`}>{v?.value !== null && v?.value !== undefined ? `${fmt(v.value)} €` : `${v?.state}: ${v?.reason ?? ""}`}</dd></>)}
              <dt>Tarifa anual por usuario</dt><dd><F f={e.periods.cum.perUserPerYear} unit="€/usuario·año" /></dd>
            </dl>
          </section>
          <section className="card" aria-labelledby="sec-serie">
            <h2 id="sec-serie">Serie mensual del año seleccionado</h2>
            <div className="table-wrap">
              <table>
                <caption className="skip">Serie mensual</caption>
                <thead><tr><th>Mes</th><th>Ingreso imputado</th><th>Horas</th><th>€ por jornada</th></tr></thead>
                <tbody>{e.monthly.map((m) => (
                  <tr key={m.key}><th scope="row">{m.from.slice(0, 7)}</th><td>{m.revenue.value !== null ? `${fmt(m.revenue.value)} €` : STATUS[m.revenue.status]}</td><td>{fmt(m.hours.inPerimeter)} h</td><td><F f={m.perDay} /></td></tr>
                ))}</tbody>
              </table>
            </div>
          </section>
          {incomeDetail && hoursDetail ? (
            <>
              <section className="card" aria-labelledby="sec-ingresos">
                <h2 id="sec-ingresos">Detalle de ingresos y lotes vigentes</h2>
                {incomeDetail.rows.length === 0 ? <div className="empty">Este grupo no tiene líneas en ningún conjunto financiero activo.</div> : (
                  <div className="table-wrap"><table>
                    <caption className="skip">Líneas de ingreso</caption>
                    <thead><tr><th>Año</th><th>Categoría</th><th>Origen</th><th>Vta Potencial</th><th>Diferencia</th><th>Lote</th></tr></thead>
                    <tbody>{incomeDetail.rows.map((r, i) => (
                      <tr key={i}><td>{r.year}</td><td>{CATEGORY_LABEL[r.category as FinanceCategory]}</td><td>{r.label}{r.derivedZero ? " (vacío → cero por decisión)" : ""}</td><td>{fmt(r.income)} €</td><td>{r.difference === null ? "—" : `${fmt(r.difference)} €`}</td>
                        <td><Link href={`/administracion/cargas/${r.batchId}`}>{r.name}</Link></td></tr>
                    ))}</tbody>
                  </table></div>
                )}
                <Pager base={BASE} params={{ ...keep, hp }} page={incomeDetail.page} pageCount={incomeDetail.pageCount} total={incomeDetail.total} />
              </section>
              <section className="card" aria-labelledby="sec-horas">
                <h2 id="sec-horas">Detalle de horas (CUM actual, {hoursDetail.total.toLocaleString("es-ES")} actividades, {fmt(hoursDetail.totalHours)} h)</h2>
                <div className="table-wrap"><table>
                  <caption className="skip">Actividades de tiempo</caption>
                  <thead><tr><th>Fuente</th><th>Fecha</th><th>Horas</th><th>Ticket</th><th>Elegibilidad</th><th>Servicio</th><th>Origen de la clasificación</th></tr></thead>
                  <tbody>{hoursDetail.rows.map((r) => (
                    <tr key={`${r.source}${r.entryId}`}><td>{r.source}</td><td>{r.workDate}</td><td>{fmt(r.hours, 4)}</td><td>{r.ticketId ?? "—"}</td><td>{r.eligibility}</td><td>{r.service}</td><td>{r.origins?.join(", ") ?? "—"}</td></tr>
                  ))}</tbody>
                </table></div>
                <Pager base={BASE} params={{ ...keep, dp }} page={hoursDetail.page} pageCount={hoursDetail.pageCount} total={hoursDetail.total} />
              </section>
            </>
          ) : null}
          <p className="muted"><Link href={`/administracion/servicios${qs({})}`}>Asignaciones de servicio</Link> · <Link href="/administracion/configuracion">Configuración económica</Link></p>
        </>
      ) : null}
    </>
  );
}
