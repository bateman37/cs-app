"use client";

import { useState } from "react";
import { ActionForm, CheckboxField, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form-kit";
import { ATTRIBUTES, ATTRIBUTE_LABEL, valueOptions, type Attribute } from "@/domain/catalogs";
import { addTermPeriodAction, changeTermAction } from "../actions";
import type { ScopeOption } from "./identity-form";

/** Cambio con fecha efectiva (o primer registro con inicio desconocido) y alta de tramo histórico. */
export function TermForm({ mode, scopes, products }: { mode: "change" | "period"; scopes: ScopeOption[]; products: string[] }) {
  const [attribute, setAttribute] = useState<Attribute>("SUPPORT");
  return (
    <ActionForm action={mode === "change" ? changeTermAction : addTermPeriodAction}>
      <div className="field">
        <label htmlFor={`t-attr-${mode}`}>Dato</label>
        <select id={`t-attr-${mode}`} name="attribute" value={attribute} onChange={(e) => setAttribute(e.target.value as Attribute)}>
          {ATTRIBUTES.map((a) => <option key={a} value={a}>{ATTRIBUTE_LABEL[a]}</option>)}
        </select>
      </div>
      <SelectField
        key={`v-${attribute}`}
        name="value"
        label="Valor"
        required
        options={valueOptions(attribute, products)}
        help={attribute === "PRODUCT" && products.length === 0 ? "El catálogo de productos está vacío: añada productos primero." : undefined}
      />
      <SelectField name="scope" label="Ámbito" required options={scopes.map((s) => ({ value: s.value, label: s.label }))} help="El dato se guarda en este ámbito; no se copia a otros." />
      {mode === "change" ? (
        <>
          <TextField name="effectiveFrom" label="Fecha efectiva" type="date" help="El valor anterior se conserva hasta esta fecha." />
          <CheckboxField name="unknownStart" label="Situación inicial con fecha de inicio desconocida" help="Solo para el primer registro de un dato." />
        </>
      ) : (
        <>
          <TextField name="validFrom" label="Desde" type="date" help="Vacío = inicio desconocido." />
          <TextField name="validTo" label="Hasta (excl.)" type="date" help="Primer día en que ya no aplica. Vacío = sin fin." />
        </>
      )}
      <TextAreaField name="note" label="Nota" />
      <div className="form-actions">
        <SubmitButton>{mode === "change" ? "Guardar cambio" : "Añadir tramo"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
