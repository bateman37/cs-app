"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MasterRow } from "@/server/master-table";
import { LINK_LABEL, LINK_STATE_LABEL, type LinkState, type LinkSystem } from "@/domain/master-links";
import { ESTADO_LABEL, ESTADO_VALUES, type Estado } from "@/domain/estado";
import { TERM_LABEL, TERM_OPTIONS, type AliasSystem, type EditChange, type EditError, type EditItem, type TermAttr } from "@/domain/master-edit";
import { GuardDialog, Modal, Toast, newOperationId, useDirtyGuard } from "@/components/edit-kit";
import { previewClientesEditAction, saveClientesEditAction } from "./editor-actions";

/**
 * Tabla de Clientes con edición real en sus celdas (HOTFIX-04 §4). El borrador vive en el navegador y se identifica por CAMPO CANÓNICO
 * (`g:<id>:name`, `c:<id>:SUPPORT`…): un campo compartido que aparece en varias filas es UN solo cambio. Editar, tabular o salir de una celda NO guarda: solo
 * «Guardar cambios» → revisión de servidor → confirmación → guardado atómico. Cada edición recuerda el valor base visto; si los datos limpios se refrescan
 * y cambian bajo una edición, se avisa de conflicto sin perder lo escrito.
 */

type Group = { id: string; name: string };
type NewGroup = { tempId: string; name: string; bc: string; active: boolean };
type NewClient = { tempId: string; group: { id?: string; tempId?: string }; name: string; zdId: string; support: string; hosting: string; complexity: string; wrike: string[]; pap: string[] };
type DraftVal = string | string[] | boolean | null;
type Entry = { base: DraftVal; value: DraftVal };
type Props = {
  rows: MasterRow[];
  totals: { groups: number; clients: number; pendingRows: number; conflicts: number };
  unattributed: { financeRows: number; hoursWithoutGroup: string };
  filters: { q: string; estado: Estado; pendientes: boolean; grupo: string };
  isAdmin: boolean;
  groups: Group[];
  initialNew: "grupo" | "cliente" | null;
  hoursLabel: string;
};

const ALIAS_KEYS: AliasSystem[] = ["WRIKE", "PAP", "ZENDESK_ID"];

const clean = (v: string) => v.replace(/\s+/g, " ").trim();
const cleanList = (xs: string[]) => xs.map(clean).filter(Boolean);
const normList = (xs: string[]) => [...new Set(cleanList(xs).map((x) => x.toLowerCase()))].sort().join("\u0001");
const sameVal = (a: DraftVal, b: DraftVal) => (Array.isArray(a) && Array.isArray(b) ? normList(a) === normList(b) : typeof a === "string" && typeof b === "string" ? clean(a) === clean(b) : a === b);
const pre = (r: MasterRow) => (r.kind === "group" ? "g" : "c");
const keyName = (r: MasterRow) => (r.kind === "group" ? `g:${r.groupId}:name` : `c:${r.id}:name`);
const asList = (v: DraftVal | undefined) => (Array.isArray(v) ? v : []);

function baseOf(r: MasterRow | undefined, field: string): DraftVal {
  if (!r) return null;
  switch (field) {
    case "name": return r.kind === "group" ? r.name : r.name;
    case "active": return r.isActive;
    case "WRIKE": return r.own.wrike;
    case "PAP": return r.own.pap;
    case "ZENDESK_ID": return r.own.zdIds;
    case "SUPPORT": return r.own.support;
    case "HOSTING": return r.own.hosting;
    case "COMPLEXITY": return r.own.complexity;
  }
  if (field.startsWith("NA:")) return r.own.na.includes(field.slice(3) as LinkSystem);
  return null;
}

