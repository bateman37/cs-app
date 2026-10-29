import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { listGroups } from "@/server/groups";
import { first, qs, type SearchParams } from "@/lib/format";
import { Pager, SortHeader, StatusBadge } from "@/components/list";

export const metadata: Metadata = { title: "Grupos Cliente" };
const BASE = "/administracion/clientes/grupos";

export default async function GruposPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const params = {
    q: first(sp.q),
    status: first(sp.status) || "active",
    sort: first(sp.sort) || "name",
    dir: first(sp.dir) || "asc",
    page: Number(first(sp.page)) || 1,
  };
  const result = await listGroups(user.id, {
    q: params.q,
    status: params.status as "active" | "inactive" | "all",
    sort: params.sort,
    dir: params.dir as "asc" | "desc",
    page: params.page,
  });
  const keep = { q: params.q, status: params.status, sort: params.sort, dir: params.dir, page: params.page };
  const back = qs(keep).slice(1);
  return (
    <>
      <h1>Grupos Cliente</h1>
      <p className="muted">Agrupación económica BC. Cada grupo reúne uno o varios Clientes; un grupo no fusiona organizaciones distintas.</p>
      <form className="toolbar" action={BASE} method="get">
        <div className="field">
          <label htmlFor="q">Buscar</label>
          <input id="q" name="q" defaultValue={params.q} placeholder="Nombre, denominación o equivalencia BC" />
        </div>
        <div className="field">
          <label htmlFor="status">Estado</label>
          <select id="status" name="status" defaultValue={params.status}>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
            <option value="all">Todos</option>
          </select>
        </div>
        <input type="hidden" name="sort" value={params.sort} />
        <input type="hidden" name="dir" value={params.dir} />
        <button className="btn btn-primary" type="submit">Filtrar</button>
        <Link className="btn btn-secondary" href={BASE}>Limpiar</Link>
        {user.role === "ADMIN" ? <Link className="btn btn-primary" href={`${BASE}/nuevo`} style={{ marginLeft: "auto" }}>Nuevo grupo</Link> : null}
      </form>
      {result.rows.length === 0 ? (
        <div className="empty">
          <p>{params.q || params.status !== "active" ? "Ningún grupo coincide con los filtros." : "Todavía no hay grupos registrados."}</p>
          {user.role === "ADMIN" && !params.q ? <Link className="btn btn-primary" href={`${BASE}/nuevo`}>Crear el primer grupo</Link> : null}
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <caption className="skip">Grupos Cliente</caption>
              <thead>
                <tr>
                  <SortHeader base={BASE} params={keep} col="name" label="Nombre" />
                  <th>Denominación BC</th>
                  <SortHeader base={BASE} params={keep} col="clients" label="Clientes" />
                  <th>Estado</th>
                  <SortHeader base={BASE} params={keep} col="updated" label="Última modificación" />
                </tr>
              </thead>
              <tbody>
                {result.rows.map((g) => (
                  <tr key={g.id} className={g.isActive ? undefined : "inactive-row"}>
                    <td><Link href={`${BASE}/${g.id}?volver=${encodeURIComponent(back)}`}>{g.name}</Link></td>
                    <td>{g.bcDenomination ?? <span className="muted">—</span>}</td>
                    <td>{g._count.clients}</td>
                    <td><StatusBadge active={g.isActive} /></td>
                    <td>{g.updatedAt.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" })}</td>
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
