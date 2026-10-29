"use client";

import { useState } from "react";
import { ActionForm, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form-kit";
import { KIND_LABEL, SYSTEMS, SYSTEM_LABEL, SYSTEM_RULES, type System } from "@/domain/catalogs";
import { createIdentityAction } from "../actions";

export type ScopeOption = { value: string; label: string; type: "group" | "client" | "implementation" };

/** Alta de equivalencia: los tipos y destinos se acotan según el sistema elegido. */
export function IdentityForm({ scopes, systems = SYSTEMS }: { scopes: ScopeOption[]; systems?: readonly System[] }) {
  const [system, setSystem] = useState<System>(systems[0]);
  const rules = SYSTEM_RULES[system];
  const scopeOptions = scopes.filter((s) => rules.targets.includes(s.type));
  return (
    <ActionForm action={createIdentityAction}>
      <div className="field">
        <label htmlFor="id-system">Sistema</label>
        <select id="id-system" name="system" value={system} onChange={(e) => setSystem(e.target.value as System)}>
          {systems.map((s) => <option key={s} value={s}>{SYSTEM_LABEL[s]}</option>)}
        </select>
      </div>
      <SelectField key={`k-${system}`} name="kind" label="Tipo de identidad" required options={rules.kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
      <TextField name="rawValue" label="Valor original" required maxLength={300} help={system === "ZENDESK" ? "ID: solo dígitos. Nombre: tal como aparece en Zendesk." : "Tal como aparece en el origen; no se quitan acentos ni signos."} />
      <SelectField key={`s-${system}`} name="scope" label="Asignar a" required options={scopeOptions.map((s) => ({ value: s.value, label: s.label }))} />
      <TextField name="validFrom" label="Vigente desde" type="date" help="Vacío = fecha de inicio desconocida." />
      <TextField name="validTo" label="Vigente hasta (excl.)" type="date" help="Primer día en que ya no aplica. Vacío = sin fin." />
      <TextAreaField name="note" label="Nota" />
      <div className="form-actions"><SubmitButton>Añadir equivalencia</SubmitButton></div>
    </ActionForm>
  );
}
