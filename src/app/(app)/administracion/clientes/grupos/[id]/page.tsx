import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/session";
import { getGroup } from "@/server/groups";
import { listProducts } from "@/server/products";
import { listHistory } from "@/server/history";
import { first, sanitizeBack, type SearchParams } from "@/lib/format";
import { todayMadrid, isIsoDate } from "@/domain/vigencia";
import { ActionForm, SubmitButton, TextField } from "@/components/form-kit";
import { StatusBadge } from "@/components/list";
import { updateGroupAction } from "../../actions";
import { ToggleActive } from "../../toggle-active";
import { HistorySection, IdentitiesSection, MilestonesSection, SituationAt, TermsSection } from "../../_sections/sections";

export const metadata: Metadata = { title: "Grupo Cliente" };

export default async function GrupoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const sp = await searchParams;
  const group = await getGroup(user.id, id);
  if (!group) notFound();
  const isAdmin = user.role === "ADMIN";
  const volver = first(sp.volver);
  const back = sanitizeBack(volver, ["q", "status", "sort", "dir", "page"]);
  const backHref = `/administracion/clientes/grupos${back ? `?${back}` : ""}`;
  const fecha = isIsoDate(first(sp.fecha)) ? first(sp.fecha) : todayMadrid();
  const hp = Math.max(Number(first(sp.hp)) || 1, 1);
  const [products, history] = await Promise.all([
    listProducts(user.id),
    isAdmin ? listHistory(user.id, { groupId: id }, { page: hp }) : null,
  ]);
  const scopes = [{ value: `group:${id}`, label: `Grupo: ${group.name}`, type: "group" as const }];
  const baseQs = `?${new URLSearchParams({ ...(volver ? { volver } : {}), ...(sp.fecha ? { fecha } : {}) }).toString()}`;
  return (
    <>
      <p><Link href={backHref}>← Volver a la lista de grupos</Link></p>
      <h1>{group.name} {" "}<StatusBadge active={group.isActive} /></h1>
      {first(sp.creado) ? <p className="notice notice-ok" role="status">Grupo creado. Añada ahora sus Clientes y equivalencias.</p> : null}
      {!group.isActive ? <p className="notice notice-info">Grupo inactivo: se conserva con sus relaciones e historial, pero no se ofrece para nuevas asignaciones.</p> : null}

      <section className="card" aria-labelledby="sec-datos">
        <h2 id="sec-datos">Datos del grupo</h2>
        {isAdmin ? (
          <ActionForm action={updateGroupAction} hidden={{ id: group.id, expectedVersion: group.version }}>
            <TextField name="name" label="Nombre canónico" initial={group.name} required maxLength={200} />
            <TextField name="bcDenomination" label="Denominación BC" initial={group.bcDenomination ?? ""} maxLength={200} />
            <div className="form-actions">
              <SubmitButton>Guardar cambios</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <dl className="kv"><dt>Nombre</dt><dd>{group.name}</dd><dt>Denominación BC</dt><dd>{group.bcDenomination ?? "—"}</dd></dl>
        )}
        {isAdmin ? <div className="row-actions" style={{ marginTop: "0.5rem" }}><ToggleActive entity="group" id={group.id} version={group.version} active={group.isActive} /></div> : null}
      </section>

      <section className="card" aria-labelledby="sec-clientes">
        <h2 id="sec-clientes">Clientes del grupo ({group.clients.length})</h2>
        {group.clients.length === 0 ? (
          <p className="empty">Este grupo aún no tiene Clientes.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Cliente</th><th>Implantaciones</th><th>Tipo</th><th>Estado</th></tr></thead>
              <tbody>
                {group.clients.map((c) => (
                  <tr key={c.id} className={c.isActive ? undefined : "inactive-row"}>
                    <td><Link href={`/administracion/clientes/clientes/${c.id}`}>{c.name}</Link></td>
                    <td>{c._count.implementations}</td>
                    <td>{c.isInternal ? <span className="badge badge-int">Interna</span> : "Cliente"}</td>
                    <td><StatusBadge active={c.isActive} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {isAdmin && group.isActive ? <p><Link className="btn btn-primary" href={`/administracion/clientes/clientes/nuevo?groupId=${group.id}`}>Añadir cliente a este grupo</Link></p> : null}
      </section>

      <section className="card" aria-labelledby="sec-situacion">
        <h2 id="sec-situacion">Situación del grupo a una fecha</h2>
        <form className="toolbar" method="get" action={`/administracion/clientes/grupos/${id}`}>
          {volver ? <input type="hidden" name="volver" value={volver} /> : null}
          <div className="field"><label htmlFor="fecha">Fecha</label><input id="fecha" type="date" name="fecha" defaultValue={fecha} /></div>
          <button className="btn btn-secondary" type="submit">Consultar</button>
        </form>
        <SituationAt title="Datos propios del grupo" rows={group.terms} date={fecha} />
        <p className="muted">Los datos del grupo no se copian a sus Clientes: cada Cliente mantiene los suyos.</p>
      </section>

      <TermsSection rows={group.terms} scopes={scopes} products={products.filter((p) => p.isActive).map((p) => p.name)} canEdit={isAdmin && group.isActive} scopeLabel={() => "Grupo"} />
      <IdentitiesSection rows={group.identities} scopes={scopes} canEdit={isAdmin && group.isActive} scopeLabel={() => "Grupo"} systems={["BC"]} />
      <MilestonesSection rows={group.milestones} scopes={scopes} canEdit={isAdmin && group.isActive} scopeLabel={() => "Grupo"} />
      {history ? <HistorySection events={history.rows} total={history.total} page={history.page} pageCount={history.pageCount} base={`/administracion/clientes/grupos/${id}${baseQs}`} /> : null}
    </>
  );
}
