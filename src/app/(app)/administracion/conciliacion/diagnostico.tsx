import Link from "next/link";
import { todayMadrid } from "@/domain/vigencia";
import { formatDecimalEs } from "@/lib/money";
import { runEconomics, type EconomicResult } from "@/server/economics/engine";

/**
 * Diagnóstico de datos (HOTFIX-02 §6): aquí viven los sellos de datos, el método, la revisión de configuración, la cobertura de las fuentes
 * financieras, el reproceso pendiente y las causas que dejan una cifra en «—» en Comparativa. Reutiliza el motor compartido (misma lectura que
 * la pantalla); no crea otro sistema de control: la conciliación de tres niveles de esta misma página sigue siendo la comprobación formal.
 */
export async function DiagnosticoDatos({ userId }: { userId: string }) {
  const date = todayMadrid();
  let e: EconomicResult;
  try {
    e = await runEconomics(userId, { scope: { type: "groups", ids: "ALL" }, service: "SOPORTE", date, mode: "CUTOFF", unpaged: true });
  } catch (err) {
    return (
      <section id="diagnostico" className="card" aria-labelledby="diag-h">
        <h2 id="diag-h">Diagnóstico de datos</h2>
        <p className="notice notice-error" role="alert">No se pudo leer el diagnóstico: {err instanceof Error ? err.message : "error inesperado"}. <Link href="/administracion/conciliacion#diagnostico">Reintentar</Link></p>
      </section>
    );
  }
  const r = e.reference;
  const pf = e.portfolio;
  const year = Number(e.input.cut.slice(0, 4));
  const fin = r.finance.filter((f) => f.year === year);
  return (
    <section id="diagnostico" className="card" aria-labelledby="diag-h">
      <h2 id="diag-h">Diagnóstico de datos</h2>
      <p className="muted">Explica por qué una cifra de Comparativa o de la ficha aparece como «—» y qué hacer. Lectura de hoy ({date.split("-").reverse().join("/")}), servicio Soporte. Cada importe se explica con detalle en Análisis Cliente › «Ver cálculo».</p>
      <dl className="kv">
        <dt>Método de ingreso</dt><dd>{r.method}</dd>
        <dt>Objetivo y jornada</dt><dd>{formatDecimalEs(e.settings.targetEurosPerDay, 0)} €/jornada de {formatDecimalEs(e.settings.dayHours, 0)} h · revisión de configuración {e.settings.revisionNo}{e.recalculatedWithOlderSettings ? " (recálculo con una revisión anterior)" : ""}</dd>
        <dt>Referencia de datos</dt><dd><code>{r.dataStamp.stamp}</code> · motor {r.engineVersion} · leído {new Date(r.readAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}</dd>
        <dt>Validación de derivados</dt><dd>{r.validation.state === "VALIDATED" ? "validados" : <><strong>reproceso pendiente.</strong> {r.pendingRecalc.reason ?? "Hay derivados obsoletos."} <Link href="/administracion/cargas">Cargas</Link></>}</dd>
      </dl>
      <h3>Fuentes financieras de {year}</h3>
      {fin.length === 0 ? (
        <p>No hay ninguna fuente financiera activa para {year}: el ingreso queda en «—» (desconocido, no cero). <Link href="/administracion/cargas">Cargar el lote de Finanzas</Link>.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Categoría</th><th scope="col">Cobertura</th><th scope="col">Versión</th><th scope="col">Origen</th><th scope="col">Filas sin Grupo</th></tr></thead>
            <tbody>{fin.map((f) => <tr key={`${f.year}-${f.category}`}><th scope="row">{f.category}</th><td>{f.coverage.toLowerCase().replace("_", " ")}</td><td>{f.version}</td><td>{f.origin ?? "—"}</td><td>{f.unassigned}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <h3>Cartera completa: qué deja cifras incompletas</h3>
      {pf ? (
        <ul>
          {(["month", "cum"] as const).map((k) => (
            <li key={k}>
              <strong>{k === "month" ? "Mes seleccionado" : "CUM"}:</strong> {pf[k].complete ? "completa" : "incompleta"} · {pf[k].coverage.complete} de {pf[k].coverage.groups} grupos sin restricción
              {pf[k].affected.map((a) => <span key={a.code}> · {a.groups} grupo(s) con {a.label} (ingreso {formatDecimalEs(a.income, 2)} €)</span>)}
              {pf[k].zeroHours.count > 0 ? <span> · {pf[k].zeroHours.count} con ingreso y sin dedicación registrada</span> : null}
            </li>
          ))}
        </ul>
      ) : <p>Sin cartera calculable.</p>}
      {e.unattributed && Number(e.unattributed.eligibleHours) > 0 ? <p>Horas elegibles del CUM sin Grupo Cliente (internos, conflictos, sin ticket): <strong>{formatDecimalEs(e.unattributed.eligibleHours, 2)} h</strong>, conciliables y no repartidas. Resuélvalas en <Link href="/administracion/clientes">Clientes</Link> (equivalencias).</p> : null}
      <p className="hint">Silver Recurrente y Silver On Demand son planes distintos; la rentabilidad mensual recurrente de Silver On Demand no está activada (ECO 08, propuesta pendiente). Pendientes de aceptación: ver docs/decisiones/pendientes.md.</p>
    </section>
  );
}
