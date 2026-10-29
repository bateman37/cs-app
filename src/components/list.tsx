import Link from "next/link";
import { qs } from "@/lib/format";

type Params = Record<string, string | number | undefined | null>;

export function SortHeader({ base, params, col, label }: { base: string; params: Params; col: string; label: string }) {
  const active = params.sort === col;
  const dir = active && params.dir !== "desc" ? "desc" : "asc";
  const sym = active ? (params.dir === "desc" ? " ▼" : " ▲") : "";
  const sortLabel = active ? (params.dir === "desc" ? "descendente" : "ascendente") : "sin ordenar";
  return (
    <th aria-sort={active ? (params.dir === "desc" ? "descending" : "ascending") : "none"}>
      <Link href={`${base}${qs({ ...params, sort: col, dir, page: 1 })}`} title={`Ordenar por ${label} (${sortLabel})`}>
        {label}
        {sym}
      </Link>
    </th>
  );
}

export function Pager({ base, params, page, pageCount, total }: { base: string; params: Params; page: number; pageCount: number; total: number }) {
  return (
    <nav className="pager" aria-label="Paginación">
      <span>{total} {total === 1 ? "resultado" : "resultados"}</span>
      {page > 1 ? <Link className="btn btn-secondary btn-sm" href={`${base}${qs({ ...params, page: page - 1 })}`}>← Anterior</Link> : null}
      <span>Página {page} de {pageCount}</span>
      {page < pageCount ? <Link className="btn btn-secondary btn-sm" href={`${base}${qs({ ...params, page: page + 1 })}`}>Siguiente →</Link> : null}
    </nav>
  );
}

export function StatusBadge({ active }: { active: boolean }) {
  return <span className={active ? "badge badge-ok" : "badge badge-off"}>{active ? "Activo" : "Inactivo"}</span>;
}
