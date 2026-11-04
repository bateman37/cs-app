import { prisma } from "@/lib/db";
import { defaultPulseConfig } from "@/domain/pulse-catalog";
import { uncalibratedQualityConfig as defaultQualityConfig, emptyRule, type QualityConfig } from "@/domain/quality-config";
import { STANDARD_CAUSE } from "@/domain/zendesk";
import { activateDraft, saveDraft } from "@/server/pulse/config";
import { addClient, addGroup, addZd, setUsers } from "./economia-helpers";
import { batchOf, declare, seedBugLink, seedPap, seedTicket } from "./calidad-helpers";

/**
 * Fixture DETERMINISTA para comparar la evolución mensual de Calidad (CSAPP-10 §5) entre la implementación por conjuntos y la de referencia
 * (`computeQuality` por mes). Semilla fija: dos ejecuciones producen exactamente los mismos datos. Año 2026, «hoy» = 02/11/2026.
 *
 * Qué contiene (cada punto lo ejercita una entidad o un mes concreto):
 *  - 8 Grupos (G1 tiene dos clientes) con usuarios propios; G2 sin usuarios en mar-abr (nulos), G3 con cero confirmado en junio, G5 sin informar en julio.
 *  - Tickets (≈ 400) de enero a octubre con tipos, causas estándar, destinos N3 y estados; cobertura de tickets declarada SOLO desde febrero (enero sin cobertura).
 *  - Cinco fotografías: 31/03 (solo sin resolver), 31/05, 15/06 (a mitad de mes), 30/09 y 31/10 (esta, con todos los estados). Sin fotografía en ene-feb, abr, jul-ago.
 *  - Horas elegibles y pendientes (perfil CS_N1), PAP con y sin fecha/causa, vínculos a bugs y Client Health (incluido un feedback fechado después del corte).
 *  - Referencias Pulse por criterios (Gold OP) con atributos vigentes por fecha: la cohorte de «gold_op» cambia de un mes a otro.
 */
export const FIXTURE_TODAY = "2026-11-02";
export const FIXTURE_NOW = new Date("2026-11-02T09:00:00Z");

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const d = (v: string) => new Date(`${v}T00:00:00Z`);
const pad = (n: number) => String(n).padStart(2, "0");

export type EvolutionWorld = {
  groups: { id: string; name: string }[];
  clients: { id: string; name: string; groupId: string }[];
  published: QualityConfig;
  draft: QualityConfig;
  earlier: QualityConfig;
  smallCohort: QualityConfig;
};

export function pctRule(a: string, b: string, referenceId: string, minSample: number, unit: Parameters<typeof emptyRule>[1] = "PER_100_USER_MONTHS") {
  return { ...emptyRule("LOWER_BETTER", unit), method: "PERCENTILE" as const, a, b, referenceId, minSample, calibration: "CALIBRADO" as const };
}
export function absRule(a: string, b: string, unit: Parameters<typeof emptyRule>[1]) {
  return { ...emptyRule("LOWER_BETTER", unit), a, b, calibration: "CALIBRADO" as const };
}

/** Configuración calibrada con percentiles (referencias «todos» y «gold_op»), umbrales absolutos, Health confirmado y global ponderado. */
export function calibratedConfig(over: { minSample?: number } = {}): QualityConfig {
  const q = defaultQualityConfig();
  const min = over.minSample ?? 3;
  q.health.confirmed = true;
  q.dedication = { profiles: ["CS_N1"], selectionConfirmed: true };
  for (const sc of ["GRUPO", "CLIENTE"] as const) {
    q.indicators.DEDICATION.rules[sc] = absRule("2", "6", "HOURS_PER_USER_MONTH");
    q.indicators.PAP_CORRECTIVE.rules[sc] = pctRule("40", "80", "todos", min);
    q.indicators.N3_ESCALATIONS.rules[sc] = pctRule("25", "75", "gold_op", min);
    q.indicators.BUGS_STANDARD.rules[sc] = absRule("2", "8", "PER_100_USER_MONTHS");
    q.indicators.INCIDENTS_PROBLEMS.rules[sc] = pctRule("30", "70", "todos", min);
    q.incidents.backlog.INCIDENT[sc] = pctRule("30", "70", "todos", min, "PER_100_USERS_STOCK");
    q.incidents.backlog.PROBLEM[sc] = absRule("5", "20", "PER_100_USERS_STOCK");
  }
  q.incidents = { ...q.incidents, concerningDays: { incident: 30, problem: 60 }, worstOfFlowAndBacklog: true, ageBands: [{ from: 0, to: 30 }, { from: 31, to: 90 }, { from: 91, to: null }] };
  q.global = { template: "WEIGHTED_SEVERITY", enabled: true, severity: { green: "0", yellow: "0.5", red: "1" }, greenMax: "0.3", yellowMax: "0.6" };
  return q;
}

