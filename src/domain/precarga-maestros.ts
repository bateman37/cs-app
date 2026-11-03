import { cleanText, nameKey } from "./normalize";

/**
 * Precarga de maestros (CSAPP-HOTFIX-01 §8-9): reglas puras, sin acceso a base de datos ni a archivos.
 * Un solo libro con tres hojas (CLIENTES, PERSONAL, PERSONAL PMO) que alimenta los maestros ya existentes
 * (Grupo Cliente, Cliente, implantación, equivalencias, datos de servicio, personas, alias, tramos y catálogos).
 *
 * Principios:
 *  - Solo se confirma por identidad EXACTA (espacios y mayúsculas normalizados; no se quitan tildes ni palabras).
 *    El parecido de texto (`fold`) únicamente PROPONE una revisión; nunca une ni asigna.
 *  - Lo contradictorio, ambiguo o dudoso no se asigna: queda como revisión pendiente en la ficha del lote.
 *  - Las fórmulas no se evalúan: solo se usa el valor almacenado.
 */

export const PRECARGA_PROFILE_ID = "precarga-maestros";
/** Versión de las reglas; si cambia, un lote preparado se revalida antes de activarse. */
export const PRECARGA_RULES = "precarga-maestros-v1";

export type SheetKind = "CLIENTES" | "PERSONAL" | "PMO";
export const SHEET_LABEL: Record<SheetKind, string> = { CLIENTES: "CLIENTES", PERSONAL: "PERSONAL", PMO: "PERSONAL PMO" };

