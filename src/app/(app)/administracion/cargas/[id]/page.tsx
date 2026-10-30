import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageAdmin } from "@/lib/session";
import { getUpload, listStagedRows } from "@/server/uploads/batches";
import { listUploadHistory } from "@/server/uploads/history";
import { COUNTER_DEFINITIONS, STATUS_LABEL, TERMINAL_STATUSES, type UploadStatusName } from "@/domain/cargas";
import { first, formatDateTime, qs, type SearchParams } from "@/lib/format";
import { formatDate } from "@/domain/vigencia";
import { Pager } from "@/components/list";
import { HistorySection } from "../../clientes/_sections/sections";
import { ActionButtons } from "./action-buttons";
import { StatusPoller } from "./poller";
import { ZendeskPanels } from "./zendesk-panels";
import { Csapp04Panels } from "./csapp04-panels";
import { FinancePanel } from "./finance-panel";

export const metadata: Metadata = { title: "Ficha de carga" };
const BASE = "/administracion/cargas";
const CLASS_LABEL = { VALID: "Válida", ERROR: "Con error", EXCLUDED: "Excluida" } as const;

const iso = (d: Date | null) => (d ? formatDate(d.toISOString().slice(0, 10)) : "—");
const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`);
const cell = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

export default async function CargaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const user = await requirePageAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const data = await getUpload(user.id, id);
  if (!data) notFound();
  const { batch: b, actions, profile, sameChecksum } = data;
  const st = b.status as UploadStatusName;
  const cls = ["VALID", "ERROR", "EXCLUDED"].includes(first(sp.clase)) ? (first(sp.clase) as "VALID" | "ERROR" | "EXCLUDED") : undefined;
  const onlyWarnings = first(sp.avisos) === "1";
  const pp = Number(first(sp.page)) || 1;
  const hp = Number(first(sp.hp)) || 1;
  const det = first(sp.det);
  const flag = first(sp.flag);
  const dp = Number(first(sp.dp)) || 1;
  const corr = first(sp.corr);
  const target = first(sp.target);
  const tf = { ticket: first(sp.tf_ticket) || undefined, person: first(sp.tf_person) || undefined, from: first(sp.tf_from) || undefined, to: first(sp.tf_to) || undefined, text: first(sp.tf_text) || undefined };
  const showRows = ["READY", "ACTIVATION_QUEUED", "ACTIVATING", "COMPLETED", "REVERTED", "FAILED"].includes(st) && b.rowsReceived > 0;
  const [rows, history] = await Promise.all([
    showRows ? listStagedRows(user.id, id, { page: pp, pageSize: 20, classification: cls, onlyWarnings }) : null,
    listUploadHistory(user.id, id, { page: hp }),
  ]);
  const summary = (b.summary ?? {}) as { schemaVersion?: string; sheet?: string; notes?: string[]; issues?: { severity: string; code: string; message: string; count: number }[] };
  const meta = Object.entries((b.metadata ?? {}) as Record<string, unknown>).filter(([k]) => !k.startsWith("__"));
  const keep = { clase: cls, avisos: onlyWarnings ? "1" : "" };
  const zdKeep = { ...keep, page: pp > 1 ? pp : undefined, hp: hp > 1 ? hp : undefined };
  const prepared = b.preparedAt !== null;
  const terminal = TERMINAL_STATUSES.includes(st);

  const counters: [keyof typeof COUNTER_DEFINITIONS, string, number][] = [
    ["rowsReceived", "Recibidas", b.rowsReceived],
    ["rowsError", "Con error", b.rowsError],
    ["rowsValid", "Válidas", b.rowsValid],
    ["rowsDuplicate", "Duplicadas", b.rowsDuplicate],
    ["rowsExcluded", "Excluidas", b.rowsExcluded],
    ["rowsReviewed", "Revisadas", b.rowsReviewed],
    ["rowsWarning", "Con aviso", b.rowsWarning],
    ["rowsImported", "Importadas", b.rowsImported],
  ];

  return (
    <>
      <p><Link href={BASE}>← Volver a Cargas</Link></p>
      <h1>{b.originalName}</h1>
      <StatusPoller
        id={b.id}
        label={STATUS_LABEL[st]}
        initial={{ status: b.status, phase: b.phase, rowsProcessed: b.rowsProcessed, version: b.version, terminal, busy: data.pendingRederive || data.pendingRevert }}
      />
      {b.statusDetail ? <p className="notice notice-error" role="alert">{b.statusDetail}</p> : null}
      {sameChecksum.length > 0 ? (
        <p className="notice notice-info" role="note">
          Aviso: este archivo tiene el mismo checksum que {sameChecksum.length === 1 ? "otro lote" : "otros lotes"} anterior
          {sameChecksum.length === 1 ? "" : "es"}:{" "}
          {sameChecksum.map((s) => <Link key={s.id} href={`${BASE}/${s.id}`}>{s.originalName}</Link>).reduce<React.ReactNode[]>((acc, x, i) => (i ? [...acc, ", ", x] : [x]), [])}.
          Subirlo otra vez no duplica registros activos: las filas idénticas se materializan una vez.
        </p>
      ) : null}

      <section className="card" aria-labelledby="sec-acciones">
        <h2 id="sec-acciones">Acciones</h2>
        {st === "READY" && b.rowsError > 0 ? (
          <p className="notice notice-info" role="note">
            {actions.confirm.allowed
              ? `Hay ${b.rowsError.toLocaleString("es-ES")} filas con error: no se activarán. El resto de filas válidas sí se activa al confirmar.`
              : `Hay ${b.rowsError.toLocaleString("es-ES")} filas con errores obligatorios: corrija el archivo y vuelva a subirlo. Estas filas no activan datos inválidos.`}
          </p>
        ) : null}
        {!prepared && !terminal ? <p className="muted">La preparación no ha terminado: no se puede confirmar todavía.</p> : null}
        <ActionButtons id={b.id} version={b.version} actions={actions} completed={st === "COMPLETED"} />
      </section>

      <section className="card" aria-labelledby="sec-datos">
        <h2 id="sec-datos">Datos del lote</h2>
        <dl className="kv">
          <dt>Fuente</dt><dd>{profile?.label ?? b.profileId} (v{b.profileVersion}{summary.schemaVersion ? `, esquema ${summary.schemaVersion}` : ""})</dd>
          <dt>Política</dt><dd>{profile ? (profile.policy === "REPLACE_SCOPE" ? "Sustitución atómica por ámbito" : "Incorporación y revisión") : "—"}</dd>
          <dt>Tamaño</dt><dd>{mb(b.sizeBytes)} ({b.fileFormat.toUpperCase()})</dd>
          <dt>Checksum SHA-256</dt><dd><code style={{ wordBreak: "break-all" }}>{b.checksum ?? "—"}</code></dd>
          <dt>Autor de la carga</dt><dd>{b.createdBy.email}</dd>
          <dt>Fecha de carga</dt><dd>{formatDateTime(b.createdAt)}</dd>
          <dt>Extracción declarada</dt><dd>{iso(b.declaredExtractionDate)}</dd>
          <dt>Intervalo declarado</dt><dd>{b.declaredFrom || b.declaredTo ? `${iso(b.declaredFrom)} a ${iso(b.declaredTo)}` : "—"}</dd>
          <dt>Cobertura conocida</dt><dd>{b.coverageNote ?? "—"}</dd>
          {meta.map(([k, v]) => <><dt key={`k${k}`}>{k}</dt><dd key={`v${k}`}>{cell(v)}</dd></>)}
          <dt>Fase</dt><dd>{b.phase ?? "—"}</dd>
        </dl>
        <p className="muted">
          La fecha de carga, la extracción declarada y la cobertura son datos distintos: la extracción no se deduce de las fechas del contenido.{" "}
          <a href={`/api/cargas/${b.id}/archivo`}>Descargar el archivo original</a> (solo Administrador).
        </p>
      </section>

      <section className="card" aria-labelledby="sec-contadores">
        <h2 id="sec-contadores">Resumen de filas</h2>
        {!prepared && !terminal ? (
          <p className="muted">Filas leídas hasta ahora: {b.rowsProcessed.toLocaleString("es-ES")}. El total no se conoce hasta terminar de leer el archivo, por eso no se muestra un porcentaje.</p>
        ) : null}
        <div className="table-wrap">
          <table>
            <caption className="skip">Contadores del lote</caption>
            <thead><tr><th>Concepto</th><th>Filas</th><th>Definición</th></tr></thead>
            <tbody>
              {counters.map(([k, label, n]) => (
                <tr key={k}>
                  <td>{label}</td>
                  <td>{k === "rowsImported" && st !== "COMPLETED" && st !== "REVERTED" ? "—" : n.toLocaleString("es-ES")}</td>
                  <td className="muted">{COUNTER_DEFINITIONS[k]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {summary.notes && summary.notes.length > 0 ? (
          <ul className="muted" aria-label="Notas del esquema">{summary.notes.map((nt) => <li key={nt}>{nt}</li>)}</ul>
        ) : null}
        {summary.issues && summary.issues.length > 0 ? (
          <>
            <h3>Incidencias por código</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Tipo</th><th>Código</th><th>Mensaje</th><th>Filas</th></tr></thead>
                <tbody>
                  {summary.issues.map((i) => (
                    <tr key={`${i.severity}${i.code}`}>
                      <td><span className={i.severity === "error" ? "badge badge-warn" : "badge"}>{i.severity === "error" ? "Error" : "Aviso"}</span></td>
                      <td><code>{i.code}</code></td><td>{i.message}</td><td>{i.count.toLocaleString("es-ES")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      {prepared && !["REJECTED", "CANCELLED"].includes(st) ? (
        <>
          <ZendeskPanels userId={user.id} batch={{ id: b.id, profileId: b.profileId, status: st, version: b.version }} base={`${BASE}/${b.id}`} det={det} flag={flag} dp={dp} keep={zdKeep} corr={corr} target={target} tf={tf} />
          <Csapp04Panels userId={user.id} batch={{ id: b.id, profileId: b.profileId, status: st, version: b.version }} base={`${BASE}/${b.id}`} det={det} flag={flag} dp={dp} keep={zdKeep} corr={corr} target={target} tf={tf} />
        </>
      ) : null}

      {prepared && !["REJECTED", "CANCELLED"].includes(st) ? (
        <FinancePanel batch={{ id: b.id, profileId: b.profileId, status: st, version: b.version, supersedesBatchId: b.supersedesBatchId, supersededByBatchId: b.supersededByBatchId, declaredExtractionDate: b.declaredExtractionDate, createdAt: b.createdAt }} base={`${BASE}/${b.id}`} />
      ) : null}

      {rows ? (
        <section className="card" aria-labelledby="sec-previsualizacion">
          <h2 id="sec-previsualizacion">Previsualización</h2>
          <p className="muted">Vista limitada y paginada del staging: no altera los datos activos.</p>
          <form className="toolbar" action={`${BASE}/${b.id}`} method="get">
            <div className="field">
              <label htmlFor="clase">Clasificación</label>
              <select id="clase" name="clase" defaultValue={cls ?? ""}>
                <option value="">Todas</option>
                {Object.entries(CLASS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div className="field field-check">
              <input id="avisos" name="avisos" type="checkbox" value="1" defaultChecked={onlyWarnings} />
              <label htmlFor="avisos">Solo con aviso</label>
            </div>
            <button className="btn btn-primary" type="submit">Filtrar</button>
          </form>
          {rows.rows.length === 0 ? (
            <div className="empty">Ninguna fila coincide con el filtro.</div>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <caption className="skip">Filas del staging</caption>
                  <thead><tr><th>Fila</th><th>Clasificación</th><th>Contenido original</th><th>Incidencias</th></tr></thead>
                  <tbody>
                    {rows.rows.map((r) => {
                      const raw = (r.raw as [string, string][]) ?? [];
                      const issues = (r.issues as { severity: string; code: string; message: string }[] | null) ?? [];
                      return (
                        <tr key={r.position}>
                          <td>{r.sheet ? `${r.sheet} · ` : ""}{r.sourceRow}</td>
                          <td>
                            {CLASS_LABEL[r.classification]}
                            {r.duplicateInFile ? <span className="badge"> duplicada en el archivo</span> : null}
                            {r.disposition ? <span className="badge badge-int"> {r.disposition}</span> : null}
                          </td>
                          <td><code>{raw.map((c) => (Array.isArray(c) ? c[0] : String(c ?? ""))).join(" | ")}</code></td>
                          <td>{issues.length ? issues.map((i) => `${i.severity === "error" ? "Error" : "Aviso"} ${i.code}`).join("; ") : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager base={`${BASE}/${b.id}`} params={{ ...keep, hp }} page={rows.page} pageCount={rows.pageCount} total={rows.total} />
            </>
          )}
        </section>
      ) : null}

      <HistorySection
        events={history.rows}
        total={history.total}
        page={history.page}
        pageCount={history.pageCount}
        base={`${BASE}/${b.id}${qs({ ...keep, ficha: 1 })}`}
      />
    </>
  );
}
