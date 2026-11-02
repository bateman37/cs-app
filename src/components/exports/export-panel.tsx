import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/form-kit";
import { DATASETS } from "@/server/exports/datasets";
import { listMyExports } from "@/server/exports/service";
import { requestExportAction } from "@/app/(app)/exportaciones/actions";
import { ExportJobCard } from "./job-card";

/**
 * «Exportar detalle completo» (CSAPP-09 §6): alcance y contexto visibles ANTES de solicitar; el historial de las exportaciones propias está en la misma vista.
 * El trabajo se ejecuta en segundo plano (trabajador): se puede salir y volver, y los resúmenes siguen siendo utilizables mientras tanto.
 */
export async function ExportPanel({ userId, scope, sel, selName, from, to, service, stamp }: { userId: string; scope: "group" | "client"; sel: string; selName?: string | null; from: string; to: string; service: string; stamp?: string }) {
  const jobs = await listMyExports(userId, 8).catch(() => []);
  return (
    <section className="card" aria-labelledby="exp-title">
      <h3 id="exp-title">Exportar detalle completo</h3>
      <p className="hint">
        Alcance: {scope === "group" ? "Grupo Cliente" : "Cliente"} — {sel ? (selName ?? sel) : "todo el ámbito"} · periodo {from} – {to} · servicio {service}{stamp ? <> · referencia de la pantalla <code>{stamp}</code></> : null}.
        El archivo se prepara en segundo plano a partir de una lectura coherente de los datos; si cambian antes de empezar, se le avisará con las dos referencias.
      </p>
      <ActionForm action={requestExportAction} hidden={{ scope, sel, servicio: service }} className="form form-inline">
        <SelectField name="dataset" label="Conjunto" options={DATASETS.map((d) => ({ value: d.key, label: d.label }))} initial="horas" />
        <TextField name="desde" label="Desde" type="date" initial={from} />
        <TextField name="hasta" label="Hasta" type="date" initial={to} />
        <SubmitButton pending="Solicitando…">Exportar detalle completo</SubmitButton>
      </ActionForm>
      <details>
        <summary>Qué contiene cada conjunto</summary>
        <ul>{DATASETS.map((d) => <li key={d.key}><strong>{d.label}:</strong> {d.description} Archivos: {d.files.map((f) => `${f.fileKey}${f.additive ? "" : " (no aditivo)"}`).join(", ")} + manifiesto JSON.</li>)}</ul>
      </details>
      {jobs.length > 0 ? (
        <>
          <h4>Sus exportaciones recientes</h4>
          <ul style={{ padding: 0 }}>{jobs.map((j) => <ExportJobCard key={j.id} initial={j} />)}</ul>
        </>
      ) : <p className="muted">Todavía no ha solicitado exportaciones.</p>}
    </section>
  );
}
