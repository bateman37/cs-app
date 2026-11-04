import Link from "next/link";
import { COMPLEXITY_VALUES, HOSTING_VALUES, SUPPORT_VALUES, VALUE_LABEL } from "@/domain/catalogs";
import { FAMILIES, FAMILY_LABEL, PULSE_METRICS, type PulseReference } from "@/domain/pulse-catalog";
import { NORM_MODES, NORM_MODE_LABEL, PERIOD_LABEL, PULSE_PAGE_SIZES, PULSE_PERIODS, SCOPES, SCOPE_LABEL, pulseToParams, type PulseQuery } from "@/domain/pulse-query";
import { MODE_VALUES, SELECT_MIXED, SELECT_NONE } from "@/domain/analytics-query";
import { qs } from "@/lib/format";

const SERVICE_LABEL = { SOPORTE: "Soporte", ADMIN_DELEGADA: "Administración delegada", OTROS: "Otros", TOTAL: "Total (los tres)" } as const;

const Multi = ({ name, legend, values, selected, extra }: { name: string; legend: string; values: readonly string[]; selected: string[]; extra?: string[] }) => (
  <div className="field">
    <label htmlFor={`f-${name}`}>{legend}</label>
    <select id={`f-${name}`} name={name} multiple size={Math.min(5, values.length + (extra?.length ?? 0))} defaultValue={selected}>
      {values.map((v) => <option key={v} value={v}>{VALUE_LABEL[v] ?? v}</option>)}
      {(extra ?? []).map((v) => <option key={v} value={v}>{v === SELECT_NONE ? "Sin informar" : "Heterogéneo"}</option>)}
    </select>
  </div>
);

/**
 * Controles de Pulse Rent (GET). TRES conceptos separados: filas visibles (búsqueda y filtros de presentación), referencia estadística
 * (población de cada distribución) y referencia económica (cartera). Cambiar los filtros de filas NO cambia la referencia.
 */
