import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { parsePulseQuery, pulseToParams } from "@/domain/pulse-query";
import { first, qs, type SearchParams } from "@/lib/format";
import { Notice, Pager, fdate } from "@/components/analytics/ui";
import { fmt } from "@/components/pulse/ui";
import { ID_PATTERN } from "@/domain/analytics-query";
import { pulseDetail, type PulseDetail } from "@/server/pulse/detail";

export const metadata: Metadata = { title: "Detalle de Pulse Rent" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { query } = parsePulseQuery(sp);
  const entidad = first(sp.entidad);
  const metrica = first(sp.metrica);
  const pg = Number(first(sp.pagina)) || 1;
  const back = `/pulse-rent${qs({ ...pulseToParams(query), sel: entidad, col: metrica })}#explicacion`;
  let d: PulseDetail | null = null;
  let error: string | null = null;
  if (!ID_PATTERN.test(entidad) || !/^M\d{2}$/.test(metrica)) error = "Falta la entidad o la métrica del detalle.";
  else {
    try {
      d = await pulseDetail(user.id, query, entidad, metrica, Math.max(1, pg), 25);
    } catch (e) {
      error = e instanceof Error ? e.message : "Error inesperado al leer el detalle.";
    }
  }
  return (
    <>
      <p><Link href={back}>← Volver a Pulse Rent</Link></p>
      <h1>Detalle de {d ? `${d.metric.id} · ${d.metric.label}` : "la métrica"}</h1>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {d ? (
        <>
          <div className="card">
            <dl className="kv">
              <dt>Entidad</dt><dd>{d.entity.name}</dd>
              <dt>Periodo</dt><dd>{d.period.label} ({fdate(d.period.from)} – {fdate(d.period.to)})</dd>
              <dt>Predicado</dt><dd>{d.predicate}</dd>
              <dt>Numerador del detalle</dt><dd>{d.numerator === null ? "—" : <strong>{fmt(d.numerator, d.numeratorUnit)} {d.numeratorUnit}</strong>} · {d.total} fila(s)</dd>
              <dt>Referencia de datos</dt><dd><code>{d.stamp}</code></dd>
            </dl>
            {d.note ? <p className="hint">{d.note}</p> : null}
          </div>
          {d.kind === "none" ? (
            <div className="empty"><p>{d.note ?? "Esta métrica no tiene filas de detalle."}</p></div>
          ) : d.total === 0 ? (
            <div className="empty"><p><strong>Sin filas.</strong> El conjunto que concilia con este numerador está vacío en el periodo.</p></div>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <caption className="skip">Filas del numerador</caption>
                  <thead><tr>{d.columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr></thead>
                  <tbody>{d.rows.map((r, i) => <tr key={i}>{d.columns.map((c) => <td key={c.key}>{r[c.key] === null || r[c.key] === undefined ? "—" : String(r[c.key])}</td>)}</tr>)}</tbody>
                </table>
              </div>
              <Pager base="/pulse-rent/detalle" params={{ ...pulseToParams(query), entidad, metrica }} page={d.page} pageCount={Math.max(1, Math.ceil(d.total / d.pageSize))} total={d.total} noun="filas" />
            </>
          )}
        </>
      ) : null}
    </>
  );
}