export const norm = (s: string): string => nameKey(s);
/** Valor de COMPARACIÓN APROXIMADA (sin tildes ni signos): solo para PROPONER candidatos, nunca para confirmar identidades. */
export const fold = (s: string): string =>
  cleanText(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// ---------------------------------------------------------------- Cabeceras por posición

/** Cabeceras esperadas por POSICIÓN (A, B, C...): hay encabezados repetidos y ninguno se usa como clave única. */
const HEADERS: Record<SheetKind, string[][]> = {
  CLIENTES: [
    ["organization_wrike"],
    ["grupo cliente vincle"],
    ["organization_id_zendesk"],
    ["organization_name_zendesk"],
    ["nivel_servicio_acutal", "nivel_servicio_actual"],
    ["grupo cliente vincle"],
    ["servidor"],
    ["nivel_servicio_acutal", "nivel_servicio_actual"],
    ["organization_name_pap"],
    ["grupo cliente vincle"],
    ["tipo"],
  ],
  PERSONAL: [["persona pap"], ["persona zendesk"], ["nivel"], ["equipo"], ["pmo"], ["persona wrike"], ["persona zendesk"]],
  PMO: [["persona"], ["perfil"]],
};

export type SheetMatch = { kind: SheetKind; extras: string[] } | { kind: null; message: string };

/** Identifica la hoja por su fila de cabecera (posiciones y textos), no por el nombre de la pestaña. */
export function detectSheet(headerRow: string[]): SheetMatch {
  const h = headerRow.map(norm);
  while (h.length > 0 && h[h.length - 1] === "") h.pop();
  for (const kind of ["CLIENTES", "PERSONAL", "PMO"] as SheetKind[]) {
    const expected = HEADERS[kind];
    if (h.length < expected.length) continue;
    if (expected.every((alts, i) => alts.includes(h[i]))) {
      const extras = h.slice(expected.length).filter(Boolean);
      return { kind, extras };
    }
  }
  return {
    kind: null,
    message:
      "El libro no corresponde a la precarga de maestros: cada hoja debe ser CLIENTES (11 columnas: organization_wrike, grupo, organization_id_zendesk, organization_name_zendesk, nivel de servicio, grupo, servidor, nivel de servicio, organization_name_pap, grupo, tipo), " +
      "PERSONAL (Persona PAP, Persona Zendesk, Nivel, Equipo, PMO, Persona Wrike, Persona Zendesk) o PERSONAL PMO (Persona, Perfil), con las cabeceras en ese orden.",
  };
}

// ---------------------------------------------------------------- Valores permitidos

export const SUPPORT_MAP: Record<string, string> = {
  gold: "GOLD",
  platinum: "PLATINUM",
  "silver on demand": "SILVER_ON_DEMAND",
  "silver recurrente": "SILVER_RECURRENTE",
};
export const HOSTING_MAP: Record<string, string> = { op: "OP", cloud: "CLOUD" };
export const COMPLEXITY_MAP: Record<string, string> = { basic: "BASIC", medium: "MEDIUM", enterprise: "ENTERPRISE" };

export type TermAttr = "SUPPORT" | "HOSTING" | "COMPLEXITY";
const MAPS: Record<TermAttr, Record<string, string>> = { SUPPORT: SUPPORT_MAP, HOSTING: HOSTING_MAP, COMPLEXITY: COMPLEXITY_MAP };

/** Valor canónico del catálogo fijo, o undefined si el texto no es uno de los permitidos (no se adivina). */
export function termValue(attr: TermAttr, text: string | null): string | undefined {
  if (!text) return undefined;
  return MAPS[attr][norm(text)];
}

/** Niveles, equipos y roles PMO reales de la fuente: solo estos se dan de alta en el catálogo; cualquier otro texto queda en revisión. */
export const KNOWN_LEVELS = ["N1", "N2", "N3", "N4"] as const;
export const KNOWN_TEAMS = ["CS", "CS N2", "IT", "PMO", "PLAT"] as const;
export const KNOWN_ROLES = ["ANA", "DEV"] as const;

export function knownLabel(list: readonly string[], text: string | null): string | undefined {
  if (!text) return undefined;
  const n = norm(text);
  return list.find((x) => x.toLowerCase() === n);
}

/** Correo reconocible de forma laxa (no se valida con reglas estrictas: conserva el original). */
export function looksLikeEmail(v: string): boolean {
  return /^[^\s@()]+@[^\s@()]+\.[^\s@()]+$/.test(v);
}

/** Interno/pruebas: sin ningún Grupo BC y con nombre «VINCLE…» o «Test…». Fuera de la cartera externa; no se inventa un grupo. */
export function isInternalOrg(name: string, hasGroup: boolean): boolean {
  return !hasGroup && /^(vincle|test)\b/i.test(cleanText(name));
}

/** Entradas de PERSONAL que no son empleados: marcador de blanco y usuario de prueba. Se conservan como excluidas con su motivo. */
export function nonEmployeeReason(row: { papAlias: string | null; zdName: string | null; zdName2: string | null }): { code: string; message: string } | null {
  const names = [row.zdName, row.zdName2].filter((x): x is string => !!x).map(norm);
  const pap = row.papAlias ? norm(row.papAlias) : "";
  if (names.some((n) => n === "(en blanco)") || /^\(en[ .]blanco\)/.test(pap)) {
    return { code: "PERSONAL_MARCADOR_BLANCO", message: "Marcador «(en blanco)» de la fuente: no es una persona; no se crea ningún empleado." };
  }
  if (names.some((n) => /^test[ ._-]?user\b/.test(n)) || /^test[ ._-]?user\b/.test(pap)) {
    return { code: "PERSONAL_ENTRADA_PRUEBA", message: "Entrada de prueba («test user»): no es un empleado; no se crea por defecto." };
  }
  return null;
}

// ---------------------------------------------------------------- Filas tipadas (lo que se guarda en el staging y entra en la huella)

type S = string | null;
export type ClienteTyped = {
  hoja: "CLIENTES";
  wrike: S; wrikeGrupo: S; zdId: S; zdNombre: S; zdGrupo: S; soporteE: S; servidor: S; soporteH: S; pap: S; papGrupo: S; tipo: S;
};
export type PersonalTyped = {
  hoja: "PERSONAL";
  papAlias: S; zdName: S; level: S; team: S;
  /** PMO conocido 0/1 tal y como figura (valor almacenado de la celda); null = ausente. */
  pmo: 0 | 1 | null;
  /** El valor viene de una fórmula (no se evalúa; se usa el valor almacenado). */
  pmoFormula: boolean;
  wrike: S; zdName2: S;
};
export type PmoTyped = { hoja: "PERSONAL PMO"; persona: S; perfil: S };
export type RowTyped = ClienteTyped | PersonalTyped | PmoTyped;

// ---------------------------------------------------------------- Plan (puro)

export type ValuePlan = { value: string | null; candidates: string[] };
export type GroupPlan = { key: string; name: string; positions: number[] };
export type ClientPlan = { zdId: string; name: string; groupKey: string | null; internal: boolean; support: ValuePlan; hosting: ValuePlan; positions: number[] };
export type WrikePlan = { key: string; raw: string; groupKeys: string[]; positions: number[] };
/**
 * IMPLEMENTATION: un único Cliente con el mismo Grupo (J = F). GROUP: Grupo único sin implantación (varios Clientes del Grupo, o el Grupo J no coincide con el del Cliente de
 * la fila —una fila alineada no autoriza a sustituir J por F— o el Cliente no se pudo crear). AMBIGUOUS: varios Grupos. NO_GROUP: la fila no indica Grupo.
 */
export type PapOutcome = "IMPLEMENTATION" | "GROUP" | "AMBIGUOUS" | "NO_GROUP";
export type PapPlan = {
  key: string; raw: string; groupKeys: string[]; clientIds: string[]; outcome: PapOutcome; complexity: ValuePlan; positions: number[];
};
/** Un ID de organización Zendesk que el libro asigna a nombres o Grupos distintos: no se crea el Cliente ni se elige uno; el resto de la fila (Wrike y PAP) sí se carga. */
export type ClientConflict = { zdId: string; names: string[]; groupKeys: string[]; positions: number[] };
export type PersonPlan = {
  id: string; name: string; positions: number[];
  papAliases: string[]; zendeskAliases: string[]; wrikeAliases: string[];
  level: ValuePlan; team: ValuePlan; pmo: { value: boolean | null; issue: string | null };
  notes: string[];
};
export type RolePlan = { key: string; raw: string; perfil: ValuePlan; position: number };
export type ExcludedPlan = { position: number; sheet: string | null; sourceRow: number; code: string; message: string };

export type Plan = {
  groups: GroupPlan[];
  clients: ClientPlan[];
  /** IDs Zendesk contradictorios entre filas (nombre o Grupo): sin Cliente creado; sus alias Wrike y PAP siguen su camino. */
  clientConflicts: ClientConflict[];
  wrike: WrikePlan[];
  pap: PapPlan[];
  persons: PersonPlan[];
  roles: RolePlan[];
  excluded: ExcludedPlan[];
  /** Pares de personas de la propia fuente que solo difieren en tildes, signos o mayúsculas: variantes por revisar. */
  variants: { key: string; ids: string[] }[];
  /** Filas de CLIENTES sin ID Zendesk u otras que no entraron (para los contadores del informe). */
  counts: Record<string, number>;
};

export type PlanRow = { position: number; sheet: string | null; sourceRow: number; typed: RowTyped; excluded?: { code: string; message: string } };

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function valuePlan(values: (string | undefined | null)[]): ValuePlan {
  const c = uniq(values.filter((v): v is string => !!v));
  return { value: c.length === 1 ? c[0] : null, candidates: c };
}

class UnionFind {
  private p = new Map<string, string>();
  find(x: string): string {
    if (!this.p.has(x)) this.p.set(x, x);
    let r = x;
    while (this.p.get(r) !== r) r = this.p.get(r) as string;
    this.p.set(x, r);
    return r;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.p.set(rb, ra);
  }
}

/** PMO de una fila PERSONAL: 0/1 conocido, contrastado con el Equipo y con la naturaleza simple de la fórmula `IF(D<>"PMO",0,1)`. */
export function rowPmo(r: Pick<PersonalTyped, "pmo" | "pmoFormula" | "team">): { value: boolean | null; issue: string | null } {
  if (r.pmo === null) return { value: null, issue: null };
  const team = r.team ? norm(r.team) : "";
  if (r.pmoFormula && team === "") {
    return { value: null, issue: "PMO_FORMULA_SIN_EQUIPO" };
  }
  if (team !== "" && (r.pmo === 1) !== (team === "pmo")) return { value: null, issue: "PMO_INCONSISTENTE_CON_EQUIPO" };
  return { value: r.pmo === 1, issue: null };
}

/**
 * Plan de la precarga a partir de las filas VÁLIDAS (sin duplicados exactos) del lote. Determinista y sin depender del orden de las hojas
 * ni de las filas: dos archivos con las mismas filas reordenadas producen el mismo plan (salvo el texto original elegido para nombrar).
 */
export function buildPlan(rows: PlanRow[]): Plan {
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  const groups = new Map<string, GroupPlan>();
  const addGroup = (name: string | null, position: number): string | null => {
    if (!name) return null;
    const key = norm(name);
    const g = groups.get(key);
    if (g) g.positions.push(position);
    else groups.set(key, { key, name: cleanText(name), positions: [position] });
    return key;
  };

  type ClientAcc = { zdId: string; name: string; groupKey: string | null; positions: number[]; support: (string | undefined)[]; hosting: (string | undefined)[]; hasAnyGroupCol: boolean; variants: Set<string>; names: Set<string>; groupKeys: Set<string> };
  const clients = new Map<string, ClientAcc>();
  type WAcc = { key: string; raw: string; groupKeys: Set<string>; noGroup: boolean; positions: number[] };
  const wrike = new Map<string, WAcc>();
  type PAcc = { key: string; raw: string; groupKeys: Set<string>; clientIds: Set<string>; k: (string | undefined)[]; positions: number[]; noGroup: boolean };
  const pap = new Map<string, PAcc>();
  const counts: Record<string, number> = { filasClientes: 0, filasPersonal: 0, filasPmo: 0 };

  const personRows: { row: PlanRow; t: PersonalTyped }[] = [];
  const roleRows: { row: PlanRow; t: PmoTyped }[] = [];
  const excluded: ExcludedPlan[] = [];

  for (const row of sorted) {
    if (row.excluded) {
      excluded.push({ position: row.position, sheet: row.sheet, sourceRow: row.sourceRow, ...row.excluded });
      continue;
    }
    const t = row.typed;
    if (t.hoja === "CLIENTES") {
      counts.filasClientes++;
      if (!t.zdId || !t.zdNombre) continue;
      const gKey = addGroup(t.zdGrupo, row.position);
      const wGroup = addGroup(t.wrikeGrupo, row.position);
      const pGroup = addGroup(t.papGrupo, row.position);
      const c = clients.get(t.zdId);
      if (c) {
        c.variants.add(`${norm(t.zdNombre)}|${gKey ?? ""}`);
        c.names.add(cleanText(t.zdNombre));
        if (gKey) c.groupKeys.add(gKey);
        if (!c.groupKey && gKey) c.hasAnyGroupCol = true;
        c.positions.push(row.position);
        c.support.push(termValue("SUPPORT", t.soporteE), termValue("SUPPORT", t.soporteH));
        c.hosting.push(termValue("HOSTING", t.servidor));
      } else {
        clients.set(t.zdId, {
          zdId: t.zdId, name: t.zdNombre, groupKey: gKey, positions: [row.position], hasAnyGroupCol: !!(gKey || wGroup || pGroup),
          variants: new Set([`${norm(t.zdNombre)}|${gKey ?? ""}`]), names: new Set([cleanText(t.zdNombre)]), groupKeys: new Set(gKey ? [gKey] : []),
          support: [termValue("SUPPORT", t.soporteE), termValue("SUPPORT", t.soporteH)],
          hosting: [termValue("HOSTING", t.servidor)],
        });
      }
      if (t.wrike) {
        const key = norm(t.wrike);
        const w = wrike.get(key) ?? { key, raw: cleanText(t.wrike), groupKeys: new Set<string>(), noGroup: false, positions: [] };
        if (wGroup) w.groupKeys.add(wGroup);
        else w.noGroup = true;
        w.positions.push(row.position);
        wrike.set(key, w);
      }
      if (t.pap) {
        const key = norm(t.pap);
        const p = pap.get(key) ?? { key, raw: cleanText(t.pap), groupKeys: new Set<string>(), clientIds: new Set<string>(), k: [], positions: [], noGroup: false };
        if (pGroup) p.groupKeys.add(pGroup);
        else p.noGroup = true;
        p.clientIds.add(t.zdId);
        p.k.push(termValue("COMPLEXITY", t.tipo));
        p.positions.push(row.position);
        pap.set(key, p);
      }
    } else if (t.hoja === "PERSONAL") {
      counts.filasPersonal++;
      personRows.push({ row, t });
    } else {
      counts.filasPmo++;
      roleRows.push({ row, t });
    }
  }

  // Clientes: el Cliente es la organización Zendesk; su Grupo es la columna F (Grupo del bloque Zendesk).
  const clientConflicts: ClientConflict[] = [...clients.values()]
    .filter((c) => c.variants.size > 1)
    .map((c) => ({ zdId: c.zdId, names: [...c.names].sort(), groupKeys: [...c.groupKeys].sort(), positions: c.positions }));
  const clientPlans: ClientPlan[] = [...clients.values()].filter((c) => c.variants.size === 1).map((c) => ({
    zdId: c.zdId,
    name: c.name,
    groupKey: c.groupKey,
    internal: isInternalOrg(c.name, c.hasAnyGroupCol),
    support: valuePlan(c.support),
    hosting: valuePlan(c.hosting),
    positions: c.positions,
  }));
  const clientGroup = new Map(clientPlans.map((c) => [c.zdId, c.groupKey]));

  const wrikePlans: WrikePlan[] = [...wrike.values()].map((w) => ({ key: w.key, raw: w.raw, groupKeys: [...w.groupKeys].sort(), positions: w.positions }));
  const papPlans: PapPlan[] = [...pap.values()].map((p) => {
    const groupKeys = [...p.groupKeys].sort();
    const clientIds = [...p.clientIds].sort();
    let outcome: PapOutcome;
    if (groupKeys.length === 0) outcome = "NO_GROUP";
    else if (groupKeys.length > 1) outcome = "AMBIGUOUS";
    else if (clientIds.length > 1) outcome = "GROUP";
    else outcome = clientGroup.get(clientIds[0]) === groupKeys[0] ? "IMPLEMENTATION" : "GROUP";
    return { key: p.key, raw: p.raw, groupKeys, clientIds, outcome, complexity: valuePlan(p.k), positions: p.positions };
  });

  // Personas: se unifican filas que comparten un alias EXACTO (misma identidad); nunca por parecido.
  const uf = new UnionFind();
  const keysOf = (t: PersonalTyped): string[] => [
    ...(t.papAlias ? [`pap:${norm(t.papAlias)}`] : []),
    ...[t.zdName, t.zdName2].filter((x): x is string => !!x).map((x) => `zd:${norm(x)}`),
    ...(t.wrike ? [`wk:${norm(t.wrike)}`] : []),
  ];
  for (const { t } of personRows) {
    const ks = keysOf(t);
    if (ks.length === 0) continue;
    uf.find(ks[0]);
    for (const k of ks.slice(1)) uf.union(ks[0], k);
  }
  const comps = new Map<string, { row: PlanRow; t: PersonalTyped }[]>();
  for (const pr of personRows) {
    const ks = keysOf(pr.t);
    if (ks.length === 0) continue;
    const root = uf.find(ks[0]);
    comps.set(root, [...(comps.get(root) ?? []), pr]);
  }
  const persons: PersonPlan[] = [...comps.values()].map((rs) => {
    const first = rs[0];
    const name = first.t.zdName ?? first.t.zdName2 ?? first.t.wrike ?? first.t.papAlias ?? "";
    const notes: string[] = [];
    // Solo etiquetas reconocidas se asignan; una etiqueta desconocida se avisa en la fila y no se da de alta en el catálogo.
    const levels = uniq(rs.map((r) => knownLabel(KNOWN_LEVELS, r.t.level)).filter((x): x is string => !!x));
    const teams = uniq(rs.map((r) => knownLabel(KNOWN_TEAMS, r.t.team)).filter((x): x is string => !!x));
    const pm = rs.map((r) => rowPmo(r.t));
    const pmoVals = uniq(pm.map((x) => x.value).filter((v): v is boolean => v !== null));
    const pmoIssue = pmoVals.length > 1 ? "PMO_CONTRADICTORIO" : (pm.find((x) => x.issue)?.issue ?? null);
    const zd = uniq(rs.flatMap((r) => [r.t.zdName, r.t.zdName2]).filter((x): x is string => !!x).map(cleanText));
    if (uniq(zd.map(norm)).length > 1) notes.push("ZENDESK_DISTINTOS");
    return {
      id: `p${first.row.position}`,
      name: cleanText(name),
      positions: rs.map((r) => r.row.position),
      papAliases: uniq(rs.map((r) => r.t.papAlias).filter((x): x is string => !!x).map(cleanText)),
      zendeskAliases: zd,
      wrikeAliases: uniq(rs.map((r) => r.t.wrike).filter((x): x is string => !!x).map(cleanText)),
      level: { value: levels.length === 1 ? levels[0] : null, candidates: levels },
      team: { value: teams.length === 1 ? teams[0] : null, candidates: teams },
      pmo: { value: pmoVals.length === 1 ? pmoVals[0] : null, issue: pmoIssue },
      notes,
    };
  });

  // Variantes: personas distintas cuyo nombre solo se diferencia por tildes/signos/mayúsculas.
  const byFold = new Map<string, string[]>();
  for (const p of persons) {
    const k = fold(p.name);
    if (k) byFold.set(k, [...(byFold.get(k) ?? []), p.id]);
  }
  const variants = [...byFold.entries()].filter(([, ids]) => ids.length > 1).map(([key, ids]) => ({ key, ids }));

  const roles: RolePlan[] = roleRows
    .filter(({ t }) => t.persona)
    .map(({ row, t }) => ({
      key: norm(t.persona as string),
      raw: cleanText(t.persona as string),
      perfil: { value: knownLabel(KNOWN_ROLES, t.perfil) ?? null, candidates: t.perfil ? [cleanText(t.perfil)] : [] },
      position: row.position,
    }));
  // Un mismo Persona repetido en PERSONAL PMO con el mismo perfil se consolida (no se cuenta dos veces).
  const rolesByKey = new Map<string, RolePlan>();
  for (const r of roles) if (!rolesByKey.has(r.key)) rolesByKey.set(r.key, r);

  counts.grupos = groups.size;
  counts.clientes = clientPlans.length;
  counts.aliasWrike = wrikePlans.length;
  counts.aliasPap = papPlans.length;
  counts.personas = persons.length;
  counts.roles = rolesByKey.size;
  return {
    groups: [...groups.values()],
    clients: clientPlans,
    clientConflicts,
    wrike: wrikePlans,
    pap: papPlans,
    persons,
    roles: [...rolesByKey.values()],
    excluded,
    variants,
    counts,
  };
}

// ---------------------------------------------------------------- Texto de las revisiones

export type ReviewKind =
  | "SUPPORT"
  | "HOSTING"
  | "WRIKE_ALIAS"
  | "PAP_ALIAS"
  | "PERSON_VARIANT"
  | "PMO_ROLE"
  | "INFO";

export const REVIEW_LABEL: Record<ReviewKind, string> = {
  SUPPORT: "Soporte con valores distintos",
  HOSTING: "Servidor con valores distintos",
  WRIKE_ALIAS: "Alias Wrike que apunta a varios Grupos",
  PAP_ALIAS: "Nombre PAP que apunta a varios Grupos",
  PERSON_VARIANT: "Posibles variantes de una misma persona",
  PMO_ROLE: "Rol PMO sin persona enlazable",
  INFO: "Otros datos a revisar",
};

export const SUPPORT_LABEL: Record<string, string> = { GOLD: "Gold", PLATINUM: "Platinum", SILVER_ON_DEMAND: "Silver On Demand", SILVER_RECURRENTE: "Silver Recurrente" };
