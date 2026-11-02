import Link from "next/link";
import { DIAGNOSIS_ACTION, DIAGNOSIS_FAMILIES, DIAGNOSIS_LABEL, UNIT_LABEL, BACKLOG_UNIT, type DiagnosisFamily } from "@/domain/quality-config";
import { COVERAGE_SOURCE_LABEL } from "@/domain/quality-coverage";
import { qualityToParams, type QualityQuery } from "@/domain/quality-query";
import { qs } from "@/lib/format";
import { Pager, fdate } from "@/components/analytics/ui";
import type { BacklogView, DiagnosisView, DiagRow } from "@/server/quality/detail";
import type { QualityView } from "@/server/quality/engine";
import { num } from "./ui";

const FAM = (f: string) => DIAGNOSIS_LABEL[f as DiagnosisFamily] ?? f;

export function ContextCard({ v }: { v: QualityView }) {
  const p = v.period;
  return (
    <div className="card" aria-label="Contexto del cálculo">
      <dl className="kv">
        <dt>Mes y corte</dt>
        <dd>
          Mes {String(p.month).padStart(2, "0")}/{p.year} · fecha solicitada {fdate(p.requested)} · corte efectivo <strong>{fdate(p.cut)}</strong> {p.provisional ? <span className="badge badge-warn">provisional (mes no cerrado)</span> : <span className="badge badge-ok">mes completo</span>}
          {p.clamped ? <> · <small>el corte pedido era posterior a hoy</small></> : null}
        </dd>
        <dt>Resultado global</dt><dd>Mensual: Health del mes, flujos del mismo periodo y stock observado compatible. No hay global anual: el CUM y el año anterior son contextos técnicos de evolución.</dd>
        <dt>Configuración</dt>
        <dd>
          Calidad {v.config.revisionNo}{v.config.persisted ? "" : " (inicial, sin activaciones)"} · perfiles de Pulse {v.pulseRevision} · economía {v.manifest.economic}
          {v.config.adapterNotes.length ? <> · <span className="badge badge-int">leída de v1 mediante adaptador</span></> : null}
          {v.config.simulated ? <> · <span className="badge badge-warn">borrador (simulación)</span></> : null}
        </dd>
        <dt>Cobertura declarada</dt>
        <dd>{Object.values(v.coverage).map((c) => <span key={c.source} className={`badge ${c.state === "COMPLETE" ? "badge-ok" : c.state === "PARTIAL" ? "badge-warn" : "badge-off"}`} title={c.reason}>{COVERAGE_SOURCE_LABEL[c.source]}: {c.state === "COMPLETE" ? "completa" : c.state === "PARTIAL" ? "parcial" : "sin declarar"}</span>)}{" "}<small>Un cero solo se sustenta con cobertura declarada de todos los clientes (Administración › Cargas).</small></dd>
        <dt>Backlog (fotografía)</dt>
        <dd>
          {v.backlog.exact ? <>Fotografía del propio corte ({fdate(v.backlog.observedOn)}).</> : v.backlog.provisional ? <>Observado el {fdate(v.backlog.observedOn)} (política elegida; provisional, no es el valor del corte).</> : <span className="badge badge-off">sin fotografía compatible del corte</span>}{" "}
          <small>{v.backlog.note}</small>
        </dd>
        <dt>Datos</dt><dd>Sello <code>{v.stamp}</code> · leído {new Date(v.readAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })} · {v.filteredEntities} de {v.totalEntities} entidades con los filtros de filas</dd>
      </dl>
    </div>
  );
}

export function Cards({ c, label }: { c: QualityView["cards"]; label?: string }) {
  return (
    <ul className="cards" aria-label={label ?? "Resumen de la cartera filtrada"}>
      <li className="card"><strong>{c.green}</strong><br />Global verde</li>
      <li className="card"><strong>{c.yellow}</strong><br />Global amarillo</li>
      <li className="card"><strong>{c.red}</strong><br />Global rojo</li>
      <li className="card"><strong>{c.noGlobal}</strong><br />Sin global calculable<br /><small>{c.uncalibrated} pendientes de calibración · {c.dataPending} de datos</small></li>
    </ul>
  );
}

