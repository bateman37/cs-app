import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { KIND_LABEL, KINDS, listServiceAssignments, previewServiceAssignmentImpact, searchEntornoValues, type AssignmentKind } from "@/server/economics/service-assignments";
import { CATEGORY_LABEL, FINANCE_CATEGORIES, type FinanceCategory } from "@/domain/finance";
import { describeInterval, fromDbDate } from "@/domain/vigencia";
import { first, type SearchParams } from "@/lib/format";
import { Pager } from "@/components/list";
import { ActionForm, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form-kit";
import { createServiceAssignmentAction, toggleServiceAssignmentAction, updateServiceAssignmentAction } from "./actions";

export const metadata: Metadata = { title: "Servicio económico" };
const BASE = "/administracion/servicios";

export default async function ServiciosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const q = first(sp.q);
  const kind = KINDS.includes(first(sp.tipo) as AssignmentKind) ? first(sp.tipo) : "";
  const status = first(sp.estado) === "inactive" ? "inactive" : first(sp.estado) === "all" ? "all" : "active";
  const page = Number(first(sp.page)) || 1;
  const list = await listServiceAssignments(user.id, { q, kind, status, page });
  const isAdmin = user.role === "ADMIN";
  const values = q ? await searchEntornoValues(user.id, q) : [];
  // Revisión de impacto de lo escrito en el formulario de alta (GET, sin guardar).
  const pv = first(sp.pv_valor);
  const impact = pv && KINDS.includes(first(sp.pv_tipo) as AssignmentKind) && FINANCE_CATEGORIES.includes(first(sp.pv_servicio) as FinanceCategory)
    ? await previewServiceAssignmentImpact(user.id, { matchKind: first(sp.pv_tipo), matchValue: pv, service: first(sp.pv_servicio), validFrom: first(sp.pv_desde), validTo: first(sp.pv_hasta) }).catch(() => null)
    : null;
  return (
    <>
      <h1>Servicio económico de las horas</h1>
      <p className="muted">
        Una categoría financiera no clasifica por sí sola el tiempo. Aquí se asigna el servicio (Soporte, Administración delegada u Otros) por el valor <strong>exacto</strong>{" "}
        de «Entorno y Tipología» de los tickets o por proyecto de Wrike, con vigencia. La administración delegada de los tickets ya identificada se reutiliza; «no es
        administración delegada» no prueba Soporte. Dos evidencias incompatibles dejan la actividad en conflicto. «Otro soporte» de Pulse Rent no es Otros financiero.
      </p>
      <section className="card" aria-labelledby="sec-buscar">
        <h2 id="sec-buscar">Asignaciones</h2>
        <form className="toolbar" action={BASE} method="get">
          <div className="field"><label htmlFor="q">Buscar valor</label><input id="q" name="q" defaultValue={q} /></div>
          <div className="field"><label htmlFor="tipo">Tipo</label>
            <select id="tipo" name="tipo" defaultValue={kind}><option value="">Todos</option>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></div>
          <div className="field"><label htmlFor="estado">Estado</label>
            <select id="estado" name="estado" defaultValue={status}><option value="active">Activas</option><option value="inactive">Inactivas</option><option value="all">Todas</option></select></div>
          <button className="btn btn-primary" type="submit">Buscar</button>
        </form>
        {values.length > 0 ? (
          <p className="muted">Valores de «Entorno y Tipología» que contienen «{q}»: {values.map((v) => `${v.value} (${v.tickets} tickets)`).join("; ")}.</p>
        ) : null}
        {list.rows.length === 0 ? <div className="empty">No hay asignaciones con ese filtro. No se han creado asignaciones por defecto.</div> : (
          <div className="table-wrap">
            <table>
              <caption className="skip">Asignaciones de servicio</caption>
              <thead><tr><th>Tipo</th><th>Valor</th><th>Servicio</th><th>Vigencia</th><th>Estado</th>{isAdmin ? <th>Acciones</th> : null}</tr></thead>
              <tbody>
                {list.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{KIND_LABEL[r.matchKind as AssignmentKind]}</td><td>{r.matchValue}</td><td>{CATEGORY_LABEL[r.service as FinanceCategory]}</td>
                    <td>{describeInterval({ from: fromDbDate(r.validFrom), to: fromDbDate(r.validTo) })}</td>
                    <td><span className={r.isActive ? "badge badge-ok" : "badge badge-off"}>{r.isActive ? "Activa" : "Inactiva"}</span></td>
                    {isAdmin ? (
                      <td>
                        <ActionForm action={toggleServiceAssignmentAction} className="inline-form" hidden={{ id: r.id, active: String(!r.isActive), expectedVersion: r.version }}>
                          <SubmitButton variant="secondary">{r.isActive ? "Desactivar" : "Reactivar"}</SubmitButton>
                        </ActionForm>
                        <details className="edit">
                          <summary>Editar</summary>
                          <ActionForm action={updateServiceAssignmentAction} hidden={{ id: r.id, expectedVersion: r.version }}>
                            <TextField name="matchValue" label="Valor" initial={r.matchValue} required />
                            <SelectField name="service" label="Servicio" initial={r.service} options={FINANCE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
                            <TextField name="validFrom" label="Vigente desde" type="date" initial={fromDbDate(r.validFrom) ?? ""} />
                            <TextField name="validTo" label="Vigente hasta (excl.)" type="date" initial={fromDbDate(r.validTo) ?? ""} />
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
        <Pager base={BASE} params={{ q, tipo: kind, estado: status }} page={list.page} pageCount={list.pageCount} total={list.total} />
      </section>
      <section className="card" aria-labelledby="sec-impacto">
        <h2 id="sec-impacto">Revisar el impacto antes de asignar</h2>
        <form className="toolbar" action={BASE} method="get">
          <div className="field"><label htmlFor="pv_tipo">Tipo</label><select id="pv_tipo" name="pv_tipo" defaultValue={first(sp.pv_tipo) || "ENTORNO"}>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></div>
          <div className="field"><label htmlFor="pv_valor">Valor exacto</label><input id="pv_valor" name="pv_valor" defaultValue={pv} /></div>
          <div className="field"><label htmlFor="pv_servicio">Servicio</label><select id="pv_servicio" name="pv_servicio" defaultValue={first(sp.pv_servicio) || "SOPORTE"}>{FINANCE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></div>
          <div className="field"><label htmlFor="pv_desde">Desde</label><input id="pv_desde" name="pv_desde" type="date" defaultValue={first(sp.pv_desde)} /></div>
          <div className="field"><label htmlFor="pv_hasta">Hasta (excl.)</label><input id="pv_hasta" name="pv_hasta" type="date" defaultValue={first(sp.pv_hasta)} /></div>
          <button className="btn btn-secondary" type="submit">Ver impacto</button>
        </form>
        {impact ? (
          <p role="status">
            Clasificaría <strong>{impact.activities.toLocaleString("es-ES")}</strong> actividades ({impact.hours} h) de {impact.groups} grupo(s) en ese periodo
            {impact.conflictingWithAdminDelegada > 0 ? `; ${impact.conflictingWithAdminDelegada} ya están identificadas como administración delegada y quedarían en conflicto` : ""}.
          </p>
        ) : null}
        {isAdmin ? (
          <details className="edit" open={Boolean(pv)}>
            <summary>Añadir asignación</summary>
            <ActionForm action={createServiceAssignmentAction}>
              <SelectField name="matchKind" label="Tipo" required initial={first(sp.pv_tipo) || "ENTORNO"} options={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
              <TextField name="matchValue" label="Valor exacto" initial={pv} required help="Entorno y Tipología: el texto exacto del ticket. Wrike: el nombre del proyecto." />
              <SelectField name="service" label="Servicio" required initial={first(sp.pv_servicio) || "SOPORTE"} options={FINANCE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
              <TextField name="validFrom" label="Vigente desde" type="date" initial={first(sp.pv_desde)} />
              <TextField name="validTo" label="Vigente hasta (excl.)" type="date" initial={first(sp.pv_hasta)} />
              <TextAreaField name="note" label="Nota" />
              <div className="form-actions"><SubmitButton>Añadir asignación</SubmitButton></div>
            </ActionForm>
          </details>
        ) : <p className="muted">Su perfil es de consulta: puede revisar las asignaciones, no modificarlas.</p>}
        <p className="muted"><Link href="/administracion/economia">Ir a la comprobación económica</Link></p>
      </section>
    </>
  );
}
