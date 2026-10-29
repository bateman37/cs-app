import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/session";
import { getClient } from "@/server/clients";
import { listAssignableGroups } from "@/server/groups";
import { listProducts } from "@/server/products";
import { listHistory } from "@/server/history";
import { first, sanitizeBack, type SearchParams } from "@/lib/format";
import { isIsoDate, todayMadrid } from "@/domain/vigencia";
import { ActionForm, CheckboxField, SelectField, SubmitButton, TextField } from "@/components/form-kit";
import { StatusBadge } from "@/components/list";
import { createImplementationAction, updateClientAction, updateImplementationAction } from "../../actions";
import { ToggleActive } from "../../toggle-active";
import { HistorySection, IdentitiesSection, MilestonesSection, SituationAt, TermsSection } from "../../_sections/sections";

export const metadata: Metadata = { title: "Cliente" };

export default async function ClientePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const sp = await searchParams;
  const client = await getClient(user.id, id);
  if (!client) notFound();
  const isAdmin = user.role === "ADMIN";
  const volver = first(sp.volver);
  const back = sanitizeBack(volver, ["q", "status", "groupId", "internal", "pending", "sort", "dir", "page"]);
  const backHref = `/administracion/clientes/clientes${back ? `?${back}` : ""}`;
  const fecha = isIsoDate(first(sp.fecha)) ? first(sp.fecha) : todayMadrid();
  const hp = Math.max(Number(first(sp.hp)) || 1, 1);
  const [groups, products, history] = await Promise.all([
    listAssignableGroups(user.id, client.groupId),
    listProducts(user.id),
    isAdmin ? listHistory(user.id, { clientId: id }, { page: hp }) : null,
  ]);
  const canEdit = isAdmin && client.isActive;
  const scopes = [
    { value: `client:${id}`, label: `Cliente: ${client.name}`, type: "client" as const },
    ...client.implementations.filter((i) => i.isActive).map((i) => ({ value: `implementation:${i.id}`, label: `Implantación: ${i.name}`, type: "implementation" as const })),
  ];
  const implLabel = (r: { implementation?: { name: string } | null }) => (r.implementation ? `Implantación: ${r.implementation.name}` : "Cliente");
  const pendingZendesk = !client.identities.some((i) => i.system === "ZENDESK" && i.kind === "ORG_ID" && i.isActive);
  const termsOwn = client.terms.filter((t) => t.clientId === id);
  const baseQs = `?${new URLSearchParams({ ...(volver ? { volver } : {}), ...(sp.fecha ? { fecha } : {}) }).toString()}`;
  return (
    <>
      <p><Link href={backHref}>← Volver a la lista de clientes</Link></p>
      <h1>{client.name} <StatusBadge active={client.isActive} /> {client.isInternal ? <span className="badge badge-int">Organización interna</span> : null}</h1>
      {first(sp.creado) ? <p className="notice notice-ok" role="status">Cliente creado. Añada ahora sus equivalencias y datos de servicio.</p> : null}
      {!client.isActive ? <p className="notice notice-info">Cliente inactivo: se conserva con sus relaciones e historial, pero no admite nuevas asignaciones hasta reactivarlo.</p> : null}

      <section className="card" aria-labelledby="sec-datos">
        <h2 id="sec-datos">Datos del Cliente</h2>
        {isAdmin ? (
          <ActionForm action={updateClientAction} hidden={{ id: client.id, expectedVersion: client.version }}>
            <TextField name="name" label="Nombre" initial={client.name} required maxLength={200} />
            <SelectField
              name="groupId"
              label="Grupo Cliente"
              initial={client.groupId ?? ""}
              placeholder="Sin grupo asignado"
              options={groups.map((g) => ({ value: g.id, label: g.name + (g.isActive ? "" : " (inactivo)") }))}
            />
            <CheckboxField name="isInternal" label="Organización interna" initial={client.isInternal} />
            <div className="form-actions"><SubmitButton>Guardar cambios</SubmitButton></div>
          </ActionForm>
        ) : (
          <dl className="kv">
            <dt>Grupo</dt><dd>{client.group?.name ?? "No asignado"}</dd>
            <dt>Organización interna</dt><dd>{client.isInternal ? "Sí" : "No"}</dd>
          </dl>
        )}
        {client.group ? <p className="muted">Grupo: <Link href={`/administracion/clientes/grupos/${client.group.id}`}>{client.group.name}</Link></p> : <p className="muted">Grupo no asignado: no se ha fabricado ningún grupo BC.</p>}
        {isAdmin ? <div className="row-actions"><ToggleActive entity="client" id={client.id} version={client.version} active={client.isActive} /></div> : null}
      </section>

      <section className="card" aria-labelledby="sec-situacion">
        <h2 id="sec-situacion">Situación a una fecha</h2>
        <form className="toolbar" method="get" action={`/administracion/clientes/clientes/${id}`}>
          {volver ? <input type="hidden" name="volver" value={volver} /> : null}
          <div className="field"><label htmlFor="fecha">Fecha</label><input id="fecha" type="date" name="fecha" defaultValue={fecha} /></div>
          <button className="btn btn-secondary" type="submit">Consultar</button>
        </form>
        <div className="grid-2">
          <SituationAt title="Datos propios del Cliente" rows={termsOwn} date={fecha} />
          {client.group ? <SituationAt title={`Datos del grupo «${client.group.name}» (no heredados)`} rows={client.groupTerms} date={fecha} /> : null}
        </div>
      </section>

      <TermsSection rows={client.terms} scopes={scopes} products={products.filter((p) => p.isActive).map((p) => p.name)} canEdit={canEdit} scopeLabel={implLabel} />
      <IdentitiesSection rows={client.identities} scopes={scopes} canEdit={canEdit} scopeLabel={implLabel} systems={["ZENDESK", "WRIKE", "PAP"]} pendingZendesk={pendingZendesk} />

      <section className="card" aria-labelledby="sec-impl">
        <h2 id="sec-impl">Implantaciones identificadas</h2>
        <p className="muted">Solo si existe una identificación real de proyecto o implantación. No se crean para rellenar la pantalla.</p>
        {client.implementations.length === 0 ? (
          <p className="empty">Sin implantaciones identificadas.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nombre</th><th>Clave</th><th>Estado</th>{isAdmin ? <th>Acciones</th> : null}</tr></thead>
              <tbody>
                {client.implementations.map((i) => (
                  <tr key={i.id} className={i.isActive ? undefined : "inactive-row"}>
                    <td>{i.name}</td>
                    <td>{i.key ?? <span className="muted">—</span>}</td>
                    <td><StatusBadge active={i.isActive} /></td>
                    {isAdmin ? (
                      <td>
                        <ToggleActive entity="implementation" id={i.id} version={i.version} active={i.isActive} />
                        <details className="edit">
                          <summary>Editar</summary>
                          <ActionForm action={updateImplementationAction} hidden={{ id: i.id, expectedVersion: i.version }}>
                            <TextField name="name" label="Nombre" initial={i.name} required />
                            <TextField name="key" label="Clave" initial={i.key ?? ""} />
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
            <summary>Añadir implantación</summary>
            <ActionForm action={createImplementationAction} hidden={{ clientId: client.id }}>
              <TextField name="name" label="Nombre" required />
              <TextField name="key" label="Clave" help="Identificador real de proyecto o implantación, si existe." />
              <div className="form-actions"><SubmitButton>Añadir implantación</SubmitButton></div>
            </ActionForm>
          </details>
        ) : null}
      </section>

      <MilestonesSection rows={client.milestones} scopes={scopes} canEdit={canEdit} scopeLabel={implLabel} />
      {history ? <HistorySection events={history.rows} total={history.total} page={history.page} pageCount={history.pageCount} base={`/administracion/clientes/clientes/${id}${baseQs}`} /> : null}
    </>
  );
}
