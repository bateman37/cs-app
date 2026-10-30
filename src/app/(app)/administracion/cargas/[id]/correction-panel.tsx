import Link from "next/link";
import { formatDate } from "@/domain/vigencia";
import { qs } from "@/lib/format";
import { getCorrectionCompare, listCorrectionTargets, type TargetFilters } from "@/server/zendesk/corrections";
import { DecisionButtons, ReplaceForm } from "./correction-form";

const hrs = (minutes: string | null | undefined) => (minutes === null || minutes === undefined ? "—" : (Number(minutes) / 60).toLocaleString("es-ES", { maximumFractionDigits: 4 }));
const show = (key: string, v: string | null | undefined) => {
  if (v === null || v === undefined || v === "") return "—";
  if (key === "minutes") return `${hrs(v)} h (${Number(v).toLocaleString("es-ES", { maximumFractionDigits: 4 })} min)`;
  if (key === "workDate") return formatDate(v);
  return v;
};

export type CorrectionProps = {
  userId: string;
  batchId: string;
  batchVersion: number;
  base: string;
  corr: string;
  target: string;
  tf: TargetFilters;
  keep: Record<string, string | number | undefined>;
};

/**
 * Corrección explícita de una fila (con o sin ID externo): el Administrador filtra para LOCALIZAR registros activos de la misma fuente,
 * elige uno, ve ambos registros con sus diferencias y los minutos antes/después, y confirma esa sustitución concreta. Los filtros nunca
 * deciden la relación.
 */
export async function CorrectionPanel({ userId, batchId, batchVersion, base, corr, target, tf, keep }: CorrectionProps) {
  const cmp = await getCorrectionCompare(userId, batchId, corr, target || undefined);
  if (!cmp) return <section className="card" id="sec-correccion"><p className="notice notice-error" role="alert">La fila indicada no es una fila válida y única de este lote.</p></section>;
  const targets = target ? [] : await listCorrectionTargets(userId, batchId, tf);
  const here = (extra: Record<string, string | number | undefined>) => `${base}${qs({ ...keep, corr, ...extra })}#sec-correccion`;
  const closeHref = `${base}${qs(keep)}`;
  const wrike = cmp.profileId === "wrike";
  return (
    <section className="card" aria-labelledby="sec-correccion-h" id="sec-correccion" data-testid="correccion-panel">
      <h2 id="sec-correccion-h">Relacionar la fila con un registro existente</h2>
      <p className="muted">
        {wrike
          ? "Wrike no tiene un ID de imputación: una modificación real se decide aquí, no por parecido de persona, tarea, proyecto o día."
          : "Sin id externo no hay candidato automático: elija usted el registro que corrige esta fila."}{" "}
        Elija el registro concreto, compruebe las diferencias y confirme. Si no es una corrección, marque «Es otro trabajo».
      </p>
      {cmp.decision ? (
        <p className={cmp.decision.stale ? "notice notice-error" : "notice notice-info"} role="note" data-testid="decision-actual">
          Decisión actual: {cmp.decision.decision === "CORRECTION" ? `corrige el registro ${cmp.decision.targetEntryId}` : "es otro trabajo"}.
          {cmp.decision.stale ? " Está obsoleta: el registro cambió o ya no existe; la fila queda pendiente hasta que decida de nuevo." : ""}
        </p>
      ) : null}
      <h3>Fila del archivo</h3>
      <dl className="kv">
        {cmp.fields.map(([k, label]) => <><dt key={`k${k}`}>{label}</dt><dd key={`v${k}`}>{show(k, cmp.incoming[k])}</dd></>)}
      </dl>

      {!target ? (
        <>
          <h3>Localizar registros activos de la misma fuente</h3>
          <form className="toolbar" action={base} method="get" aria-label="Filtros para localizar el registro">
            {Object.entries(keep).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}
            <input type="hidden" name="corr" value={corr} />
            <div className="field"><label htmlFor="tf_ticket">Ticket</label><input id="tf_ticket" name="tf_ticket" defaultValue={tf.ticket ?? ""} /></div>
            <div className="field"><label htmlFor="tf_person">Persona</label><input id="tf_person" name="tf_person" defaultValue={tf.person ?? ""} /></div>
            <div className="field"><label htmlFor="tf_from">Día desde</label><input id="tf_from" name="tf_from" type="date" defaultValue={tf.from ?? ""} /></div>
            <div className="field"><label htmlFor="tf_to">Día hasta</label><input id="tf_to" name="tf_to" type="date" defaultValue={tf.to ?? ""} /></div>
            <div className="field"><label htmlFor="tf_text">{wrike ? "Texto de tarea/proyecto" : "ID o segmentador"}</label><input id="tf_text" name="tf_text" defaultValue={tf.text ?? ""} /></div>
            <button className="btn btn-primary" type="submit">Buscar</button>
          </form>
          {targets && targets.length > 0 ? (
            <div className="table-wrap">
              <table>
                <caption className="skip">Registros activos que cumplen los filtros</caption>
                <thead><tr>{cmp.fields.map(([, l]) => <th key={l}>{l}</th>)}<th>Revisión</th><th /></tr></thead>
                <tbody>
                  {targets.map((t) => (
                    <tr key={t.id}>
                      {cmp.fields.map(([k]) => <td key={k}>{show(k, t.content[k])}</td>)}
                      <td>{t.revision}</td>
                      <td><Link className="btn btn-secondary btn-sm" href={here({ target: t.id })}>Comparar</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted">Se muestran como máximo 25 registros: afine los filtros si no aparece el que busca.</p>
            </div>
          ) : (tf.ticket || tf.person || tf.from || tf.to || tf.text) ? <div className="empty">Ningún registro activo coincide con los filtros.</div> : null}
        </>
      ) : cmp.target ? (
        <>
          <h3>Comparación con el registro seleccionado</h3>
          <div className="table-wrap">
            <table data-testid="comparacion">
              <caption className="skip">Fila del archivo frente al registro activo</caption>
              <thead><tr><th>Campo</th><th>Registro activo (revisión {cmp.target.revision})</th><th>Fila del archivo</th></tr></thead>
              <tbody>
                {cmp.fields.map(([k, label]) => {
                  const differs = cmp.differences.includes(label);
                  return (
                    <tr key={k}>
                      <td>{label}</td>
                      <td>{show(k, cmp.target?.content[k])}</td>
                      <td>{differs ? <strong>{show(k, cmp.incoming[k])}</strong> : show(k, cmp.incoming[k])}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p data-testid="minutos-antes-despues">
            <strong>Antes:</strong> {hrs(cmp.target.minutes)} h · <strong>después:</strong> {hrs(cmp.incomingMinutes)} h. La corrección sustituye la duración; no suma ambas
            {cmp.differences.length > 0 ? <> · Diferencias: {cmp.differences.join(", ")}.</> : <> · Sin diferencias: sustituirlo no cambiaría nada.</>}
          </p>
          <ReplaceForm batchId={batchId} fingerprint={corr} targetId={cmp.target.id} targetRevision={cmp.target.revision} batchVersion={batchVersion} />
          <p><Link href={here({ target: undefined })}>← Elegir otro registro</Link></p>
        </>
      ) : <p className="notice notice-error" role="alert">El registro seleccionado ya no existe como registro activo.</p>}
      <DecisionButtons batchId={batchId} fingerprint={corr} batchVersion={batchVersion} hasDecision={cmp.decision !== null} />
      <p><Link href={closeHref}>Cerrar</Link></p>
    </section>
  );
}
