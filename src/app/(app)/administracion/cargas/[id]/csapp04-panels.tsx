import Link from "next/link";
import { qs } from "@/lib/format";
import { formatDate } from "@/domain/vigencia";
import { BUG_PROFILES, LINK_STATE_LABEL, VIEW_LABEL } from "@/domain/bugs";
import { PAP_PROFILE } from "@/domain/pap";
import { WRIKE_BUCKETS, WRIKE_BUCKET_ACTION, WRIKE_BUCKET_LABEL, WRIKE_FLAG_LABEL, WRIKE_PROFILE } from "@/domain/wrike";
import { BUG_FILTERS, bugsSummary, listBatchBugs } from "@/server/bugs/summary";
import { PAP_FILTERS, listBatchPap, papSummary } from "@/server/pap/summary";
import { listBatchWrike, wrikeSummary } from "@/server/wrike/summary";
import { CorrectionPanel } from "./correction-panel";
import type { PanelProps } from "./zendesk-panels";

const f = (n: number) => n.toLocaleString("es-ES");
const hrs = (h: string | null | undefined) => Number(h ?? 0).toLocaleString("es-ES", { maximumFractionDigits: 4 });

function Pager({ base, params, page, pageCount, total, anchor }: { base: string; params: Record<string, string | number | undefined>; page: number; pageCount: number; total: number; anchor: string }) {
  return (
    <nav className="pager" aria-label="Paginación del detalle">
      <span>{f(total)} {total === 1 ? "resultado" : "resultados"}</span>
      {page > 1 ? <Link className="btn btn-secondary btn-sm" href={`${base}${qs({ ...params, dp: page - 1 })}#${anchor}`}>← Anterior</Link> : null}
      <span>Página {page} de {pageCount}</span>
      {page < pageCount ? <Link className="btn btn-secondary btn-sm" href={`${base}${qs({ ...params, dp: page + 1 })}#${anchor}`}>Siguiente →</Link> : null}
    </nav>
  );
}

