import { Prisma } from "@/generated/prisma/client";
import { hasCommonFilters, type CommonFilters } from "@/domain/filtros-comunes";
import type { Tx } from "@/server/analytics/snapshot";

/**
 * Selección de Calidad por los segmentadores comunes Soporte y Servidor (HOTFIX-02 §6): OR dentro de cada filtro y AND entre ambos, y el AND se evalúa
 * en el MISMO Cliente (el soporte de un hijo no se mezcla con el servidor de otro). Los valores de un Cliente son los propios (del Cliente o de sus
 * implantaciones) y, si no tiene ninguno del atributo, los del Grupo vigentes a la fecha de corte. Un Grupo entra si alguno de sus Clientes cumple
 * ambos filtros; un Grupo sin Clientes se evalúa con sus propios valores. Un valor desconocido no cumple un filtro activo.
 * El filtro es de PRESENTACIÓN: las referencias por percentiles siguen calculándose con la cohorte completa.
 */
export type ServiceFacts = {
  /** Valores propios de cada Cliente (y sus implantaciones) a la fecha de corte. */
  client: { support: Map<string, Set<string>>; hosting: Map<string, Set<string>> };
  /** Valores propios de cada Grupo a la fecha de corte. */
  group: { support: Map<string, Set<string>>; hosting: Map<string, Set<string>> };
  /** Clientes externos de cada Grupo. */
  clientsOfGroup: Map<string, string[]>;
};

type TermRow = { attr: string; value: string; gid: string | null; cid: string | null; cgid: string | null };

export async function loadServiceFacts(tx: Tx, cut: string): Promise<ServiceFacts> {
  const terms = await tx.$queryRaw<TermRow[]>(Prisma.sql`
    SELECT t.attribute::text AS attr, t.value, t."groupId" AS gid, COALESCE(t."clientId", i."clientId") AS cid, c."groupId" AS cgid
    FROM "ServiceTerm" t
    LEFT JOIN "Implementation" i ON i.id = t."implementationId"
    LEFT JOIN "Client" c ON c.id = COALESCE(t."clientId", i."clientId")
    WHERE t.attribute::text IN ('SUPPORT', 'HOSTING') AND (t."validFrom" IS NULL OR t."validFrom" <= ${cut}::date) AND (t."validTo" IS NULL OR ${cut}::date < t."validTo")`);
  const clients = await tx.client.findMany({ where: { isInternal: false }, select: { id: true, groupId: true } });
  const facts: ServiceFacts = { client: { support: new Map(), hosting: new Map() }, group: { support: new Map(), hosting: new Map() }, clientsOfGroup: new Map() };
  const add = (m: Map<string, Set<string>>, k: string, v: string) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(v);
  for (const t of terms) {
    const key = t.attr === "SUPPORT" ? "support" : "hosting";
    if (t.gid) add(facts.group[key], t.gid, t.value);
    else if (t.cid) add(facts.client[key], t.cid, t.value);
  }
  for (const c of clients) if (c.groupId) (facts.clientsOfGroup.get(c.groupId) ?? facts.clientsOfGroup.set(c.groupId, []).get(c.groupId)!).push(c.id);
  return facts;
}

const hit = (have: Set<string> | undefined, wanted: readonly string[]) => wanted.length === 0 || (have !== undefined && wanted.some((w) => have.has(w)));

/** ¿El Cliente cumple los dos filtros a la vez? Sus valores propios o, a falta, los de su Grupo. */
export function clientMatches(f: CommonFilters, s: ServiceFacts, clientId: string, groupId: string | null): boolean {
  const pick = (own: Map<string, Set<string>>, grp: Map<string, Set<string>>) => own.get(clientId) ?? (groupId ? grp.get(groupId) : undefined);
  return hit(pick(s.client.support, s.group.support), f.soporte) && hit(pick(s.client.hosting, s.group.hosting), f.servidor);
}

/** ¿El Grupo entra? Alguno de sus Clientes cumple ambos filtros en el mismo Cliente; sin Clientes, sus propios valores. */
export function groupMatches(f: CommonFilters, s: ServiceFacts, groupId: string): boolean {
  const kids = s.clientsOfGroup.get(groupId) ?? [];
  if (kids.length === 0) return hit(s.group.support.get(groupId), f.soporte) && hit(s.group.hosting.get(groupId), f.servidor);
  return kids.some((c) => clientMatches(f, s, c, groupId));
}

/** Entidades (de `all`, en su ámbito) que cumplen los segmentadores. Sin filtros activos: todas. */
export function selectByFilters<T extends { id: string; groupId: string | null }>(all: T[], scope: "group" | "client", f: CommonFilters, s: ServiceFacts | null): T[] {
  if (!hasCommonFilters(f) || s === null) return all;
  return all.filter((e) => (scope === "group" ? groupMatches(f, s, e.id) : clientMatches(f, s, e.id, e.groupId)));
}
