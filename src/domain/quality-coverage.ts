/**
 * Contrato de cobertura y fotografías de Calidad (CSAPP-08 §6), sin dependencias de servidor y compartido con Pulse y la ficha.
 *
 * Una fuente PRESENTE no demuestra cobertura de todos los clientes: `EXISTS(filas fechadas en el periodo)` (CSAPP-07) no distingue un periodo
 * completo sin altas de una fuente ausente. La cobertura se sustenta en una DECLARACIÓN tipada del Administrador por lote completado y no
 * revertido: población (todos los clientes), alcance temporal y, para tickets, qué estados contiene. Sin declaración = desconocida.
 */
export const COVERAGE_SOURCES = ["tickets", "zd_time", "wrike_time", "pap"] as const;
export type CoverageSource = (typeof COVERAGE_SOURCES)[number];
export const COVERAGE_SOURCE_LABEL: Record<CoverageSource, string> = { tickets: "tickets Zendesk", zd_time: "tiempos Zendesk", wrike_time: "tiempos Wrike", pap: "PAP" };
/** Perfil de carga que alimenta cada fuente. */
export const SOURCE_PROFILE: Record<CoverageSource, string> = { tickets: "zendesk-tickets", zd_time: "zendesk-tiempo", wrike_time: "wrike", pap: "pap" };

/**
 * Contrato de carga amplia (HOTFIX-01 §4-§5 y HOTFIX-02 §10). Desde HOTFIX-01 el formulario de carga no pide declaraciones: cada fuente se lee como un export
 * completo por contrato (tiempos: instantánea completa por fuente; tickets: último estado por `ticket_id` con todos los estados; PAP: ID único). La procedencia
 * «export amplio» la aporta ESTE contrato de fuente, nunca la existencia de filas ni el nombre del archivo. Un lote completado y no heredado sin declaración
 * explícita hereda esta cobertura (población: todos los clientes; inicio: el origen de la fuente, NO el mínimo de las fechas observadas; fin: la extracción
 * declarada o, si falta, la recepción como observación operativa). Una declaración explícita del Administrador siempre prevalece (limitaciones incluidas).
 */
export const BROAD_EXPORT_CONTRACT_VERSION = "carga-amplia-v1";
export const BROAD_EXPORT_CONTRACT: Record<CoverageSource, { population: "ALL_CLIENTS"; statusScope: "ALL_STATUSES" | "NOT_APPLICABLE" }> = {
  tickets: { population: "ALL_CLIENTS", statusScope: "ALL_STATUSES" },
  zd_time: { population: "ALL_CLIENTS", statusScope: "NOT_APPLICABLE" },
  wrike_time: { population: "ALL_CLIENTS", statusScope: "NOT_APPLICABLE" },
  pap: { population: "ALL_CLIENTS", statusScope: "NOT_APPLICABLE" },
};
/** Inicio «abierto» de la cobertura por contrato: la fuente completa desde su origen (no se infiere de ninguna fecha observada). */
export const CONTRACT_COVERAGE_FROM = "1900-01-01";

export type Population = "ALL_CLIENTS" | "PARTIAL" | "UNKNOWN";
export type StatusScope = "ALL_STATUSES" | "UNRESOLVED_ONLY" | "NOT_APPLICABLE" | "UNKNOWN";
export const POPULATION_LABEL: Record<Population, string> = { ALL_CLIENTS: "Todos los clientes", PARTIAL: "Selección parcial de clientes", UNKNOWN: "Desconocida" };
export const STATUS_SCOPE_LABEL: Record<StatusScope, string> = {
  ALL_STATUSES: "Todos los estados",
  UNRESOLVED_ONLY: "Solo sin resolver (new/open/pending/hold)",
  NOT_APPLICABLE: "No aplica",
  UNKNOWN: "Desconocido",
};

