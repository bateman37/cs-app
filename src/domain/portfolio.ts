/**
 * Agregación de cartera (CAL 20-21, CSAPP-06 §3): función pura sobre las filas del conjunto filtrado COMPLETO (antes de paginar).
 * El ratio de cartera es ΣR / ΣH × jornada (nunca la media de ratios). HOTFIX-03 §8: se calcula con el subconjunto COMPARABLE (grupos con ingreso
 * conocido y sin filtro que recorte solo horas); un grupo con perímetro provisional entra con sus horas observadas y marca la referencia como provisional.
 * Si falta algún grupo, el resto conserva su desviación y el alcance se declara una sola vez («media de 35/40 grupos»). Ingreso y horas salen siempre del MISMO subconjunto.
 * Un grupo con ingreso confirmado y cero horas NO bloquea: su ingreso permanece en la cartera (1000/0 y 1000/10 → 1600).
 */
import { Dec, deviationTargetParts, eurosPerDay, type Formula, type ResultStatus } from "./finance";

/** Motivos que impiden publicar el agregado como completo. */
export const BLOCKING_CODES = ["INCOME_UNKNOWN", "HOURS_FILTER"] as const;
export type BlockingCode = (typeof BLOCKING_CODES)[number];
export const BLOCKING_LABEL: Record<BlockingCode, string> = {
  INCOME_UNKNOWN: "ingreso desconocido o parcial",
  HOURS_FILTER: "filtro que recorta solo las horas",
};

export type PortfolioRow = {
  id: string;
  /** Ingreso imputado del periodo; null = desconocido (nunca cero). */
  revenue: Dec | null;
  /** Minutos del perímetro del servicio (conocidos aunque el perímetro sea parcial). */
  minutes: Dec;
  /** Estado del ratio individual y su motivo codificado. */
  status: ResultStatus;
  code: string | null;
  /** Ratio individual publicado como provisional (perímetro observado con actividad pendiente). */
  provisional?: boolean;
};

export type PortfolioPeriodResult = {
  revenue: string | null;
  hours: string;
  perDay: Formula;
  deviationVsTarget: Formula;
  groups: number;
  groupsWithIncome: number;
  groupsUnknownIncome: number;
  /** Ratios individuales no calculables (informativo): incluye el cero horas, que NO bloquea. */
  groupsNotComputable: { count: number; incomeAtStake: string };
  zeroHours: { count: number; income: string };
  /** Grupos que bloquean el agregado completo, por motivo. */
  affected: { code: BlockingCode; label: string; groups: number; income: string }[];
  coverage: { groups: number; complete: number; blocked: number };
  /** Conjunto conocido: grupos sin bloqueo. No es la cartera completa. */
  knownSet: { groups: number; revenue: string; hours: string; perDay: string | null };
  /** Alcance de la referencia: grupos comparables / grupos del filtrado, y cuántos entran como provisionales. */
  scope: { used: number; total: number; provisional: number };
  complete: boolean;
};

const na = (unit: string, status: ResultStatus, reason: string, code: string): Formula => ({ value: null, numerator: null, denominator: null, unit, status, reason, code });