function Stale({ preview }: { preview: { computedAt: Date; stale: boolean } | null }) {
  if (!preview?.stale) return null;
  return (
    <p className="notice notice-info" role="note" data-testid="zd-obsoleta">
      Los maestros o las fuentes relacionadas han cambiado desde que se calcularon estos vínculos ({new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" }).format(preview.computedAt)}).
      Use <strong>Reprocesar</strong> para recalcularlos; la activación siempre usa los datos actuales.
    </p>
  );
}

const ROLE = (flag: string) => (flag.startsWith("ROLE:") ? `Rol PMO ${flag.slice(5)}` : (WRIKE_FLAG_LABEL[flag] ?? flag));

// ---------------------------------------------------------------- Wrike

async function WrikePanel({ userId, batch, base, det, flag, dp, keep, corr, target, tf }: PanelProps) {
  const s = await wrikeSummary(userId, batch.id);
  if (!s) return null;
  const known = [...WRIKE_BUCKETS, "UNIMPUTED", "ERROR"] as string[];
  const bucket = known.includes(det) ? det : undefined;
  const list = await listBatchWrike(userId, batch.id, { page: dp, pageSize: 20, bucket, flag: flag || undefined });
  const ready = batch.status === "READY";
  const t = s.tickets;
  const link = (key: string, n: number) => (n > 0 ? <Link href={`${base}${qs({ ...keep, det: key })}#sec-wr-detalle`}>{f(n)}</Link> : f(n));
  return (
    <>
      {ready && corr ? <CorrectionPanel userId={userId} batchId={batch.id} batchVersion={batch.version} base={base} corr={corr} target={target} tf={tf} keep={keep} /> : null}
      <section className="card" aria-labelledby="sec-wr-resumen" data-testid="wr-resumen">
        <h2 id="sec-wr-resumen">Resumen de dedicación Wrike</h2>
        <Stale preview={s.preview} />
        <p className="muted">
          Dedicación en horas decimales (0,5 h = 30 min; no se divide entre 60). Cada fila válida cae en un único motivo principal: las horas no se cuentan dos veces ni
          se mezclan con Zendesk. {s.source === "registros" ? "Cifras de los registros materializados." : "Previsualización con los maestros y tickets actuales."}
        </p>
        <p className="notice notice-info" role="note">
          Política histórica: antes del 01/01/2025 el tiempo viene de Zendesk (Wrike se conserva sin sustituirlo); desde el 01/01/2025 solo el tiempo de personas PMO viene de Wrike.
          Un PMO desconocido no se asume.
        </p>
        <div className="table-wrap">
          <table data-testid="wr-particion">
            <caption className="skip">Partición contable de las filas y horas del lote</caption>
            <thead><tr><th>Motivo principal</th><th>Filas</th><th>Horas</th><th>Qué hacer</th></tr></thead>
            <tbody>
              {s.buckets.map((b) => (
                <tr key={b.bucket}>
                  <td>{WRIKE_BUCKET_LABEL[b.bucket]}</td>
                  <td>{link(b.bucket, b.rows)}</td>
                  <td>{hrs(b.hours)}</td>
                  <td className="muted">{b.rows > 0 ? WRIKE_BUCKET_ACTION[b.bucket] : "—"}</td>
                </tr>
              ))}
              <tr><th scope="row">Total de la partición</th><th>{f(s.partitionRows)}</th><th>{hrs(String(Number(s.partitionMinutes) / 60))}</th><th>{s.reconciled ? <span className="badge badge-ok">Concilia con las filas válidas</span> : <span className="badge badge-warn">No concilia</span>}</th></tr>
            </tbody>
          </table>
        </div>
        <p className="muted">
          Filas recibidas {f(s.rowsReceived)} = con error {link("ERROR", s.rowsWithError)} + tareas sin imputación {link("UNIMPUTED", s.unimputedTasks)} (sin usuario ni fecha y con cero horas: bruto conservado, fuera
          del hecho de dedicación) + válidas {f(s.validRows)} ({hrs(s.validHours)} h).
        </p>
        <h3>Ticket de las filas materializables</h3>
        <div className="table-wrap">
          <table>
            <caption className="skip">Origen del ticket</caption>
            <thead><tr><th>Situación</th><th>Filas</th></tr></thead>
            <tbody>
              <tr><td>Ticket explícito confirmado</td><td>{f(t.explicitConfirmed)}</td></tr>
              <tr><td>Ticket extraído del nombre (inferido) y confirmado</td><td>{f(t.byName)}</td></tr>
              <tr><td>Explícito citado, todavía no cargado (pendiente)</td><td>{f(t.pendingExplicit)}</td></tr>
              <tr><td>Inferido del nombre, todavía no cargado (candidata pendiente)</td><td>{f(t.pendingByName)}</td></tr>
              <tr><td>Varios candidatos en el nombre (ninguno elegido)</td><td>{f(t.ambiguous)}</td></tr>
              <tr><td>Notación de ticket explícito no válida</td><td>{f(t.invalid)}</td></tr>
              <tr><td>Nombre cita otro ticket distinto del campo explícito (prevalece el campo)</td><td>{f(t.contradictions)}</td></tr>
              <tr><td>Sin ticket</td><td>{f(t.none)}</td></tr>
            </tbody>
          </table>
        </div>
        {s.roles.length > 0 ? (
          <>
            <h3>Rol PMO (ANA/DEV)</h3>
            <div className="table-wrap">
              <table>
                <caption className="skip">Dedicación por rol PMO</caption>
                <thead><tr><th>Rol</th><th>Filas</th><th>Horas</th></tr></thead>
                <tbody>{s.roles.map((r) => <tr key={r.role}><td>{r.role}</td><td>{f(r.rows)}</td><td>{hrs(r.hours)}</td></tr>)}</tbody>
              </table>
            </div>
          </>
        ) : null}
        {s.flags.length > 0 ? (
          <>
            <h3>Indicadores secundarios</h3>
            <p className="muted">Marcas sobre las filas, no horas adicionales: una fila puede tener varias.</p>
            <div className="table-wrap">
              <table>
                <caption className="skip">Indicadores secundarios</caption>
                <thead><tr><th>Indicador</th><th>Filas</th><th>Horas (no se suman a la partición)</th></tr></thead>
                <tbody>
                  {s.flags.map((x) => (
                    <tr key={x.flag}><td><Link href={`${base}${qs({ ...keep, flag: x.flag })}#sec-wr-detalle`}>{ROLE(x.flag)}</Link></td><td>{f(x.rows)}</td><td>{hrs(x.hours)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      <section className="card" aria-labelledby="sec-wr-detalle" data-testid="wr-detalle">
        <h2 id="sec-wr-detalle">Filas del lote</h2>
        {ready && s.pendingCorrections > 0 ? <p className="notice notice-info" role="note">{f(s.pendingCorrections)} fila(s) con una decisión obsoleta esperan que decida de nuevo.</p> : null}
        <form className="toolbar" action={base} method="get">
          {Object.entries(keep).filter(([k, v]) => v !== undefined && v !== "" && k !== "det" && k !== "flag").map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}
          <div className="field">
            <label htmlFor="det">Motivo</label>
            <select id="det" name="det" defaultValue={bucket ?? ""}>
              <option value="">Todos</option>
              {WRIKE_BUCKETS.map((k) => <option key={k} value={k}>{WRIKE_BUCKET_LABEL[k]}</option>)}
              <option value="UNIMPUTED">Tareas sin imputación</option>
              <option value="ERROR">Filas con error</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="flag">Indicador</label>
            <select id="flag" name="flag" defaultValue={flag}>
              <option value="">Cualquiera</option>
              {Object.entries(WRIKE_FLAG_LABEL).map(([k, l]) => <option key={k} value={k}>{l.split(" (")[0]}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" type="submit">Filtrar</button>
        </form>
        {list.rows.length === 0 ? <div className="empty">Ninguna fila coincide con el filtro.</div> : (
          <>
            <div className="table-wrap">
              <table>
                <caption className="skip">Filas del lote Wrike</caption>
                <thead><tr><th>Fila</th><th>Usuario</th><th>Proyecto</th><th>Tarea</th><th>Ticket</th><th>Día</th><th>Horas</th><th>Motivo</th><th>Indicadores</th>{ready ? <th>Corrección</th> : null}</tr></thead>
                <tbody>
                  {list.rows.map((r) => (
                    <tr key={r.position}>
                      <td>{r.sourceRow}</td>
                      <td>{r.user_name ?? "—"}</td>
                      <td>{r.project ?? "—"}</td>
                      <td>{r.task ? (r.task.length > 80 ? `${r.task.slice(0, 80)}…` : r.task) : "—"}</td>
                      <td>{r.ticket_text ?? "—"}</td>
                      <td>{r.work_date ? formatDate(r.work_date) : "—"}</td>
                      <td>{r.hours === null ? "—" : hrs(r.hours)}</td>
                      <td>{r.bucket === "UNIMPUTED" ? "Tarea sin imputación" : r.bucket === "ERROR" ? "Con error" : (WRIKE_BUCKET_LABEL[r.bucket as keyof typeof WRIKE_BUCKET_LABEL] ?? r.bucket)}</td>
                      <td>{(r.flags ?? []).map((x) => ROLE(x).split(" (")[0]).join("; ") || "—"}</td>
                      {ready ? <td>{r.fingerprint && ["NEW", "PENDING_DECISION", "CORRECTION"].includes(r.disposition ?? "") ? <Link href={`${base}${qs({ ...keep, corr: r.fingerprint })}#sec-correccion`}>Relacionar con un registro</Link> : "—"}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager base={base} params={{ ...keep, det: bucket, flag: flag || undefined }} page={list.page} pageCount={list.pageCount} total={list.total} anchor="sec-wr-detalle" />
          </>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------- PAP

const PAP_FILTER_LABEL: Record<string, string> = {
  corrective: "Correctivos",
  "non-corrective": "No correctivos confirmados",
  "unknown-cause": "Causa sin clasificar",
  "no-production-date": "Sin fecha de producción",
  revision: "Revisiones de PAP existentes",
  unmapped: "Proyecto sin equivalencia",
  "group-only": "Solo Grupo Cliente",
  "pending-ticket": "Con tickets asociados todavía no cargados",
  unparsed: "Con texto de referencia no interpretable",
  "bug-ambiguous": "Nº de BUG con producto sin determinar",
};
const SCOPE_LABEL: Record<string, string> = { CLIENT: "Cliente", IMPLEMENTATION: "Implantación", GROUP_ONLY: "Solo Grupo Cliente (sin reparto entre Clientes)", NO_PROJECT: "Sin proyecto", UNMAPPED: "Proyecto sin equivalencia" };
const CAUSE_LABEL: Record<string, string> = { CORRECTIVE: "Correctivo", EVOLUTIVE: "Evolutivo", MAINTENANCE: "Mantenimiento", OTHER: "Otras etiquetas (sin clasificar)" };
const ORIGIN_LABEL: Record<string, string> = {
  STANDARD: "Estándar", CUSTOMIZATION: "Personalización", CONFIG_DATA: "Configuración/datos", PROCESSES: "Procesos", INFRASTRUCTURE: "Infraestructura", CLIENT_ORIGIN: "Origen cliente", OTHER_CORRECTIVE: "Otro correctivo",
};

async function PapPanel({ userId, batch, base, det, dp, keep }: PanelProps) {
  const s = await papSummary(userId, batch.id);
  if (!s) return null;
  const filter = (PAP_FILTERS as readonly string[]).includes(det) ? det : undefined;
  const list = await listBatchPap(userId, batch.id, { page: dp, pageSize: 20, filter });
  const link = (key: string, n: number) => (n > 0 ? <Link href={`${base}${qs({ ...keep, det: key })}#sec-pap-detalle`}>{f(n)}</Link> : f(n));
  const done = batch.status === "COMPLETED";
  return (
    <>
      <section className="card" aria-labelledby="sec-pap-resumen" data-testid="pap-resumen">
        <h2 id="sec-pap-resumen">Resumen de PAP</h2>
        <Stale preview={s.preview} />
        <p className="muted">
          Lista de origen: <strong>{s.listKey}</strong>. La identidad es la lista + el ID del inicio del título; el resto del título puede cambiar sin ser otra intervención.
          Un PAP con varias causas o varios tickets sigue siendo uno: los desgloses se solapan y no se suman.
        </p>
        {!s.freshnessKnown ? (
          <p className="notice notice-info" role="note">No se declaró la fecha de extracción: la observación se registra con la fecha de recepción ({formatDate(s.observedOn)}) y la frescura es desconocida.</p>
        ) : <p className="muted">Fecha de observación: extracción declarada {formatDate(s.observedOn)}.</p>}
        {s.olderThanCurrent > 0 ? <p className="notice notice-info" role="note">{f(s.olderThanCurrent)} PAP tienen una observación vigente más reciente de otro lote: esta se conserva como histórico y no la sobrescribe.</p> : null}
        {s.sameDayObservations > 0 ? <p className="notice notice-info" role="note">{f(s.sameDayObservations)} PAP tienen otra observación con la misma fecha: se resuelve por la recepción del lote (criterio explícito; el orden es incierto).</p> : null}
        <div className="table-wrap">
          <table>
            <caption className="skip">Resumen de PAP del lote</caption>
            <thead><tr><th>Concepto</th><th>PAP</th></tr></thead>
            <tbody>
              <tr><td>Filas recibidas / con error / duplicadas en el archivo</td><td>{f(s.rowsReceived)} / {f(s.rowsWithError)} / {f(s.duplicatesInFile)}</td></tr>
              <tr><td>PAP distintos (cada uno cuenta una vez)</td><td>{f(s.distinctPap)}</td></tr>
              <tr><td>Nuevos</td><td>{f(s.newPap)}</td></tr>
              <tr><td>Revisiones de un PAP existente</td><td>{link("revision", s.revisedPap)}</td></tr>
              <tr><td>Sin cambios (solo observación)</td><td>{f(s.unchangedPap)}</td></tr>
              <tr><td>Correctivos únicos (cualquiera de sus causas lo es)</td><td>{link("corrective", s.corrective)}</td></tr>
              <tr><td>No correctivos confirmados</td><td>{link("non-corrective", s.nonCorrective)}</td></tr>
              <tr><td>Causa vacía o sin clasificar (no es «no correctivo» confirmado)</td><td>{link("unknown-cause", s.unknownCause)}</td></tr>
              <tr><td>Con fecha de producción (periodo)</td><td>{f(s.withProductionDate)}{s.productionFrom ? ` (${formatDate(s.productionFrom)} a ${formatDate(s.productionTo ?? s.productionFrom)})` : ""}</td></tr>
              <tr><td>Sin fecha de producción (conservados, sin ejecución inventada)</td><td>{link("no-production-date", s.withoutProductionDate)}{s.unreadableProductionDate > 0 ? ` · ${f(s.unreadableProductionDate)} con fecha ilegible` : ""}</td></tr>
              <tr><td>Sin fecha de solicitud (válido)</td><td>{f(s.withoutRequestDate)}</td></tr>
            </tbody>
          </table>
        </div>
        <h3>Pertenencias por familia de causa (no aditivas)</h3>
        <div className="table-wrap">
          <table>
            <caption className="skip">PAP distintos por familia de causa</caption>
            <thead><tr><th>Familia</th><th>PAP distintos</th></tr></thead>
            <tbody>{s.memberships.map((m) => <tr key={m.category}><td>{CAUSE_LABEL[m.category] ?? m.category}</td><td>{f(m.pap)}</td></tr>)}</tbody>
          </table>
        </div>
        {s.origins.length > 0 ? (
          <>
            <h3>Correctivos por origen (no aditivos; el origen cliente se conserva)</h3>
            <div className="table-wrap">
              <table>
                <caption className="skip">PAP correctivos distintos por origen</caption>
                <thead><tr><th>Origen</th><th>PAP distintos</th></tr></thead>
                <tbody>{s.origins.map((o) => <tr key={o.origin}><td>{ORIGIN_LABEL[o.origin] ?? o.origin}</td><td>{f(o.pap)}</td></tr>)}</tbody>
              </table>
            </div>
          </>
        ) : null}
        <h3>Resultado (información y filtro; no se impone OK)</h3>
        <ul className="muted">{s.results.map((r) => <li key={r.result}>{r.result}: {f(r.pap)}</li>)}</ul>
        <p className="muted">La «Duración» es texto del origen y no se suma a las horas de Zendesk ni de Wrike (podría ser el mismo trabajo).</p>
        <h3>Ámbito por Proyecto (a la fecha de producción)</h3>
        <div className="table-wrap">
          <table>
            <caption className="skip">PAP por ámbito del proyecto</caption>
            <thead><tr><th>Ámbito</th><th>PAP</th></tr></thead>
            <tbody>
              {s.scopes.map((x) => <tr key={x.scope}><td>{SCOPE_LABEL[x.scope] ?? x.scope}</td><td>{["UNMAPPED", "NO_PROJECT"].includes(x.scope) ? link("unmapped", x.pap) : x.scope === "GROUP_ONLY" ? link("group-only", x.pap) : f(x.pap)}</td></tr>)}
            </tbody>
          </table>
        </div>
        {s.scopeContradictions > 0 ? <p className="notice notice-info" role="note">{f(s.scopeContradictions)} PAP citan tickets de un Cliente de otro Grupo distinto del de su proyecto: se muestra la contradicción y no se sobrescribe el contexto del proyecto.</p> : null}
        <h3>Referencias</h3>
        <div className="table-wrap">
          <table>
            <caption className="skip">Referencias de los PAP</caption>
            <thead><tr><th>Referencia</th><th>Cantidad</th></tr></thead>
            <tbody>
              <tr><td>Pares PAP–ticket distintos (Tickets asociados y Ticket PAP Asociado, con rol propio)</td><td>{f(s.refs.ticketPairs)}</td></tr>
              <tr><td>… con ticket ya cargado / todavía no cargado (se resolverá al cargarlo)</td><td>{f(s.refs.ticketsKnown)} / {link("pending-ticket", s.refs.ticketsPending)}</td></tr>
              <tr><td>Texto no interpretable (conservado con su motivo)</td><td>{link("unparsed", s.refs.unparsed)}</td></tr>
              <tr><td>CAL&apos;s asociados (no son tickets Zendesk)</td><td>{f(s.refs.cal)}</td></tr>
              <tr><td>Nº de BUG: referencias distintas / con producto explícito / resueltas a un Work Item {done ? "" : "(con los bugs cargados hoy)"}</td><td>{f(s.refs.bugRefs)} / {f(s.refs.bugExplicit)} / {f(s.refs.bugResolved)}</td></tr>
              <tr><td>Nº de BUG con producto sin determinar (un número suelto no decide VFS o VSW)</td><td>{link("bug-ambiguous", s.refs.bugAmbiguousProduct)}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" aria-labelledby="sec-pap-detalle" data-testid="pap-detalle">
        <h2 id="sec-pap-detalle">PAP del lote</h2>
        <form className="toolbar" action={base} method="get">
          {Object.entries(keep).filter(([k, v]) => v !== undefined && v !== "" && k !== "det").map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}
          <div className="field">
            <label htmlFor="det">Filtro</label>
            <select id="det" name="det" defaultValue={filter ?? ""}>
              <option value="">Todos los PAP distintos</option>
              {PAP_FILTERS.map((k) => <option key={k} value={k}>{PAP_FILTER_LABEL[k]}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" type="submit">Filtrar</button>
        </form>
        {list.rows.length === 0 ? <div className="empty">Ningún PAP coincide con el filtro.</div> : (
          <>
            <div className="table-wrap">
              <table>
                <caption className="skip">PAP del lote</caption>
                <thead><tr><th>Fila</th><th>ID</th><th>Título</th><th>Proyecto</th><th>Producción</th><th>Resultado</th><th>Causas</th><th>Ámbito</th><th>Disposición</th></tr></thead>
                <tbody>
                  {list.rows.map((r) => (
                    <tr key={r.position}>
                      <td>{r.sourceRow}</td><td>{r.pap_id}</td><td>{r.title.length > 70 ? `${r.title.slice(0, 70)}…` : r.title}</td><td>{r.project ?? "—"}</td>
                      <td>{r.production_date ? formatDate(r.production_date) : "sin fecha"}</td><td>{r.result ?? "—"}</td>
                      <td>{r.causes.map((c) => c.raw).join("; ") || "sin causa"} <span className="badge">{r.corrective === "CORRECTIVE" ? "correctivo" : r.corrective === "NON_CORRECTIVE" ? "no correctivo" : "sin clasificar"}</span></td>
                      <td>{SCOPE_LABEL[r.scope ?? "UNMAPPED"] ?? r.scope}</td><td>{r.disposition ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager base={base} params={{ ...keep, det: filter }} page={list.page} pageCount={list.pageCount} total={list.total} anchor="sec-pap-detalle" />
          </>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------- Bugs

const BUG_FILTER_LABEL: Record<string, string> = {
  bugs: "Solo Bug_ (defectos)",
  "not-bug": "Otros tipos (Request, Enhancement…)",
  "no-links": "Bug_ sin afectación identificada (sin ticket vinculado)",
  "pending-ticket": "Con ticket todavía no cargado",
  central: "Con ticket central interno",
  "unknown-state": "Estado fuera del catálogo (requiere revisión)",
  revision: "Revisiones de un elemento existente",
};
const CATEGORY_LABEL: Record<string, string> = {
  NEW: "New", SELECTED: "Selected", IN_PROGRESS: "In Progress", BLOCKED: "Blocked", PR_PENDING: "PR: desarrollo terminado, pendiente de crear la pull request",
  READY_FOR_RELEASE: "Done (Ready for Release): pendiente de entrega, no acredita despliegue", TERMINAL: "Estado terminal configurado", PENDING_REVIEW: "Fuera del catálogo: requiere revisión",
};

async function BugsPanel({ userId, batch, base, det, dp, keep }: PanelProps) {
  const s = await bugsSummary(userId, batch.id);
  if (!s) return null;
  const filter = (BUG_FILTERS as readonly string[]).includes(det) ? det : undefined;
  const list = await listBatchBugs(userId, batch.id, { page: dp, pageSize: 20, filter });
  const link = (key: string, n: number) => (n > 0 ? <Link href={`${base}${qs({ ...keep, det: key })}#sec-bug-detalle`}>{f(n)}</Link> : f(n));
  const done = batch.status === "COMPLETED";
  return (
    <>
      <section className="card" aria-labelledby="sec-bug-resumen" data-testid="bug-resumen">
        <h2 id="sec-bug-resumen">Resumen de bugs {s.product}</h2>
        <Stale preview={s.preview} />
        <p className="muted">
          Producto <strong>{s.product}</strong>, ámbito DevOps <strong>{s.scopeKey?.split("|")[1] ?? "principal"}</strong>. Vista declarada: <strong>{VIEW_LABEL[s.view ?? ""] ?? "no declarada"}</strong>.
          {s.declared.from || s.declared.to ? ` Intervalo: ${s.declared.from ? formatDate(s.declared.from) : "…"} a ${s.declared.to ? formatDate(s.declared.to) : "…"}.` : ""}
          {s.declared.coverage ? ` Cobertura: ${s.declared.coverage}.` : ""}
        </p>
        {!s.freshnessKnown ? (
          <p className="notice notice-info" role="note">No se declaró la fecha de extracción: la observación se registra con la fecha de recepción ({formatDate(s.observedOn)}) y la frescura de la fotografía es desconocida.</p>
        ) : <p className="muted">Fecha de observación: extracción declarada {formatDate(s.observedOn)}.</p>}
        {s.olderThanCurrent > 0 ? <p className="notice notice-info" role="note">{f(s.olderThanCurrent)} elementos tienen una observación vigente más reciente de otro lote: esta se conserva como histórico y no la sobrescribe.</p> : null}
        <p className="notice notice-info" role="note" data-testid="bug-no-observados">
          La ausencia en esta vista no cierra, borra ni resuelve ningún Work Item: {f(s.notObservedInThisView.items)} elemento(s) de este producto y ámbito conocidos no están en esta fotografía
          {s.notObservedInThisView.items > 0 && s.notObservedInThisView.lastObservedFrom
            ? ` (última observación entre ${formatDate(s.notObservedInThisView.lastObservedFrom)} y ${formatDate(s.notObservedInThisView.lastObservedTo ?? s.notObservedInThisView.lastObservedFrom)})`
            : ""}
          ; se rotulan como no observados en esta vista y no cuentan como abiertos actuales confirmados. Una fotografía estrecha no sustituye la cobertura de una más amplia.
        </p>
        <div className="table-wrap">
          <table>
            <caption className="skip">Resumen de bugs del lote</caption>
            <thead><tr><th>Concepto</th><th>Elementos</th></tr></thead>
            <tbody>
              <tr><td>Filas recibidas / con error / duplicadas en el archivo</td><td>{f(s.rowsReceived)} / {f(s.rowsWithError)} / {f(s.duplicatesInFile)}</td></tr>
              <tr><td>Work Items distintos</td><td>{f(s.distinctItems)}</td></tr>
              <tr><td>Nuevos / revisados / sin cambios (solo observación)</td><td>{f(s.newItems)} / {link("revision", s.revisedItems)} / {f(s.unchangedItems)}</td></tr>
              <tr><td>Bug_ distintos (solo estos participan en defectos)</td><td>{link("bugs", s.bugs)}</td></tr>
              <tr><td>Estados fuera del catálogo (se conservan; ni abiertos ni cerrados)</td><td>{link("unknown-state", s.unknownStates)}</td></tr>
              <tr><td>Bug_ sin afectación identificada (sin ticket vinculado)</td><td>{link("no-links", s.bugsWithoutLinks)}</td></tr>
              <tr><td>Pares Work Item–ticket distintos (una URL repetida no los multiplica)</td><td>{f(s.linkPairs)}</td></tr>
            </tbody>
          </table>
        </div>
        <h3>Elementos por tipo</h3>
        <div className="table-wrap">
          <table>
            <caption className="skip">Work Items por tipo</caption>
            <thead><tr><th>Work Item Type</th><th>Elementos</th></tr></thead>
            <tbody>{s.byType.map((t) => <tr key={t.type}><td>{t.type}</td><td>{f(t.items)}</td></tr>)}</tbody>
          </table>
        </div>
        <h3>Bug_ por estado (el estado del Work Item es independiente del status de Zendesk; Changed Date no es fecha de cierre)</h3>
        <div className="table-wrap">
          <table>
            <caption className="skip">Bug_ por estado</caption>
            <thead><tr><th>State original</th><th>Etapa</th><th>Bug_</th></tr></thead>
            <tbody>{s.bugsByState.map((b) => <tr key={b.state}><td>{b.state}</td><td className="muted">{CATEGORY_LABEL[b.category] ?? b.category}</td><td>{f(b.bugs)}</td></tr>)}</tbody>
          </table>
        </div>
        <h3>Vínculos con tickets {done ? "" : "(con los tickets cargados hoy)"}</h3>
        <div className="table-wrap">
          <table>
            <caption className="skip">Vínculos por estado de resolución</caption>
            <thead><tr><th>Situación</th><th>Pares</th></tr></thead>
            <tbody>
              {s.linksByState.map((l) => <tr key={l.state}><td>{LINK_STATE_LABEL[l.state] ?? l.state}</td><td>{l.state === "PENDING_TICKET" ? link("pending-ticket", l.pairs) : l.state === "CENTRAL_INTERNAL" ? link("central", l.pairs) : f(l.pairs)}</td></tr>)}
              {s.linksByState.length === 0 ? <tr><td colSpan={2} className="muted">Ningún vínculo explícito en este archivo.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <p className="muted">Los vínculos son explícitos (columna Zendesk Ticket ID y URLs de tickets de «Clients»); un ticket interno es el central y no identifica a los clientes afectados. Reported by y los nombres libres son contexto, no asignaciones.</p>
      </section>

      <section className="card" aria-labelledby="sec-bug-detalle" data-testid="bug-detalle">
        <h2 id="sec-bug-detalle">Elementos del lote</h2>
        <form className="toolbar" action={base} method="get">
          {Object.entries(keep).filter(([k, v]) => v !== undefined && v !== "" && k !== "det").map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}
          <div className="field">
            <label htmlFor="det">Filtro</label>
            <select id="det" name="det" defaultValue={filter ?? ""}>
              <option value="">Todos los elementos distintos</option>
              {BUG_FILTERS.map((k) => <option key={k} value={k}>{BUG_FILTER_LABEL[k]}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" type="submit">Filtrar</button>
        </form>
        {list.rows.length === 0 ? <div className="empty">Ningún elemento coincide con el filtro.</div> : (
          <>
            <div className="table-wrap">
              <table>
                <caption className="skip">Elementos del lote de bugs</caption>
                <thead><tr><th>Fila</th><th>ID</th><th>Tipo</th><th>Título</th><th>State</th><th>Creado (hora local)</th><th>Vínculos</th><th>Disposición</th>{done ? <th>Detalle</th> : null}</tr></thead>
                <tbody>
                  {list.rows.map((r) => (
                    <tr key={r.position}>
                      <td>{r.sourceRow}</td><td>{r.wid}</td><td>{r.item_type}{r.is_bug ? <span className="badge badge-ok"> defecto</span> : null}</td>
                      <td>{r.title.length > 70 ? `${r.title.slice(0, 70)}…` : r.title}</td>
                      <td>{r.state}{!r.state_known ? <span className="badge badge-warn"> revisar</span> : null}</td>
                      <td>{r.created ? r.created.replace("T", " ") : "—"}</td>
                      <td>{(r.link_states ?? []).map((x) => LINK_STATE_LABEL[x]?.split(" (")[0] ?? x).join("; ") || "—"}</td>
                      <td>{r.disposition ?? "—"}</td>
                      {done ? <td><Link href={`${base}/elementos/${r.wid}`}>Ver y revisar vínculos</Link></td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager base={base} params={{ ...keep, det: filter }} page={list.page} pageCount={list.pageCount} total={list.total} anchor="sec-bug-detalle" />
          </>
        )}
      </section>
    </>
  );
}

export async function Csapp04Panels(props: PanelProps) {
  const id = props.batch.profileId;
  if (id === WRIKE_PROFILE) return <WrikePanel {...props} />;
  if (id === PAP_PROFILE) return <PapPanel {...props} />;
  if (id === BUG_PROFILES.VFS || id === BUG_PROFILES.VSW) return <BugsPanel {...props} />;
  return null;
}
