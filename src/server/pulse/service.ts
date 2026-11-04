import { clientEffectiveActive, matchesEstado } from "@/domain/estado";
import { Prisma } from "@/generated/prisma/client";
import { Dec, effectiveCut, deviationPortfolioParts } from "@/domain/finance";
import { aggregatePortfolio, type PortfolioPeriodResult } from "@/domain/portfolio";
import { PMO_CUTOFF } from "@/domain/zendesk";
import {
  METRIC_BY_ID, PROFILE_LABEL, directionOf, referenceMembership, variantFor,
  type CriteriaMeta, type PulseConfig, type PulseMetric, type PulseReference, type ProfileKey,
} from "@/domain/pulse-catalog";
import {
  NORMALIZATION_FORMULA, bandOf, cutsOf, distribution, historicalHoursEquivalent, normalize,
  type Band, type Direction, type Distribution, type Normalization, type NormalizedValue,
} from "@/domain/pulse-stats";
import { NORM_OF, PERIOD_KEY, type PulseQuery } from "@/domain/pulse-query";
import { lastDayOfMonth, parseYmd } from "@/domain/finance";
import { economicsInTx, type EntityResult, type PeriodSeries } from "@/server/economics/engine";
import { DomainError } from "@/server/errors";
import { filterGroups, loadGroupMeta, type GroupMeta } from "@/server/analytics/portfolio";
import { readSnapshot, snapshotPoint, type Tx } from "@/server/analytics/snapshot";
import { getActive, getManifest } from "./config";
import { CLS_VALUE, classifiedActivitySql, configuredProfiles, papPredicate, papSetSql, selectorsOf, ticketPredicate, ticketSetSql } from "./sql";
import { coverageOf } from "@/domain/quality-coverage";
import { loadDeclarations } from "@/server/quality/coverage";

/**
 * Servicio analítico de Pulse Rent (CSAPP-07 §4-§7, §11). Una sola instantánea REPEATABLE READ de 06 lee datos y configuración; las agregaciones
 * se calculan por CONJUNTOS (una consulta por familia de hechos, nunca una por celda/cliente/percentil). Tabla, estadística, detalle y CSV
 * comparten esta función y por tanto los mismos criterios. Importes, horas y ratios viajan como texto decimal exacto.
 */

export type CellState = "OK" | "ZERO" | "NO_DATA" | "NA" | "PARTIAL" | "UNCONFIGURED";
export const STATE_LABEL: Record<CellState, string> = {
  OK: "Calculado",
  ZERO: "Cero confirmado",
  NO_DATA: "Dato ausente",
  NA: "No aplicable",
  PARTIAL: "Parcial",
  UNCONFIGURED: "Perfil sin configurar",
};

export type Cell = {
  metricId: string;
  /** Valor de la variante aplicada (exacto). null si no hay valor publicable. */
  value: string | null;
  /** Magnitud bruta del periodo (horas, eventos o ratio). */
  raw: string | null;
  state: CellState;
  reason: string | null;
  unit: string;
  variant: Normalization;
  numerator: string | null;
  denominator: string | null;
  formula: string;
  band: Band | null;
  bandReason: string | null;
  bandRule: string;
  direction: Direction;
  customDirection: boolean;
};

export type PulseRow = { id: string; name: string; parent: string | null; type: "group" | "client" | "implementation"; cells: Record<string, Cell> };

export type Stats = Distribution & { metricId: string; variant: Normalization; unit: string; direction: Direction; customDirection: boolean };

export type ReferenceInfo = {
  id: string;
  label: string;
  origin: "CONFIRMADA" | "PERSONALIZADA";
  description: string;
  members: number;
  evaluated: number;
  exclusions: { reason: string; count: number }[];
  metadataCut: string;
};

export type EconomicBlock = {
  id: string;
  label: string;
  groups: number;
  portfolio: Pick<PortfolioPeriodResult, "complete" | "coverage" | "revenue" | "hours" | "affected"> & { perDay: string | null; status: string; reason: string | null };
  /** Media aritmética de los €/jornada de los grupos: NO es la media de cartera. */
  meanOfRatios: string | null;
};

export type PulseView = {
  query: PulseQuery;
  cut: string;
  period: { key: string; from: string; to: string; label: string; provisional: boolean; partial: boolean };
  config: { revisionNo: number; persisted: boolean; custom: string[] };
  manifest: { economic: number; pulse: number; quality: number };
  stamp: string;
  engineVersion: string;
  validated: boolean;
  totalEntities: number;
  filteredEntities: number;
  rows: PulseRow[];
  page: number;
  pageCount: number;
  metrics: PulseMetric[];
  stats: Record<string, Stats>;
  reference: ReferenceInfo;
  economicReference: EconomicBlock | null;
  notes: string[];
  sources: { zendeskTime: boolean; wrikeTime: boolean; tickets: boolean; pap: boolean };
  unconfiguredProfiles: ProfileKey[];
  readAt: string;
};

const ZERO = Dec.ZERO;
const ALIAS_SCOPE_MESSAGE = "Ingreso agrupado en Grupo Cliente: sin ingreso propio ni cartera atribuida a este nivel.";

// ---------------------------------------------------------------- Referencias

