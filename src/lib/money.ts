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

/**
 * Fracción exacta → porcentaje presentado («0.25» → «25 %», «-0.4545» → «-45,5 %»). El porcentaje se calcula sobre el texto decimal
 * (×100 exacto) antes de redondear a `digits` decimales como máximo; se omiten los ceros finales (25 %, no 25,0 %). No cambia el signo
 * confirmado. Solo para mostrar.
 */
export function formatPercentEs(fraction: string | null | undefined, digits = 1): string {
  if (fraction === null || fraction === undefined || fraction === "") return "—";
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(fraction);
  if (!m) return fraction;
  const [, sign, i, f = ""] = m;
  const padded = f.padEnd(2, "0");
  const whole = (BigInt(i) * 100n + BigInt(padded.slice(0, 2))).toString();
  const rest = padded.slice(2);
  const pct = `${sign}${whole}${rest ? `.${rest}` : ""}`;
  const shown = formatDecimalEs(pct, digits).replace(/,?0+$/, (t) => (t.startsWith(",") ? "" : t));
  return `${shown} %`;
}
