import Link from "next/link";
import type { FichaView } from "@/server/analytics/ficha";
import { type EquipoRow, type PeriodKey, type Quantity } from "@/domain/ficha-dedicacion";
import { Na } from "./ficha-client";
import { dmy, num, pctFrac } from "./ficha-format";
import { fichaUrl, type Nav } from "./links";

/** Los tres cuadros de dedicación (zona derecha), simultáneos y sin párrafos explicativos. Las explicaciones salen al pasar/enfocar y en el detalle. */
const PERIOD_TITLE: Record<PeriodKey, string> = { month: "Mes", prevMonth: "Mes anterior", cum: "CUM", prevCum: "CUM anterior comparable", prevYear: "Año anterior completo" };

function detHref(f: FichaView, nav: Nav) {
  return (k: PeriodKey) => fichaUrl(nav, f.context.ref, { det: "horas", periodo: k, sello: f.economics.reference.dataStamp.stamp });
}
const periodTitle = (f: FichaView, k: PeriodKey) => `${PERIOD_TITLE[k]}: ${dmy(f.economics.periodsDefinition[k].from)} – ${dmy(f.economics.periodsDefinition[k].to)}`;

/** Cabecera común de los dos primeros cuadros: mes, % mes, mes anterior, CUM, % CUM, CUM anterior comparable, año anterior completo. */
function Head({ f, first }: { f: FichaView; first: string }) {
  const th = (k: PeriodKey, text: string) => <th scope="col" title={periodTitle(f, k)}>{text}</th>;
  return (
    <thead>
      <tr>
        <th scope="col" className="fc-l">{first}</th>
        {th("month", "Mes (h)")}<th scope="col" title="Porcentaje del mes">% mes</th>
        {th("prevMonth", "Mes ant. (h)")}
        <th scope="col" className="fc-sep" title={periodTitle(f, "cum")}>CUM (h)</th><th scope="col" title="Porcentaje del CUM">% CUM</th>
        {th("prevCum", "CUM ant. comp. (h)")}
        <th scope="col" className="fc-sep" title={periodTitle(f, "prevYear")}>Año ant. completo (h)</th>
      </tr>
    </thead>
  );
}
function Cells({ q, share }: { q: Record<PeriodKey, Quantity>; share: Record<PeriodKey, string | null> | null }) {
  const h = (k: PeriodKey) => num(q[k].hours, 2);
  const p = (k: PeriodKey) => (share === null ? "" : share[k] === null ? <Na reason="Sin horas en el periodo: no hay denominador para el porcentaje." /> : pctFrac(share[k], 1));
  return (
    <>
      <td>{h("month")}</td><td className="fc-pct">{p("month")}</td><td>{h("prevMonth")}</td>
      <td className="fc-sep">{h("cum")}</td><td className="fc-pct">{p("cum")}</td><td>{h("prevCum")}</td><td className="fc-sep">{h("prevYear")}</td>
    </>
  );
}
function TotalCells({ q, href }: { q: Record<PeriodKey, Quantity>; href: (k: PeriodKey) => string }) {
  const l = (k: PeriodKey) => <Link href={href(k)} title="Detalle de las actividades que componen esta cifra">{num(q[k].hours, 2)}</Link>;
  return (
    <>
      <td>{l("month")}</td><td className="fc-pct">100 %</td><td>{l("prevMonth")}</td>
      <td className="fc-sep">{l("cum")}</td><td className="fc-pct">100 %</td><td>{l("prevCum")}</td><td className="fc-sep">{l("prevYear")}</td>
    </>
  );
}

