import { ActionForm, CheckboxField, SelectField, SubmitButton, TextField } from "@/components/form-kit";
import { FAMILIES, FAMILY_LABEL, METRIC_BY_ID, PROFILE_KEYS, PROFILE_LABEL, PULSE_METRICS, REFERENCE_PLANS, directionOf } from "@/domain/pulse-catalog";
import { VALUE_LABEL } from "@/domain/catalogs";
import { first, type SearchParams } from "@/lib/format";
import { prisma } from "@/lib/db";
import { getActive, getDraft } from "@/server/pulse/config";
import { describeReference } from "@/server/pulse/service";
import { savePulseDraftAction } from "./actions";
import { RevisionPanel } from "./revisions";

const DIR_LABEL = { LOWER: "Menor = menor carga (mejor)", HIGHER: "Mayor = mejor", NONE: "Sin juicio" } as const;

export async function PulseSection({ userId, isAdmin }: { userId: string; isAdmin: boolean; sp: SearchParams }) {
  const active = await getActive(prisma, "PULSE");
  const draft = isAdmin ? await getDraft(userId, "PULSE") : null;
  const cfg = draft?.payload ?? active.payload;
  const [teams, levels] = await Promise.all([
    prisma.staffCatalogItem.findMany({ where: { kind: "TEAM" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.staffCatalogItem.findMany({ where: { kind: "LEVEL" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const nameOf = (list: { id: string; name: string }[], id: string | null) => (id === null ? "cualquiera" : (list.find((x) => x.id === id)?.name ?? "(desconocido)"));
  const teamOptions = [{ value: "", label: "Cualquiera" }, ...teams.map((t) => ({ value: t.id, label: t.name }))];
  const levelOptions = [{ value: "", label: "Cualquiera" }, ...levels.map((t) => ({ value: t.id, label: t.name }))];
  const pmoOptions = [{ value: "", label: "Cualquiera" }, { value: "si", label: "Pertenece a PMO" }, { value: "no", label: "No pertenece a PMO" }];
  return (
    <>
      <section className="card" aria-labelledby="p-vigente">
        <h2 id="p-vigente">Pulse Rent · revisión activa {active.revisionNo}{!active.persisted ? " (inicial, sin activaciones)" : ""}</h2>
        <p className="muted">
          Referencias estadísticas, dirección de cada métrica y selección canónica de perfiles. Una nueva revisión activa <strong>invalida las bandas anteriores</strong> (la referencia de datos incluye el manifiesto de revisiones). No se configuran fórmulas.
        </p>
        <h3>Referencias estadísticas</h3>
        <ul>
          {active.payload.references.map((r) => (
            <li key={r.id}><strong>{r.label}</strong> <span className={`badge ${r.origin === "CONFIRMADA" ? "badge-ok" : "badge-int"}`}>{r.origin === "CONFIRMADA" ? "confirmada" : "personalizada"}</span> — {describeReference(r)}</li>
          ))}
        </ul>
        <h3>Perfiles canónicos</h3>
        <ul>
          {PROFILE_KEYS.map((k) => {
            const s = active.payload.profiles[k] ?? [];
            return (
              <li key={k}>
                <strong>{PROFILE_LABEL[k]}</strong>:{" "}
                {s.length === 0 ? <span className="badge badge-warn">perfil sin configurar</span> : s.map((x, i) => <span key={i}>{i > 0 ? " · " : ""}equipo {nameOf(teams, x.teamId)}, nivel {nameOf(levels, x.levelId)}{x.pmo === true ? ", PMO" : x.pmo === false ? ", no PMO" : ""}</span>)}
              </li>
            );
          })}
        </ul>
        <p className="hint">Mientras un perfil esté sin configurar, sus métricas muestran «perfil sin configurar»: nunca un cero. El PMO de rol desconocido permanece en el total PMO elegible.</p>
      </section>

      {isAdmin ? (
        <section className="card" aria-labelledby="p-editor">
          <h2 id="p-editor">Editar el borrador</h2>
          <p className="muted">Guardar un borrador no cambia lo activo. {draft ? `Edita el borrador versión ${draft.version}.` : "Parte de la revisión activa."}</p>
          <ActionForm action={savePulseDraftAction} hidden={{ expectedDraftVersion: draft?.version ?? "", pulse_present: "1" }}>
            <fieldset>
              <legend>Selección canónica de perfiles</legend>
              <p className="hint">Hasta dos selectores por perfil (equipo y nivel del catálogo de personal, o pertenencia a PMO). Una actividad cuenta en el primer perfil que la captura, en el orden de esta lista.</p>
              {PROFILE_KEYS.map((k) => (
                <div key={k}>
                  <h3>{PROFILE_LABEL[k]}</h3>
                  {[0, 1].map((slot) => {
                    const s = cfg.profiles[k]?.[slot];
                    return (
                      <div key={slot} className="filters-grid">
                        <SelectField name={`p_${k}_${slot}_team`} label={`Equipo (selector ${slot + 1})`} initial={s?.teamId ?? ""} options={teamOptions} />
                        <SelectField name={`p_${k}_${slot}_level`} label={`Nivel (selector ${slot + 1})`} initial={s?.levelId ?? ""} options={levelOptions} />
                        <SelectField name={`p_${k}_${slot}_pmo`} label={`PMO (selector ${slot + 1})`} initial={s?.pmo === true ? "si" : s?.pmo === false ? "no" : ""} options={pmoOptions} />
                      </div>
                    );
                  })}
                </div>
              ))}
            </fieldset>
            <fieldset>
              <legend>Referencias</legend>
              <SelectField name="default_ref" label="Referencia predeterminada" initial={cfg.defaultReference} options={cfg.references.map((r) => ({ value: r.id, label: r.label }))} />
              {cfg.references.filter((r) => r.origin === "PERSONALIZADA").map((r) => <CheckboxField key={r.id} name={`ref_del_${r.id}`} label={`Eliminar la referencia personalizada «${r.label}»`} />)}
              <h3>Nueva referencia personalizada</h3>
              <div className="filters-grid">
                <TextField name="nr_id" label="Identificador (minúsculas, números, «_»)" />
                <TextField name="nr_label" label="Nombre" />
                <TextField name="nr_product" label="Producto (opcional)" />
              </div>
              <div className="quick">
                {REFERENCE_PLANS.map((p) => <CheckboxField key={p} name={`nr_plan_${p}`} label={VALUE_LABEL[p]} />)}
                <CheckboxField name="nr_host_OP" label="OP" /><CheckboxField name="nr_host_CLOUD" label="CLOUD" />
                <CheckboxField name="nr_cx_BASIC" label="Basic" /><CheckboxField name="nr_cx_MEDIUM" label="Medium" /><CheckboxField name="nr_cx_ENTERPRISE" label="Enterprise" />
              </div>
              <CheckboxField name="nr_homog" label="Solo grupos homogéneos (sin mezcla ni desconocidos)" />
              <CheckboxField name="nr_nosilver" label="Plan conocido y distinto de Silver" />
            </fieldset>
            <fieldset>
              <legend>Dirección de cada métrica</legend>
              <p className="hint">Una dirección distinta de la del catálogo se identifica como <strong>personalizada</strong>. El stock de usuarios y las horas brutas son contexto (sin juicio).</p>
              {FAMILIES.map((f) => (
                <div key={f}>
                  <h3>{FAMILY_LABEL[f]}</h3>
                  <div className="filters-grid">
                    {PULSE_METRICS.filter((m) => m.family === f).map((m) => (
                      <SelectField key={m.id} name={`dir_${m.id}`} label={`${m.id} · ${m.label}`} initial={directionOf(METRIC_BY_ID.get(m.id)!, cfg).direction} options={(Object.keys(DIR_LABEL) as (keyof typeof DIR_LABEL)[]).map((d) => ({ value: d, label: DIR_LABEL[d] }))} />
                    ))}
                  </div>
                </div>
              ))}
            </fieldset>
            <div className="form-actions"><SubmitButton>Guardar borrador</SubmitButton></div>
          </ActionForm>
        </section>
      ) : (
        <p className="muted">Su perfil puede consultar qué reglas se aplican; solo un Administrador puede guardar borradores o activar revisiones.</p>
      )}
      <RevisionPanel userId={userId} family="PULSE" isAdmin={isAdmin} />
    </>
  );
}
export { first };
