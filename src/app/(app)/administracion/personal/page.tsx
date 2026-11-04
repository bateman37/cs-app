import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { listCatalog, listPeople } from "@/server/personal";
import { first, qs, type SearchParams } from "@/lib/format";
import { isIsoDate, todayMadrid } from "@/domain/vigencia";
import { Pager, StatusBadge } from "@/components/list";
import "../clientes/tabla.css";

export const metadata: Metadata = { title: "Personal" };
const BASE = "/administracion/personal";

export default async function PersonalPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const date = isIsoDate(first(sp.fecha)) ? first(sp.fecha) : todayMadrid();
  const params = {
    q: first(sp.q),
    status: first(sp.status) || "active",
    equipo: first(sp.equipo),
    pmo: first(sp.pmo) || "all",
    fecha: first(sp.fecha) ? date : "",
    sort: first(sp.sort) || "name",
    dir: first(sp.dir) || "asc",
    page: Number(first(sp.page)) || 1,
  };
  const [result, teams] = await Promise.all([
    listPeople(user.id, {
      q: params.q,
      status: params.status as "active" | "inactive" | "all",
      teamId: params.equipo || undefined,
      pmo: params.pmo as "yes" | "no" | "unknown" | "all",
      date,
      sort: params.sort,
      dir: params.dir as "asc" | "desc",
      page: params.page,
    }),
    listCatalog(user.id, "TEAM"),
  ]);
  const keep = { q: params.q, status: params.status, equipo: params.equipo, pmo: params.pmo, fecha: params.fecha, sort: params.sort, dir: params.dir, page: params.page };
  const back = qs(keep).slice(1);
  const isAdmin = user.role === "ADMIN";
  return (
    <>
      <h1>Personal</h1>
      <p className="muted">
        Maestro único de personas (PERSONAL y PERSONAL PMO). No son cuentas de acceso: sus alias no conceden permisos. Equipo y PMO se
        muestran a la fecha indicada ({date.split("-").reverse().join("/")}).
      </p>
      <form className="toolbar" action={BASE} method="get">
        <div className="field">
          <label htmlFor="q">Buscar</label>
          <input id="q" name="q" defaultValue={params.q} placeholder="Nombre, alias, ID o correo" />
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
          <label htmlFor="equipo">Equipo</label>
          <select id="equipo" name="equipo" defaultValue={params.equipo}>
            <option value="">Todos</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pmo">Pertenece a PMO</label>
          <select id="pmo" name="pmo" defaultValue={params.pmo}>
            <option value="all">Todos</option>
            <option value="yes">Sí</option>
            <option value="no">No</option>
            <option value="unknown">Sin informar</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="fecha">A la fecha</label>
          <input id="fecha" type="date" name="fecha" defaultValue={params.fecha} />
        </div>
        <input type="hidden" name="sort" value={params.sort} />
        <input type="hidden" name="dir" value={params.dir} />
        <button className="btn btn-primary" type="submit">Filtrar</button>
        <Link className="btn btn-secondary" href={BASE}>Limpiar</Link>
        <span style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
          <Link className="btn btn-secondary" href={`${BASE}/catalogo`}>Catálogo de nivel, equipo y rol</Link>
          {isAdmin ? <Link className="btn btn-primary" href={`${BASE}/nuevo`}>Nueva persona</Link> : null}
        </span>
      </form>
      {result.rows.length === 0 ? (
        <div className="empty">
          <p>{params.q || params.status !== "active" || params.equipo || params.pmo !== "all" ? "Ninguna persona coincide con los filtros." : "Todavía no hay personas registradas."}</p>
          {isAdmin && !params.q ? <Link className="btn btn-primary" href={`${BASE}/nuevo`}>Crear la primera persona</Link> : null}
        </div>
      ) : (
        <>
          <div className="mt-scroll" tabIndex={0} role="region" aria-label="Tabla de Personal, desplazable">
            <table className="mt-table" style={{ minWidth: 1100 }}>
              <caption className="visually-hidden">Personal: una persona canónica por fila</caption>
              <thead>
                <tr>
                  <th scope="col" className="mt-sticky">Nombre</th>
                  <th scope="col">Alias PAP</th><th scope="col">Alias Zendesk</th><th scope="col">Alias Wrike</th>
                  <th scope="col">Equipo</th><th scope="col">Nivel</th><th scope="col">PMO</th><th scope="col">Rol PMO</th><th scope="col">Activo</th><th scope="col">Enlaces</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((p) => {
                  const team = p.terms.find((t) => t.attribute === "TEAM")?.catalogItem?.name;
                  const level = p.terms.find((t) => t.attribute === "LEVEL")?.catalogItem?.name;
                  const pmo = p.terms.find((t) => t.attribute === "PMO_MEMBER");
                  const role = p.terms.find((t) => t.attribute === "PMO_ROLE")?.catalogItem?.name;
                  const al = (sys: "PAP" | "ZENDESK" | "WRIKE") => [...new Set(p.aliases.filter((a) => a.system === sys).map((a) => a.rawValue))];
                  const lists = (sys: "PAP" | "ZENDESK" | "WRIKE") => { const v = al(sys); return v.length === 0 ? <span className="mt-none">—</span> : <ul className="mt-list">{v.map((x) => <li key={x} title={x}>{x}</li>)}</ul>; };
                  // Una cuenta ausente en un sistema NO es un fallo (no se exige Wrike a toda la plantilla): solo se señalan equipo, nivel y pertenencia PMO sin informar.
                  const missing = [!team ? "equipo" : null, !level ? "nivel" : null, !pmo ? "PMO" : null, pmo?.flag && !role ? "rol PMO" : null, p.aliases.length === 0 ? "alias" : null].filter(Boolean) as string[];
                  return (
                    <tr key={p.id} className={`mt-client${p.isActive ? "" : " mt-off"}`}>
                      <th scope="row" className="mt-sticky" style={{ paddingLeft: "0.5rem" }}><Link href={`${BASE}/${p.id}?volver=${encodeURIComponent(back)}`} title="Abrir la ficha: alias múltiples, vigencias de equipo, nivel, PMO y rol">{p.name}</Link></th>
                      <td>{lists("PAP")}</td><td>{lists("ZENDESK")}</td><td>{lists("WRIKE")}</td>
                      <td>{team ?? <span className="mt-none">Sin informar</span>}</td>
                      <td>{level ?? <span className="mt-none">Sin informar</span>}</td>
                      <td>{pmo ? (pmo.flag ? "Sí" : "No") : <span className="mt-none">Sin informar</span>}</td>
                      <td>{pmo?.flag ? (role ?? <span className="mt-none">Sin informar</span>) : <span className="mt-none">—</span>}</td>
                      <td><StatusBadge active={p.isActive} /></td>
                      <td className="mt-links">{missing.length === 0 ? <span className="mt-chip mt-ok"><span aria-hidden="true">✓ </span>Completo</span> : <Link className="mt-chip mt-miss" href={`${BASE}/${p.id}?volver=${encodeURIComponent(back)}`} title={`Pendiente: ${missing.join(", ")}`}><span aria-hidden="true">○ </span>Falta: {missing.join(", ")}</Link>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager base={BASE} params={keep} page={result.page} pageCount={result.pageCount} total={result.total} />
        </>
      )}
    </>
  );
}
