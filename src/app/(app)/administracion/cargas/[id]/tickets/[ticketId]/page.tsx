import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageAdmin } from "@/lib/session";
import { formatDateTime } from "@/lib/format";
import { formatDate } from "@/domain/vigencia";
import { DESTINATION_LABEL, TIME_BUCKET_LABEL, type TimeBucket } from "@/domain/zendesk";
import { getTicketDetail } from "@/server/zendesk/summary";

export const metadata: Metadata = { title: "Ticket Zendesk" };

/** Detalle de un ticket abierto desde la ficha del lote: revisiones, observaciones y tiempos vinculados. */
export default async function TicketDetailPage({ params }: { params: Promise<{ id: string; ticketId: string }> }) {
  const user = await requirePageAdmin();
  const { id, ticketId } = await params;
  const data = await getTicketDetail(user.id, ticketId);
  if (!data) notFound();
  const back = `/administracion/cargas/${id}`;
  return (
    <>
      <p><Link href={back}>← Volver a la ficha del lote</Link></p>
      <h1>Ticket {ticketId}</h1>
      <section className="card" aria-labelledby="sec-rev">
        <h2 id="sec-rev">Revisiones de contenido</h2>
        <p className="muted">Una revisión por contenido distinto (los tags se comparan como conjunto). No hay fecha de resolución: el estado es una observación.</p>
        <div className="table-wrap">
          <table>
            <caption className="skip">Revisiones del ticket</caption>
            <thead><tr><th>Revisión</th><th>Estado / tipo</th><th>Organización</th><th>Causa raíz</th><th>Entorno y Tipología</th><th>Creado</th><th>Tags (destinos)</th><th>Cambios</th><th>Lote</th></tr></thead>
            <tbody>
              {data.revisions.map((r) => (
                <tr key={String(r.id)}>
                  <td>{r.revisionNo}{data.ticket.currentRevisionId === r.id ? <span className="badge badge-ok"> vigente</span> : null}</td>
                  <td>{r.status}{r.statusKnown ? "" : " (no clasificado)"} / {r.ticketType}{r.typeKnown ? "" : " (no clasificado)"}</td>
                  <td>{r.organizationId ?? "sin informar"}</td>
                  <td>{r.causaRaiz ?? "sin informar"}</td>
                  <td>{r.entorno ?? "sin informar"}{r.adminDelegada ? <span className="badge"> Admin delegada</span> : null}</td>
                  <td>{formatDate(r.createdOn.toISOString().slice(0, 10))}</td>
                  <td>{r.tags.join(", ") || "—"}{r.destinations.length ? ` (${r.destinations.map((d) => DESTINATION_LABEL[d] ?? d).join(", ")})` : ""}</td>
                  <td>{r.changedFields.length ? r.changedFields.join(", ") : "—"}</td>
                  <td><Link href={`/administracion/cargas/${r.batchId}`}>Abrir lote</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card" aria-labelledby="sec-obs">
        <h2 id="sec-obs">Observaciones</h2>
        <div className="table-wrap">
          <table>
            <caption className="skip">Observaciones del ticket</caption>
            <thead><tr><th>Fecha de observación</th><th>Origen de la fecha</th><th>Revisión observada</th><th>Recibido</th><th>Lote</th></tr></thead>
            <tbody>
              {data.observations.map((o) => (
                <tr key={String(o.id)}>
                  <td>{formatDate(o.observedOn.toISOString().slice(0, 10))}{data.ticket.currentObservationId === o.id ? <span className="badge badge-ok"> vigente</span> : null}</td>
                  <td>{o.observedKind === "DECLARED" ? "Extracción declarada" : "Recepción (frescura desconocida)"}</td>
                  <td>{data.revisions.find((r) => r.id === o.revisionId)?.revisionNo ?? "—"}</td>
                  <td>{formatDateTime(o.receivedAt)}</td>
                  <td><Link href={`/administracion/cargas/${o.batchId}`}>Abrir lote</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card" aria-labelledby="sec-times">
        <h2 id="sec-times">Tiempos vinculados</h2>
        {data.times.length === 0 ? <div className="empty">Este ticket no tiene horas importadas; se conserva igualmente para Calidad.</div> : (
          <div className="table-wrap">
            <table>
              <caption className="skip">Tiempos del ticket por motivo</caption>
              <thead><tr><th>Motivo principal</th><th>Registros</th><th>Horas</th></tr></thead>
              <tbody>
                {data.times.map((t) => (
                  <tr key={t.bucket}><td>{TIME_BUCKET_LABEL[t.bucket as TimeBucket] ?? t.bucket}</td><td>{t.rows}</td><td>{Number(t.hours).toLocaleString("es-ES", { maximumFractionDigits: 4 })}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