function Matrix({ m, title, first, link }: { m: DiagnosisView["typeByFamily"]; title: string; first: string; link: (fam: string) => string }) {
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={`${title} (desplazable)`}>
      <table>
        <caption>{title}</caption>
        <thead><tr><th scope="col">{first}</th>{m.cols.map((c) => <th key={c} scope="col"><Link href={link(c)}>{FAM(c)}</Link></th>)}</tr></thead>
        <tbody>{m.rows.map((r) => <tr key={r}><th scope="row">{r}</th>{m.cols.map((c) => <td key={c}>{m.cells[`${r}|${c}`] ?? 0}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function DiagnosisSection({ d, q, basePath, rows }: { d: DiagnosisView; q: QualityQuery; basePath: string; rows: { rows: DiagRow[]; total: number; page: number; pageCount: number } | null }) {
  const link = (fam: string) => `${basePath}${qs(qualityToParams({ ...q, view: "diagnostico", fam }))}`;
  return (
    <section aria-labelledby="dg">
      <h2 id="dg">Diagnóstico por origen {d.scopeName ? `· ${d.scopeName}` : "· cartera"} · {fdate(d.period.from)} – {fdate(d.period.to)}</h2>
      {d.notes.map((n) => <p key={n} className="hint">{n}</p>)}
      {d.totals.tickets === 0 ? <div className="empty">Sin tickets creados en el periodo para este ámbito (esto no prueba cero: depende de la cobertura declarada).</div> : (
        <>
          <p>Tickets del periodo por <strong>identidad única</strong>: {d.totals.tickets}. Cada ticket se cuenta una vez en su familia; las familias de PAP pueden solaparse. Pendientes: {d.pending.noCause} sin causa registrada · {d.pending.infraNoHosting} de infraestructura sin alojamiento vigente{d.pending.unmapped.length ? ` · causas sin correspondencia: ${d.pending.unmapped.join(", ")}` : ""}.</p>
          <Matrix m={d.typeByFamily} title="Type × familia de causa (tickets creados en el periodo)" first="type" link={link} />
          <Matrix m={d.envByFamily} title="Entorno/tipología × familia de causa (señal frente a diagnóstico registrado)" first="Entorno y tipología" link={link} />
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Familias: horas, N3 y orientación (desplazable)">
            <table>
              <caption>Por familia: escalados N3, horas y orientación</caption>
              <thead><tr><th scope="col">Familia</th><th scope="col">Escalados N3</th><th scope="col">Horas elegibles</th><th scope="col">Orientación (hipótesis de revisión)</th></tr></thead>
              <tbody>{DIAGNOSIS_FAMILIES.filter((f) => d.n3ByFamily[f] !== undefined || d.hoursByFamily[f] !== undefined).map((f) => <tr key={f}><th scope="row"><Link href={link(f)}>{FAM(f)}</Link></th><td>{d.n3ByFamily[f] ?? 0}</td><td>{num(d.hoursByFamily[f] ?? "0")} h</td><td>{DIAGNOSIS_ACTION[f]}</td></tr>)}</tbody>
            </table>
          </div>
          <p>PAP del periodo por origen (no aditivo; total por identidad {d.papTotalUnique}): {d.papByOrigin.length ? d.papByOrigin.map((p) => `${p.origin} ${p.count}`).join(" · ") : "sin PAP con causa"}.</p>
        </>
      )}
      {rows ? (
        <div>
          <h3>Tickets de «{FAM(q.fam)}» ({rows.total})</h3>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Tickets de la familia (desplazable)">
            <table>
              <caption className="visually-hidden">Tickets de la familia</caption>
              <thead><tr><th scope="col">Ticket</th><th scope="col">type</th><th scope="col">Creación</th><th scope="col">Status</th><th scope="col">Entorno y tipología</th><th scope="col">Causa registrada</th><th scope="col">N3</th><th scope="col">Vínculo a bug</th></tr></thead>
              <tbody>{rows.rows.map((t) => <tr key={t.ticketId}><td>{t.ticketId}</td><td>{t.type}</td><td>{fdate(t.created)}</td><td>{t.status}</td><td>{t.entorno ?? "—"}</td><td>{t.cause ?? <span className="badge badge-off">sin causa</span>}</td><td>{t.n3 ? "sí" : "no"}</td><td>{t.bugLink ? "sí" : "no"}</td></tr>)}</tbody>
            </table>
          </div>
          <Pager base={basePath} params={qualityToParams({ ...q, view: "diagnostico" })} page={rows.page} pageCount={rows.pageCount} total={rows.total} noun="tickets" />
        </div>
      ) : <p className="hint">Elija una familia para ver sus tickets (el detalle usa los mismos predicados que la matriz y totaliza todas sus filas).</p>}
    </section>
  );
}

export function BacklogSection({ b, q, basePath }: { b: BacklogView; q: QualityQuery; basePath: string }) {
  return (
    <section aria-labelledby="bk">
      <h2 id="bk">Tickets sin resolver y antigüedad {b.scopeName ? `· ${b.scopeName}` : "· cartera"}</h2>
      {b.notes.map((n) => <p key={n} className="notice notice-info">{n}</p>)}
      {!b.stats ? <div className="empty">Sin fotografía compatible: el stock no está disponible (no se rellena con el estado actual ni se interpola). Un Administrador puede declarar la cobertura de un lote en Administración › Cargas.</div> : (
        <>
          <p>Observado el <strong>{fdate(b.observedOn)}</strong> · usuarios de ese mes: {b.usersAtD ?? "sin informar"} · edad = días naturales entre la creación y esa observación (no tiempo en estado ni desde el escalado); envejecido = edad &gt; umbral ({b.thresholds.incident ?? "sin configurar"} d incidentes · {b.thresholds.problem ?? "sin configurar"} d problemas).</p>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Estadísticos por tipo (desplazable)">
            <table>
              <caption>Stock por tipo</caption>
              <thead><tr><th scope="col">Tipo</th><th scope="col">Activos</th><th scope="col">Mediana</th><th scope="col">P90</th><th scope="col">Máxima</th><th scope="col">Envejecidos</th><th scope="col">% envejecido</th><th scope="col">Activos {UNIT_LABEL[BACKLOG_UNIT]}</th><th scope="col">Envejecidos {UNIT_LABEL[BACKLOG_UNIT]}</th><th scope="col">Bandas</th></tr></thead>
              <tbody>
                {(["incident", "problem"] as const).map((t) => {
                  const s = b.stats![t];
                  return <tr key={t}><th scope="row">{t === "incident" ? "Incidentes" : "Problemas"}</th><td>{s.count}</td><td>{s.count ? num(s.median) : "n/a"}</td><td>{s.count ? num(s.p90) : "n/a"}</td><td>{s.max ?? "n/a"}</td><td>{s.aged}</td><td>{s.agedPct === null ? "n/a" : `${num(s.agedPct, 1)} %`}</td><td>{s.per100 === null ? "sin usuarios" : num(s.per100)}</td><td>{s.agedPer100 === null ? "sin usuarios" : num(s.agedPer100)}</td><td>{s.bands.map((x) => `${x.label}: ${x.n}`).join(" · ") || "sin bandas configuradas"}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
          <p className="hint">Stock y flujo de altas se presentan separados y no se suman. Otros: {b.other.resolved} resueltos/cerrados · {b.other.questionTask} question/task · {b.other.unknownStatus} con estado desconocido (limitan la cobertura) · {b.other.invalidDates} con creación posterior a la observación.</p>
          <h3>Detalle de tickets ({b.total})</h3>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Tickets activos (desplazable)">
            <table>
              <caption className="visually-hidden">Tickets activos de la fotografía</caption>
              <thead><tr><th scope="col">Ticket</th><th scope="col">Tipo</th><th scope="col">Status</th><th scope="col">Creación</th><th scope="col">Observación</th><th scope="col">Edad (días)</th><th scope="col">Envejecido</th><th scope="col">Motivo</th><th scope="col">Origen</th></tr></thead>
              <tbody>{b.rows.map((t) => <tr key={t.ticketId}><td>{t.ticketId}</td><td>{t.type}</td><td>{t.status}</td><td>{fdate(t.created)}</td><td>{fdate(t.observedOn)}</td><td>{t.age}</td><td>{t.aged ? <span className="badge badge-warn">sí</span> : "no"}</td><td>{t.reason}</td><td>{FAM(t.family)}</td></tr>)}</tbody>
            </table>
          </div>
          <Pager base={basePath} params={qualityToParams({ ...q, view: "backlog" })} page={b.page} pageCount={b.pageCount} total={b.total} noun="tickets" />
        </>
      )}
    </section>
  );
}