export async function buildEvolutionWorld(adminId: string): Promise<EvolutionWorld> {
  const rnd = mulberry32(20261102);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const groups: EvolutionWorld["groups"] = [];
  const clients: EvolutionWorld["clients"] = [];
  const usersByGroup: (number | null)[][] = [
    Array(12).fill(100), // G1
    [80, 80, null, null, 80, 80, 80, 80, 80, 80, 80, 80], // G2: nulos mar-abr
    [50, 50, 50, 50, 50, 0, 50, 50, 50, 50, 50, 50], // G3: cero confirmado en junio
    Array(12).fill(120), // G4
    [40, 40, 40, 40, 40, 40, null, 40, 40, 40, 40, 40], // G5: julio sin informar
    Array(12).fill(60), // G6
    Array(12).fill(90), // G7
    Array(12).fill(30), // G8
  ];
  for (let i = 1; i <= 8; i++) {
    const g = await addGroup(`G${i}`);
    groups.push({ id: g.id, name: g.name });
    await setUsers(adminId, { groupId: g.id }, 2026, usersByGroup[i - 1]);
    const n = i === 1 ? 2 : 1;
    for (let k = 1; k <= n; k++) {
      const c = await addClient(`C${i}${n > 1 ? String.fromCharCode(96 + k) : ""}`, g.id);
      const org = `${800 + clients.length + 1}`;
      await prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: org, searchValue: org, clientId: c.id } });
      clients.push({ id: c.id, name: c.name, groupId: g.id });
      await setUsers(adminId, { clientId: c.id }, 2026, i === 2 ? [30, 30, null, 30, 30, 30, 30, 30, 30, 30, 30, 30] : Array(12).fill(20 + 5 * i));
    }
  }
  // Atributos vigentes por fecha: Gold OP desde siempre en G1-G4, desde mayo en G5-G6 (cohorte de la referencia distinta por mes), G7 Platinum CLOUD, G8 sin atributos.
  const term = (attribute: "SUPPORT" | "HOSTING", value: string, groupId: string, validFrom?: string) =>
    prisma.serviceTerm.create({ data: { attribute, value, groupId, validFrom: validFrom ? d(validFrom) : null } });
  for (let i = 0; i < 4; i++) { await term("SUPPORT", "GOLD", groups[i].id); await term("HOSTING", "OP", groups[i].id); }
  for (let i = 4; i < 6; i++) { await term("SUPPORT", "GOLD", groups[i].id, "2026-05-01"); await term("HOSTING", "OP", groups[i].id, "2026-05-01"); }
  await term("SUPPORT", "PLATINUM", groups[6].id); await term("HOSTING", "CLOUD", groups[6].id);

  // Pulse (perfil CS_N1) y Calidad activadas: revisión de Calidad 2.
  const cs = await prisma.staffCatalogItem.create({ data: { kind: "TEAM", name: "CS" } });
  const n1 = await prisma.staffCatalogItem.create({ data: { kind: "LEVEL", name: "N1" } });
  const pd = await saveDraft(adminId, "PULSE", { ...defaultPulseConfig(), profiles: { CS_N1: [{ teamId: cs.id, levelId: n1.id, pmo: null }] } }, { expectedVersion: null });
  await activateDraft(adminId, "PULSE", { expectedRevisionNo: 1, expectedDraftVersion: pd.version, reason: "fixture" });
  const published = calibratedConfig();
  const qd = await saveDraft(adminId, "QUALITY", published, { expectedVersion: null });
  await activateDraft(adminId, "QUALITY", { expectedRevisionNo: 1, expectedDraftVersion: qd.version, reason: "fixture" });
  // Borrador SIN publicar (revisión activa intacta): umbrales y pesos distintos.
  const draft = calibratedConfig({ minSample: 2 });
  draft.weights = { mode: "CUSTOM", custom: { HEALTH: "10", DEDICATION: "20", PAP_CORRECTIVE: "15", N3_ESCALATIONS: "20", INCIDENTS_PROBLEMS: "20", BUGS_STANDARD: "15" } };
  for (const sc of ["GRUPO", "CLIENTE"] as const) draft.indicators.BUGS_STANDARD.rules[sc] = absRule("1", "3", "PER_100_USER_MONTHS");
  await saveDraft(adminId, "QUALITY", draft, { expectedVersion: null });
  const earlier = calibratedConfig();
  earlier.snapshotPolicy = { mode: "LATEST_BEFORE", maxDays: 45 };
  const smallCohort = calibratedConfig({ minSample: 50 });

  // Fotografías: cinco lotes (31/03 y 15/06 y 30/09 solo sin resolver; 31/05 y 31/10 todos los estados) y un lote de tickets completo con la cobertura de flujo.
  const flow = await batchOf(adminId, "zendesk-tickets", "2026-10-31");
  const photos: { id: string; extract: string; scope: "UNRESOLVED_ONLY" | "ALL_STATUSES" }[] = [];
  for (const [extract, scope] of [["2026-03-31", "UNRESOLVED_ONLY"], ["2026-05-31", "ALL_STATUSES"], ["2026-06-15", "UNRESOLVED_ONLY"], ["2026-09-30", "UNRESOLVED_ONLY"]] as const) {
    const b = await batchOf(adminId, "zendesk-tickets", extract);
    photos.push({ id: b.id, extract, scope });
  }
  photos.push({ id: flow.id, extract: "2026-10-31", scope: "ALL_STATUSES" });
  await declare(adminId, flow.id, { statusScope: "ALL_STATUSES", from: "2026-02-01" }); // enero SIN cobertura de flujo
  for (const p of photos.filter((x) => x.id !== flow.id)) await declare(adminId, p.id, { statusScope: p.scope, from: "2026-02-01", to: p.extract });
  // Una fotografía de cobertura parcial (no compatible: población parcial) que NO debe usarse.
  const partial = await batchOf(adminId, "zendesk-tickets", "2026-08-31");
  await declare(adminId, partial.id, { statusScope: "UNRESOLVED_ONLY", population: "PARTIAL", from: "2026-01-01", to: "2026-08-31" });

  const types = ["incident", "incident", "incident", "problem", "question", "task"] as const;
  const causes = [STANDARD_CAUSE, STANDARD_CAUSE, "incidente_uso_indebido", "incidente_infraestructura", null] as const;
  const statuses = ["open", "open", "pending", "solved", "closed", "hold", "new"] as const;
  let n = 0;
  for (const c of clients) {
    const org = (await prisma.externalIdentity.findFirstOrThrow({ where: { clientId: c.id } })).rawValue;
    const gi = groups.findIndex((g) => g.id === c.groupId);
    for (let m = 1; m <= 10; m++) {
      // G8 sin tickets (cero confirmado a partir de febrero); G6 solo en meses pares.
      if (gi === 7 || (gi === 5 && m % 2 === 1)) continue;
      const count = Math.floor(rnd() * (gi === 0 ? 7 : 4));
      for (let k = 0; k < count; k++) {
        const day = 1 + Math.floor(rnd() * 28);
        const created = `2026-${pad(m)}-${pad(day)}`;
        const destinations = rnd() < 0.2 ? ["PMO_N3"] : rnd() < 0.1 ? ["IT_N3"] : rnd() < 0.05 ? ["PMO_N3", "IT_N3"] : [];
        const target = rnd() < 0.5 ? photos[4] : pick(photos); // photos[4] es el lote de flujo (31/10, todos los estados)
        const created2 = created > target.extract ? target.extract : created;
        await seedTicket(target.id, { id: `E${n++}`, org, type: pick(types), status: pick(statuses), created: target.id === flow.id ? created : created2, cause: pick(causes), destinations, observedOn: target.extract });
      }
    }
  }
  // Vínculos a bugs con evidencia y uno rechazado.
  const problem = await seedTicket(flow.id, { id: "BUGP1", org: "801", type: "problem", created: "2026-04-10", cause: "otra", observedOn: "2026-10-31" });
  await seedBugLink(flow.id, { bugId: "9001", ticket: "BUGP1", clientId: clients[0].id, groupId: groups[0].id });
  await seedTicket(flow.id, { id: "BUGP2", org: "801", type: "problem", created: "2026-08-04", cause: "otra", observedOn: "2026-10-31" });
  await seedBugLink(flow.id, { bugId: "9002", ticket: "BUGP2", manual: "REJECTED", clientId: clients[0].id, groupId: groups[0].id });
  void problem;

  // Horas (Zendesk, perfil CS_N1; elegibles y pendientes), cobertura de tiempos declarada desde marzo.
  const zt = await batchOf(adminId, "zendesk-tiempo");
  await declare(adminId, zt.id, { from: "2026-03-01" });
  for (const c of clients) {
    for (let m = 1; m <= 10; m++) {
      const rows = Math.floor(rnd() * 3);
      for (let k = 0; k < rows; k++) {
        await addZd({ batchId: zt.id, date: `2026-${pad(m)}-${pad(1 + Math.floor(rnd() * 28))}`, minutes: 30 + Math.floor(rnd() * 400), groupId: c.groupId, clientId: c.id, teamId: cs.id, levelId: n1.id, eligibility: rnd() < 0.15 ? "PENDING_ELIGIBILITY" : "ELIGIBLE", bucket: "ATTRIBUTABLE" });
      }
    }
  }
  // PAP, cobertura desde enero; con causas, sin fecha y sin causa.
  const pb = await batchOf(adminId, "pap");
  await declare(adminId, pb.id, { from: "2026-01-01" });
  let pi = 0;
  for (const c of clients) {
    for (let m = 1; m <= 10; m++) {
      if (rnd() < 0.5) continue;
      const state = pick(["CORRECTIVE", "CORRECTIVE", "NON_CORRECTIVE", "UNKNOWN"] as const);
      await seedPap(pb.id, { id: String(7000 + pi++), groupId: c.groupId, clientId: c.id, date: rnd() < 0.08 ? null : `2026-${pad(m)}-${pad(1 + Math.floor(rnd() * 28))}`, state, causes: state === "CORRECTIVE" ? [{ category: "CORRECTIVE", origin: pick(["STANDARD", "CUSTOMIZATION", "CLIENT_ORIGIN"]) }] : [] });
    }
  }
  // Client Health: algunos meses; uno con fecha de feedback posterior al corte del mes y una celda limpiada (NONE).
  const health = (groupId: string, month: number, state: string, feedbackOn: string | null = null) =>
    prisma.healthFeedback.create({ data: { groupId, year: 2026, month, state: state as never, feedbackOn: feedbackOn ? d(feedbackOn) : null, updatedById: adminId } });
  for (let i = 0; i < 6; i++) for (let m = 1; m <= 10; m += 2) await health(groups[i].id, m, (["POSITIVE", "MIXED", "NEGATIVE"] as const)[(i + m) % 3]);
  await health(groups[6].id, 3, "POSITIVE", "2026-04-20"); // fechado después del corte de marzo: no se usa antes de su fecha
  await health(groups[7].id, 5, "NONE");
  await prisma.healthFeedback.create({ data: { clientId: clients[0].id, year: 2026, month: 6, state: "NEGATIVE", updatedById: adminId } });
  return { groups, clients, published, draft, earlier, smallCohort };
}

