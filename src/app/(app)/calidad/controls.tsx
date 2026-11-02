import Link from "next/link";
import { COMPLEXITY_VALUES, HOSTING_VALUES, SUPPORT_VALUES, VALUE_LABEL } from "@/domain/catalogs";
import { MODE_VALUES, SELECT_MIXED, SELECT_NONE } from "@/domain/analytics-query";
import { COLOR_FILTERS, COLOR_FILTER_LABEL, QSCOPES, QSCOPE_NAME, QUALITY_VIEWS, VIEW_LABEL, qualityToParams, type QualityQuery } from "@/domain/quality-query";
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

/** Controles de Calidad (GET). Mes/corte y ámbito son del CÁLCULO; los filtros de identidad/color son de PRESENTACIÓN y no recalculan referencias. */
export function Controls({ q, products, lastFinished, basePath }: { q: QualityQuery; products: string[]; lastFinished: string; basePath: string }) {
  const b = q.base;
  return (
    <form method="get" action={basePath} className="card filters-card" aria-label="Controles de Calidad">
      <input type="hidden" name="vista" value={q.view} />
      {q.sel ? <input type="hidden" name="sel" value={q.sel} /> : null}
      <fieldset>
        <legend>Mes y corte</legend>
        <div className="filters-grid">
          <div className="field"><label htmlFor="f-fecha">Fecha de análisis</label><input id="f-fecha" type="date" name="fecha" defaultValue={b.date} /></div>
          <div className="field"><label htmlFor="f-modo">Corte</label>
            <select id="f-modo" name="modo" defaultValue={b.mode}>{MODE_VALUES.map((m) => <option key={m} value={m}>{m === "CUTOFF" ? "A fecha de corte (diario)" : "Mes completo"}</option>)}</select></div>
          <div className="field"><label htmlFor="f-ambito">Ámbito</label>
            <select id="f-ambito" name="ambito" defaultValue={q.scope}>{QSCOPES.map((s) => <option key={s} value={s}>{QSCOPE_NAME[s]}</option>)}</select></div>
          <div className="field"><label htmlFor="f-servicio">Servicio (solo Dedicación)</label>
            <select id="f-servicio" name="servicio" defaultValue={b.service}>{Object.entries(SERVICE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="field"><label htmlFor="f-rcal">Revisión de Calidad</label><input id="f-rcal" type="number" name="rcalidad" min={1} defaultValue={q.qrev ?? ""} placeholder="activa" /></div>
          <div className="field"><label htmlFor="f-rpulse">Revisión de perfiles (Pulse)</label><input id="f-rpulse" type="number" name="rpulse" min={1} defaultValue={q.prev ?? ""} placeholder="activa" /></div>
        </div>
        <p className="quick"><Link href={`${basePath}${qs({ ...qualityToParams({ ...q, base: { ...b, date: lastFinished, mode: "FULL_MONTH", page: 1 } }) })}`}>Último mes finalizado</Link></p>
      </fieldset>
      <fieldset>
        <legend>Filtros de filas (presentación)</legend>
        <p className="hint">Buscar, identificar por producto/soporte/alojamiento/complejidad vigentes o por color <strong>no cambia</strong> las referencias ni las tarjetas de colores.</p>
        <div className="filters-grid">
          <div className="field"><label htmlFor="f-q">Buscar por nombre</label><input id="f-q" type="search" name="q" defaultValue={b.q} maxLength={100} /></div>
          <Multi name="soporte" legend="Soporte vigente" values={SUPPORT_VALUES} selected={b.support} extra={[SELECT_NONE, SELECT_MIXED]} />
          <Multi name="alojamiento" legend="Alojamiento vigente" values={HOSTING_VALUES} selected={b.hosting} extra={[SELECT_NONE, SELECT_MIXED]} />
          <Multi name="complejidad" legend="Complejidad vigente" values={COMPLEXITY_VALUES} selected={b.complexity} extra={[SELECT_NONE, SELECT_MIXED]} />
          <div className="field"><label htmlFor="f-producto">Producto</label>
            <select id="f-producto" name="producto" defaultValue={b.product}><option value="">Todos</option>{products.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
          <div className="field"><label htmlFor="f-color">Resultado</label>
            <select id="f-color" name="color" defaultValue={q.color}>{COLOR_FILTERS.map((c) => <option key={c} value={c}>{COLOR_FILTER_LABEL[c]}</option>)}</select></div>
        </div>
      </fieldset>
      <div className="form-actions"><button className="btn btn-primary" type="submit">Aplicar</button> <Link className="btn btn-secondary" href={basePath}>Restablecer</Link></div>
    </form>
  );
}

export function ViewTabs({ q, basePath }: { q: QualityQuery; basePath: string }) {
  return (
    <ul className="tabs" aria-label="Secciones de Calidad">
      {QUALITY_VIEWS.map((v) => <li key={v}><Link href={`${basePath}${qs(qualityToParams({ ...q, view: v, base: { ...q.base, page: 1 }, det: "", fam: "" }))}`} aria-current={q.view === v ? "page" : undefined}>{VIEW_LABEL[v]}</Link></li>)}
    </ul>
  );
}
