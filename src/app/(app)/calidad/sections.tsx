import Link from "next/link";
import type { ReactNode } from "react";
import { DIAGNOSIS_ACTION, DIAGNOSIS_FAMILIES, DIAGNOSIS_LABEL, UNIT_LABEL, BACKLOG_UNIT, type DiagnosisFamily } from "@/domain/quality-config";
import { qualityToParams, type QualityQuery } from "@/domain/quality-query";
import { qs } from "@/lib/format";
import { Pager, fdate } from "@/components/analytics/ui";
import type { BacklogView, DiagnosisView, DiagRow } from "@/server/quality/detail";
import { NeutralTag, num } from "./ui";

const FAM = (f: string) => DIAGNOSIS_LABEL[f as DiagnosisFamily] ?? f;
const dash = <span className="ql-muted" aria-label="sin dato">—</span>;

function T({ cols, rows, right = [] }: { cols: string[]; rows: ReactNode[][]; right?: number[] }) {
  return (
    <div className="ql-wrap" tabIndex={0} role="region" aria-label="Tabla (desplazable)">
      <table className="ql-table">
        <thead><tr>{cols.map((c, i) => <th key={c + i} scope="col" className={right.includes(i) ? "ql-r" : undefined}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j} className={right.includes(j) ? "ql-r" : undefined}>{c}</td>))}</tr>)}</tbody>
      </table>
    </div>
  );
}

/**
 * Diagnóstico por origen dentro del apartado de incidentes y problemas: las siete familias (Estándar, Configuración, Personalización, Integración y procesos,
 * Infraestructura CLOUD, Sistemas del Cliente y Uso indebido). La orientación es una HIPÓTESIS de revisión; una etiqueta no demuestra falta de pruebas.
 */
export function DiagnosisBlock({ d, q, basePath, rows }: { d: DiagnosisView; q: QualityQuery; basePath: string; rows: { rows: DiagRow[]; total: number; page: number; pageCount: number } | null }) {
  const link = (fam: string) => `${basePath}${qs(qualityToParams({ ...q, fam }))}`;
  const fams = DIAGNOSIS_FAMILIES.filter((f) => d.typeByFamily.cols.includes(f) || d.n3ByFamily[f] !== undefined || d.hoursByFamily[f] !== undefined);
  return (
    <section className="ql-panel" aria-label="Causas por origen">
      <h2>Causas por origen · {fdate(d.period.from)} – {fdate(d.period.to)}</h2>
      {d.totals.tickets === 0 ? <p className="ql-note">Sin tickets creados en el periodo para esta selección (no prueba un cero si falta cobertura).</p> : (
        <>
          <p className="ql-note">{d.totals.tickets} tickets del periodo, cada uno una vez en su familia. {d.pending.noCause > 0 ? `${d.pending.noCause} con «Causa sin informar» (siguen contando en las horas y el volumen). ` : ""}{d.pending.infraNoHosting > 0 ? `${d.pending.infraNoHosting} de infraestructura sin alojamiento vigente. ` : ""}La orientación es una hipótesis de revisión de QA, no una conclusión.</p>
          <T
            cols={["Origen", "Incidentes", "Problemas", "Escalados N3", "Horas", "Orientación (hipótesis)"]}
            right={[1, 2, 3, 4]}
            rows={fams.map((f) => [<Link key={f} href={link(f)} prefetch={false}>{FAM(f)}</Link>, d.typeByFamily.cells[`incident|${f}`] ?? 0, d.typeByFamily.cells[`problem|${f}`] ?? 0, d.n3ByFamily[f] ?? 0, `${num(d.hoursByFamily[f] ?? "0", 1)} h`, DIAGNOSIS_ACTION[f]])}
          />
          <p className="ql-note">PAP del periodo por origen (no aditivo; total único {d.papTotalUnique}): {d.papByOrigin.length ? d.papByOrigin.map((p) => `${p.origin} ${p.count}`).join(" · ") : "sin PAP con causa"}.</p>
        </>
      )}
      {rows ? (
        <>
          <h3>Tickets de «{FAM(q.fam)}» ({rows.total})</h3>
          <T cols={["Ticket", "Tipo", "Creación", "Estado", "Entorno y tipología", "Causa registrada", "N3", "Bug"]} rows={rows.rows.map((t) => [t.ticketId, t.type, fdate(t.created), t.status, t.entorno ?? dash, t.cause ?? <NeutralTag key="c">Causa sin informar</NeutralTag>, t.n3 ? "sí" : "no", t.bugLink ? "sí" : "no"])} />
          <Pager base={basePath} params={qualityToParams(q)} page={rows.page} pageCount={rows.pageCount} total={rows.total} noun="tickets" />
        </>
      ) : null}
    </section>
  );
}

