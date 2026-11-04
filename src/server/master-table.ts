import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { groupEffectiveActive, matchesEstado, clientEffectiveActive, type Estado } from "@/domain/estado";
import { todayMadrid } from "@/domain/vigencia";
import { recordAudit } from "@/server/audit";
import { authorize } from "@/server/authorize";
import { DomainError } from "@/server/errors";
import { adminTransaction } from "@/server/tx";

/**
 * Tabla de trabajo de Clientes y Grupos (HOTFIX-03 §4): una PROYECCIÓN de las relaciones canónicas (Grupo, Cliente, equivalencias y datos de servicio), no una fuente
 * nueva ni un producto cartesiano. Una fila es un Grupo (sin Clientes, o como cabecera) o un Cliente de ese Grupo; la identidad de fila es el ID de la entidad, nunca su posición.
 * Cada sistema distingue Configurado · Sin informar · No aplica · En conflicto. Una sola lectura por conjuntos (sin consultas por fila).
 */
export const LINK_SYSTEMS = ["WRIKE", "ZENDESK", "PAP", "SUPPORT", "HOSTING"] as const;
export type LinkSystem = (typeof LINK_SYSTEMS)[number];
export const LINK_LABEL: Record<LinkSystem, string> = { WRIKE: "Wrike", ZENDESK: "Zendesk", PAP: "PAP", SUPPORT: "Soporte", HOSTING: "Servidor" };
export type LinkState = "CONFIGURED" | "MISSING" | "NOT_APPLICABLE" | "CONFLICT";
export const LINK_STATE_LABEL: Record<LinkState, string> = { CONFIGURED: "Configurado", MISSING: "Sin informar", NOT_APPLICABLE: "No aplica", CONFLICT: "En conflicto" };

