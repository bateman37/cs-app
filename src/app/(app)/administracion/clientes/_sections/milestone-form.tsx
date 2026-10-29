"use client";

import { ActionForm, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form-kit";
import { MILESTONE_LABEL, MILESTONE_TYPES } from "@/domain/catalogs";
import { createMilestoneAction } from "../actions";
import type { ScopeOption } from "./identity-form";

export function MilestoneForm({ scopes }: { scopes: ScopeOption[] }) {
  return (
    <ActionForm action={createMilestoneAction}>
      <SelectField name="type" label="Tipo de hito" required options={MILESTONE_TYPES.map((t) => ({ value: t, label: MILESTONE_LABEL[t] }))} />
      <TextField name="date" label="Fecha" type="date" required />
      <SelectField name="scope" label="Ámbito" required options={scopes.map((s) => ({ value: s.value, label: s.label }))} />
      <TextAreaField name="note" label="Nota" />
      <div className="form-actions"><SubmitButton>Añadir hito</SubmitButton></div>
    </ActionForm>
  );
}
