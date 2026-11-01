import Link from "next/link";
import { Dec } from "@/domain/finance";
import { PERIOD_KEYS, type PeriodKey } from "@/server/economics/engine";
import type { FichaView } from "@/server/analytics/ficha";
import { CAUSE_CLASS_LABEL } from "@/server/analytics/operational";
import { Notice, fdate, hrs } from "@/components/analytics/ui";
import { formatDecimalEs, formatPercentEs } from "@/lib/money";
import { fichaHref } from "./links";

const TITLE: Record<PeriodKey, string> = { month: "Mes seleccionado", prevMonth: "Mes anterior completo", cum: "CUM del año", prevYear: "Año anterior completo", prevCum: "CUM anterior comparable" };
type Ctx = { f: FichaView; back: string };
const L = (c: Ctx, extra: Record<string, string>) => fichaHref(c.f.query, c.f.context.ref, c.back, { pestana: c.f.query.tab, ...extra });
const PROFILE_PERIODS: PeriodKey[] = ["month", "prevMonth", "cum", "prevCum"];
const pct = (part: string, total: string) => { const t = Dec.parse(total) as Dec; return t.isZero() ? "—" : formatPercentEs(((Dec.parse(part) as Dec).div(t)).toString(), 1); };

export function Dedicacion({ c }: { c: Ctx }) {
  const f = c.f;
  const d = f.dedication ?? {};
  const names = [...new Set(PROFILE_PERIODS.flatMap((k) => (d[k]?.profiles ?? []).map((p) => p.profile)))];
  const pend = (k: PeriodKey) => f.entity.periods[k].hours;
  return (
    <section aria-label="Dedicación">
      <p className="hint">Horas elegibles del perímetro del servicio seleccionado. Persona, equipo, nivel y rol se resuelven a la <strong>fecha del trabajo</strong>; el PMO desconocido es elegibilidad pendiente (no se descarta como rol desconocido). Los porcentajes usan el mismo conjunto de horas que sus componentes y no requieren usuarios.</p>
      <div className="cmp-scroll" tabIndex={0} role="region" aria-label="Equipos y perfiles (desplazable)">
        <table className="cmp">
          <caption className="hint" style={{ textAlign: "left", padding: "0.3rem 0.6rem" }}>Horas por equipo y perfil: mes, anterior, CUM y CUM anterior comparable.</caption>
          <thead>
            <tr className="groups"><th scope="col" className="sticky-col">Perfil</th>{PROFILE_PERIODS.map((k) => <th key={k} scope="colgroup" colSpan={3}>{TITLE[k]} · {fdate(f.economics.periodsDefinition[k].from)} – {fdate(f.economics.periodsDefinition[k].to)}</th>)}</tr>
            <tr className="cols"><th scope="col" className="sticky-col" />{PROFILE_PERIODS.flatMap((k) => [<th key={`${k}h`} scope="col" className="num">Horas</th>, <th key={`${k}p`} scope="col" className="num">% del total</th>, <th key={`${k}i`} scope="col" className="num">Incidente Vincle (h)</th>])}</tr>
          </thead>
          <tbody>
            {names.map((n) => (
              <tr key={n}><th scope="row" className="sticky-col">{n}</th>{PROFILE_PERIODS.flatMap((k) => { const r = d[k]?.profiles.find((p) => p.profile === n); return [<td key={`${k}h`} className="num">{r ? formatDecimalEs(r.hours, 2) : "—"}</td>, <td key={`${k}p`} className="num">{r ? pct(r.hours, d[k].totalHours) : "—"}</td>, <td key={`${k}i`} className="num">{r ? formatDecimalEs(r.incident, 2) : "—"}</td>]; })}</tr>
            ))}
            <tr style={{ fontWeight: 600 }}><th scope="row" className="sticky-col">Total del ámbito de dedicación</th>{PROFILE_PERIODS.flatMap((k) => [<td key={`${k}h`} className="num"><Link href={L(c, { det: "horas", periodo: k })}>{formatDecimalEs(d[k]?.totalHours ?? "0", 2)}</Link></td>, <td key={`${k}p`} className="num">100 %</td>, <td key={`${k}i`} className="num" />])}</tr>
          </tbody>
        </table>
      </div>
      {names.length === 0 ? <div className="empty">Sin horas elegibles en estos periodos para el servicio seleccionado.</div> : null}
      <h3>Motivos de dedicación (causa del ticket)</h3>
      <div className="table-wrap">
        <table>
          <caption className="hint">Incidente Vincle confirmado, otro soporte clasificado y sin clasificar/pendiente reconcilian el total. «Otro soporte» no es la categoría financiera OTROS ni la causa raíz de un entorno.</caption>
          <thead><tr><th scope="col">Clase</th>{PROFILE_PERIODS.map((k) => <th key={k} scope="col" className="num">{TITLE[k]} (h)</th>)}</tr></thead>
          <tbody>
            {([["incident", "INCIDENTE_VINCLE"], ["other", "OTRO_SOPORTE"], ["unclassified", "SIN_CLASIFICAR"]] as const).map(([key, cls]) => (
              <tr key={key}><th scope="row">{CAUSE_CLASS_LABEL[cls]}</th>{PROFILE_PERIODS.map((k) => <td key={k} className="num">{formatDecimalEs(d[k]?.byClass[key] ?? "0", 2)}</td>)}</tr>
            ))}
            <tr style={{ fontWeight: 600 }}><th scope="row">Total</th>{PROFILE_PERIODS.map((k) => <td key={k} className="num">{formatDecimalEs(d[k]?.totalHours ?? "0", 2)}</td>)}</tr>
          </tbody>
        </table>
      </div>
      <h3>Desglose por causa (CUM, causas exactas del ticket)</h3>
      <div className="table-wrap">
        <table>
          <caption className="hint">Se conservan Sistemas del Cliente y Uso Indebido con sus horas. La infraestructura cuenta como incidente Vincle solo si el alojamiento a la fecha del trabajo era CLOUD.</caption>
          <thead><tr><th scope="col">Causa</th><th scope="col">Clase</th><th scope="col" className="num">Horas</th></tr></thead>
          <tbody>
            {(d.cum?.causes ?? []).map((r) => <tr key={`${r.cause}-${r.cls}`}><td>{r.cause}</td><td>{CAUSE_CLASS_LABEL[r.cls]}</td><td className="num">{formatDecimalEs(r.hours, 2)}</td></tr>)}
            {(d.cum?.causes ?? []).length === 0 ? <tr><td colSpan={3} className="muted">Sin horas en el CUM.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="hint">Fuera de estas cifras: horas excluidas por la política de elegibilidad ({hrs(pend("cum").excluded)}), con elegibilidad pendiente ({hrs(pend("cum").pendingEligibility)}) y de otros servicios o sin servicio — se consultan aparte en el <Link href={L(c, { det: "horas", periodo: "cum", modoh: "sin_clasificar" })}>detalle de horas</Link>.{" "}
        {f.dedication?.cum?.withoutImplementationHours && f.dedication.cum.withoutImplementationHours !== "0" ? <>De ellas, {hrs(f.dedication.cum.withoutImplementationHours)} sin implantación identificada (no se reparten entre proyectos).</> : null}</p>
    </section>
  );
}

export function Pap({ c }: { c: Ctx }) {
  const f = c.f;
  const p = f.pap;
  if (!p) return null;
  const rows: [string, (k: string) => number][] = [
    ["PAP únicos con puesta en producción", (k) => p.periods[k]?.total ?? 0],
    ["Correctivos (si cualquier causa lo es)", (k) => p.periods[k]?.corrective ?? 0],
    ["Correctivo estándar", (k) => p.periods[k]?.standard ?? 0],
    ["Correctivo de proyecto / personalización / configuración / procesos / infraestructura", (k) => p.periods[k]?.project ?? 0],
    ["Origen cliente (Sistemas del Cliente, Uso Indebido)", (k) => p.periods[k]?.clientOrigin ?? 0],
    ["Evolutivos (sin evidencia de facturación en la fuente)", (k) => p.periods[k]?.evolutive ?? 0],
    ["Sin clasificar", (k) => p.periods[k]?.unclassified ?? 0],
    ["Resultado distinto de OK (se conserva)", (k) => p.periods[k]?.nonOk ?? 0],
  ];
  const nonAdd = PERIOD_KEYS.some((k) => p.periods[k] && !p.periods[k].additive);
  return (
    <section aria-label="PAP">
      <p className="hint">Fuente: PAP cargado, identidad estable lista + ID, por fecha de puesta en producción. Un PAP con varias causas o tickets cuenta una vez en el total. No se filtra a Resultado = OK ni se afirma que todo lo cargado se ejecutó con éxito. El filtro de servicio de economía no se aplica a PAP (no hay clasificación de servicio sustentada).</p>
      {nonAdd ? <Notice kind="warn">Tabla <strong>no aditiva</strong>: algún PAP pertenece a varias categorías; las filas de categoría no suman el total.</Notice> : null}
      <div className="table-wrap">
        <table>
          <caption className="hint">Magnitudes PAP por periodo</caption>
          <thead><tr><th scope="col">Magnitud</th>{PERIOD_KEYS.map((k) => <th key={k} scope="col" className="num">{TITLE[k]}</th>)}</tr></thead>
          <tbody>
            {rows.map(([name, get], i) => <tr key={name}><th scope="row">{name}</th>{PERIOD_KEYS.map((k) => <td key={k} className="num">{i === 0 ? <Link href={L(c, { det: "pap", periodo: k })}>{get(k)}</Link> : get(k)}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
      <h3>Pertenencias por categoría (CUM, no aditivas)</h3>
      <ul>{(p.periods.cum?.memberships ?? []).map((m) => <li key={m.category}>{m.category}: {m.pap}</li>)}</ul>
      <p>Sin fecha de producción: <Link href={L(c, { det: "pap", periodo: "sin_fecha" })}>{p.withoutProductionDate} PAP</Link> (se conservan, sin usar la fecha de título o solicitud como sustituto). Última observación: {fdate(p.observedOn)}.</p>
      <h3>Resultados originales</h3>
      <ul>{p.results.map((r) => <li key={r.result}>{r.result}: {r.pap}</li>)}</ul>
    </section>
  );
}

export function Tickets({ c }: { c: Ctx }) {
  const f = c.f;
  const t = f.tickets;
  if (!t) return null;
  if (!t.supported) return <Notice kind="info">Los tickets de Zendesk identifican organización/Cliente, no implantación: seleccione el Cliente o el Grupo para consultar tickets, escalados y bugs vinculados. No se clonan en todos los proyectos.</Notice>;
  const b = f.bugs;
  const row = (name: string, get: (k: PeriodKey) => string | number) => <tr key={name}><th scope="row">{name}</th>{PERIOD_KEYS.map((k) => <td key={k} className="num">{get(k)}</td>)}</tr>;
  return (
    <section aria-label="Tickets y bugs vinculados">
      <p className="hint">Conteos únicos por <strong>fecha de creación</strong> del ticket dentro del periodo; los tickets sin horas se conservan. Clasificación, tags y estado son los <strong>actuales</strong> aplicados a altas históricas: no prueban lo que se conocía en aquella fecha. El estado es una observación (con su fecha), no un cierre. No se calculan cierres mensuales, MTTR ni backlog envejecido (CSAPP-08).</p>
      <div className="table-wrap">
        <table>
          <caption className="hint">Tickets creados en el periodo</caption>
          <thead><tr><th scope="col">Hecho</th>{PERIOD_KEYS.map((k) => <th key={k} scope="col" className="num">{TITLE[k]}</th>)}</tr></thead>
          <tbody>
            <tr><th scope="row">Tickets creados</th>{PERIOD_KEYS.map((k) => <td key={k} className="num"><Link href={L(c, { det: "tickets", periodo: k })}>{t.periods[k]?.total ?? 0}</Link></td>)}</tr>
            {row("incident", (k) => t.periods[k]?.incident ?? 0)}
            {row("problem", (k) => t.periods[k]?.problem ?? 0)}
            {row("otros tipos", (k) => t.periods[k]?.other ?? 0)}
            {row("Escalados a N2 (tag team_n2)", (k) => t.periods[k]?.escalations.n2 ?? 0)}
            {row("Escalados a N3 (unión, cada ticket una vez)", (k) => t.periods[k]?.escalations.n3 ?? 0)}
            {row("  · PMO N3 (team_n3_pmo, no aditivo)", (k) => t.periods[k]?.escalations.pmoN3 ?? 0)}
            {row("  · IT N3 (team_it, no aditivo)", (k) => t.periods[k]?.escalations.itN3 ?? 0)}
            {row("Escalados a N4 (unión; N4 no prueba por sí solo un bug)", (k) => t.periods[k]?.escalations.n4 ?? 0)}
            {row("  · plataforma VFS / VFS arq. / VSW (no aditivo)", (k) => `${t.periods[k]?.escalations.vfsN4 ?? 0} / ${t.periods[k]?.escalations.arqN4 ?? 0} / ${t.periods[k]?.escalations.vswN4 ?? 0}`)}
          </tbody>
        </table>
      </div>
      <p className="hint">La cohorte mensual de escalados es la creación del ticket, no la fecha real del escalado (no disponible). Estados observados (CUM): {(t.periods.cum?.statuses ?? []).map((s) => `${s.status} ${s.tickets}`).join(" · ") || "—"}; observados entre {fdate(t.periods.cum?.observedFrom)} y {fdate(t.periods.cum?.observedTo)}.</p>
      {b ? (
        <>
          <h3>Bugs vinculados a tickets creados en el periodo</h3>
          <div className="table-wrap">
            <table>
              <caption className="hint">Cohorte de tickets, no fecha de aparición o cierre del defecto. Bugs únicos por producto + ámbito DevOps + ID; problemas e incidentes son conteos de tickets distintos.</caption>
              <thead><tr><th scope="col">Hecho</th>{PERIOD_KEYS.map((k) => <th key={k} scope="col" className="num">{TITLE[k]}</th>)}</tr></thead>
              <tbody>
                <tr><th scope="row">Bugs (Work Item Bug_) con vínculo confirmado</th>{PERIOD_KEYS.map((k) => <td key={k} className="num"><Link href={L(c, { det: "bugs", periodo: k })}>{b.periods[k]?.bugs ?? 0}</Link></td>)}</tr>
                {row("Problemas afectados (tickets distintos)", (k) => b.periods[k]?.problems ?? 0)}
                {row("Incidentes afectados (tickets distintos)", (k) => b.periods[k]?.incidents ?? 0)}
              </tbody>
            </table>
          </div>
          <p className="hint">Fuera del conteo confirmado: {b.outside.rejectedInScope} vínculo(s) rechazado(s) de este ámbito; {b.outside.pendingTicketGlobal} vínculo(s) pendientes de ticket y {b.outside.centralInternalGlobal} de tickets centrales internos (contexto: no identifican clientes afectados) en toda la base. «PR» y «Ready for Release» no significan desplegado ni resuelto. La cobertura parcial de los vínculos no representa todos los clientes afectados.</p>
        </>
      ) : null}
    </section>
  );
}

export function Datos({ c, isAdmin }: { c: Ctx; isAdmin: boolean }) {
  const f = c.f;
  const ref = f.economics.reference;
  return (
    <section aria-label="Datos y cobertura">
      <div className="card">
        <h3>Referencia de cálculo</h3>
        <dl className="kv">
          <dt>Motor y método</dt><dd>{ref.engineVersion} · {ref.method}</dd>
          <dt>Revisión de configuración</dt><dd>{f.economics.settings.revisionNo} (objetivo {f.economics.settings.targetEurosPerDay} €/jornada · jornada {f.economics.settings.dayHours} h)</dd>
          <dt>Sello de los datos leídos</dt><dd><code>{ref.dataStamp.stamp}</code> (por dominio: {Object.keys(ref.dataStamp.domains).join(", ")})</dd>
          <dt>Aislamiento</dt><dd>{ref.readIsolation} · leído {new Date(ref.readAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}</dd>
          <dt>Validación</dt><dd>{ref.validation.state === "VALIDATED" ? "derivados al día" : <>reproceso pendiente — {ref.pendingRecalc.reason}</>}</dd>
        </dl>
      </div>
      <h3>Fuentes financieras por año y categoría</h3>
      <div className="table-wrap">
        <table>
          <caption className="hint">Cobertura de los conjuntos financieros usados</caption>
          <thead><tr><th scope="col">Año</th><th scope="col">Categoría</th><th scope="col">Versión</th><th scope="col">Extracción</th><th scope="col">Origen</th><th scope="col">Sin asignar</th><th scope="col">Cobertura</th></tr></thead>
          <tbody>
            {ref.finance.map((x) => <tr key={`${x.year}-${x.category}`}><td>{x.year}</td><td>{x.category}</td><td>{x.version || "—"}</td><td>{fdate(x.extractionDate)}</td><td>{x.origin ?? "sin conjunto"}</td><td>{x.unassigned}</td><td>{x.coverage.toLowerCase().replace("_", " ")}</td></tr>)}
          </tbody>
        </table>
      </div>
      <h3>Últimas cargas completadas por fuente</h3>
      <div className="table-wrap">
        <table>
          <caption className="hint">Fechas de observación/extracción (la frescura declarada no equivale a cobertura temporal completa)</caption>
          <thead><tr><th scope="col">Perfil</th><th scope="col">Extracción declarada</th><th scope="col">Recibida</th><th scope="col" className="num">Filas importadas</th></tr></thead>
          <tbody>
            {(f.sources ?? []).map((s) => <tr key={s.profileId}><td>{s.profileId}</td><td>{s.extraction ? fdate(s.extraction) : "no declarada"}</td><td>{s.received}</td><td className="num">{s.rows}</td></tr>)}
            {(f.sources ?? []).length === 0 ? <tr><td colSpan={4} className="muted">Todavía no hay cargas completadas. {isAdmin ? <Link href="/administracion/cargas">Ir a Cargas</Link> : "Un Administrador puede cargar las fuentes."}</td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="hint">Limitaciones: ingreso imputado analítico (no facturación mensual real); Silver On Demand sin rentabilidad mensual recurrente; interpretaciones pendientes de aceptación (ZDT 11–13, ZTM 06–08, lista de origen PAP, estados de bugs). Los seis indicadores de Calidad, el Client Health y el backlog llegan en CSAPP-08; no hay aquí semáforos ni resultado global.{isAdmin ? <> Detalle del origen: <Link href="/administracion/cargas">Administración › Cargas</Link>.</> : null}</p>
    </section>
  );
}
