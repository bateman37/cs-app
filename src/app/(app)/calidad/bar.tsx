import Link from "next/link";
import { FiltrosComunes } from "@/components/filtros-comunes";
import { commonFiltersToParams, type CommonFilters } from "@/domain/filtros-comunes";
import { QSCOPES, QSCOPE_NAME, lastClosedMonthEnd, monthToDate, qualityToParams, type QualityPeriod, type QualityQuery } from "@/domain/quality-query";
import { qs } from "@/lib/format";

const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

/**
 * Cabecera compacta de Calidad: periodo (mes/año, «A fecha de hoy / Mes completo», último mes cerrado), segmentadores comunes Soporte/Servidor y un control
 * pequeño Grupo/Cliente. Nada más: no hay búsqueda, servicio, complejidad, producto, estado ni selectores técnicos. Todo son enlaces y un formulario GET.
 */
export function QualityBar({ title, q, period, today, basePath, pending, csvHref, isAdmin }: { title: string; q: QualityQuery; period: QualityPeriod; today: string; basePath: string; pending: boolean; csvHref: string | null; isAdmin: boolean }) {
  const mode = q.base.mode;
  const link = (extra: Partial<QualityQuery>, date?: string, m?: "CUTOFF" | "FULL_MONTH") => `${basePath}${qs(qualityToParams({ ...q, ...extra, base: { ...q.base, date: date ?? q.base.date, mode: m ?? q.base.mode, page: 1 } }))}`;
  const shift = (d: number) => {
    const t = period.year * 12 + (period.month - 1) + d;
    return ym(Math.floor(t / 12), (t % 12) + 1);
  };
  const monthLink = (month: string) => link({ year: Number(month.slice(0, 4)) }, monthToDate(month, mode, today) ?? q.base.date);
  const nextOk = shift(1) <= today.slice(0, 7);
  const hrefFilters = (next: CommonFilters) => `${basePath}${qs({ ...qualityToParams({ ...q, filters: next, base: { ...q.base, page: 1 } }) })}`;
  return (
    <div className="ql-bar" role="region" aria-label="Periodo y selección">
      <h1>{title}</h1>
      <nav className="ql-period" aria-label="Periodo">
        <Link className="ql-arrow" href={monthLink(shift(-1))} aria-label="Mes anterior" prefetch={false}>‹</Link>
        <form method="get" action={basePath} aria-label="Elegir mes">
          <label className="visually-hidden" htmlFor="ql-mes">Mes</label>
          <input id="ql-mes" type="month" name="mes" defaultValue={ym(period.year, period.month)} max={today.slice(0, 7)} />
          <input type="hidden" name="modo" value={mode} />
          {Object.entries({ ...commonFiltersToParams(q.filters), ambito: q.scope !== "group" ? q.scope : "", kpi: q.kpi, sel: q.sel }).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
          <button type="submit">Ir</button>
        </form>
        <Link className="ql-arrow" href={monthLink(shift(1))} aria-label="Mes siguiente" aria-disabled={!nextOk} tabIndex={nextOk ? undefined : -1} prefetch={false}>›</Link>
        <span className="chips-group" role="group" aria-label="Corte del mes">
          <Link className={mode === "CUTOFF" ? "chip chip-on" : "chip"} aria-pressed={mode === "CUTOFF"} href={link({}, monthToDate(ym(period.year, period.month), "CUTOFF", today) ?? undefined, "CUTOFF")} prefetch={false}>A fecha de hoy</Link>
          <Link className={mode === "FULL_MONTH" ? "chip chip-on" : "chip"} aria-pressed={mode === "FULL_MONTH"} href={link({}, monthToDate(ym(period.year, period.month), "FULL_MONTH", today) ?? undefined, "FULL_MONTH")} prefetch={false}>Mes completo</Link>
        </span>
        <Link href={link({}, lastClosedMonthEnd(today), "FULL_MONTH")} className="chip" prefetch={false}>Último mes cerrado</Link>
        {period.provisional ? <span className="ql-tag" title={`Corte efectivo ${period.cut.split("-").reverse().join("/")}: el mes no está cerrado.`}>Provisional</span> : null}
      </nav>
      <FiltrosComunes value={q.filters} hrefFor={hrefFilters} />
      <span className="chips-group" role="group" aria-label="Nivel">
        <span className="chips-title">Nivel</span>
        {QSCOPES.map((s) => <Link key={s} className={q.scope === s ? "chip chip-on" : "chip"} aria-pressed={q.scope === s} href={`${basePath}${qs(qualityToParams({ ...q, scope: s, sel: "", fam: "", base: { ...q.base, page: 1 } }))}`} prefetch={false}>{s === "group" ? "Grupo" : "Cliente"}<span className="visually-hidden"> ({QSCOPE_NAME[s]})</span></Link>)}
      </span>
      <span className="ql-spacer" />
      <span className="ql-links">
        {pending ? (isAdmin
          ? <Link className="ql-pending" href="/administracion/conciliacion" title="Hay datos por completar o confirmar: abrir Administración › Diagnóstico de datos." prefetch={false}>Datos pendientes</Link>
          : <span className="ql-pending" title="Hay datos por completar: lo resuelve un Administrador en Administración › Diagnóstico de datos.">Datos pendientes</span>) : null}
        {csvHref ? <a href={csvHref}>CSV</a> : null}
      </span>
    </div>
  );
}
