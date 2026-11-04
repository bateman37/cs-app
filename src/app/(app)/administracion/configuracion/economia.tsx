import { listSettingsRevisions } from "@/server/economics/settings";
import { formatDateTime } from "@/lib/format";
import { formatDecimalEs } from "@/lib/money";
import { ActionForm, SubmitButton, TextAreaField, TextField } from "@/components/form-kit";
import { BAND_SHORT, BAND_IDS, cutsFor } from "@/domain/economic-bands";
import { updateSettingsAction } from "./actions";

const money = (v: string) => formatDecimalEs(v);

export async function EconomiaSection({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const revisions = await listSettingsRevisions(userId);
  const cur = revisions[0];
  return (
    <>
      <section className="card" aria-labelledby="sec-vigente">
        <h2 id="sec-vigente">Revisión vigente: {cur.revisionNo}</h2>
        <dl className="kv">
          <dt>Objetivo €/jornada</dt><dd>{money(cur.targetEurosPerDay)} €</dd>
          <dt>Jornada</dt><dd>{cur.dayHours.replace(".", ",")} horas</dd>
          <dt>Tolerancia de conciliación</dt><dd>{money(cur.reconciliationTolerance)} € <span className="badge">técnica · propuesta (CAL 08)</span></dd>
          <dt>Bandas de rentabilidad</dt>
          <dd>
            {BAND_IDS.map((b, i) => {
              const c = cutsFor(cur.targetEurosPerDay, cur.bandFactors);
              const txt = i === 0 ? `< ${money(c[0])}` : i === 4 ? `≥ ${money(c[3])}` : `${money(c[i - 1])} – < ${money(c[i])}`;
              return <span key={b} className={`band-chip band-${b}`}>{BAND_SHORT[b]}: {txt}</span>;
            })}{" "}
            <span className="badge">{cur.customBands ? "personalizadas" : "configuración inicial HOTFIX-03"}</span>
          </dd>
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
            <fieldset className="band-fields">
              <legend>Bandas de rentabilidad (múltiplos del objetivo; el valor exacto del corte pertenece a la banda superior)</legend>
              <TextField name="band1" label="Rojo / naranja" initial={cur.bandFactors[0]} help="0,60 × objetivo" />
              <TextField name="band2" label="Naranja / amarillo" initial={cur.bandFactors[1]} help="0,80 × objetivo" />
              <TextField name="band3" label="Amarillo / verde" initial={cur.bandFactors[2]} help="Siempre 1,00: el objetivo" />
              <TextField name="band4" label="Verde / verde intenso" initial={cur.bandFactors[3]} help="1,20 × objetivo" />
            </fieldset>
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
