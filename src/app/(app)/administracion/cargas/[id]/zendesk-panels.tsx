import Link from "next/link";
import { qs } from "@/lib/format";
import { formatDate } from "@/domain/vigencia";
import {
  DESTINATION_LABEL,
  TIME_BUCKETS,
  TIME_BUCKET_ACTION,
  TIME_BUCKET_LABEL,
  TIME_FLAG_LABEL,
  ZENDESK_TICKETS_PROFILE,
  ZENDESK_TIME_PROFILE,
  type TimeBucket,
} from "@/domain/zendesk";
import {
  TICKET_FILTERS,
  TICKET_FILTER_LABEL,
  listBatchTickets,
  listBatchTimes,
  listCorrectionCandidates,
  ticketsSummary,
  timesSummary,
  type TicketFilter,
} from "@/server/zendesk/summary";
import { CorrectionPanel } from "./correction-panel";
import { DecisionButtons } from "./correction-form";

const f = (n: number) => n.toLocaleString("es-ES");
const hrs = (h: string) => Number(h).toLocaleString("es-ES", { maximumFractionDigits: 4 });

function DetailPager({ base, params, page, pageCount, total }: { base: string; params: Record<string, string | number | undefined>; page: number; pageCount: number; total: number }) {
  return (
    <nav className="pager" aria-label="Paginación del detalle">
      <span>{f(total)} {total === 1 ? "resultado" : "resultados"}</span>
      {page > 1 ? <Link className="btn btn-secondary btn-sm" href={`${base}${qs({ ...params, dp: page - 1 })}#sec-zd-detalle`}>← Anterior</Link> : null}
      <span>Página {page} de {pageCount}</span>
      {page < pageCount ? <Link className="btn btn-secondary btn-sm" href={`${base}${qs({ ...params, dp: page + 1 })}#sec-zd-detalle`}>Siguiente →</Link> : null}
    </nav>
  );
}

