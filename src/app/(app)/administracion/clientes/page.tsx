import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { first, qs, type SearchParams } from "@/lib/format";
import { ESTADO_LABEL, ESTADO_VALUES, parseEstado } from "@/domain/estado";
import { loadMasterTable, type MasterRow } from "@/server/master-table";
import { type LINK_STATE_LABEL } from "@/domain/master-links";
import { formatDecimalEs } from "@/lib/money";
import { SUPPORT_LABEL } from "@/domain/precarga-maestros";
import { ToggleActive } from "./toggle-active";
import { NuevoGrupoInline, StateCell } from "./tabla-celdas";
import "./tabla.css";

export const metadata: Metadata = { title: "Clientes" };
export const dynamic = "force-dynamic";
const BASE = "/administracion/clientes";

const list = (xs: string[], fmt: (x: string) => string = (x) => x) => (xs.length === 0 ? <span className="mt-none">—</span> : <ul className="mt-list">{xs.map((x) => <li key={x} title={x}>{fmt(x)}</li>)}</ul>);

export default async function ClientesTablaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const q = first(sp.q).slice(0, 100);
  const estado = parseEstado(first(sp.estado));
  const onlyPending = first(sp.pendientes) === "1";
  const isAdmin = user.role === "ADMIN";
  const t = await loadMasterTable(user.id, { q, estado, onlyPending });
  const keep = { q: q || undefined, estado: estado === "activos" ? undefined : estado, pendientes: onlyPending ? "1" : undefined };
  const detail = (r: MasterRow) => (r.kind === "group" ? `${BASE}/grupos/${r.id}` : `${BASE}/clientes/${r.id}`);
  return (
    <div className="mt-page">
      <header className="mt-head">
        <h1>Clientes y Grupos</h1>
        <p className="muted">Una fila por Grupo BC y por cada Cliente (organización Zendesk) que contiene. Los enlaces con Wrike, Zendesk y PAP se completan desde la propia fila; al guardar, lo ya cargado se atribuye solo.</p>
      </header>
      <div className="mt-tools">
      <form className="mt-filters" method="get" action={BASE}>
        <label className="field"><span>Buscar</span><input name="q" defaultValue={q} placeholder="Grupo, Cliente, ID Zendesk, Wrike o PAP" maxLength={100} /></label>
        <span className="chips-group" role="group" aria-label="Estado comercial">
          <span className="chips-title">Estado</span>
          {ESTADO_VALUES.map((v) => <Link key={v} className={estado === v ? "chip chip-on" : "chip"} aria-pressed={estado === v} href={`${BASE}${qs({ ...keep, estado: v === "activos" ? undefined : v })}`} prefetch={false}>{ESTADO_LABEL[v]}</Link>)}
        </span>
        <label className="mt-check"><input type="checkbox" name="pendientes" value="1" defaultChecked={onlyPending} /> Solo con enlaces pendientes</label>
        {estado !== "activos" ? <input type="hidden" name="estado" value={estado} /> : null}
        <button className="btn btn-secondary" type="submit">Filtrar</button>
      </form>
      {isAdmin ? <NuevoGrupoInline /> : null}
      </div>
      <p className="mt-sum" role="status">
        {t.totals.groups} {t.totals.groups === 1 ? "Grupo" : "Grupos"} · {t.totals.clients} {t.totals.clients === 1 ? "Cliente" : "Clientes"} · <strong>{t.totals.pendingRows}</strong> con enlaces pendientes · {t.totals.conflicts} con conflicto
        {t.unattributed.financeRows > 0 || Number(t.unattributed.hoursWithoutGroup) > 0 ? (
          <> · Sin atribuir a ningún Grupo: {t.unattributed.financeRows > 0 ? <strong>{t.unattributed.financeRows} filas financieras</strong> : "0 filas financieras"} · <strong>{formatDecimalEs(t.unattributed.hoursWithoutGroup, 2)} h</strong> (completar el enlace las atribuye automáticamente)</>
        ) : null}
      </p>
      {t.rows.length === 0 ? (
        <div className="empty"><p>{q || onlyPending || estado !== "activos" ? "Ninguna fila coincide con los filtros." : "Todavía no hay Grupos. Use «Nuevo grupo» o importe la tabla de Clientes en Cargas."}</p></div>
      ) : (
        <div className="mt-scroll" tabIndex={0} role="region" aria-label="Tabla de Clientes y Grupos, desplazable">
          <table className="mt-table">
            <caption className="visually-hidden">Grupos BC y sus Clientes con el estado de cada enlace</caption>
            <thead>
              <tr>
                <th scope="col" className="mt-sticky">Grupo BC / Cliente</th>
                <th scope="col">Wrike</th><th scope="col">ID organización Zendesk</th><th scope="col">Nombre Zendesk</th><th scope="col">Soporte</th><th scope="col">Servidor</th><th scope="col">PAP</th><th scope="col">Tipo</th><th scope="col">Activo</th><th scope="col">Enlaces</th>
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r) => {
                const g = r.kind === "group";
                return (
                  <tr key={`${r.kind}-${r.id}`} className={`${g ? "mt-group" : "mt-client"}${r.effectiveActive ? "" : " mt-off"}`}>
                    <th scope="row" className="mt-sticky">
                      <Link href={detail(r)} title={g ? "Abrir la ficha del Grupo (alias múltiples, vigencias)" : "Abrir la ficha del Cliente (alias múltiples, vigencias, implantaciones)"}>{r.name}</Link>
                      <small className="mt-kind">{g ? (r.clients === 0 ? "Grupo sin Clientes" : `Grupo · ${r.clients} ${r.clients === 1 ? "Cliente" : "Clientes"}`) : "Cliente"}</small>
                      {g && isAdmin ? <Link className="mt-add" href={`${BASE}/clientes/nuevo?groupId=${r.id}`}>+ Cliente</Link> : null}
                    </th>
                    <td><StateCell state={r.state.WRIKE} entity={r.kind} id={r.id} system="WRIKE" canEdit={isAdmin && !r.inherited.WRIKE}>{list(r.wrike)}{r.inherited.WRIKE ? <small className="mt-inh">del Grupo</small> : null}</StateCell></td>
                    <td className="mt-num">{g && r.clients > 0 ? <span className="mt-none">en sus Clientes</span> : <StateCell state={r.state.ZENDESK} entity={r.kind} id={r.id} system="ZENDESK" canEdit={isAdmin}>{list(r.zendeskIds)}</StateCell>}</td>
                    <td>{list(r.zendeskNames)}</td>
                    <td>{g && r.clients > 0 ? <span className="mt-none">en sus Clientes</span> : <StateCell state={r.state.SUPPORT} entity={r.kind} id={r.id} system="SUPPORT" canEdit={isAdmin}>{list(r.support, (x) => SUPPORT_LABEL[x] ?? x)}</StateCell>}</td>
                    <td>{g && r.clients > 0 ? <span className="mt-none">en sus Clientes</span> : <StateCell state={r.state.HOSTING} entity={r.kind} id={r.id} system="HOSTING" canEdit={isAdmin}>{list(r.hosting)}</StateCell>}</td>
                    <td><StateCell state={r.state.PAP} entity={r.kind} id={r.id} system="PAP" canEdit={isAdmin && !r.inherited.PAP}>{list(r.pap)}{r.inherited.PAP ? <small className="mt-inh">del Grupo</small> : null}</StateCell></td>
                    <td>{list(r.complexity, (x) => x.charAt(0) + x.slice(1).toLowerCase())}</td>
                    <td>
                      <span className={r.isActive ? "badge badge-ok" : "badge badge-off"}>{r.isActive ? "Activo" : "Inactivo"}</span>
                      {r.isActive && !r.effectiveActive ? <small className="mt-inh" title="El Grupo o sus Clientes están inactivos">efectivo: inactivo</small> : null}
                      {isAdmin ? <ToggleActive entity={g ? "group" : "client"} id={r.id} version={r.version} active={r.isActive} /> : null}
                    </td>
                    <td className="mt-links">
                      {r.pending === 0 ? <span className="mt-chip mt-ok"><span aria-hidden="true">✓ </span>Completo</span> : <Link className="mt-chip mt-miss" href={detail(r)} title={`Abrir ${g ? "el Grupo" : "el Cliente"} para completar el enlace pendiente`}><span aria-hidden="true">○ </span>{r.pending} {r.pending === 1 ? "pendiente" : "pendientes"}</Link>}
                      {(Object.entries(r.state) as [keyof typeof r.state, keyof typeof LINK_STATE_LABEL][]).some(([, v]) => v === "CONFLICT") ? <span className="mt-chip mt-conf" title="Una equivalencia está asignada a más de un Grupo o un dato tiene valores distintos: abra la ficha y resuélvalo">⚠ conflicto</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">Alias múltiples, vigencias e implantaciones se editan en la ficha de cada fila. «No aplica» es una decisión explícita; un vacío nunca se rellena solo. <Link href="/administracion/cargas">Importar la tabla de Clientes</Link> · <Link href="/administracion/configuracion?seccion=herramientas">Herramientas técnicas</Link></p>
    </div>
  );
}
