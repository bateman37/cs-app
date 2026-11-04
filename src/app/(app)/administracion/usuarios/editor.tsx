"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { KIND_LABEL, MONTHS, MONTH_NAMES, MONTH_SHORT, applySteps, emptyYear, parseUserCount, type MatrixStep, type ScopeRef, type ValueKind, type YearState } from "@/domain/usuarios";
import type { BatchResult, BatchRowPreview } from "@/server/usuarios";
import { GuardDialog, Modal, Toast, newOperationId, useDirtyGuard } from "@/components/edit-kit";
import { previewUsuariosBatchAction, saveUsuariosBatchAction } from "./editor-actions";

/**
 * Matriz de usuarios contratados con edición real de enero a diciembre (HOTFIX-04 §6). Conserva la tabla (año/ámbito/estado, una fila por Grupo/Cliente/implantación, doce
 * meses). El borrador es local; «Guardar cambios» → revisión de servidor → confirmación → lote atómico. Una celda modificada cambia SOLO ese mes; «Aplicar desde este mes»
 * y «Copiar base» se añaden al mismo borrador y se muestran en la confirmación. Las reglas se aplican con las mismas funciones puras que el servidor (`applySteps`).
 */

export type UsuariosRow = { id: string; name: string; context: string | null; isActive: boolean; version: number; values: (number | null)[]; kinds: (ValueKind | null)[]; locked: boolean[]; sources: (string | null)[] };
type Props = {
  rows: UsuariosRow[];
  year: number;
  scopeType: ScopeRef["type"];
  scopeLabel: string;
  scopeSlug: string;
  /** Administrador y año de la ventana editable (reloj del servidor). */
  editable: boolean;
  reason: string | null;
  filters: { anio: number; ambito: string; q: string; status: string };
  years: number[];
  scopeOptions: { value: string; label: string }[];
  history: Record<string, string>;
  children?: ReactNode;
  legend?: ReactNode;
};

const KIND_MARK: Record<ValueKind, string> = { INITIAL: "B", COPIED: "C", PROPAGATED: "P", ADJUSTED: "A", ESTIMATED: "E" };
type RowDraft = {
  /** Versión de la matriz que se vio al empezar a editar (control de concurrencia). */
  version: number;
  copy: "SAME_MONTH" | "DECEMBER" | null;
  /** Estado del año tras la copia, calculado por el servidor (la copia necesita el año anterior). */
  copyState: YearState | null;
  applies: { month: number; value: number }[];
  /** Ediciones de celda ya válidas (null = sin informar). */
  sets: Record<number, number | null>;
  /** Texto escrito en cada celda editada (incluye lo inválido, que se marca en la celda). */
  texts: Record<number, string>;
  error?: { kind: "CONFLICT" | "VALIDATION"; message: string };
};
const emptyDraft = (version: number): RowDraft => ({ version, copy: null, copyState: null, applies: [], sets: {}, texts: {}, error: undefined });

const rowKey = (type: ScopeRef["type"], id: string) => `${type}:${id}`;
const stateOf = (r: UsuariosRow): YearState => MONTHS.map((m) => (r.values[m - 1] === null ? null : { value: r.values[m - 1] as number, kind: r.kinds[m - 1] ?? "ADJUSTED", isLocked: r.locked[m - 1] }));

