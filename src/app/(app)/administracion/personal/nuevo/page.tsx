import type { Metadata } from "next";
import Link from "next/link";
import { requirePageAdmin } from "@/lib/session";
import { ActionForm, SubmitButton, TextAreaField, TextField } from "@/components/form-kit";
import { createPersonAction } from "../actions";

export const metadata: Metadata = { title: "Nueva persona" };

export default async function NuevaPersonaPage() {
  await requirePageAdmin();
  return (
    <>
      <p><Link href="/administracion/personal">← Volver a Personal</Link></p>
      <h1>Nueva persona</h1>
      <p className="muted">Se crea solo la identidad. Después podrá añadir alias por sistema, nivel, equipo, PMO y rol, cada uno con su vigencia.</p>
      <div className="card">
        <ActionForm action={createPersonAction}>
          <TextField name="name" label="Nombre canónico" required maxLength={200} help="Estable: no depende del nombre que use cada sistema." />
          <TextAreaField name="note" label="Nota" />
          <div className="form-actions"><SubmitButton>Crear persona</SubmitButton></div>
        </ActionForm>
      </div>
    </>
  );
}
