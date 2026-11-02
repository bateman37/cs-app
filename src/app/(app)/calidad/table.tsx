import Link from "next/link";
import { INDICATOR_KEYS, INDICATOR_NAME } from "@/domain/quality-config";
import { qualityToParams, type QualityQuery } from "@/domain/quality-query";
import { qs } from "@/lib/format";
import type { QualityRow } from "@/server/quality/engine";
import { ColorBadge, KpiCell, num } from "./ui";

export function Portfolio({ rows, q, basePath, sort }: { rows: QualityRow[]; q: QualityQuery; basePath: string; sort: string }) {
  const href = (extra: Partial<QualityQuery>) => `${basePath}${qs(qualityToParams({ ...q, ...extra }))}`;
  const sortLink = (key: string, text: string) => (
    <Link href={href({ sort: key, base: { ...q.base, dir: sort === key && q.base.dir === "asc" ? "desc" : "asc", page: 1 } })} aria-label={`Ordenar por ${text}`}>{text}{sort === key ? (q.base.dir === "asc" ? " ▲" : " ▼") : ""}</Link>
  );
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla de entidades con seis indicadores y resultado global (desplazable)">
      <table>
        <caption className="visually-hidden">Calidad: seis indicadores mensuales y resultado global por {q.scope === "group" ? "Grupo Cliente" : "Cliente"}</caption>
        <thead>
          <tr>
            <th scope="col">{sortLink("name", "Entidad")}</th>
            <th scope="col">Usuarios (corte / mes)</th>
            {INDICATOR_KEYS.map((k) => <th key={k} scope="col">{sortLink(k, INDICATOR_NAME[k])}</th>)}
            <th scope="col">{sortLink("global", "Resultado global")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} aria-selected={q.sel === r.id}>
              <th scope="row"><Link href={href({ sel: r.id, view: "cartera" })}>{r.name}</Link>{r.parent ? <><br /><small className="muted">{r.parent}</small></> : null}</th>
              <td>{r.users.stock === null ? <span className="badge badge-off">sin informar</span> : <>{r.users.stock}<br /><small>{num(r.users.userMonths)} u·mes</small></>}</td>
              {INDICATOR_KEYS.map((k) => <td key={k}><KpiCell i={r.evaluation.indicators[k]} /></td>)}
              <td>
                {r.evaluation.global.color ? <><ColorBadge color={r.evaluation.global.color} /> <small>índice {num(r.evaluation.global.score, 2)}</small></> : (
                  <>
                    <span className="badge badge-off" title={r.evaluation.global.reason}>{r.evaluation.global.status === "SIN_METODO" ? "Sin calibrar" : "Incompleto"}</span>
                    {r.evaluation.global.partialAlerts.length ? <><br /><ColorBadge color={null} alert /></> : null}
                    <br /><small>cobertura {num(r.coveragePercent, 1)} %</small>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
