import type { Metadata } from "next";
import { requirePageUser } from "@/lib/session";
import { listProducts } from "@/server/products";
import { ActionForm, SubmitButton, TextField } from "@/components/form-kit";
import { StatusBadge } from "@/components/list";
import { createProductAction } from "../actions";
import { ToggleActive } from "../toggle-active";

export const metadata: Metadata = { title: "Catálogo de productos" };

export default async function ProductosPage() {
  const user = await requirePageUser();
  const products = await listProducts(user.id);
  return (
    <>
      <h1>Catálogo de productos</h1>
      <p className="muted">Lista explícita de productos que se pueden asignar a un grupo, cliente o implantación. Es un dato independiente de la complejidad.</p>
      {user.role === "ADMIN" ? (
        <div className="card">
          <ActionForm action={createProductAction}>
            <TextField name="name" label="Nuevo producto" required maxLength={100} />
            <div className="form-actions"><SubmitButton>Añadir al catálogo</SubmitButton></div>
          </ActionForm>
        </div>
      ) : null}
      {products.length === 0 ? (
        <div className="empty">El catálogo está vacío. Añada los productos antes de asignarlos.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Producto</th><th>Estado</th>{user.role === "ADMIN" ? <th>Acciones</th> : null}</tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className={p.isActive ? undefined : "inactive-row"}>
                  <td>{p.name}</td>
                  <td><StatusBadge active={p.isActive} /></td>
                  {user.role === "ADMIN" ? <td><ToggleActive entity="product" id={p.id} version={p.version} active={p.isActive} /></td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
