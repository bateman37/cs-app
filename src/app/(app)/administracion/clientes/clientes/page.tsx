import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { listClients } from "@/server/clients";
import { listAssignableGroups } from "@/server/groups";
import { first, qs, type SearchParams } from "@/lib/format";
import { Pager, SortHeader, StatusBadge } from "@/components/list";

export const metadata: Metadata = { title: "Clientes" };
const BASE = "/administracion/clientes/clientes";

export default async function ClientesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const params = {
    q: first(sp.q),
    status: first(sp.status) || "active",
    groupId: first(sp.groupId),
    internal: first(sp.internal),
    pending: first(sp.pending),
    sort: first(sp.sort) || "name",
    dir: first(sp.dir) || "asc",
    page: Number(first(sp.page)) || 1,
  };
  const [result, groups] = await Promise.all([
    listClients(user.id, {
      q: params.q,
      status: params.status as "active" | "inactive" | "all",
      groupId: params.groupId,
      internal: params.internal as "yes" | "no" | "",
      pendingZendesk: params.pending === "1",
      sort: params.sort,
      dir: params.dir as "asc" | "desc",
      page: params.page,
    }),
    listAssignableGroups(user.id),
  ]);
  const keep = { ...params };
  const back = qs(keep).slice(1);
  const filtered = params.q || params.groupId || params.internal || params.pending || params.status !== "active";
  return (
    <>
      <h1>Clientes</h1>
      <p className="muted">Identidad operativa de cada organización (organización Zendesk). Puede tener implantaciones identificadas, equivalencias de origen, servicio e hitos.</p>
      <form className="toolbar" action={BASE} method="get">
        <div className="field">
          <label htmlFor="q">Buscar</label>
          <input id="q" name="q" defaultValue={params.q} placeholder="Nombre, grupo, equivalencia o implantación" />
        </div>
        <div className="field">
          <label htmlFor="groupId">Grupo</label>
          <select id="groupId" name="groupId" defaultValue={params.groupId}>
            <option value="">Todos</option>
            <option value="none">Sin grupo asignado</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}{g.isActive ? "" : " (inactivo)"}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="status">Estado</label>
          <select id="status" name="status" defaultValue={params.status}>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
            <option value="all">Todos</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="internal">Organización</label>
          <select id="internal" name="internal" defaultValue={params.internal}>
            <option value="">Todas</option>
            <option value="no">No internas</option>
            <option value="yes">Internas</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="pending">Equivalencia Zendesk</label>
          <select id="pending" name="pending" defaultValue={params.pending}>
            <option value="">Todas</option>
            <option value="1">Pendiente de ID</option>
          </select>
        </div>
        <input type="hidden" name="sort" value={params.sort} />
        <input type="hidden" name="dir" value={params.dir} />
        <button className="btn btn-primary" type="submit">Filtrar</button>
        <Link className="btn btn-secondary" href={BASE}>Limpiar</Link>
        {user.role === "ADMIN" ? <Link className="btn btn-primary" href={`${BASE}/nuevo`} style={{ marginLeft: "auto" }}>Nuevo cliente</Link> : null}
      </form>
      {result.rows.length === 0 ? (
        <div className="empty">
          <p>{filtered ? "Ningún cliente coincide con los filtros." : "Todavía no hay clientes registrados."}</p>
          {user.role === "ADMIN" && !filtered ? <Link className="btn btn-primary" href={`${BASE}/nuevo`}>Crear el primer cliente</Link> : null}
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <caption className="skip">Clientes</caption>
              <thead>
                <tr>
                  <SortHeader base={BASE} params={keep} col="name" label="Nombre" />
                  <SortHeader base={BASE} params={keep} col="group" label="Grupo" />
                  <th>Implantaciones</th>
                  <th>ID Zendesk</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                  <SortHeader base={BASE} params={keep} col="updated" label="Última modificación" />
                </tr>
              </thead>
              <tbody>
                {result.rows.map((c) => (
                  <tr key={c.id} className={c.isActive ? undefined : "inactive-row"}>
                    <td><Link href={`${BASE}/${c.id}?volver=${encodeURIComponent(back)}`}>{c.name}</Link></td>
                    <td>{c.group ? <Link href={`/administracion/clientes/grupos/${c.group.id}`}>{c.group.name}</Link> : <span className="badge badge-warn">No asignado</span>}</td>
                    <td>{c._count.implementations}</td>
                    <td>{c.identities.length ? c.identities.map((i) => i.rawValue).join(", ") : <span className="badge badge-warn">Pendiente</span>}</td>
                    <td>{c.isInternal ? <span className="badge badge-int">Interna</span> : "Cliente"}</td>
                    <td><StatusBadge active={c.isActive} /></td>
                    <td>{c.updatedAt.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager base={BASE} params={keep} page={result.page} pageCount={result.pageCount} total={result.total} />
        </>
      )}
    </>
  );
}
