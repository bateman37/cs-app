import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { listMatrices, listMatrixYears } from "@/server/usuarios";
import { listUsersBaseConflicts } from "@/server/usuarios-base";
import { currentYear, editability } from "@/domain/usuarios";
import { first, type SearchParams } from "@/lib/format";
import { Pager } from "@/components/list";
import { BASE, Legend, SCOPE_LABEL, SLUG_SCOPE, SCOPE_SLUG, fichaHref } from "./_lib";
import { UsuariosEditor } from "./editor";
import "../clientes/editor.css";

export const metadata: Metadata = { title: "Usuarios contratados" };
export const dynamic = "force-dynamic";

/** Matriz de usuarios contratados EDITABLE (HOTFIX-04 §6): la propia tabla es el editor; la ficha de cada fila es solo historial y gestión excepcional. */
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
  const result = await listMatrices(user.id, { year, scopeType, q: params.q, status: params.status as "active" | "inactive" | "all", page: params.page });
  const years = [...new Set([...(await listMatrixYears(user.id)), cy - 1, cy])].sort((a, b) => a - b);
  const ed = editability(year);
  const conflicts = await listUsersBaseConflicts(user.id);
  const isAdmin = user.role === "ADMIN";
  return (
    <>
      <h1>Usuarios contratados</h1>
      <p className="muted">
        Usuarios que <strong>pagan</strong> cada mes (contratados). No son usuarios activos de la aplicación, cuentas de acceso ni personas del maestro Personal. Grupo Cliente, Cliente e implantación tienen cada uno su propia
        matriz: no se suman ni se copian entre ámbitos. Se editan el año en curso ({cy}) y el anterior ({cy - 1}); los demás años se consultan.
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
        <>
          <form className="toolbar" action={BASE} method="get">
            <div className="field"><label htmlFor="anio">Año</label><input id="anio" name="anio" type="number" min={2000} max={2100} defaultValue={year} /></div>
            <div className="field"><label htmlFor="ambito">Ámbito</label><select id="ambito" name="ambito" defaultValue={params.ambito}>{(Object.keys(SCOPE_LABEL) as (keyof typeof SCOPE_LABEL)[]).map((t) => <option key={t} value={SCOPE_SLUG[t]}>{SCOPE_LABEL[t]}</option>)}</select></div>
            <button className="btn btn-primary" type="submit">Filtrar</button>
            <Link className="btn btn-secondary" href={BASE}>Limpiar</Link>
          </form>
          <div className="empty"><p>{params.q || params.status !== "active" ? "Ningún elemento coincide con los filtros." : `Todavía no hay ${SCOPE_LABEL[scopeType].toLowerCase()}s en los maestros.`}</p></div>
        </>
      ) : (
        <UsuariosEditor
          rows={result.rows.map((r) => ({ id: r.id, name: r.name, context: r.context, isActive: r.isActive, version: r.version, values: r.values, kinds: r.kinds, locked: r.locked, sources: r.sources }))}
          year={year}
          scopeType={scopeType}
          scopeLabel={SCOPE_LABEL[scopeType]}
          scopeSlug={SCOPE_SLUG[scopeType]}
          editable={isAdmin && ed.editable}
          reason={ed.editable ? (year === cy ? "año en curso, editable" : "año anterior, editable") : ed.reason}
          filters={{ anio: year, ambito: params.ambito, q: params.q, status: params.status }}
          years={years}
          scopeOptions={(Object.keys(SCOPE_LABEL) as (keyof typeof SCOPE_LABEL)[]).map((t) => ({ value: SCOPE_SLUG[t], label: SCOPE_LABEL[t] }))}
          history={Object.fromEntries(result.rows.map((r) => [r.id, fichaHref(scopeType, r.id, year)]))}
          legend={<Legend />}
        >
          <Pager base={BASE} params={params} page={result.page} pageCount={result.pageCount} total={result.total} />
          {!isAdmin ? null : <p className="muted">Edite los meses directamente en la tabla. La ficha de cada fila (nombre) queda como historial y gestión excepcional.</p>}
        </UsuariosEditor>
      )}
    </>
  );
}
