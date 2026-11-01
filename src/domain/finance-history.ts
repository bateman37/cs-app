/**
 * Adaptador de financieros históricos anteriores a 2025 (hoja «DATA FACTURACIÓN», CSAPP-05 §11). Dominio puro: normaliza las filas,
 * rechaza 2025 en adelante, exige categoría explícita y agrupa por año+categoría. No inventa OTROS, Diferencia, usuarios ni modalidades.
 *
 * Interpretación de la categoría (pendiente de validar con el libro real): una fila es ADMIN_DELEGADA si la columna «Admin Delegada» está
 * marcada de forma explícita (sí, x, 1, verdadero) y SOPORTE si «Soporte» tiene un valor y «Admin Delegada» no; con ambas o ninguna la
 * categoría no es explícita y la fila no se importa (se informa).
 */
import { cleanText } from "./normalize";
import { Dec, groupSearchKey, parseAmountCell, type FinanceCategory } from "./finance";
import { normalizeHeader } from "./zendesk";

export const HISTORIC_SHEET = "DATA FACTURACIÓN";
export const HISTORIC_FIRST_COMMERCIAL_YEAR = 2025;
export const HIST_HEADERS = { group: "Grupo cliente", annual: "Facturación anual", year: "Año" } as const;
export const HIST_OPTIONAL = ["Soporte", "Facturación mes", "Admin Delegada", "Servidor", "Usuarios"] as const;

export type HistCell = { v: string; k: string; f?: boolean } | undefined;
export type HistRow = { sourceRow: number; cells: HistCell[] };

export type HistHeader = { ok: true; index: Record<string, number>; ignored: string[] } | { ok: false; message: string };

export function mapHistoricHeaders(row: string[]): HistHeader {
  const norm = row.map(normalizeHeader);
  const index: Record<string, number> = {};
  const missing: string[] = [];
  for (const h of [...Object.values(HIST_HEADERS), ...HIST_OPTIONAL]) {
    const hits = norm.map((n, i) => (n === normalizeHeader(h) ? i : -1)).filter((i) => i >= 0);
    if (hits.length > 1) return { ok: false, message: `Cabecera duplicada: «${h}».` };
    if (hits.length === 1) index[h] = hits[0];
    else if ((Object.values(HIST_HEADERS) as string[]).includes(h)) missing.push(h);
  }
  if (missing.length > 0) return { ok: false, message: `Faltan las cabeceras obligatorias: ${missing.map((m) => `«${m}»`).join(", ")}.` };
  return { ok: true, index, ignored: ["Facturación mes", "Servidor", "Usuarios"].filter((h) => h in index) };
}

const TRUE = /^(si|sí|s|x|1|true|verdadero|yes)$/i;
const flagged = (c: HistCell) => (c ? TRUE.test(cleanText(c.v)) : false);

export type HistItem = { year: number; category: FinanceCategory; groupLabel: string; sourceKey: string; income: string; sourceRow: number };
export type HistSkip = { sourceRow: number; code: "AÑO_NO_HISTORICO" | "AÑO_ILEGIBLE" | "SIN_GRUPO" | "IMPORTE_ILEGIBLE" | "CATEGORIA_NO_EXPLICITA" | "CATEGORIA_AMBIGUA"; message: string };

export type HistPlan = {
  scopes: { year: number; category: FinanceCategory; items: HistItem[]; total: string; conflicts: string[] }[];
  skipped: HistSkip[];
  ignoredColumns: string[];
  rowsRead: number;
};

export function planHistoric(index: Record<string, number>, ignored: string[], rows: HistRow[]): HistPlan {
  const skipped: HistSkip[] = [];
  const byScope = new Map<string, { year: number; category: FinanceCategory; items: Map<string, HistItem[]> }>();
  for (const r of rows) {
    const cell = (h: string) => (h in index ? r.cells[index[h]] : undefined);
    const label = cleanText(cell(HIST_HEADERS.group)?.v ?? "");
    if (label === "") {
      if (r.cells.every((c) => !c || c.v.trim() === "")) continue;
      skipped.push({ sourceRow: r.sourceRow, code: "SIN_GRUPO", message: "Fila sin «Grupo cliente»." });
      continue;
    }
    const yRaw = cleanText(cell(HIST_HEADERS.year)?.v ?? "");
    const year = /^\d{4}$/.test(yRaw) ? Number(yRaw) : /^\d{4}\.0+$/.test(yRaw) ? Number(yRaw.slice(0, 4)) : NaN;
    if (!Number.isInteger(year)) {
      skipped.push({ sourceRow: r.sourceRow, code: "AÑO_ILEGIBLE", message: `El año «${yRaw}» no es legible.` });
      continue;
    }
    if (year >= HISTORIC_FIRST_COMMERCIAL_YEAR) {
      skipped.push({ sourceRow: r.sourceRow, code: "AÑO_NO_HISTORICO", message: `El año ${year} se carga con los perfiles comerciales (esta vía solo admite años anteriores a ${HISTORIC_FIRST_COMMERCIAL_YEAR}).` });
      continue;
    }
    const amount = parseAmountCell(cell(HIST_HEADERS.annual));
    if (!amount.ok || amount.kind !== "value") {
      skipped.push({ sourceRow: r.sourceRow, code: "IMPORTE_ILEGIBLE", message: !amount.ok ? `Facturación anual: ${amount.reason}.` : "Facturación anual vacía: no se importa como cero." });
      continue;
    }
    const admin = flagged(cell("Admin Delegada"));
    const soporte = (cell("Soporte")?.v ?? "").trim() !== "";
    if (admin && soporte) {
      skipped.push({ sourceRow: r.sourceRow, code: "CATEGORIA_AMBIGUA", message: "Marcadas a la vez «Soporte» y «Admin Delegada»: la categoría no es explícita." });
      continue;
    }
    if (!admin && !soporte) {
      skipped.push({ sourceRow: r.sourceRow, code: "CATEGORIA_NO_EXPLICITA", message: "Sin «Soporte» ni «Admin Delegada»: no se inventa una categoría." });
      continue;
    }
    const category: FinanceCategory = admin ? "ADMIN_DELEGADA" : "SOPORTE";
    const key = groupSearchKey(label);
    const scope = byScope.get(`${year}|${category}`) ?? { year, category, items: new Map<string, HistItem[]>() };
    scope.items.set(key, [...(scope.items.get(key) ?? []), { year, category, groupLabel: label, sourceKey: key, income: amount.text, sourceRow: r.sourceRow }]);
    byScope.set(`${year}|${category}`, scope);
  }
  const scopes = [...byScope.values()]
    .sort((a, b) => a.year - b.year || a.category.localeCompare(b.category))
    .map((s) => {
      const items: HistItem[] = [];
      const conflicts: string[] = [];
      for (const [key, list] of s.items) {
        const distinct = new Set(list.map((i) => i.income));
        if (distinct.size > 1) conflicts.push(`«${list[0].groupLabel}» (${key}) con importes contradictorios: ${[...distinct].join(" / ")}`);
        else items.push(list[0]); // filas idénticas cuentan una vez
      }
      const total = items.reduce((t, i) => t.add(Dec.parse(i.income) as Dec), Dec.ZERO);
      return { year: s.year, category: s.category, items, total: total.toString(), conflicts };
    });
  return { scopes, skipped, ignoredColumns: ignored, rowsRead: rows.length };
}
