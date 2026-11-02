import Link from "next/link";
import { ActionForm, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form-kit";
import { MONTH_SHORT } from "@/domain/usuarios";
import { HEALTH_DB_LABEL, healthStateOf, type HealthDbState } from "@/domain/quality-health";
import { qualityToParams, type QualityQuery } from "@/domain/quality-query";
import { COLOR_LABEL, healthOutcome, type QualityConfig } from "@/domain/quality-config";
import { qs } from "@/lib/format";
import type { HealthCell, HealthHistoryRow, HealthMatrix } from "@/server/quality/health";
import { Pager, fdate } from "@/components/analytics/ui";
import { saveHealthCellAction } from "./actions";
import { ColorBadge } from "./ui";

const STATE_OPTS = [{ value: "POSITIVE", label: "Positivo" }, { value: "MIXED", label: "Mixto" }, { value: "NEGATIVE", label: "Negativo" }, { value: "NONE", label: "Sin feedback (limpiar la celda)" }];

/** Matriz enero–diciembre por año y ámbito. La categoría se ve aunque el mapeo no esté activado; el color solo con mapeo confirmado. */
export function HealthMatrixView({ m, q, cfg, basePath, edit, history, canEdit }: { m: HealthMatrix; q: QualityQuery; cfg: QualityConfig; basePath: string; edit: { entityId: string; month: number } | null; history: HealthHistoryRow[]; canEdit: boolean }) {
  const href = (extra: Partial<QualityQuery>, more: Record<string, string> = {}) => `${basePath}${qs({ ...qualityToParams({ ...q, view: "health", ...extra }), ...more })}`;
  const editing = edit ? m.rows.find((r) => r.id === edit.entityId) : null;
  const cell: HealthCell | null = editing && edit ? editing.cells[edit.month] : null;
  return (
    <section aria-labelledby="h-title">
      <h2 id="h-title">Client Health · {q.year} · {q.scope === "group" ? "Grupo Cliente" : "Cliente"}</h2>
      <p className="muted">Una celda por entidad y mes. <strong>Sin feedback</strong> queda en blanco (no es cero, no arrastra el mes anterior ni se propaga entre Grupo y Cliente). El color solo aparece con el mapeo confirmado por el Administrador ({cfg.health.confirmed ? "confirmado" : "sin confirmar: se muestra la categoría «sin calibrar»"}).</p>
      <p className="quick">Año: <Link href={href({ year: q.year - 1 })}>← {q.year - 1}</Link> · <Link href={href({ year: q.year + 1 })}>{q.year + 1} →</Link> · <a href={`/api/analitica/calidad.csv${qs({ ...qualityToParams({ ...q, view: "health" }), tabla: "health" })}`}>Descargar CSV de la matriz</a></p>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Matriz de Client Health (desplazable)">
        <table>
          <caption className="visually-hidden">Client Health mensual de {q.year}</caption>
          <thead><tr><th scope="col">Entidad</th>{MONTH_SHORT.map((x) => <th key={x} scope="col">{x}</th>)}</tr></thead>
          <tbody>
            {m.rows.map((r) => (
              <tr key={r.id}>
                <th scope="row">{r.name}{r.parent ? <><br /><small className="muted">{r.parent}</small></> : null}</th>
                {Array.from({ length: 12 }, (_, i) => {
                  const c = r.cells[i + 1];
                  const o = healthOutcome(c ? healthStateOf(c.state) : null, cfg.health);
                  const label = c && c.state !== "NONE" ? HEALTH_DB_LABEL[c.state] : "—";
                  const inner = c && c.state !== "NONE" ? (o.color ? <><ColorBadge color={o.color} /><br /><small>{label}</small></> : <span className="badge badge-warn" title="Categoría sin calibrar: sin color publicado">{label}</span>) : <span className="muted" aria-label="Sin feedback">·</span>;
                  const cellHref = href({}, { editar: `${r.id}|${i + 1}` });
                  return <td key={i}>{canEdit ? <Link href={cellHref} aria-label={`${r.name}, ${MONTH_SHORT[i]}: ${c && c.state !== "NONE" ? label : "sin feedback"}. Editar`}>{inner}</Link> : inner}</td>;
                })}
              </tr>
            ))}
            {m.rows.length === 0 ? <tr><td colSpan={13} className="empty">Sin entidades. Cree Grupos Cliente o Clientes en Administración › Clientes.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <Pager base={basePath} params={qualityToParams({ ...q, view: "health" })} page={m.page} pageCount={m.pageCount} total={m.total} noun="entidades" />
      {!canEdit ? <p className="hint">Su perfil es de consulta: puede leer la matriz y sus detalles, pero no editarla.</p> : null}
      {canEdit && edit && editing ? (
        <div className="card" aria-labelledby="h-edit">
          <h3 id="h-edit">Editar: {editing.name} · {MONTH_SHORT[edit.month - 1]} {q.year}</h3>
          {cell ? <p className="hint">Versión {cell.version} · registrado el {fdate(cell.recordedAt.slice(0, 10))} por {cell.updatedByEmail ?? "—"}. El dato pertenece al mes {edit.month}/{q.year}; su registro puede ser posterior.</p> : <p className="hint">Sin registro: la celda está en blanco.</p>}
          <ActionForm action={saveHealthCellAction} hidden={{ scope: q.scope, entityId: edit.entityId, year: q.year, month: edit.month, expectedVersion: cell?.version ?? 0 }}>
            <SelectField name="state" label="Estado del feedback" initial={cell?.state ?? "POSITIVE"} options={STATE_OPTS} help="«Mixto» es una elección explícita; no se deduce del comentario." />
            <TextField name="feedbackOn" label="Fecha del feedback (opcional)" type="date" initial={cell?.feedbackOn ?? ""} help="Vacía = fecha dentro del mes no informada (uso mensual provisional). No es la fecha de guardado; no puede ser futura." />
            <TextAreaField name="comment" label="Comentario (texto)" initial={cell?.comment ?? ""} />
            <div className="form-actions"><SubmitButton>Guardar celda</SubmitButton> <Link className="btn btn-secondary" href={href({})}>Cerrar</Link></div>
          </ActionForm>
          {history.length > 0 ? (
            <details>
              <summary>Historial de la celda ({history.length})</summary>
              <ol>{history.map((h) => <li key={h.version}>v{h.version} · {h.action === "CLEAR" ? "limpiada" : h.action === "CREATE" ? "alta" : "cambio"} → {HEALTH_DB_LABEL[h.state]}{h.prevState ? ` (antes ${HEALTH_DB_LABEL[h.prevState as HealthDbState]})` : ""} · {h.by} · {new Date(h.at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}{h.comment ? ` · «${h.comment}»` : ""}</li>)}</ol>
            </details>
          ) : null}
        </div>
      ) : null}
      <p className="hint">Leyenda del color: {Object.values(COLOR_LABEL).join(" / ")} solo con el mapeo confirmado; siempre con texto, nunca solo por color.</p>
    </section>
  );
}
