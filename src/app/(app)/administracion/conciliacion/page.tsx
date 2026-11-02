import type { Metadata } from "next";
import Link from "next/link";
import { requirePageAdmin } from "@/lib/session";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/form-kit";
import { first, type SearchParams } from "@/lib/format";
import { todayMadrid } from "@/domain/vigencia";
import { getReconRun, listReconRuns, type Check } from "@/server/reconciliation/service";
import { runReconciliationAction } from "./actions";

export const metadata: Metadata = { title: "Conciliación" };
export const dynamic = "force-dynamic";
const STATUS: Record<string, string> = { OK: "coincide", DIFERENCIA: "diferencia", INFORMATIVO: "informativo", NO_DISPONIBLE: "no disponible" };
const LEVEL: Record<number, string> = { 1: "Nivel 1 · Fuente y lote", 2: "Nivel 2 · Hechos elegibles", 3: "Nivel 3 · Resultado (servicio ↔ detalle ↔ CSV)" };

export default async function ConciliacionPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAdmin();
  const sp = await searchParams;
  const id = first(sp.informe);
  const [runs, run] = await Promise.all([listReconRuns(user.id, 10), id ? getReconRun(user.id, id).catch(() => null) : Promise.resolve(null)]);
  const today = todayMadrid();
  return (
    <>
      <h1>Conciliación</h1>
      <p className="muted">
        Comprueba, en tres niveles, que fuente, hechos elegibles y resultado cuadran. <strong>Solo lee</strong>: no modifica fuentes, no activa configuración ni reprocesa lotes. Cada ejecución se registra con su manifiesto y no se reescribe. Contrato: <code>docs/validacion/conciliacion-contrato.md</code>.
      </p>
      <section className="card" aria-labelledby="rec-form">
        <h2 id="rec-form">Nueva comprobación</h2>
        <ActionForm action={runReconciliationAction} className="form form-inline">
          <SelectField name="scope" label="Ámbito" initial="group" options={[{ value: "group", label: "Grupo Cliente" }, { value: "client", label: "Cliente" }]} />
          <TextField name="sel" label="Entidad (identificador, opcional)" help="Vacío = todo el ámbito." />
          <TextField name="desde" label="Desde" type="date" initial={`${today.slice(0, 4)}-01-01`} />
          <TextField name="hasta" label="Hasta (corte)" type="date" initial={today} />
          <SelectField name="servicio" label="Servicio" initial="TOTAL" options={[{ value: "TOTAL", label: "Total (los tres)" }, { value: "SOPORTE", label: "Soporte" }, { value: "ADMIN_DELEGADA", label: "Administración delegada" }, { value: "OTROS", label: "Otros" }]} />
          <SubmitButton pending="Comprobando…">Ejecutar comprobación</SubmitButton>
        </ActionForm>
      </section>
      {run ? (
        <section aria-labelledby="rec-result">
          <h2 id="rec-result">Informe {run.id.slice(0, 8)} · {new Date(run.createdAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}</h2>
          {run.stale ? <p className="notice notice-warn" role="note"><strong>Los datos actuales han cambiado</strong> desde esta lectura (referencia {run.stamp} → {run.currentStamp}). Este informe conserva sus resultados; ejecute una nueva comprobación para ver el estado actual.</p> : null}
          <p>Periodo {run.params.desde} – {run.params.hasta} · {run.params.scope === "group" ? "Grupo Cliente" : "Cliente"}{run.params.sel ? ` ${run.params.sel}` : " (todos)"} · servicio {run.params.servicio} · referencia <code>{run.stamp}</code> · leído {new Date(run.readAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })} · {run.summary.ok} coinciden, {run.summary.difference} con diferencia, {run.summary.informative} informativas, {run.summary.unavailable} no disponibles.</p>
          <p className="quick"><a href={`/api/administracion/conciliacion/${run.id}/informe`} download>Descargar informe tabular (CSV)</a> · <a href={`/api/administracion/conciliacion/${run.id}/manifiesto`} download>Descargar manifiesto (JSON)</a></p>
          {[1, 2, 3].map((lv) => (
            <div key={lv} className="table-wrap" tabIndex={0} role="region" aria-label={LEVEL[lv]}>
              <table>
                <caption>{LEVEL[lv]}</caption>
                <thead><tr><th scope="col">ID</th><th scope="col">Comprobación</th><th scope="col">Resultado</th><th scope="col">Esperado</th><th scope="col">Observado</th><th scope="col">Diferencia</th><th scope="col">Detalle</th></tr></thead>
                <tbody>
                  {run.results.filter((c: Check) => c.level === lv).map((c: Check) => (
                    <tr key={c.id}>
                      <th scope="row"><code>{c.id}</code></th><td>{c.title}{c.additive ? null : <> <span className="badge">no aditivo</span></>}</td>
                      <td><span className={`badge ${c.status === "OK" ? "badge-ok" : c.status === "DIFERENCIA" ? "badge-warn" : ""}`}>{STATUS[c.status]}</span></td>
                      <td>{c.expected ?? "—"} {c.unit}</td><td>{c.observed ?? "—"} {c.unit}</td><td>{c.difference ?? "—"}{c.status !== "NO_DISPONIBLE" ? ` (tolerancia ${c.tolerance})` : ""}</td>
                      <td><details><summary>Notas y exclusiones</summary>{c.notes.map((n) => <p key={n}>{n}</p>)}{c.exclusions.length ? <ul>{c.exclusions.map((e) => <li key={e.reason}>{e.reason}: {e.count}{e.amount ? ` (${e.amount})` : ""}</li>)}</ul> : null}{c.identities.length ? <p>Identidades: {c.identities.join(", ")}</p> : null}<p className="muted">Fuentes: {c.sources.join(", ")}</p></details></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      ) : id ? <p className="notice notice-warn">Informe no encontrado.</p> : null}
      <section aria-labelledby="rec-prev">
        <h2 id="rec-prev">Ejecuciones anteriores</h2>
        {runs.length === 0 ? <p className="muted">Todavía no se ha ejecutado ninguna comprobación.</p> : (
          <ul>{runs.map((r) => <li key={r.id}><Link href={`/administracion/conciliacion?informe=${r.id}`}>{new Date(r.createdAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}</Link> · {r.params.desde} – {r.params.hasta} · {r.summary.ok} OK / {r.summary.difference} con diferencia · {r.actor}</li>)}</ul>
        )}
      </section>
    </>
  );
}
