import Link from "next/link";
import { FAMILY_LABEL, type Family, type PulseMetric } from "@/domain/pulse-catalog";
import { pulseToParams, type PulseQuery } from "@/domain/pulse-query";
import { qs } from "@/lib/format";
import { BandBadge, StateBadge, fmt } from "@/components/pulse/ui";
import type { PulseView } from "@/server/pulse/service";

const BASE = "/pulse-rent";

export function PulseTable({ view }: { view: PulseView }) {
  const q = view.query;
  const href = (over: Partial<PulseQuery>, baseOver?: Partial<PulseQuery["base"]>) => `${BASE}${qs(pulseToParams({ ...q, ...over, base: { ...q.base, ...baseOver } }))}`;
  const sortHref = (key: string) => href({ sort: key }, { dir: q.sort === key && q.base.dir === "asc" ? "desc" : "asc", page: 1 });
  const arrow = (key: string) => (q.sort === key ? (q.base.dir === "asc" ? " ▲" : " ▼") : "");
  const ariaSort = (key: string) => (q.sort === key ? (q.base.dir === "asc" ? "ascending" : "descending") : "none");
  const groups: { family: Family; metrics: PulseMetric[] }[] = [];
  for (const m of view.metrics) {
    const g = groups[groups.length - 1];
    if (g && g.family === m.family) g.metrics.push(m);
    else groups.push({ family: m.family, metrics: [m] });
  }
  return (
    <div className="table-wrap">
      <table className="pulse">
        <caption className="skip">Pulse Rent: {view.filteredEntities} filas; periodo {view.period.label}; referencia {view.reference.label}</caption>
        <thead>
          <tr>
            <th className="sticky-col" rowSpan={2} scope="col" aria-sort={ariaSort("name")}><Link href={sortHref("name")}>Entidad{arrow("name")}</Link></th>
            {groups.map((g) => <th key={g.family} className="fam" colSpan={g.metrics.length} scope="colgroup">{FAMILY_LABEL[g.family]}</th>)}
          </tr>
          <tr>
            {view.metrics.map((m) => {
              const st = view.stats[m.id];
              return (
                <th key={m.id} scope="col" className="num" aria-sort={ariaSort(m.id)}>
                  <Link href={sortHref(m.id)} title="Ordenar numéricamente (los vacíos van siempre al final)"><strong>{m.id}</strong> {m.label}{arrow(m.id)}</Link>
                  <small className="muted block">{st?.unit ?? m.unit}</small>
                  <small className="block"><Link href={`${href({ col: m.id })}#distribucion`}>Ver distribución</Link> · N {st?.n ?? 0}</small>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {view.rows.map((r) => (
            <tr key={r.id} aria-selected={q.sel === r.id ? true : undefined}>
              <th scope="row" className="sticky-col">
                {r.name}
                {r.parent ? <small className="muted block">{r.parent}</small> : null}
              </th>
              {view.metrics.map((m) => {
                const c = r.cells[m.id];
                return (
                  <td key={m.id} className="num">
                    <Link className="cell-link" href={`${href({ sel: r.id, col: m.id })}#explicacion`} title="Ver la explicación de esta celda">
                      {fmt(c.value, c.unit)}
                      <small className="block"><StateBadge state={c.state} reason={c.reason} /> <BandBadge band={c.band} /></small>
                    </Link>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
