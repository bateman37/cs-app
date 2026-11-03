import { ActionForm, CheckboxField, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form-kit";
import {
  DIAGNOSIS_FAMILIES, INDICATOR_KEYS, INDICATOR_NAME, PROPOSED_HEALTH_MAPPING, COLOR_LABEL, QSCOPE_LABEL, QUALITY_SCOPES, UNIT_LABEL, BACKLOG_UNIT, METRIC_UNIT, effectiveWeights, simulateQuality, weightUnits,
  type IndicatorKey, type QScope, type QualityConfig, type SimInput, type ThresholdRule,
} from "@/domain/quality-config";
import { PROFILE_KEYS, PROFILE_LABEL } from "@/domain/pulse-catalog";
import { first, type SearchParams } from "@/lib/format";
import { getActive, getDraft } from "@/server/pulse/config";
import { formatAgeBands } from "@/server/pulse/forms";
import { prisma } from "@/lib/db";
import { saveQualityDraftAction } from "./actions";
import { RevisionPanel } from "./revisions";

const METHOD = [{ value: "ABSOLUTE", label: "Valores absolutos (a < b)" }, { value: "PERCENTILE", label: "Percentiles de una referencia" }];
const DIR = [{ value: "LOWER_BETTER", label: "Menor es mejor" }, { value: "HIGHER_BETTER", label: "Mayor es mejor" }];
const CAL = [{ value: "SIN_CALIBRAR", label: "Sin calibrar (no colorea)" }, { value: "CALIBRADO", label: "Calibrado por el Administrador" }];
const COLORS = [{ value: "green", label: "Verde" }, { value: "yellow", label: "Amarillo" }, { value: "red", label: "Rojo" }];
const pct = (v: string) => (v === "0" ? "0" : v.replace(/(\.\d{2})\d+$/, "$1").replace(".", ","));

/** Campos de una regla de umbral de un ámbito; `prefix` identifica el campo (r_<indicador>_<ámbito>). La unidad la fija el catálogo. */
function RuleFields({ prefix, rule, title }: { prefix: string; rule: ThresholdRule; title: string }) {
  return (
    <div className="rule-block">
      <h4>{title}</h4>
      <p className="hint">Unidad de los límites: <strong>{UNIT_LABEL[rule.unit]}</strong>.</p>
      <div className="filters-grid">
        <SelectField name={`${prefix}_method`} label="Método" initial={rule.method === "CATEGORICAL" ? "ABSOLUTE" : rule.method} options={METHOD} />
        <SelectField name={`${prefix}_dir`} label="Dirección" initial={rule.direction} options={DIR} />
        <TextField name={`${prefix}_a`} label="Límite a (o percentil)" initial={rule.a ?? ""} />
        <TextField name={`${prefix}_b`} label="Límite b (o percentil)" initial={rule.b ?? ""} />
        <TextField name={`${prefix}_ref`} label="Referencia (id de Pulse, para percentiles)" initial={rule.referenceId ?? ""} help="Sus criterios son los de Pulse Rent; los valores se calculan para esta métrica." />
        <TextField name={`${prefix}_min`} label="Muestra mínima para colorear" initial={rule.minSample === null ? "" : String(rule.minSample)} help="Obligatoria con percentiles; vacío = sin mínimo." />
        <SelectField name={`${prefix}_cal`} label="Estado" initial={rule.calibration} options={CAL} />
      </div>
    </div>
  );
}

export async function CalidadSection({ userId, isAdmin, sp }: { userId: string; isAdmin: boolean; sp: SearchParams }) {
  const active = await getActive(prisma, "QUALITY");
  const draft = isAdmin ? await getDraft(userId, "QUALITY") : null;
  const cfg: QualityConfig = draft?.payload ?? active.payload;
  const wu = weightUnits({ mode: cfg.weights.mode, custom: cfg.weights.custom as Record<IndicatorKey, string> });
  const eff = wu.units ? effectiveWeights(wu.units, Object.fromEntries(INDICATOR_KEYS.map((k) => [k, "AVAILABLE"])) as Record<IndicatorKey, "AVAILABLE">) : null;
  const effNoHealth = wu.units ? effectiveWeights(wu.units, Object.fromEntries(INDICATOR_KEYS.map((k) => [k, k === "HEALTH" ? "BLANK" : "AVAILABLE"])) as Record<IndicatorKey, "AVAILABLE" | "BLANK">) : null;

  // Simulación: escenarios manuales por la URL (GET); no escribe nada.
  const simulate = first(sp.sim) === "1";
  const simScope: QScope = first(sp.ss) === "CLIENTE" ? "CLIENTE" : "GRUPO";
  const scenario = Object.fromEntries(
    INDICATOR_KEYS.map((k) => [k, { availability: (first(sp[`sa_${k}`]) || "AVAILABLE") as SimInput["availability"], value: first(sp[`sv_${k}`]), backlogValue: first(sp[`sb_${k}`]), backlogProblemValue: first(sp[`sbp_${k}`]), reference: first(sp[`sr_${k}`]) } satisfies SimInput]),
  ) as Record<IndicatorKey, SimInput>;
  const sim = simulate ? simulateQuality(cfg, scenario, simScope) : null;

  return (
    <>
      <section className="card" aria-labelledby="q-vigente">
        <h2 id="q-vigente">Calidad · revisión activa {active.revisionNo}{!active.persisted ? " (inicial, sin activaciones)" : ""}</h2>
        <p className="muted">
          Seis indicadores estables: {INDICATOR_KEYS.map((k) => INDICATOR_NAME[k]).join(", ")}. No hay séptimo indicador de rentabilidad ni peso para el backlog. El dashboard está en <a href="/calidad">Calidad</a>; aquí se <strong>configura, simula y activa</strong> (el Administrador elige y activa; no hay otra aprobación).
        </p>
        <dl className="kv">
          <dt>Pesos</dt>
          <dd>
            {active.payload.weights.mode === "EQUAL" ? <>Iguales: cada uno <strong>1/6</strong> (16,666…%; total 100 %) <span className="badge badge-ok">confirmado</span></> : <>Personalizados <span className="badge badge-int">elegido por el Administrador</span></>}
          </dd>
          <dt>Sin Client Health</dt>
          <dd>Se redistribuye <strong>solo su peso</strong> entre los otros cinco (iguales: 5 × 20 %). Una fuente técnica ausente, un parcial o un Health presente sin calibrar <strong>conservan su peso</strong>: el global no se publica completo y se muestra la cobertura.</dd>
          <dt>Umbrales</dt>
          <dd>{QUALITY_SCOPES.map((sc) => `${QSCOPE_LABEL[sc]}: ${INDICATOR_KEYS.filter((k) => k !== "HEALTH" && active.payload.indicators[k].rules[sc].calibration === "CALIBRADO").length} de 5`).join(" · ")} calibrados <span className="badge badge-warn">propuesta / sin calibrar</span> — sin calibrar no hay color, nunca verde por defecto.</dd>
          {active.payload.adapter ? (<><dt>Adaptador</dt><dd><ul>{active.payload.adapter.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></dd></>) : null}
          <dt>Global</dt>
          <dd>{active.payload.global.enabled ? "Plantilla de severidad activada por el Administrador" : "Plantilla propuesta (verde 0, amarillo 0,5, rojo 1), no activada: sin método ni límites no hay color final."}</dd>
          <dt>Composición «peor señal» (BACK 07)</dt>
          <dd>{active.payload.incidents.worstOfFlowAndBacklog ? "Activada por el Administrador" : "Propuesta desactivada"}</dd>
        </dl>
      </section>

      {eff && effNoHealth ? (
        <section className="card" aria-labelledby="q-pesos-vigentes">
          <h2 id="q-pesos-vigentes">Pesos {draft ? "del borrador" : "activos"}</h2>
          <div className="table-wrap">
            <table>
              <caption className="skip">Pesos configurados y efectivos</caption>
              <thead><tr><th>Indicador</th><th>Configurado (%)</th><th>Efectivo con todos los datos (%)</th><th>Efectivo sin Client Health (%)</th></tr></thead>
              <tbody>
                {INDICATOR_KEYS.map((k) => (
                  <tr key={k}><td>{INDICATOR_NAME[k]}</td><td>{pct(eff.configuredPercent[k])}</td><td>{pct(eff.percent[k])}</td><td>{pct(effNoHealth.percent[k])}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">Los iguales son la fracción exacta 1/6, no seis veces 16,67. La presentación redondea.</p>
        </section>
      ) : null}

      {isAdmin ? (
        <section className="card" aria-labelledby="q-editor">
          <h2 id="q-editor">Editar el borrador</h2>
          <p className="muted">Los cambios se guardan como <strong>borrador</strong> y no alteran hechos, pesos activos ni colores publicados. {draft ? `Edita el borrador versión ${draft.version}.` : "Parte de la revisión activa."}</p>
          <ActionForm action={saveQualityDraftAction} hidden={{ expectedDraftVersion: draft?.version ?? "", d_present: "1", g_present: "1", dg_present: "1" }}>
            <fieldset>
              <legend>Pesos</legend>
              <SelectField name="w_mode" label="Modo" initial={cfg.weights.mode} options={[{ value: "EQUAL", label: "Iguales (1/6 cada uno)" }, { value: "CUSTOM", label: "Personalizado" }]} help="Personalizado: seis porcentajes no negativos con hasta dos decimales que sumen exactamente 100 (se rechazan 99, 101 y 100,02)." />
              <div className="filters-grid">
                {INDICATOR_KEYS.map((k) => <TextField key={k} name={`w_${k}`} label={`${INDICATOR_NAME[k]} (%)`} initial={cfg.weights.custom[k] ?? ""} />)}
              </div>
            </fieldset>
            {INDICATOR_KEYS.filter((k) => k !== "HEALTH" && k !== "INCIDENTS_PROBLEMS").map((k) => (
              <fieldset key={k}>
                <legend>{INDICATOR_NAME[k]} — umbrales por ámbito</legend>
                <p className="hint">Magnitud: {UNIT_LABEL[METRIC_UNIT[k]]}. Un umbral de Grupo no se aplica a un Cliente: complete cada ámbito de forma explícita.</p>
                {QUALITY_SCOPES.map((sc) => <RuleFields key={sc} prefix={`r_${k}_${sc}`} rule={cfg.indicators[k].rules[sc]} title={QSCOPE_LABEL[sc]} />)}
              </fieldset>
            ))}
            <fieldset>
              <legend>Incidentes y problemas — flujo y backlog envejecido</legend>
              <p className="hint">Edad en días naturales al corte observado; envejecido es <strong>edad &gt; umbral</strong>. Bandas ordenadas, sin solapamiento ni huecos (p. ej. «0-7, 8-30, 31-»). El stock se expresa <strong>por 100 usuarios al corte</strong> ({UNIT_LABEL[BACKLOG_UNIT]}); el flujo, por 100 usuarios·mes. Un único peso para el KPI.</p>
              <div className="filters-grid">
                <TextField name="i_bands" label="Bandas de edad" initial={formatAgeBands(cfg.incidents.ageBands)} />
                <TextField name="i_conc_incident" label="Umbral preocupante de incidentes (días)" initial={cfg.incidents.concerningDays.incident === null ? "" : String(cfg.incidents.concerningDays.incident)} />
                <TextField name="i_conc_problem" label="Umbral preocupante de problemas (días)" initial={cfg.incidents.concerningDays.problem === null ? "" : String(cfg.incidents.concerningDays.problem)} />
              </div>
              {QUALITY_SCOPES.map((sc) => <RuleFields key={`f${sc}`} prefix={`r_INCIDENTS_PROBLEMS_${sc}`} rule={cfg.indicators.INCIDENTS_PROBLEMS.rules[sc]} title={`Flujo de altas · ${QSCOPE_LABEL[sc]}`} />)}
              {(["INCIDENT", "PROBLEM"] as const).flatMap((t) => QUALITY_SCOPES.map((sc) => <RuleFields key={`${t}${sc}`} prefix={`r_BACKLOG_${t}_${sc}`} rule={cfg.incidents.backlog[t][sc]} title={`Backlog envejecido de ${t === "INCIDENT" ? "incidentes" : "problemas"} · ${QSCOPE_LABEL[sc]}`} />))}
              <CheckboxField name="i_worst" label="Activar la composición «peor señal entre flujo y backlog envejecido»" initial={cfg.incidents.worstOfFlowAndBacklog} help="Propuesta BACK 07, desactivada. Sin elegirla, el KPI no publica color (un flujo verde no es el color completo). Requiere flujo y backlog de incidentes y de problemas calibrados y los umbrales preocupantes." />
            </fieldset>
            <fieldset>
              <legend>Fotografía histórica del backlog</legend>
              <p className="hint">Para un corte histórico solo se usa una fotografía compatible de esa fecha. Opcionalmente puede elegir «última fotografía anterior dentro de X días»: se muestra como «observado en D» y provisional; no hay tolerancia por defecto.</p>
              <div className="filters-grid">
                <SelectField name="sp_mode" label="Política" initial={cfg.snapshotPolicy.mode} options={[{ value: "EXACT", label: "Exacta (por defecto)" }, { value: "LATEST_BEFORE", label: "Última anterior dentro de X días" }]} />
                <TextField name="sp_days" label="Máximo de días (solo con «última anterior»)" initial={cfg.snapshotPolicy.maxDays === null ? "" : String(cfg.snapshotPolicy.maxDays)} />
              </div>
            </fieldset>
            <fieldset>
              <legend>Diagnóstico por origen — correspondencias causa → familia</legend>
              <p className="hint">Una por línea: «causa → FAMILIA» (escriba la flecha como =&gt;). Familias: {DIAGNOSIS_FAMILIES.join(", ")}. Inicializado solo con las correspondencias confirmadas; la infraestructura se resuelve por alojamiento vigente. Un cambio crea una revisión nueva; los valores originales no se alteran.</p>
              <TextAreaField name="dg_text" label="Correspondencias" initial={cfg.diagnosis.mappings.map((m) => `${m.cause} => ${m.family}`).join("\n")} />
            </fieldset>
            <fieldset>
              <legend>Client Health — mapeo categórico (propuesta)</legend>
              <div className="filters-grid">
                <SelectField name="h_positive" label="Positivo" initial={cfg.health.mapping.positive || PROPOSED_HEALTH_MAPPING.positive} options={COLORS} />
                <SelectField name="h_mixed" label="Mixto" initial={cfg.health.mapping.mixed} options={COLORS} />
                <SelectField name="h_negative" label="Negativo" initial={cfg.health.mapping.negative} options={COLORS} />
              </div>
              <CheckboxField name="h_confirmed" label="Marcar este mapeo como confirmado" initial={cfg.health.confirmed} help="La ausencia de feedback queda en blanco; no hay arrastre mensual ni propagación de padre a hijos." />
            </fieldset>
            <fieldset>
              <legend>Dedicación — perfiles del indicador</legend>
              <div className="quick">{PROFILE_KEYS.map((k) => <CheckboxField key={k} name={`d_${k}`} label={PROFILE_LABEL[k]} initial={cfg.dedication.profiles.includes(k)} />)}</div>
              <CheckboxField name="d_confirmed" label="Selección confirmada" initial={cfg.dedication.selectionConfirmed} help="Sin confirmar, la selección sigue pendiente; CS, PMO, IT y Plataforma se mantienen desglosados." />
            </fieldset>
            <fieldset>
              <legend>Global — plantilla propuesta de severidad</legend>
              <p className="hint">Severidad verde = 0, amarillo = 0,5, rojo = 1; suma ponderada con pesos efectivos. Límites dentro de [0, 1]: verde si score ≤ límite verde; amarillo si ≤ límite amarillo; rojo si mayor. No se asignan 0,33/0,66 automáticamente ni salvaguardas «un rojo obliga a rojo».</p>
              <CheckboxField name="g_enabled" label="Usar esta plantilla" initial={cfg.global.enabled} />
              <div className="filters-grid">
                <TextField name="g_green" label="Límite verde" initial={cfg.global.greenMax ?? ""} />
                <TextField name="g_yellow" label="Límite amarillo" initial={cfg.global.yellowMax ?? ""} />
              </div>
            </fieldset>
            <TextAreaField name="note" label="Nota del borrador" />
            <div className="form-actions"><SubmitButton>Guardar borrador</SubmitButton></div>
          </ActionForm>
        </section>
      ) : null}

      <section className="card" aria-labelledby="q-sim">
        <h2 id="q-sim">Simulación con escenarios manuales</h2>
        <p className="muted">Usa la configuración {draft ? "del borrador" : "activa"} y el mismo evaluador del dashboard; los valores son <strong>ejemplos manuales</strong>. No escribe nada. Para previsualizar el borrador sobre datos de la base use <a href="/calidad?sim=borrador">Calidad › simulación sobre datos</a> (solo Administrador).</p>
        <form method="get" action="/administracion/configuracion">
          <input type="hidden" name="seccion" value="calidad" />
          <input type="hidden" name="sim" value="1" />
          <label className="field-inline">Ámbito de las reglas <select name="ss" defaultValue={simScope}>{QUALITY_SCOPES.map((sc) => <option key={sc} value={sc}>{QSCOPE_LABEL[sc]}</option>)}</select></label>
          <div className="table-wrap">
            <table>
              <caption className="skip">Escenario de simulación</caption>
              <thead><tr><th>Indicador</th><th>Dato</th><th>Valor</th><th>Backlog por 100 usuarios (incidentes / problemas)</th><th>Muestra de referencia</th></tr></thead>
              <tbody>
                {INDICATOR_KEYS.map((k) => (
                  <tr key={k}>
                    <th scope="row">{INDICATOR_NAME[k]}</th>
                    <td>
                      <select name={`sa_${k}`} aria-label={`Disponibilidad de ${INDICATOR_NAME[k]}`} defaultValue={scenario[k].availability}>
                        <option value="AVAILABLE">Con dato</option>
                        {k === "HEALTH" ? <option value="BLANK">En blanco (sin feedback)</option> : null}
                        <option value="MISSING">Fuente ausente</option>
                      </select>
                    </td>
                    <td>
                      {k === "HEALTH" ? (
                        <select name={`sv_${k}`} aria-label="Estado de Client Health" defaultValue={scenario[k].value}><option value="">—</option><option value="positive">Positivo</option><option value="mixed">Mixto</option><option value="negative">Negativo</option></select>
                      ) : <input name={`sv_${k}`} aria-label={`Valor de ${INDICATOR_NAME[k]}`} defaultValue={scenario[k].value} inputMode="decimal" />}
                    </td>
                    <td>{k === "INCIDENTS_PROBLEMS" ? (<><input name={`sb_${k}`} aria-label="Backlog envejecido de incidentes por 100 usuarios" defaultValue={scenario[k].backlogValue} inputMode="decimal" /> <input name={`sbp_${k}`} aria-label="Backlog envejecido de problemas por 100 usuarios" defaultValue={scenario[k].backlogProblemValue} inputMode="decimal" /></>) : "—"}</td>
                    <td>{k !== "HEALTH" ? <input name={`sr_${k}`} aria-label={`Muestra de referencia de ${INDICATOR_NAME[k]}`} defaultValue={scenario[k].reference} placeholder="0; 10; 20; 30" /> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions"><button type="submit" className="btn btn-secondary">Simular (sin guardar)</button></div>
        </form>
        {sim ? (
          <div aria-live="polite">
            <h3>Resultado de la simulación <span className="badge badge-warn">escenario manual · SIMULACIÓN, NO PUBLICADO</span></h3>
            {sim.weightIssues.length > 0 ? <p className="notice notice-error" role="alert">{sim.weightIssues[0].message}</p> : null}
            {sim.configIssues.length > 0 ? <p className="notice notice-warn">{sim.configIssues[0].message}</p> : null}
            <div className="table-wrap">
              <table>
                <caption className="skip">Resultado por indicador</caption>
                <thead><tr><th>Indicador</th><th>Peso efectivo (%)</th><th>Color</th><th>Estado y regla</th></tr></thead>
                <tbody>
                  {INDICATOR_KEYS.map((k) => {
                    const r = sim.indicators[k];
                    return (
                      <tr key={k}>
                        <td>{r.name}</td><td>{sim.weights ? pct(sim.weights.percent[k]) : "—"}</td>
                        <td>{r.color ? <span className={`badge band-${r.color === "green" ? "verde_claro" : r.color === "yellow" ? "amarillo" : "rojo"}`}>{COLOR_LABEL[r.color]}</span> : <span className="badge badge-off">{r.status === "SIN_CALIBRAR" ? "Sin calibrar" : r.status === "BLANCO" ? "En blanco" : r.availability === "MISSING" ? "Incompleto / sin color" : "Sin color"}</span>}{r.alert && !r.color ? " (alerta roja parcial)" : ""}</td>
                        <td>{r.reason}{r.cuts ? ` (a=${r.cuts.a}, b=${r.cuts.b})` : ""}{r.components ? <ul>{r.components.map((c) => <li key={c.id}>{c.label}: {c.value ?? "—"} → {c.color ? COLOR_LABEL[c.color] : c.status}</li>)}</ul> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p>
              <strong>Global simulado:</strong>{" "}
              {sim.global.color ? <span className={`badge band-${sim.global.color === "green" ? "verde_claro" : sim.global.color === "yellow" ? "amarillo" : "rojo"}`}>{COLOR_LABEL[sim.global.color]}</span> : <span className="badge badge-off">Sin color final</span>}
              {sim.global.score ? ` · índice ${pct(sim.global.score)}` : ""} — {sim.global.reason}
            </p>
            {sim.weights?.redistributedFromHealth ? <p className="hint">Client Health en blanco: su peso se redistribuyó proporcionalmente entre los demás.</p> : null}
            {sim.weights ? <p className="hint">Cobertura calculable: {pct(sim.weights.coveragePercent)} % de la asignación{sim.weights.uncovered.length ? ` · sin cubrir: ${sim.weights.uncovered.map((u) => INDICATOR_NAME[u.key]).join(", ")}` : ""}. {sim.global.partialAlerts.length ? `Alertas rojas parciales: ${sim.global.partialAlerts.map((k) => INDICATOR_NAME[k]).join(", ")}.` : ""}</p> : null}
          </div>
        ) : null}
      </section>
      <RevisionPanel userId={userId} family="QUALITY" isAdmin={isAdmin} />
    </>
  );
}
