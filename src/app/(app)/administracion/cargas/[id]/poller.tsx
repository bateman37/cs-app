"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Estado = { status: string; phase: string | null; rowsProcessed: number; version: number; terminal: boolean; busy?: boolean };

const working = (e: Pick<Estado, "terminal" | "busy">) => !e.terminal || Boolean(e.busy);

/**
 * Sondea el estado ligero cada ~2 s SOLO mientras haya trabajo activo (lote no terminal o recálculo/reversión en cola) y refresca
 * la ficha cuando cambia algo. Al pasar a «sin trabajo» actualiza la ficha una vez y se detiene. El desmontaje cancela el temporizador
 * y la petición en vuelo (HOTFIX-01 §3). La región es aria-live para lectores de pantalla.
 */
export function StatusPoller({ id, initial, label }: { id: string; initial: Estado; label: string }) {
  const router = useRouter();
  const last = useRef(`${initial.status}|${initial.phase}|${initial.rowsProcessed}|${initial.version}|${initial.busy}`);
  const [live, setLive] = useState<Estado>(initial);
  // El último sondeo manda mientras no sea más antiguo que lo que la ficha ya refrescó.
  const shown = live.version >= initial.version ? live : initial;
  const active = working(initial);

  useEffect(() => {
    if (!active) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();
    const tick = async () => {
      try {
        const r = await fetch(`/api/cargas/${id}/estado`, { cache: "no-store", signal: ctrl.signal });
        if (r.ok) {
          const s = (await r.json()) as Estado;
          if (stop) return;
          setLive(s);
          const key = `${s.status}|${s.phase}|${s.rowsProcessed}|${s.version}|${s.busy}`;
          if (key !== last.current) {
            last.current = key;
            router.refresh();
          }
          if (!working(s)) return; // sin trabajo activo: no se programa otro sondeo
        }
      } catch {
        if (stop) return;
        /* se reintenta en el siguiente ciclo */
      }
      if (!stop) timer = setTimeout(tick, 2000);
    };
    timer = setTimeout(tick, 2000);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
      ctrl.abort();
    };
  }, [id, active, router]);

  return (
    <p role="status" aria-live="polite" data-testid="estado-lote" aria-busy={working(shown) ? true : undefined}>
      <strong>{label}</strong>
      {shown.phase ? <> · {shown.phase}</> : null}
      {!shown.terminal ? <> · {shown.rowsProcessed.toLocaleString("es-ES")} filas leídas</> : null}
      {shown.terminal && shown.busy ? <> · Operación aparte en curso (recálculo o reversión)…</> : null}
    </p>
  );
}
