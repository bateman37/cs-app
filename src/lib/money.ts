/**
 * Presentación de importes decimales exactos (texto) con separador de millares «.» y decimales «,». Solo para mostrar:
 * el redondeo (mitad hacia fuera) se hace sobre el texto, sin pasar por `Number`.
 */
export function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function formatDecimalEs(text: string | null | undefined, digits = 2): string {
  if (text === null || text === undefined || text === "") return "—";
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return text;
  const [, sign, i, f = ""] = m;
  let frac = f.padEnd(digits + 1, "0");
  let carry = frac.charCodeAt(digits) >= 53 ? 1n : 0n;
  frac = frac.slice(0, digits);
  let units = BigInt(i + frac) + carry;
  carry = 0n;
  const s = units.toString().padStart(digits + 1, "0");
  const ip = digits === 0 ? s : s.slice(0, -digits);
  const fp = digits === 0 ? "" : s.slice(-digits);
  units = 0n;
  const zero = /^0*$/.test(ip + fp);
  return `${sign && !zero ? "-" : ""}${groupThousands(ip)}${fp ? `,${fp}` : ""}`;
}
