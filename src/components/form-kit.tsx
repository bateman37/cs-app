"use client";

import { createContext, useActionState, useContext, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

export type FormState = {
  status: "idle" | "ok" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
  /** Cambia en cada envío para volver a montar los campos con los valores conservados. */
  nonce?: number;
};

export const IDLE: FormState = { status: "idle" };

const Ctx = createContext<FormState>(IDLE);

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** Formulario con validación en servidor: conserva lo escrito y muestra errores por campo. */
export function ActionForm({
  action,
  children,
  className,
  hidden,
  id,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  hidden?: Record<string, string | number | boolean>;
  id?: string;
}) {
  const [state, formAction] = useActionState(action, IDLE);
  return (
    <Ctx.Provider value={state}>
      <form action={formAction} className={className ?? "form"} id={id} key={state.nonce ?? 0} noValidate>
        {hidden &&
          Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}
        <FormMessage />
        {children}
      </form>
    </Ctx.Provider>
  );
}

export function FormMessage() {
  const state = useContext(Ctx);
  if (state.status === "idle" || !state.message) return null;
  return (
    <p className={state.status === "ok" ? "notice notice-ok" : "notice notice-error"} role={state.status === "ok" ? "status" : "alert"}>
      {state.message}
    </p>
  );
}

function useField(name: string, initial?: string) {
  const state = useContext(Ctx);
  const error = state.fieldErrors?.[name];
  const value = state.values && name in state.values ? state.values[name] : (initial ?? "");
  return { error, value };
}

type FieldProps = {
  name: string;
  label: string;
  initial?: string;
  help?: string;
  required?: boolean;
  disabled?: boolean;
};

export function TextField({ name, label, initial, help, required, disabled, type = "text", maxLength }: FieldProps & { type?: string; maxLength?: number }) {
  const { error, value } = useField(name, initial);
  const id = `f-${name}-${label}`.replace(/\W+/g, "-");
  return (
    <div className={error ? "field field-error" : "field"}>
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <input id={id} name={name} type={type} defaultValue={value} maxLength={maxLength} disabled={disabled} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-e` : help ? `${id}-h` : undefined} />
      {help && !error ? <small id={`${id}-h`}>{help}</small> : null}
      {error ? <small id={`${id}-e`} className="error-text">{error}</small> : null}
    </div>
  );
}

export function TextAreaField({ name, label, initial, help, required, disabled }: FieldProps) {
  const { error, value } = useField(name, initial);
  const id = `f-${name}-${label}`.replace(/\W+/g, "-");
  return (
    <div className={error ? "field field-error" : "field"}>
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <textarea id={id} name={name} rows={2} defaultValue={value} disabled={disabled} aria-invalid={error ? true : undefined} />
      {help && !error ? <small>{help}</small> : null}
      {error ? <small className="error-text">{error}</small> : null}
    </div>
  );
}

export function SelectField({
  name,
  label,
  options,
  initial,
  help,
  required,
  disabled,
  placeholder,
}: FieldProps & { options: { value: string; label: string }[]; placeholder?: string }) {
  const { error, value } = useField(name, initial);
  const id = `f-${name}-${label}`.replace(/\W+/g, "-");
  return (
    <div className={error ? "field field-error" : "field"}>
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <select id={id} name={name} defaultValue={value} disabled={disabled} aria-invalid={error ? true : undefined}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {help && !error ? <small>{help}</small> : null}
      {error ? <small className="error-text">{error}</small> : null}
    </div>
  );
}

export function CheckboxField({ name, label, initial, help }: { name: string; label: string; initial?: boolean; help?: string }) {
  const state = useContext(Ctx);
  const error = state.fieldErrors?.[name];
  const checked = state.values && name in state.values ? state.values[name] === "on" : (initial ?? false);
  const id = `f-${name}-${label}`.replace(/\W+/g, "-");
  return (
    <div className={error ? "field field-check field-error" : "field field-check"}>
      <input id={id} type="checkbox" name={name} defaultChecked={checked} />
      <label htmlFor={id}>{label}</label>
      {help ? <small>{help}</small> : null}
      {error ? <small className="error-text">{error}</small> : null}
    </div>
  );
}

export function SubmitButton({ children, pending = "Guardando…", variant = "primary" }: { children: ReactNode; pending?: string; variant?: "primary" | "secondary" | "danger" }) {
  const { pending: isPending } = useFormStatus();
  return (
    <button type="submit" className={`btn btn-${variant}`} disabled={isPending} aria-busy={isPending}>
      {isPending ? pending : children}
    </button>
  );
}
