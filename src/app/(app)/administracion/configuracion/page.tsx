import type { Metadata } from "next";
import { requirePageUser } from "@/lib/session";
import { listSettingsRevisions } from "@/server/economics/settings";
import { formatDateTime } from "@/lib/format";
import { Dec } from "@/domain/finance";
import { ActionForm, SubmitButton, TextAreaField, TextField } from "@/components/form-kit";
import { updateSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Configuración económica" };

const money = (v: string) => `${(Dec.parse(v) as Dec).toFixed(2).replace(".", ",")}`;

export default async function ConfiguracionPage() {
  const user = await requirePageUser();
  const revisions = await listSettingsRevisions(user.id);
  const cur = revisions[0];
  const isAdmin = user.role === "ADMIN";
  return (
    <>
      <h1>Configuración económica</h1>
      <p className="muted">
        Parámetros del motor económico. Cada cambio crea una <strong>revisión inmutable</strong> con autor y fecha de activación; nunca se sobrescribe una
        anterior. Una consulta usa una única revisión en todos sus bloques (por defecto, la última). Los pesos, umbrales y referencias de Calidad se añaden
        a esta misma página en CSAPP-07.
      </p>
      <section className="card" aria-labelledby="sec-vigente">
        <h2 id="sec-vigente">Revisión vigente: {cur.revisionNo}</h2>
        <dl className="kv">
          <dt>Objetivo €/jornada</dt><dd>{money(cur.targetEurosPerDay)} €</dd>
          <dt>Jornada</dt><dd>{cur.dayHours.replace(".", ",")} horas</dd>
          <dt>Tolerancia de conciliación</dt><dd>{money(cur.reconciliationTolerance)} € <span className="badge">técnica · propuesta (CAL 08)</span></dd>
          <dt>Activada</dt><dd>{formatDateTime(new Date(cur.activatedAt))}{cur.activatedByEmail ? ` por ${cur.activatedByEmail}` : " (inicial)"}</dd>
          <dt>Método de imputación</dt><dd>anual/12 × días incluidos / días reales del mes <span className="badge badge-ok">confirmado · fijo</span></dd>
        </dl>
      </section>
      {isAdmin ? (
        <section className="card" aria-labelledby="sec-editar">
          <h2 id="sec-editar">Nueva revisión</h2>
          <p className="muted">El objetivo y la jornada deben ser positivos; la tolerancia no puede ser negativa. Si otra persona guarda antes que usted, se le pedirá recargar.</p>
          <ActionForm action={updateSettingsAction} hidden={{ expectedRevisionNo: cur.revisionNo }}>
            <TextField name="targetEurosPerDay" label="Objetivo (€/jornada)" initial={cur.targetEurosPerDay} required />
            <TextField name="dayHours" label="Horas de la jornada" initial={cur.dayHours} required />
            <TextField name="reconciliationTolerance" label="Tolerancia de conciliación (€, absoluta)" initial={cur.reconciliationTolerance} required help="Se captura en cada lote al prepararlo; si cambia antes de activar y altera el resultado de la validación, se exige revisar de nuevo." />
            <TextAreaField name="reason" label="Motivo del cambio" />
            <div className="form-actions"><SubmitButton>Guardar nueva revisión</SubmitButton></div>
          </ActionForm>
        </section>
      ) : null}
      <section className="card" aria-labelledby="sec-historial">
        <h2 id="sec-historial">Revisiones</h2>
        <div className="table-wrap">
          <table>
            <caption className="skip">Revisiones de la configuración económica</caption>
            <thead><tr><th>Revisión</th><th>Objetivo</th><th>Jornada</th><th>Tolerancia</th><th>Activada</th><th>Autor</th><th>Motivo</th></tr></thead>
            <tbody>
              {revisions.map((r) => (
                <tr key={r.revisionNo}>
                  <td>{r.revisionNo}</td><td>{money(r.targetEurosPerDay)} €</td><td>{r.dayHours.replace(".", ",")} h</td><td>{money(r.reconciliationTolerance)} €</td>
                  <td>{formatDateTime(new Date(r.activatedAt))}</td><td>{r.activatedByEmail ?? "inicial"}</td><td>{r.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
