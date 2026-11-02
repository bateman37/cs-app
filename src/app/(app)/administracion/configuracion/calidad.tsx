import { ActionForm, CheckboxField, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form-kit";
import {
  INDICATOR_KEYS, INDICATOR_NAME, PROPOSED_HEALTH_MAPPING, COLOR_LABEL, effectiveWeights, simulateQuality, weightUnits, type Availability, type IndicatorKey, type QualityConfig, type SimInput,
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

export async function CalidadSection({ userId, isAdmin, sp }: { userId: string; isAdmin: boolean; sp: SearchParams }) {
  const active = await getActive(prisma, "QUALITY");
  const draft = isAdmin ? await getDraft(userId, "QUALITY") : null;
  const cfg: QualityConfig = draft?.payload ?? active.payload;
  const wu = weightUnits({ mode: cfg.weights.mode, custom: cfg.weights.custom as Record<IndicatorKey, string> });
  const eff = wu.units ? effectiveWeights(wu.units, Object.fromEntries(INDICATOR_KEYS.map((k) => [k, "AVAILABLE"])) as Record<IndicatorKey, Availability>) : null;
  const effNoHealth = wu.units ? effectiveWeights(wu.units, Object.fromEntries(INDICATOR_KEYS.map((k) => [k, k === "HEALTH" ? "BLANK" : "AVAILABLE"])) as Record<IndicatorKey, Availability>) : null;

  // Simulación: escenarios manuales por la URL (GET); no escribe nada.
  const simulate = first(sp.sim) === "1";
  const scenario = Object.fromEntries(
    INDICATOR_KEYS.map((k) => [k, { availability: (first(sp[`sa_${k}`]) || "AVAILABLE") as Availability, value: first(sp[`sv_${k}`]), backlogValue: first(sp[`sb_${k}`]), reference: first(sp[`sr_${k}`]) } satisfies SimInput]),
  ) as Record<IndicatorKey, SimInput>;
  const sim = simulate ? simulateQuality(cfg, scenario) : null;

  return (
    <>
      <section className="card" aria-labelledby="q-vigente">
        <h2 id="q-vigente">Calidad · revisión activa {active.revisionNo}{!active.persisted ? " (inicial, sin activaciones)" : ""}</h2>
        <p className="muted">
          Seis indicadores estables: {INDICATOR_KEYS.map((k) => INDICATOR_NAME[k]).join(", ")}. No hay séptimo indicador de rentabilidad ni peso para el backlog. El dashboard de Calidad y Client Health se implementan en CSAPP-08: aquí solo se <strong>configura y simula</strong>.
        </p>
        <dl className="kv">
          <dt>Pesos</dt>
          <dd>
            {active.payload.weights.mode === "EQUAL" ? <>Iguales: cada uno <strong>1/6</strong> (16,666…%; total 100 %) <span className="badge badge-ok">confirmado</span></> : <>Personalizados <span className="badge badge-int">elegido por el Administrador</span></>}
          </dd>
          <dt>Sin Client Health</dt>
          <dd>Se redistribuye <strong>solo su peso</strong> entre los otros cinco (iguales: 5 × 20 %). Una fuente técnica ausente no se redistribuye: el global no se publica completo.</dd>
          <dt>Umbrales</dt>
          <dd>{INDICATOR_KEYS.filter((k) => k !== "HEALTH" && active.payload.indicators[k].rule.calibration === "CALIBRADO").length} de 5 calibrados <span className="badge badge-warn">propuesta / sin calibrar</span> — sin calibrar no hay color, nunca verde por defecto.</dd>
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
          <ActionForm action={saveQualityDraftAction} hidden={{ expectedDraftVersion: draft?.version ?? "", d_present: "1", g_present: "1" }}>
            <fieldset>
              <legend>Pesos</legend>
              <SelectField name="w_mode" label="Modo" initial={cfg.weights.mode} options={[{ value: "EQUAL", label: "Iguales (1/6 cada uno)" }, { value: "CUSTOM", label: "Personalizado" }]} help="Personalizado: seis porcentajes no negativos con hasta dos decimales que sumen exactamente 100 (se rechazan 99, 101 y 100,02)." />
              <div className="filters-grid">
                {INDICATOR_KEYS.map((k) => <TextField key={k} name={`w_${k}`} label={`${INDICATOR_NAME[k]} (%)`} initial={cfg.weights.custom[k] ?? ""} />)}
              </div>
            </fieldset>
            {INDICATOR_KEYS.filter((k) => k !== "HEALTH").map((k) => {
              const r = cfg.indicators[k].rule;
              return (
                <fieldset key={k}>
                  <legend>{INDICATOR_NAME[k]} — umbrales</legend>
                  <p className="hint">Unidad: {cfg.indicators[k].unit} · normalización {cfg.indicators[k].normalization.toLowerCase().replaceAll("_", " ")} · ámbito {cfg.indicators[k].scope.toLowerCase()}.</p>
                  <div className="filters-grid">
                    <SelectField name={`r_${k}_method`} label="Método" initial={r.method === "CATEGORICAL" ? "ABSOLUTE" : r.method} options={METHOD} />
                    <SelectField name={`r_${k}_dir`} label="Dirección" initial={r.direction} options={DIR} />
                    <TextField name={`r_${k}_a`} label="Límite a (o percentil)" initial={r.a ?? ""} />
                    <TextField name={`r_${k}_b`} label="Límite b (o percentil)" initial={r.b ?? ""} />
                    <TextField name={`r_${k}_ref`} label="Referencia (id de Pulse, para percentiles)" initial={r.referenceId ?? ""} />
                    <TextField name={`r_${k}_min`} label="Muestra mínima para colorear" initial={r.minSample === null ? "" : String(r.minSample)} help="Propia de Calidad; vacío = sin mínimo configurado." />
                    <SelectField name={`r_${k}_cal`} label="Estado" initial={r.calibration} options={CAL} />
                  </div>
                </fieldset>
              );
            })}
            <fieldset>
              <legend>Incidentes y problemas — backlog envejecido</legend>
              <p className="hint">Edad en días naturales al corte observado; envejecido es <strong>edad &gt; umbral</strong>. Bandas ordenadas, sin solapamiento ni huecos (p. ej. «0-7, 8-30, 31-»). El stock divide por usuarios al corte; el flujo, por exposición.</p>
              <div className="filters-grid">
                <TextField name="i_bands" label="Bandas de edad" initial={formatAgeBands(cfg.incidents.ageBands)} />
                <TextField name="i_conc_incident" label="Umbral preocupante de incidentes (días)" initial={cfg.incidents.concerningDays.incident === null ? "" : String(cfg.incidents.concerningDays.incident)} />
                <TextField name="i_conc_problem" label="Umbral preocupante de problemas (días)" initial={cfg.incidents.concerningDays.problem === null ? "" : String(cfg.incidents.concerningDays.problem)} />
                <SelectField name="r_BACKLOG_method" label="Backlog: método" initial={cfg.incidents.backlogRule.method === "CATEGORICAL" ? "ABSOLUTE" : cfg.incidents.backlogRule.method} options={METHOD} />
                <SelectField name="r_BACKLOG_dir" label="Backlog: dirección" initial={cfg.incidents.backlogRule.direction} options={DIR} />
                <TextField name="r_BACKLOG_a" label="Backlog: límite a" initial={cfg.incidents.backlogRule.a ?? ""} />
                <TextField name="r_BACKLOG_b" label="Backlog: límite b" initial={cfg.incidents.backlogRule.b ?? ""} />
                <TextField name="r_BACKLOG_ref" label="Backlog: referencia" initial={cfg.incidents.backlogRule.referenceId ?? ""} />
                <TextField name="r_BACKLOG_min" label="Backlog: muestra mínima" initial={cfg.incidents.backlogRule.minSample === null ? "" : String(cfg.incidents.backlogRule.minSample)} />
                <SelectField name="r_BACKLOG_cal" label="Backlog: estado" initial={cfg.incidents.backlogRule.calibration} options={CAL} />
              </div>
              <CheckboxField name="i_worst" label="Activar la composición «peor señal entre flujo y backlog envejecido»" initial={cfg.incidents.worstOfFlowAndBacklog} help="Propuesta BACK 07, desactivada. Requiere los dos componentes calibrados y los umbrales preocupantes." />
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
        <p className="muted">Usa la configuración {draft ? "del borrador" : "activa"}; los valores son <strong>ejemplos manuales</strong>, no datos reales. No escribe nada, no calcula feedback ni backlog reales (CSAPP-08) y no muestra un global real por cliente.</p>
        <form method="get" action="/administracion/configuracion">
          <input type="hidden" name="seccion" value="calidad" />
          <input type="hidden" name="sim" value="1" />
          <div className="table-wrap">
            <table>
              <caption className="skip">Escenario de simulación</caption>
              <thead><tr><th>Indicador</th><th>Dato</th><th>Valor</th><th>Backlog (stock/usuario)</th><th>Muestra de referencia</th></tr></thead>
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
                    <td>{k === "INCIDENTS_PROBLEMS" ? <input name={`sb_${k}`} aria-label="Backlog envejecido por usuario" defaultValue={scenario[k].backlogValue} inputMode="decimal" /> : "—"}</td>
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
            <h3>Resultado de la simulación <span className="badge badge-warn">escenario manual</span></h3>
            {sim.weightIssues.length > 0 ? <p className="notice notice-error" role="alert">{sim.weightIssues[0].message}</p> : null}
            {sim.configIssues.length > 0 ? <p className="notice notice-warn">{sim.configIssues[0].message}</p> : null}
            <div className="table-wrap">
              <table>
                <caption className="skip">Resultado por indicador</caption>
                <thead><tr><th>Indicador</th><th>Peso efectivo (%)</th><th>Color</th><th>Estado y regla</th></tr></thead>
                <tbody>
                  {sim.rows.map((r) => (
                    <tr key={r.key}>
                      <td>{r.name}</td><td>{sim.weights ? pct(sim.weights.percent[r.key]) : "—"}</td>
                      <td>{r.color ? <span className={`badge band-${r.color === "green" ? "verde_claro" : r.color === "yellow" ? "amarillo" : "rojo"}`}>{COLOR_LABEL[r.color]}</span> : <span className="badge badge-off">{r.status === "SIN_CALIBRAR" ? "Sin calibrar" : r.status === "BLANCO" ? "En blanco" : "Sin color"}</span>}</td>
                      <td>{r.reason}{r.cuts ? ` (a=${r.cuts.a}, b=${r.cuts.b})` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              <strong>Global simulado:</strong>{" "}
              {sim.global.color ? <span className={`badge band-${sim.global.color === "green" ? "verde_claro" : sim.global.color === "yellow" ? "amarillo" : "rojo"}`}>{COLOR_LABEL[sim.global.color]}</span> : <span className="badge badge-off">Sin color final</span>}
              {sim.global.score ? ` · score ${pct(sim.global.score)}` : ""} — {sim.global.reason}
            </p>
            {sim.weights?.redistributedFromHealth ? <p className="hint">Client Health en blanco: su peso se redistribuyó proporcionalmente entre los demás.</p> : null}
          </div>
        ) : null}
      </section>
      <RevisionPanel userId={userId} family="QUALITY" isAdmin={isAdmin} />
    </>
  );
}
