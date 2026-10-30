import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { authorize } from "@/server/authorize";
import { getWorkItemDetail } from "@/server/bugs/summary";
import { BUG_PROFILES, LINK_STATE_LABEL, STATE_CATALOG } from "@/domain/bugs";
import { formatDate } from "@/domain/vigencia";
import { formatDateTime } from "@/lib/format";
import { LinkReviewForm } from "../../link-review-form";

export const metadata: Metadata = { title: "Work Item" };
const BASE = "/administracion/cargas";
const SOURCE_LABEL: Record<string, string> = { ZENDESK_TICKET_ID: "Columna Zendesk Ticket ID", CLIENTS_URL: "URL de ticket en «Clients»" };

/** Detalle administrativo de un Work Item activo: revisiones, observaciones y vínculos con su evidencia y revisión explícita. */
export default async function ElementoPage({ params }: { params: Promise<{ id: string; wid: string }> }) {
  const user = await requirePageAdmin();
  const { id, wid } = await params;
  await authorize(prisma, user.id, "ADMIN");
  const b = await prisma.uploadBatch.findUnique({ where: { id }, select: { profileId: true, scopeKey: true, originalName: true } });
  const product = b?.profileId === BUG_PROFILES.VFS ? "VFS" : b?.profileId === BUG_PROFILES.VSW ? "VSW" : null;
  if (!b || !product || !/^\d+$/.test(wid)) notFound();
  const w = await prisma.workItem.findUnique({ where: { product_scopeKey_workItemId: { product, scopeKey: b.scopeKey ?? "", workItemId: wid } }, select: { id: true } });
  if (!w) notFound();
  const d = await getWorkItemDetail(user.id, w.id);
  if (!d) notFound();
  const cur = d.revisions.find((r) => r.id === d.workItem.currentRevisionId);
  return (
    <>
      <p><Link href={`${BASE}/${id}`}>← Volver a la carga «{b.originalName}»</Link></p>
      <h1>{product} · Work Item {wid}</h1>
      {cur ? (
        <section className="card" aria-labelledby="sec-wi-actual">
          <h2 id="sec-wi-actual">Revisión vigente</h2>
          <dl className="kv">
            <dt>Tipo</dt><dd>{cur.itemType}{cur.isBug ? " (defecto)" : ""}</dd>
            <dt>Título</dt><dd>{cur.title}</dd>
            <dt>State</dt><dd>{cur.state} <span className="muted">({STATE_CATALOG[cur.state.toLowerCase()]?.label ?? "fuera del catálogo: requiere revisión"})</span></dd>
            <dt>Creado (hora local de DevOps, sin zona)</dt><dd>{cur.createdLocal?.replace("T", " ") ?? "—"}</dd>
            <dt>Modificado (hora local)</dt><dd>{cur.changedLocal?.replace("T", " ") ?? "—"} <span className="muted">(no es fecha de cierre ni de despliegue)</span></dd>
            <dt>Asignado a / Reported by</dt><dd>{cur.assignedTo ?? "—"} / {cur.reportedBy ?? "—"} <span className="muted">(contexto, no asignación a clientes)</span></dd>
            <dt>Última observación</dt><dd>{d.workItem.lastObservedOn ? formatDate(d.workItem.lastObservedOn.toISOString().slice(0, 10)) : "—"}</dd>
          </dl>
        </section>
      ) : <p className="notice notice-info" role="note">Este Work Item no tiene una revisión vigente (solo conserva vínculos revisados manualmente).</p>}
      <section className="card" aria-labelledby="sec-wi-vinculos" data-testid="wi-vinculos">
        <h2 id="sec-wi-vinculos">Vínculos con tickets</h2>
        <p className="muted">La decisión manual es independiente de lo que observe cada CSV: cargar otro archivo no la borra. Un vínculo no cambia la causa raíz del ticket.</p>
        {d.links.length === 0 ? <div className="empty">Sin vínculos con tickets.</div> : (
          <div className="table-wrap">
            <table>
              <caption className="skip">Vínculos del Work Item</caption>
              <thead><tr><th>Ticket</th><th>Resolución</th><th>Evidencia observada</th><th>En la última fotografía</th><th>Decisión manual</th><th>Revisión</th></tr></thead>
              <tbody>
                {d.links.map((l) => (
                  <tr key={l.id}>
                    <td>{l.ticketId}{l.drvTicketType ? <span className="muted"> ({l.drvTicketType})</span> : null}</td>
                    <td>{LINK_STATE_LABEL[l.drvState] ?? l.drvState}{l.clientName ? ` · ${l.clientName}` : ""}{l.groupName ? ` · ${l.groupName}` : ""}</td>
                    <td>{(l.evidence ?? []).map((e) => `${SOURCE_LABEL[e.source] ?? e.source} (${formatDate(e.observedOn)})`).join("; ") || "—"}</td>
                    <td>{l.observedInCurrent ? "Sí" : "No (evidencia histórica)"}</td>
                    <td>{l.manualState === "CONFIRMED" ? "Confirmado" : l.manualState === "REJECTED" ? "Rechazado" : "Sin revisar"}{l.manualAt ? <span className="muted"> ({formatDateTime(l.manualAt)})</span> : null}</td>
                    <td><LinkReviewForm batchId={id} workItemId={wid} linkId={l.id} version={l.version} current={l.manualState} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card" aria-labelledby="sec-wi-historia">
        <h2 id="sec-wi-historia">Revisiones y observaciones</h2>
        <ul>
          {d.revisions.map((r) => <li key={String(r.id)}>Revisión {r.revisionNo}: {r.state}{r.changedFields.length ? ` (cambia: ${r.changedFields.join(", ")})` : " (primera)"}</li>)}
        </ul>
        <p className="muted">{d.observations.length} observación(es): {d.observations.slice(0, 8).map((o) => formatDate(o.observedOn.toISOString().slice(0, 10))).join(", ")}{d.observations.length > 8 ? "…" : ""}.</p>
      </section>
    </>
  );
}
