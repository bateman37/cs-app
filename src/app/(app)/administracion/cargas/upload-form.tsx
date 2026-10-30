"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Field = { name: string; label: string; type: "text" | "select" | "date" | "checkbox"; required: boolean; options?: { value: string; label: string }[] };
export type Source = { id: string; label: string; description: string; formats: string[]; metadataFields: Field[] };

function b64(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

/** Subida con el archivo como cuerpo crudo (sin formData): barra de ENVÍO con bytes reales. */
export function UploadForm({ source }: { source: Source }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ loaded: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    const file = fd.get("archivo");
    if (!(file instanceof File) || file.size === 0) {
      setError("Seleccione un archivo.");
      return;
    }
    const clean = (names: string[]) => {
      const o: Record<string, string> = {};
      for (const n of names) {
        const v = String(fd.get(n) ?? "").trim();
        if (v) o[n] = v;
      }
      return o;
    };
    const perfil = clean(source.metadataFields.map((f) => f.name));
    const declarado = clean(["extraccion", "desde", "hasta", "cobertura"]);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/cargas");
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.setRequestHeader("x-csapp-perfil", source.id);
    xhr.setRequestHeader("x-csapp-nombre", encodeURIComponent(file.name));
    xhr.setRequestHeader("x-csapp-metadatos", b64({ perfil, declarado }));
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setSent({ loaded: ev.loaded, total: ev.total });
    };
    xhr.onload = () => {
      setBusy(false);
      let body: { id?: string; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* respuesta no JSON */
      }
      if (xhr.status === 201 && body.id) router.push(`/administracion/cargas/${body.id}`);
      else setError(body.error ?? `La subida fue rechazada (código ${xhr.status}).`);
    };
    xhr.onerror = () => {
      setBusy(false);
      setError("La conexión se interrumpió antes de completar la subida; el archivo no se ha procesado.");
    };
    setBusy(true);
    setSent({ loaded: 0, total: file.size });
    xhr.send(file);
  }

  const id = `up-${source.id}`;
  return (
    <form ref={formRef} onSubmit={submit} className="form" noValidate aria-describedby={`${id}-desc`}>
      {error ? <p className="notice notice-error" role="alert">{error}</p> : null}
      <div className="field">
        <label htmlFor={`${id}-archivo`}>Archivo ({source.formats.map((f) => f.toUpperCase()).join(" o ")})</label>
        <input id={`${id}-archivo`} name="archivo" type="file" accept={source.formats.map((f) => `.${f}`).join(",")} disabled={busy} />
      </div>
      {source.metadataFields.map((f) => f.type === "checkbox" ? (
        <div className="field field-check" key={f.name}>
          <input id={`${id}-${f.name}`} name={f.name} type="checkbox" value="si" disabled={busy} />
          <label htmlFor={`${id}-${f.name}`}>{f.label}{f.required ? <span aria-hidden="true"> *</span> : null}</label>
        </div>
      ) : (
        <div className="field" key={f.name}>
          <label htmlFor={`${id}-${f.name}`}>{f.label}{f.required ? <span aria-hidden="true"> *</span> : null}</label>
          {f.type === "select" ? (
            <select id={`${id}-${f.name}`} name={f.name} defaultValue="" disabled={busy}>
              <option value="">Seleccione…</option>
              {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input id={`${id}-${f.name}`} name={f.name} type={f.type === "date" ? "date" : "text"} disabled={busy} />
          )}
        </div>
      ))}
      <fieldset style={{ flexBasis: "100%", border: 0, padding: 0, margin: 0 }}>
        <legend className="muted">Metadatos declarados (opcionales; no se deducen del contenido)</legend>
        <div className="form">
          <div className="field"><label htmlFor={`${id}-extraccion`}>Fecha de extracción</label><input id={`${id}-extraccion`} name="extraccion" type="date" disabled={busy} /></div>
          <div className="field"><label htmlFor={`${id}-desde`}>Intervalo desde</label><input id={`${id}-desde`} name="desde" type="date" disabled={busy} /></div>
          <div className="field"><label htmlFor={`${id}-hasta`}>Intervalo hasta</label><input id={`${id}-hasta`} name="hasta" type="date" disabled={busy} /></div>
          <div className="field"><label htmlFor={`${id}-cobertura`}>Cobertura conocida</label><input id={`${id}-cobertura`} name="cobertura" maxLength={500} disabled={busy} /></div>
        </div>
      </fieldset>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>{busy ? "Enviando…" : "Subir y validar"}</button>
        {sent ? (
          <span role="status" aria-live="polite">
            <progress max={sent.total} value={sent.loaded} aria-label="Progreso del envío" /> {mb(sent.loaded)} de {mb(sent.total)} enviados
          </span>
        ) : null}
      </div>
    </form>
  );
}