/** Declaración VIGENTE (la de mayor versión) de un lote completado y no revertido. */
export type Declaration = {
  batchId: string;
  version: number;
  population: Population;
  statusScope: StatusScope;
  coveredFrom: string | null;
  coveredTo: string | null;
  /** Fecha de extracción revisada por el Administrador; la original del lote y las observaciones no cambian. */
  extractedOn: string | null;
  source: CoverageSource;
  /** DECLARED (Administrador, versionada) o SOURCE_CONTRACT (contrato de carga amplia, sin declaración manual). */
  provenance?: "DECLARED" | "SOURCE_CONTRACT";
};

export type Interval = { from: string; to: string };

/** Une intervalos de fechas inclusivos (ISO) y los fusiona si se solapan o son contiguos (el día siguiente). */
export function unionIntervals(list: readonly Interval[]): Interval[] {
  const sorted = [...list].filter((i) => i.from <= i.to).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const out: Interval[] = [];
  const next = (iso: string): string => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.from <= next(last.to)) last.to = i.to > last.to ? i.to : last.to;
    else out.push({ ...i });
  }
  return out;
}

export type CoverageKind = "FLOW" | "STOCK";
export type Coverage = {
  source: CoverageSource;
  /** COMPLETE: el periodo está dentro de lo declarado completo (un cero está sustentado) · PARTIAL: hay declaración que no lo cubre · UNKNOWN: sin declaración. */
  state: "COMPLETE" | "PARTIAL" | "UNKNOWN";
  covered: Interval[];
  reason: string;
  /** De qué procede lo que sustenta el estado: declaración del Administrador, contrato de carga amplia o nada. */
  provenance?: "DECLARED" | "SOURCE_CONTRACT" | "NONE";
};

/**
 * ¿El periodo [from, to] está cubierto para esta fuente y tipo de dato? Solo cuentan declaraciones de TODOS los clientes:
 *  - FLOW (altas/eventos por fecha): tickets exige «todos los estados» (un export de solo sin resolver no prueba que no hubo altas ya resueltas);
 *  - tiempos y PAP no distinguen estado.
 * Una declaración parcial, desconocida o de otro alcance no sustenta un cero.
 */
export function coverageOf(source: CoverageSource, decls: readonly Declaration[], from: string, to: string, kind: CoverageKind = "FLOW"): Coverage {
  const mine = decls.filter((d) => d.source === source);
  const usable = mine.filter((d) => d.population === "ALL_CLIENTS" && d.coveredTo !== null && (d.coveredFrom !== null || d.provenance === "SOURCE_CONTRACT") && (source !== "tickets" || kind === "STOCK" || d.statusScope === "ALL_STATUSES"));
  const covered = unionIntervals(usable.map((d) => ({ from: d.coveredFrom ?? CONTRACT_COVERAGE_FROM, to: d.coveredTo as string })));
  const supporting = usable.filter((d) => (d.coveredFrom ?? CONTRACT_COVERAGE_FROM) <= from && to <= (d.coveredTo as string));
  if (supporting.length > 0) {
    const byContract = supporting.every((d) => d.provenance === "SOURCE_CONTRACT");
    return {
      source, state: "COMPLETE", covered, provenance: byContract ? "SOURCE_CONTRACT" : "DECLARED",
      reason: byContract ? `Periodo dentro del contrato de carga amplia de ${COVERAGE_SOURCE_LABEL[source]} (todos los clientes; hasta la extracción o recepción del lote).` : "Periodo dentro de la cobertura declarada completa (todos los clientes).",
    };
  }
  if (mine.length === 0) return { source, state: "UNKNOWN", covered, provenance: "NONE", reason: `Sin carga completada de ${COVERAGE_SOURCE_LABEL[source]} con cobertura conocida: una fuente presente no prueba cobertura; un cero no está sustentado.` };
  return {
    source,
    state: "PARTIAL",
    covered,
    provenance: "DECLARED",
    reason: usable.length === 0 ? `Las declaraciones de ${COVERAGE_SOURCE_LABEL[source]} no cubren a todos los clientes${source === "tickets" && kind === "FLOW" ? " con todos los estados" : ""} o carecen de alcance temporal.` : `El periodo ${from} – ${to} no está dentro de la cobertura declarada de ${COVERAGE_SOURCE_LABEL[source]}.`,
  };
}

