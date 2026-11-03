/**
 * Histórico económico y usuarios (HOTFIX-01 §6-§7). Dominio puro, sin servidor: lee las columnas A..H del libro «DATA FACTURACIÓN»
 * (2022–2025), clasifica la categoría, valida cada fila y agrupa por año+categoría. Contrato: docs/importaciones/historico-economico.md.
 *
 * Reglas que fija este módulo:
 *  - B es el importe anual (decimal exacto, nunca `Number`); nunca se ejecuta una fórmula ni se sigue un enlace: se usa el valor almacenado.
 *  - Categoría: D = «Admin Delegada» o F = 1 coherentes → ADMIN_DELEGADA (no es ambiguo); D con una etiqueta de plan (Gold, Silver…) y F = 0 → SOPORTE;
 *    contradicciones (D administrativa con F = 0, F = 1 con un plan en D) o ni una cosa ni otra → error, no se inventa.
 *  - La etiqueta histórica de D («Silver», «Gold»…) se conserva tal cual y el subtipo actual (Silver On Demand / Recurrente) queda «no informado».
 *  - E es una referencia mensual (normalmente B/12), no un ingreso: no se suma. La excepción B/6 (fila 164 del libro real) se conserva y se señala.
 *  - G (Servidor) puede traer errores de búsqueda (#N/A): se conserva la ausencia/conflicto y nunca se descarta el ingreso ni se sigue el enlace.
 *  - H (Usuarios) son enteros ≥ 0, informados por fila financiera; no se suman entre categorías.
 */
import { cleanText } from "./normalize";
import { Dec, groupSearchKey, isValidFinanceYear, parseAmountCell, sumDec, type FinanceCategory } from "./finance";
import { parseUserCount, USERS_BASE_YEAR } from "./usuarios";
import { normalizeHeader } from "./zendesk";

export const HISTORIC_PROFILE_ID = "historico-economico";
export const HISTORIC_PROFILE_LABEL = "Histórico económico y usuarios";
/** Versión de las reglas de lectura del libro histórico (se guarda en el lote y en cada lote hijo). */
export const HISTORIC_RULES = "hist-v1";
/** Clave de ámbito del lote del libro (REPLACE_SCOPE): una carga posterior del libro sustituye a la anterior como registro; los datos se aplican por año+categoría. */
export const HISTORIC_SCOPE_KEY = "historico";
/** Marca de origen de los lotes hijos por año/categoría (metadatos y controles). */
export const HISTORIC_CHILD_ORIGIN = "HISTORICO_ECONOMICO";

export const HIST_COLUMNS = {
  group: "Grupo cliente",
  annual: "Facturación anual",
  year: "Año",
  support: "Soporte",
  monthly: "Facturación mes",
  admin: "Admin Delegada",
  server: "Servidor",
  users: "Usuarios",
} as const;
export type HistColumn = keyof typeof HIST_COLUMNS;
const REQUIRED: HistColumn[] = ["group", "annual", "year", "support", "admin"];

export type HistContext = { index: Partial<Record<HistColumn, number>> };

export type HistHeader = { ok: true; context: HistContext; notes: string[] } | { ok: false; message: string };

