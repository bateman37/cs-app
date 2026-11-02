import { Prisma } from "@/generated/prisma/client";
import { Dec, lastDayOfMonth, parseYmd } from "@/domain/finance";
import { todayMadrid } from "@/domain/vigencia";
import { PMO_CUTOFF } from "@/domain/zendesk";
import { PROFILE_KEYS, referenceMembership, type PulseReference, type CriteriaMeta } from "@/domain/pulse-catalog";
import { percentileInc, sortDec } from "@/domain/pulse-stats";
import {
  BACKLOG_UNIT, INDICATOR_KEYS, INDICATOR_NAME, METRIC_UNIT, UNIT_LABEL, ageDays, backlogStockRate, evaluateEntity, flowRate, hoursPerUserMonth, isAged,
  type ComponentInput, type EntityEvaluation, type EntityInput, type IndicatorKey, type QScope, type QualityConfig,
} from "@/domain/quality-config";
import { chooseSnapshot, coverageOf, type Coverage, type CoverageSource, type Declaration, type SnapshotChoice } from "@/domain/quality-coverage";
import { healthStateOf, healthUse, type HealthUse } from "@/domain/quality-health";
import { qualityPeriod, type QualityPeriod, type QualityQuery } from "@/domain/quality-query";
import { loadGroupMeta, filterGroups, type GroupMeta } from "@/server/analytics/portfolio";
import { readSnapshot, snapshotPoint, type Tx } from "@/server/analytics/snapshot";
import { readDataStamp } from "@/server/analytics/stamp";
import { getActive, getManifest } from "@/server/pulse/config";
import { selectorsOf } from "@/server/pulse/sql";
import { loadDeclarations, loadTicketBatches } from "./coverage";
import { hourFacts, papFacts, stockSetSql, ticketFacts, type HourRow, type PapFacts, type TicketFacts } from "./facts";
import { loadHealthForMonth } from "./health";

/**
 * Motor de Calidad (CSAPP-08 §5-§7, §10). Una instantánea REPEATABLE READ lee datos, configuración, usuarios, referencias y agregados; todo se calcula por
 * conjuntos y se evalúa con el evaluador puro común del dominio (el mismo que el simulador de Administración). Nada se consulta fuera de la transacción.
 */
const ZERO = Dec.ZERO;
export type Scope = "group" | "client";
const QSC: Record<Scope, QScope> = { group: "GRUPO", client: "CLIENTE" };

type Ent = { id: string; name: string; parent: string | null; groupId: string | null; isActive: boolean };
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const toCriteria = (m: GroupMeta): CriteriaMeta => ({ support: m.support, hosting: m.hosting, complexity: m.complexity, product: { ...m.product, contains: m.product.contains } });