// ---------------------------------------------------------------- Fotografías de backlog

/** Observación de fotografía compatible: un lote de tickets declarado completo (población y estados) con fecha de extracción conocida. */
export type SnapshotBatch = { batchId: string; observedOn: string; extractionKnown: boolean; population: Population; statusScope: StatusScope };

export type SnapshotChoice =
  | { kind: "EXACT"; batchId: string; observedOn: string; requested: string; note: string }
  | { kind: "EARLIER"; batchId: string; observedOn: string; requested: string; gapDays: number; note: string }
  | { kind: "NONE"; requested: string; note: string; earlier: { batchId: string; observedOn: string; gapDays: number } | null };

export type SnapshotPolicy = { mode: "EXACT" | "LATEST_BEFORE"; maxDays: number | null };

const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** ¿Un lote sustenta un stock? Todos los clientes y estados «todos» o «solo sin resolver» (ambos contienen todos los sin resolver) con extracción conocida. */
/**
 * ¿Un lote sustenta un stock? Todos los clientes (declarado o por contrato de carga amplia) y estados «todos» o «solo sin resolver». La fecha de recepción
 * sirve como observación operativa cuando falta la extracción (HOTFIX-02 §10): `extractionKnown` solo distingue la frescura, ya no descarta el lote.
 * Una fotografía nunca se usa para un corte ANTERIOR a su observación (chooseSnapshot).
 */
export const supportsStock = (b: SnapshotBatch): boolean => b.population === "ALL_CLIENTS" && (b.statusScope === "ALL_STATUSES" || b.statusScope === "UNRESOLVED_ONLY");

/**
 * Elige la fotografía para un corte R. Nunca usa una posterior a R. Con la política exacta (inicial): solo una del propio día; si solo existe una anterior,
 * se devuelve como EARLIER pero solo si el Administrador eligió «última anterior dentro de X días» y está dentro del máximo — en la política exacta se
 * devuelve NONE (con el aviso de que existe una anterior). Una unión de tickets de fotografías distintas nunca se convierte en una fotografía completa.
 */
export function chooseSnapshot(requested: string, batches: readonly SnapshotBatch[], policy: SnapshotPolicy): SnapshotChoice {
  const ok = batches.filter((b) => supportsStock(b) && b.observedOn <= requested).sort((a, b) => (a.observedOn < b.observedOn ? 1 : a.observedOn > b.observedOn ? -1 : a.batchId < b.batchId ? -1 : 1));
  const exact = ok.find((b) => b.observedOn === requested);
  if (exact) return { kind: "EXACT", batchId: exact.batchId, observedOn: exact.observedOn, requested, note: "Fotografía completa (declarada o por contrato de carga amplia) del propio día del corte; si la extracción no consta, la fecha es la de recepción como observación operativa." };
  const prev = ok[0];
  if (!prev) return { kind: "NONE", requested, earlier: null, note: "No hay fotografía compatible (completa, declarada o por contrato de carga amplia) a esa fecha ni anterior: el stock no está disponible; no se rellena con el estado actual." };
  const gap = daysBetween(prev.observedOn, requested);
  if (policy.mode === "LATEST_BEFORE" && policy.maxDays !== null && gap <= policy.maxDays) {
    return { kind: "EARLIER", batchId: prev.batchId, observedOn: prev.observedOn, requested, gapDays: gap, note: `Stock observado el ${prev.observedOn} (${gap} días antes del corte), con la política elegida «última anterior dentro de ${policy.maxDays} días»; provisional y no es el valor del ${requested}.` };
  }
  return { kind: "NONE", requested, earlier: { batchId: prev.batchId, observedOn: prev.observedOn, gapDays: gap }, note: `No hay fotografía compatible del ${requested}. Existe una anterior (${prev.observedOn}, ${gap} días antes) que se muestra aparte como «observado en ${prev.observedOn}»; el stock exacto del corte no está disponible.` };
}
