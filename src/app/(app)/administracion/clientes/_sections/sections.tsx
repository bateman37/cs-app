import { ActionForm, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form-kit";
import { StatusBadge } from "@/components/list";
import {
  ATTRIBUTES,
  ATTRIBUTE_LABEL,
  KIND_LABEL,
  MILESTONE_LABEL,
  MILESTONE_TYPES,
  SYSTEM_LABEL,
  VALUE_LABEL,
  valueOptions,
  type Attribute,
  type Kind,
  type System,
} from "@/domain/catalogs";
import { fromDbDate, formatDate, pickAt } from "@/domain/vigencia";
import { formatDateTime } from "@/lib/format";
import { updateIdentityAction, updateMilestoneAction, updateTermAction } from "../actions";
import { ToggleActive } from "../toggle-active";
import { IdentityForm, type ScopeOption } from "./identity-form";
import { MilestoneForm } from "./milestone-form";
import { TermForm } from "./term-forms";

type TermRow = {
  id: string;
  attribute: Attribute;
  value: string;
  validFrom: Date | null;
  validTo: Date | null;
  note: string | null;
  version: number;
  implementation?: { id: string; name: string } | null;
};

const iso = (d: Date | null) => fromDbDate(d);
const showVal = (a: Attribute, v: string) => (a === "PRODUCT" ? v : (VALUE_LABEL[v] ?? v));

/** Situación a una fecha: valor vigente de cada dato en un ámbito concreto. */
export function SituationAt({ title, rows, date }: { title: string; rows: TermRow[]; date: string }) {
  return (
    <div>
      <h3>{title}</h3>
      <dl className="kv">
        {ATTRIBUTES.map((a) => {
          const hit = pickAt(
            rows.filter((r) => r.attribute === a).map((r) => ({ from: iso(r.validFrom), to: iso(r.validTo), value: r.value })),
            date,
          );
          return (
            <div key={a} style={{ display: "contents" }}>
              <dt>{ATTRIBUTE_LABEL[a]}</dt>
              <dd>{hit ? showVal(a, hit.value) : <span className="badge badge-warn">Sin informar</span>}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

export function TermsSection({
  rows,
  scopes,
  products,
  canEdit,
  scopeLabel,
}: {
  rows: TermRow[];
  scopes: ScopeOption[];
  products: string[];
  canEdit: boolean;
  scopeLabel: (r: TermRow) => string;
}) {
  return (
    <section className="card" aria-labelledby="sec-servicio">
      <h2 id="sec-servicio">Soporte, servidor, complejidad y producto</h2>
      <p className="muted">Cada dato tiene su propio ámbito y vigencia [desde, hasta): una migración con fecha efectiva conserva el valor anterior hasta esa fecha. «Sin informar» no es lo mismo que un valor asignado.</p>
      {rows.length === 0 ? (
        <p className="empty">Todavía no hay datos de servicio registrados.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Dato</th><th>Valor</th><th>Ámbito</th><th>Desde</th><th>Hasta (excl.)</th><th>Nota</th>{canEdit ? <th>Acciones</th> : null}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{ATTRIBUTE_LABEL[r.attribute]}</td>
                  <td>{showVal(r.attribute, r.value)}</td>
                  <td>{scopeLabel(r)}</td>
                  <td>{r.validFrom ? formatDate(iso(r.validFrom)) : <span className="muted">inicio desconocido</span>}</td>
                  <td>{r.validTo ? formatDate(iso(r.validTo)) : <span className="muted">vigente</span>}</td>
                  <td>{r.note ?? ""}</td>
                  {canEdit ? (
                    <td>
                      <details className="edit">
                        <summary>Corregir</summary>
                        <ActionForm action={updateTermAction} hidden={{ id: r.id, expectedVersion: r.version }}>
                          <SelectField name="value" label="Valor" initial={r.value} required options={valueOptions(r.attribute, products)} />
                          <TextField name="validFrom" label="Desde" type="date" initial={iso(r.validFrom) ?? ""} />
                          <TextField name="validTo" label="Hasta (excl.)" type="date" initial={iso(r.validTo) ?? ""} />
                          <TextAreaField name="note" label="Nota" initial={r.note ?? ""} />
                          <div className="form-actions"><SubmitButton>Guardar corrección</SubmitButton></div>
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
      {canEdit ? (
        <>
          <details className="edit">
            <summary>Cambiar un dato con fecha efectiva</summary>
            <TermForm mode="change" scopes={scopes} products={products} />
          </details>
          <details className="edit">
            <summary>Añadir un tramo histórico (desde / hasta)</summary>
            <TermForm mode="period" scopes={scopes} products={products} />
          </details>
        </>
      ) : null}
    </section>
  );
}

type IdentityRow = {
  id: string;
  system: System;
  kind: Kind;
  rawValue: string;
  validFrom: Date | null;
  validTo: Date | null;
  note: string | null;
  isActive: boolean;
  version: number;
  implementation?: { id: string; name: string } | null;
};

export function IdentitiesSection({
  rows,
  scopes,
  canEdit,
  scopeLabel,
  systems,
  pendingZendesk,
}: {
  rows: IdentityRow[];
  scopes: ScopeOption[];
  canEdit: boolean;
  scopeLabel: (r: IdentityRow) => string;
  systems?: readonly System[];
  pendingZendesk?: boolean;
}) {
  return (
    <section className="card" aria-labelledby="sec-equiv">
      <h2 id="sec-equiv">Equivalencias de origen</h2>
      <p className="muted">Identidades del cliente en BC, Zendesk, Wrike y PAP. Una misma identidad no puede apuntar a dos destinos con vigencias solapadas.</p>
      {pendingZendesk ? <p className="notice notice-info">Equivalencia Zendesk pendiente: este Cliente todavía no tiene ID de organización Zendesk registrado.</p> : null}
      {rows.length === 0 ? (
        <p className="empty">Sin equivalencias registradas.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Sistema</th><th>Tipo</th><th>Valor original</th><th>Destino</th><th>Desde</th><th>Hasta (excl.)</th><th>Estado</th>{canEdit ? <th>Acciones</th> : null}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.isActive ? undefined : "inactive-row"}>
                  <td>{SYSTEM_LABEL[r.system]}</td>
                  <td>{KIND_LABEL[r.kind]}</td>
                  <td>{r.rawValue}</td>
                  <td>{scopeLabel(r)}</td>
                  <td>{r.validFrom ? formatDate(iso(r.validFrom)) : <span className="muted">desconocido</span>}</td>
                  <td>{r.validTo ? formatDate(iso(r.validTo)) : <span className="muted">vigente</span>}</td>
                  <td><StatusBadge active={r.isActive} /></td>
                  {canEdit ? (
                    <td>
                      <div className="row-actions">
                        <ToggleActive entity="identity" id={r.id} version={r.version} active={r.isActive} />
                      </div>
                      <details className="edit">
                        <summary>Editar</summary>
                        <ActionForm action={updateIdentityAction} hidden={{ id: r.id, expectedVersion: r.version }}>
                          <TextField name="rawValue" label="Valor original" initial={r.rawValue} required />
                          <TextField name="validFrom" label="Vigente desde" type="date" initial={iso(r.validFrom) ?? ""} />
                          <TextField name="validTo" label="Vigente hasta (excl.)" type="date" initial={iso(r.validTo) ?? ""} />
                          <TextAreaField name="note" label="Nota" initial={r.note ?? ""} />
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
      {canEdit ? (
        <details className="edit">
          <summary>Añadir equivalencia</summary>
          <IdentityForm scopes={scopes} systems={systems} />
        </details>
      ) : null}
    </section>
  );
}

type MilestoneRow = {
  id: string;
  type: (typeof MILESTONE_TYPES)[number];
  date: Date;
  note: string | null;
  isActive: boolean;
  version: number;
  implementation?: { id: string; name: string } | null;
};

export function MilestonesSection({
  rows,
  scopes,
  canEdit,
  scopeLabel,
}: {
  rows: MilestoneRow[];
  scopes: ScopeOption[];
  canEdit: boolean;
  scopeLabel: (r: MilestoneRow) => string;
}) {
  return (
    <section className="card" aria-labelledby="sec-hitos">
      <h2 id="sec-hitos">Hitos</h2>
      <p className="muted">Arranque, migración cloud y cambio mayor de versión. Anotan curvas futuras; no excluyen al cliente de ningún análisis ni modifican su contrato.</p>
      {rows.length === 0 ? (
        <p className="empty">Sin hitos registrados.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Fecha</th><th>Hito</th><th>Ámbito</th><th>Nota</th><th>Estado</th>{canEdit ? <th>Acciones</th> : null}</tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className={m.isActive ? undefined : "inactive-row"}>
                  <td>{formatDate(iso(m.date))}</td>
                  <td>{MILESTONE_LABEL[m.type]}</td>
                  <td>{scopeLabel(m)}</td>
                  <td>{m.note ?? ""}</td>
                  <td><StatusBadge active={m.isActive} /></td>
                  {canEdit ? (
                    <td>
                      <ToggleActive entity="milestone" id={m.id} version={m.version} active={m.isActive} />
                      <details className="edit">
                        <summary>Editar</summary>
                        <ActionForm action={updateMilestoneAction} hidden={{ id: m.id, expectedVersion: m.version }}>
                          <SelectField name="type" label="Tipo" initial={m.type} options={MILESTONE_TYPES.map((t) => ({ value: t, label: MILESTONE_LABEL[t] }))} />
                          <TextField name="date" label="Fecha" type="date" initial={iso(m.date) ?? ""} required />
                          <TextAreaField name="note" label="Nota" initial={m.note ?? ""} />
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
      {canEdit ? (
        <details className="edit">
          <summary>Añadir hito</summary>
          <MilestoneForm scopes={scopes} />
        </details>
      ) : null}
    </section>
  );
}

export const ACTION_LABEL: Record<string, string> = {
  CREATE: "Alta",
  UPDATE: "Cambio",
  DEACTIVATE: "Desactivación",
  REACTIVATE: "Reactivación",
  INITIALIZE: "Inicialización",
  UPLOAD: "Carga",
  CONFIRM: "Confirmación",
  CANCEL: "Cancelación",
  ACTIVATE: "Activación",
  REVERT: "Reversión",
  REPROCESS: "Reproceso",
};
const HIDE = new Set(["id", "createdAt", "updatedAt", "version", "groupId", "clientId", "implementationId", "searchValue"]);

function flat(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (HIDE.has(k) || val === null || typeof val === "object") continue;
    const s = String(val);
    out[k] = /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(s) ? formatDate(s.slice(0, 10)) : s;
  }
  return out;
}

export function HistorySection({
  events,
  total,
  page,
  pageCount,
  base,
}: {
  events: { id: string; at: Date; actorEmail: string; action: string; summary: string; before: unknown; after: unknown }[];
  total: number;
  page: number;
  pageCount: number;
  base: string;
}) {
  return (
    <section className="card" aria-labelledby="sec-historial">
      <h2 id="sec-historial">Historial de cambios</h2>
      {events.length === 0 ? (
        <p className="empty">Sin cambios registrados.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {events.map((e) => {
            const b = flat(e.before);
            const a = flat(e.after);
            const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).filter((k) => b[k] !== a[k]);
            return (
              <li key={e.id} style={{ borderBottom: "1px solid var(--border)", padding: "0.5rem 0" }}>
                <strong>{ACTION_LABEL[e.action] ?? e.action}</strong> · {e.summary}
                <div className="muted">{formatDateTime(e.at)} · {e.actorEmail}</div>
                {keys.length > 0 ? (
                  <details className="edit">
                    <summary>Antes / después</summary>
                    <table className="diff">
                      <thead><tr><th>Campo</th><th>Antes</th><th>Después</th></tr></thead>
                      <tbody>
                        {keys.map((k) => (
                          <tr key={k}><td>{k}</td><td>{b[k] ?? "—"}</td><td>{a[k] ?? "—"}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {pageCount > 1 ? (
        <nav className="pager" aria-label="Paginación del historial">
          <span>{total} eventos</span>
          {page > 1 ? <a className="btn btn-secondary btn-sm" href={`${base}&hp=${page - 1}#sec-historial`}>← Más recientes</a> : null}
          <span>Página {page} de {pageCount}</span>
          {page < pageCount ? <a className="btn btn-secondary btn-sm" href={`${base}&hp=${page + 1}#sec-historial`}>Anteriores →</a> : null}
        </nav>
      ) : null}
    </section>
  );
}
