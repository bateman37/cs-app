"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/form-kit";
import { repairRelationsAction } from "./cargas/actions";

export type RelState = { state: "UP_TO_DATE" | "PENDING" | "RUNNING" | "FAILED"; requested: number; completed: number; progress: { phase: string; step: number; steps: number } | null; lastError: string | null; attempts: number; maxAttempts: number };

const busy = (s: RelState["state"]) => s === "PENDING" || s === "RUNNING";

/**
 * Estado breve y real de la actualización de relaciones (HOTFIX-02 §4). Distingue «maestros guardados» de «análisis actualizado»: mientras haya una
 * generación solicitada sin publicar muestra «Actualizando relaciones» con su progreso; si falla, el motivo y el reintento. Sondea cada ~2 s solo
 * mientras hay trabajo y refresca la página al terminar (las vistas se actualizan con los datos nuevos). El desmontaje cancela temporizador y petición.
 */
export function RelationsStatus({ initial, withAction = false }: { initial: RelState; withAction?: boolean }) {
  const router = useRouter();
  const [live, setLive] = useState<RelState>(initial);
  const last = useRef(`${initial.state}|${initial.completed}`);
  const shown = live.completed >= initial.completed ? live : initial;
  const active = busy(initial.state);

  useEffect(() => {
    if (!active) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();
    const tick = async () => {
      try {
        const r = await fetch("/api/relaciones/estado", { cache: "no-store", signal: ctrl.signal });
        if (r.ok) {
          const s = (await r.json()) as RelState;
          if (stop) return;
          setLive(s);
          const key = `${s.state}|${s.completed}`;
          if (key !== last.current) {
            last.current = key;
            router.refresh();
          }
          if (!busy(s.state)) return;
        }
      } catch {
        if (stop) return;
      }
      if (!stop) timer = setTimeout(tick, 2000);
    };
    timer = setTimeout(tick, 2000);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
      ctrl.abort();
    };
  }, [active, router]);

  if (shown.state === "UP_TO_DATE" && !withAction) return null;
  return (
    <div role="status" aria-live="polite" data-testid="estado-relaciones" aria-busy={busy(shown.state) ? true : undefined} className={shown.state === "FAILED" ? "notice notice-warn" : "notice notice-info"}>
      {shown.state === "UP_TO_DATE" ? (
        <p><strong>Relaciones al día.</strong> Los datos cargados están atribuidos con los maestros actuales.</p>
      ) : shown.state === "FAILED" ? (
        <p>
          <strong>La actualización de relaciones ha fallado.</strong> {shown.lastError ? <>Motivo: {shown.lastError} </> : null}
          Los maestros están guardados, pero el análisis aún usa las relaciones anteriores. Pulse «Actualizar relaciones de los datos cargados» para reintentar.
        </p>
      ) : (
        <p>
          <strong>Actualizando relaciones…</strong> Los maestros están guardados; el análisis se actualiza en segundo plano
          {shown.progress ? <> · {shown.progress.phase} ({shown.progress.step}/{shown.progress.steps})</> : shown.state === "PENDING" ? <> · en cola</> : null}
          {shown.attempts > 1 ? <> · intento {shown.attempts}/{shown.maxAttempts}</> : null}.
        </p>
      )}
      {withAction ? (
        <ActionForm action={repairRelationsAction} className="inline-form">
          <SubmitButton variant={shown.state === "FAILED" ? "primary" : "secondary"} pending="Solicitando…">Actualizar relaciones de los datos cargados</SubmitButton>
          <small className="muted">Recupera una instalación con datos ya cargados o un fallo. Los cambios de maestros la disparan solos; no relee archivos ni cambia ganadores, fechas u observaciones.</small>
        </ActionForm>
      ) : null}
    </div>
  );
}
