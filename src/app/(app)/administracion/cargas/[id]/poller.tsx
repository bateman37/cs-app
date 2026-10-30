"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Estado = { status: string; phase: string | null; rowsProcessed: number; version: number; terminal: boolean; busy?: boolean };

/**
 * Sondea el estado ligero cada ~2 s mientras el lote no es terminal y refresca la ficha al cambiar.
 * Muestra contadores y fase (sin porcentaje inventado). La región es aria-live para lectores de pantalla.
 */
export function StatusPoller({ id, initial, label }: { id: string; initial: Estado; label: string }) {
  const router = useRouter();
  const last = useRef(`${initial.status}|${initial.phase}|${initial.rowsProcessed}|${initial.version}|${initial.busy}`);
  const [live, setLive] = useState<Estado>(initial);

  useEffect(() => {
    if (initial.terminal && !initial.busy) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/cargas/${id}/estado`, { cache: "no-store" });
        if (r.ok) {
          const s = (await r.json()) as Estado;
          if (stop) return;
          setLive(s);
          const key = `${s.status}|${s.phase}|${s.rowsProcessed}|${s.version}|${s.busy}`;
          if (key !== last.current) {
            last.current = key;
            router.refresh();
          }
          if (s.terminal && !s.busy) return;
        }
      } catch {
        /* se reintenta en el siguiente ciclo */
      }
      if (!stop) setTimeout(tick, 2000);
    };
    const t = setTimeout(tick, 2000);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [id, initial.terminal, initial.busy, router]);

  return (
    <p role="status" aria-live="polite" data-testid="estado-lote">
      <strong>{label}</strong>
      {live.phase ? <> · {live.phase}</> : null}
      {!live.terminal ? <> · {live.rowsProcessed.toLocaleString("es-ES")} filas leídas</> : null}
      {live.terminal && live.busy ? <> · Aplicando la operación solicitada (recálculo o reversión)…</> : null}
    </p>
  );
}
