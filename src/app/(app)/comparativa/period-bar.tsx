"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { lastDayOfMonth, parseYmd, previousMonth, ymdToIso } from "@/domain/finance";
import { qs } from "@/lib/format";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/**
 * Barra pequeña de periodo (HOTFIX-02 §6): mes y año, «A fecha de hoy / Mes completo» y último mes cerrado. No es un filtro de negocio.
 * `params` trae el resto del estado válido (soporte, servidor, orden); cambiar el periodo reinicia la página.
 */
export function PeriodBar({ base, params, date, mode, today, provisional }: { base: string; params: Record<string, string>; date: string; mode: "CUTOFF" | "FULL_MONTH"; today: string; provisional: boolean }) {
  const router = useRouter();
  const sel = parseYmd(date);
  const now = parseYmd(today);
  const years: number[] = [];
  for (let y = now.y; y >= Math.min(now.y - 4, sel.y); y--) years.push(y);
  const href = (fecha: string, modo: "CUTOFF" | "FULL_MONTH") => {
    const { pagina: _p, fecha: _f, modo: _m, ...rest } = params;
    void _p; void _f; void _m;
    return `${base}${qs({ ...rest, fecha: fecha === today ? undefined : fecha, modo: modo === "CUTOFF" ? undefined : modo })}`;
  };
  const endOf = (y: number, m: number) => (y === now.y && m === now.m ? today : ymdToIso({ y, m, d: lastDayOfMonth(y, m) }));
  const go = (y: number, m: number) => router.push(href(y === now.y && m === now.m ? today : endOf(y, m), mode));
  const pm = previousMonth(now.y, now.m);
  const lastClosed = endOf(pm.y, pm.m);
  const isLastClosed = sel.y === pm.y && sel.m === pm.m && mode === "FULL_MONTH";
  return (
    <div className="pbar" role="group" aria-label="Periodo">
      <label className="pbar-f"><span className="visually-hidden">Mes</span>
        <select value={sel.m} onChange={(e) => go(sel.y, Number(e.target.value))} aria-label="Mes">
          {MESES.map((n, i) => (sel.y === now.y && i + 1 > now.m ? null : <option key={n} value={i + 1}>{n}</option>))}
        </select></label>
      <label className="pbar-f"><span className="visually-hidden">Año</span>
        <select value={sel.y} onChange={(e) => go(Number(e.target.value), Math.min(sel.m, Number(e.target.value) === now.y ? now.m : 12))} aria-label="Año">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select></label>
      <span className="seg" role="group" aria-label="Corte del mes">
        <Link href={href(sel.y === now.y && sel.m === now.m ? today : endOf(sel.y, sel.m), "CUTOFF")} aria-pressed={mode === "CUTOFF"} className={mode === "CUTOFF" ? "seg-on" : undefined} prefetch={false}>A fecha de hoy</Link>
        <Link href={href(date, "FULL_MONTH")} aria-pressed={mode === "FULL_MONTH"} className={mode === "FULL_MONTH" ? "seg-on" : undefined} prefetch={false}>Mes completo</Link>
      </span>
      <Link href={href(lastClosed, "FULL_MONTH")} className={isLastClosed ? "pbar-last seg-on-link" : "pbar-last"} aria-current={isLastClosed ? "true" : undefined} prefetch={false}>Último mes cerrado</Link>
      {provisional ? <span className="prov" title="El mes en curso no está cerrado: las cifras se prorratean hasta el día de corte y no certifican el cierre.">Provisional</span> : null}
    </div>
  );
}
