import type { PulseConfig, ProfileKey } from "@/domain/pulse-catalog";
import type { Tx } from "@/server/analytics/snapshot";
import { selectorsOf, type Selector } from "@/server/pulse/sql";

/**
 * Selectores de perfil de dedicación de Calidad (HOTFIX-03 §12). Calidad NO exige configurar Pulse Rent: si Pulse ya tiene selectores configurados por el
 * Administrador se respetan; si no, se derivan del catálogo de Personal por NOMBRE (equipo/nivel de la fuente): CS N1 = equipo «CS» + nivel «N1»,
 * CS N2 = equipo «CS N2», mantenimiento PMO N3 = pertenencia PMO, IT N3 = equipo «IT», Plataforma N4 = equipo «PLAT». IT y Plataforma son desglose/contexto:
 * no entran en el KPI salvo que el Administrador los elija. No se modifica ninguna configuración de Pulse.
 */
const DEFAULTS: { key: ProfileKey; team: string | null; level: string | null; pmo: boolean | null }[] = [
  { key: "CS_N1", team: "CS", level: "N1", pmo: null },
  { key: "CS_N2", team: "CS N2", level: null, pmo: null },
  { key: "PMO_N3", team: null, level: null, pmo: true },
  { key: "IT_N3", team: "IT", level: null, pmo: null },
  { key: "PLATAFORMA_N4", team: "PLAT", level: null, pmo: null },
];

export async function qualitySelectors(tx: Tx, pulse: PulseConfig): Promise<Selector[]> {
  const configured = selectorsOf(pulse);
  if (configured.length > 0) return configured;
  const items = await tx.staffCatalogItem.findMany({ where: { kind: { in: ["TEAM", "LEVEL"] } }, select: { id: true, kind: true, name: true } });
  const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");
  const find = (kind: "TEAM" | "LEVEL", name: string | null): string | null | undefined => {
    if (name === null) return null;
    return items.find((i) => i.kind === kind && norm(i.name) === norm(name))?.id;
  };
  const out: Selector[] = [];
  for (const d of DEFAULTS) {
    const team = find("TEAM", d.team);
    const level = find("LEVEL", d.level);
    // Un equipo o nivel ausente del catálogo no se inventa: el selector no se crea (no captura a todo el personal).
    if (team === undefined || level === undefined) continue;
    out.push({ idx: out.length, key: d.key, team, level, pmo: d.pmo });
  }
  return out;
}
