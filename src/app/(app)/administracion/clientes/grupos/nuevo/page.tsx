import type { Metadata } from "next";
import Link from "next/link";
import { requirePageAdmin } from "@/lib/session";
import { ActionForm, SubmitButton, TextField } from "@/components/form-kit";
import { createGroupAction } from "../../actions";

export const metadata: Metadata = { title: "Nuevo grupo" };

export default async function NuevoGrupo() {
  await requirePageAdmin();
  return (
    <>
      <h1>Nuevo Grupo Cliente</h1>
      <div className="card">
        <ActionForm action={createGroupAction}>
          <TextField name="name" label="Nombre canónico" required maxLength={200} help="Nombre con el que se identifica el grupo en CS App." />
          <TextField name="bcDenomination" label="Denominación BC" maxLength={200} help="Opcional. Las claves o alias adicionales de BC se añaden como equivalencias en la ficha." />
          <div className="form-actions">
            <SubmitButton>Crear grupo</SubmitButton>
            <Link href="/administracion/clientes/grupos">Cancelar</Link>
          </div>
        </ActionForm>
      </div>
    </>
  );
}
