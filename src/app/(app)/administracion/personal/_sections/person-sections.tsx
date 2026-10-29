import { ActionForm, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form-kit";
import { StatusBadge } from "@/components/list";
import {
  ALIAS_KIND_LABEL,
  PERSON_ATTRIBUTES,
  PERSON_ATTRIBUTE_LABEL,
  PERSON_SYSTEMS,
  PERSON_SYSTEM_LABEL,
  type AliasKind,
  type PersonAttribute,
  type PersonSystem,
  type ResolvedPerson,
} from "@/domain/personal";
import { formatDate, fromDbDate } from "@/domain/vigencia";
import { updateAliasAction, updateTermAction } from "../actions";
import { ToggleActive } from "../toggle-active";
import { AliasForm, TermForm, type CatalogOptions } from "./person-forms";

type AliasRow = {
  id: string;
  system: PersonSystem;
  kind: AliasKind;
  rawValue: string;
  validFrom: Date | null;
  validTo: Date | null;
  note: string | null;
  isActive: boolean;
  version: number;
};

const iso = (d: Date | null) => fromDbDate(d);
const fromText = (d: Date | null) => (d ? formatDate(iso(d)) : <span className="muted">desconocido</span>);
const toText = (d: Date | null) => (d ? formatDate(iso(d)) : <span className="muted">vigente</span>);

/** Alias por sistema: nombre, ID o correo con su vigencia. No dan permisos ni crean cuentas. */
export function AliasesSection({ personId, rows, canEdit }: { personId: string; rows: AliasRow[]; canEdit: boolean }) {
  return (
    <section className="card" aria-labelledby="sec-alias">
      <h2 id="sec-alias">Alias e identificadores por sistema</h2>
      <p className="muted">
        Una persona puede no tener alias en todos los sistemas. Los alias se asignan explícitamente (nunca por parecido de nombre) y
        no conceden permisos ni crean cuentas de acceso. Los alias antiguos se conservan.
      </p>
      {PERSON_SYSTEMS.map((system) => {
        const list = rows.filter((r) => r.system === system);
        return (
          <div key={system}>
            <h3>{PERSON_SYSTEM_LABEL[system]}</h3>
            {list.length === 0 ? (
              <p className="muted">Sin alias en {PERSON_SYSTEM_LABEL[system]}.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Tipo</th><th>Valor original</th><th>Desde</th><th>Hasta (excl.)</th><th>Estado</th>{canEdit ? <th>Acciones</th> : null}</tr></thead>
                  <tbody>
                    {list.map((a) => (
                      <tr key={a.id} className={a.isActive ? undefined : "inactive-row"}>
                        <td>{ALIAS_KIND_LABEL[a.kind]}</td>
                        <td>{a.rawValue}</td>
                        <td>{fromText(a.validFrom)}</td>
                        <td>{toText(a.validTo)}</td>
                        <td><StatusBadge active={a.isActive} /></td>
                        {canEdit ? (
                          <td>
                            <div className="row-actions"><ToggleActive entity="alias" id={a.id} version={a.version} active={a.isActive} /></div>
                            <details className="edit">
                              <summary>Editar</summary>
                              <ActionForm action={updateAliasAction} hidden={{ id: a.id, expectedVersion: a.version }}>
                                <TextField name="rawValue" label="Valor original" initial={a.rawValue} required />
                                <TextField name="validFrom" label="Vigente desde" type="date" initial={iso(a.validFrom) ?? ""} />
                                <TextField name="validTo" label="Vigente hasta (excl.)" type="date" initial={iso(a.validTo) ?? ""} />
                                <TextAreaField name="note" label="Nota" initial={a.note ?? ""} />
                                <div className="form-actions"><SubmitButton>Guardar</SubmitButton></div>
                              </ActionForm>
                            </details>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
      {canEdit ? (
        <details className="edit">
          <summary>Añadir alias</summary>
          <AliasForm personId={personId} />
        </details>
      ) : null}
    </section>
  );
}

type TermRow = {
  id: string;
  attribute: PersonAttribute;
  flag: boolean | null;
  catalogItemId: string | null;
  catalogItem: { name: string } | null;
  validFrom: Date | null;
  validTo: Date | null;
  note: string | null;
  version: number;
};

const showTerm = (t: TermRow) => (t.attribute === "PMO_MEMBER" ? (t.flag ? "Sí" : "No") : (t.catalogItem?.name ?? "—"));

/** Situación a una fecha: nivel, equipo, PMO y rol. El rol solo se muestra si pertenece a PMO. */
export function SituationCard({ date, resolved }: { date: string; resolved: ResolvedPerson }) {
  const pending = (a: PersonAttribute) => resolved.flags.some((f) => f.attribute === a);
  const mark = (a: PersonAttribute) => (pending(a) ? <span className="badge badge-warn" style={{ marginLeft: 6 }}>Fecha inicial por revisar</span> : null);
  return (
    <dl className="kv" aria-label={`Situación a ${formatDate(date)}`}>
      <dt>Equipo</dt><dd>{resolved.team?.name ?? <span className="muted">Sin informar</span>}{mark("TEAM")}</dd>
      <dt>Nivel</dt><dd>{resolved.level?.name ?? <span className="muted">Sin informar</span>}{mark("LEVEL")}</dd>
      <dt>Pertenece a PMO</dt><dd>{resolved.pmoMember === null ? <span className="muted">Sin informar</span> : resolved.pmoMember ? "Sí" : "No"}{mark("PMO_MEMBER")}</dd>
      <dt>Rol PMO</dt>
      <dd>
        {resolved.pmoMember === true ? (resolved.pmoRole?.name ?? <span className="muted">Sin informar</span>) : <span className="muted">No aplica</span>}
        {mark("PMO_ROLE")}
      </dd>
    </dl>
  );
}

/** Historia de nivel, equipo, PMO y rol con sus vigencias; permite cambio con fecha efectiva y tramos históricos. */
export function TermsSection({ personId, rows, catalog, canEdit }: { personId: string; rows: TermRow[]; catalog: CatalogOptions; canEdit: boolean }) {
  return (
    <section className="card" aria-labelledby="sec-tramos">
      <h2 id="sec-tramos">Historia de nivel, equipo, PMO y rol</h2>
      <p className="muted">
        Cada cambio conserva la asignación anterior. Un cambio con fecha efectiva cierra el tramo vigente ese día y abre el nuevo.
        Si sale de PMO, su rol PMO se cierra ese día.
      </p>
      {PERSON_ATTRIBUTES.map((attr) => {
        const list = rows.filter((r) => r.attribute === attr);
        return (
          <div key={attr}>
            <h3>{PERSON_ATTRIBUTE_LABEL[attr]}</h3>
            {list.length === 0 ? (
              <p className="muted">Sin informar.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Valor</th><th>Desde</th><th>Hasta (excl.)</th><th>Nota</th>{canEdit ? <th>Acciones</th> : null}</tr></thead>
                  <tbody>
                    {list.map((t) => (
                      <tr key={t.id}>
                        <td>{showTerm(t)}</td>
                        <td>
                          {fromText(t.validFrom)}
                          {t.validFrom === null ? <span className="badge badge-warn" style={{ marginLeft: 6 }}>Fecha inicial por revisar</span> : null}
                        </td>
                        <td>{toText(t.validTo)}</td>
                        <td>{t.note ?? <span className="muted">—</span>}</td>
                        {canEdit ? (
                          <td>
                            <details className="edit">
                              <summary>Corregir</summary>
                              <ActionForm action={updateTermAction} hidden={{ id: t.id, expectedVersion: t.version }}>
                                <SelectField
                                  name="value"
                                  label="Valor"
                                  required
                                  initial={t.attribute === "PMO_MEMBER" ? String(t.flag) : (t.catalogItemId ?? "")}
                                  options={t.attribute === "PMO_MEMBER" ? [{ value: "true", label: "Sí" }, { value: "false", label: "No" }] : catalog[t.attribute]}
                                />
                                <TextField name="validFrom" label="Desde" type="date" initial={iso(t.validFrom) ?? ""} />
                                <TextField name="validTo" label="Hasta (excl.)" type="date" initial={iso(t.validTo) ?? ""} />
                                <TextAreaField name="note" label="Nota" initial={t.note ?? ""} />
                                <div className="form-actions"><SubmitButton>Guardar</SubmitButton></div>
                              </ActionForm>
                            </details>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
      {canEdit ? (
        <div className="grid-2" style={{ marginTop: "1rem" }}>
          <details className="edit"><summary>Cambio con fecha efectiva</summary><TermForm mode="change" personId={personId} catalog={catalog} /></details>
          <details className="edit"><summary>Añadir tramo histórico</summary><TermForm mode="period" personId={personId} catalog={catalog} /></details>
        </div>
      ) : null}
    </section>
  );
}