// ---------------------------------------------------------------- Casos comparables

export type EvolutionCase = { name: string; params: Record<string, string>; entity: "group" | "client" | "missing"; index: number; cfg: "published" | "draft" | "earlier" | "smallCohort"; today: string };
/** Casos de paridad: cada uno se evalúa con la implementación por conjuntos y con la de referencia (por mes) y deben coincidir campo a campo. */
export const EVOLUTION_CASES: EvolutionCase[] = [
  { name: "grupo con cobertura desde febrero, publicada", params: { fecha: "2026-10-31", modo: "FULL_MONTH" }, entity: "group", index: 0, cfg: "published", today: FIXTURE_TODAY },
  { name: "grupo con usuarios nulos (mar-abr)", params: { fecha: "2026-10-31", modo: "FULL_MONTH" }, entity: "group", index: 1, cfg: "published", today: FIXTURE_TODAY },
  { name: "grupo con cero confirmado de usuarios (junio)", params: { fecha: "2026-10-31", modo: "FULL_MONTH" }, entity: "group", index: 2, cfg: "published", today: FIXTURE_TODAY },
  { name: "grupo con usuarios sin informar (julio) y referencia por criterios con vigencia", params: { fecha: "2026-10-31", modo: "FULL_MONTH" }, entity: "group", index: 4, cfg: "published", today: FIXTURE_TODAY },
  { name: "grupo sin tickets (cero confirmado desde febrero)", params: { fecha: "2026-10-31", modo: "FULL_MONTH" }, entity: "group", index: 7, cfg: "published", today: FIXTURE_TODAY },
  { name: "grupo con Health fechado después del corte", params: { fecha: "2026-10-31", modo: "FULL_MONTH" }, entity: "group", index: 6, cfg: "published", today: FIXTURE_TODAY },
  { name: "entidad cliente (varios clientes en el grupo)", params: { fecha: "2026-10-31", modo: "FULL_MONTH", ambito: "client" }, entity: "client", index: 0, cfg: "published", today: FIXTURE_TODAY },
  { name: "cliente con usuarios nulos", params: { fecha: "2026-10-31", modo: "FULL_MONTH", ambito: "client" }, entity: "client", index: 2, cfg: "published", today: FIXTURE_TODAY },
  { name: "fotografía anterior dentro de 45 días (política elegida)", params: { fecha: "2026-10-31", modo: "FULL_MONTH" }, entity: "group", index: 3, cfg: "earlier", today: FIXTURE_TODAY },
  { name: "fotografía anterior, entidad cliente", params: { fecha: "2026-10-31", modo: "FULL_MONTH", ambito: "client" }, entity: "client", index: 1, cfg: "earlier", today: FIXTURE_TODAY },
  { name: "cohorte pequeña (muestra mínima 50 > cohorte)", params: { fecha: "2026-10-31", modo: "FULL_MONTH" }, entity: "group", index: 0, cfg: "smallCohort", today: FIXTURE_TODAY },
  { name: "borrador simulado (no publicado)", params: { fecha: "2026-10-31", modo: "FULL_MONTH", sim: "borrador" }, entity: "group", index: 3, cfg: "draft", today: FIXTURE_TODAY },
  { name: "borrador simulado, cliente", params: { fecha: "2026-10-31", modo: "FULL_MONTH", sim: "borrador", ambito: "client" }, entity: "client", index: 3, cfg: "draft", today: FIXTURE_TODAY },
  { name: "último mes con corte a mitad de mes", params: { fecha: "2026-10-15", modo: "CUTOFF" }, entity: "group", index: 0, cfg: "published", today: FIXTURE_TODAY },
  { name: "mes en curso (corte limitado por hoy)", params: { fecha: "2026-10-31", modo: "FULL_MONTH" }, entity: "group", index: 3, cfg: "published", today: "2026-10-20" },
  { name: "mes que acaba el mismo día (fotografía exacta a mitad de mes)", params: { fecha: "2026-06-15", modo: "CUTOFF" }, entity: "group", index: 1, cfg: "published", today: FIXTURE_TODAY },
  { name: "primer mes del año", params: { fecha: "2026-01-31", modo: "FULL_MONTH" }, entity: "group", index: 0, cfg: "published", today: FIXTURE_TODAY },
  { name: "mes futuro (sin puntos)", params: { fecha: "2026-12-31", modo: "FULL_MONTH" }, entity: "group", index: 0, cfg: "published", today: FIXTURE_TODAY },
  { name: "revisión de Calidad concreta (la inicial)", params: { fecha: "2026-10-31", modo: "FULL_MONTH", rcalidad: "1" }, entity: "group", index: 0, cfg: "published", today: FIXTURE_TODAY },
  { name: "entidad inexistente", params: { fecha: "2026-10-31", modo: "FULL_MONTH" }, entity: "missing", index: 0, cfg: "published", today: FIXTURE_TODAY },
];
export const entityIdOf = (w: EvolutionWorld, c: EvolutionCase): string => (c.entity === "missing" ? "no-existe" : c.entity === "group" ? w.groups[c.index].id : w.clients[c.index].id);