/** Cabeceras por nombre (sin tildes ni espacios sobrantes: «Año » con espacio final es la misma). Obligatorias A–D y F; E, G y H son opcionales. */
export function mapHistoricHeaders(row: string[]): HistHeader {
  const norm = row.map((h) => normalizeHeader(h));
  const index: Partial<Record<HistColumn, number>> = {};
  const missing: string[] = [];
  for (const key of Object.keys(HIST_COLUMNS) as HistColumn[]) {
    const want = normalizeHeader(HIST_COLUMNS[key]);
    const hits = norm.map((n, i) => (n === want ? i : -1)).filter((i) => i >= 0);
    if (hits.length > 1) return { ok: false, message: `Cabecera duplicada: «${HIST_COLUMNS[key]}».` };
    if (hits.length === 1) index[key] = hits[0];
    else if (REQUIRED.includes(key)) missing.push(HIST_COLUMNS[key]);
  }
  if (missing.length > 0) {
    return { ok: false, message: `El archivo no corresponde al histórico económico (hoja «DATA FACTURACIÓN»): faltan las cabeceras ${missing.map((m) => `«${m}»`).join(", ")}.` };
  }
  const known = new Set(Object.values(index));
  const extras = row.map((h, i) => ({ h: cleanText(h), i })).filter((x) => x.h !== "" && !known.has(x.i)).map((x) => x.h);
  const notes = extras.length > 0 ? [`Columnas adicionales conservadas y no utilizadas: ${extras.join(", ")}.`] : [];
  if (index.users === undefined) notes.push("El libro no tiene columna «Usuarios»: no se informa base de usuarios.");
  return { ok: true, context: { index }, notes };
}

// ---------------------------------------------------------------- Fila

export type HistCell = { v: string; k: string; f?: boolean } | undefined;
export type HistIssue = { severity: "error" | "warning"; code: string; message: string; column?: string };

/** Estado de la referencia mensual E frente a B: B12 (B/12), B6 (excepción B/6), OTRA (ni una ni otra), AUSENTE. */
export type EKind = "B12" | "B6" | "OTRA" | "AUSENTE";
/** Estado de G (Servidor): OK (valor), ERROR (error de la búsqueda, p. ej. #N/A), AUSENTE (vacío). */
export type GStatus = "OK" | "ERROR" | "AUSENTE";

/** Fila tipada (huella e identidad): todo lo que el libro aporta de una fila de datos, normalizado. Se guarda en el staging (`typed`). */
export type HistTyped = {
  key: string;
  year: number;
  category: FinanceCategory;
  /** B: importe anual canónico. */
  amount: string;
  /** D tal cual (etiqueta histórica: Gold, Platinum, Silver, Admin Delegada…). */
  supportLabel: string;
  /** F tal cual (0 o 1) cuando es legible. */
  adminFlag: 0 | 1 | null;
  /** E canónico (referencia mensual, no se suma). */
  monthlyRef: string | null;
  monthlyRefKind: EKind;
  monthlyRefFormula: boolean;
  /** G: texto del servidor / error de la búsqueda. */
  server: string | null;
  serverStatus: GStatus;
  /** H: usuarios (entero ≥ 0) y si procede de una fórmula con valor almacenado. */
  users: number | null;
  usersFormula: boolean;
};

export type HistParsed =
  | { kind: "EMPTY" }
  | { kind: "ERROR"; issues: HistIssue[]; label: string }
  | { kind: "ROW"; typed: HistTyped; label: string; amountOriginal: string; issues: HistIssue[] };

