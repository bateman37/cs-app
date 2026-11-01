import Link from "next/link";
import type { ReactNode } from "react";
import { VALUE_LABEL } from "@/domain/catalogs";
import type { Formula } from "@/domain/finance";
import type { Amount, PeriodSeries } from "@/server/economics/engine";
import { formatDecimalEs, formatPercentEs } from "@/lib/money";
import { qs } from "@/lib/format";

/** Presentación de las cifras de las vistas analíticas (CSAPP-06). Solo formatea el decimal EXACTO del servidor: nunca calcula. */
export const STATUS_LABEL: Record<string, string> = { AVAILABLE: "dato disponible", PARTIAL: "parcial", NO_SOURCE: "sin fuente", NOT_COMPUTABLE: "no calculable" };
export const eur = (v: string | null | undefined, d = 2) => (v === null || v === undefined ? "—" : `${formatDecimalEs(v, d)} €`);
export const hrs = (v: string | null | undefined, d = 2) => (v === null || v === undefined ? "—" : `${formatDecimalEs(v, d)} h`);
export const label = (v: string) => VALUE_LABEL[v] ?? (v === "SIN_INFORMAR" ? "sin informar" : v === "HETEROGENEO" ? "heterogéneo" : v);

export function Pct({ f }: { f: Formula | null | undefined }) {
  if (!f) return <>—</>;
  if (f.value !== null) return <span title={`${formatDecimalEs(f.value, 6)} (fracción exacta)`}>{formatPercentEs(f.value, 1)}</span>;
  return <Missing f={f} compact />;
}

/** Valor ausente: nunca un cero. Estado y motivo accesibles por texto, no solo por color. */
export function Missing({ f, compact }: { f: Pick<Formula, "status" | "reason" | "numerator" | "denominator" | "unit">; compact?: boolean }) {
  return (
    <span title={f.reason ?? undefined} className="missing">
      <span className={`badge ${f.status === "PARTIAL" ? "badge-warn" : "badge-off"}`}>{STATUS_LABEL[f.status] ?? f.status}</span>
      {!compact && f.reason ? <small className="muted block">{f.reason}</small> : null}
    </span>
  );
}

export function Ratio({ f, digits = 2 }: { f: Formula; digits?: number }) {
  return f.value !== null ? <>{formatDecimalEs(f.value, digits)}</> : <Missing f={f} compact />;
}

export function Money({ a }: { a: Amount }) {
  if (a.value !== null) return <>{formatDecimalEs(a.value, 2)}</>;
  return (
    <span className="missing" title={a.reason ?? undefined}>
      <span className="badge badge-off">{STATUS_LABEL[a.status]}</span>
      {a.known !== "0" ? <small className="muted block">conocido {formatDecimalEs(a.known, 2)}</small> : null}
    </span>
  );
}

export function PeriodBadges({ p }: { p: Pick<PeriodSeries, "provisional" | "partial" | "validated"> }) {
  return (
    <>
      {p.provisional ? <span className="badge badge-warn" title="Mes en curso o corte aún no cerrado: no certifica cierre">provisional</span> : null}
      {!p.validated ? <span className="badge badge-warn" title="Derivados pendientes de reproceso: magnitud conservada, no validada">no validado</span> : null}
    </>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "ok" | "error" | "warn"; children: ReactNode }) {
  return <div className={`notice ${kind === "warn" ? "notice-warn" : `notice-${kind}`}`} role={kind === "error" ? "alert" : "status"}>{children}</div>;
}

export function Pager({ base, params, page, pageCount, total, noun = "filas", param = "pagina" }: { base: string; params: Record<string, string | undefined>; page: number; pageCount: number; total: number; noun?: string; param?: string }) {
  if (pageCount <= 1) return <p className="muted">{total} {noun}.</p>;
  const link = (p: number) => `${base}${qs({ ...params, [param]: p > 1 ? p : undefined })}`;
  return (
    <nav className="pager" aria-label="Paginación">
      {page > 1 ? <Link href={link(page - 1)} rel="prev">← Anterior</Link> : <span className="muted">← Anterior</span>}
      <span>Página {page} de {pageCount} ({total} {noun})</span>
      {page < pageCount ? <Link href={link(page + 1)} rel="next">Siguiente →</Link> : <span className="muted">Siguiente →</span>}
    </nav>
  );
}

export const monthName = (iso: string) => {
  const [y, m] = iso.split("-");
  return `${["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][Number(m) - 1]} ${y}`;
};
export const fdate = (iso: string | null | undefined) => (iso ? iso.split("-").reverse().join("/") : "—");
