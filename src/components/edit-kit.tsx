"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * Piezas comunes de las tablas editables (HOTFIX-04 §5): diálogo modal de confirmación y guardia de navegación con borrador pendiente.
 * Nada se persiste aquí: son solo interacción. El guardado real lo hacen las acciones de servidor tras la confirmación.
 */

/** Diálogo modal accesible (`<dialog>`): Esc o Cancelar cierran SIN escribir. */
export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={wide ? "ed-dialog ed-dialog-wide" : "ed-dialog"} aria-labelledby="ed-dialog-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2 id="ed-dialog-title">{title}</h2>
      <div className="ed-dialog-body">{children}</div>
      <div className="ed-dialog-foot">{footer}</div>
    </dialog>
  );
}

export type PendingNav = { go: () => void } | null;

/**
 * Guardia de navegación: con borrador pendiente intercepta enlaces internos, cierres de pestaña y envíos de los filtros, y ofrece Guardar / Descartar / Seguir editando.
 * `request(go)` lo usan los filtros de la propia tabla; los enlaces (`<a href>`) se interceptan en captura sin que el resto de la página lo sepa.
 */
export function useDirtyGuard(dirty: boolean) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingNav>(null);
  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download") || a.dataset.noGuard !== undefined) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPending({ go: () => router.push(url.pathname + url.search + url.hash) });
    };
    window.addEventListener("beforeunload", onBefore);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBefore);
      document.removeEventListener("click", onClick, true);
    };
  }, [router]);

  const request = useCallback((go: () => void) => {
    if (dirtyRef.current) setPending({ go });
    else go();
  }, []);
  return { pending, request, clear: () => setPending(null) };
}

export function GuardDialog({ pending, saving, onSave, onDiscard, onStay, what }: { pending: PendingNav; saving?: boolean; onSave: () => void; onDiscard: () => void; onStay: () => void; what: string }) {
  return (
    <Modal
      open={pending !== null}
      title="Tiene cambios sin guardar"
      onClose={onStay}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onStay}>Seguir editando</button>
          <button type="button" className="btn btn-danger" onClick={onDiscard}>Descartar</button>
          <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving}>Guardar</button>
        </>
      }
    >
      <p>{what} «Guardar» abre la revisión: no se guarda nada hasta que la confirme.</p>
    </Modal>
  );
}

/** Aviso breve de éxito o error; se retira solo. */
export function Toast({ kind, text, onDone }: { kind: "ok" | "error"; text: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, kind === "ok" ? 5000 : 12000);
    return () => clearTimeout(t);
  }, [kind, text, onDone]);
  return <p className={kind === "ok" ? "notice notice-ok ed-toast" : "notice notice-error ed-toast"} role={kind === "ok" ? "status" : "alert"}>{text}</p>;
}

export const newOperationId = (): string => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`);