export function aggregatePortfolio(rows: readonly PortfolioRow[], target: Dec, dayHours: Dec): PortfolioPeriodResult {
  let known = Dec.ZERO;
  let knownMinutes = Dec.ZERO;
  let withIncome = 0;
  let unknown = 0;
  let ncCount = 0;
  let ncIncome = Dec.ZERO;
  let zeroCount = 0;
  let zeroIncome = Dec.ZERO;
  const blocked = new Map<BlockingCode, { groups: number; income: Dec }>();
  const blockedIds = new Set<string>();
  let okRev = Dec.ZERO;
  let okMin = Dec.ZERO;
  let okGroups = 0;
  let provisional = 0;
  for (const r of rows) {
    if (r.revenue !== null) {
      withIncome++;
      known = known.add(r.revenue);
      knownMinutes = knownMinutes.add(r.minutes);
    } else unknown++;
    if (r.status !== "AVAILABLE") {
      ncCount++;
      if (r.revenue !== null) ncIncome = ncIncome.add(r.revenue);
    }
    if (r.code === "ZERO_HOURS" && r.revenue !== null) {
      zeroCount++;
      zeroIncome = zeroIncome.add(r.revenue);
    }
    const code = r.revenue === null ? "INCOME_UNKNOWN" : r.code;
    if (code && (BLOCKING_CODES as readonly string[]).includes(code)) {
      const c = code as BlockingCode;
      const cur = blocked.get(c) ?? { groups: 0, income: Dec.ZERO };
      cur.groups++;
      if (r.revenue !== null) cur.income = cur.income.add(r.revenue);
      blocked.set(c, cur);
      blockedIds.add(r.id);
    } else if (r.revenue !== null && r.status !== "NO_SOURCE" && !(r.code === "PERIMETER_PARTIAL" && r.minutes.isZero())) {
      okGroups++;
      okRev = okRev.add(r.revenue);
      okMin = okMin.add(r.minutes);
      if (r.provisional) provisional++;
    } else if (r.revenue !== null) {
      // Perímetro sin horas observables (todo pendiente): no es comparable.
      blockedIds.add(r.id);
    }
  }
  const affected = BLOCKING_CODES.filter((c) => blocked.has(c)).map((c) => ({ code: c, label: BLOCKING_LABEL[c], groups: blocked.get(c)!.groups, income: blocked.get(c)!.income.toString() }));
  const complete = rows.length > 0 && blockedIds.size === 0 && provisional === 0;
  const ratioOf = (rev: Dec, min: Dec) => (min.isZero() ? null : eurosPerDay(rev, min, dayHours));
  const knownEd = ratioOf(okRev, okMin);
  const hoursKnown = knownMinutes.divInt(60);
  const scope = { used: okGroups, total: rows.length, provisional };

  let perDay: Formula;
  if (rows.length === 0) perDay = na("€/jornada", "NOT_COMPUTABLE", "El conjunto filtrado no tiene grupos.", "EMPTY");
  else if (withIncome === 0) perDay = { ...na("€/jornada", "NO_SOURCE", "Ningún grupo del conjunto tiene ingreso conocido.", "INCOME_UNKNOWN") };
  else {
    const ed = ratioOf(okRev, okMin);
    if (!ed?.ratio) perDay = na("€/jornada", "NOT_COMPUTABLE", "Sin horas en el conjunto comparable.", "ZERO_HOURS");
    else {
      const why = [okGroups < rows.length ? `media de ${okGroups}/${rows.length} grupos` : null, provisional > 0 ? `${provisional} con cifra provisional` : null].filter(Boolean).join("; ");
      perDay = {
        value: ed.ratio.toString(), numerator: okRev.toString(), denominator: ed.hours.toString(), unit: "€/jornada",
        status: complete ? "AVAILABLE" : "PARTIAL",
        reason: complete ? null : `Referencia sobre el subconjunto comparable (${why}). Ingreso y horas son de esos mismos grupos.`,
        code: complete ? null : "PORTFOLIO_PARTIAL",
        expression: "ΣR / ΣH × jornada",
        provisional: !complete,
      };
    }
  }

  let deviationVsTarget: Formula;
  if (perDay.value !== null) {
    const d = deviationTargetParts(target, Dec.parse(perDay.value) as Dec);
    deviationVsTarget = {
      value: d.value.toString(), numerator: d.numerator.toString(), denominator: d.denominator.toString(), unit: "fracción", status: perDay.status === "PARTIAL" ? "PARTIAL" : "AVAILABLE",
      reason: perDay.status === "PARTIAL" ? `Sobre una referencia parcial. ${perDay.reason ?? ""}` : "Positivo = por debajo del objetivo.", code: null, operands: { objetivo: target.toString(), ratio: perDay.value }, expression: "(objetivo − ratio) / objetivo",
    };
  } else deviationVsTarget = na("fracción", perDay.status, perDay.reason ?? "Sin ratio de cartera.", perDay.code ?? "PORTFOLIO_PARTIAL");

  return {
    revenue: withIncome === 0 ? null : known.toString(),
    hours: hoursKnown.toString(),
    perDay,
    deviationVsTarget,
    groups: rows.length,
    groupsWithIncome: withIncome,
    groupsUnknownIncome: unknown,
    groupsNotComputable: { count: ncCount, incomeAtStake: ncIncome.toString() },
    zeroHours: { count: zeroCount, income: zeroIncome.toString() },
    affected,
    coverage: { groups: rows.length, complete: rows.length - blockedIds.size, blocked: blockedIds.size },
    knownSet: { groups: okGroups, revenue: okRev.toString(), hours: okMin.divInt(60).toString(), perDay: knownEd?.ratio?.toString() ?? null },
    scope,
    complete,
  };
}