export type MasterRow = {
  kind: "group" | "client";
  id: string;
  groupId: string;
  groupName: string;
  bcDenomination: string | null;
  name: string;
  isActive: boolean;
  effectiveActive: boolean;
  version: number;
  clients: number;
  wrike: string[];
  zendeskIds: string[];
  zendeskNames: string[];
  pap: string[];
  support: string[];
  hosting: string[];
  complexity: string[];
  /** Estado de cada sistema para ESTA fila (el Wrike y PAP de un Cliente se heredan del Grupo si el Cliente no los tiene propios). */
  state: Record<LinkSystem, LinkState>;
  inherited: Partial<Record<LinkSystem, boolean>>;
  /** Cuántos sistemas relevantes siguen pendientes (Sin informar o En conflicto). */
  pending: number;
};
export type MasterTableQuery = { q?: string; estado?: Estado; onlyPending?: boolean };
export type MasterTable = {
  rows: MasterRow[];
  totals: { groups: number; clients: number; pendingRows: number; conflicts: number };
  /** Hechos ya cargados que NO se pudieron atribuir a ningún Grupo: priorizan qué enlace falta (no se reparten entre Grupos). */
  unattributed: { financeRows: number; hoursWithoutGroup: string };
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export async function loadMasterTable(actorId: string, query: MasterTableQuery = {}): Promise<MasterTable> {
  await authorize(prisma, actorId, "READ");
  const today = todayMadrid();
  const [groups, clients, identities, terms, decisions, fin, hours] = await Promise.all([
    prisma.clientGroup.findMany({ select: { id: true, name: true, bcDenomination: true, isActive: true, version: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
    prisma.client.findMany({ where: { isInternal: false }, select: { id: true, name: true, groupId: true, isActive: true, version: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
    prisma.externalIdentity.findMany({ where: { isActive: true, system: { in: ["WRIKE", "ZENDESK", "PAP"] } }, select: { system: true, kind: true, rawValue: true, searchValue: true, groupId: true, clientId: true, implementationId: true } }),
    prisma.$queryRaw<{ attribute: string; value: string; groupId: string | null; clientId: string | null }[]>(Prisma.sql`
      SELECT attribute::text AS attribute, value, "groupId", "clientId" FROM "ServiceTerm"
      WHERE attribute::text IN ('SUPPORT', 'HOSTING', 'COMPLEXITY') AND "implementationId" IS NULL AND ("validFrom" IS NULL OR "validFrom" <= ${today}::date) AND ("validTo" IS NULL OR ${today}::date < "validTo")`),
    prisma.masterLinkDecision.findMany({ select: { groupId: true, clientId: true, system: true } }),
    prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM "FinanceScope" s JOIN "FinanceRow" r ON r."batchId" = s."activeBatchId" WHERE r."groupId" IS NULL`),
    prisma.$queryRaw<{ m: string | null }[]>(Prisma.sql`SELECT (COALESCE(sum(minutes), 0) / 60)::numeric(14,2)::text AS m FROM "TimeActivity" WHERE "isEligible" AND "groupId" IS NULL AND bucket NOT IN ('INTERNAL')`).catch(() => [{ m: null }]),
  ]);
  const clientsByGroup = new Map<string, typeof clients>();
  for (const c of clients) if (c.groupId) (clientsByGroup.get(c.groupId) ?? clientsByGroup.set(c.groupId, []).get(c.groupId)!).push(c);
  const groupOfClient = new Map(clients.map((c) => [c.id, c.groupId]));

  // Conflicto: la MISMA equivalencia (sistema, tipo, valor normalizado) activa en más de un Grupo.
  const owners = new Map<string, Set<string>>();
  for (const i of identities) {
    const g = i.groupId ?? (i.clientId ? groupOfClient.get(i.clientId) : null) ?? null;
    if (!g) continue;
    const k = `${i.system}|${i.kind}|${i.searchValue}`;
    (owners.get(k) ?? owners.set(k, new Set()).get(k)!).add(g);
  }
  const conflictKeys = new Set([...owners].filter(([, s]) => s.size > 1).map(([k]) => k));
  const idsOf = (pred: (i: (typeof identities)[number]) => boolean) => identities.filter(pred);
  const na = new Set(decisions.map((d) => `${d.groupId ? `g:${d.groupId}` : `c:${d.clientId}`}|${d.system}`));
  const termVals = (attr: string, col: "groupId" | "clientId", id: string) => [...new Set(terms.filter((t) => t.attribute === attr && t[col] === id).map((t) => t.value))];

  const rows: MasterRow[] = [];
  for (const g of groups) {
    const kids = clientsByGroup.get(g.id) ?? [];
    const effective = groupEffectiveActive(g, kids);
    const gIds = idsOf((i) => i.groupId === g.id);
    const wrikeG = gIds.filter((i) => i.system === "WRIKE");
    const papG = gIds.filter((i) => i.system === "PAP");
    const base = (kind: "group" | "client", id: string, name: string, active: boolean, eff: boolean, version: number, own: ReturnType<typeof idsOf>, col: "groupId" | "clientId"): MasterRow => {
      const wrike = [...wrikeG, ...own.filter((i) => i.system === "WRIKE")];
      const pap = [...papG, ...own.filter((i) => i.system === "PAP")];
      const zd = own.filter((i) => i.system === "ZENDESK");
      const key = kind === "group" ? `g:${id}` : `c:${id}`;
      const st = (sys: LinkSystem, have: boolean, conflicted: boolean): LinkState => (conflicted ? "CONFLICT" : have ? "CONFIGURED" : na.has(`${key}|${sys}`) || (kind === "client" && na.has(`g:${g.id}|${sys}`) && (sys === "WRIKE" || sys === "PAP")) ? "NOT_APPLICABLE" : "MISSING");
      const conf = (list: ReturnType<typeof idsOf>) => list.some((i) => conflictKeys.has(`${i.system}|${i.kind}|${i.searchValue}`));
      const support = termVals("SUPPORT", col, id);
      const hosting = termVals("HOSTING", col, id);
      const state: Record<LinkSystem, LinkState> = {
        WRIKE: st("WRIKE", wrike.length > 0, conf(wrike)),
        ZENDESK: kind === "group" && kids.length > 0 ? "CONFIGURED" : st("ZENDESK", zd.length > 0, conf(zd)),
        PAP: st("PAP", pap.length > 0, conf(pap)),
        SUPPORT: st("SUPPORT", support.length > 0, support.length > 1),
        HOSTING: st("HOSTING", hosting.length > 0, hosting.length > 1),
      };
      // Un Grupo con Clientes no exige Zendesk/Soporte/Servidor a nivel Grupo (se completan en sus Clientes): solo cuentan los pendientes que le corresponden.
      const relevant: LinkSystem[] = kind === "group" ? (kids.length > 0 ? ["WRIKE", "PAP"] : ["WRIKE", "ZENDESK", "PAP", "SUPPORT", "HOSTING"]) : ["WRIKE", "ZENDESK", "PAP", "SUPPORT", "HOSTING"];
      return {
        kind, id, groupId: g.id, groupName: g.name, bcDenomination: g.bcDenomination, name, isActive: active, effectiveActive: eff, version, clients: kids.length,
        wrike: [...new Set(wrike.map((i) => i.rawValue))], zendeskIds: zd.filter((i) => i.kind === "ORG_ID").map((i) => i.rawValue), zendeskNames: zd.filter((i) => i.kind === "ORG_NAME").map((i) => i.rawValue),
        pap: [...new Set(pap.map((i) => i.rawValue))], support, hosting, complexity: termVals("COMPLEXITY", col, id), state,
        inherited: kind === "client" ? { WRIKE: own.every((i) => i.system !== "WRIKE") && wrikeG.length > 0, PAP: own.every((i) => i.system !== "PAP") && papG.length > 0 } : {},
        pending: relevant.filter((s) => state[s] === "MISSING" || state[s] === "CONFLICT").length,
      };
    };
    rows.push(base("group", g.id, g.name, g.isActive, effective, g.version, gIds, "groupId"));
    for (const c of kids) rows.push(base("client", c.id, c.name, c.isActive, clientEffectiveActive(c, g), c.version, idsOf((i) => i.clientId === c.id), "clientId"));
  }

  const needle = norm(query.q ?? "");
  const estado = query.estado ?? "activos";
  // Un Grupo se muestra con sus Clientes si el Grupo o alguno de sus Clientes coincide con el estado, la búsqueda y el filtro de pendientes.
  const byGroup = new Map<string, MasterRow[]>();
  for (const r of rows) (byGroup.get(r.groupId) ?? byGroup.set(r.groupId, []).get(r.groupId)!).push(r);
  const out: MasterRow[] = [];
  for (const list of byGroup.values()) {
    const head = list[0];
    const matchText = (r: MasterRow) => needle === "" || [r.name, r.groupName, r.bcDenomination ?? "", ...r.wrike, ...r.zendeskIds, ...r.zendeskNames, ...r.pap].some((x) => norm(x).includes(needle));
    // Un Grupo figura en «Activos» si su estado EFECTIVO es activo (aunque algún hijo esté inactivo: se muestra con su estado); en «Inactivos», si todo él lo está.
    if (!matchesEstado(head.effectiveActive, estado)) continue;
    if (!list.some(matchText)) continue;
    if (query.onlyPending && !list.some((r) => r.pending > 0)) continue;
    out.push(...list);
  }
  return {
    rows: out,
    totals: { groups: out.filter((r) => r.kind === "group").length, clients: out.filter((r) => r.kind === "client").length, pendingRows: out.filter((r) => r.pending > 0).length, conflicts: out.filter((r) => Object.values(r.state).includes("CONFLICT")).length },
    unattributed: { financeRows: Number(fin[0]?.n ?? 0), hoursWithoutGroup: hours[0]?.m ?? "0" },
  };
}

/** Decisión explícita «No aplica» (o su retirada) de un sistema para un Grupo o Cliente. Solo Administrador; auditada. */
export async function setLinkDecision(actorId: string, raw: { entity: string; id: string; system: string; notApplicable: boolean }): Promise<void> {
  await authorize(prisma, actorId, "ADMIN");
  if (!(LINK_SYSTEMS as readonly string[]).includes(raw.system)) throw new DomainError("Sistema no reconocido.");
  if (raw.entity !== "group" && raw.entity !== "client") throw new DomainError("Entidad no reconocida.");
  const where = raw.entity === "group" ? { groupId: raw.id } : { clientId: raw.id };
  await adminTransaction(actorId, async (tx, actor) => {
    const target = raw.entity === "group" ? await tx.clientGroup.findUnique({ where: { id: raw.id }, select: { id: true, name: true } }) : await tx.client.findUnique({ where: { id: raw.id }, select: { id: true, name: true, groupId: true } });
    if (!target) throw new DomainError("No existe la entidad indicada.");
    const existing = await tx.masterLinkDecision.findFirst({ where: { ...where, system: raw.system } });
    if (raw.notApplicable) {
      if (existing) return;
      await tx.masterLinkDecision.create({ data: { ...where, system: raw.system, decidedById: actor.id } });
    } else {
      if (!existing) return;
      await tx.masterLinkDecision.delete({ where: { id: existing.id } });
    }
    await recordAudit(tx, actor, {
      action: "UPDATE", entityType: "MasterLinkDecision", entityId: raw.id, groupId: raw.entity === "group" ? raw.id : (("groupId" in target ? target.groupId : null) as string | null), clientId: raw.entity === "client" ? raw.id : null,
      summary: `${raw.notApplicable ? "Marcado «No aplica»" : "Retirado «No aplica»"}: ${LINK_LABEL[raw.system as LinkSystem]} en «${target.name}»`,
      before: { notApplicable: Boolean(existing) }, after: { notApplicable: raw.notApplicable },
    });
  });
}
