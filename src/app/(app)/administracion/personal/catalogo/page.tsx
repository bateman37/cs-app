import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { listCatalog } from "@/server/personal";
import { CATALOG_KINDS, CATALOG_KIND_LABEL } from "@/domain/personal";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/form-kit";
import { StatusBadge } from "@/components/list";
import { createCatalogItemAction } from "../actions";
import { ToggleActive } from "../toggle-active";

export const metadata: Metadata = { title: "Catálogo de personal" };

export default async function CatalogoPage() {
  const user = await requirePageUser();
  const items = await listCatalog(user.id);
  const isAdmin = user.role === "ADMIN";
  return (
    <>
      <p><Link href="/administracion/personal">← Volver a Personal</Link></p>
      <h1>Catálogo de nivel, equipo y rol PMO</h1>
      <p className="muted">
        Valores que se pueden asignar a una persona. Los roles PMO iniciales conocidos son ANA y DEV; los niveles y equipos no se
        inventan: los define el administrador según las fuentes. Desactivar un valor impide nuevas asignaciones y conserva las existentes.
      </p>
      {isAdmin ? (
        <div className="card">
          <ActionForm action={createCatalogItemAction}>
            <SelectField name="kind" label="Catálogo" required options={CATALOG_KINDS.map((k) => ({ value: k, label: CATALOG_KIND_LABEL[k] }))} />
            <TextField name="name" label="Nuevo valor" required maxLength={100} />
            <div className="form-actions"><SubmitButton>Añadir al catálogo</SubmitButton></div>
          </ActionForm>
        </div>
      ) : null}
      {CATALOG_KINDS.map((kind) => {
        const list = items.filter((i) => i.kind === kind);
        return (
          <section key={kind} className="card" aria-labelledby={`cat-${kind}`}>
            <h2 id={`cat-${kind}`}>{CATALOG_KIND_LABEL[kind]}</h2>
            {list.length === 0 ? (
              <p className="empty">Catálogo vacío.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Valor</th><th>Asignaciones</th><th>Estado</th>{isAdmin ? <th>Acciones</th> : null}</tr></thead>
                  <tbody>
                    {list.map((i) => (
                      <tr key={i.id} className={i.isActive ? undefined : "inactive-row"}>
                        <td>{i.name}</td>
                        <td>{i._count.terms}</td>
                        <td><StatusBadge active={i.isActive} /></td>
                        {isAdmin ? <td><ToggleActive entity="catalog" id={i.id} version={i.version} active={i.isActive} /></td> : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
