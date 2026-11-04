import Link from "next/link";
import { SERVER_VALUES, supportChipLabel, toggleFilter, type CommonFilters } from "@/domain/filtros-comunes";
import { SUPPORT_VALUES } from "@/domain/catalogs";
import { ESTADO_LABEL, ESTADO_VALUES } from "@/domain/estado";

/**
 * Segmentadores Soporte, Servidor y Estado comercial (HOTFIX-02 §6, HOTFIX-03 §7). El estado es de selección única (Activos por defecto). Son enlaces (sin JavaScript): un clic alterna el valor y navega con el resto del estado
 * que construya `hrefFor`. Sin selección = todos. Accesibles: `aria-pressed` y texto; el estado no depende solo del color.
 */
export function FiltrosComunes({ value, hrefFor }: { value: CommonFilters; hrefFor: (next: CommonFilters) => string }) {
  const chip = (kind: "soporte" | "servidor", v: string, label: string) => {
    const on = (value[kind] as string[]).includes(v);
    return (
      <Link key={v} href={hrefFor(toggleFilter(value, kind, v))} className={on ? "chip chip-on" : "chip"} aria-pressed={on} scroll={false} prefetch={false}>
        {label}
      </Link>
    );
  };
  return (
    <div className="chips" role="group" aria-label="Filtros de negocio">
      <span className="chips-group" role="group" aria-label="Soporte">
        <span className="chips-title">Soporte</span>
        {SUPPORT_VALUES.map((v) => chip("soporte", v, supportChipLabel(v)))}
      </span>
      <span className="chips-group" role="group" aria-label="Estado comercial">
        <span className="chips-title">Estado</span>
        {ESTADO_VALUES.map((v) => (
          <Link key={v} href={hrefFor({ ...value, estado: v })} className={value.estado === v ? "chip chip-on" : "chip"} aria-pressed={value.estado === v} scroll={false} prefetch={false}>{ESTADO_LABEL[v]}</Link>
        ))}
      </span>
      <span className="chips-group" role="group" aria-label="Servidor">
        <span className="chips-title">Servidor</span>
        {SERVER_VALUES.map((v) => chip("servidor", v, v))}
      </span>
    </div>
  );
}
