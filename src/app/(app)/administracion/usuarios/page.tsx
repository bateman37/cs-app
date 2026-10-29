import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { listMatrices } from "@/server/usuarios";
import { HISTORIC_YEAR, currentYear } from "@/domain/usuarios";
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
  const year = Number.isInteger(yearParam) && yearParam >= HISTORIC_YEAR && yearParam <= cy + 1 ? yearParam : cy;
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
  const years: number[] = [];
  for (let y = HISTORIC_YEAR; y <= cy + 1; y++) years.push(y);
  return (
    <>
      <h1>Usuarios contratados</h1>
      <p className="muted">
        Usuarios que <strong>pagan</strong> cada mes (contratados). No son usuarios activos de la aplicación, cuentas de acceso ni personas del maestro
        Personal. Grupo Cliente, Cliente e implantación tienen cada uno su propia matriz: no se suman ni se copian entre ámbitos. Solo se edita el año en curso ({cy}).
      </p>
      <form className="toolbar" action={BASE} method="get">
        <div className="field">
          <label htmlFor="anio">Año</label>
          <select id="anio" name="anio" defaultValue={String(year)}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
                {y === cy ? " (en curso)" : y === HISTORIC_YEAR ? " (histórico)" : y > cy ? " (futuro)" : ""}
              </option>
            ))}
          </select>
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
        <p className="muted">Abra una fila para editar un mes, aplicar un valor desde un mes o inicializar el histórico.</p>
      )}
    </>
  );
}
