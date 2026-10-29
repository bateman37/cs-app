/**
 * Convención única de vigencias: intervalo semiabierto [desde, hasta).
 *  - «desde» es inclusivo; «hasta» es exclusivo (el primer día en que ya no aplica).
 *  - Un extremo nulo significa sin límite conocido por ese lado.
 *  - Una migración OP a CLOUD con fecha efectiva 2026-06-01 deja OP hasta 2026-05-31
 *    y CLOUD desde 2026-06-01.
 * Las fechas se manejan como texto ISO AAAA-MM-DD, sin horas ni zonas.
 */
export type Interval = { from: string | null; to: string | null };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function toDbDate(value: string | null): Date | null {
  return value ? new Date(`${value}T00:00:00Z`) : null;
}

export function fromDbDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** Un intervalo es coherente si ambos extremos existen y desde < hasta. */
export function isCoherent(i: Interval): boolean {
  return i.from === null || i.to === null || i.from < i.to;
}

export function contains(i: Interval, date: string): boolean {
  return (i.from === null || i.from <= date) && (i.to === null || date < i.to);
}

export function overlaps(a: Interval, b: Interval): boolean {
  const aStartsBeforeBEnds = a.from === null || b.to === null || a.from < b.to;
  const bStartsBeforeAEnds = b.from === null || a.to === null || b.from < a.to;
  return aStartsBeforeBEnds && bStartsBeforeAEnds;
}

/** Fecha de hoy en Europe/Madrid (AAAA-MM-DD). */
export function todayMadrid(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts;
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y}`;
}

export function describeInterval(i: Interval): string {
  const from = i.from ? `desde ${formatDate(i.from)}` : "inicio desconocido";
  const to = i.to ? `hasta antes del ${formatDate(i.to)}` : "sin fin";
  return `${from}, ${to}`;
}

/** Fila vigente en una fecha dentro de un conjunto de tramos del mismo dato (o null = sin informar). */
export function pickAt<T extends Interval>(rows: T[], date: string): T | null {
  return rows.find((r) => contains(r, date)) ?? null;
}
