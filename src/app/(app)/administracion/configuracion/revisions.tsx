import { ActionForm, SubmitButton, TextField } from "@/components/form-kit";
import { formatDateTime } from "@/lib/format";
import { listRevisions, getDraft, FAMILY_NAME, type ConfigFamily, type Draft, type Revision } from "@/server/pulse/config";
import { activateConfigAction, discardDraftAction, rollbackConfigAction } from "./actions";

/** Historial, activación del borrador y vuelta a una revisión anterior (compartido por Pulse Rent y Calidad). Solo el Administrador ve borradores y formularios. */
export async function RevisionPanel({ userId, family, isAdmin }: { userId: string; family: ConfigFamily; isAdmin: boolean }) {
  const revisions = (await listRevisions(userId, family)) as Revision<ConfigFamily>[];
  const cur = revisions[0];
  const draft = isAdmin ? ((await getDraft(userId, family)) as Draft<ConfigFamily> | null) : null;
  return (
    <>
      {isAdmin ? (
        <section className="card" aria-labelledby={`act-${family}`}>
          <h2 id={`act-${family}`}>Activar el borrador</h2>
          {draft ? (
            <>
              <p>
                Hay un <strong>borrador</strong> (versión {draft.version}, guardado {formatDateTime(new Date(draft.updatedAt))} por {draft.updatedByEmail ?? "—"}) basado en la revisión {draft.baseRevisionNo}.
                {draft.baseRevisionNo !== cur.revisionNo ? <strong> La revisión activa ya es la {cur.revisionNo}: el borrador está obsoleto; revíselo y guárdelo de nuevo.</strong> : null}
              </p>
              <ActionForm action={activateConfigAction} hidden={{ family, expectedRevisionNo: cur.revisionNo, expectedDraftVersion: draft.version }}>
                <TextField name="reason" label="Motivo de la activación" required help="Queda en el historial y en la auditoría." />
                <div className="form-actions"><SubmitButton pending="Activando…">Activar la revisión {cur.revisionNo + 1}</SubmitButton></div>
              </ActionForm>
              <ActionForm action={discardDraftAction} hidden={{ family }}>
                <div className="form-actions"><SubmitButton variant="secondary" pending="Descartando…">Descartar borrador</SubmitButton></div>
              </ActionForm>
            </>
          ) : (
            <p className="muted">No hay borrador. Edite los campos y use «Guardar borrador»; activar es una acción aparte. No hay aprobación externa: el Administrador elige.</p>
          )}
        </section>
      ) : null}
      <section className="card" aria-labelledby={`hist-${family}`}>
        <h2 id={`hist-${family}`}>Revisiones de {FAMILY_NAME[family]}</h2>
        <div className="table-wrap">
          <table>
            <caption className="skip">Revisiones inmutables de {FAMILY_NAME[family]}</caption>
            <thead><tr><th>Revisión</th><th>Tipo</th><th>Activada</th><th>Autor</th><th>Motivo</th>{isAdmin ? <th>Acción</th> : null}</tr></thead>
            <tbody>
              {revisions.map((r) => (
                <tr key={r.revisionNo}>
                  <td>{r.revisionNo}{r.revisionNo === cur.revisionNo ? <span className="badge badge-ok"> activa</span> : null}</td>
                  <td>{r.kind === "INITIAL" ? "inicial" : r.kind === "ROLLBACK" ? `vuelta a la ${r.restoredFromRevisionNo}` : "activación"}{!r.persisted ? " (por defecto, sin persistir)" : ""}</td>
                  <td>{r.activatedAt ? formatDateTime(new Date(r.activatedAt)) : "—"}</td>
                  <td>{r.activatedByEmail ?? "—"}</td>
                  <td>{r.reason ?? "—"}</td>
                  {isAdmin ? (
                    <td>
                      {r.revisionNo !== cur.revisionNo && r.persisted ? (
                        <ActionForm action={rollbackConfigAction} hidden={{ family, toRevisionNo: r.revisionNo, expectedRevisionNo: cur.revisionNo }} className="form form-inline">
                          <TextField name="reason" label="Motivo" required />
                          <SubmitButton variant="secondary" pending="Creando…">Volver a esta</SubmitButton>
                        </ActionForm>
                      ) : "—"}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">Volver a una revisión anterior <strong>crea una nueva activación identificada</strong>; la historia no se modifica.</p>
      </section>
    </>
  );
}