export function ClientesEditor(props: Props) {
  const { rows, isAdmin, filters } = props;
  const router = useRouter();
  const byKeyRow = useMemo(() => {
    const m = new Map<string, MasterRow>();
    for (const r of rows) m.set(`${pre(r)}:${r.id}`, r);
    return m;
  }, [rows]);
  const groupRowOf = useMemo(() => new Map(rows.filter((r) => r.kind === "group").map((r) => [r.id, r])), [rows]);

  const [draft, setDraft] = useState<Record<string, Entry>>({});
  const [newGroups, setNewGroups] = useState<NewGroup[]>(() => (props.initialNew === "grupo" ? [{ tempId: newOperationId(), name: "", bc: "", active: true }] : []));
  const [newClients, setNewClients] = useState<NewClient[]>(() => (props.initialNew === "cliente" ? [{ tempId: newOperationId(), group: filters.grupo ? { id: filters.grupo } : {}, name: "", zdId: "", support: "", hosting: "", complexity: "", wrike: [], pap: [] }] : []));
  const [errors, setErrors] = useState<Record<string, EditError>>({});
  const [review, setReview] = useState<{ items: EditItem[]; digest: string; operationId: string; changes: EditChange[] } | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "save">(null);
  const [toast, setToast] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [discardAsk, setDiscardAsk] = useState(false);
  const opRef = useRef<string | null>(null);
  const savingLock = useRef(false);

  const dirtyCount = Object.keys(draft).length + newGroups.length + newClients.length;
  const dirty = dirtyCount > 0;
  const guard = useDirtyGuard(dirty);

  // ---- Valor mostrado, base y marca de modificado
  const baseFor = (key: string): DraftVal => {
    const [p, id, ...rest] = key.split(":");
    return baseOf(byKeyRow.get(`${p}:${id}`), rest.join(":"));
  };
  const valueOf = (key: string): DraftVal => (key in draft ? draft[key].value : baseFor(key));
  const stale = (key: string) => key in draft && !sameVal(draft[key].base, baseFor(key));
  const setValue = (key: string, value: DraftVal) => {
    setErrors((e) => (e[key] ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)) : e));
    setDraft((d) => {
      const base = key in d ? d[key].base : baseFor(key);
      if (sameVal(value, base) && !(key in d && !sameVal(d[key].base, baseFor(key)))) {
        const rest = { ...d };
        delete rest[key];
        return rest;
      }
      return { ...d, [key]: { base, value } };
    });
  };

  // ---- Construcción de los cambios del servidor (estado deseado + valor base visto)
  const buildChanges = (): EditChange[] => {
    const out: EditChange[] = [];
    for (const [key, e] of Object.entries(draft)) {
      const [p, id, ...rest] = key.split(":");
      const field = rest.join(":");
      const scope = p === "g" ? "group" : "client";
      if (field === "name") out.push({ op: "name", entity: scope, id, before: String(e.base ?? ""), after: String(e.value ?? "") });
      else if (field === "active") out.push({ op: "active", entity: scope, id, before: Boolean(e.base), after: Boolean(e.value) });
      else if ((ALIAS_KEYS as string[]).includes(field)) out.push({ op: "aliases", scope, id, system: field as AliasSystem, before: cleanList(asList(e.base)), after: cleanList(asList(e.value)) });
      else if (field in TERM_OPTIONS) out.push({ op: "term", scope, id, attribute: field as TermAttr, before: (e.base as string | null) ?? null, after: String(e.value ?? "") });
      else if (field.startsWith("NA:")) out.push({ op: "na", scope, id, system: field.slice(3) as LinkSystem, before: Boolean(e.base), after: Boolean(e.value) });
    }
    for (const g of newGroups) out.push({ op: "newGroup", tempId: g.tempId, name: g.name, bcDenomination: g.bc.trim() || null, active: g.active });
    for (const c of newClients) out.push({ op: "newClient", tempId: c.tempId, group: c.group, name: c.name, zdId: c.zdId, support: c.support, hosting: c.hosting, complexity: c.complexity, wrike: cleanList(c.wrike), pap: cleanList(c.pap) });
    return out;
  };

  const flagErrors = (list: EditError[]) => setErrors(Object.fromEntries(list.map((e) => [e.key, e])));

  const visibleRowsFor = (key: string): number => {
    const [p, id] = key.split(":");
    if (p === "g") return rows.filter((r) => r.groupId === id).length + newClients.filter((c) => c.group.id === id).length;
    return 1;
  };

  // ---- Guardar → revisión de servidor → confirmación
  const startReview = async (afterSave?: () => void) => {
    if (busy || !dirty) return;
    const changes = buildChanges();
    if (changes.length === 0) return;
    setBusy("preview");
    setToast(null);
    const operationId = opRef.current ?? (opRef.current = newOperationId());
    const out = await previewClientesEditAction({ operationId, changes });
    setBusy(null);
    if (out.status === "error") return setToast({ kind: "error", text: out.message });
    if (!out.result.ok) {
      flagErrors(out.result.errors);
      guard.clear();
      const general = out.result.errors.filter((e) => !e.key);
      return setToast({ kind: "error", text: general[0]?.message ?? `Hay ${out.result.errors.length} ${out.result.errors.length === 1 ? "campo" : "campos"} que revisar (marcados en la tabla). No se ha guardado nada.` });
    }
    setErrors({});
    if (out.result.items.length === 0) {
      setDraft({}); setNewGroups([]); setNewClients([]); opRef.current = null; guard.clear();
      return setToast({ kind: "ok", text: "No había diferencias con lo guardado: no se ha cambiado nada." });
    }
    setReview({ items: out.result.items, digest: out.result.digest, operationId, changes });
    pendingAfter.current = afterSave ?? null;
  };
  const pendingAfter = useRef<null | (() => void)>(null);

  const confirmSave = async () => {
    if (!review || savingLock.current) return; // el doble clic no envía dos veces
    savingLock.current = true;
    setBusy("save");
    const out = await saveClientesEditAction({ operationId: review.operationId, changes: review.changes, digest: review.digest });
    savingLock.current = false;
    setBusy(null);
    if (out.status === "error") { setReview(null); return setToast({ kind: "error", text: out.message }); }
    if (!out.result.ok) {
      setReview(null);
      flagErrors(out.result.errors);
      opRef.current = null;
      return setToast({ kind: "error", text: "Otra operación cambió datos mientras revisaba: no se ha guardado nada. Los campos en conflicto están marcados; el resto del borrador se conserva." });
    }
    const n = out.result.alreadyApplied ? review.changes.length : out.result.items.length;
    setReview(null); setDraft({}); setNewGroups([]); setNewClients([]); setErrors({}); opRef.current = null;
    setToast({ kind: "ok", text: `Guardado: ${n} ${n === 1 ? "cambio" : "cambios"}. Las relaciones de lo ya cargado se actualizan automáticamente.` });
    const next = pendingAfter.current;
    pendingAfter.current = null;
    router.refresh();
    if (next) next();
  };

  const discard = () => { setDraft({}); setNewGroups([]); setNewClients([]); setErrors({}); opRef.current = null; };

  // Cualquier edición posterior invalida la operación revisada (obliga a revisar de nuevo).
  useEffect(() => { opRef.current = null; }, [draft, newGroups, newClients]);

  // ---- Navegación entre celdas con Enter (no guarda)
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const t = e.target as HTMLElement;
    if (e.key !== "Enter" || t.tagName === "BUTTON" || t.tagName === "TEXTAREA") return;
    const col = t.getAttribute("data-col");
    if (!col) return;
    e.preventDefault();
    const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-col="${col}"]`));
    const i = all.indexOf(t);
    (all[i + 1] ?? all[i])?.focus();
  };

  // ---- Filtros (con guardia de borrador)
  const [q, setQ] = useState(filters.q);
  const [pend, setPend] = useState(filters.pendientes);
  const hrefFor = (next: Partial<{ q: string; estado: Estado; pendientes: boolean }>) => {
    const f = { q: filters.q, estado: filters.estado, pendientes: filters.pendientes, ...next };
    const u = new URLSearchParams();
    if (f.q) u.set("q", f.q);
    if (f.estado !== "activos") u.set("estado", f.estado);
    if (f.pendientes) u.set("pendientes", "1");
    if (filters.grupo) u.set("grupo", filters.grupo);
    const s = u.toString();
    return `/administracion/clientes${s ? `?${s}` : ""}`;
  };

  const groupsForSelect: Group[] = [...props.groups, ...newGroups.filter((g) => g.name.trim()).map((g) => ({ id: `tmp:${g.tempId}`, name: `${g.name.trim()} (nuevo)` }))];

  // ---------------------------------------------------------------- Celdas
  const err = (k: string) => (errors[k] ? <small className={`mt-err${errors[k].kind === "CONFLICT" ? " mt-err-conf" : ""}`} role="alert">{errors[k].message}</small> : stale(k) ? <small className="mt-err mt-err-conf">Cambiado por otra persona: ahora es «{Array.isArray(baseFor(k)) ? (baseFor(k) as string[]).join(" · ") || "vacío" : String(baseFor(k) ?? "vacío")}». Revise su valor.</small> : null);

  const textCell = (k: string, col: string, label: string, max = 200) => {
    const v = String(valueOf(k) ?? "");
    return (
      <div className={`ed-cell${k in draft ? " mt-dirty" : ""}`}>
        <input className="ed-input" data-col={col} aria-label={label} value={v} maxLength={max} disabled={!isAdmin} onChange={(e) => setValue(k, e.target.value)} onKeyDown={onKeyDown} />
        {err(k)}
      </div>
    );
  };

  const selectCell = (k: string, attr: TermAttr, col: string) => {
    const v = String(valueOf(k) ?? "");
    const baseV = baseFor(k);
    return (
      <div className={`ed-cell${k in draft ? " mt-dirty" : ""}`}>
        <select className="ed-input" data-col={col} aria-label={TERM_LABEL[attr]} value={v} disabled={!isAdmin} onChange={(e) => setValue(k, e.target.value)} onKeyDown={onKeyDown}>
          {baseV === null ? <option value="">—</option> : null}
          {TERM_OPTIONS[attr].map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
        {err(k)}
      </div>
    );
  };

  const aliasCell = (k: string, col: string, label: string, inherited?: string[], single?: boolean) => {
    const list = asList(valueOf(k));
    const shown = list.length === 0 ? [""] : list;
    const setAt = (i: number, v: string) => setValue(k, shown.map((x, j) => (j === i ? v : x)));
    return (
      <div className={`ed-cell${k in draft ? " mt-dirty" : ""}`}>
        {shown.map((v, i) => (
          <div className="ed-alias" key={i}>
            <input className="ed-input" data-col={col} aria-label={`${label}${shown.length > 1 ? ` ${i + 1}` : ""}`} value={v} maxLength={300} disabled={!isAdmin} inputMode={single ? "numeric" : undefined} onChange={(e) => setAt(i, e.target.value)} onKeyDown={onKeyDown} />
            {isAdmin && !single && shown.length > 1 ? <button type="button" className="ed-mini" title="Quitar este valor" aria-label={`Quitar ${label} ${i + 1}`} onClick={() => setValue(k, shown.filter((_, j) => j !== i))}>✕</button> : null}
          </div>
        ))}
        {isAdmin && !single ? <button type="button" className="ed-mini ed-add" onClick={() => setValue(k, [...shown, ""])} title={`Añadir otro valor de ${label}`}>＋ otro</button> : null}
        {inherited && inherited.length > 0 ? <small className="mt-inh" title="Equivalencia del Grupo: se edita en la fila del Grupo">del Grupo: {inherited.join(" · ")}</small> : null}
        {err(k)}
      </div>
    );
  };

  const statusCell = (r: MasterRow) => {
    const k = `${pre(r)}:${r.id}:active`;
    const active = Boolean(valueOf(k));
    const relevant: LinkSystem[] = r.kind === "group" ? (r.clients > 0 ? ["WRIKE", "PAP"] : ["WRIKE", "PAP", "SUPPORT", "HOSTING"]) : ["WRIKE", "ZENDESK", "PAP", "SUPPORT", "HOSTING"];
    const conflict = (Object.values(r.state) as LinkState[]).includes("CONFLICT");
    return (
      <div className={`ed-cell${k in draft ? " mt-dirty" : ""}`}>
        <label className="ed-check"><input type="checkbox" checked={active} disabled={!isAdmin} onChange={(e) => setValue(k, e.target.checked)} data-col="active" onKeyDown={onKeyDown} /> {active ? "Activo" : "Inactivo"}</label>
        {r.isActive && !r.effectiveActive ? <small className="mt-inh" title="El Grupo o sus Clientes están inactivos">efectivo: inactivo</small> : null}
        <span className="ed-chips">
          {r.pending === 0 ? <span className="mt-chip mt-ok"><span aria-hidden="true">✓ </span>Completo</span> : <span className="mt-chip mt-miss" title="Sistemas sin informar o en conflicto"><span aria-hidden="true">○ </span>{r.pending} {r.pending === 1 ? "pendiente" : "pendientes"}</span>}
          {conflict ? <span className="mt-chip mt-conf" title="Una equivalencia está asignada a más de un Grupo o un dato tiene valores distintos: corrija la celda en conflicto">⚠ conflicto</span> : null}
        </span>
        {isAdmin ? (
          <details className="ed-na">
            <summary>No aplica</summary>
            <div className="ed-na-box">
              {relevant.map((s) => {
                const nk = `${pre(r)}:${r.id}:NA:${s}`;
                return (
                  <label key={s} className="ed-check">
                    <input type="checkbox" checked={Boolean(valueOf(nk))} onChange={(e) => setValue(nk, e.target.checked)} /> {LINK_LABEL[s]} <small className="muted">({LINK_STATE_LABEL[r.state[s]]})</small>
                  </label>
                );
              })}
              {relevant.map((x) => <span key={x}>{err(`${pre(r)}:${r.id}:NA:${x}`)}</span>)}
            </div>
          </details>
        ) : null}
      </div>
    );
  };

  const grpOnly = (r: MasterRow) => r.kind === "group" && r.clients > 0;
  const inClients = <span className="mt-none">en sus Clientes</span>;

  const setNewClient = (tempId: string, patch: Partial<NewClient>) => setNewClients((l) => l.map((c) => (c.tempId === tempId ? { ...c, ...patch } : c)));
  const setNewGroup = (tempId: string, patch: Partial<NewGroup>) => setNewGroups((l) => l.map((g) => (g.tempId === tempId ? { ...g, ...patch } : g)));
  const addClientDraft = (groupId?: string) => setNewClients((l) => [...l, { tempId: newOperationId(), group: groupId ? { id: groupId } : {}, name: "", zdId: "", support: "", hosting: "", complexity: "", wrike: [], pap: [] }]);

  const newGroupRow = (g: NewGroup) => {
    const k = `new:${g.tempId}`;
    return (
      <tr key={`ng-${g.tempId}`} className="mt-group mt-new-row">
        <td><div className="ed-cell mt-dirty"><input className="ed-input" data-col="A" aria-label="Nuevo Grupo: nombre" placeholder="Nombre del Grupo" value={g.name} maxLength={200} onChange={(e) => setNewGroup(g.tempId, { name: e.target.value })} onKeyDown={onKeyDown} />{err(`${k}:name`)}</div></td>
        <td colSpan={2}><div className="ed-cell mt-dirty"><input className="ed-input" aria-label="Nuevo Grupo: denominación BC" placeholder="Denominación BC (opcional; por defecto el nombre)" value={g.bc} maxLength={200} onChange={(e) => setNewGroup(g.tempId, { bc: e.target.value })} onKeyDown={onKeyDown} />{err(`${k}:bc`)}</div></td>
        <td colSpan={5}><span className="mt-none">Nuevo Grupo (borrador): se crea sin Clientes y queda como fila pendiente de completar.</span></td>
        <td>
          <label className="ed-check"><input type="checkbox" checked={g.active} onChange={(e) => setNewGroup(g.tempId, { active: e.target.checked })} /> Activo</label>
          <button type="button" className="ed-mini" onClick={() => { setNewGroups((l) => l.filter((x) => x.tempId !== g.tempId)); setNewClients((l) => l.filter((c) => c.group.tempId !== g.tempId)); }}>Quitar borrador</button>
        </td>
      </tr>
    );
  };

  const newClientRow = (c: NewClient) => {
    const k = `new:${c.tempId}`;
    const gv = c.group.id ?? (c.group.tempId ? `tmp:${c.group.tempId}` : "");
    return (
      <tr key={`nc-${c.tempId}`} className="mt-client mt-new-row">
        <td>
          <div className="ed-cell mt-dirty">
            <select className="ed-input" data-col="A" aria-label="Nuevo Cliente: Grupo" value={gv} onChange={(e) => setNewClient(c.tempId, { group: e.target.value.startsWith("tmp:") ? { tempId: e.target.value.slice(4) } : e.target.value ? { id: e.target.value } : {} })} onKeyDown={onKeyDown}>
              <option value="">Elija el Grupo…</option>
              {groupsForSelect.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            {err(`${k}:group`)}
          </div>
        </td>
        <td>
          <div className="ed-cell mt-dirty">
            {(c.wrike.length ? c.wrike : [""]).map((v, i, a) => <input key={i} className="ed-input" data-col="B" aria-label="Nuevo Cliente: Wrike (del Grupo)" placeholder="Wrike (del Grupo)" value={v} onChange={(e) => setNewClient(c.tempId, { wrike: a.map((x, j) => (j === i ? e.target.value : x)) })} onKeyDown={onKeyDown} />)}
            {err(`${k}:WRIKE`)}
          </div>
        </td>
        <td><div className="ed-cell mt-dirty"><input className="ed-input" data-col="C" aria-label="Nuevo Cliente: ID organización Zendesk" placeholder="ID Zendesk" inputMode="numeric" value={c.zdId} onChange={(e) => setNewClient(c.tempId, { zdId: e.target.value })} onKeyDown={onKeyDown} />{err(`${k}:zdId`)}</div></td>
        <td><div className="ed-cell mt-dirty"><input className="ed-input" data-col="D" aria-label="Nuevo Cliente: nombre Zendesk" placeholder="Nombre del Cliente" value={c.name} maxLength={200} onChange={(e) => setNewClient(c.tempId, { name: e.target.value })} onKeyDown={onKeyDown} />{err(`${k}:name`)}</div></td>
        {(["SUPPORT", "HOSTING"] as const).map((attr) => (
          <td key={attr}>
            <div className="ed-cell mt-dirty">
              <select className="ed-input" data-col={attr === "SUPPORT" ? "E" : "F"} aria-label={TERM_LABEL[attr]} value={attr === "SUPPORT" ? c.support : c.hosting} onChange={(e) => setNewClient(c.tempId, attr === "SUPPORT" ? { support: e.target.value } : { hosting: e.target.value })} onKeyDown={onKeyDown}>
                <option value="">—</option>
                {TERM_OPTIONS[attr].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {err(`${k}:${attr}`)}
            </div>
          </td>
        ))}
        <td>
          <div className="ed-cell mt-dirty">
            {(c.pap.length ? c.pap : [""]).map((v, i, a) => <input key={i} className="ed-input" data-col="G" aria-label="Nuevo Cliente: PAP" placeholder="PAP" value={v} onChange={(e) => setNewClient(c.tempId, { pap: a.map((x, j) => (j === i ? e.target.value : x)) })} onKeyDown={onKeyDown} />)}
            {err(`${k}:PAP`)}
          </div>
        </td>
        <td>
          <div className="ed-cell mt-dirty">
            <select className="ed-input" data-col="H" aria-label="Tipo (complejidad)" value={c.complexity} onChange={(e) => setNewClient(c.tempId, { complexity: e.target.value })} onKeyDown={onKeyDown}>
              <option value="">—</option>
              {TERM_OPTIONS.COMPLEXITY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {err(`${k}:COMPLEXITY`)}
          </div>
        </td>
        <td><span className="mt-none">Nuevo Cliente (borrador)</span> <button type="button" className="ed-mini" onClick={() => setNewClients((l) => l.filter((x) => x.tempId !== c.tempId))}>Quitar borrador</button></td>
      </tr>
    );
  };

  // ---------------------------------------------------------------- Render
  const clientDraftsAt = (groupId: string) => newClients.filter((c) => c.group.id === groupId);
  const loose = newClients.filter((c) => !c.group.id);

  return (
    <div className="mt-page">
      <header className="mt-head">
        <h1>Clientes y Grupos</h1>
        <p className="muted">{isAdmin ? "Edite las celdas y pulse «Guardar cambios»: se revisa y se confirma antes de guardar." : "Consulta: puede ver los maestros pero no modificarlos."} Al guardar, lo ya cargado se atribuye solo; no hay que volver a Cargas.</p>
      </header>
      <div className="mt-tools">
        <form className="mt-filters" method="get" action="/administracion/clientes" onSubmit={(e) => { e.preventDefault(); guard.request(() => router.push(hrefFor({ q: q.trim().slice(0, 100), pendientes: pend }))); }}>
          <label className="field"><span>Buscar</span><input name="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Grupo, Cliente, ID Zendesk, Wrike o PAP" maxLength={100} /></label>
          <span className="chips-group" role="group" aria-label="Estado comercial">
            <span className="chips-title">Estado</span>
            {ESTADO_VALUES.map((v) => <Link key={v} className={filters.estado === v ? "chip chip-on" : "chip"} aria-pressed={filters.estado === v} href={hrefFor({ estado: v })} prefetch={false}>{ESTADO_LABEL[v]}</Link>)}
          </span>
          <label className="mt-check"><input type="checkbox" checked={pend} onChange={(e) => setPend(e.target.checked)} /> Solo con enlaces pendientes</label>
          <button className="btn btn-secondary" type="submit">Filtrar</button>
          {filters.grupo ? <Link className="btn btn-secondary" href="/administracion/clientes" prefetch={false}>Ver todos los Grupos</Link> : null}
        </form>
      </div>
      {isAdmin ? (
        <div className="ed-bar" role="region" aria-label="Edición de la tabla">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNewGroups((l) => [...l, { tempId: newOperationId(), name: "", bc: "", active: true }])}>Nuevo grupo</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => addClientDraft(filters.grupo || undefined)}>Añadir Cliente/proyecto</button>
          <span className="ed-spacer" />
          <span className="ed-count" role="status" aria-live="polite">{dirty ? `${dirtyCount} ${dirtyCount === 1 ? "cambio sin guardar" : "cambios sin guardar"}` : "Sin cambios"}</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={!dirty || busy !== null} onClick={() => setDiscardAsk(true)}>Cancelar cambios</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || busy !== null} aria-busy={busy === "preview"} onClick={() => void startReview()}>{busy === "preview" ? "Revisando…" : `Guardar cambios (${dirtyCount})`}</button>
        </div>
      ) : null}
      {toast ? <Toast kind={toast.kind} text={toast.text} onDone={() => setToast(null)} /> : null}
      <p className="mt-sum" role="status">
        {props.totals.groups} {props.totals.groups === 1 ? "Grupo" : "Grupos"} · {props.totals.clients} {props.totals.clients === 1 ? "Cliente" : "Clientes"} · <strong>{props.totals.pendingRows}</strong> con enlaces pendientes · {props.totals.conflicts} con conflicto
        {props.unattributed.financeRows > 0 || Number(props.unattributed.hoursWithoutGroup) > 0 ? (
          <> · Sin atribuir a ningún Grupo: {props.unattributed.financeRows > 0 ? <strong>{props.unattributed.financeRows} filas financieras</strong> : "0 filas financieras"} · <strong>{props.hoursLabel} h</strong> (completar el enlace las atribuye automáticamente)</>
        ) : null}
      </p>
      {rows.length === 0 && newGroups.length === 0 && newClients.length === 0 ? (
        <div className="empty"><p>{filters.q || filters.pendientes || filters.estado !== "activos" ? "Ninguna fila coincide con los filtros." : "Todavía no hay Grupos. Use «Nuevo grupo» o importe la tabla de Clientes en Cargas."}</p></div>
      ) : (
        <div className="mt-scroll" tabIndex={0} role="region" aria-label="Tabla de Clientes y Grupos, editable y desplazable">
          <table className="mt-table ed-table">
            <caption className="visually-hidden">Grupos BC y sus Clientes: cada celda es editable; los cambios no se guardan hasta confirmarlos</caption>
            <thead>
              <tr>
                <th scope="col">Grupo Cliente</th><th scope="col">Wrike</th><th scope="col">Id_Zendesk</th><th scope="col">Zendesk</th><th scope="col">Nivel de Servicio</th><th scope="col">Servidor</th><th scope="col">PAP</th><th scope="col">Tipo</th><th scope="col">Activo · enlaces</th>
              </tr>
            </thead>
            <tbody>
              {newGroups.map((g) => newGroupRow(g))}
              {newClients.filter((c) => c.group.tempId).map((c) => newClientRow(c))}
              {loose.filter((c) => !c.group.tempId).map((c) => newClientRow(c))}
              {rows.map((r) => {
                const g = r.kind === "group";
                const gKey = `g:${r.groupId}:name`;
                const hasKids = grpOnly(r);
                return [
                  <tr key={`${r.kind}-${r.id}`} className={`${g ? "mt-group" : "mt-client"}${r.effectiveActive ? "" : " mt-off"}`}>
                    <td>
                      {textCell(gKey, "A", `Grupo Cliente de ${r.name}`)}
                      <small className="mt-kind">
                        {g ? (r.clients === 0 ? "Grupo sin Clientes" : `Grupo · ${r.clients} ${r.clients === 1 ? "Cliente" : "Clientes"}`) : "Cliente"}
                        {isAdmin && g ? <button type="button" className="ed-mini" onClick={() => addClientDraft(r.id)}>+ Cliente</button> : null}
                        {visibleRowsFor(gKey) > 1 ? <span title="Campo compartido: editarlo en cualquiera de sus filas es un solo cambio"> · nombre compartido ({visibleRowsFor(gKey)} filas)</span> : null}
                      </small>
                    </td>
                    <td>{aliasCell(`${pre(r)}:${r.id}:WRIKE`, "B", "Wrike", r.kind === "client" ? groupRowOf.get(r.groupId)?.own.wrike : undefined)}</td>
                    <td className="mt-num">{g && r.clients > 0 ? inClients : g ? <span className="mt-none" title="El ID de organización pertenece a un Cliente">— (añada un Cliente)</span> : aliasCell(`c:${r.id}:ZENDESK_ID`, "C", "ID organización Zendesk", undefined, true)}</td>
                    <td>{g ? (hasKids ? inClients : <span className="mt-none">—</span>) : textCell(keyName(r), "D", `Zendesk: nombre de ${r.name}`)}</td>
                    <td>{hasKids ? inClients : selectCell(`${pre(r)}:${r.id}:SUPPORT`, "SUPPORT", "E")}</td>
                    <td>{hasKids ? inClients : selectCell(`${pre(r)}:${r.id}:HOSTING`, "HOSTING", "F")}</td>
                    <td>{aliasCell(`${pre(r)}:${r.id}:PAP`, "G", "PAP", r.kind === "client" ? groupRowOf.get(r.groupId)?.own.pap : undefined)}</td>
                    <td>{hasKids ? inClients : selectCell(`${pre(r)}:${r.id}:COMPLEXITY`, "COMPLEXITY", "H")}</td>
                    <td>{statusCell(r)}</td>
                  </tr>,
                  ...(g ? clientDraftsAt(r.id).map((c) => newClientRow(c)) : []),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">Historial, vigencias y ajustes excepcionales: abra el Grupo o el Cliente desde su nombre en <Link href="/administracion/configuracion?seccion=herramientas">Herramientas técnicas</Link> o la ficha. <Link href="/administracion/cargas">Importar la tabla de Clientes</Link></p>

      <Modal
        open={review !== null}
        wide
        title="¿Estás seguro de que deseas guardar estos cambios?"
        onClose={() => { setReview(null); pendingAfter.current = null; }}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => { setReview(null); pendingAfter.current = null; }} disabled={busy === "save"}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={() => void confirmSave()} disabled={busy === "save"} aria-busy={busy === "save"}>{busy === "save" ? "Guardando…" : "Sí, guardar"}</button>
          </>
        }
      >
        {review ? (
          <>
            <p className="muted">{review.items.length} {review.items.length === 1 ? "cambio" : "cambios"} en una sola operación: se guardan todos o ninguno. Cancelar cierra sin escribir y conserva su borrador.</p>
            <ul className="ed-review">
              {review.items.map((i) => {
                const n = i.key.startsWith("g:") ? visibleRowsFor(i.key) : 1;
                return (
                  <li key={i.key}>
                    <strong>{i.entity}</strong> · {i.field}
                    <div className="ed-diff"><span className="ed-before">{i.before}</span> <span aria-hidden="true">→</span> <span className="ed-after">{i.after}</span></div>
                    {n > 1 ? <small className="muted">Campo compartido: se guarda una vez y afecta a {n} filas visibles.</small> : null}
                    {i.notes.map((t) => <small key={t} className="muted" style={{ display: "block" }}>{t}</small>)}
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </Modal>

      <Modal
        open={discardAsk}
        title="¿Descartar los cambios sin guardar?"
        onClose={() => setDiscardAsk(false)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setDiscardAsk(false)}>Seguir editando</button>
            <button type="button" className="btn btn-danger" onClick={() => { discard(); setDiscardAsk(false); }}>Descartar {dirtyCount} {dirtyCount === 1 ? "cambio" : "cambios"}</button>
          </>
        }
      >
        <p>Se perderán los valores que ha escrito y no se ha guardado nada.</p>
      </Modal>

      <GuardDialog
        pending={guard.pending}
        saving={busy !== null}
        what="Si sale ahora, perderá los cambios de la tabla."
        onStay={guard.clear}
        onDiscard={() => { const p = guard.pending; discard(); guard.clear(); p?.go(); }}
        onSave={() => { const p = guard.pending; void startReview(() => p?.go()); guard.clear(); }}
      />
    </div>
  );
}

export type { Props as ClientesEditorProps };
