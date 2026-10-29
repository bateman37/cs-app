import type { Metadata } from "next";
import Link from "next/link";
import { requirePageAdmin } from "@/lib/session";
import { listAssignableGroups } from "@/server/groups";
import { first, type SearchParams } from "@/lib/format";
import { ActionForm, CheckboxField, SelectField, SubmitButton, TextField } from "@/components/form-kit";
import { createClientAction } from "../../actions";

export const metadata: Metadata = { title: "Nuevo cliente" };

export default async function NuevoCliente({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAdmin();
  const sp = await searchParams;
  const groups = (await listAssignableGroups(user.id)).filter((g) => g.isActive);
  return (
    <>
      <h1>Nuevo Cliente</h1>
      <div className="card">
        <ActionForm action={createClientAction}>
          <TextField name="name" label="Nombre" required maxLength={200} help="Nombre de la organización (organización Zendesk)." />
          <SelectField
            name="groupId"
            label="Grupo Cliente"
            initial={first(sp.groupId)}
            placeholder="Sin grupo asignado"
            options={groups.map((g) => ({ value: g.id, label: g.name }))}
            help="Si todavía no se conoce el grupo BC, déjelo sin asignar; no se crea un grupo ficticio."
          />
          <CheckboxField name="isInternal" label="Organización interna" help="Marque solo VINCLE, VINCLE BUGS, VINCLE INFRAESTRUCTURAS u organizaciones de pruebas." />
          <div className="form-actions">
            <SubmitButton>Crear cliente</SubmitButton>
            <Link href="/administracion/clientes/clientes">Cancelar</Link>
          </div>
        </ActionForm>
        <p className="muted">El ID de organización Zendesk y las demás equivalencias se añaden en la ficha. Si aún no se conoce, el Cliente queda con la equivalencia pendiente.</p>
      </div>
    </>
  );
}
