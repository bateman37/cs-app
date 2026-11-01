import Link from "next/link";
import type { AnalysisQuery } from "@/domain/analytics-query";
import { HOURS_MODES, HOURS_MODE_LABEL, bugsDetail, hoursDetail, incomeDetail, papDetail, ticketsDetail, type HoursMode } from "@/server/analytics/detail";
import type { EntityRef } from "@/server/analytics/operational";
import type { FichaView } from "@/server/analytics/ficha";
import { Notice, Pager, fdate, hrs, eur } from "@/components/analytics/ui";
import { formatDecimalEs } from "@/lib/money";
import { qs } from "@/lib/format";
import { METRICS, RatioExplanation, type MetricKey } from "./explain";
import { fichaHref } from "./links";

const KINDS = ["ratio", "ingreso", "horas", "pap", "tickets", "bugs"] as const;
export type DetailKind = (typeof KINDS)[number];
export const isDetailKind = (v: string): v is DetailKind => (KINDS as readonly string[]).includes(v);

type Props = { actorId: string; f: FichaView; back: string; kind: DetailKind; period: string; metric: string; mode: string; page: number; isAdmin: boolean };

export async function Detail({ actorId, f, back, kind, period, metric, mode, page, isAdmin }: Props) {
  const q: AnalysisQuery = f.query;
  const ref: EntityRef = f.context.ref;
  const close = fichaHref(q, ref, back, { pestana: q.tab === "resumen" ? undefined : q.tab });
  const hrefTo = (extra: Record<string, string | number | undefined>) => fichaHref(q, ref, back, { pestana: q.tab === "resumen" ? undefined : q.tab, ...extra });
  try {
    if (kind === "ratio") {
      const key = (metric in METRICS ? metric : "perDay") as MetricKey;
      const pk = (["month", "prevMonth", "cum", "prevYear", "prevCum"] as const).find((k) => k === period) ?? "month";
      const p = f.entity.periods[pk];
      return (
        <div>
          <p><Link href={close}>← Cerrar detalle</Link></p>
          <RatioExplanation metric={key} p={p} links={{ income: hrefTo({ det: "ingreso", periodo: pk }), hours: hrefTo({ det: "horas", periodo: pk }) }} reference={{ engine: f.economics.reference.engineVersion, stamp: f.economics.reference.dataStamp.stamp, settings: f.economics.settings.revisionNo, method: f.economics.reference.method, cut: f.cut }} />
        </div>
      );
    }
    const staleNotice = (stamp: string) => (q.stamp && q.stamp !== stamp ? <Notice kind="warn">Los datos han cambiado desde la lectura de la que partió (referencia <code>{q.stamp}</code> → <code>{stamp}</code>). Este detalle es una <strong>nueva lectura</strong>; <Link href={close}>actualice la ficha</Link> para ver las cifras al día. No concilia con la pantalla anterior.</Notice> : null);
    if (kind === "ingreso") {
      if (ref.type !== "group") return <Notice kind="info">El ingreso se atribuye al Grupo Cliente: <Link href={f.context.group ? fichaHref(q, { type: "group", id: f.context.group.id }, back, { det: "ingreso", periodo: period }) : close}>abra el detalle en el grupo</Link>.</Notice>;
      const d = await incomeDetail(actorId, q, ref.id, period, page);
      return (
        <section className="card" aria-label="Detalle del ingreso">
          <p><Link href={close}>← Cerrar detalle</Link></p>
          <h2>Ingreso imputado · {d.period.label} ({fdate(d.period.from)} – {fdate(d.period.to)})</h2>
          {staleNotice(d.reference.stamp)}
          <p className="hint">{d.note}</p>
          <div className="table-wrap"><table><caption className="hint">Contribución imputada por año y categoría</caption>
            <thead><tr><th scope="col">Año</th><th scope="col">Categoría</th><th scope="col" className="num">Importe anual fuente</th><th scope="col" className="num">Factor temporal (meses)</th><th scope="col" className="num">Contribución imputada</th><th scope="col">Estado</th><th scope="col">Origen y extracción</th><th scope="col">Conjunto</th></tr></thead>
            <tbody>{d.contributions.map((c) => (
              <tr key={`${c.year}-${c.category}`}><td>{c.year}</td><td>{c.label}</td><td className="num">{c.annualSource === null ? "—" : eur(c.annualSource)}</td><td className="num">{formatDecimalEs(c.monthsFactor, 4)}</td><td className="num">{c.contribution === null ? "—" : eur(c.contribution)}</td><td>{c.state.toLowerCase().replace("_", " ")}</td><td>{c.origin ?? "sin conjunto"} · {fdate(c.extraction)}</td><td>versión {c.version || "—"}{isAdmin && c.batchId ? <> · <Link href={`/administracion/cargas/${c.batchId}`}>lote</Link></> : null}</td></tr>
            ))}</tbody>
            <tfoot><tr><th scope="row" colSpan={4}>Total imputado del periodo</th><td className="num"><strong>{d.totalContribution === null ? "incompleto" : eur(d.totalContribution)}</strong></td><td colSpan={3}>{d.complete ? "concilia con la cifra" : "falta algún conjunto: no se publica un total completo"}</td></tr></tfoot>
          </table></div>
          <h3>Líneas fuente del grupo (importes anuales, sin sumarse doce veces)</h3>
          <div className="table-wrap"><table><thead><tr><th scope="col">Año</th><th scope="col">Categoría</th><th scope="col">Línea de origen</th><th scope="col" className="num">Vta Potencial anual</th><th scope="col" className="num">Diferencia (contra Budget, aparte)</th><th scope="col">Resolución</th></tr></thead>
            <tbody>{d.lines.map((l, i) => <tr key={i}><td>{l.year}</td><td>{l.category}</td><td>{l.label}</td><td className="num">{eur(l.annual)}</td><td className="num">{l.difference === null ? "—" : formatDecimalEs(l.difference, 2)}</td><td>{l.resolution}</td></tr>)}</tbody></table></div>
          <Pager base="/analisis-cliente" params={Object.fromEntries(new URLSearchParams(hrefTo({ det: "ingreso", periodo: period }).split("?")[1]))} page={d.page} pageCount={Math.max(1, Math.ceil(d.linesTotal / d.pageSize))} total={d.linesTotal} noun="líneas" param="dpag" />
        </section>
      );
    }
    if (kind === "horas") {
      const m = (HOURS_MODES as readonly string[]).includes(mode) ? (mode as HoursMode) : "incluidas";
      const d = await hoursDetail(actorId, q, ref, period, m, page);
      const params = Object.fromEntries(new URLSearchParams(hrefTo({ det: "horas", periodo: period, modoh: m }).split("?")[1]));
      return (
        <section className="card" aria-label="Detalle de las horas">
          <p><Link href={close}>← Cerrar detalle</Link></p>
          <h2>Horas · {d.period.label} ({fdate(d.period.from)} – {fdate(d.period.to)})</h2>
          {staleNotice(d.reference.stamp)}
          <ul className="link-list">{HOURS_MODES.map((x) => <li key={x}>{x === m ? <strong>{HOURS_MODE_LABEL[x]}</strong> : <Link href={hrefTo({ det: "horas", periodo: period, modoh: x })}>{HOURS_MODE_LABEL[x]}</Link>}</li>)}</ul>
          <p><strong>Total del conjunto filtrado:</strong> {d.total.rows} actividad(es) · {formatDecimalEs(d.total.minutes, 0)} min = {hrs(d.total.hours)} {m === "incluidas" ? "(coincide exactamente con la cifra del periodo)" : ""}. Una actividad es (fuente, id de registro) y cuenta una vez.</p>
          <div className="table-wrap"><table>
            <thead><tr><th scope="col">Fuente</th><th scope="col">Registro</th><th scope="col">Fecha de trabajo</th><th scope="col" className="num">Minutos</th><th scope="col" className="num">Horas</th><th scope="col">Persona</th><th scope="col">Equipo / nivel / rol</th><th scope="col">Ticket / proyecto</th><th scope="col">Servicio y evidencia</th><th scope="col">Elegibilidad</th></tr></thead>
            <tbody>{d.rows.map((r) => <tr key={`${r.source}${r.entryId}`}><td>{r.source}</td><td><code>{r.entryId.slice(0, 8)}</code></td><td>{fdate(r.workDate)}</td><td className="num">{formatDecimalEs(r.minutes, 0)}</td><td className="num">{formatDecimalEs(r.hours, 4)}</td><td>{r.person ?? <span className="muted">sin resolver</span>}</td><td>{[r.team, r.level, r.role].filter(Boolean).join(" / ") || <span className="muted">sin identificar</span>}</td><td>{r.ticketId ?? r.project ?? "—"}</td><td>{r.service}{r.origins.length ? ` · ${r.origins.join(", ")}` : ""}</td><td>{r.eligibility} · {r.bucket}</td></tr>)}
              {d.rows.length === 0 ? <tr><td colSpan={10} className="muted">Sin actividades en este grupo.</td></tr> : null}</tbody></table></div>
          <Pager base="/analisis-cliente" params={params} page={d.page} pageCount={Math.max(1, Math.ceil(d.total.rows / d.pageSize))} total={d.total.rows} noun="actividades" param="dpag" />
        </section>
      );
    }
    if (kind === "pap") {
      const d = await papDetail(actorId, q, ref, period, page);
      return (
        <section className="card" aria-label="Detalle PAP">
          <p><Link href={close}>← Cerrar detalle</Link></p>
          <h2>PAP · {d.period.label}{d.period.from ? ` (${fdate(d.period.from)} – ${fdate(d.period.to)})` : ""}</h2>
          {staleNotice(d.reference.stamp)}
          <p className="hint">Identidad estable lista + ID; fecha de puesta en producción (no la de título ni solicitud). Un PAP aparece una vez aunque tenga varias causas o tickets.</p>
          <div className="table-wrap"><table><thead><tr><th scope="col">Lista</th><th scope="col">ID</th><th scope="col">Título</th><th scope="col">Producción</th><th scope="col">Solicitud</th><th scope="col">Resultado</th><th scope="col">Estado</th><th scope="col">Causas</th><th scope="col">Ámbito</th></tr></thead>
            <tbody>{d.rows.map((r) => <tr key={`${r.listKey}-${r.papId}`}><td>{r.listKey}</td><td>{r.papId}</td><td>{r.title}</td><td>{fdate(r.production)}</td><td>{fdate(r.request)}</td><td>{r.result ?? "—"}</td><td>{r.state}</td><td>{r.causes ?? "sin causas"}</td><td>{r.scope}</td></tr>)}</tbody></table></div>
          <Pager base="/analisis-cliente" params={Object.fromEntries(new URLSearchParams(hrefTo({ det: "pap", periodo: period }).split("?")[1]))} page={d.page} pageCount={Math.max(1, Math.ceil(d.total / d.pageSize))} total={d.total} noun="PAP" param="dpag" />
        </section>
      );
    }
    if (kind === "tickets") {
      const d = await ticketsDetail(actorId, q, ref, period, page);
      return (
        <section className="card" aria-label="Detalle de tickets">
          <p><Link href={close}>← Cerrar detalle</Link></p>
          <h2>Tickets creados · {d.period.label} ({fdate(d.period.from)} – {fdate(d.period.to)})</h2>
          {staleNotice(d.reference.stamp)}
          {!d.supported ? <Notice kind="info">Las implantaciones no identifican tickets.</Notice> : (
            <>
              <p className="hint">Clasificación, tags y estado actuales aplicados a altas históricas; el estado se muestra con su fecha de observación.</p>
              <div className="table-wrap"><table><thead><tr><th scope="col">Ticket</th><th scope="col">Creación</th><th scope="col">Tipo</th><th scope="col">Estado observado</th><th scope="col">Causa raíz</th><th scope="col">Clase</th><th scope="col">Destinos</th></tr></thead>
                <tbody>{d.rows.map((r) => <tr key={r.ticketId}><td>{r.ticketId}</td><td>{fdate(r.created)}</td><td>{r.type}</td><td>{r.status}{r.observedOn ? ` (${fdate(r.observedOn)}${r.observedKind === "RECEIVED" ? ", fecha de recepción" : ""})` : ""}</td><td>{r.cause ?? "sin causa"}</td><td>{r.incidentClass}</td><td>{r.destinations.join(", ") || "—"}</td></tr>)}</tbody></table></div>
              <Pager base="/analisis-cliente" params={Object.fromEntries(new URLSearchParams(hrefTo({ det: "tickets", periodo: period }).split("?")[1]))} page={d.page} pageCount={Math.max(1, Math.ceil(d.total / d.pageSize))} total={d.total} noun="tickets" param="dpag" />
            </>
          )}
        </section>
      );
    }
    const d = await bugsDetail(actorId, q, ref, period, page);
    return (
      <section className="card" aria-label="Detalle de bugs vinculados">
        <p><Link href={close}>← Cerrar detalle</Link></p>
        <h2>Bugs vinculados a tickets creados en el periodo · {d.period.label}</h2>
        {staleNotice(d.reference.stamp)}
        {!d.supported ? <Notice kind="info">Las implantaciones no identifican tickets, y con ello tampoco bugs vinculados.</Notice> : (
          <>
            <p className="hint">Solo vínculos explícitos resueltos a un Cliente externo y no rechazados. Es una cohorte de tickets, no la fecha de aparición o cierre del defecto.</p>
            <div className="table-wrap"><table><thead><tr><th scope="col">Producto</th><th scope="col">Ámbito DevOps</th><th scope="col">ID</th><th scope="col">Título</th><th scope="col">Estado</th><th scope="col">Tickets vinculados</th></tr></thead>
              <tbody>{d.rows.map((r) => <tr key={`${r.product}${r.scopeKey}${r.workItemId}`}><td>{r.product}</td><td>{r.scopeKey}</td><td>{r.workItemId}</td><td>{r.title}</td><td>{r.state}{r.stateKnown ? "" : " (estado no catalogado)"}</td><td>{r.tickets.map((t) => `${t.ticketId} (${t.type ?? "—"}, ${fdate(t.created)})`).join(" · ")}</td></tr>)}</tbody></table></div>
            <Pager base="/analisis-cliente" params={Object.fromEntries(new URLSearchParams(hrefTo({ det: "bugs", periodo: period }).split("?")[1]))} page={d.page} pageCount={Math.max(1, Math.ceil(d.total / d.pageSize))} total={d.total} noun="bugs" param="dpag" />
          </>
        )}
      </section>
    );
  } catch (e) {
    return <Notice kind="error"><strong>No se pudo abrir el detalle.</strong> {e instanceof Error ? e.message : "Error inesperado."} <Link href={close}>Volver a la ficha</Link></Notice>;
  }
}
export { qs };