export function EquipoCard({ f, nav }: { f: FichaView; nav: Nav }) {
  const t = f.tables.equipo;
  const href = detHref(f, nav);
  return (
    <section className="fc-tcard" aria-label="Dedicación por equipo y perfil">
      <h2>Dedicación por equipo y perfil</h2>
      <div className="fc-scroll">
        <table className="fc-tbl">
          <caption className="fc-sr">Horas por equipo y perfil: mes, mes anterior, CUM, CUM anterior comparable y año anterior completo, con su porcentaje sobre el total del periodo.</caption>
          <Head f={f} first="Equipo · perfil" />
          <tbody>
            {t.rows.map((r: EquipoRow) => <tr key={r.profile}><th scope="row">{r.profile}</th><Cells q={r.periods} share={r.share} /></tr>)}
            <tr className="fc-tot"><th scope="row">Total</th><TotalCells q={t.total} href={href} /></tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function TicketCard({ f, nav }: { f: FichaView; nav: Nav }) {
  const t = f.tables.ticket;
  const href = detHref(f, nav);
  return (
    <section className="fc-tcard" aria-label="Dedicación por tipo de ticket y perfil">
      <h2>Dedicación por tipo de ticket y perfil</h2>
      <div className="fc-scroll">
        <table className="fc-tbl">
          <caption className="fc-sr">Horas por tipo de ticket y perfil. El porcentaje de cada perfil es sobre su tipo de ticket; el total suma los tres tipos una sola vez (las filas de perfil son detalle).</caption>
          <Head f={f} first="Tipo de ticket · perfil" />
          <tbody>
            {t.groups.map((g) => (
              <GroupRows key={g.cls} g={g} />
            ))}
            <tr className="fc-tot"><th scope="row">Total (suma de los tres tipos)</th><TotalCells q={t.total} href={href} /></tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
function GroupRows({ g }: { g: FichaView["tables"]["ticket"]["groups"][number] }) {
  return (
    <>
      <tr className="fc-sub"><th scope="row" title={g.cls === "unclassified" ? "Causa raíz sin informar o infraestructura sin alojamiento vigente: se conserva pendiente, no se reparte" : undefined}>{g.label}</th><Cells q={g.total} share={null} /></tr>
      {g.profiles.map((r) => <tr key={r.profile} className="fc-det"><th scope="row">{r.profile}</th><Cells q={r.periods} share={r.share} /></tr>)}
    </>
  );
}

export function ProblemaCard({ f }: { f: FichaView }) {
  const t = f.tables.problema;
  const noTarget = f.entity.periods.cum.targetHours.value === null ? f.entity.periods.cum.targetHours.reason : null;
  const row = (r: (typeof t.rows)[number], cls?: string) => (
    <tr key={r.key} className={cls}>
      <th scope="row">{r.label}</th>
      <td>{num(r.cum.hours, 2)}</td>
      <td className="fc-pct">{r.shareOfDedicated === null ? <Na reason="Sin horas dedicadas en el CUM: no hay denominador." /> : pctFrac(r.shareOfDedicated, 1)}</td>
      <td className="fc-pct">{r.shareOfTarget === null ? <Na reason={noTarget ?? "Las horas objetivo son cero: no se calcula el porcentaje."} /> : pctFrac(r.shareOfTarget, 1)}</td>
      <td className="fc-sep">{num(r.prevCum.hours, 2)}</td>
    </tr>
  );
  return (
    <section className="fc-tcard" aria-label="Dedicación por tipo de problema Vincle">
      <h2>Dedicación por tipo de problema Vincle</h2>
      <div className="fc-scroll">
        <table className="fc-tbl">
          <caption className="fc-sr">Horas de Incidente/Problema Vincle por tipo de problema en el CUM, su porcentaje sobre las horas dedicadas y sobre las horas objetivo, y el CUM anterior comparable. Infraestructura solo cuenta como Vincle con alojamiento CLOUD.</caption>
          <thead>
            <tr>
              <th scope="col" className="fc-l">Tipo de problema</th>
              <th scope="col" title={`${dmy(f.economics.periodsDefinition.cum.from)} – ${dmy(f.economics.periodsDefinition.cum.to)}`}>CUM (h)</th>
              <th scope="col">% s/ horas dedicadas</th>
              <th scope="col">% s/ horas objetivo</th>
              <th scope="col" className="fc-sep" title={`${dmy(f.economics.periodsDefinition.prevCum.from)} – ${dmy(f.economics.periodsDefinition.prevCum.to)}`}>CUM ant. comp. (h)</th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r) => row(r))}
            {row(t.total, "fc-tot")}
          </tbody>
        </table>
      </div>
    </section>
  );
}
