import Link from "next/link";
import type { ReactNode } from "react";
import { INDICATOR_NAME, UNIT_LABEL, type IndicatorKey } from "@/domain/quality-config";
import { KPI_ACCESS_NAME, KPI_OBSERVED_UNIT, rateUnit } from "@/domain/quality-kpi";
import { COVERAGE_SOURCE_LABEL } from "@/domain/quality-coverage";
import { MONTH_SHORT } from "@/domain/usuarios";
import { qualityToParams, type QualityQuery } from "@/domain/quality-query";
import { LineChart, Legend, color } from "@/components/analytics/charts";
import { Pager, fdate } from "@/components/analytics/ui";
import { PROFILE_LABEL } from "@/domain/pulse-catalog";
import type { QualityRow, QualityView } from "@/server/quality/engine";
import type { DedicationSection, KpiSection, PapSection, TicketsSection } from "@/server/quality/sections";
import { NeutralTag, StateTag, STATUS_TEXT, cellInfo, num, reasonOf } from "./ui";
import { kpiHref } from "./table";

const n1 = (v: string | null | undefined) => num(v, 1);
const dash = <span className="ql-muted" aria-label="sin dato">—</span>;

function Mt({ cols, rows, foot, right = [] }: { cols: string[]; rows: ReactNode[][]; foot?: ReactNode[]; right?: number[] }) {
  return (
    <div className="ql-wrap" tabIndex={0} role="region" aria-label="Tabla (desplazable)">
      <table className="ql-table">
        <thead><tr>{cols.map((c, i) => <th key={c + i} scope="col" className={right.includes(i) ? "ql-r" : undefined}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j} className={right.includes(j) ? "ql-r" : undefined}>{c}</td>))}</tr>)}</tbody>
        {foot ? <tfoot><tr>{foot.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j} className={right.includes(j) ? "ql-r" : undefined}>{c}</td>))}</tr></tfoot> : null}
      </table>
    </div>
  );
}
const monthLabel = (m: number, partial: boolean) => <>{MONTH_SHORT[m - 1]}{partial ? <small className="ql-muted"> (corte)</small> : null}</>;
const Panel = ({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) => (
  <section className="ql-panel" aria-label={title}><h2>{title}</h2>{note ? <p className="ql-note">{note}</p> : null}{children}</section>
);
const rateOrDash = (v: string | null) => (v === null ? dash : <span className="ql-num">{n1(v)}</span>);

// ---------------------------------------------------------------- Selección: una fila por entidad para el indicador abierto

export function SelectionTable({ rows, k, q, basePath }: { rows: QualityRow[]; k: IndicatorKey; q: QualityQuery; basePath: string }) {
  const unit = rateUnit(k, rows[0]?.evaluation.indicators[k].unit);
  return (
    <div className="ql-wrap" tabIndex={0} role="region" aria-label={`${KPI_ACCESS_NAME[k]} por ${q.scope === "group" ? "Grupo Cliente" : "Cliente"} (desplazable)`}>
      <table className="ql-table">
        <caption className="visually-hidden">{KPI_ACCESS_NAME[k]} por {q.scope === "group" ? "Grupo Cliente" : "Cliente"}</caption>
        <thead><tr><th scope="col">{q.scope === "group" ? "Grupo Cliente" : "Cliente"}</th><th scope="col" className="ql-r">Usuarios</th><th scope="col" className="ql-r">{k === "HEALTH" ? "Feedback del mes" : `Valor (${unit})`}</th><th scope="col">Estado</th>{k === "HEALTH" ? null : <th scope="col" className="ql-r">Observado ({KPI_OBSERVED_UNIT[k]})</th>}<th scope="col">Detalle</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const i = r.evaluation.indicators[k];
            const c = cellInfo(i, r.explain[k].observed);
            const obs = r.explain[k].observed;
            return (
              <tr key={r.id} aria-selected={q.sel === r.id}>
                <th scope="row" className="ql-name">{r.name}{r.parent ? <small>{r.parent}</small> : null}</th>
                <td className="ql-r">{r.users.stock ?? dash}</td>
                <td className="ql-r">{c.main === null ? dash : <strong>{c.kind === "PARTIAL" ? "≥ " : ""}{k === "HEALTH" ? c.main : num(c.main)}</strong>}</td>
                <td>{c.color ? <StateTag color={c.color} /> : i.alert && i.value !== null ? <StateTag color="red" text="Alerta parcial" /> : <NeutralTag partial={c.kind === "PARTIAL"} title={reasonOf(i)}>{c.label || "Sin dato"}</NeutralTag>}</td>
                {k === "HEALTH" ? null : <td className="ql-r">{obs === null || obs === undefined ? dash : n1(obs)}</td>}
                <td><Link href={kpiHref(q, basePath, k, r.id)} aria-label={`Abrir el detalle de ${KPI_ACCESS_NAME[k]} de ${r.name}`} prefetch={false}>Abrir</Link></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- Ver cálculo (bajo demanda)

export function CalcBlock({ k, row, view }: { k: IndicatorKey; row: QualityRow | null; view: QualityView }) {
  const e = row?.explain[k];
  const i = row?.evaluation.indicators[k];
  const cov = Object.values(view.coverage);
  return (
    <details className="ql-calc">
      <summary>Ver cálculo</summary>
      <dl>
        {e && i ? (
          <>
            <dt>Fórmula</dt><dd>{e.formula}</dd>
            <dt>Numerador / denominador</dt><dd>{e.numerator ?? "—"} / {e.denominator ?? "—"} <small>({UNIT_LABEL[i.unit]})</small></dd>
            <dt>Periodo</dt><dd>{e.period} ({view.query.base.mode === "FULL_MONTH" ? "mes completo" : "corte diario"})</dd>
            <dt>Estado del valor</dt><dd>{STATUS_TEXT[i.status] ?? i.status} — {i.reason}{i.cuts ? <> · umbrales a={i.cuts.a}, b={i.cuts.b}{i.n !== undefined ? `, N=${i.n}` : ""}</> : null}</dd>
            {Object.keys(e.breakdown).length ? <><dt>Desglose</dt><dd>{Object.entries(e.breakdown).map(([bk, bv]) => `${bk}: ${bv}`).join(" · ")}</dd></> : null}
            {i.components ? <><dt>Componentes</dt><dd>{i.components.map((c) => `${c.label}: ${c.value ?? "—"} (${c.color ?? STATUS_TEXT[c.status] ?? c.status})`).join(" · ")}</dd></> : null}
            {e.notes.length ? <><dt>Avisos del cálculo</dt><dd>{e.notes.join(" ")}</dd></> : null}
            <dt>Fuentes</dt><dd>{e.sources.join(", ") || "—"}</dd>
          </>
        ) : <><dt>Indicador</dt><dd>{INDICATOR_NAME[k]}: la fórmula y el numerador/denominador se consultan en el detalle de cada Grupo o Cliente.</dd></>}
        <dt>Cobertura declarada</dt><dd>{cov.map((c) => `${COVERAGE_SOURCE_LABEL[c.source]}: ${c.state === "COMPLETE" ? "completa" : c.state === "PARTIAL" ? "parcial" : "sin declarar"}`).join(" · ")}</dd>
        <dt>Backlog (fotografía)</dt><dd>{view.backlog.exact ? `Observado en el propio corte (${fdate(view.backlog.observedOn)}).` : view.backlog.provisional ? `Observado el ${fdate(view.backlog.observedOn)}: no es el valor del corte.` : "Sin fotografía compatible del corte."} {view.backlog.note}</dd>
        <dt>Configuración y datos</dt><dd>Calidad {view.config.revisionNo}{view.config.persisted ? "" : " (inicial)"} · perfiles de Pulse {view.pulseRevision} · sello <code>{view.stamp}</code> · leído {new Date(view.readAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })} · corte efectivo {fdate(view.period.cut)}</dd>
      </dl>
    </details>
  );
}

// ---------------------------------------------------------------- Dedicación

export function DedicationBody({ s, isAdmin }: { s: DedicationSection; isAdmin: boolean }) {
  const lastM = s.months[s.months.length - 1]?.month ?? 0;
  const rows: ReactNode[][] = s.lines.map((l) => [l.key === "SIN_PERFIL" ? "Sin perfil" : (PROFILE_LABEL[l.key as keyof typeof PROFILE_LABEL] ?? l.key), l.role ? `rol ${l.role}` : "", n1(l.month), l.previous === null ? dash : n1(l.previous), n1(l.cum), l.inIndicator ? <StateTag color="green" text="Entra" /> : <NeutralTag>No entra</NeutralTag>]);
  const pts = s.monthly.map((m) => ({ x: m.month, y: m.perUser === null ? null : Number(m.perUser), tip: `${MONTH_SHORT[m.month - 1]}: ${m.perUser ?? "sin dato"} h por usuario y mes` }));
  const pts2 = s.monthly.map((m) => ({ x: m.month, y: Number(m.total), tip: `${MONTH_SHORT[m.month - 1]}: ${m.total} h (todos los perfiles)` }));
  return (
    <>
      <div className="ql-cols">
        <Panel title="Horas por perfil" note={<>Servicio {s.service === "SOPORTE" ? "Soporte" : s.service}; horas elegibles según la fecha del trabajo (antes de 2025 Zendesk, desde 2025 PMO en Wrike y el resto en Zendesk).</>}>
          <Mt cols={["Perfil", "Detalle", `${MONTH_SHORT[lastM - 1] ?? "Mes"} (h)`, "Mes anterior (h)", "CUM (h)", "Indicador"]} rows={rows} right={[2, 3, 4]} />
          {s.lines.length === 0 ? <p className="ql-note">Sin horas elegibles en el periodo para esta selección.</p> : null}
          {!s.selection.confirmed ? <p className="ql-note">Perfiles del indicador sin elegir: se muestran las horas por perfil, sin valor por usuario. {isAdmin ? <Link href="/administracion/configuracion?seccion=calidad">Configurar en Administración</Link> : "Lo configura un Administrador."}</p> : null}
        </Panel>
        <Panel title="Desglose CS, mantenimiento PMO y contexto" note="CS y mantenimiento PMO componen el indicador según los perfiles elegidos; IT y Plataforma son contexto.">
          <Mt cols={["Grupo de perfiles", `${MONTH_SHORT[lastM - 1] ?? "Mes"} (h)`, "Mes anterior (h)", "CUM (h)"]} rows={s.groups.map((g) => [<>{g.label}<small className="ql-muted"> · {g.note}</small></>, n1(g.month), g.previous === null ? dash : n1(g.previous), n1(g.cum)])} right={[1, 2, 3]} />
          {Number(s.pendingHours) > 0 ? <p className="ql-note">{n1(s.pendingHours)} h con pertenencia PMO pendiente: podrían entrar en el perímetro.</p> : null}
          {Number(s.unknownServiceHours) > 0 ? <p className="ql-note">{n1(s.unknownServiceHours)} h sin servicio o en conflicto fuera del perímetro de Soporte.</p> : null}
        </Panel>
      </div>
      <Panel title="Evolución y normalización por usuarios" note={`Horas del indicador ÷ usuarios·mes. ${s.usersMissing > 0 ? `${s.usersMissing} de ${s.entities} entidades sin usuarios informados el último mes: sus horas no entran en la tasa.` : ""}`}>
        <div className="ql-cols">
          <Mt cols={["Mes", "Horas (todos)", "Horas (indicador)", "Usuarios·mes", "h/usuario·mes"]} rows={s.monthly.map((m) => [monthLabel(m.month, s.months.find((c) => c.month === m.month)?.partial ?? false), n1(m.total), s.selection.confirmed ? n1(m.selected) : dash, m.userMonths === null ? dash : n1(m.userMonths), s.selection.confirmed ? rateOrDash(m.perUser) : dash])} right={[1, 2, 3, 4]} />
          <div className="ql-chart">
            <Legend items={[{ label: "h/usuario·mes (indicador)", color: color(0), marker: "circle" }, { label: "Horas (todos los perfiles)", color: color(2), marker: "square" }]} />
            <LineChart title="Dedicación mensual" unit="horas o horas por usuario y mes" lines={[{ name: "h/usuario·mes", color: color(0), marker: "circle", points: pts }, { name: "Horas totales", color: color(2), marker: "square", points: pts2 }]} />
          </div>
        </div>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- PAP correctivos

export function PapBody({ s, list, q, basePath }: { s: PapSection; list: Extract<KpiSection, { kind: "PAP_CORRECTIVE" }>["list"]; q: QualityQuery; basePath: string }) {
  const diff = (a: number, b: number) => (a - b > 0 ? `+${a - b}` : String(a - b));
  const rows: ReactNode[][] = s.monthly.map((m) => [monthLabel(m.month, s.months.find((c) => c.month === m.month)?.partial ?? false), m.total, <strong key="c">{m.corrective}</strong>, m.standard, m.project, m.clientOrigin, m.clientRequest, m.unclassified, m.previousYear.corrective, diff(m.corrective, m.previousYear.corrective), rateOrDash(m.rate)]);
  const foot: ReactNode[] = ["CUM", s.cum.total, s.cum.corrective, s.cum.standard, s.cum.project, s.cum.clientOrigin, s.cum.clientRequest, s.cum.unclassified, s.previousCum.corrective, diff(s.cum.corrective, s.previousCum.corrective), ""];
  const pts = (f: (m: PapSection["monthly"][number]) => number, name: string) => s.monthly.map((m) => ({ x: m.month, y: f(m), tip: `${MONTH_SHORT[m.month - 1]}: ${f(m)} ${name}` }));
  return (
    <>
      <Panel title="PAP únicos por mes de producción" note="Un PAP cuenta una vez por ID aunque tenga varias causas; correctivo si cualquier causa lo es. Las pertenencias pueden solaparse y no suman el total. Petición cliente es una categoría propia (no es correctivo).">
        <div className="ql-cols">
          <Mt cols={["Mes", "PAP", "Correctivos", "Estándar", "Proyecto", "Origen cliente", "Petición cliente", "Sin clasificar", "Corr. año ant.", "Dif.", "/100 u·mes"]} rows={rows} foot={foot} right={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]} />
          <div className="ql-chart">
            <Legend items={[{ label: "Correctivos", color: color(0), marker: "circle" }, { label: "Correctivos, año anterior", color: color(5), marker: "square", dash: "4 3" }]} />
            <LineChart title="PAP correctivos por mes" unit="PAP únicos" lines={[{ name: "Correctivos", color: color(0), marker: "circle", points: pts((m) => m.corrective, "PAP correctivos") }, { name: "Año anterior", color: color(5), marker: "square", dash: "4 3", points: pts((m) => m.previousYear.corrective, "PAP correctivos (año anterior)") }]} />
          </div>
        </div>
        {s.noDate > 0 ? <p className="ql-note">{s.noDate} PAP sin fecha de producción: no se pueden ubicar en ningún mes.</p> : null}
      </Panel>
      <Panel title={`PAP del mes (${list.total})`}>
        <Mt cols={["Lista · ID", "Título", "Producción", "Estado", "Causas"]} rows={list.rows.map((r) => [`${r.listKey} · ${r.papId}`, r.title, fdate(r.production), r.state === "CORRECTIVE" ? "Correctivo" : r.state === "UNKNOWN" ? "Sin clasificar" : "No correctivo", r.causes])} />
        <Pager base={basePath} params={qualityToParams(q)} page={list.page} pageCount={list.pageCount} total={list.total} noun="PAP" />
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- Escalados a N3

export function N3Body({ s, list, q, basePath }: { s: TicketsSection; list: Extract<KpiSection, { kind: "N3_ESCALATIONS" }>["list"]; q: QualityQuery; basePath: string }) {
  const rows: ReactNode[][] = s.monthly.map((m) => [monthLabel(m.month, s.months.find((c) => c.month === m.month)?.partial ?? false), m.total, <strong key="n">{m.n3}</strong>, m.n3pmo, m.n3it, rateOrDash(m.rate.n3)]);
  const pts = s.monthly.map((m) => ({ x: m.month, y: m.n3, tip: `${MONTH_SHORT[m.month - 1]}: ${m.n3} tickets con tag N3` }));
  return (
    <>
      <Panel title="Tickets escalados a N3 por mes de creación" note="Tickets únicos con tag PMO N3 o IT N3 (un ticket con ambos cuenta una vez). La evolución usa la fecha de creación del ticket como proxy: no es la fecha del escalado.">
        <div className="ql-cols">
          <Mt cols={["Mes", "Tickets creados", "Escalados N3", "con PMO N3", "con IT N3", "/100 u·mes"]} rows={rows} foot={["CUM", s.cum.total, s.cum.n3, s.cum.n3pmo, s.cum.n3it, ""]} right={[1, 2, 3, 4, 5]} />
          <div className="ql-chart"><LineChart title="Escalados a N3 por mes de creación" unit="tickets únicos" lines={[{ name: "Escalados N3", color: color(0), marker: "circle", points: pts }]} /></div>
        </div>
      </Panel>
      <Panel title={`Tickets escalados del mes (${list.total})`}>
        <Mt cols={["Ticket", "Creación", "Tipo", "Estado", "Tags N3", "Causa registrada"]} rows={list.rows.map((t) => [t.ticketId, fdate(t.created), t.type, t.status, t.destinations.filter((d) => d.endsWith("_N3")).map((d) => (d === "PMO_N3" ? "PMO N3" : "IT N3")).join(" + "), t.cause ?? <NeutralTag>Causa sin informar</NeutralTag>])} />
        <Pager base={basePath} params={qualityToParams(q)} page={list.page} pageCount={list.pageCount} total={list.total} noun="tickets" />
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- Incidentes y problemas (volumen)

export function IncidentsFlow({ s }: { s: TicketsSection }) {
  const rows: ReactNode[][] = s.monthly.map((m) => [monthLabel(m.month, s.months.find((c) => c.month === m.month)?.partial ?? false), m.inc, m.prob, <strong key="t">{m.inc + m.prob}</strong>, rateOrDash(m.rate.flow)]);
  const pts = (f: (m: TicketsSection["monthly"][number]) => number, name: string) => s.monthly.map((m) => ({ x: m.month, y: f(m), tip: `${MONTH_SHORT[m.month - 1]}: ${f(m)} ${name}` }));
  return (
    <Panel title="Volumen: altas por mes" note="Tickets creados cada mes; incidentes y problemas se muestran separados. El flujo y el backlog abierto no se suman.">
      <div className="ql-cols">
        <Mt cols={["Mes", "Incidentes", "Problemas", "Total", "/100 u·mes"]} rows={rows} foot={["CUM", s.cum.inc, s.cum.prob, s.cum.inc + s.cum.prob, ""]} right={[1, 2, 3, 4]} />
        <div className="ql-chart"><LineChart title="Altas de incidentes y problemas" unit="tickets" lines={[{ name: "Incidentes", color: color(0), marker: "circle", points: pts((m) => m.inc, "incidentes") }, { name: "Problemas", color: color(2), marker: "square", points: pts((m) => m.prob, "problemas") }]} /></div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- Bugs y afectaciones

export function BugsBody({ s, list, openBugs, q, basePath }: { s: TicketsSection; list: Extract<KpiSection, { kind: "BUGS_STANDARD" }>["list"]; openBugs: Extract<KpiSection, { kind: "BUGS_STANDARD" }>["openBugs"]; q: QualityQuery; basePath: string }) {
  const rows: ReactNode[][] = s.monthly.map((m) => [monthLabel(m.month, s.months.find((c) => c.month === m.month)?.partial ?? false), m.s, m.b, m.both, <strong key="u">{m.union}</strong>, rateOrDash(m.rate.bugs)]);
  return (
    <>
      <Panel title="Problemas de clientes con bug o causa estándar" note="Problemas externos vinculados a un Bug_ o con causa estándar, unión sin duplicar IDs. Mide afectación conocida: un cero sustentado es cero evidencia registrada, no ausencia probada de defectos.">
        <Mt cols={["Mes", "Por causa estándar", "Por vínculo a Bug_", "Ambas", "Total único", "/100 u·mes"]} rows={rows} foot={["CUM", s.cum.s, s.cum.b, s.cum.both, s.cum.union, ""]} right={[1, 2, 3, 4, 5]} />
      </Panel>
      <div className="ql-cols">
        <Panel title={`Problemas afectados del mes (${list.total})`}>
          <Mt cols={["Ticket", "Creación", "Motivo", "Bug_", "Causa registrada"]} rows={list.rows.map((t) => [t.ticketId, fdate(t.created), [t.viaCause ? "causa estándar" : null, t.viaLink ? "vínculo a Bug_" : null].filter(Boolean).join(" + "), t.bugs.length ? t.bugs.join(", ") : dash, t.cause ?? <NeutralTag>Causa sin informar</NeutralTag>])} />
          <Pager base={basePath} params={qualityToParams(q)} page={list.page} pageCount={list.pageCount} total={list.total} noun="tickets" />
        </Panel>
        <Panel title="Contexto: bugs abiertos de producto (VFS / VSW)" note={`Solo Work Item Type = Bug_. No se atribuyen a clientes por el texto ni por el título. PR y Ready for Release no son despliegue.${openBugs.lastObservedOn ? ` Última observación: ${fdate(openBugs.lastObservedOn)}.` : ""}`}>
          {openBugs.rows.length === 0 ? <p className="ql-note">Sin bugs de producto cargados.</p> : <Mt cols={["Producto", "Estado (categoría)", "Bugs"]} rows={openBugs.rows.map((b) => [b.product, b.category === "PR_PENDING" ? "PR (pendiente de pull request)" : b.category === "READY_FOR_RELEASE" ? "Ready for Release (no es despliegue)" : b.category === "PENDING_REVIEW" ? "Estado por revisar" : b.category, b.bugs])} right={[2]} />}
        </Panel>
      </div>
    </>
  );
}