export function UsuariosEditor(props: Props) {
  const { rows, year, scopeType, editable } = props;
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [review, setReview] = useState<{ result: BatchResult; operationId: string; payload: unknown } | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "save">(null);
  const [toast, setToast] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [discardAsk, setDiscardAsk] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const opRef = useRef<string | null>(null);
  const saving = useRef(false);
  const afterSave = useRef<null | (() => void)>(null);

  const dirtyKeys = Object.keys(drafts);
  const dirty = dirtyKeys.length > 0;
  const guard = useDirtyGuard(dirty);
  useEffect(() => { opRef.current = null; }, [drafts]);


  /** Estado mostrado de una fila = repetición del borrador sobre los datos ACTUALES (mismas reglas que el servidor). */
  const displayOf = (r: UsuariosRow, d: RowDraft | undefined): YearState => {
    if (!d) return stateOf(r);
    const start = d.copyState ?? stateOf(r);
    const steps: MatrixStep[] = [...d.applies.map((a) => ({ type: "APPLY_FROM" as const, month: a.month, value: a.value })), ...Object.entries(d.sets).map(([m, v]) => ({ type: "SET" as const, month: Number(m), value: v }))];
    return applySteps(start, steps, { year, previous: emptyYear() }).after;
  };
  const stepsOf = (d: RowDraft): MatrixStep[] => [
    ...(d.copy ? [{ type: "COPY" as const, mode: d.copy }] : []),
    ...d.applies.map((a) => ({ type: "APPLY_FROM" as const, month: a.month, value: a.value })),
    ...Object.entries(d.sets).map(([m, v]) => ({ type: "SET" as const, month: Number(m), value: v })),
  ];
  const isStale = (r: UsuariosRow, d: RowDraft | undefined) => Boolean(d) && d!.version !== r.version;

  const patch = (key: string, r: UsuariosRow, f: (d: RowDraft) => RowDraft) =>
    setDrafts((all) => {
      const next = f(all[key] ?? emptyDraft(r.version));
      const empty = next.copy === null && next.applies.length === 0 && Object.keys(next.sets).length === 0 && Object.keys(next.texts).length === 0;
      if (empty) { const rest = { ...all }; delete rest[key]; return rest; }
      return { ...all, [key]: { ...next, error: undefined } };
    });

  const onType = (r: UsuariosRow, month: number, text: string) => {
    const key = rowKey(scopeType, r.id);
    patch(key, r, (d) => {
      const texts = { ...d.texts, [month]: text };
      const sets = { ...d.sets };
      // Referencia sin las ediciones de celda: si lo escrito coincide con ella, la celda deja de estar modificada.
      const baseState = applySteps(d.copyState ?? stateOf(r), d.applies.map((a) => ({ type: "APPLY_FROM" as const, month: a.month, value: a.value })), { year, previous: emptyYear() }).after;
      const ref = baseState[month - 1]?.value ?? null;
      const t = text.trim();
      const parsed = t === "" ? null : parseUserCount(t);
      const valid = t === "" || parsed !== null;
      if (valid && parsed === ref) { delete sets[month]; delete texts[month]; }
      else if (valid) sets[month] = parsed;
      else delete sets[month];
      return { ...d, texts, sets };
    });
  };

  const addApply = (r: UsuariosRow, month: number, value: number) => patch(rowKey(scopeType, r.id), r, (d) => ({ ...d, applies: [...d.applies, { month, value }] }));
  const undoRow = (r: UsuariosRow) => setDrafts((all) => { const rest = { ...all }; delete rest[rowKey(scopeType, r.id)]; return rest; });
  const rebase = (r: UsuariosRow) => setDrafts((all) => ({ ...all, [rowKey(scopeType, r.id)]: { ...all[rowKey(scopeType, r.id)], version: r.version, error: undefined } }));

  const requestCopy = async (r: UsuariosRow, mode: "SAME_MONTH" | "DECEMBER") => {
    const key = rowKey(scopeType, r.id);
    const d = drafts[key] ?? emptyDraft(r.version);
    const probe: RowDraft = { ...emptyDraft(d.version), copy: mode };
    setBusy("preview");
    const out = await previewUsuariosBatchAction({ operationId: newOperationId(), year, matrices: [{ targetType: scopeType, targetId: r.id, expectedVersion: d.version, steps: stepsOf(probe) }] });
    setBusy(null);
    if (out.status === "error") return setToast({ kind: "error", text: out.message });
    const row = out.result.rows[0];
    if (!out.result.ok || !row) return setRowErrors((e) => ({ ...e, [key]: out.result.errors[0]?.message ?? "No hay nada que copiar." }));
    setRowErrors((e) => { const n = { ...e }; delete n[key]; return n; });
    // El servidor devuelve el estado del año completo tras copia + aplicaciones + ediciones: pasa a ser la base de lo que se escriba después.
    const copyState: YearState = row.months.map((m) => (m.after === null ? null : { value: m.after, kind: m.afterKind ?? "COPIED", isLocked: false }));
    patch(key, r, () => ({ ...probe, copyState }));
  };

  const buildPayload = () => ({
    operationId: opRef.current ?? (opRef.current = newOperationId()),
    year,
    matrices: dirtyKeys.map((k) => {
      const [type, ...rest] = k.split(":");
      return { targetType: type as ScopeRef["type"], targetId: rest.join(":"), expectedVersion: drafts[k].version, steps: stepsOf(drafts[k]) };
    }),
  });

  const startReview = async (after?: () => void) => {
    if (busy || !dirty) return;
    // Validación local: textos inválidos se marcan en su celda y no se envía nada.
    const bad: Record<string, string> = {};
    for (const [k, d] of Object.entries(drafts)) {
      for (const [m, t] of Object.entries(d.texts)) {
        const tt = t.trim();
        if (tt !== "" && parseUserCount(tt) === null) bad[`${k}:${m}`] = "Entero 0 o mayor, sin decimales ni texto; vacío = sin informar.";
      }
    }
    if (Object.keys(bad).length > 0) { setRowErrors((e) => ({ ...e, ...bad })); return setToast({ kind: "error", text: "Hay celdas con un valor no válido (marcadas). No se ha guardado nada." }); }
    const payload = buildPayload();
    setBusy("preview");
    setToast(null);
    const out = await previewUsuariosBatchAction(payload);
    setBusy(null);
    if (out.status === "error") return setToast({ kind: "error", text: out.message });
    if (!out.result.ok) return failures(out.result);
    setRowErrors({});
    if (out.result.rows.length === 0) { setDrafts({}); opRef.current = null; return setToast({ kind: "ok", text: "No había diferencias con lo guardado: no se ha cambiado nada." }); }
    afterSave.current = after ?? null;
    setReview({ result: out.result, operationId: payload.operationId, payload: { ...payload, digest: out.result.digest } });
  };

  const failures = (res: BatchResult) => {
    setDrafts((all) => {
      const next = { ...all };
      for (const e of res.errors) {
        if (next[e.key]) next[e.key] = { ...next[e.key], error: { kind: e.kind, message: e.message } };
      }
      return next;
    });
    guard.clear();
    setToast({ kind: "error", text: res.errors.some((e) => e.kind === "CONFLICT") ? "Otra persona modificó filas mientras las editaba: no se ha guardado nada. Las filas en conflicto están marcadas; el resto del borrador se conserva." : "Hay filas que revisar (marcadas). No se ha guardado nada." });
  };

  const confirm = async () => {
    if (!review || saving.current) return;
    saving.current = true;
    setBusy("save");
    const out = await saveUsuariosBatchAction(review.payload);
    saving.current = false;
    setBusy(null);
    if (out.status === "error") { setReview(null); return setToast({ kind: "error", text: out.message }); }
    if (!out.result.ok) { setReview(null); opRef.current = null; return failures(out.result); }
    const n = out.result.alreadyApplied ? dirtyKeys.length : out.result.rows.length;
    setReview(null); setDrafts({}); setRowErrors({}); opRef.current = null;
    setToast({ kind: "ok", text: `Guardado: ${n} ${n === 1 ? "fila" : "filas"} de usuarios contratados ${year}. Exposición, ratios por usuario y exportaciones se recalculan con estos valores.` });
    const next = afterSave.current;
    afterSave.current = null;
    router.refresh();
    if (next) next();
  };

  const [q, setQ] = useState(props.filters.q);
  const [anio, setAnio] = useState(String(props.filters.anio));
  const [ambito, setAmbito] = useState(props.filters.ambito);
  const [status, setStatus] = useState(props.filters.status);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, month: number) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-month="${month}"]`));
    const i = all.indexOf(e.currentTarget);
    (all[i + 1] ?? all[i])?.focus();
  };

  const monthName = (m: number) => MONTH_NAMES[m - 1];
  const reviewRows: BatchRowPreview[] = review?.result.rows ?? [];

  return (
    <>
      <form className="toolbar" action="/administracion/usuarios" method="get" onSubmit={(e) => { e.preventDefault(); const u = new URLSearchParams({ anio, ambito, ...(q.trim() ? { q: q.trim() } : {}), status }); guard.request(() => router.push(`/administracion/usuarios?${u.toString()}`)); }}>
        <div className="field">
          <label htmlFor="anio">Año</label>
          <input id="anio" name="anio" type="number" min={2000} max={2100} step={1} value={anio} onChange={(e) => setAnio(e.target.value)} list="anios-con-datos" inputMode="numeric" />
          <datalist id="anios-con-datos">{props.years.map((y) => <option key={y} value={y} />)}</datalist>
        </div>
        <div className="field">
          <label htmlFor="ambito">Ámbito</label>
          <select id="ambito" name="ambito" value={ambito} onChange={(e) => setAmbito(e.target.value)}>{props.scopeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        </div>
        <div className="field">
          <label htmlFor="q">Buscar</label>
          <input id="q" name="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre" />
        </div>
        <div className="field">
          <label htmlFor="status">Estado</label>
          <select id="status" name="status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Activos</option><option value="inactive">Inactivos</option><option value="all">Todos</option>
          </select>
        </div>
        <button className="btn btn-primary" type="submit">Filtrar</button>
        <Link className="btn btn-secondary" href="/administracion/usuarios" prefetch={false}>Limpiar</Link>
      </form>
      <p className="muted">{year}: {editable ? (props.reason ?? "editable") : (props.reason ?? "solo lectura")}</p>

      {editable ? (
        <div className="ed-bar" role="region" aria-label="Edición de la matriz">
          <span className="muted">Edite los meses directamente; «—» = sin informar, 0 = cero confirmado. Nada se guarda hasta confirmarlo.</span>
          <span className="ed-spacer" />
          <span className="ed-count" role="status" aria-live="polite">{dirty ? `${dirtyKeys.length} ${dirtyKeys.length === 1 ? "fila modificada" : "filas modificadas"}` : "Sin cambios"}</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={!dirty || busy !== null} onClick={() => setDiscardAsk(true)}>Cancelar cambios</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || busy !== null} aria-busy={busy === "preview"} onClick={() => void startReview()}>{busy === "preview" ? "Revisando…" : `Guardar cambios (${dirtyKeys.length})`}</button>
        </div>
      ) : null}
      {toast ? <Toast kind={toast.kind} text={toast.text} onDone={() => setToast(null)} /> : null}

      <div className="table-wrap">
        <table className="ed-matrix">
          <caption className="skip">Usuarios contratados {year} por mes, {props.scopeLabel}: celdas editables</caption>
          <thead>
            <tr>
              <th>{props.scopeLabel}</th>
              {MONTHS.map((m) => <th key={m} style={{ textAlign: "right" }} title={`Mes ${m}`}>{MONTH_SHORT[m - 1]}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const key = rowKey(scopeType, r.id);
              const d = drafts[key];
              const shown = displayOf(r, d);
              const orig = stateOf(r);
              const canEditRow = editable && r.isActive;
              const stale = isStale(r, d);
              return (
                <tr key={r.id} className={`${r.isActive ? "" : "inactive-row"}${d ? " ed-row-dirty" : ""}`}>
                  <td className="ed-name">
                    <Link href={props.history[r.id]} title="Historial y ficha de la fila (consulta; no es necesaria para editar)">{r.name}</Link>
                    {r.context ? <div className="muted" style={{ fontSize: "0.8rem" }}>{r.context}</div> : null}
                    {!r.isActive ? <span className="badge badge-off" style={{ marginLeft: 6 }}>Inactivo</span> : null}
                    {canEditRow ? <RowTools r={r} d={d} busy={busy !== null} onApply={(m, v) => addApply(r, m, v)} onCopy={(mode) => void requestCopy(r, mode)} onUndo={() => undoRow(r)} /> : null}
                    {rowErrors[key] ? <small className="mt-err" role="alert">{rowErrors[key]}</small> : null}
                    {d?.error ? <small className={`mt-err${d.error.kind === "CONFLICT" ? " mt-err-conf" : ""}`} role="alert">{d.error.message} {d.error.kind === "CONFLICT" ? <button type="button" className="ed-mini" onClick={() => rebase(r)}>Usar los valores actuales como base</button> : null}</small> : null}
                    {stale && !d?.error ? <small className="mt-err mt-err-conf" role="status">Otra persona modificó esta fila (versión {r.version}). Su borrador se conserva; revise los valores y guarde de nuevo. <button type="button" className="ed-mini" onClick={() => rebase(r)}>Usar los valores actuales como base</button></small> : null}
                  </td>
                  {MONTHS.map((m) => {
                    const s = shown[m - 1];
                    const o = orig[m - 1];
                    const changed = (s?.value ?? null) !== (o?.value ?? null) || (s?.kind ?? null) !== (o?.kind ?? null);
                    const text = d?.texts[m] !== undefined ? d.texts[m] : s ? String(s.value) : "";
                    const cellErr = rowErrors[`${key}:${m}`];
                    if (!canEditRow) return <ReadCell key={m} value={s?.value ?? null} kind={s?.kind ?? null} locked={s?.isLocked ?? false} />;
                    return (
                      <td key={m} className={`ed-month${changed ? " mt-dirty" : ""}`} title={s ? `${KIND_LABEL[s.kind]}${r.sources[m - 1] && !changed ? ` · ${r.sources[m - 1]}` : ""}` : "Sin informar"}>
                        <input className="ed-input ed-num" data-month={m} inputMode="numeric" placeholder="—" aria-label={`${r.name}, ${monthName(m)} ${year}${s ? "" : ": sin informar"}`} aria-invalid={Boolean(cellErr)} value={text} onChange={(e) => onType(r, m, e.target.value)} onKeyDown={(e) => onKey(e, m)} />
                        {s ? <sup className="ed-kind" aria-label={KIND_LABEL[s.kind]}>{KIND_MARK[s.kind]}</sup> : null}
                        {cellErr ? <small className="mt-err" role="alert">{cellErr}</small> : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {props.legend}
      {props.children}

      <Modal
        open={review !== null}
        wide
        title="¿Estás seguro de que deseas guardar estos cambios?"
        onClose={() => { setReview(null); afterSave.current = null; }}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => { setReview(null); afterSave.current = null; }} disabled={busy === "save"}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={() => void confirm()} disabled={busy === "save"} aria-busy={busy === "save"}>{busy === "save" ? "Guardando…" : "Sí, guardar"}</button>
          </>
        }
      >
        <p className="muted">Usuarios contratados {year} · {reviewRows.length} {reviewRows.length === 1 ? "fila" : "filas"} en una sola operación: se guardan todas o ninguna. Cancelar cierra sin escribir y conserva su borrador.</p>
        <ul className="ed-review">
          {reviewRows.map((rw) => {
            const ch = rw.months.filter((x) => x.status === "changed");
            return (
              <li key={rw.key}>
                <strong>{rw.scopeName}</strong> · {ch.length} {ch.length === 1 ? "mes" : "meses"}
                <ul className="ed-months">
                  {ch.map((x) => (
                    <li key={x.month}>{monthName(x.month)}: <span className="ed-before">{x.before === null ? "sin informar" : x.before}</span> <span aria-hidden="true">→</span> <span className="ed-after">{x.after === null ? "sin informar" : x.after}</span>{x.afterKind ? <small className="muted"> ({KIND_LABEL[x.afterKind]})</small> : null}</li>
                  ))}
                </ul>
                {rw.protectedMonths.length > 0 ? <small className="muted">Se conservan sin cambios (ajuste explícito previo): {rw.protectedMonths.map(monthName).join(", ")}.</small> : null}
              </li>
            );
          })}
        </ul>
      </Modal>

      <Modal
        open={discardAsk}
        title="¿Descartar los cambios sin guardar?"
        onClose={() => setDiscardAsk(false)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setDiscardAsk(false)}>Seguir editando</button>
            <button type="button" className="btn btn-danger" onClick={() => { setDrafts({}); setRowErrors({}); setDiscardAsk(false); }}>Descartar {dirtyKeys.length} {dirtyKeys.length === 1 ? "fila" : "filas"}</button>
          </>
        }
      >
        <p>Se perderán los valores que ha escrito y no se ha guardado nada.</p>
      </Modal>

      <GuardDialog
        pending={guard.pending}
        saving={busy !== null}
        what="Si cambia el año, el ámbito, el filtro o la página, perderá los cambios de la matriz."
        onStay={guard.clear}
        onDiscard={() => { const p = guard.pending; setDrafts({}); setRowErrors({}); guard.clear(); p?.go(); }}
        onSave={() => { const p = guard.pending; void startReview(() => p?.go()); guard.clear(); }}
      />
    </>
  );
}

function ReadCell({ value, kind, locked }: { value: number | null; kind: ValueKind | null; locked: boolean }) {
  if (value === null) return <td style={{ textAlign: "right", color: "var(--muted)" }}><span aria-hidden="true">—</span><span className="skip">sin informar</span></td>;
  return (
    <td style={{ textAlign: "right", whiteSpace: "nowrap" }} title={kind ? `${KIND_LABEL[kind]}${locked ? " (bloqueado)" : ""}` : undefined}>
      {value}{value === 0 ? <span className="skip"> cero confirmado</span> : null}
      {kind ? <sup style={{ marginLeft: 2, color: "var(--muted)" }} aria-label={KIND_LABEL[kind]}>{KIND_MARK[kind]}</sup> : null}
    </td>
  );
}

/** Acciones compactas de la fila: «Aplicar desde este mes», copiar la base anterior y deshacer. Añaden al borrador; no guardan. */
function RowTools({ r, d, busy, onApply, onCopy, onUndo }: { r: UsuariosRow; d: RowDraft | undefined; busy: boolean; onApply: (month: number, value: number) => void; onCopy: (mode: "SAME_MONTH" | "DECEMBER") => void; onUndo: () => void }) {
  const [month, setMonth] = useState(1);
  const [value, setValue] = useState("");
  const [err, setErr] = useState("");
  const noCopy = busy || Boolean(d && (d.copy !== null || d.applies.length > 0 || Object.keys(d.sets).length > 0));
  return (
    <details className="ed-na ed-tools">
      <summary>Aplicar desde… / copiar</summary>
      <div className="ed-na-box">
        <label className="ed-check">Mes <select className="ed-input" value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label={`Mes desde el que aplicar en ${r.name}`}>{MONTHS.map((m) => <option key={m} value={m}>{MONTH_NAMES[m - 1]}</option>)}</select></label>
        <label className="ed-check">Usuarios <input className="ed-input ed-num" inputMode="numeric" value={value} onChange={(e) => { setValue(e.target.value); setErr(""); }} aria-label={`Valor a aplicar en ${r.name}`} /></label>
        <button type="button" className="ed-mini" onClick={() => { const v = parseUserCount(value.trim()); if (v === null) return setErr("Entero 0 o mayor."); onApply(month, v); setValue(""); }}>Aplicar al borrador</button>
        {err ? <small className="mt-err">{err}</small> : null}
        <small className="muted">Cambia ese mes y los posteriores, sin pisar ajustes explícitos; lo verá en la confirmación.</small>
        <hr />
        <button type="button" className="ed-mini" disabled={noCopy} title={noCopy ? "Deshaga o guarde primero los cambios de esta fila" : undefined} onClick={() => onCopy("SAME_MONTH")}>Copiar base del año anterior (mes a mes)</button>
        <button type="button" className="ed-mini" disabled={noCopy} title={noCopy ? "Deshaga o guarde primero los cambios de esta fila" : undefined} onClick={() => onCopy("DECEMBER")}>Copiar diciembre anterior</button>
        {d ? <button type="button" className="ed-mini" onClick={onUndo}>Deshacer esta fila</button> : null}
      </div>
    </details>
  );
}
