/** Conversión de números de serie de Excel a ISO, con el calendario 1900 (con su error del 29/02/1900) o 1904. */
const DAY_MS = 86_400_000;

export function serialToIso(serial: string, date1904: boolean): string | null {
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 0 || n > 2_958_465) return null;
  // 1900: el serial 60 es el inexistente 29/02/1900; la base efectiva es 1899-12-30 para seriales ≥ 61.
  const base = date1904 ? Date.UTC(1904, 0, 1) : n < 61 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const ms = Math.round(n * DAY_MS);
  const d = new Date(base + ms);
  const iso = d.toISOString();
  return Number.isInteger(n) ? iso.slice(0, 10) : iso.slice(0, 19);
}

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

export function isDateFormat(numFmtId: number, code?: string): boolean {
  if (code === undefined) return BUILTIN_DATE.has(numFmtId);
  const stripped = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
  return /[dmyhs]/i.test(stripped) && !/^general$/i.test(stripped);
}
