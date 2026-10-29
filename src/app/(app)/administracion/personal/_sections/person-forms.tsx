"use client";

import { useState } from "react";
import { ActionForm, CheckboxField, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form-kit";
import {
  ALIAS_KIND_LABEL,
  ALIAS_RULES,
  PERSON_ATTRIBUTES,
  PERSON_ATTRIBUTE_LABEL,
  PERSON_SYSTEMS,
  PERSON_SYSTEM_LABEL,
  type PersonAttribute,
  type PersonSystem,
} from "@/domain/personal";
import { addAliasAction, addTermPeriodAction, changeTermAction } from "../actions";

export type CatalogOptions = Record<"LEVEL" | "TEAM" | "PMO_ROLE", { value: string; label: string }[]>;

/** Alta de alias: los tipos se acotan según el sistema elegido. */
export function AliasForm({ personId }: { personId: string }) {
  const [system, setSystem] = useState<PersonSystem>("PAP");
  return (
    <ActionForm action={addAliasAction} hidden={{ personId }}>
      <div className="field">
        <label htmlFor="al-system">Sistema</label>
        <select id="al-system" name="system" value={system} onChange={(e) => setSystem(e.target.value as PersonSystem)}>
          {PERSON_SYSTEMS.map((s) => <option key={s} value={s}>{PERSON_SYSTEM_LABEL[s]}</option>)}
        </select>
      </div>
      <SelectField key={`k-${system}`} name="kind" label="Tipo" required options={ALIAS_RULES[system].map((k) => ({ value: k, label: ALIAS_KIND_LABEL[k] }))} />
      <TextField name="rawValue" label="Valor original" required maxLength={300} help={system === "ZENDESK" ? "ID: solo dígitos. Nombre: tal como aparece en Zendesk." : "Tal como aparece en el origen; no se quitan acentos ni signos."} />
      <TextField name="validFrom" label="Vigente desde" type="date" help="Vacío = fecha de inicio desconocida." />
      <TextField name="validTo" label="Vigente hasta (excl.)" type="date" help="Primer día en que ya no aplica. Vacío = sin fin." />
      <TextAreaField name="note" label="Nota" />
      <div className="form-actions"><SubmitButton>Añadir alias</SubmitButton></div>
    </ActionForm>
  );
}

/** Cambio con fecha efectiva (o primer registro con inicio desconocido) y alta de tramo histórico. */
export function TermForm({ mode, personId, catalog }: { mode: "change" | "period"; personId: string; catalog: CatalogOptions }) {
  const [attribute, setAttribute] = useState<PersonAttribute>("TEAM");
  const options = attribute === "PMO_MEMBER" ? [{ value: "true", label: "Sí" }, { value: "false", label: "No" }] : catalog[attribute];
  return (
    <ActionForm action={mode === "change" ? changeTermAction : addTermPeriodAction} hidden={{ personId }}>
      <div className="field">
        <label htmlFor={`pt-attr-${mode}`}>Dato</label>
        <select id={`pt-attr-${mode}`} name="attribute" value={attribute} onChange={(e) => setAttribute(e.target.value as PersonAttribute)}>
          {PERSON_ATTRIBUTES.map((a) => <option key={a} value={a}>{PERSON_ATTRIBUTE_LABEL[a]}</option>)}
        </select>
      </div>
      <SelectField
        key={`v-${attribute}`}
        name="value"
        label="Valor"
        required
        options={options}
        placeholder={attribute === "PMO_MEMBER" ? undefined : "Seleccione…"}
        help={
          attribute === "PMO_ROLE"
            ? "Solo si pertenece a PMO en la fecha de inicio. No se asigna ningún rol por defecto."
            : options.length === 0
              ? "El catálogo está vacío: añada valores en el catálogo primero."
              : undefined
        }
      />
      {mode === "change" ? (
        <>
          <TextField name="effectiveFrom" label="Fecha efectiva" type="date" help="El valor anterior se conserva hasta esta fecha." />
          <CheckboxField name="unknownStart" label="Situación inicial con fecha de inicio desconocida" help="Solo para el primer registro de un dato; quedará señalada para revisión." />
        </>
      ) : (
        <>
          <TextField name="validFrom" label="Desde" type="date" help="Vacío = inicio desconocido." />
          <TextField name="validTo" label="Hasta (excl.)" type="date" help="Primer día en que ya no aplica. Vacío = sin fin." />
        </>
      )}
      <TextAreaField name="note" label="Nota" />
      <div className="form-actions"><SubmitButton>{mode === "change" ? "Guardar cambio" : "Añadir tramo"}</SubmitButton></div>
    </ActionForm>
  );
}
