import Link from "next/link";
import { INDICATOR_KEYS } from "@/domain/quality-config";
import { KPI_ACCESS_HINT, KPI_ACCESS_NAME, KPI_OBSERVED_UNIT } from "@/domain/quality-kpi";
import type { QualityQuery } from "@/domain/quality-query";
import type { KpiAccess } from "@/server/quality/engine";
import { NeutralTag, StateTag, num } from "./ui";
import { kpiHref } from "./table";

/** Estado visual del acceso: color + símbolo + texto. Verde solo si toda la selección con dato está en verde; sin dato o sin calibrar nunca es verde. */
function AccessState({ a }: { a: KpiAccess }) {
  if (a.state === "red") return <StateTag color="red" text={`${a.red} en rojo`} />;
  if (a.state === "yellow") return <StateTag color="yellow" text={`${a.yellow} en amarillo`} />;
  if (a.state === "green") return <StateTag color="green" text="Todo verde" />;
  if (a.state === "uncalibrated") return <NeutralTag title="Hay valores sin umbral configurado: se muestran las magnitudes, sin color.">Sin calibrar</NeutralTag>;
  return <NeutralTag>Sin dato</NeutralTag>;
}

function Dist({ a }: { a: KpiAccess }) {
  const parts = [a.red && `${a.red} rojo`, a.yellow && `${a.yellow} amarillo`, a.green && `${a.green} verde`, a.uncalibrated && `${a.uncalibrated} sin calibrar`, a.noData && `${a.noData} sin dato`].filter(Boolean) as string[];
  return <>{parts.length ? parts.join(" · ") : "sin entidades"}</>;
}

/** Los seis KPI son la navegación: cada acceso abre el apartado del indicador para la selección actual. */
export function KpiAccessGrid({ access, q, basePath }: { access: Record<(typeof INDICATOR_KEYS)[number], KpiAccess>; q: QualityQuery; basePath: string }) {
  return (
    <ul className="ql-acc-grid" aria-label="Seis indicadores de Calidad">
      {INDICATOR_KEYS.map((k) => {
        const a = access[k];
        const h = a.health;
        const unit = KPI_OBSERVED_UNIT[k];
        const label = `${KPI_ACCESS_NAME[k]}: ${h ? `${h.positive} positivo, ${h.mixed} mixto, ${h.negative} negativo, ${h.blank} sin informar` : `${a.observedTotal === null ? "sin magnitud observada" : `${num(a.observedTotal)} ${unit}`}`}. Estado ${a.state === "red" ? "rojo" : a.state === "yellow" ? "amarillo" : a.state === "green" ? "verde" : a.state === "uncalibrated" ? "sin calibrar" : "sin dato"}. Abrir apartado`;
        return (
          <li key={k}>
            <Link className={`ql-acc ql-acc-${a.state}`} href={kpiHref({ ...q, sel: "" }, basePath, k)} aria-label={label} aria-current={q.kpi === k && !q.sel ? "page" : undefined} prefetch={false}>
              <span className="ql-acc-name"><span>{KPI_ACCESS_NAME[k]}</span><AccessState a={a} /></span>
              <span className="ql-acc-val">
                {h ? <>{h.positive} <small>pos.</small> {h.mixed} <small>mix.</small> {h.negative} <small>neg.</small></> : a.observedTotal === null ? <span className="ql-muted">—</span> : <>{num(a.observedTotal)} <small>{unit} · {KPI_ACCESS_HINT[k]}</small></>}
              </span>
              <span className="ql-acc-sub">{h ? <>{h.blank} sin informar · <Dist a={a} /></> : <Dist a={a} />}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
