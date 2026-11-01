import type { Metadata } from "next";
import Link from "next/link";
import { requirePageAdmin } from "@/lib/session";
import { listSources, listUploads } from "@/server/uploads/batches";
import { STATUS_LABEL, UPLOAD_STATUSES, TERMINAL_STATUSES, type UploadStatusName } from "@/domain/cargas";
import { first, formatDateTime, type SearchParams } from "@/lib/format";
import { Pager } from "@/components/list";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "Cargas" };
const BASE = "/administracion/cargas";

const BADGE: Partial<Record<UploadStatusName, string>> = {
  COMPLETED: "badge badge-ok",
  READY: "badge badge-int",
  REJECTED: "badge badge-warn",
  FAILED: "badge badge-warn",
  CANCELLED: "badge badge-off",
  REVERTED: "badge badge-off",
};

export default async function CargasPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAdmin();
  const sp = await searchParams;
  const status = UPLOAD_STATUSES.includes(first(sp.estado) as UploadStatusName) ? (first(sp.estado) as UploadStatusName) : undefined;
  const profileId = first(sp.fuente) || undefined;
  const page = Number(first(sp.page)) || 1;
  const [sources, history] = await Promise.all([listSources(user.id), listUploads(user.id, { status, profileId, page })]);
  const keep = { estado: status, fuente: profileId, page };
  const labels = new Map([...sources.available.map((s) => [s.id, s.label] as const), ...sources.pending.map((s) => [s.id, s.label] as const)]);
  return (
    <>
      <h1>Cargas</h1>
      <p className="muted">
        Motor común de importación: el archivo se guarda en almacenamiento privado, un trabajador lo valida por bloques, se muestra una
        previsualización sin tocar los datos activos y, al confirmar, otra operación atómica los activa. No hay bandeja de pendientes:
        resúmenes y avisos están en la ficha de cada lote.
      </p>

      <section className="card" aria-labelledby="sec-fuentes">
        <h2 id="sec-fuentes">Fuentes</h2>
        {sources.available.length === 0 ? (
          <div className="empty" role="note">
            <p><strong>No hay ninguna fuente disponible en esta base de datos.</strong></p>
            <p>
              Los importadores operativos de tickets y tiempos de Zendesk deberían aparecer aquí: si no lo hacen, revise que la aplicación
              y el trabajador estén construidos con la versión actual. Los perfiles sintéticos de pruebas solo se habilitan en un entorno de
              test aislado y nunca en esta base de trabajo.
            </p>
          </div>
        ) : (
          sources.available.map((s) => (
            <details key={s.id} className="edit" open={sources.available.length === 1}>
              <summary>{s.label}</summary>
              <p id={`up-${s.id}-desc`} className="muted">{s.description}</p>
              <UploadForm source={s} />
            </details>
          ))
        )}
        {sources.pending.length > 0 ? (
          <>
        <h3>Fuentes previstas (no disponibles todavía)</h3>
          <ul aria-label="Fuentes previstas">
            {sources.pending.map((p) => (
              <li key={p.id} style={{ color: "var(--muted)" }}>
                {p.label} <span className="badge badge-warn">No disponible · pendiente ({p.delivery})</span>
              </li>
            ))}
          </ul>
            </>
        ) : null}
      </section>

      <section aria-labelledby="sec-historial">
        <h2 id="sec-historial">Historial de cargas</h2>
        <form className="toolbar" action={BASE} method="get">
          <div className="field">
            <label htmlFor="estado">Estado</label>
            <select id="estado" name="estado" defaultValue={status ?? ""}>
              <option value="">Todos</option>
              {UPLOAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="fuente">Fuente</label>
            <input id="fuente" name="fuente" defaultValue={profileId ?? ""} placeholder="Identificador de la fuente" />
          </div>
          <button className="btn btn-primary" type="submit">Filtrar</button>
          <Link className="btn btn-secondary" href={BASE}>Limpiar</Link>
        </form>
        {history.rows.length === 0 ? (
          <div className="empty">{status || profileId ? "Ninguna carga coincide con los filtros." : "Todavía no se ha realizado ninguna carga."}</div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <caption className="skip">Historial de cargas</caption>
                <thead>
                  <tr><th>Archivo</th><th>Fuente</th><th>Estado</th><th>Progreso</th><th>Filas</th><th>Autor</th><th>Fecha de carga</th></tr>
                </thead>
                <tbody>
                  {history.rows.map((r) => {
                    const st = r.status as UploadStatusName;
                    return (
                      <tr key={r.id}>
                        <td><Link href={`${BASE}/${r.id}`}>{r.originalName}</Link></td>
                        <td>{labels.get(r.profileId) ?? r.profileId}</td>
                        <td><span className={BADGE[st] ?? "badge"}>{STATUS_LABEL[st]}</span></td>
                        <td>
                          {TERMINAL_STATUSES.includes(st) ? (r.statusDetail ?? "—") : `${r.phase ?? "—"} · ${r.rowsProcessed.toLocaleString("es-ES")} filas leídas`}
                        </td>
                        <td>{r.rowsReceived.toLocaleString("es-ES")} recibidas · {r.rowsError.toLocaleString("es-ES")} con error · {r.rowsImported.toLocaleString("es-ES")} importadas</td>
                        <td>{r.createdBy.email}</td>
                        <td>{formatDateTime(r.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager base={BASE} params={keep} page={history.page} pageCount={history.pageCount} total={history.total} />
          </>
        )}
      </section>
    </>
  );
}