const fold = (s: string) => cleanText(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const ADMIN_LABEL = /^admin(istracion)?\.? delegada$/;

function parseYear(cell: HistCell): number | null {
  if (!cell) return null;
  const t = cleanText(cell.v);
  const m = /^(\d{4})(?:\.0+)?$/.exec(t);
  if (!m) return null;
  const y = Number(m[1]);
  return isValidFinanceYear(y) ? y : null;
}

function parseFlag(cell: HistCell): 0 | 1 | null | "BAD" {
  if (!cell || (cell.k === "empty" && !cell.f) || cleanText(cell.v) === "") return null;
  const t = fold(cell.v);
  if (/^(1|1\.0+|true|verdadero|si|s|x|yes)$/.test(t)) return 1;
  if (/^(0|0\.0+|false|falso|no|n)$/.test(t)) return 0;
  return "BAD";
}

const EPS = Dec.parse("0.000001") as Dec;
function classifyE(annual: Dec, e: Dec): EKind {
  if (e.sub(annual.divInt(12)).abs().cmp(EPS) <= 0) return "B12";
  if (e.sub(annual.divInt(6)).abs().cmp(EPS) <= 0) return "B6";
  return "OTRA";
}

/** Fila de datos → tipada con sus avisos, o error bloqueante. Nunca evalúa fórmulas: lee el valor almacenado. */
export function parseHistoricRow(cells: HistCell[], ctx: HistContext): HistParsed {
  const at = (c: HistColumn): HistCell => (ctx.index[c] === undefined ? undefined : cells[ctx.index[c] as number]);
  const label = cleanText(at("group")?.v ?? "");
  const issues: HistIssue[] = [];
  const err = (code: string, message: string, column?: string) => issues.push({ severity: "error", code, message, column });
  const warn = (code: string, message: string, column?: string) => issues.push({ severity: "warning", code, message, column });
  const known = Object.values(ctx.index) as number[];
  if (label === "" && known.every((i) => !cells[i] || cleanText(cells[i]?.v ?? "") === "")) return { kind: "EMPTY" };
  if (label === "") err("SIN_GRUPO", "La fila tiene datos pero no «Grupo cliente».", HIST_COLUMNS.group);

  const year = parseYear(at("year"));
  if (year === null) err("ANIO_ILEGIBLE", `El año «${cleanText(at("year")?.v ?? "")}» no es un año de cuatro dígitos legible.`, HIST_COLUMNS.year);

  const amount = parseAmountCell(at("annual"));
  let annual: Dec | null = null;
  let amountText = "";
  let amountOriginal = "";
  if (!amount.ok) err(amount.code, `Facturación anual: ${amount.reason}.`, HIST_COLUMNS.annual);
  else if (amount.kind !== "value") err("IMPORTE_VACIO", "Facturación anual vacía: no se importa como cero.", HIST_COLUMNS.annual);
  else {
    annual = Dec.parse(amount.text) as Dec;
    amountText = amount.text;
    amountOriginal = amount.original;
  }

  // Categoría (D = soporte histórico o literal «Admin Delegada»; F = indicador 0/1).
  const d = cleanText(at("support")?.v ?? "");
  const dEmpty = d === "";
  const dAdmin = ADMIN_LABEL.test(fold(d));
  const f = parseFlag(at("admin"));
  if (f === "BAD") err("INDICADOR_ILEGIBLE", `Admin Delegada: «${cleanText(at("admin")?.v ?? "")}» no es 0 ni 1.`, HIST_COLUMNS.admin);
  let category: FinanceCategory | null = null;
  if (f !== "BAD") {
    if (dAdmin && f === 0) err("CATEGORIA_INCOHERENTE", "«Soporte» dice Admin Delegada pero el indicador vale 0: la categoría es contradictoria.", HIST_COLUMNS.admin);
    else if (dAdmin || (f === 1 && dEmpty)) category = "ADMIN_DELEGADA";
    else if (f === 1) err("CATEGORIA_AMBIGUA", `El indicador Admin Delegada es 1 pero «Soporte» indica «${d}»: la categoría es contradictoria.`, HIST_COLUMNS.admin);
    else if (!dEmpty) category = "SOPORTE";
    else err("CATEGORIA_NO_EXPLICITA", "Sin «Soporte» ni Admin Delegada marcada: no se inventa una categoría.", HIST_COLUMNS.support);
  }

  // E: referencia mensual (no se suma).
  const eCell = parseAmountCell(at("monthly"));
  let eText: string | null = null;
  let eKind: EKind = "AUSENTE";
  if (!eCell.ok) warn("REFERENCIA_ILEGIBLE", `Facturación mes: ${eCell.reason}. Es solo una referencia y no se usa como ingreso.`, HIST_COLUMNS.monthly);
  else if (eCell.kind === "value") {
    eText = eCell.text;
    if (annual) {
      eKind = classifyE(annual, Dec.parse(eText) as Dec);
      if (eKind === "B6") warn("REFERENCIA_B_ENTRE_6", "Facturación mes = Facturación anual / 6 (el resto usa / 12). Se conserva la excepción tal cual: no se deduce un mes de arranque ni se multiplica E por 12 para el anual.", HIST_COLUMNS.monthly);
      else if (eKind === "OTRA") warn("REFERENCIA_DISTINTA", "Facturación mes no coincide con Facturación anual / 12 ni / 6. Es solo una referencia: el anual se usa tal cual.", HIST_COLUMNS.monthly);
    }
  }

  // G: servidor; un error de la búsqueda se conserva como ausencia/conflicto, el ingreso no se descarta.
  const gCell = at("server");
  let server: string | null = null;
  let serverStatus: GStatus = "AUSENTE";
  if (gCell && gCell.k === "error") {
    server = cleanText(gCell.v) || "#ERROR";
    serverStatus = "ERROR";
    warn("SERVIDOR_ERROR_BUSQUEDA", `Servidor: la búsqueda del libro devuelve ${server}. Se conserva como alojamiento no informado; el ingreso no se descarta y no se sigue el enlace.`, HIST_COLUMNS.server);
  } else if (gCell && cleanText(gCell.v) !== "") {
    server = cleanText(gCell.v);
    serverStatus = "OK";
  }

  // H: usuarios.
  const hCell = at("users");
  let users: number | null = null;
  let usersFormula = false;
  if (hCell && cleanText(hCell.v) !== "") {
    const n = parseUserCount(cleanText(hCell.v).replace(/\.0+$/, ""));
    if (n === null) err("USUARIOS_ILEGIBLES", `Usuarios: «${cleanText(hCell.v)}» no es un entero mayor o igual que 0.`, HIST_COLUMNS.users);
    else {
      users = n;
      usersFormula = Boolean(hCell.f);
      if (year !== null && year !== USERS_BASE_YEAR) warn("USUARIOS_FUERA_DE_BASE", `Usuarios informados en ${year}: la base de usuarios es ${USERS_BASE_YEAR}; este valor no se usa.`, HIST_COLUMNS.users);
    }
  } else if (hCell?.f) err("USUARIOS_FORMULA_SIN_VALOR", "Usuarios es una fórmula sin valor almacenado: no se evalúa.", HIST_COLUMNS.users);

  if (issues.some((i) => i.severity === "error") || year === null || category === null || annual === null) return { kind: "ERROR", issues, label };
  const typed: HistTyped = {
    key: groupSearchKey(label),
    year,
    category,
    amount: amountText,
    supportLabel: d,
    adminFlag: f === "BAD" ? null : f,
    monthlyRef: eText,
    monthlyRefKind: eKind,
    monthlyRefFormula: Boolean(at("monthly")?.f),
    server,
    serverStatus,
    users: year === USERS_BASE_YEAR ? users : null,
    usersFormula: year === USERS_BASE_YEAR ? usersFormula : false,
  };
  return { kind: "ROW", typed, label, amountOriginal, issues };
}

// ---------------------------------------------------------------- Plan por año+categoría

/** Fila ya tipada y con su origen (posición en el libro). `sourceRow` es el número de fila de la hoja (para celdas «H124»). */
export type HistRowIn = { typed: HistTyped; label: string; sourceRow: number; amountOriginal: string };

export type HistScopePlan = {
  year: number;
  category: FinanceCategory;
  rows: HistRowIn[];
  total: Dec;
  /** Σ de las referencias mensuales E (informativa; no es un ingreso). */
  referenceTotal: Dec;
  rowsWithB6: number;
  rowsWithServerError: number;
  contentHash: string;
};

export type HistUsersEntry = { category: FinanceCategory; value: number; sourceRow: number; cell: string; fromFormula: boolean };
export type HistUsersGroup = { key: string; label: string; entries: HistUsersEntry[]; distinctValues: number[]; status: "UNICA" | "DISCREPANCIA" };

export type HistPlan = {
  scopes: HistScopePlan[];
  groups: { key: string; label: string; years: number[] }[];
  users: HistUsersGroup[];
  rowsTotal: number;
};

/** Huella determinista del contenido financiero de un conjunto (idempotencia: el mismo contenido no genera otro lote). */
export function scopeContentHash(rows: HistRowIn[]): string {
  const lines = rows
    .map((r) => [r.typed.key, r.typed.amount, r.typed.supportLabel, r.typed.adminFlag ?? "", r.typed.monthlyRef ?? "", r.typed.serverStatus, r.typed.server ?? ""].join("\u0001"))
    .sort();
  return simpleHash(lines.join("\u0002"));
}

/** FNV-1a de 64 bits en hexadecimal (suficiente para detectar «mismo contenido»; la integridad del archivo la da el SHA-256 del libro). */
function simpleHash(text: string): string {
  let h = 0xcbf29ce484222325n;
  const mask = (1n << 64n) - 1n;
  for (const ch of Buffer.from(text, "utf8")) {
    h ^= BigInt(ch);
    h = (h * 0x100000001b3n) & mask;
  }
  return h.toString(16).padStart(16, "0");
}

export function planHistoric(rows: HistRowIn[]): HistPlan {
  const byScope = new Map<string, HistRowIn[]>();
  for (const r of rows) {
    const k = `${r.typed.year}|${r.typed.category}`;
    byScope.set(k, [...(byScope.get(k) ?? []), r]);
  }
  const scopes: HistScopePlan[] = [...byScope.entries()]
    .map(([, list]) => {
      const sorted = [...list].sort((a, b) => a.sourceRow - b.sourceRow);
      return {
        year: sorted[0].typed.year,
        category: sorted[0].typed.category,
        rows: sorted,
        total: sumDec(sorted.map((r) => Dec.parse(r.typed.amount) as Dec)),
        referenceTotal: sumDec(sorted.filter((r) => r.typed.monthlyRef !== null).map((r) => Dec.parse(r.typed.monthlyRef as string) as Dec)),
        rowsWithB6: sorted.filter((r) => r.typed.monthlyRefKind === "B6").length,
        rowsWithServerError: sorted.filter((r) => r.typed.serverStatus === "ERROR").length,
        contentHash: scopeContentHash(sorted),
      };
    })
    .sort((a, b) => a.year - b.year || a.category.localeCompare(b.category));

  const groupMap = new Map<string, { key: string; label: string; years: Set<number> }>();
  for (const r of rows) {
    const g = groupMap.get(r.typed.key) ?? { key: r.typed.key, label: r.label, years: new Set<number>() };
    g.years.add(r.typed.year);
    groupMap.set(r.typed.key, g);
  }

  // Usuarios de la base: por Grupo, una entrada por categoría. Las filas NO se suman; valores distintos = discrepancia (sin máximo, suma ni último).
  const usersMap = new Map<string, HistUsersGroup>();
  for (const r of [...rows].sort((a, b) => a.sourceRow - b.sourceRow)) {
    if (r.typed.users === null || r.typed.year !== USERS_BASE_YEAR) continue;
    const g = usersMap.get(r.typed.key) ?? { key: r.typed.key, label: r.label, entries: [], distinctValues: [], status: "UNICA" as const };
    g.entries.push({ category: r.typed.category, value: r.typed.users, sourceRow: r.sourceRow, cell: `H${r.sourceRow}`, fromFormula: r.typed.usersFormula });
    usersMap.set(r.typed.key, g);
  }
  const users = [...usersMap.values()]
    .map((g) => {
      const distinctValues = [...new Set(g.entries.map((e) => e.value))].sort((a, b) => a - b);
      return { ...g, distinctValues, status: distinctValues.length > 1 ? ("DISCREPANCIA" as const) : ("UNICA" as const) };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    scopes,
    groups: [...groupMap.values()].map((g) => ({ key: g.key, label: g.label, years: [...g.years].sort() })).sort((a, b) => a.key.localeCompare(b.key)),
    users,
    rowsTotal: rows.length,
  };
}
