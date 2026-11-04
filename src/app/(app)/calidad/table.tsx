import Link from "next/link";
import { INDICATOR_KEYS } from "@/domain/quality-config";
import { KPI_ACCESS_NAME, KPI_OBSERVED_UNIT, rateUnit } from "@/domain/quality-kpi";
import { qualityToParams, type QualityQuery } from "@/domain/quality-query";
import { qs } from "@/lib/format";
import type { QualityRow } from "@/server/quality/engine";
import { NeutralTag, StateTag, cellInfo, num, reasonOf } from "./ui";

/** Enlace a un apartado/detalle conservando periodo, nivel, filtros y orden. `volver` lo da la propia URL (sin `kpi` ni `sel`). */
export const kpiHref = (q: QualityQuery, basePath: string, kpi: (typeof INDICATOR_KEYS)[number] | "", sel = "") => `${basePath}${qs(qualityToParams({ ...q, kpi, sel, fam: "", base: { ...q.base, page: 1 } }))}`;

function KpiCell({ r, k, q, basePath }: { r: QualityRow; k: (typeof INDICATOR_KEYS)[number]; q: QualityQuery; basePath: string }) {
  const i = r.evaluation.indicators[k];
  const c = cellInfo(i, r.explain[k].observed);
  const unit = rateUnit(k, i.unit);
  const href = kpiHref(q, basePath, k, r.id);
  const state = c.kind === "COLOR" && c.color ? "" : c.kind === "BLANK" ? "sin feedback" : c.label;
  const aria = `${r.name}: ${KPI_ACCESS_NAME[k]}, ${c.main === null ? "sin valor" : `${num(c.main)} ${unit}`}${c.color ? `, ${c.color === "red" ? "rojo" : c.color === "yellow" ? "amarillo" : "verde"}` : state ? `, ${state}` : ""}${i.value === null || c.kind === "PARTIAL" || c.kind === "UNCALIBRATED" ? `. ${reasonOf(i)}` : ""}. Abrir detalle`;
  return (
    <td className="ql-k">
      <Link href={href} aria-label={aria} title={i.value === null || c.kind !== "COLOR" ? reasonOf(i) : undefined} prefetch={false}>
        {k === "HEALTH" ? (
          c.main === null ? <NeutralTag>Sin informar</NeutralTag> : <><span className="ql-v">{c.main}</span> {c.color ? <StateTag color={c.color} /> : <NeutralTag>Sin calibrar</NeutralTag>}</>
        ) : (
          <>
            {c.main === null ? <span className="ql-v" aria-hidden="true">—</span> : <><span className="ql-v">{c.kind === "PARTIAL" ? "≥ " : ""}{num(c.main)}</span> <span className="ql-u">{unit}</span></>}
            {c.main === null && c.observed !== null ? <span className="ql-obs">{num(c.observed)} {KPI_OBSERVED_UNIT[k]} obs.</span> : null}
            {c.color ? <StateTag color={c.color} /> : i.alert ? <StateTag color="red" text="Alerta parcial" /> : c.label ? <NeutralTag partial={c.kind === "PARTIAL"}>{c.label}</NeutralTag> : null}
          </>
        )}
      </Link>
    </td>
  );
}

/** Resumen de clientes: una fila por Grupo/Cliente, los seis indicadores (valor + estado) y el resultado global. Las cabeceras de indicador NAVEGAN a su apartado. */
export function Portfolio({ rows, q, basePath }: { rows: QualityRow[]; q: QualityQuery; basePath: string }) {
  const href = (extra: Partial<QualityQuery>, dir?: "asc" | "desc") => `${basePath}${qs(qualityToParams({ ...q, ...extra, sel: "", kpi: "", base: { ...q.base, dir: dir ?? q.base.dir, page: 1 } }))}`;
  const sortLink = (key: string, text: string) => (
    <Link href={href({ sort: key }, q.sort === key && q.base.dir === "asc" ? "desc" : "asc")} aria-label={`Ordenar por ${text}`} prefetch={false}>{text}{q.sort === key ? (q.base.dir === "asc" ? " ▲" : " ▼") : ""}</Link>
  );
  return (
    <div className="ql-wrap" tabIndex={0} role="region" aria-label="Resumen de clientes: seis indicadores y resultado global (desplazable)">
      <table className="ql-table">
        <caption className="visually-hidden">Calidad: seis indicadores y resultado global por {q.scope === "group" ? "Grupo Cliente" : "Cliente"}</caption>
        <thead>
          <tr>
            <th scope="col">{sortLink("name", q.scope === "group" ? "Grupo Cliente" : "Cliente")}</th>
            <th scope="col" className="ql-r">Usuarios</th>
            {INDICATOR_KEYS.map((k) => <th key={k} scope="col"><Link href={kpiHref(q, basePath, k)} prefetch={false} aria-label={`Abrir el apartado ${KPI_ACCESS_NAME[k]} para la selección actual`}>{KPI_ACCESS_NAME[k]}</Link></th>)}
            <th scope="col">{sortLink("global", "Resultado global")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const g = r.evaluation.global;
            return (
              <tr key={r.id} aria-selected={q.sel === r.id}>
                <th scope="row" className="ql-name"><Link href={kpiHref(q, basePath, "", r.id)} prefetch={false}>{r.name}</Link>{r.parent ? <small>{r.parent}</small> : null}</th>
                <td className="ql-r">{r.users.stock === null ? <span className="ql-muted" title="Usuarios del mes sin informar en la matriz: no se calculan tasas (los conteos se conservan).">—</span> : r.users.stock}</td>
                {INDICATOR_KEYS.map((k) => <KpiCell key={k} r={r} k={k} q={q} basePath={basePath} />)}
                <td className="ql-k">
                  <Link href={kpiHref(q, basePath, "", r.id)} prefetch={false} aria-label={`${r.name}: resultado global ${g.color ? `${g.color === "red" ? "rojo" : g.color === "yellow" ? "amarillo" : "verde"}, índice ${num(g.score, 2)}` : `${g.status === "SIN_METODO" ? "sin calibrar" : "incompleto"}, cobertura calculable ${num(r.coveragePercent, 0)} %`}. ${g.reason} Abrir ficha`} title={g.color ? undefined : g.reason}>
                    {g.color ? <><span className="ql-v">{num(g.score, 2)}</span> <StateTag color={g.color} /></> : (
                      <>
                        <NeutralTag>{g.status === "SIN_METODO" ? "Sin método del global" : "Parcial"}</NeutralTag>
                        {g.partialAlerts.length ? <StateTag color="red" text="Alerta parcial" /> : null}
                        <span className="ql-obs">cob. {num(r.coveragePercent, 0)} %</span>
                      </>
                    )}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
