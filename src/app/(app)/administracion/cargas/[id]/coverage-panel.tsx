import { ActionForm, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form-kit";
import { COVERAGE_SOURCE_LABEL, POPULATION_LABEL, SOURCE_PROFILE, STATUS_SCOPE_LABEL, COVERAGE_SOURCES } from "@/domain/quality-coverage";
import { formatDate } from "@/domain/vigencia";
import type { CoverageDeclaration } from "@/server/quality/coverage";
import { declareCoverageAction } from "../actions";

/**
 * Cobertura declarada del lote (Calidad): población, estados contenidos y alcance temporal. Sin declaración la cobertura es DESCONOCIDA (no se aprueba sola):
 * un cero de flujo o un stock histórico no se sustentan con la mera presencia de filas. La declaración no cambia las filas ni la extracción original.
 */
export function CoveragePanel({ batchId, profileId, status, history, declaredExtraction }: { batchId: string; profileId: string; status: string; history: CoverageDeclaration[]; declaredExtraction: string | null }) {
  const source = COVERAGE_SOURCES.find((s) => SOURCE_PROFILE[s] === profileId);
  if (!source) return null;
  const cur = history[0] ?? null;
  const isTickets = source === "tickets";
  return (
    <section className="card" aria-labelledby="sec-cobertura">
      <h2 id="sec-cobertura">Cobertura declarada para Calidad</h2>
      <p className="muted">
        Fuente: {COVERAGE_SOURCE_LABEL[source]}. La presencia de filas no demuestra que el export contenga a todos los clientes ni todos los estados. Solo un lote <strong>completado y no revertido</strong> con cobertura declarada sustenta un cero de flujo o una fotografía de backlog. Extracción declarada del lote: {declaredExtraction ?? "no declarada (frescura desconocida)"}.
      </p>
      {cur ? (
        <dl className="kv">
          <dt>Vigente</dt><dd>Versión {cur.version} · {POPULATION_LABEL[cur.population]}{isTickets ? ` · ${STATUS_SCOPE_LABEL[cur.statusScope]}` : ""} · alcance {cur.coveredFrom ? `${formatDate(cur.coveredFrom)} a ${formatDate(cur.coveredTo as string)}` : "sin declarar"}{cur.extractedOn ? ` · extracción revisada ${formatDate(cur.extractedOn)}` : ""}</dd>
          <dt>Motivo y autor</dt><dd>{cur.reason} — {cur.declaredByEmail}</dd>
        </dl>
      ) : <p><span className="badge badge-off">Sin declaración: cobertura desconocida</span></p>}
      {status !== "COMPLETED" ? <p className="hint">Solo se puede declarar cobertura en un lote completado.</p> : (
        <ActionForm action={declareCoverageAction} hidden={{ id: batchId, expectedVersion: cur?.version ?? 0 }}>
          <SelectField name="population" label="Población" initial={cur?.population ?? "UNKNOWN"} options={Object.entries(POPULATION_LABEL).map(([value, label]) => ({ value, label }))} help="«Todos los clientes» solo si el export contiene a todos los clientes del alcance." />
          {isTickets ? <SelectField name="statusScope" label="Estados contenidos" initial={cur?.statusScope ?? "UNKNOWN"} options={Object.entries(STATUS_SCOPE_LABEL).filter(([v]) => v !== "NOT_APPLICABLE").map(([value, label]) => ({ value, label }))} help="Un export de solo sin resolver sustenta el stock, pero no el flujo de altas." /> : <input type="hidden" name="statusScope" value="NOT_APPLICABLE" />}
          <TextField name="coveredFrom" label={isTickets ? "Creación cubierta desde" : source === "pap" ? "Producción cubierta desde" : "Trabajo cubierto desde"} type="date" initial={cur?.coveredFrom ?? ""} />
          <TextField name="coveredTo" label="…hasta (inclusive)" type="date" initial={cur?.coveredTo ?? ""} />
          {isTickets ? <TextField name="extractedOn" label="Extracción revisada (opcional)" type="date" initial={cur?.extractedOn ?? ""} help="No sustituye la fecha original del lote ni sus observaciones; fija la fecha de la fotografía cuando no se declaró al cargar." /> : <input type="hidden" name="extractedOn" value="" />}
          <TextAreaField name="reason" label="Motivo (obligatorio)" />
          <div className="form-actions"><SubmitButton>{cur ? "Guardar nueva versión" : "Declarar cobertura"}</SubmitButton></div>
        </ActionForm>
      )}
      {history.length > 1 ? <details><summary>Versiones anteriores ({history.length - 1})</summary><ol reversed>{history.slice(1).map((h) => <li key={h.version}>v{h.version}: {POPULATION_LABEL[h.population]}, {h.coveredFrom ? `${formatDate(h.coveredFrom)}–${formatDate(h.coveredTo as string)}` : "sin alcance"} — {h.reason} ({h.declaredByEmail})</li>)}</ol></details> : null}
    </section>
  );
}