export function Controls({ q, products, references, basePath }: { q: PulseQuery; products: string[]; references: PulseReference[]; basePath: string }) {
  const b = q.base;
  const rowFiltersOn = b.support.length + b.hosting.length + b.complexity.length > 0 || b.product !== "";
  const asReference = rowFiltersOn
    ? `${basePath}${qs({ ...pulseToParams({ ...q, ref: "custom", custom: { plans: b.support.filter((x) => (SUPPORT_VALUES as readonly string[]).includes(x)), hostings: b.hosting.filter((x) => (HOSTING_VALUES as readonly string[]).includes(x)), complexities: b.complexity.filter((x) => (COMPLEXITY_VALUES as readonly string[]).includes(x)), product: b.product === SELECT_NONE ? "" : b.product, homogeneous: true }, base: { ...b, page: 1 } }) })}`
    : null;
  return (
    <form method="get" action={basePath} className="card filters-card" aria-label="Controles de Pulse Rent">
      {q.sort !== "name" ? <input type="hidden" name="orden" value={q.sort} /> : null}
      {b.dir !== "asc" ? <input type="hidden" name="dir" value={b.dir} /> : null}
      {q.col ? <input type="hidden" name="col" value={q.col} /> : null}
      {b.stamp ? <input type="hidden" name="sello" value={b.stamp} /> : null}
      <fieldset>
        <legend>Cálculo</legend>
        <div className="filters-grid">
          <div className="field"><label htmlFor="f-fecha">Fecha de análisis</label><input id="f-fecha" type="date" name="fecha" defaultValue={b.date} /></div>
          <div className="field"><label htmlFor="f-modo">Corte</label>
            <select id="f-modo" name="modo" defaultValue={b.mode}>{MODE_VALUES.map((m) => <option key={m} value={m}>{m === "CUTOFF" ? "A fecha de corte" : "Mes completo"}</option>)}</select></div>
          <div className="field"><label htmlFor="f-periodo">Periodo</label>
            <select id="f-periodo" name="periodo" defaultValue={q.period}>{PULSE_PERIODS.map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}</select></div>
          <div className="field"><label htmlFor="f-ambito">Ámbito (una fila por…)</label>
            <select id="f-ambito" name="ambito" defaultValue={q.scope}>{SCOPES.map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}</select></div>
          <div className="field"><label htmlFor="f-servicio">Servicio económico</label>
            <select id="f-servicio" name="servicio" defaultValue={b.service}>{Object.entries(SERVICE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="field"><label htmlFor="f-norm">Normalización</label>
            <select id="f-norm" name="norm" defaultValue={q.norm}>{NORM_MODES.map((n) => <option key={n} value={n}>{NORM_MODE_LABEL[n]}</option>)}</select>
            <small>Se aplica a toda la columna y a su referencia.</small></div>
          <div className="field field-check"><input id="f-hist" type="checkbox" name="historico" value="1" defaultChecked={q.historic} /><label htmlFor="f-hist">Equivalencia histórica de horas</label><small>Modo separado: supone usuarios constantes y meses completos.</small></div>
          <div className="field"><label htmlFor="f-rpulse">Revisión de Pulse Rent</label><input id="f-rpulse" type="number" name="rpulse" min={1} defaultValue={q.pulseRevision ?? ""} placeholder="última activa" /></div>
        </div>
      </fieldset>
      <fieldset>
        <legend>Referencia estadística</legend>
        <p className="hint">Población con la que se calculan media, mediana y percentiles. No depende de las filas que vea.</p>
        <div className="filters-grid">
          <div className="field"><label htmlFor="f-ref">Referencia</label>
            <select id="f-ref" name="ref" defaultValue={q.ref || ""}>
              <option value="">Predeterminada</option>
              {references.map((r) => <option key={r.id} value={r.id}>{r.label}{r.origin === "PERSONALIZADA" ? " (personalizada)" : ""}</option>)}
              {q.ref === "custom" ? <option value="custom">Personalizada (criterios copiados de los filtros)</option> : null}
            </select></div>
          <div className="field"><label htmlFor="f-refeco">Referencia económica (cartera)</label>
            <select id="f-refeco" name="refeco" defaultValue={q.refEco || ""}>
              <option value="">Igual que la estadística</option>
              {references.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select><small>Ratio ΣR/ΣH×jornada de grupos completos; no es la media de ratios.</small></div>
        </div>
        {q.ref === "custom" ? (
          <>
            {["rsoporte", "ralojamiento", "rcomplejidad", "rproducto", "rhomog"].map((k) => {
              const v = pulseToParams(q)[k];
              return v ? <input key={k} type="hidden" name={k} value={v} /> : null;
            })}
          </>
        ) : null}
      </fieldset>
      <fieldset>
        <legend>Filas visibles</legend>
        <p className="hint">Búsqueda y filtros de presentación: no modifican la referencia.</p>
        <div className="filters-grid">
          <div className="field"><label htmlFor="f-q">Buscar</label><input id="f-q" type="search" name="q" defaultValue={b.q} maxLength={100} /></div>
          <Multi name="soporte" legend="Plan de soporte" values={SUPPORT_VALUES} selected={b.support} extra={[SELECT_NONE, SELECT_MIXED]} />
          <Multi name="alojamiento" legend="Alojamiento" values={HOSTING_VALUES} selected={b.hosting} extra={[SELECT_NONE, SELECT_MIXED]} />
          <Multi name="complejidad" legend="Complejidad" values={COMPLEXITY_VALUES} selected={b.complexity} extra={[SELECT_NONE, SELECT_MIXED]} />
          <div className="field"><label htmlFor="f-producto">Producto</label>
            <select id="f-producto" name="producto" defaultValue={b.product}><option value="">Todos</option><option value={SELECT_NONE}>Sin informar</option>{products.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
          <div className="field"><label htmlFor="f-estado">Estado</label>
            <select id="f-estado" name="estado" defaultValue={b.status}><option value="activos">Activos</option><option value="inactivos">Inactivos</option><option value="todos">Todos</option></select></div>
          <div className="field"><label htmlFor="f-cobertura">Cobertura del maestro</label>
            <select id="f-cobertura" name="cobertura" defaultValue={b.coverage}><option value="todas">Todas</option><option value="completa">Completa</option><option value="parcial">Parcial</option><option value="sin_datos">Sin datos</option></select></div>
          <div className="field"><label htmlFor="f-tam">Filas por página</label>
            <select id="f-tam" name="tam" defaultValue={String(b.pageSize)}>{PULSE_PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
        </div>
      </fieldset>
      <details className="metric-details">
        <summary>Columnas (métricas) — {q.metrics.length} seleccionadas</summary>
        {FAMILIES.map((f) => (
          <fieldset key={f}>
            <legend>{FAMILY_LABEL[f]}</legend>
            <div className="metric-picker">
              {PULSE_METRICS.filter((m) => m.family === f).map((m) => (
                <label key={m.id}><input type="checkbox" name="m" value={m.id} defaultChecked={q.metrics.includes(m.id)} /> <span><strong>{m.id}</strong> {m.label}</span></label>
              ))}
            </div>
          </fieldset>
        ))}
      </details>
      <div className="quick">
        <button type="submit" className="btn btn-primary">Aplicar</button>
        <Link className="btn btn-secondary" href={basePath}>Restablecer</Link>
        {asReference ? <Link className="btn btn-secondary" href={asReference} title="Acción explícita: copia los criterios de los filtros de filas a la referencia (se muestra como personalizada)">Usar los filtros visibles como referencia</Link> : <span className="hint">Para usar filtros como referencia, filtre primero por plan, alojamiento, complejidad o producto.</span>}
      </div>
    </form>
  );
}
