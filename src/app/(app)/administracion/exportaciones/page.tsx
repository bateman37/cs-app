import type { Metadata } from "next";
import { requirePageAdmin } from "@/lib/session";
import { superviseExports } from "@/server/exports/service";
import { exportConfig } from "@/server/exports/config";

export const metadata: Metadata = { title: "Exportaciones" };
export const dynamic = "force-dynamic";
const LABEL: Record<string, string> = { QUEUED: "En cola", PREPARING: "Preparando", GENERATING: "Generando", READY: "Listo", FAILED: "Fallido", CANCELLED: "Cancelado", EXPIRED: "Caducado" };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid" }) : "—");

/** Supervisión técnica: estados de todas las exportaciones. No habilita descargar archivos ajenos (cada persona descarga los suyos desde la vista de origen). */
export default async function ExportacionesAdminPage() {
  const user = await requirePageAdmin();
  const s = await superviseExports(user.id, 100);
  const cfg = exportConfig();
  return (
    <>
      <h1>Exportaciones</h1>
      <p className="muted">Supervisión técnica de las exportaciones completas. Solo se muestran estados y progreso; no se pueden descargar los archivos de otra persona desde aquí.</p>
      {!s.workerAlive && (s.counts.QUEUED ?? 0) > 0 ? <p className="notice notice-warn" role="alert">Hay exportaciones en cola y ningún trabajador activo: inicie el trabajador (<code>npm run worker</code>).</p> : null}
      <p>{Object.entries(s.counts).map(([k, v]) => `${LABEL[k] ?? k}: ${v}`).join(" · ") || "Sin exportaciones."} · trabajador {s.workerAlive ? "activo" : "sin latido reciente"}</p>
      <p className="hint">Límites técnicos iniciales: {cfg.maxActivePerUser} activas por persona, {cfg.maxActiveTotal} en total, {cfg.maxRows.toLocaleString("es-ES")} filas, partes de {cfg.partRows.toLocaleString("es-ES")} filas, vida útil {cfg.ttlHours} h. Caducar elimina solo artefactos y materialización; el registro mínimo se conserva.</p>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Exportaciones (desplazable)">
        <table>
          <caption className="visually-hidden">Exportaciones de todas las personas</caption>
          <thead><tr><th scope="col">Creada</th><th scope="col">Solicitante</th><th scope="col">Conjunto</th><th scope="col">Periodo</th><th scope="col">Estado</th><th scope="col">Progreso</th><th scope="col">Intentos</th><th scope="col">Detalle</th></tr></thead>
          <tbody>
            {s.jobs.map((j) => (
              <tr key={j.id}>
                <td>{when(j.createdAt)}</td><td>{j.owner.email}</td><td>{j.datasetLabel}</td><td>{j.query.desde} – {j.query.hasta}</td><td>{LABEL[j.status] ?? j.status}{j.phase ? ` · ${j.phase}` : ""}</td>
                <td>{j.progressTotal ? `${Number(j.progressDone).toLocaleString("es-ES")} / ${Number(j.progressTotal).toLocaleString("es-ES")}` : "—"}</td><td>{j.attempts}/{j.maxAttempts}</td>
                <td>{j.lastError ?? ""}{j.material?.laterThanScreen ? " lectura posterior a la pantalla" : ""}{j.expiresAt ? ` caduca ${when(j.expiresAt)}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