/** Backlog abierto y envejecido (observación de la carga, no estado histórico): incidentes y problemas separados, antigüedad, causas y detalle. */
export function BacklogBlock({ b, q, basePath }: { b: BacklogView; q: QualityQuery; basePath: string }) {
  return (
    <section className="ql-panel" aria-label="Backlog abierto y antigüedad">
      <h2>Backlog abierto y antigüedad</h2>
      {!b.stats ? <p className="ql-note">Sin observación compatible del corte: el stock no está disponible y no se rellena con el estado de otra fecha. {b.notes[0]}</p> : (
        <>
          <p className="ql-note">Observado el <strong>{fdate(b.observedOn)}</strong> (observación de la carga, no estado histórico). Edad = días naturales entre la creación y esa observación; envejecido = edad &gt; umbral ({b.thresholds.incident ?? "sin configurar"} d incidentes · {b.thresholds.problem ?? "sin configurar"} d problemas). {b.notes.slice(1).join(" ")}</p>
          <T
            cols={["Tipo", "Activos", "Mediana (d)", "P90 (d)", "Máx. (d)", "Envejecidos", "% env.", `Activos ${UNIT_LABEL[BACKLOG_UNIT]}`, `Envejecidos ${UNIT_LABEL[BACKLOG_UNIT]}`, "Tramos de antigüedad"]}
            right={[1, 2, 3, 4, 5, 6, 7, 8]}
            rows={(["incident", "problem"] as const).map((t) => {
              const s = b.stats![t];
              return [t === "incident" ? "Incidentes" : "Problemas", s.count, s.count ? num(s.median) : dash, s.count ? num(s.p90) : dash, s.max ?? dash, b.thresholds[t] === null ? <NeutralTag key="u">Sin umbral</NeutralTag> : s.aged, s.agedPct === null ? dash : `${num(s.agedPct, 1)} %`, s.per100 === null ? dash : num(s.per100), s.agedPer100 === null ? dash : num(s.agedPer100), s.bands.map((x) => `${x.label}: ${x.n}`).join(" · ") || "sin tramos configurados"];
            })}
          />
          {b.byFamily.length ? <><h3>Causas del backlog abierto</h3><T cols={["Origen", "Incidentes", "Problemas", "Envejecidos"]} right={[1, 2, 3]} rows={b.byFamily.map((f) => [FAM(f.family), f.incident, f.problem, f.aged])} /></> : null}
          <p className="ql-note">Otros en la observación: {b.other.resolved} resueltos o cerrados · {b.other.questionTask} question/task · {b.other.unknownStatus} con estado desconocido · {b.other.invalidDates} con creación posterior a la observación.</p>
          <h3>Tickets abiertos ({b.total})</h3>
          <T cols={["Ticket", "Tipo", "Estado", "Creación", "Edad (d)", "Envejecido", "Origen"]} right={[4]} rows={b.rows.map((t) => [t.ticketId, t.type, t.status, fdate(t.created), t.age, t.aged ? <NeutralTag key="a" partial>sí</NeutralTag> : "no", FAM(t.family)])} />
          <Pager base={basePath} params={qualityToParams(q)} page={b.page} pageCount={b.pageCount} total={b.total} noun="tickets" />
        </>
      )}
    </section>
  );
}
