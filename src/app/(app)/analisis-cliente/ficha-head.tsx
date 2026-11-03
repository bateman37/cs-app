import Link from "next/link";
import type { FichaView } from "@/server/analytics/ficha";
import type { EntityResult } from "@/server/economics/engine";
import { MONTH_SHORT } from "@/domain/ficha-series";
import { lastDayOfMonth } from "@/domain/finance";
import { todayMadrid } from "@/domain/vigencia";
import { label } from "@/components/analytics/ui";
import { Na } from "./ficha-client";
import { Amt, Dev, dmy, num } from "./ficha-format";
import { BASE, backUrl, fichaUrl, type Nav } from "./links";

const TYPE_LABEL = { group: "Grupo Cliente", client: "Cliente", implementation: "Implantación" } as const;

// ---------------------------------------------------------------- Periodo

function monthOf(iso: string) { return iso.slice(0, 7); }
function lastClosedMonthEnd(today: string): string {
  const y = Number(today.slice(0, 4)); const m = Number(today.slice(5, 7));
  const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}-${String(lastDayOfMonth(py, pm)).padStart(2, "0")}`;
}

/** Barra de periodo: mes/año, «A fecha de hoy / Mes completo» y último mes cerrado. Formulario GET sin JavaScript. */
export function PeriodBar({ f, nav }: { f: FichaView; nav: Nav }) {
  const q = nav.query;
  const today = todayMadrid();
  const ref = f.context.ref;
  const keep = { ...Object.fromEntries(new URLSearchParams(fichaUrl({ ...nav, query: { ...q, date: today, mode: "CUTOFF" } }, ref).split("?")[1] ?? "")) };
  delete keep.fecha; delete keep.modo;
  const mk = (date: string, mode: "CUTOFF" | "FULL_MONTH") => fichaUrl({ ...nav, query: { ...q, date, mode } }, ref);
  const cutMonth = monthOf(f.cut);
  const isCurrent = cutMonth === monthOf(today);
  const closed = lastClosedMonthEnd(today);
  return (
    <form method="get" action={BASE} className="fc-period" aria-label="Periodo">
      {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label htmlFor="fc-mes" className="fc-sr">Mes y año</label>
      <input id="fc-mes" type="month" name="mes" defaultValue={cutMonth} aria-label="Mes y año" />
      <input type="hidden" name="modo" value={q.mode} />
      <button type="submit" className="fc-btn">Ir</button>
      <span className="fc-seg" role="group" aria-label="Corte del mes">
        {isCurrent ? <a href={mk(today, "CUTOFF")} aria-current={q.mode === "CUTOFF"}>A fecha de hoy</a> : <a href={mk(f.cut, "CUTOFF")} aria-current={q.mode === "CUTOFF"}>A fecha de corte</a>}
        <a href={mk(f.cut, "FULL_MONTH")} aria-current={q.mode === "FULL_MONTH"}>Mes completo</a>
      </span>
      <a className="fc-btn" href={mk(closed, "FULL_MONTH")} title={`Último mes cerrado: ${monthOf(closed)}`}>Último mes cerrado</a>
    </form>
  );
}

// ---------------------------------------------------------------- Selector de objeto

export function ObjectPicker({ f, nav }: { f: FichaView; nav: Nav }) {
  const c = f.context;
  const cur = c.ref;
  const item = (type: "group" | "client" | "implementation", id: string, name: string, cls = "") =>
    type === cur.type && id === cur.id ? <li key={`${type}${id}`}><span className={`fc-cur ${cls}`} aria-current="true">{name}</span></li> : <li key={`${type}${id}`}><Link className={cls} href={fichaUrl(nav, { type, id })}>{name}</Link></li>;
  return (
    <details className="fc-pop-menu">
      <summary className="fc-btn" aria-label="Cambiar el objeto analizado">Objeto: {TYPE_LABEL[cur.type]} ▾</summary>
      <ul className="fc-pop-list">
        {c.group ? <><li className="fc-cap">Grupo Cliente</li>{item("group", c.group.id, c.group.name)}</> : null}
        {cur.type === "group" ? (
          <>
            {c.children.clients.length > 0 ? <li className="fc-cap">Clientes</li> : null}
            {c.children.clients.map((x) => item("client", x.id, x.name, "fc-ind"))}
            {c.children.implementations.length > 0 ? <li className="fc-cap">Implantaciones</li> : null}
            {c.children.implementations.map((x) => item("implementation", x.id, x.name, "fc-ind2"))}
          </>
        ) : (
          <>
            {c.client ? <><li className="fc-cap">Cliente</li>{item("client", c.client.id, c.client.name, "fc-ind")}</> : null}
            {c.children.implementations.length > 0 ? <li className="fc-cap">Implantaciones</li> : null}
            {c.children.implementations.map((x) => item("implementation", x.id, x.name, "fc-ind2"))}
          </>
        )}
      </ul>
    </details>
  );
}

// ---------------------------------------------------------------- Cabecera

export function Head({ f, nav, hasBack }: { f: FichaView; nav: Nav; hasBack: boolean }) {
  const c = f.context;
  const e = f.entity;
  const users = e.periods.cum.users.stock;
  const prov = e.periods.month.provisional;
  const inherit = (own: string, grp: string | undefined) => (own === "SIN_INFORMAR" && grp && grp !== "SIN_INFORMAR" ? { v: grp, fromGroup: true } : { v: own, fromGroup: false });
  const sup = inherit(e.metadata.support, f.groupContext?.metadata.support);
  const srv = inherit(e.metadata.hosting, f.groupContext?.metadata.hosting);
  return (
    <header className="fc-head">
      {hasBack ? <Link className="fc-back" href={backUrl(nav)}>← Comparativa</Link> : <Link className="fc-back" href={BASE}>← Elegir otro objeto</Link>}
      <h1 className="fc-title" title={c.name}>{c.name}</h1>
      <div className="fc-meta">
        <span className="fc-tag">{TYPE_LABEL[c.ref.type]}</span>
        {c.group && c.ref.type !== "group" ? <span>Grupo: <Link href={fichaUrl(nav, { type: "group", id: c.group.id })}>{c.group.name}</Link></span> : null}
        {c.client && c.ref.type === "implementation" ? <span>Cliente: <Link href={fichaUrl(nav, { type: "client", id: c.client.id })}>{c.client.name}</Link></span> : null}
        <span>Soporte: <b>{label(sup.v)}</b>{sup.fromGroup ? <small title="Dato del Grupo: este objeto no tiene el suyo informado"> (Grupo)</small> : null}</span>
        <span>Servidor: <b>{label(srv.v)}</b>{srv.fromGroup ? <small title="Dato del Grupo: este objeto no tiene el suyo informado"> (Grupo)</small> : null}</span>
        <span>Usuarios al corte: <b>{users.value === null ? <Na reason="Usuarios sin informar para el mes del corte." align="left" /> : users.value}</b></span>
        <span>{MONTH_SHORT[Number(f.cut.slice(5, 7)) - 1]} {f.cut.slice(0, 4)} · {f.query.mode === "FULL_MONTH" ? "mes completo" : `corte ${dmy(f.cut)}`}{prov ? <span className="fc-prov" title="Mes en curso: las cifras se prorratean hasta el corte">Provisional</span> : null}</span>
        {!c.isActive ? <span className="fc-tag fc-tag-warn">inactivo</span> : null}
      </div>
      <span className="fc-spacer" />
      <PeriodBar f={f} nav={nav} />
      <ObjectPicker f={f} nav={nav} />
      <details className="fc-pop-menu">
        <summary className="fc-btn">Exportar ▾</summary>
        <ul className="fc-pop-list">
          {([["interanual", "CSV de la comparación interanual"], ["series", "CSV de periodos y series"], ["dedicacion", "CSV de los tres cuadros de dedicación"], ["pap", "CSV de PAP"], ["tickets", "CSV de tickets"]] as const).map(([t, text]) => (
            <li key={t}><a href={`/api/analitica/ficha.csv?${new URLSearchParams({ ambito: c.ref.type, id: c.ref.id, ...(f.query.date !== todayMadrid() ? { fecha: f.query.date } : {}), ...(f.query.mode !== "CUTOFF" ? { modo: f.query.mode } : {}), tabla: t }).toString()}`} download>{text}</a></li>
          ))}
          {c.ref.type !== "implementation" ? <li><Link href={fichaUrl(nav, c.ref, { det: "exportar" })}>Exportar detalle completo…</Link></li> : null}
        </ul>
      </details>
    </header>
  );
}

// ---------------------------------------------------------------- Resumen mes / CUM

function SumRow({ f, nav, e, k, title, titleAttr, ctx, withEco }: { f: FichaView; nav: Nav; e: EntityResult; k: "month" | "cum"; title: string; titleAttr?: string; ctx?: boolean; withEco: boolean }) {
  const p = e.periods[k];
  const prevPerDay = k === "month" ? (e.prevMonthly.at(-1)?.perDay ?? null) : e.periods.prevCum.perDay;
  const calc = fichaUrl(nav, f.context.ref, { det: "ratio", periodo: k, metrica: "perDay", sello: f.economics.reference.dataStamp.stamp });
  const hours = fichaUrl(nav, f.context.ref, { det: "horas", periodo: k, sello: f.economics.reference.dataStamp.stamp });
  const hasEco = withEco;
  return (
    <tr className={ctx ? "fc-ctx" : undefined}>
      <th scope="row" title={titleAttr}>{title}{k === "month" && p.provisional && !ctx ? <span className="fc-prov">Provisional</span> : null}</th>
      <td>{hasEco ? <Amt f={p.perDay} /> : <Na reason={p.perDay.reason} />}</td>
      <td>{hasEco ? <Dev f={p.deviationVsTarget} /> : <Na reason={p.deviationVsTarget.reason} />}</td>
      <td>{hasEco ? <Amt f={prevPerDay} /> : <Na reason={prevPerDay?.reason ?? p.perDay.reason} />}</td>
      <td>{ctx ? num(p.hours.inPerimeter, 2) : <Link href={hours} title="Detalle de las actividades que componen las horas">{num(p.hours.inPerimeter, 2)}</Link>}</td>
      <td>{hasEco ? <Amt f={p.targetHours} /> : <Na reason={p.targetHours.reason} />}</td>
      <td>{hasEco ? <Dev f={p.deviationHours} /> : <Na reason={p.deviationHours.reason} />}</td>
      <td className="fc-last">{hasEco ? <Link href={calc}>Ver cálculo</Link> : null}</td>
    </tr>
  );
}

export function Summary({ f, nav }: { f: FichaView; nav: Nav }) {
  const own = f.context.ref.type === "group";
  const y = f.cut.slice(0, 4);
  const mo = Number(f.cut.slice(5, 7));
  const g = f.groupContext;
  return (
    <table className="fc-sum">
      <caption className="fc-sr">Resumen del mes y del acumulado del año (CUM): rentabilidad, desviación contra objetivo, rentabilidad del mismo periodo del año anterior, horas reales y objetivo, y desviación de horas.</caption>
      <thead>
        <tr>
          <th scope="col">Periodo</th>
          <th scope="col" title="Ingreso imputado / horas dedicadas × jornada">Rentabilidad (€/jornada)</th>
          <th scope="col" title="(objetivo − rentabilidad) / objetivo. Positivo = por debajo del objetivo">Desv. objetivo</th>
          <th scope="col" title="Mismo mes del año anterior (hasta el mismo día) / CUM anterior comparable">Mismo periodo año ant.</th>
          <th scope="col">Horas reales</th>
          <th scope="col">Horas objetivo</th>
          <th scope="col" title="(horas reales − horas objetivo) / horas objetivo">Desv. horas</th>
          <th scope="col"><span className="fc-sr">Cálculo</span></th>
        </tr>
      </thead>
      <tbody>
        <SumRow f={f} nav={nav} e={f.entity} k="month" title={`Mes · ${MONTH_SHORT[mo - 1]} ${y}`} withEco={own} />
        <SumRow f={f} nav={nav} e={f.entity} k="cum" title={`CUM · ene–${MONTH_SHORT[mo - 1]} ${y}`} withEco={own} />
        {!own && g ? (
          <>
            <SumRow f={f} nav={nav} e={g} k="month" title="Grupo · mes (contexto)" titleAttr={g.name} ctx withEco />
            <SumRow f={f} nav={nav} e={g} k="cum" title="Grupo · CUM (contexto)" titleAttr={g.name} ctx withEco />
          </>
        ) : null}
      </tbody>
    </table>
  );
}