async function loadEntities(tx: Tx, scope: Scope, groups: GroupMeta[]): Promise<Ent[]> {
  if (scope === "group") return groups.map((g) => ({ id: g.id, name: g.name, parent: null, groupId: g.id, isActive: g.isActive }));
  const gn = new Map(groups.map((g) => [g.id, g.name]));
  const rows = await tx.client.findMany({ where: { isInternal: false }, select: { id: true, name: true, isActive: true, groupId: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
  return rows.map((c) => ({ id: c.id, name: c.name, parent: c.groupId ? (gn.get(c.groupId) ?? null) : null, groupId: c.groupId, isActive: c.isActive }));
}

// ---------------------------------------------------------------- Usuarios (propios de cada ámbito)

type UserLookup = (id: string, y: number, m: number) => number | null;
async function loadUsers(tx: Tx, scope: Scope, ids: string[], years: number[]): Promise<UserLookup> {
  const col = scope === "group" ? '"groupId"' : '"clientId"';
  const map = new Map<string, number>();
  if (ids.length > 0) {
    const rows = await tx.$queryRaw<{ id: string; year: number; month: number; value: number }[]>(Prisma.sql`
      SELECT m.${Prisma.raw(col)} AS id, m.year, mm.month, mm.value FROM "UserMatrix" m JOIN "UserMatrixMonth" mm ON mm."matrixId" = m.id
      WHERE m.year = ANY(${years}) AND m.${Prisma.raw(col)} = ANY(${ids})`);
    for (const r of rows) map.set(`${r.id}|${r.year}|${r.month}`, r.value);
  }
  return (id, y, m) => map.get(`${id}|${y}|${m}`) ?? null;
}

type Users = { stock: number | null; userMonths: Dec | null; reason: string | null };
/** Usuarios mes del periodo mensual (peso días incluidos / días reales) y stock del mes del corte. Usuarios cero o desconocidos impiden tasas con motivos distintos. */
function usersOf(lookup: UserLookup, id: string, p: QualityPeriod): Users {
  const v = lookup(id, p.year, p.month);
  if (v === null) return { stock: null, userMonths: null, reason: "Usuarios del mes sin informar en la matriz: no se calculan tasas (los conteos se conservan)." };
  if (v === 0) return { stock: 0, userMonths: ZERO, reason: "Usuarios del mes = 0 (cero confirmado): no hay denominador para tasas (los conteos se conservan)." };
  return { stock: v, userMonths: Dec.int(v).ratio(p.days, p.daysInMonth), reason: null };
}

// ---------------------------------------------------------------- Resultado

export type Explain = { formula: string; numerator: string | null; denominator: string | null; unit: string; period: string; sources: string[]; notes: string[]; breakdown: Record<string, string>; coverage: { source: string; state: string; reason: string }[] };
export type QualityRow = {
  id: string; name: string; parent: string | null; scope: Scope;
  users: { stock: number | null; userMonths: string | null };
  evaluation: EntityEvaluation;
  explain: Record<IndicatorKey, Explain>;
  health: { state: string | null; comment: string | null; feedbackOn: string | null; recordedAt: string | null; version: number; use: HealthUse | null };
  /** Estados auxiliares para filtros de presentación. */
  flags: { uncalibrated: boolean; dataPending: boolean; hasGlobal: boolean };
  /** Tamaño de cobertura calculable (%) de la asignación. */
  coveragePercent: string;
};
export type PortfolioCards = { green: number; yellow: number; red: number; noGlobal: number; total: number; uncalibrated: number; dataPending: number };
export type BacklogInfo = { choice: SnapshotChoice; observedOn: string | null; usersMonth: { year: number; month: number } | null; exact: boolean; provisional: boolean; unknownFreshnessBatches: number; note: string; earlierInfo: { observedOn: string; gapDays: number } | null };
export type QualityView = {
  query: QualityQuery;
  period: QualityPeriod;
  config: { revisionNo: number; persisted: boolean; adapterNotes: string[]; simulated: boolean };
  pulseRevision: number;
  manifest: { economic: number; pulse: number; quality: number };
  stamp: string;
  readAt: string;
  totalEntities: number; filteredEntities: number;
  cards: PortfolioCards;
  rows: QualityRow[]; page: number; pageCount: number;
  coverage: Record<CoverageSource, Coverage>;
  backlog: BacklogInfo;
  notes: string[];
  healthSummary: { withFeedback: number; blank: number; uncalibrated: number };
  dedicationProfiles: { selected: string[]; confirmed: boolean };
  config_payload: QualityConfig;
  /** Solo con simulación: tarjetas con la configuración ACTIVA para comparar. */
  activeCards: PortfolioCards | null;
};

export type StockEntity = { incident: StockType; problem: StockType; observedOther: number; resolved: number; unknownStatus: number; questionTask: number; usersAtD: number | null };
export type StockType = { count: number; ages: number[]; aged: number; bands: number[]; invalidDates: number };
const emptyStock = (): StockType => ({ count: 0, ages: [], aged: 0, bands: [], invalidDates: 0 });

// ---------------------------------------------------------------- Cálculo

export type QualityOptions = { now?: Date; allRows?: boolean; configOverride?: QualityConfig | null; skipActiveCompare?: boolean; skipStamp?: boolean };

export async function getQuality(actorId: string, q: QualityQuery, opts: QualityOptions = {}): Promise<QualityView> {
  return readSnapshot(actorId, (tx) => computeQuality(tx, q, opts));
}

function age(a: number[], p: number): Dec | null {
  if (a.length === 0) return null;
  return percentileInc(sortDec(a.map((x) => Dec.int(x))), Math.round(p * 10000), 10000);
}
export { age as agePercentile };

function bandsOf(ages: number[], bands: { from: number; to: number | null }[]): number[] {
  return bands.map((b) => ages.filter((a) => a >= b.from && (b.to === null || a <= b.to)).length);
}

/** Cálculo del stock de una fotografía agregado por entidad (una consulta). */
export async function loadStock(tx: Tx, scope: Scope, ids: string[], batchId: string, thresholds: { incident: number | null; problem: number | null }, observedOn: string, bands: { from: number; to: number | null }[]): Promise<Map<string, StockEntity>> {
  const out = new Map<string, StockEntity>();
  if (ids.length === 0) return out;
  const rows = await tx.$queryRaw<{ entity: string; type: string; status: string; created_on: string; status_known: boolean; type_known: boolean }[]>(Prisma.sql`
    SELECT s.entity, s.type, s.status, s.created_on, s.status_known, s.type_known FROM (${stockSetSql(scope, ids, batchId, { activeOnly: true })}) s
    WHERE s.entity IS NOT NULL`); // los resueltos no entran en el stock: no se leen fila a fila
  const ent = (id: string): StockEntity => {
    let e = out.get(id);
    if (!e) out.set(id, (e = { incident: emptyStock(), problem: emptyStock(), observedOther: 0, resolved: 0, unknownStatus: 0, questionTask: 0, usersAtD: null }));
    return e;
  };
  const active = new Set(["new", "open", "pending", "hold"]);
  for (const r of rows) {
    const e = ent(r.entity);
    if (!r.status_known) { e.unknownStatus++; continue; }
    if (!active.has(r.status)) { e.resolved++; continue; }
    if (r.type !== "incident" && r.type !== "problem") { e.questionTask++; continue; }
    const t = r.type === "incident" ? e.incident : e.problem;
    const a = ageDays(r.created_on, observedOn);
    if (a === null) { t.invalidDates++; continue; }
    t.count++;
    t.ages.push(a);
    const th = r.type === "incident" ? thresholds.incident : thresholds.problem;
    if (th !== null && isAged(a, th)) t.aged++;
  }
  for (const e of out.values()) { e.incident.bands = bandsOf(e.incident.ages, bands); e.problem.bands = bandsOf(e.problem.ages, bands); }
  return out;
}

const cov = (declarations: Declaration[], source: CoverageSource, from: string, to: string, kind: "FLOW" | "STOCK" = "FLOW") => coverageOf(source, declarations, from, to, kind);

export async function computeQuality(tx: Tx, q: QualityQuery, opts: QualityOptions = {}): Promise<QualityView> {
  const today = todayMadrid(opts.now ?? new Date());
  const active = await getActive(tx, "QUALITY", q.qrev ?? undefined);
  const cfg: QualityConfig = opts.configOverride ?? active.payload;
  const pulse = await getActive(tx, "PULSE", q.prev ?? undefined);
  const manifest = await getManifest(tx);
  const period = qualityPeriod(q.base.date, q.base.mode, today);
  const scope: Scope = q.scope;
  const groups = await loadGroupMeta(tx, period.cut);
  await snapshotPoint("quality:after-meta");
  const all = await loadEntities(tx, scope, groups);
  const ids = all.map((e) => e.id);
  const readAt = (await tx.$queryRaw<{ t: Date }[]>(Prisma.sql`SELECT now() AS t`))[0].t.toISOString();
  const stamp = opts.skipStamp ? "" : (await readDataStamp(tx)).stamp;
  const declarations = await loadDeclarations(tx);
  const ticketBatches = await loadTicketBatches(tx);

  // --- Filtros de FILAS (identidad, producto/soporte/alojamiento/complejidad vigentes, estado): no tocan las referencias.
  const needle = fold(q.base.q);
  const visibleGroups = new Set(filterGroups(groups, { ...q.base, q: "" }).map((g) => g.id));
  const filtersOn = q.base.support.length + q.base.hosting.length + q.base.complexity.length > 0 || q.base.product !== "" || q.base.coverage !== "todas";
  const visible = all.filter((e) => {
    if (q.base.status !== "todos" && (q.base.status === "activos") !== e.isActive) return false;
    if (needle !== "" && !fold(e.name).includes(needle) && !fold(e.parent ?? "").includes(needle)) return false;
    if (scope === "group") return visibleGroups.has(e.id);
    return !filtersOn || (e.groupId !== null && visibleGroups.has(e.groupId));
  });

  const baseNotes: string[] = [];
  if (period.future) baseNotes.push("El mes elegido todavía no ha empezado: no hay datos ni se inventan.");
  if (period.clamped && !period.future) baseNotes.push(`El corte pedido (${period.requested}) es posterior a hoy: se usa hoy (${period.cut}); un mes en curso no se certifica cerrado ni recibe datos futuros.`);
  if (period.provisional) baseNotes.push("Periodo provisional: el mes no está cerrado.");

  // --- Hechos por conjuntos
  const years = [period.year];
  const users = await loadUsers(tx, scope, ids, years);
  const from = period.from;
  const to = period.cut;
  const tFacts: Map<string, TicketFacts> = period.future ? new Map() : await ticketFacts(tx, scope, ids, from, to);
  await snapshotPoint("quality:after-tickets");
  const pFacts: Map<string, PapFacts> = period.future ? new Map() : await papFacts(tx, scope, ids, from, to);
  const profileSel = cfg.dedication.profiles.filter((k) => (PROFILE_KEYS as readonly string[]).includes(k));
  const hourRows: HourRow[] = period.future ? [] : await hourFacts(tx, scope, ids, from, to, selectorsOf(pulse.payload));
  await snapshotPoint("quality:after-hours");
  const healthMap = await loadHealthForMonth(tx, scope, ids, period.year, period.month);

  // --- Cobertura compartida (declaraciones de lotes completados)
  const coverage: Record<CoverageSource, Coverage> = {
    tickets: cov(declarations, "tickets", from, to), zd_time: cov(declarations, "zd_time", from, to), wrike_time: cov(declarations, "wrike_time", from, to), pap: cov(declarations, "pap", from, to),
  };
  const needsWrike = to >= PMO_CUTOFF && (profileSel.length === 0 || profileSel.includes("PMO_N3"));
  const bugSource = (await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM "WorkItemObservation" o JOIN "UploadBatch" b ON b.id = o."batchId" AND b.status = 'COMPLETED'`))[0].n > 0n;
  const unresolvedLinks = Number((await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM "WorkItemLink" WHERE "drvState" IN ('PENDING_TICKET', 'NO_CLIENT') AND COALESCE("manualState", '') <> 'REJECTED'`))[0].n);

  // --- Backlog: fotografía compatible para el corte (nunca una posterior; nunca el estado actual)
  const policy = cfg.snapshotPolicy;
  const choice = chooseSnapshot(to, ticketBatches.map((b) => ({ batchId: b.batchId, observedOn: b.observedOn, extractionKnown: b.extractionKnown, population: b.population, statusScope: b.statusScope })), policy);
  const usedBatch = choice.kind === "EXACT" || choice.kind === "EARLIER" ? choice : null;
  const observedOn = usedBatch?.observedOn ?? null;
  const thresholds = cfg.incidents.concerningDays;
  const stock = usedBatch && observedOn ? await loadStock(tx, scope, ids, usedBatch.batchId, thresholds, observedOn, cfg.incidents.ageBands) : new Map<string, StockEntity>();
  await snapshotPoint("quality:after-stock");
  const dYM = observedOn ? parseYmd(observedOn) : null;
  const usersD = dYM ? await loadUsers(tx, scope, ids, [dYM.y]) : null;
  const unknownFreshness = ticketBatches.filter((b) => !b.extractionKnown).length;
  const backlog: BacklogInfo = {
    choice, observedOn, usersMonth: dYM ? { year: dYM.y, month: dYM.m } : null, exact: choice.kind === "EXACT", provisional: choice.kind === "EARLIER", unknownFreshnessBatches: unknownFreshness, note: choice.note,
    earlierInfo: choice.kind === "NONE" ? choice.earlier && { observedOn: choice.earlier.observedOn, gapDays: choice.earlier.gapDays } : null,
  };

  // --- Magnitudes por entidad (primera pasada: sin referencias)
  const hoursBy = new Map<string, HourRow[]>();
  for (const r of hourRows) (hoursBy.get(r.entity) ?? hoursBy.set(r.entity, []).get(r.entity)!).push(r);
  const selConfigured = profileSel.length > 0 && cfg.dedication.selectionConfirmed;

  type Raw = { input: Omit<EntityInput, "scope" | "health">; explain: Record<IndicatorKey, Explain>; users: Users };
  const rawOf = new Map<string, Raw>();
  const gapNote = (c: Coverage) => `${c.reason}`;
  const withCoverage = (value: Dec | null, c: Coverage[], extraPartial: string | null, reasonBase: string | null): ComponentInput => {
    if (value === null) return { value: null, reason: reasonBase };
    const gaps = c.filter((x) => x.state !== "COMPLETE");
    if (gaps.length > 0) {
      // Sin cobertura declarada: un cero no es evidencia (no hay valor) y un valor distinto de cero es una cota inferior (parcial).
      if (value.isZero()) return { value: null, reason: `Cero no sustentado: ${gaps.map(gapNote).join(" ")}` };
      return { value, partial: true, reason: gaps.map(gapNote).join(" ") };
    }
    if (extraPartial) return { value, partial: true, reason: extraPartial };
    return { value, reason: null };
  };

  for (const e of all) {
    const u = usersOf(users, e.id, period);
    const t = tFacts.get(e.id);
    const p = pFacts.get(e.id);
    const hr = hoursBy.get(e.id) ?? [];
    const ex = (formula: string, numerator: string | null, denominator: string | null, unit: string, sources: string[], notes: string[], breakdown: Record<string, string>, covs: Coverage[]): Explain => ({
      formula, numerator, denominator, unit, period: `${from} – ${to}`, sources, notes, breakdown, coverage: covs.map((c) => ({ source: c.source, state: c.state, reason: c.reason })),
    });
    const per100 = (n: number) => (n === 0 && u.userMonths === null ? null : flowRate(n, u.userMonths));
    const usersNote = u.reason ? [u.reason] : [];

    // Dedicación
    const eligible = hr.filter((r) => r.bucketClass === "ELIGIBLE");
    const pendingMin = hr.filter((r) => r.bucketClass === "PENDING").reduce((s, r) => s.add(r.minutes), ZERO);
    const svcFilter = q.base.service;
    const inScope = (r: HourRow) => svcFilter === "TOTAL" || r.svc === svcFilter;
    const unknownSvcMin = svcFilter === "TOTAL" ? ZERO : eligible.filter((r) => r.svc === "SIN_CLASIFICAR" || r.svc === "CONFLICTO").reduce((s, r) => s.add(r.minutes), ZERO);
    const selected = eligible.filter((r) => inScope(r) && profileSel.includes(r.profile));
    const selMin = selected.reduce((s, r) => s.add(r.minutes), ZERO);
    const byProfile: Record<string, string> = {};
    for (const r of eligible.filter(inScope)) byProfile[r.profile === "PMO_N3" ? `PMO N3 · rol ${r.role}` : r.profile] = (Dec.parse(byProfile[r.profile === "PMO_N3" ? `PMO N3 · rol ${r.role}` : r.profile] ?? "0") as Dec).add(r.minutes.divInt(60)).toString();
    const bySvc: Record<string, string> = {};
    for (const r of eligible) bySvc[`servicio ${r.svc}`] = (Dec.parse(bySvc[`servicio ${r.svc}`] ?? "0") as Dec).add(r.minutes.divInt(60)).toString();
    const hours = selMin.divInt(60);
    const dedNotes: string[] = [...usersNote];
    if (pendingMin.sign() > 0) dedNotes.push(`${pendingMin.divInt(60).toString()} h con elegibilidad PMO pendiente: podrían entrar en el perímetro.`);
    if (unknownSvcMin.sign() > 0) dedNotes.push(`${unknownSvcMin.divInt(60).toString()} h sin servicio o en conflicto: el perímetro del servicio seleccionado podría cambiar.`);
    const dedCovs = [coverage.zd_time, ...(needsWrike ? [coverage.wrike_time] : [])];
    let ded: ComponentInput;
    if (!selConfigured) ded = { value: null, reason: "Selección de perfiles sin configurar (Administración › Configuración › Calidad): se muestran las magnitudes por servicio y perfil." };
    else {
      const rate = hoursPerUserMonth(hours, u.userMonths);
      ded = rate === null ? { value: null, reason: u.reason ?? "Sin denominador." } : withCoverage(rate, dedCovs, dedNotes.find((n) => n.includes("h con") || n.includes("h sin")) ?? null, null);
    }
    // PAP
    const papCovs = [coverage.pap];
    const papNote = p && p.noDate > 0 ? [`${p.noDate} PAP sin fecha de producción: no se pueden ubicar en el periodo.`] : [];
    const papRate = p ? per100(p.corrective) : per100(0);
    const pap: ComponentInput = withCoverage(papRate, papCovs, p && (p.noDate > 0 || p.unknownState > 0) ? `${p?.noDate ?? 0} PAP sin fecha y ${p?.unknownState ?? 0} sin causa: clasificación/ubicación pendiente.` : null, u.reason);
    // N3
    const n3: ComponentInput = withCoverage(per100(t?.n3 ?? 0), [coverage.tickets], null, u.reason);
    // Bugs y afectación del estándar (afectación CONOCIDA)
    const bugCovs = [coverage.tickets];
    const bugExtra = !bugSource ? "Sin fuente de bugs (Work Items): la parte «por vínculo» no se puede acreditar; la afectación conocida es parcial." : unresolvedLinks > 0 ? `${unresolvedLinks} vínculos Work Item–ticket sin resolver (ticket no cargado o sin cliente): la afectación conocida puede ser mayor.` : null;
    const bugs: ComponentInput = withCoverage(per100(t?.union ?? 0), bugCovs, bugExtra, u.reason);
    // Incidentes y problemas: flujo + backlog por tipo
    const flow: ComponentInput = withCoverage(per100((t?.inc ?? 0) + (t?.prob ?? 0)), [coverage.tickets], null, u.reason);
    const st = stock.get(e.id);
    const uD = usersD && dYM ? usersD(e.id, dYM.y, dYM.m) : null;
    const backlogComp = (type: "incident" | "problem"): ComponentInput => {
      const th = type === "incident" ? thresholds.incident : thresholds.problem;
      if (!usedBatch) return { value: null, reason: choice.note };
      if (th === null) return { value: null, reason: `Sin umbral preocupante de ${type === "incident" ? "incidentes" : "problemas"} (Administración): no se determina qué es envejecido.` };
      const s = st?.[type] ?? emptyStock();
      if (s.invalidDates > 0) return { value: null, reason: `${s.invalidDates} tickets con creación posterior a la observación: error de fecha, no edad cero.` };
      if ((st?.unknownStatus ?? 0) > 0) return { value: null, reason: `${st?.unknownStatus} tickets con estado desconocido: la cobertura del stock queda limitada.` };
      const r = backlogStockRate(s.aged, uD);
      if (r === null) return { value: null, reason: uD === 0 ? "Usuarios al corte observado = 0: sin denominador del stock." : `Usuarios del mes de la observación (${observedOn}) sin informar.` };
      return choice.kind === "EARLIER" ? { value: r, partial: true, reason: choice.note } : { value: r, reason: null };
    };
    const incidents = { flow, backlogIncident: backlogComp("incident"), backlogProblem: backlogComp("problem") };
    const mkNum = (n: number) => String(n);
    const explain = {} as Record<IndicatorKey, Explain>;
    explain.HEALTH = ex("Categoría mensual propia del ámbito (positivo / mixto / negativo / sin feedback).", null, null, "categoría", ["Client Health (matriz mensual)"], [], {}, []);
    explain.DEDICATION = ex("Σ horas elegibles de los perfiles elegidos (servicio " + svcFilter + ") ÷ usuarios·mes", selConfigured ? hours.toString() : null, u.userMonths?.toString() ?? null, UNIT_LABEL.HOURS_PER_USER_MONTH, ["Tiempos Zendesk / Wrike (TimeActivity)"], dedNotes, { ...byProfile, ...bySvc, "selección": selConfigured ? profileSel.join(", ") : "sin configurar" }, dedCovs);
    explain.PAP_CORRECTIVE = ex("PAP únicos por lista+ID con alguna causa correctiva y producción en el periodo × 100 ÷ usuarios·mes", p ? mkNum(p.corrective) : "0", u.userMonths?.toString() ?? null, UNIT_LABEL.PER_100_USER_MONTHS, ["PAP"], [...usersNote, ...papNote], { estándar: mkNum(p?.standard ?? 0), "proyecto (config./personalización/procesos/infra.)": mkNum(p?.project ?? 0), "origen cliente": mkNum(p?.clientOrigin ?? 0), "total PAP del periodo": mkNum(p?.total ?? 0), "sin fecha": mkNum(p?.noDate ?? 0), "sin causa": mkNum(p?.unknownState ?? 0), "nota": "Las pertenencias pueden solaparse; el total correctivo no las suma." }, papCovs);
    explain.N3_ESCALATIONS = ex("Tickets únicos creados en el periodo con destino PMO N3 o IT N3 (unión) × 100 ÷ usuarios·mes", mkNum(t?.n3 ?? 0), u.userMonths?.toString() ?? null, UNIT_LABEL.PER_100_USER_MONTHS, ["Tickets Zendesk (tags exactos)"], usersNote, { "PMO N3": mkNum(t?.n3pmo ?? 0), "IT N3": mkNum(t?.n3it ?? 0), nota: "Dos tags N3 cuentan uno; la fecha es la de creación del ticket." }, [coverage.tickets]);
    explain.INCIDENTS_PROBLEMS = ex("Flujo: tickets incident/problem creados en el periodo × 100 ÷ usuarios·mes. Stock: envejecidos (edad > umbral) × 100 ÷ usuarios al corte observado, por tipo.", mkNum((t?.inc ?? 0) + (t?.prob ?? 0)), u.userMonths?.toString() ?? null, `${UNIT_LABEL.PER_100_USER_MONTHS} (flujo) / ${UNIT_LABEL[BACKLOG_UNIT]} (stock)`, ["Tickets Zendesk", "Fotografías de tickets"], [...usersNote, backlog.note], { incidentes: mkNum(t?.inc ?? 0), problemas: mkNum(t?.prob ?? 0), "stock incidentes activos": mkNum(st?.incident.count ?? 0), "stock incidentes envejecidos": mkNum(st?.incident.aged ?? 0), "stock problemas activos": mkNum(st?.problem.count ?? 0), "stock problemas envejecidos": mkNum(st?.problem.aged ?? 0), "usuarios al corte observado": uD === null ? "sin informar" : String(uD), nota: "Flujo y stock se presentan separados; no se suman como tickets adicionales." }, [coverage.tickets]);
    explain.BUGS_STANDARD = ex("COUNT DISTINCT(problemas externos con causa estándar ∪ con vínculo válido a Bug_) × 100 ÷ usuarios·mes", mkNum(t?.union ?? 0), u.userMonths?.toString() ?? null, UNIT_LABEL.PER_100_USER_MONTHS, ["Tickets Zendesk", "Work Items (vínculos)"], [...usersNote, ...(bugExtra ? [bugExtra] : []), "Mide afectación conocida: un cero sustentado es cero evidencia registrada, no ausencia probada de defectos."], { "por causa (S)": mkNum(t?.s ?? 0), "por vínculo (B)": mkNum(t?.b ?? 0), ambas: mkNum(t?.both ?? 0), "total único": mkNum(t?.union ?? 0), "incidentes vinculados (adicional, no numerador)": mkNum(t?.incLinked ?? 0) }, bugCovs);
    rawOf.set(e.id, { input: { dedication: ded, pap, n3, bugs, incidents }, explain, users: u });
  }

  // --- Referencias: valores de la MISMA métrica y ámbito sobre la referencia elegida (no copia columnas de Pulse); ceros válidos, no calculables excluidos.
  const pulseRefs = pulse.payload.references;
  const refMember = (r: PulseReference): Set<string> => {
    const members = new Set<string>();
    const ok = new Set(groups.filter((g) => referenceMembership(r, toCriteria(g)).member).map((g) => g.id));
    for (const e of all) if (r.kind === "ALL" || (e.groupId !== null && ok.has(e.groupId))) members.add(e.id);
    return members;
  };
  const refCache = new Map<string, Set<string>>();
  const sampleFor = (referenceId: string | null, pickValue: (id: string) => ComponentInput): readonly Dec[] | null => {
    if (!referenceId) return null;
    const r = pulseRefs.find((x) => x.id === referenceId);
    if (!r) return [];
    let m = refCache.get(referenceId);
    if (!m) refCache.set(referenceId, (m = refMember(r)));
    const out: Dec[] = [];
    for (const id of m) {
      const c = pickValue(id);
      if (c.value !== null && !c.partial) out.push(c.value);
    }
    return out;
  };
  const sc = QSC[scope];
  const refFor = (ruleOf: (c: QualityConfig) => { referenceId: string | null; method: string }, pick: (r: Raw) => ComponentInput) => {
    const rule = ruleOf(cfg);
    if (rule.method !== "PERCENTILE") return null;
    return sampleFor(rule.referenceId, (id) => pick(rawOf.get(id) as Raw));
  };
  const sDed = refFor((c) => c.indicators.DEDICATION.rules[sc], (r) => r.input.dedication);
  const sPap = refFor((c) => c.indicators.PAP_CORRECTIVE.rules[sc], (r) => r.input.pap);
  const sN3 = refFor((c) => c.indicators.N3_ESCALATIONS.rules[sc], (r) => r.input.n3);
  const sBug = refFor((c) => c.indicators.BUGS_STANDARD.rules[sc], (r) => r.input.bugs);
  const sFlow = refFor((c) => c.indicators.INCIDENTS_PROBLEMS.rules[sc], (r) => r.input.incidents.flow);
  const sBi = refFor((c) => c.incidents.backlog.INCIDENT[sc], (r) => r.input.incidents.backlogIncident);
  const sBp = refFor((c) => c.incidents.backlog.PROBLEM[sc], (r) => r.input.incidents.backlogProblem);
  const withRef = (c: ComponentInput, s: readonly Dec[] | null): ComponentInput => (s === null ? c : { ...c, refs: s });

  // --- Evaluación con el evaluador común
  const evaluateAll = (config: QualityConfig): Map<string, QualityRow> => {
    const rows = new Map<string, QualityRow>();
    for (const e of all) {
      const r = rawOf.get(e.id) as Raw;
      const h = healthMap.get(e.id) ?? null;
      const hState = h ? healthStateOf(h.state) : null;
      const use = h && h.state !== "NONE" ? healthUse({ year: period.year, month: period.month, feedbackOn: h.feedbackOn, recordedOn: h.recordedAt.slice(0, 10) }, period.cut) : null;
      // Feedback con fecha concreta posterior al corte: no se usa antes de ella.
      const effective = use?.notYetAtCut ? null : hState;
      const ev = evaluateEntity(config, {
        scope: sc, health: effective, dedication: withRef(r.input.dedication, sDed), pap: withRef(r.input.pap, sPap), n3: withRef(r.input.n3, sN3), bugs: withRef(r.input.bugs, sBug),
        incidents: { flow: withRef(r.input.incidents.flow, sFlow), backlogIncident: withRef(r.input.incidents.backlogIncident, sBi), backlogProblem: withRef(r.input.incidents.backlogProblem, sBp) },
      });
      const uncal = INDICATOR_KEYS.some((k) => ["SIN_CALIBRAR", "SIN_REFERENCIA", "REGLA_INVALIDA", "SIN_REGLA"].includes(ev.indicators[k].status) || (ev.indicators[k].components ?? []).some((c) => c.status === "SIN_CALIBRAR" || c.status === "SIN_REGLA"));
      const pending = INDICATOR_KEYS.some((k) => ["SIN_DATO", "PARCIAL"].includes(ev.indicators[k].status) || ev.indicators[k].availability === "MISSING" && ["SIN_DATO", "PARCIAL", "INCOMPLETO"].includes(ev.indicators[k].status));
      rows.set(e.id, {
        id: e.id, name: e.name, parent: e.parent, scope, users: { stock: r.users.stock, userMonths: r.users.userMonths?.toString() ?? null }, evaluation: ev, explain: r.explain,
        health: { state: h?.state ?? null, comment: h?.comment ?? null, feedbackOn: h?.feedbackOn ?? null, recordedAt: h?.recordedAt ?? null, version: h?.version ?? 0, use },
        flags: { uncalibrated: uncal, dataPending: pending, hasGlobal: ev.global.color !== null },
        coveragePercent: ev.weights?.coveragePercent ?? "0",
      });
    }
    return rows;
  };
  const rowsMap = evaluateAll(cfg);
  const cardsOf = (m: Map<string, QualityRow>): PortfolioCards => {
    const c: PortfolioCards = { green: 0, yellow: 0, red: 0, noGlobal: 0, total: visible.length, uncalibrated: 0, dataPending: 0 };
    for (const e of visible) {
      const r = m.get(e.id) as QualityRow;
      const col = r.evaluation.global.color;
      if (col) c[col]++; else c.noGlobal++;
      if (r.flags.uncalibrated) c.uncalibrated++;
      if (r.flags.dataPending) c.dataPending++;
    }
    return c;
  };
  const cards = cardsOf(rowsMap);
  const activeCards = opts.configOverride && !opts.skipActiveCompare ? cardsOf(evaluateAll(active.payload)) : null;

  // --- Filtro de color (presentación: no recalcula referencias), orden estable y página
  const matches = (r: QualityRow): boolean => {
    switch (q.color) {
      case "": return true;
      case "green": case "yellow": case "red": return r.evaluation.global.color === q.color;
      case "sin_global": return r.evaluation.global.color === null;
      case "sin_calibrar": return r.flags.uncalibrated;
      case "datos_pendientes": return r.flags.dataPending;
    }
  };
  const filtered = visible.filter((e) => matches(rowsMap.get(e.id) as QualityRow));
  const sign = q.base.dir === "asc" ? 1 : -1;
  const rank = { green: 0, yellow: 1, red: 2 } as const;
  const keyOf = (r: QualityRow): number | null => {
    if (q.sort === "global") return r.evaluation.global.score === null ? null : Number(r.evaluation.global.score);
    if ((INDICATOR_KEYS as readonly string[]).includes(q.sort)) {
      const i = r.evaluation.indicators[q.sort as IndicatorKey];
      return i.color ? rank[i.color] : null;
    }
    return null;
  };
  const sorted = [...filtered].sort((a, b) => {
    const byName = a.name.localeCompare(b.name, "es") || (a.id < b.id ? -1 : 1);
    if (q.sort === "name") return sign * byName;
    const ka = keyOf(rowsMap.get(a.id) as QualityRow);
    const kb = keyOf(rowsMap.get(b.id) as QualityRow);
    if (ka === null || kb === null) return ka === null && kb === null ? byName : ka === null ? 1 : -1;
    return sign * (ka - kb) || byName;
  });
  const pageCount = Math.max(1, Math.ceil(sorted.length / q.base.pageSize));
  const page = Math.min(q.base.page, pageCount);
  const slice = opts.allRows ? sorted : sorted.slice((page - 1) * q.base.pageSize, page * q.base.pageSize);
  const selected = q.sel && !slice.some((e) => e.id === q.sel) ? all.filter((e) => e.id === q.sel) : [];
  const rows = [...slice, ...selected].map((e) => rowsMap.get(e.id) as QualityRow);

  const notes = [...baseNotes];
  for (const s of Object.values(coverage)) if (s.state !== "COMPLETE") notes.push(s.reason);
  if (!selConfigured) notes.push("Selección de perfiles de Dedicación sin configurar: Dedicación muestra magnitudes por servicio y perfil, sin valor por usuario.");
  if (cfg.global.enabled === false) notes.push("Global sin método ni límites elegidos: no se genera color final.");
  if (!cfg.health.confirmed) notes.push("Mapeo de Client Health sin confirmar: el feedback se muestra como categoría «sin calibrar», sin color.");
  if (backlog.unknownFreshnessBatches > 0) notes.push(`${backlog.unknownFreshnessBatches} lote(s) de tickets sin fecha de extracción declarada: frescura desconocida; no sustentan fotografía.`);
  const hs = { withFeedback: 0, blank: 0, uncalibrated: 0 };
  for (const e of visible) {
    const r = rowsMap.get(e.id) as QualityRow;
    const k = r.evaluation.indicators.HEALTH;
    if (k.availability === "BLANK") hs.blank++; else if (k.availability === "UNCALIBRATED") hs.uncalibrated++; else hs.withFeedback++;
  }
  void lastDayOfMonth; void INDICATOR_NAME; void METRIC_UNIT;
  return {
    query: q, period, config: { revisionNo: active.revisionNo, persisted: active.persisted, adapterNotes: cfg.adapter?.notes ?? [], simulated: Boolean(opts.configOverride) }, pulseRevision: pulse.revisionNo, manifest, stamp, readAt,
    totalEntities: all.length, filteredEntities: filtered.length, cards, rows, page, pageCount, coverage, backlog, notes, healthSummary: hs,
    dedicationProfiles: { selected: profileSel, confirmed: cfg.dedication.selectionConfirmed }, config_payload: cfg, activeCards,
  };
}
