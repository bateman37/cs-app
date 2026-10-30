import { KIND_LABEL, MONTH_NAMES, MONTH_SHORT, type ScopeRef, type ValueKind } from "@/domain/usuarios";

export const BASE = "/administracion/usuarios";

export const SCOPE_SLUG: Record<ScopeRef["type"], string> = { group: "grupo", client: "cliente", implementation: "implantacion" };
export const SLUG_SCOPE: Record<string, ScopeRef["type"]> = { grupo: "group", cliente: "client", implantacion: "implementation" };
export const SCOPE_LABEL: Record<ScopeRef["type"], string> = { group: "Grupo Cliente", client: "Cliente", implementation: "Implantación" };

export const KIND_MARK: Record<ValueKind, string> = { INITIAL: "H", COPIED: "C", PROPAGATED: "P", ADJUSTED: "A" };

export function fichaHref(type: ScopeRef["type"], id: string, year: number, extra = "") {
  return `${BASE}/${SCOPE_SLUG[type]}/${id}?anio=${year}${extra}`;
}

export const monthName = (m: number) => MONTH_NAMES[m - 1];
export const monthShort = (m: number) => MONTH_SHORT[m - 1];

/** Celda de la matriz: «—» sin informar, 0 cero confirmado; el tipo se indica con letra y texto, no solo con color. */
export function Cell({ value, kind, locked }: { value: number | null; kind: ValueKind | null; locked: boolean }) {
  if (value === null) {
    return (
      <td style={{ textAlign: "right", color: "var(--muted)" }}>
        <span aria-hidden="true">—</span>
        <span className="skip">sin informar</span>
      </td>
    );
  }
  return (
    <td style={{ textAlign: "right", whiteSpace: "nowrap" }} title={kind ? `${KIND_LABEL[kind]}${locked ? " (bloqueado)" : ""}` : undefined}>
      {value}
      {value === 0 ? <span className="skip"> cero confirmado</span> : null}
      {kind ? (
        <sup style={{ marginLeft: 2, color: "var(--muted)" }} aria-label={`${KIND_LABEL[kind]}${locked ? ", bloqueado" : ""}`}>
          {KIND_MARK[kind]}
          {locked ? "🔒" : ""}
        </sup>
      ) : null}
    </td>
  );
}

export function Legend() {
  return (
    <p className="muted" style={{ fontSize: "0.85rem" }}>
      «—» = sin informar (no es cero). «0» = cero confirmado. Marca: <sup>H</sup> carga inicial histórica (bloqueada), <sup>C</sup> base copiada,{" "}
      <sup>P</sup> propagado, <sup>A</sup> ajuste explícito.
    </p>
  );
}