function StaleNotice({ preview, done }: { preview: { computedAt: Date; stale: boolean } | null; done: boolean }) {
  if (!preview?.stale) return null;
  return (
    <p className="notice notice-info" role="note" data-testid="zd-obsoleta">
      Los maestros{done ? "" : " o los tickets"} han cambiado desde que se calcularon estos vínculos ({new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" }).format(preview.computedAt)}).
      Use <strong>Reprocesar</strong> para recalcularlos{done ? "" : "; al confirmar, la activación siempre usa los datos actuales"}.
    </p>
  );
}

export type PanelProps = {
  userId: string;
  batch: { id: string; profileId: string; status: string; version: number };
  base: string;
  det: string;
  flag: string;
  dp: number;
  keep: Record<string, string | number | undefined>;
  corr: string;
  target: string;
  tf: { ticket?: string; person?: string; from?: string; to?: string; text?: string };
};
type Props = PanelProps;

export async function ZendeskPanels(props: Props) {
  if (props.batch.profileId === ZENDESK_TICKETS_PROFILE) return <TicketsPanel {...props} />;
  if (props.batch.profileId === ZENDESK_TIME_PROFILE) return <TimesPanel {...props} />;
  return null;
}

// ---------------------------------------------------------------- Tickets

async function TicketsPanel({ userId, batch, base, det, dp, keep }: Props) {
  const s = await ticketsSummary(userId, batch.id);
  if (!s) return null;
  const filter = (TICKET_FILTERS as readonly string[]).includes(det) ? (det as TicketFilter) : undefined;
  const list = await listBatchTickets(userId, batch.id, { page: dp, pageSize: 20, filter });
  const link = (key: TicketFilter, n: number) => (n > 0 ? <Link href={`${base}${qs({ ...keep, det: key })}#sec-zd-detalle`}>{f(n)}</Link> : f(n));
  const done = batch.status === "COMPLETED";
  const dest = s.tagsDestinations;
  const rows: [string, React.ReactNode, string][] = [
    ["Filas recibidas", f(s.rowsReceived), "Filas de datos del libro. No son tickets: un ticket puede aparecer varias veces."],
    ["Duplicados exactos en el archivo", f(s.duplicatesInFile), "Filas idénticas (tags como conjunto): se materializan una vez y conservan su procedencia."],
    ["Tickets distintos", f(s.distinctTickets), "Un ticket_id es una entidad aunque cambien su estado, causa, organización o tags."],
    ["Nuevos", link("new", s.newTickets), "ticket_id que todavía no existía."],
    ["Revisados", link("revised", s.revised), "Mismo ticket_id con contenido distinto: crea una revisión con sus diferencias."],
    ["Sin cambios (solo observación)", link("unchanged", s.unchanged), "Su contenido coincide con una revisión ya registrada: solo se añade la observación, sin otro ticket ni otra actividad."],
    ["Observaciones " + (done ? "registradas" : "a registrar"), f(s.observations), "Una por ticket distinto: presencia y estado del ticket en esta extracción. Un cambio de estado no es un ticket nuevo."],
    ["Observación anterior a la vigente", link("older", s.olderThanCurrent), "Se conserva como histórico y no sustituye el estado vigente de otro lote más reciente."],
    ["Sin organización informada", link("org_none", s.orgNone), "El ticket se conserva; no hay Cliente que resolver."],
    ["Organización sin Cliente equivalente", link("org_no_client", s.orgNoClient), "Añada la equivalencia en Maestros y use Reprocesar. No se crean clientes por el nombre."],
    ["Cliente sin Grupo BC", link("client_no_group", s.clientNoGroup), "El Cliente sigue identificado; solo su agrupación económica queda pendiente."],
    ["Internos", link("internal", s.internal), "Clientes internos (VINCLE, VINCLE BUGS, pruebas…): contexto de producto, fuera del semáforo de clientes."],
    ["Externos", link("external", s.external), "Clientes externos resueltos."],
    ["Clasificación incompleta", link("incomplete", s.incomplete), "Sin causa raíz, con type/status no clasificado o incidente_infraestructura sin alojamiento conocido a la fecha de creación."],
  ];
  return (
    <>
      <section className="card" aria-labelledby="sec-zd-resumen" data-testid="zd-resumen">
        <h2 id="sec-zd-resumen">Resumen de tickets</h2>
        <StaleNotice preview={s.preview} done={done} />
        {!s.freshnessKnown ? (
          <p className="notice notice-info" role="note">
            No se declaró la fecha de extracción: la observación se registra con la fecha de recepción ({formatDate(s.observedOn)}) y la frescura del dato es desconocida.
          </p>
        ) : (
          <p className="muted">Fecha de observación: extracción declarada {formatDate(s.observedOn)}.</p>
        )}
        {s.olderThanCurrent > 0 ? (
          <p className="notice notice-info" role="note">
            {f(s.olderThanCurrent)} {s.olderThanCurrent === 1 ? "ticket tiene" : "tickets tienen"} una observación vigente más reciente de otro lote: esta extracción se conserva como histórico y no la sobrescribe.
            La vigencia se resuelve por fecha de observación, después por recepción del lote y por último por orden de activación (nunca por posición de fila).
          </p>
        ) : null}
        {s.sameDayObservations > 0 ? (
          <p className="notice notice-info" role="note">
            {f(s.sameDayObservations)} {s.sameDayObservations === 1 ? "ticket tiene" : "tickets tienen"} otra observación con la misma fecha: no puede saberse cuál es más reciente por la
            fecha, así que se resuelve por la recepción del lote (criterio explícito; el orden es incierto).
          </p>
        ) : null}
        <div className="table-wrap">
          <table>
            <caption className="skip">Resumen de tickets del lote</caption>
            <thead><tr><th>Concepto</th><th>Tickets / filas</th><th>Qué significa</th></tr></thead>
            <tbody>
              {rows.map(([label, value, help]) => (
                <tr key={label}><td>{label}</td><td>{value}</td><td className="muted">{help}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Escalados por tag exacto</h3>
        <p className="muted">Mes de análisis futuro: creación con los tags conocidos a la extracción; no hay fecha de evento de escalado.</p>
        <div className="table-wrap">
          <table>
            <caption className="skip">Destinos por tag</caption>
            <thead><tr><th>Destino</th><th>Tickets</th></tr></thead>
            <tbody>
              {Object.entries(DESTINATION_LABEL).map(([k, label]) => (
                <tr key={k}><td>{label}</td><td>{f(dest[k] ?? 0)}</td></tr>
              ))}
              <tr><td>Unión N3 (PMO o IT, un ticket una vez)</td><td>{f(dest.N3_UNION ?? 0)}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" aria-labelledby="sec-zd-detalle" data-testid="zd-detalle">
        <h2 id="sec-zd-detalle">Tickets del lote</h2>
        <form className="toolbar" action={base} method="get">
          {Object.entries(keep).filter(([k, v]) => v !== undefined && v !== "" && k !== "det").map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}
          <div className="field">
            <label htmlFor="det">Filtro</label>
            <select id="det" name="det" defaultValue={filter ?? ""}>
              <option value="">Todos los tickets distintos</option>
              {TICKET_FILTERS.map((k) => <option key={k} value={k}>{TICKET_FILTER_LABEL[k]}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" type="submit">Filtrar</button>
        </form>
        {list.rows.length === 0 ? (
          <div className="empty">Ningún ticket coincide con el filtro.</div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <caption className="skip">Tickets del lote</caption>
                <thead><tr><th>Fila de origen</th><th>Ticket</th><th>Estado / tipo</th><th>Organización · Cliente · Grupo</th><th>Causa</th><th>Incidente Vincle</th><th>Lote</th></tr></thead>
                <tbody>
                  {list.rows.map((r) => (
                    <tr key={r.position}>
                      <td>{r.sheet ? `${r.sheet} · ` : ""}{r.sourceRow}</td>
                      <td>{done ? <Link href={`${base}/tickets/${r.ticket_id}`}>{r.ticket_id}</Link> : r.ticket_id}</td>
                      <td>{r.status} / {r.type}</td>
                      <td>
                        {r.org ?? "sin organización"} · {r.client_name ?? "sin Cliente"}{r.internal ? <span className="badge badge-int"> interno</span> : null} · {r.group_name ?? "sin Grupo BC"}
                      </td>
                      <td>{r.cause ?? "sin informar"}</td>
                      <td>{r.incident_class === "PENDIENTE" ? "clasificación pendiente" : r.incident_class === "INCIDENTE_VINCLE" ? "sí" : "no"}</td>
                      <td>{r.disposition === "NEW" ? "nuevo" : r.disposition === "REVISION" ? "revisión" : r.disposition === "DUPLICATE_EXISTING" ? "sin cambios" : "—"}{r.older ? <span className="badge"> histórico</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DetailPager base={base} params={{ ...keep, det: filter }} page={list.page} pageCount={list.pageCount} total={list.total} />
          </>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------- Tiempos

async function TimesPanel({ userId, batch, base, det, flag, dp, keep, corr, target, tf }: Props) {
  const s = await timesSummary(userId, batch.id);
  if (!s) return null;
  const bucket = (TIME_BUCKETS as readonly string[]).includes(det) ? (det as TimeBucket) : undefined;
  const [list, candidates] = await Promise.all([
    listBatchTimes(userId, batch.id, { page: dp, pageSize: 20, bucket, flag: flag || undefined }),
    listCorrectionCandidates(userId, batch.id),
  ]);
  const ready = batch.status === "READY";
  return (
    <>
      {ready && corr ? <CorrectionPanel userId={userId} batchId={batch.id} batchVersion={batch.version} base={base} corr={corr} target={target} tf={tf} keep={keep} /> : null}
      <section className="card" aria-labelledby="sec-zd-resumen" data-testid="zd-resumen">
        <h2 id="sec-zd-resumen">Resumen de horas</h2>
        <StaleNotice preview={s.preview} done={false} />
        <p className="muted">
          Dedicación = logged_hours + logged_minutes / 60 (la hora del registro no es duración). Cada fila válida cae en un único motivo principal, de modo que las
          horas no se suman dos veces. {s.source === "registros" ? "Cifras de los registros materializados." : "Previsualización con los maestros y tickets actuales."}
        </p>
        <p className="notice notice-info" role="note">
          Las horas de PMO desde el 01/01/2025 no se toman de Zendesk: corresponden a la fuente Wrike (cárguela en esta misma pantalla). Se conservan aquí como trazabilidad,
          sin sumarse, y no se rellenan con ceros.
        </p>
        <div className="table-wrap">
          <table>
            <caption className="skip">Partición contable de las horas del lote</caption>
            <thead><tr><th>Motivo principal</th><th>Filas</th><th>Horas</th><th>Qué hacer</th></tr></thead>
            <tbody>
              {s.buckets.map((b) => (
                <tr key={b.bucket}>
                  <td>{TIME_BUCKET_LABEL[b.bucket]}</td>
                  <td>{b.rows > 0 ? <Link href={`${base}${qs({ ...keep, det: b.bucket })}#sec-zd-detalle`}>{f(b.rows)}</Link> : "0"}</td>
                  <td>{hrs(b.hours)}</td>
                  <td className="muted">{TIME_BUCKET_ACTION[b.bucket]}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">Suma de la partición</th>
                <td data-testid="zd-suma-filas">{f(s.partitionRows)}</td>
                <td data-testid="zd-suma-horas">{hrs(String(Number(s.partitionMinutes) / 60))}</td>
                <td>{s.reconciled ? <span className="badge badge-ok">Reconcilia con las filas y horas válidas ({f(s.validRows)} filas, {hrs(s.validHours)} h)</span> : <span className="badge badge-warn">No reconcilia: avise al administrador</span>}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted">Filas con error (sin duración fiable, no se activan): {f(s.rowsWithError)}.</p>
        {s.flags.length > 0 ? (
          <>
            <h3>Indicadores secundarios</h3>
            <p className="muted">Marcas sobre las filas, no horas adicionales: una fila puede tener varias. Con Cliente resuelto aunque falte la persona: {hrs(s.withClientHours)} h.</p>
            <div className="table-wrap">
              <table>
                <caption className="skip">Indicadores secundarios</caption>
                <thead><tr><th>Indicador</th><th>Filas</th><th>Horas (no se suman a la partición)</th></tr></thead>
                <tbody>
                  {s.flags.map((x) => (
                    <tr key={x.flag}>
                      <td><Link href={`${base}${qs({ ...keep, flag: x.flag })}#sec-zd-detalle`}>{TIME_FLAG_LABEL[x.flag] ?? x.flag}</Link></td>
                      <td>{f(x.rows)}</td>
                      <td>{hrs(x.hours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      {candidates.length > 0 ? (
        <section className="card" aria-labelledby="sec-zd-correcciones" data-testid="zd-correcciones">
          <h2 id="sec-zd-correcciones">Posibles correcciones</h2>
          <p className="muted">
            Estas filas comparten id, ticket, persona y día con un registro ya importado pero su contenido es distinto. No se sustituye nada por parecido: hasta que decida,
            la fila conserva su bruto y no añade horas. El resto del lote puede activarse igualmente.
          </p>
          <div className="table-wrap">
            <table>
              <caption className="skip">Posibles correcciones del lote</caption>
              <thead><tr><th>Fila de origen</th><th>Contexto</th><th>Antes → después</th><th>Decisión</th></tr></thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.fingerprint}>
                    <td>{c.sheet ? `${c.sheet} · ` : ""}{c.sourceRow}</td>
                    <td>id {c.source_id} · ticket {c.ticket_id} · {c.user ?? "sin persona"} · {formatDate(c.work_date)}</td>
                    <td>
                      {c.matches.length === 0 ? "sin registro coincidente" : c.matches.map((m) => `${hrs(m.hours)} h`).join(" / ")} → {hrs(c.new_hours)} h
                      {c.matches.length > 0 ? <span className="muted"> (diferencia {hrs(String(Number(c.new_hours) - Number(c.matches[0].hours)))} h)</span> : null}
                    </td>
                    <td>
                      {c.decision ? <p><span className="badge badge-ok">{c.decision === "CORRECTION" ? "Corrige el registro seleccionado" : "Es otro trabajo"}</span></p> : <p><span className="badge badge-warn">Sin decidir</span></p>}
                      {ready ? (
                        <>
                          <ul className="row-actions" style={{ listStyle: "none", padding: 0 }}>
                            {c.matches.map((m) => (
                              <li key={m.id}><Link className="btn btn-secondary btn-sm" href={`${base}${qs({ ...keep, corr: c.fingerprint, target: m.id })}#sec-correccion`}>Comparar con el registro de {hrs(m.hours)} h{m.hourText ? ` (${m.hourText})` : ""}</Link></li>
                            ))}
                            <li><Link className="btn btn-secondary btn-sm" href={`${base}${qs({ ...keep, corr: c.fingerprint })}#sec-correccion`}>Elegir otro registro</Link></li>
                          </ul>
                          <DecisionButtons batchId={batch.id} fingerprint={c.fingerprint} batchVersion={batch.version} hasDecision={c.decision !== null} />
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="card" aria-labelledby="sec-zd-detalle" data-testid="zd-detalle">
        <h2 id="sec-zd-detalle">Registros de tiempo del lote</h2>
        <form className="toolbar" action={base} method="get">
          {Object.entries(keep).filter(([k, v]) => v !== undefined && v !== "" && k !== "det" && k !== "flag").map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}
          <div className="field">
            <label htmlFor="det">Motivo</label>
            <select id="det" name="det" defaultValue={bucket ?? ""}>
              <option value="">Todos</option>
              {TIME_BUCKETS.map((k) => <option key={k} value={k}>{TIME_BUCKET_LABEL[k]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="flag">Indicador</label>
            <select id="flag" name="flag" defaultValue={flag}>
              <option value="">Cualquiera</option>
              {Object.entries(TIME_FLAG_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" type="submit">Filtrar</button>
        </form>
        {list.rows.length === 0 ? (
          <div className="empty">Ningún registro coincide con el filtro.</div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <caption className="skip">Registros de tiempo del lote</caption>
                <thead><tr><th>Fila de origen</th><th>Ticket</th><th>Persona</th><th>Día de trabajo</th><th>Horas</th><th>Motivo principal</th><th>Indicadores</th>{ready ? <th>Corrección</th> : null}</tr></thead>
                <tbody>
                  {list.rows.map((r) => (
                    <tr key={r.position}>
                      <td>{r.sheet ? `${r.sheet} · ` : ""}{r.sourceRow}</td>
                      <td>{r.ticket_id}</td>
                      <td>{r.user_name ?? r.user_id ?? "sin informar"}</td>
                      <td>{formatDate(r.work_date)}</td>
                      <td>{hrs(r.hours)}</td>
                      <td>{TIME_BUCKET_LABEL[r.bucket] ?? r.bucket}</td>
                      <td>{(r.flags ?? []).map((x) => TIME_FLAG_LABEL[x]?.split(" (")[0] ?? x).join("; ") || "—"}</td>
                      {ready ? (
                        <td>{r.fingerprint && ["NEW", "PENDING_DECISION", "CORRECTION"].includes(r.disposition ?? "") ? <Link href={`${base}${qs({ ...keep, corr: r.fingerprint })}#sec-correccion`}>Relacionar con un registro</Link> : "—"}</td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DetailPager base={base} params={{ ...keep, det: bucket, flag: flag || undefined }} page={list.page} pageCount={list.pageCount} total={list.total} />
          </>
        )}
      </section>
    </>
  );
}
