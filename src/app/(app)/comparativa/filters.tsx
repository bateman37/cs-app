import Link from "next/link";
import { COMPLEXITY_VALUES, HOSTING_VALUES, SUPPORT_VALUES, VALUE_LABEL } from "@/domain/catalogs";
import { MODE_VALUES, SELECT_MIXED, SELECT_NONE, type AnalysisQuery } from "@/domain/analytics-query";
import { lastDayOfMonth, previousMonth, parseYmd, ymdToIso } from "@/domain/finance";
import { todayMadrid } from "@/domain/vigencia";
import { qs } from "@/lib/format";

const SERVICE_LABEL = { SOPORTE: "Soporte", ADMIN_DELEGADA: "Administración delegada", OTROS: "Otros", TOTAL: "Total (los tres)" } as const;

const Multi = ({ name, legend, values, selected, extra }: { name: string; legend: string; values: readonly string[]; selected: string[]; extra?: string[] }) => (
  <div className="field">
    <label htmlFor={`f-${name}`}>{legend}</label>
    <select id={`f-${name}`} name={name} multiple size={Math.min(5, values.length + (extra?.length ?? 0))} defaultValue={selected} aria-describedby={`h-${name}`}>
      {values.map((v) => <option key={v} value={v}>{VALUE_LABEL[v] ?? v}</option>)}
      {(extra ?? []).map((v) => <option key={v} value={v}>{v === SELECT_NONE ? "Sin informar" : "Heterogéneo"}</option>)}
    </select>
    <small id={`h-${name}`}>Ctrl/Cmd para varios. «Grupos que contienen…».</small>
  </div>
);

/** Filtros compactos (GET): cambiar un filtro reinicia la página y conserva orden, bloques y el resto del contexto. */
export function Filters({ q, products, basePath, hidden }: { q: AnalysisQuery; products: string[]; basePath: string; hidden: Record<string, string> }) {
  const today = todayMadrid();
  const t = parseYmd(today);
  const pm = previousMonth(t.y, t.m);
  const lastClosed = ymdToIso({ y: pm.y, m: pm.m, d: lastDayOfMonth(pm.y, pm.m) });
  return (
    <form method="get" action={basePath} className="card filters-card" aria-label="Filtros de la cartera">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div className="filters-grid">
        <div className="field"><label htmlFor="f-fecha">Fecha de análisis</label><input id="f-fecha" type="date" name="fecha" defaultValue={q.date} /></div>
        <div className="field"><label htmlFor="f-modo">Modo</label>
          <select id="f-modo" name="modo" defaultValue={q.mode}>
            {MODE_VALUES.map((m) => <option key={m} value={m}>{m === "CUTOFF" ? "A fecha de corte" : "Mes completo"}</option>)}
          </select></div>
        <div className="field"><label htmlFor="f-servicio">Servicio económico</label>
          <select id="f-servicio" name="servicio" defaultValue={q.service}>
            {Object.entries(SERVICE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select><small>Independiente del plan.</small></div>
        <div className="field"><label htmlFor="f-q">Buscar grupo o denominación BC</label><input id="f-q" type="search" name="q" defaultValue={q.q} maxLength={100} /></div>
        <Multi name="soporte" legend="Plan de soporte" values={SUPPORT_VALUES} selected={q.support} extra={[SELECT_NONE, SELECT_MIXED]} />
        <Multi name="alojamiento" legend="Alojamiento" values={HOSTING_VALUES} selected={q.hosting} extra={[SELECT_NONE, SELECT_MIXED]} />
        <Multi name="complejidad" legend="Complejidad" values={COMPLEXITY_VALUES} selected={q.complexity} extra={[SELECT_NONE, SELECT_MIXED]} />
        <div className="field"><label htmlFor="f-producto">Producto</label>
          <select id="f-producto" name="producto" defaultValue={q.product}>
            <option value="">Todos</option><option value={SELECT_NONE}>Sin informar</option>
            {products.map((p) => <option key={p} value={p}>{p}</option>)}
          </select><small>Grupos que contienen el producto.</small></div>
        <div className="field"><label htmlFor="f-estado">Estado del maestro</label>
          <select id="f-estado" name="estado" defaultValue={q.status}><option value="todos">Todos (incluye inactivos)</option><option value="activos">Activos</option><option value="inactivos">Inactivos</option></select></div>
        <div className="field"><label htmlFor="f-cobertura">Cobertura del maestro</label>
          <select id="f-cobertura" name="cobertura" defaultValue={q.coverage}><option value="todas">Todas</option><option value="completa">Completa</option><option value="parcial">Parcial</option><option value="sin_datos">Sin datos</option></select></div>
        <div className="field"><label htmlFor="f-tam">Filas por página</label>
          <select id="f-tam" name="tam" defaultValue={String(q.pageSize)}>{[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
        <div className="field"><label htmlFor="f-rev">Revisión de configuración</label><input id="f-rev" type="number" name="revision" min={1} defaultValue={q.revision ?? ""} placeholder="última activa" /></div>
      </div>
      <div className="quick">
        <button type="submit" className="btn btn-primary">Aplicar filtros</button>
        <Link className="btn btn-secondary" href={`${basePath}${qs({ ...hidden, fecha: today, modo: "FULL_MONTH" })}`}>Mes completo (mes en curso, provisional)</Link>
        <Link className="btn btn-secondary" href={`${basePath}${qs({ ...hidden, fecha: lastClosed, modo: "FULL_MONTH" })}`}>Última mensualidad finalizada</Link>
        <Link className="btn btn-secondary" href={basePath}>Restablecer</Link>
      </div>
    </form>
  );
}
