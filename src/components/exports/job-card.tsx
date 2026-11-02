"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/form-kit";
import { cancelExportAction, retryExportAction } from "@/app/(app)/exportaciones/actions";
import type { ExportView } from "@/server/exports/service";

const LABEL: Record<string, string> = { QUEUED: "En cola", PREPARING: "Preparando", GENERATING: "Generando", READY: "Listo", FAILED: "Fallido", CANCELLED: "Cancelado", EXPIRED: "Caducado" };
const ACTIVE = new Set(["QUEUED", "PREPARING", "GENERATING"]);
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid" }) : "—");
const fmtBytes = (b: string) => { const n = Number(b); return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`; };

/** Estado de una exportación con sondeo propio mientras está activa (progreso real por fase, anunciado con role=status). Sale y vuelve: el estado vive en el servidor. */
export function ExportJobCard({ initial, allowActions = true }: { initial: ExportView; allowActions?: boolean }) {
  const router = useRouter();
  const [job, setJob] = useState(initial);
  useEffect(() => {
    if (!ACTIVE.has(job.status) || !job.mine) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/exportaciones/${job.id}/estado`, { cache: "no-store" });
        if (!r.ok) return;
        const next = (await r.json()) as ExportView;
        setJob(next);
        if (!ACTIVE.has(next.status)) router.refresh();
      } catch { /* red caída: se reintenta en el siguiente sondeo */ }
    }, 2000);
    return () => clearInterval(t);
  }, [job.id, job.status, job.mine, router]);
  const total = job.progressTotal ? Number(job.progressTotal) : 0;
  const done = Number(job.progressDone);
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const q = job.query;
  return (
    <li className="card" style={{ listStyle: "none" }} data-export-id={job.id} data-export-status={job.status}>
      <strong>{job.datasetLabel}</strong> · {q.scope === "group" ? "Grupo Cliente" : "Cliente"}{q.sel ? ` ${q.sel}` : " (todos)"} · {q.desde} – {q.hasta} · servicio {q.servicio}
      <div role="status" aria-live="polite">
        <span className={`badge ${job.status === "READY" ? "badge-ok" : job.status === "FAILED" ? "badge-warn" : ""}`}>{LABEL[job.status] ?? job.status}</span>{" "}
        {job.phase ? <span className="muted">{job.phase}</span> : null}
        {ACTIVE.has(job.status) ? <> <progress max={100} value={job.status === "QUEUED" ? undefined : pct} aria-label={`Progreso de la exportación: ${pct} %`} /> <span>{job.status === "QUEUED" ? "esperando al trabajador" : `${done.toLocaleString("es-ES")} de ${total.toLocaleString("es-ES")} filas (${pct} %)`}</span></> : null}
        {job.cancelRequested && ACTIVE.has(job.status) ? <span className="muted"> · cancelación solicitada: se resolverá en la siguiente frontera segura</span> : null}
      </div>
      {job.workerWarning ? <p className="notice notice-warn" role="alert">{job.workerWarning}</p> : null}
      {job.lastError && (job.status === "FAILED" || job.status === "CANCELLED") ? <p className="notice notice-error" role="alert">{job.lastError}</p> : null}
      {job.material?.laterThanScreen ? (
        <p className="notice notice-warn" role="note">
          <strong>Lectura posterior a la pantalla.</strong> Los datos cambiaron entre su pantalla ({fmtDate(job.requested.readAt)}, referencia <code>{job.requested.stamp}</code>, {Object.entries(job.requested.totals).map(([k, v]) => `${k} ${v}`).join(", ")} filas)
          y la preparación ({fmtDate(job.material.readAt)}, referencia <code>{job.material.stamp}</code>, {job.material.rows} filas). El archivo refleja la lectura posterior; no es la instantánea que vio.
        </p>
      ) : null}
      {job.status === "READY" ? (
        <>
          <ul className="file-list">
            {job.files.map((f) => (
              <li key={f.id}>
                <a href={`/api/exportaciones/${job.id}/archivo/${f.id}`} download>{f.name}</a> — {f.kind === "MANIFEST" ? "manifiesto con contexto, totales y claves de conciliación" : `${Number(f.rows).toLocaleString("es-ES")} filas${f.additive ? "" : " (relación no aditiva)"}`} · {fmtBytes(f.bytes)} · sha256 <code>{f.checksum.slice(0, 12)}…</code>
              </li>
            ))}
          </ul>
          <p className="hint">Disponible hasta {fmtDate(job.expiresAt)}; después se elimina el archivo (el registro de la ejecución se conserva) y se solicita de nuevo. Referencia de datos <code>{job.material?.stamp}</code> leída {fmtDate(job.material?.readAt ?? null)}.</p>
        </>
      ) : null}
      {job.status === "EXPIRED" ? <p className="hint">El archivo caducó y se eliminó. Solicite la exportación de nuevo.</p> : null}
      {allowActions && job.mine ? (
        <div className="quick">
          {ACTIVE.has(job.status) ? <ActionForm action={cancelExportAction} hidden={{ id: job.id }} className="inline-form"><SubmitButton variant="secondary" pending="Cancelando…">Cancelar</SubmitButton></ActionForm> : null}
          {job.status === "FAILED" || job.status === "CANCELLED" ? <ActionForm action={retryExportAction} hidden={{ id: job.id }} className="inline-form"><SubmitButton variant="secondary" pending="Reintentando…">Reintentar</SubmitButton></ActionForm> : null}
        </div>
      ) : null}
    </li>
  );
}