const toCriteria = (m: GroupMeta): CriteriaMeta => ({
  support: m.support,
  hosting: m.hosting,
  complexity: m.complexity,
  product: { ...m.product, contains: m.product.contains },
});

function resolveReference(q: PulseQuery, cfg: PulseConfig, id: string): PulseReference {
  if (id === "custom") {
    return {
      id: "custom", label: "Personalizada (criterios copiados de los filtros)", kind: "CRITERIA", plans: q.custom.plans as PulseReference["plans"], hostings: q.custom.hostings as PulseReference["hostings"],
      complexities: q.custom.complexities as PulseReference["complexities"], product: q.custom.product || null, homogeneous: q.custom.homogeneous, excludeSilver: false, origin: "PERSONALIZADA",
    };
  }
  const r = cfg.references.find((x) => x.id === id);
  if (!r) throw new DomainError(`La referencia «${id}» no existe en esta revisión de Pulse Rent: elija otra o use una personalizada.`);
  return r;
}

export function describeReference(r: PulseReference): string {
  if (r.kind === "ALL") return "Todas las entidades del ámbito con valor válido.";
  const parts: string[] = [];
  if (r.excludeSilver) parts.push("plan conocido y distinto de Silver");
  if (r.plans.length) parts.push(`plan ${r.plans.join(" / ")}`);
  if (r.hostings.length) parts.push(`servidor ${r.hostings.join(" / ")}`);
  if (r.complexities.length) parts.push(`complejidad ${r.complexities.join(" / ")}`);
  if (r.product) parts.push(`producto ${r.product}`);
  return `Grupos completos con ${parts.join(", ")}${r.homogeneous ? "; solo grupos homogéneos (sin mezcla ni valores desconocidos)" : ""}.`;
}

// ---------------------------------------------------------------- Entidades del ámbito

type Ent = { id: string; name: string; parent: string | null; groupId: string | null; type: PulseRow["type"]; isActive: boolean };

