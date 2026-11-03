import Link from "next/link";
import { ActionForm, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form-kit";
import { MONTH_SHORT } from "@/domain/usuarios";
import { HEALTH_DB_LABEL, healthStateOf, type HealthDbState } from "@/domain/quality-health";
import { qualityToParams, type QualityQuery } from "@/domain/quality-query";
import { healthOutcome, type QualityConfig } from "@/domain/quality-config";
import { qs } from "@/lib/format";
import type { HealthCell, HealthHistoryRow, HealthMatrix } from "@/server/quality/health";
import { Pager, fdate } from "@/components/analytics/ui";
import { saveHealthCellAction } from "./actions";
import { NeutralTag, StateTag } from "./ui";
import type { KpiAccess } from "@/server/quality/engine";

const STATE_OPTS = [{ value: "POSITIVE", label: "Positivo" }, { value: "MIXED", label: "Mixto" }, { value: "NEGATIVE", label: "Negativo" }, { value: "NONE", label: "Sin feedback (limpiar la celda)" }];

/**
 * Apartado de Client Health: matriz enero–diciembre del año y la selección actual, feedback positivo / mixto / negativo / sin informar, y para el Administrador
 * la edición de una celda con su historial. Sin feedback queda en blanco (no es cero, no arrastra el mes anterior ni se propaga entre Grupo y Cliente).
 * El color solo aparece con el mapeo confirmado por el Administrador.
 */
export function HealthMatrixView({ m, q, cfg, basePath, edit, history, canEdit, access, monthLabel }: { m: HealthMatrix; q: QualityQuery; cfg: QualityConfig; basePath: string; edit: { entityId: string; month: number } | null; history: HealthHistoryRow[]; canEdit: boolean; access: KpiAccess; monthLabel: string }) {
  const href = (extra: Partial<QualityQuery>, more: Record<string, string> = {}) => `${basePath}${qs({ ...qualityToParams({ ...q, kpi: "HEALTH", ...extra }), ...more })}`;
  const editing = edit ? m.rows.find((r) => r.id === edit.entityId) : null;
  const cell: HealthCell | null = editing && edit ? editing.cells[edit.month] : null;
  const h = access.health;
  return (
    <>
      <section className="ql-panel" aria-label="Client Health">
        <h2>Client Health {q.year} · {q.scope === "group" ? "Grupo Cliente" : "Cliente"}</h2>
        <p className="ql-note">
          Feedback de {monthLabel}: {h ? `${h.positive} positivo · ${h.mixed} mixto · ${h.negative} negativo · ${h.blank} sin informar` : "—"}.
          {" "}Sin feedback queda en blanco y no es un cero. {cfg.health.confirmed ? "Mapeo a color confirmado." : "El mapeo a color no está confirmado: se muestra la categoría «sin calibrar», sin color."}
        </p>
        <p className="ql-links">
          <Link href={href({ year: q.year - 1 })} prefetch={false}>← {q.year - 1}</Link>
          <Link href={href({ year: q.year + 1 })} prefetch={false}>{q.year + 1} →</Link>
          <a href={`/api/analitica/calidad.csv${qs({ ...qualityToParams({ ...q, kpi: "HEALTH" }), tabla: "health" })}`}>CSV de la matriz</a>
        </p>
        <div className="ql-wrap" tabIndex={0} role="region" aria-label="Matriz de Client Health (desplazable)">
          <table className="ql-table ql-health">
            <caption className="visually-hidden">Client Health mensual de {q.year}</caption>
            <thead><tr><th scope="col">{q.scope === "group" ? "Grupo Cliente" : "Cliente"}</th>{MONTH_SHORT.map((x) => <th key={x} scope="col" style={{ textAlign: "center" }}>{x}</th>)}</tr></thead>
            <tbody>
              {m.rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="ql-name">{r.name}{r.parent ? <small>{r.parent}</small> : null}</th>
                  {Array.from({ length: 12 }, (_, i) => {
                    const c = r.cells[i + 1];
                    const o = healthOutcome(c ? healthStateOf(c.state) : null, cfg.health);
                    const label = c && c.state !== "NONE" ? HEALTH_DB_LABEL[c.state] : "—";
                    const inner = c && c.state !== "NONE" ? (o.color ? <StateTag color={o.color} text={label} /> : <NeutralTag title="Categoría sin calibrar: sin color publicado">{label}</NeutralTag>) : <span className="ql-muted" aria-label="Sin feedback">·</span>;
                    return <td key={i}>{canEdit ? <Link href={href({}, { editar: `${r.id}|${i + 1}` })} aria-label={`${r.name}, ${MONTH_SHORT[i]}: ${c && c.state !== "NONE" ? label : "sin feedback"}. Editar`} prefetch={false}>{inner}</Link> : inner}</td>;
                  })}
                </tr>
              ))}
              {m.rows.length === 0 ? <tr><td colSpan={13} className="ql-empty">Sin entidades en la selección.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <Pager base={basePath} params={{ ...qualityToParams({ ...q, kpi: "HEALTH" }) }} page={m.page} pageCount={m.pageCount} total={m.total} noun="entidades" />
        {!canEdit ? <p className="ql-note">Su perfil es de consulta: puede leer la matriz y sus detalles, pero no editarla.</p> : null}
      </section>
      {canEdit && edit && editing ? (
        <section className="ql-panel" aria-labelledby="h-edit">
          <h2 id="h-edit">Editar: {editing.name} · {MONTH_SHORT[edit.month - 1]} {q.year}</h2>
          {cell ? <p className="ql-note">Versión {cell.version} · registrado el {fdate(cell.recordedAt.slice(0, 10))} por {cell.updatedByEmail ?? "—"}. El dato pertenece al mes {edit.month}/{q.year}; su registro puede ser posterior.</p> : <p className="ql-note">Sin registro: la celda está en blanco.</p>}
          <ActionForm action={saveHealthCellAction} hidden={{ scope: q.scope, entityId: edit.entityId, year: q.year, month: edit.month, expectedVersion: cell?.version ?? 0 }}>
            <SelectField name="state" label="Estado del feedback" initial={cell?.state ?? "POSITIVE"} options={STATE_OPTS} help="«Mixto» es una elección explícita; no se deduce del comentario." />
            <TextField name="feedbackOn" label="Fecha del feedback (opcional)" type="date" initial={cell?.feedbackOn ?? ""} help="Vacía = fecha dentro del mes no informada (uso mensual provisional). No es la fecha de guardado; no puede ser futura." />
            <TextAreaField name="comment" label="Comentario (texto)" initial={cell?.comment ?? ""} />
            <div className="form-actions"><SubmitButton>Guardar celda</SubmitButton> <Link className="btn btn-secondary" href={href({})} prefetch={false}>Cerrar</Link></div>
          </ActionForm>
          {history.length > 0 ? (
            <details>
              <summary>Historial de la celda ({history.length})</summary>
              <ol>{history.map((x) => <li key={x.version}>v{x.version} · {x.action === "CLEAR" ? "limpiada" : x.action === "CREATE" ? "alta" : "cambio"} → {HEALTH_DB_LABEL[x.state]}{x.prevState ? ` (antes ${HEALTH_DB_LABEL[x.prevState as HealthDbState]})` : ""} · {x.by} · {new Date(x.at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}{x.comment ? ` · «${x.comment}»` : ""}</li>)}</ol>
            </details>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
