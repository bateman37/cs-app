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
  type Problem = { id: string; title: string; affected: string; reason: string; action: string; href: string };
  const problems: Problem[] = [];
  const unassignedFin = fin.reduce((a, f) => a + f.unassigned, 0);
  if (unassignedFin > 0) problems.push({ id: "fin", title: "Filas financieras sin equivalencia BC", affected: `${unassignedFin} filas de ${year}`, reason: "El Grupo financiero no tiene equivalencia BC en los maestros: su ingreso no llega a ningún Grupo.", action: "Completar el enlace en Clientes", href: "/administracion/clientes?pendientes=1" });
  const cumHours = (k: "SIN_CLASIFICAR" | "CONFLICTO" | "pending") => e.entities.reduce((a, x) => a + Number(k === "pending" ? x.periods.cum.hours.pendingEligibility : x.periods.cum.hours.byService[k]), 0);
  if (cumHours("SIN_CLASIFICAR") + cumHours("CONFLICTO") > 0) problems.push({ id: "svc", title: "Horas sin servicio o con servicios en conflicto", affected: `${formatDecimalEs(String(cumHours("SIN_CLASIFICAR") + cumHours("CONFLICTO")), 2)} h (CUM)`, reason: "Ni el ticket ni el proyecto indican Soporte, Administración delegada u Otros, o dos evidencias se contradicen.", action: "Revisar excepciones de servicio", href: "/administracion/servicios" });
  if (cumHours("pending") > 0) problems.push({ id: "pmo", title: "Horas con elegibilidad PMO pendiente", affected: `${formatDecimalEs(String(cumHours("pending")), 2)} h (CUM)`, reason: "La persona no tiene todavía equipo o pertenencia PMO a la fecha del trabajo.", action: "Completar Personal", href: "/administracion/personal" });
  if (e.unattributed && Number(e.unattributed.eligibleHours) > 0) problems.push({ id: "grp", title: "Horas sin Grupo", affected: `${formatDecimalEs(e.unattributed.eligibleHours, 2)} h (CUM)`, reason: "El proyecto, la organización o el ticket no están enlazados a ningún Grupo (internos, conflictos o sin ticket).", action: "Completar enlaces en Clientes", href: "/administracion/clientes?pendientes=1" });
  if (pf?.cum.groupsUnknownIncome) problems.push({ id: "inc", title: "Grupos con ingreso desconocido", affected: `${pf.cum.groupsUnknownIncome} Grupo(s)`, reason: "No hay fuente financiera de este año para ese Grupo, o su conjunto financiero está incompleto.", action: "Revisar Finanzas en Cargas", href: "/administracion/cargas" });
  if (r.pendingRecalc.reason) problems.push({ id: "rel", title: "Relaciones pendientes de actualizar", affected: r.validation.state === "VALIDATED" ? "—" : "derivados no validados", reason: r.pendingRecalc.reason, action: "Ver estado y reintentar", href: "/administracion/cargas" });
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
      <h3>Qué deja cifras incompletas</h3>
      <div className="table-wrap">
        <table>
          <caption className="visually-hidden">Problemas de datos: afectados, motivo y acción</caption>
          <thead><tr><th scope="col">Problema</th><th scope="col">Registros / importe / horas afectados</th><th scope="col">Motivo</th><th scope="col">Acción</th></tr></thead>
          <tbody>
            {problems.length === 0 ? <tr><td colSpan={4}>Sin problemas detectados en la lectura de hoy.</td></tr> : problems.map((p) => (
              <tr key={p.id}><th scope="row">{p.title}</th><td>{p.affected}</td><td>{p.reason}</td><td><Link href={p.href}>{p.action}</Link></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Abrir una celda «—» de Comparativa lleva aquí o a su caso concreto. Pendientes de aceptación de otras propuestas: docs/decisiones/pendientes.md.</p>
    </section>
  );
}