async function loadScopeEntities(tx: Tx, scope: PulseQuery["scope"], groups: GroupMeta[]): Promise<Ent[]> {
  if (scope === "group") return groups.map((g) => ({ id: g.id, name: g.name, parent: null, groupId: g.id, type: "group" as const, isActive: g.isActive }));
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  if (scope === "client") {
    const rows = await tx.client.findMany({ where: { isInternal: false }, select: { id: true, name: true, isActive: true, groupId: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
    return rows.map((c) => ({ id: c.id, name: c.name, parent: c.groupId ? (groupName.get(c.groupId) ?? null) : null, groupId: c.groupId, type: "client" as const, isActive: c.isActive }));
  }
  const rows = await tx.implementation.findMany({ where: { client: { isInternal: false } }, select: { id: true, name: true, isActive: true, client: { select: { name: true, groupId: true } } }, orderBy: [{ name: "asc" }, { id: "asc" }] });
  return rows.map((i) => ({ id: i.id, name: `${i.client.name} › ${i.name}`, parent: i.client.groupId ? (groupName.get(i.client.groupId) ?? null) : null, groupId: i.client.groupId, type: "implementation" as const, isActive: i.isActive }));
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ---------------------------------------------------------------- Cálculo de celdas

type Ops = {
  coverage: { zd_time: boolean; wrike_time: boolean; tickets: boolean; pap: boolean };
  minutes: Map<string, Dec>; // entity|profile|cls
  tickets: Map<string, { total: number; n2: number; n3: number; n2n3: number }>;
  pap: Map<string, Map<string, number>>; // entity → kind → n
};
type Ctx = {
  cfg: PulseConfig;
  q: PulseQuery;
  pKey: "month" | "prevMonth" | "cum" | "prevYear" | "prevCum";
  from: string;
  to: string;
  cut: string;
  ops: Ops;
  configured: Set<ProfileKey>;
  ecoPortfolio: PortfolioPeriodResult | null;
  partialCut: boolean;
};

const mins = (ops: Ops, e: string, profile: string, cls: string) => ops.minutes.get(`${e}|${profile}|${cls}`) ?? ZERO;
const H = (m: Dec) => m.divInt(60);
const CLASSES = ["INCIDENTE_VINCLE", "OTRO_SOPORTE", "SIN_CLASIFICAR"] as const;

function unitOf(m: PulseMetric, v: Normalization): string {
  if (m.kind === "ratio" || m.kind === "stock") return m.unit;
  switch (v) {
    case "raw": return m.unit;
    case "per_user": return `${m.unit}/usuario·mes`;
    case "per_user_year": return `${m.unit}/usuario·año equivalente`;
    case "per_100": return `${m.unit}/100 usuarios·mes`;
    case "per_100_year": return `${m.unit}/100 usuarios·año equivalente`;
  }
}

function blank(m: PulseMetric, v: Normalization, ctx: Ctx): Cell {
  const d = directionOf(m, ctx.cfg);
  return { metricId: m.id, value: null, raw: null, state: "NO_DATA", reason: null, unit: unitOf(m, v), variant: v, numerator: null, denominator: null, formula: NORMALIZATION_FORMULA[v], band: null, bandReason: null, bandRule: "", direction: d.direction, customDirection: d.custom };
}

const sourceGap = (profile: ProfileKey | "ALL", from: string, to: string, cov: Ops["coverage"]): string[] => {
  const needZd = profile === "PMO_N3" ? from < PMO_CUTOFF : true;
  const needWr = (profile === "PMO_N3" || profile === "ALL") && to >= PMO_CUTOFF;
  const out: string[] = [];
  if (needZd && !cov.zd_time) out.push("tiempos Zendesk");
  if (needWr && !cov.wrike_time) out.push("tiempos Wrike (PMO desde 2025)");
  return out;
};

/** Estado de un valor ya calculado: cero confirmado solo con fuentes completas; con parcialidad, nunca cero ni verde. */
function settle(c: Cell, raw: Dec | null, nv: NormalizedValue, flags: { gap?: string[]; partial?: string | null; rawOnly?: boolean }): Cell {
  c.raw = raw?.toString() ?? null;
  c.numerator = nv.numerator?.toString() ?? null;
  c.denominator = nv.denominator?.toString() ?? null;
  if (raw === null) {
    c.state = "NO_DATA";
    c.reason = nv.reason;
    return c;
  }
  if (flags.gap && flags.gap.length > 0) {
    // Una fuente relevante ausente impide publicar un cero (o cualquier valor) como evidencia.
    c.state = raw.isZero() ? "NO_DATA" : "PARTIAL";
    c.reason = `Sin cobertura declarada de ${flags.gap.join(" y ")} en el periodo (Administración › Cargas): ${raw.isZero() ? "el cero no es evidencia" : "valor conocido incompleto"}.`;
    c.value = raw.isZero() ? null : nv.value?.toString() ?? null;
    return c;
  }
  if (nv.value === null) {
    c.state = "NO_DATA";
    c.reason = nv.reason;
    return c;
  }
  c.value = nv.value.toString();
  if (flags.partial) {
    c.state = "PARTIAL";
    c.reason = flags.partial;
    return c;
  }
  c.state = nv.value.isZero() ? "ZERO" : "OK";
  c.reason = nv.reason;
  return c;
}

function fromFormula(c: Cell, f: { value: string | null; numerator: string | null; denominator: string | null; status: string; reason: string | null; code?: string | null }, scopeNote?: string): Cell {
  c.numerator = f.numerator;
  c.denominator = f.denominator;
  if (f.value !== null && f.status === "AVAILABLE") {
    c.value = f.value;
    c.raw = f.value;
    const v = Dec.parse(f.value) as Dec;
    c.state = v.isZero() ? "ZERO" : "OK";
    c.reason = f.reason;
    return c;
  }
  c.reason = f.reason ?? scopeNote ?? null;
  if (f.status === "PARTIAL") c.state = "PARTIAL";
  else if (f.code === "NOT_GROUP_LEVEL" || f.code === "SILVER_ON_DEMAND" || f.code === "PLAN_MIXED") c.state = "NA";
  else c.state = "NO_DATA";
  return c;
}

function exposureOf(p: PeriodSeries): { userMonths: Dec | null } {
  return { userMonths: p.users.userMonths === null ? null : (Dec.parse(p.users.userMonths) as Dec) };
}

function computeCell(m: PulseMetric, e: EntityResult, ctx: Ctx, wanted: Normalization): Cell {
  const variant = variantFor(m, wanted);
  const c = blank(m, variant, ctx);
  const p = e.periods[m.period === "prevYear" ? "prevYear" : ctx.pKey];
  const ex = exposureOf(p);
  const spec = m.spec;
  const { ops } = ctx;
  const from = m.period === "prevYear" ? p.from : ctx.from;
  const to = m.period === "prevYear" ? p.to : ctx.to;
  if (!m.scopes.includes(e.type)) {
    c.state = "NA";
    c.reason = e.type === "implementation" ? "Los tickets no tienen atribución a implantaciones." : ALIAS_SCOPE_MESSAGE;
    return c;
  }
  const unknownService = Dec.parse(p.hours.byService.SIN_CLASIFICAR)!.add(Dec.parse(p.hours.byService.CONFLICTO)!);
  const perimeterNote = (): string | null => {
    const pending = Dec.parse(p.hours.pendingEligibility) as Dec;
    if (pending.sign() > 0) return `Hay ${pending.toString()} h con elegibilidad pendiente (PMO desconocido) que podrían entrar en el perímetro.`;
    if (unknownService.sign() > 0 && ctx.q.base.service !== "TOTAL") return `Hay ${unknownService.toString()} h sin servicio o en conflicto: el perímetro podría cambiar.`;
    return null;
  };
  switch (spec.t) {
    case "hours": {
      if (!ctx.configured.has(spec.profile)) {
        c.state = "UNCONFIGURED";
        c.reason = `${PROFILE_LABEL[spec.profile]}: perfil sin configurar. Selecciónelo en Administración › Configuración › Pulse Rent; no se publica cero.`;
        return c;
      }
      const prof = spec.profile;
      const byCls = (cls: string) => mins(ops, e.id, prof, cls);
      const total = CLASSES.reduce((s, k) => s.add(byCls(k)), ZERO);
      const unclassified = byCls("SIN_CLASIFICAR");
      const minutes = spec.cls === "total" ? total : spec.cls === "unclassified" ? unclassified : byCls(CLS_VALUE[spec.cls]);
      const raw = H(minutes);
      let partial = perimeterNote();
      if (!partial && prof === "PMO_N3" && (Dec.parse(p.hours.pendingEligibility) as Dec).sign() > 0) partial = "Horas PMO con elegibilidad pendiente.";
      if (!partial && (spec.cls === "incident" || spec.cls === "other") && unclassified.sign() > 0) {
        partial = `Hay ${H(unclassified).toString()} h sin clasificar / pendientes de causa: esta variante es una cota inferior (el total sí es completo).`;
      }
      const gap = sourceGap(prof, from, to, ops.coverage);
      const nv = hoursValue(raw, variant, ex, ctx, p);
      return settle(c, raw, nv, { gap, partial });
    }
    case "hours_total": {
      const raw = Dec.parse(p.hours.inPerimeter) as Dec;
      const nv = hoursValue(raw, variant, ex, ctx, p);
      return settle(c, raw, nv, { gap: sourceGap("ALL", from, to, ops.coverage), partial: perimeterNote() });
    }
    case "users_stock": {
      const s = p.users.stock;
      c.unit = "usuarios";
      c.formula = "Stock del mes del corte (no se suma ni prorratea)";
      if (s.value === null) {
        c.reason = "Mes del corte sin informar en la matriz de usuarios.";
        return c;
      }
      c.raw = String(s.value);
      c.value = String(s.value);
      c.state = s.value === 0 ? "ZERO" : "OK";
      return c;
    }
    case "income_per_user": {
      const f = p.perUserPerYear;
      if (e.type !== "group") {
        c.state = "NA";
        c.reason = ALIAS_SCOPE_MESSAGE;
        return c;
      }
      if (f.value === null || f.status !== "AVAILABLE") return fromFormula(c, f);
      // 12R/UM del motor; la variante «por usuario y mes» es R/UM = (12R/UM) / 12.
      const annual = Dec.parse(f.value) as Dec;
      c.raw = f.numerator === null ? null : (Dec.parse(f.numerator) as Dec).divInt(12).toString();
      const v = variant === "per_user" ? annual.divInt(12) : annual;
      c.value = v.toString();
      c.state = v.isZero() ? "ZERO" : "OK";
      c.numerator = f.numerator;
      c.denominator = f.denominator;
      c.reason = f.reason;
      return c;
    }
    case "pap": {
      const pred = papPredicate(spec.kind);
      if (pred === null) {
        c.state = "NO_DATA";
        c.reason = "Sin evidencia positiva de no facturación de los evolutivos: esta métrica no está disponible (los evolutivos observados se ofrecen aparte, M37). No se añade un campo de facturación manual.";
        return c;
      }
      const n = ops.pap.get(e.id)?.get(spec.kind) ?? 0;
      const raw = Dec.int(n);
      const gap = ops.coverage.pap ? [] : ["PAP"];
      return settle(c, raw, normalize(raw, variant, ex), { gap });
    }
    case "n2_to_n3": {
      const t = ops.tickets.get(e.id) ?? { total: 0, n2: 0, n3: 0, n2n3: 0 };
      c.numerator = String(t.n2n3);
      c.denominator = String(t.n2);
      if (!ops.coverage.tickets) {
        c.reason = "Sin cobertura declarada de tickets Zendesk en el periodo: no se publica un porcentaje.";
        return c;
      }
      if (t.n2 === 0) {
        c.state = "NA";
        c.reason = "Ningún ticket con N2 en el periodo: denominador cero, no calculable.";
        return c;
      }
      const v = Dec.int(100).mulInt(t.n2n3).divInt(t.n2);
      c.raw = v.toString();
      c.value = v.toString();
      c.state = v.isZero() ? "ZERO" : "OK";
      return c;
    }
    case "n3_tickets": {
      const t = ops.tickets.get(e.id) ?? { total: 0, n2: 0, n3: 0, n2n3: 0 };
      const raw = Dec.int(t.n3);
      return settle(c, raw, normalize(raw, variant, ex), { gap: ops.coverage.tickets ? [] : ["tickets Zendesk"] });
    }
    case "n3_pct_all": {
      const t = ops.tickets.get(e.id) ?? { total: 0, n2: 0, n3: 0, n2n3: 0 };
      c.numerator = String(t.n3);
      c.denominator = String(t.total);
      if (!ops.coverage.tickets) {
        c.reason = "Sin cobertura declarada de tickets Zendesk en el periodo.";
        return c;
      }
      if (t.total === 0) {
        c.state = "NA";
        c.reason = "Sin tickets creados en el periodo: denominador cero, no calculable.";
        return c;
      }
      const v = Dec.int(100).mulInt(t.n3).divInt(t.total);
      c.raw = v.toString();
      c.value = v.toString();
      c.state = v.isZero() ? "ZERO" : "OK";
      return c;
    }
    case "per_day":
    case "per_day_prev_year":
      return fromFormula(c, p.perDay, ALIAS_SCOPE_MESSAGE);
    case "dev_target":
      return fromFormula(c, p.deviationVsTarget, ALIAS_SCOPE_MESSAGE);
    case "dev_portfolio": {
      if (e.type !== "group") {
        c.state = "NA";
        c.reason = ALIAS_SCOPE_MESSAGE;
        return c;
      }
      const port = ctx.ecoPortfolio;
      if (!port || port.perDay.value === null) {
        c.state = port?.perDay.status === "PARTIAL" ? "PARTIAL" : "NO_DATA";
        c.reason = `La cartera de referencia no se publica como completa: ${port?.perDay.reason ?? "sin cartera."}`;
        return c;
      }
      if (p.perDay.value === null) return fromFormula(c, p.perDay);
      const d = deviationPortfolioParts(Dec.parse(port.perDay.value) as Dec, Dec.parse(p.perDay.value) as Dec);
      if (!d) {
        c.state = "NO_DATA";
        c.reason = "La cartera de referencia tiene ratio cero: no se divide.";
        return c;
      }
      c.value = d.value.toString();
      c.raw = c.value;
      c.numerator = d.numerator.toString();
      c.denominator = d.denominator.toString();
      c.state = d.value.isZero() ? "ZERO" : "OK";
      c.reason = "Positivo = por debajo de la cartera de referencia.";
      return c;
    }
  }
}

/** Valor de una magnitud de horas: normalización correcta, o equivalencia histórica (modo separado, solo con mes completo y CUM). */
function hoursValue(raw: Dec, variant: Normalization, ex: { userMonths: Dec | null }, ctx: Ctx, p: PeriodSeries): NormalizedValue {
  if (ctx.q.historic && variant === "per_user_year") {
    if (ctx.pKey !== "cum") return { value: null, reason: "La equivalencia histórica solo se aplica al CUM actual.", numerator: raw, denominator: null };
    const cutP = parseYmd(ctx.cut);
    const stock = p.users.stock.value;
    return historicalHoursEquivalent(raw, stock, cutP.m, ctx.partialCut);
  }
  return normalize(raw, variant, ex);
}

// ---------------------------------------------------------------- Lecturas por conjuntos

async function loadOps(tx: Tx, q: PulseQuery, cfg: PulseConfig, ids: string[], from: string, to: string, metricIds: string[]): Promise<Ops> {
  // Cobertura compartida con Calidad (CSAPP-08 §6): una declaración vigente de un lote completado, no la mera presencia de filas fechadas.
  const decls = await loadDeclarations(tx);
  const complete = (s: "zd_time" | "wrike_time" | "tickets" | "pap") => coverageOf(s, decls, from, to, "FLOW").state === "COMPLETE";
  const cov: Ops["coverage"] = { zd_time: complete("zd_time"), wrike_time: complete("wrike_time"), tickets: complete("tickets"), pap: complete("pap") };
  const ops: Ops = { coverage: cov, minutes: new Map(), tickets: new Map(), pap: new Map() };
  if (ids.length === 0) return ops;
  const metrics = metricIds.map((m) => METRIC_BY_ID.get(m) as PulseMetric);
  const needHours = metrics.some((m) => m.spec.t === "hours");
  const needTickets = metrics.some((m) => ["n2_to_n3", "n3_tickets", "n3_pct_all"].includes(m.spec.t)) && q.scope !== "implementation";
  const papKinds = [...new Set(metrics.flatMap((m) => (m.spec.t === "pap" ? [m.spec.kind] : [])))].filter((k) => papPredicate(k) !== null);
  const jobs: (() => Promise<void>)[] = [];
  // Una consulta por familia de hechos (no una por entidad/mes/percentil). La instantánea REPEATABLE READ de `tx` hace coherentes las lecturas.
  if (needHours) {
    jobs.push(
      async () => {
        const rows = await tx.$queryRaw<{ entity: string; profile: string; cls: string; minutes: string }[]>(Prisma.sql`
          SELECT x.entity, x.profile, x.cls, sum(x.minutes)::text AS minutes FROM (${classifiedActivitySql({ scope: q.scope, ids, from, to, service: q.base.service, selectors: selectorsOf(cfg) })}) x GROUP BY 1, 2, 3`);
        for (const r of rows) ops.minutes.set(`${r.entity}|${r.profile}|${r.cls}`, Dec.parse(r.minutes) as Dec);
      },
    );
  }
  if (needTickets && q.scope !== "implementation") {
    jobs.push(
      async () => {
        const rows = await tx.$queryRaw<{ entity: string; total: bigint; n2: bigint; n3: bigint; n2n3: bigint }[]>(Prisma.sql`
          SELECT x.entity, count(*) AS total, count(*) FILTER (WHERE ${ticketPredicate("n2")}) AS n2, count(*) FILTER (WHERE ${ticketPredicate("n3")}) AS n3, count(*) FILTER (WHERE ${ticketPredicate("n2_to_n3")}) AS n2n3
          FROM (${ticketSetSql(q.scope as "group" | "client", ids, from, to)}) x WHERE x.entity IS NOT NULL GROUP BY 1`);
        for (const r of rows) ops.tickets.set(r.entity, { total: Number(r.total), n2: Number(r.n2), n3: Number(r.n3), n2n3: Number(r.n2n3) });
      },
    );
  }
  if (papKinds.length > 0) {
    jobs.push(
      async () => {
        const cols = Prisma.join(papKinds.map((k) => Prisma.sql`count(*) FILTER (WHERE ${papPredicate(k) as Prisma.Sql}) AS ${Prisma.raw(`"${k}"`)}`));
        const rows = await tx.$queryRaw<Record<string, string | bigint>[]>(Prisma.sql`
          SELECT x.entity, ${cols} FROM (${papSetSql(q.scope, ids)}) x WHERE x."productionDate" BETWEEN ${from}::date AND ${to}::date GROUP BY 1`);
        for (const r of rows) ops.pap.set(r.entity as string, new Map(papKinds.map((k) => [k, Number(r[k])])));
      },
    );
  }
  // Las consultas comparten la transacción (una conexión): se encadenan, no se paralelizan en conexiones distintas.
  for (const j of jobs) await j();
  return ops;
}

// ---------------------------------------------------------------- Servicio

export type PulseOptions = { allRows?: boolean };

export async function getPulse(actorId: string, query: PulseQuery, opts: PulseOptions = {}): Promise<PulseView> {
  return readSnapshot(actorId, (tx) => computePulse(tx, query, opts));
}

export async function computePulse(tx: Tx, q: PulseQuery, opts: PulseOptions = {}): Promise<PulseView> {
  const rev = await getActive(tx, "PULSE", q.pulseRevision ?? undefined);
  const cfg = rev.payload;
  const manifest = await getManifest(tx);
  const base = q.base;
  const cut = effectiveCut(base.date, base.mode);
  const groups = await loadGroupMeta(tx, cut);
  await snapshotPoint("pulse:after-meta");

  // 1. Referencias: estadística (distribuciones) y económica (cartera). Independientes de las filas visibles.
  const refId = q.ref || cfg.defaultReference;
  const reference = resolveReference(q, cfg, refId);
  const refEco = q.refEco ? resolveReference(q, cfg, q.refEco) : reference;
  const member = (r: PulseReference) => {
    const reasons = new Map<string, number>();
    const ok = new Set<string>();
    for (const g of groups) {
      const m = referenceMembership(r, toCriteria(g));
      if (m.member) ok.add(g.id);
      else reasons.set(m.reason ?? "fuera de criterios", (reasons.get(m.reason ?? "fuera de criterios") ?? 0) + 1);
    }
    return { ok, reasons };
  };
  const statMembers = member(reference);
  const ecoMembers = refEco.id === reference.id ? statMembers : member(refEco);

  // 2. Entidades del ámbito: filas visibles (filtros de presentación) y poblaciones de referencia.
  const all = await loadScopeEntities(tx, q.scope, groups);
  const needle = fold(base.q);
  // HOTFIX-03 §7: el estado comercial es efectivo (Grupo según sus Clientes externos; Cliente con su Grupo). En ámbito Cliente el estado se evalúa por Cliente.
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const visibleGroups = new Set(filterGroups(groups, { ...base, q: "", status: q.scope === "group" ? base.status : "todos" }).map((g) => g.id));
  const visible = all.filter((e) => {
    const effective = q.scope === "group" ? (groupById.get(e.id)?.effectiveActive ?? e.isActive) : clientEffectiveActive(e, e.groupId ? { isActive: groupById.get(e.groupId)?.isActive ?? true } : null);
    if (!matchesEstado(effective, base.status)) return false;
    if (needle !== "" && !fold(e.name).includes(needle) && !fold(e.parent ?? "").includes(needle)) return false;
    if (q.scope === "group") return visibleGroups.has(e.id);
    const filtersOn = base.support.length + base.hosting.length + base.complexity.length > 0 || base.product !== "" || base.coverage !== "todas";
    if (!filtersOn) return true;
    return e.groupId !== null && visibleGroups.has(e.groupId);
  });
  const inRef = (members: Set<string>, r: PulseReference) => (e: Ent) => (r.kind === "ALL" ? true : e.groupId !== null && members.has(e.groupId));
  const refEntities = all.filter(inRef(statMembers.ok, reference));
  const ecoGroups = groups.filter((g) => (refEco.kind === "ALL" ? true : ecoMembers.ok.has(g.id)));

  // 3. Motor económico: una sola llamada por conjuntos (filas ∪ referencias).
  const unionIds = new Set<string>([...visible.map((e) => e.id), ...refEntities.map((e) => e.id)]);
  const ecoGroupIds = q.scope === "group" ? ecoGroups.map((g) => g.id) : [];
  for (const id of ecoGroupIds) if (q.scope === "group") unionIds.add(id);
  const ids = [...unionIds];
  const scopeArg = q.scope === "group" ? ({ type: "groups", ids } as const) : q.scope === "client" ? ({ type: "clients", ids } as const) : ({ type: "implementations", ids } as const);
  const econ = ids.length === 0 ? null : await economicsInTx(tx, { scope: scopeArg, service: base.service, date: base.date, mode: base.mode, settingsRevision: base.revision ?? undefined, unpaged: true });
  await snapshotPoint("pulse:after-economics");
  const results = new Map<string, EntityResult>((econ?.entities ?? []).map((e) => [e.id, e]));
  const pKey = PERIOD_KEY[q.period];
  const periodDef = (econ?.periodsDefinition ?? null)?.[pKey];
  if (!econ || !periodDef) {
    return emptyView(q, cfg, rev, manifest, cut, reference, statMembers, base.date);
  }

  // 4. Hechos operativos del periodo seleccionado, por conjuntos.
  const wanted = [...new Set([...q.metrics, ...(q.col ? [q.col] : [])])];
  const ops = await loadOps(tx, q, cfg, ids, periodDef.from, periodDef.to, wanted);
  await snapshotPoint("pulse:after-ops");

  // 5. Referencia económica: cartera ponderada ΣR/ΣH×jornada sobre los grupos de la referencia (no la media de ratios).
  const target = Dec.parse(econ.settings.targetEurosPerDay) as Dec;
  const dayHours = Dec.parse(econ.settings.dayHours) as Dec;
  let ecoPortfolio: PortfolioPeriodResult | null = null;
  let economic: EconomicBlock | null = null;
  if (q.scope === "group") {
    const rows = ecoGroups
      .map((g) => results.get(g.id))
      .filter((e): e is EntityResult => Boolean(e))
      .map((e) => {
        const p = e.periods[pKey];
        return { id: e.id, revenue: p.revenue.value === null ? null : (Dec.parse(p.revenue.value) as Dec), minutes: Dec.parse(p.hours.perimeterMinutes) as Dec, status: p.perDay.status, code: p.perDay.code ?? null };
      });
    ecoPortfolio = aggregatePortfolio(rows, target, dayHours);
    const ratios = ecoGroups.flatMap((g) => {
      const v = results.get(g.id)?.periods[pKey].perDay;
      return v?.value && v.status === "AVAILABLE" ? [Dec.parse(v.value) as Dec] : [];
    });
    economic = {
      id: refEco.id,
      label: refEco.label,
      groups: ecoGroups.length,
      portfolio: { complete: ecoPortfolio.complete, coverage: ecoPortfolio.coverage, revenue: ecoPortfolio.revenue, hours: ecoPortfolio.hours, affected: ecoPortfolio.affected, perDay: ecoPortfolio.perDay.value, status: ecoPortfolio.perDay.status, reason: ecoPortfolio.perDay.reason },
      meanOfRatios: ratios.length === 0 ? null : ratios.reduce((s, v) => s.add(v), ZERO).divInt(ratios.length).toString(),
    };
  }

  const cutP = parseYmd(cut);
  const ctx: Ctx = { cfg, q, pKey, from: periodDef.from, to: periodDef.to, cut, ops, configured: configuredProfiles(cfg), ecoPortfolio, partialCut: base.mode === "CUTOFF" && cutP.d < lastDayOfMonth(cutP.y, cutP.m) };
  const wantedNorm = NORM_OF[q.norm];
  const metrics = wanted.map((id) => METRIC_BY_ID.get(id) as PulseMetric);
  const cellOf = new Map<string, Cell>(); // entity|metric
  const cellFor = (e: Ent, m: PulseMetric): Cell => {
    const k = `${e.id}|${m.id}`;
    let c = cellOf.get(k);
    if (!c) {
      const r = results.get(e.id);
      c = r ? computeCell(m, r, ctx, wantedNorm) : blank(m, variantFor(m, wantedNorm), ctx);
      cellOf.set(k, c);
    }
    return c;
  };

  // 6. Estadística de TODA la referencia (antes de paginar): una observación por identidad canónica.
  const stats: Record<string, Stats> = {};
  for (const m of metrics) {
    const obs = refEntities.map((e) => {
      const c = cellFor(e, m);
      const valid = (c.state === "OK" || c.state === "ZERO") && c.value !== null;
      return { value: valid ? (Dec.parse(c.value as string) as Dec) : null, reason: valid ? null : `${STATE_LABEL[c.state]}${c.state === "PARTIAL" ? " (valor incompleto)" : ""}` };
    });
    const variant = variantFor(m, wantedNorm);
    const dir = directionOf(m, cfg);
    stats[m.id] = { ...distribution(obs), metricId: m.id, variant, unit: unitOf(m, variant), direction: dir.direction, customDirection: dir.custom };
  }

  // 7. Bandas de las filas visibles contra los cortes de SU columna.
  const bandCell = (c: Cell) => {
    const st = stats[c.metricId];
    const valid = (c.state === "OK" || c.state === "ZERO") && c.value !== null;
    const r = bandOf(valid ? (Dec.parse(c.value as string) as Dec) : null, c.direction, cutsOf(st));
    c.band = r.band;
    c.bandRule = r.rule;
    c.bandReason = r.band === null ? (c.state === "PARTIAL" ? "Valor parcial: no se colorea (no se produce un verde por datos incompletos)." : r.reason) : null;
  };

  // 8. Orden estable (numérico, nulos al final en ambos sentidos) y página.
  const sign = base.dir === "asc" ? 1 : -1;
  const sorted = [...visible].sort((a, b) => {
    const byName = a.name.localeCompare(b.name, "es") || (a.id < b.id ? -1 : 1);
    if (q.sort === "name") return sign * byName;
    const m = METRIC_BY_ID.get(q.sort);
    if (!m) return byName;
    const va = cellFor(a, m).value;
    const vb = cellFor(b, m).value;
    if (va === null || vb === null) return va === null && vb === null ? byName : va === null ? 1 : -1;
    return sign * (Dec.parse(va) as Dec).cmp(Dec.parse(vb) as Dec) || byName;
  });
  const pageCount = Math.max(1, Math.ceil(sorted.length / base.pageSize));
  const page = Math.min(base.page, pageCount);
  const pageRows = opts.allRows ? sorted : sorted.slice((page - 1) * base.pageSize, page * base.pageSize);
  const shown = q.metrics.map((id) => METRIC_BY_ID.get(id) as PulseMetric);
  const selected = q.sel && !pageRows.some((e) => e.id === q.sel) ? all.filter((e) => e.id === q.sel) : [];
  const rowsOut: PulseRow[] = [...pageRows, ...selected].map((e) => {
    const cells: Record<string, Cell> = {};
    for (const m of metrics) {
      const c = { ...cellFor(e, m) };
      bandCell(c);
      cells[m.id] = c;
    }
    return { id: e.id, name: e.name, parent: e.parent, type: e.type, cells };
  });

  const notes: string[] = [];
  if (econ.recalculatedWithOlderSettings) notes.push(`Economía recalculada con la revisión ${econ.settings.revisionNo} (no es la vigente).`);
  if (rev.revisionNo !== manifest.pulse && q.pulseRevision !== null) notes.push(`Pulse Rent recalculado con la revisión ${rev.revisionNo} (la vigente es la ${manifest.pulse}).`);
  const unconf = (["CS_N1", "CS_N2", "PMO_N3", "IT_N3", "PLATAFORMA_N4"] as ProfileKey[]).filter((k) => !ctx.configured.has(k));
  if (econ.reference.validation.state !== "VALIDATED") notes.push("Derivados pendientes de reproceso: magnitudes conservadas pero no validadas.");
  if (q.scope !== "group") notes.push("Cliente/implantación: sin ingreso propio, las métricas económicas son «no aplicable» (ingreso agrupado en Grupo Cliente); las operativas usan los usuarios propios de cada ámbito.");
  if (q.scope === "group" && reference.kind === "CRITERIA") notes.push("La referencia por criterios selecciona grupos completos; el ingreso total del grupo nunca se compara con solo las horas de un producto o equipo.");
  if (periodDef.provisional) notes.push("Periodo en curso: valores provisionales (el mes no está cerrado).");

  return {
    query: q,
    cut,
    period: { key: pKey, from: periodDef.from, to: periodDef.to, label: periodDef.label, provisional: periodDef.provisional, partial: ctx.partialCut && (pKey === "cum" || pKey === "month") },
    config: { revisionNo: rev.revisionNo, persisted: rev.persisted, custom: Object.keys(cfg.directions) },
    manifest,
    stamp: econ.reference.dataStamp.stamp,
    engineVersion: econ.reference.engineVersion,
    validated: econ.reference.validation.state === "VALIDATED",
    totalEntities: all.length,
    filteredEntities: visible.length,
    rows: rowsOut,
    page,
    pageCount,
    metrics: shown,
    stats,
    reference: {
      id: reference.id, label: reference.label, origin: reference.origin, description: describeReference(reference),
      members: refEntities.length, evaluated: reference.kind === "ALL" ? all.length : groups.length,
      exclusions: [...statMembers.reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, "es")),
      metadataCut: cut,
    },
    economicReference: economic,
    notes,
    sources: { zendeskTime: ops.coverage.zd_time, wrikeTime: ops.coverage.wrike_time, tickets: ops.coverage.tickets, pap: ops.coverage.pap },
    unconfiguredProfiles: unconf,
    readAt: econ.reference.readAt,
  };
}

function emptyView(q: PulseQuery, cfg: PulseConfig, rev: Awaited<ReturnType<typeof getActive<"PULSE">>>, manifest: PulseView["manifest"], cut: string, reference: PulseReference, members: { ok: Set<string> }, date: string): PulseView {
  return {
    query: q, cut, period: { key: PERIOD_KEY[q.period], from: date, to: date, label: "Sin datos", provisional: false, partial: false },
    config: { revisionNo: rev.revisionNo, persisted: rev.persisted, custom: Object.keys(cfg.directions) }, manifest, stamp: "", engineVersion: "", validated: true,
    totalEntities: 0, filteredEntities: 0, rows: [], page: 1, pageCount: 1, metrics: q.metrics.map((id) => METRIC_BY_ID.get(id) as PulseMetric), stats: {},
    reference: { id: reference.id, label: reference.label, origin: reference.origin, description: describeReference(reference), members: members.ok.size, evaluated: 0, exclusions: [], metadataCut: cut },
    economicReference: null, notes: ["Sin datos: no hay entidades en el ámbito seleccionado. Cargue los maestros y las fuentes en Administración; no hay demostración automática."],
    sources: { zendeskTime: false, wrikeTime: false, tickets: false, pap: false }, unconfiguredProfiles: [], readAt: new Date().toISOString(),
  };
}
