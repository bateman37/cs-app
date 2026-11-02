import Link from "next/link";
import { DEFAULT_QUALITY_QUERY, qualityToParams } from "@/domain/quality-query";
import type { AnalysisQuery } from "@/domain/analytics-query";
import { INDICATOR_KEYS, INDICATOR_NAME } from "@/domain/quality-config";
import { qs } from "@/lib/format";
import { getQuality } from "@/server/quality/engine";
import { ColorBadge, KpiCell, num } from "../calidad/ui";

/**
 * Integración de Calidad en la ficha (CSAPP-08 §9): los MISMOS seis resultados que /calidad (mismo motor, misma configuración, mismo corte), sin recalcular
 * otro color por cambiar de ruta o de página. Una implantación no hereda los KPI de su Cliente: solo se ofrecen sus horas/PAP atribuibles en las otras secciones.
 */
export async function CalidadFicha({ userId, query, target }: { userId: string; query: AnalysisQuery; target: { type: "group" | "client" | "implementation"; id: string } }) {
  if (target.type === "implementation") {
    return (
      <section className="card" aria-labelledby="fq">
        <h2 id="fq">Calidad</h2>
        <p className="muted">Una implantación no tiene tickets ni usuarios propios en las fuentes: <strong>no hereda los seis indicadores de su Cliente</strong>. Consulte el Cliente o el Grupo Cliente; aquí solo hay horas y PAP atribuibles a la implantación.</p>
      </section>
    );
  }
  const q = { ...DEFAULT_QUALITY_QUERY(), base: { ...query, page: 1, pageSize: 25 }, scope: target.type, sel: target.id } as ReturnType<typeof DEFAULT_QUALITY_QUERY>;
  const v = await getQuality(userId, q, {}).catch(() => null);
  const r = v?.rows.find((x) => x.id === target.id) ?? null;
  const link = `/calidad${qs({ ...qualityToParams(q), vista: "cartera" })}`;
  if (!v || !r) return <section className="card" aria-labelledby="fq"><h2 id="fq">Calidad</h2><p className="notice notice-warn">No se pudo leer el resultado de Calidad de este ámbito. <Link href={link}>Abrir Calidad</Link></p></section>;
  const g = r.evaluation.global;
  return (
    <section className="card" aria-labelledby="fq">
      <h2 id="fq">Calidad · mes {String(v.period.month).padStart(2, "0")}/{v.period.year} (corte {v.period.cut.split("-").reverse().join("/")}{v.period.provisional ? ", provisional" : ""})</h2>
      <p>Resultado global: {g.color ? <><ColorBadge color={g.color} /> índice {num(g.score, 2)}</> : <span className="badge badge-off">{g.status === "SIN_METODO" ? "Sin calibrar" : "Incompleto"}</span>} <small>{g.reason}</small> · cobertura calculable {num(r.coveragePercent, 1)} %</p>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Seis indicadores de Calidad (desplazable)">
        <table>
          <caption className="visually-hidden">Seis indicadores de Calidad del mes</caption>
          <thead><tr>{INDICATOR_KEYS.map((k) => <th key={k} scope="col">{INDICATOR_NAME[k]}</th>)}</tr></thead>
          <tbody><tr>{INDICATOR_KEYS.map((k) => <td key={k}><KpiCell i={r.evaluation.indicators[k]} /></td>)}</tr></tbody>
        </table>
      </div>
      <p className="quick"><Link href={link}>Detalle, evolución, diagnóstico y backlog en Calidad</Link> · <Link href={`/calidad${qs({ ...qualityToParams(q), vista: "diagnostico" })}`}>Diagnóstico por origen</Link> · <Link href={`/calidad${qs({ ...qualityToParams(q), vista: "backlog" })}`}>Backlog por antigüedad</Link></p>
    </section>
  );
}
