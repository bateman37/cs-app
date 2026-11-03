import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { listMatrices, listMatrixYears } from "@/server/usuarios";
import { listUsersBaseConflicts } from "@/server/usuarios-base";
import { currentYear, editability } from "@/domain/usuarios";
import { first, type SearchParams } from "@/lib/format";
import { Pager } from "@/components/list";
import { BASE, Cell, Legend, SCOPE_LABEL, SLUG_SCOPE, SCOPE_SLUG, fichaHref, monthShort } from "./_lib";
import { MONTHS } from "@/domain/usuarios";

export const metadata: Metadata = { title: "Usuarios contratados" };

export default async function UsuariosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const cy = currentYear();
  const yearParam = Number(first(sp.anio));
  const year = Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 2100 ? yearParam : cy;
  const scopeType = SLUG_SCOPE[first(sp.ambito)] ?? "group";
  const params = {
    anio: year,
    ambito: SCOPE_SLUG[scopeType],
    q: first(sp.q),
    status: first(sp.status) || "active",
    page: Number(first(sp.page)) || 1,
  };
  const result = await listMatrices(user.id, {
    year,
    scopeType,
    q: params.q,
    status: params.status as "active" | "inactive" | "all",
    page: params.page,
  });
  const years = [...new Set([...(await listMatrixYears(user.id)), cy - 1, cy])].sort((a, b) => a - b);
  const ed = editability(year);
  const conflicts = await listUsersBaseConflicts(user.id);
  return (
    <>
      <h1>Usuarios contratados</h1>
      <p className="muted">
        Usuarios que <strong>pagan</strong> cada mes (contratados). No son usuarios activos de la aplicación, cuentas de acceso ni personas del maestro
        Personal. Grupo Cliente, Cliente e implantación tienen cada uno su propia matriz: no se suman ni se copian entre ámbitos. Se editan el año en curso ({cy}) y el anterior ({cy - 1}); los demás años se consultan.
      </p>
      <form className="toolbar" action={BASE} method="get">
        <div className="field">
          <label htmlFor="anio">Año</label>
          <input id="anio" name="anio" type="number" min={2000} max={2100} step={1} defaultValue={year} list="anios-con-datos" inputMode="numeric" />
          <datalist id="anios-con-datos">{years.map((y) => <option key={y} value={y} />)}</datalist>
        </div>
        <div className="field">
          <label htmlFor="ambito">Ámbito</label>
          <select id="ambito" name="ambito" defaultValue={params.ambito}>
            {(Object.keys(SCOPE_LABEL) as (keyof typeof SCOPE_LABEL)[]).map((t) => (
              <option key={t} value={SCOPE_SLUG[t]}>
                {SCOPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="q">Buscar</label>
          <input id="q" name="q" defaultValue={params.q} placeholder="Nombre" />
        </div>
        <div className="field">
          <label htmlFor="status">Estado</label>
          <select id="status" name="status" defaultValue={params.status}>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
            <option value="all">Todos</option>
          </select>
        </div>
        <button className="btn btn-primary" type="submit">Filtrar</button>
        <Link className="btn btn-secondary" href={BASE}>Limpiar</Link>
      </form>
      <p className="muted">
        {year}: {ed.editable ? (year === cy ? "año en curso, editable" : "año anterior, editable") : ed.reason}
      </p>
      {conflicts.length > 0 ? (
        <p className="notice notice-info" role="note">
          {conflicts.length} Grupo(s) con la base de usuarios 2025 en discrepancia entre categorías (sin resolver, denominador pendiente):{" "}
          {conflicts.slice(0, 8).map((c, i) => (
            <span key={c.groupId}>{i ? ", " : ""}<Link href={fichaHref("group", c.groupId, 2025)}>{c.name}</Link></span>
          ))}
          {conflicts.length > 8 ? "…" : ""}
        </p>
      ) : null}
      {result.rows.length === 0 ? (
        <div className="empty">
          <p>{params.q || params.status !== "active" ? "Ningún elemento coincide con los filtros." : `Todavía no hay ${SCOPE_LABEL[scopeType].toLowerCase()}s en los maestros.`}</p>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <caption className="skip">Usuarios contratados {year} por mes, {SCOPE_LABEL[scopeType]}</caption>
              <thead>
                <tr>
                  <th>{SCOPE_LABEL[scopeType]}</th>
                  {MONTHS.map((m) => (
                    <th key={m} style={{ textAlign: "right" }} title={`Mes ${m}`}>{monthShort(m)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.id} className={r.isActive ? undefined : "inactive-row"}>
                    <td>
                      <Link href={fichaHref(scopeType, r.id, year)}>{r.name}</Link>
                      {r.context ? <div className="muted" style={{ fontSize: "0.8rem" }}>{r.context}</div> : null}
                      {!r.isActive ? <span className="badge badge-off" style={{ marginLeft: 6 }}>Inactivo</span> : null}
                    </td>
                    {MONTHS.map((m) => (
                      <Cell key={m} value={r.values[m - 1]} kind={r.kinds[m - 1]} locked={r.locked[m - 1]} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Legend />
          <Pager base={BASE} params={params} page={result.page} pageCount={result.pageCount} total={result.total} />
        </>
      )}
      {user.role !== "ADMIN" ? null : (
        <p className="muted">Abra una fila para editar un mes, aplicar un valor desde un mes, copiar la base anterior o dar un valor inicial.</p>
      )}
    </>
  );
}
