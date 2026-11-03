/**
 * Redacción de secretos (CSAPP-10 §7). Todo texto que pueda llegar a un registro, a un error o a la consola (salida de pg_dump/pg_restore, mensajes de
 * conexión, URL) pasa por aquí. Quita las credenciales de cualquier URL y, además, los valores concretos que se le indiquen (contraseñas conocidas).
 */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]*)(?::[^\s/@]*)?@/gi;
const KEY_VALUE = /\b(PGPASSWORD|PASSWORD|PASSWD|SECRET|TOKEN|BETTER_AUTH_SECRET)\s*[=:]\s*\S+/gi;

export function redact(text: string, secrets: readonly (string | null | undefined)[] = []): string {
  let out = String(text).replace(URL_CREDENTIALS, (_m, scheme: string) => `${scheme}***@`).replace(KEY_VALUE, (_m, k: string) => `${k}=***`);
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join("***");
  }
  return out;
}

/** Valores que nunca deben aparecer: contraseña de una URL de base y secreto de la aplicación, si están definidos. */
export function secretsFrom(urls: readonly (string | undefined)[], env: Record<string, string | undefined> = process.env): string[] {
  const out: string[] = [];
  for (const raw of urls) {
    if (!raw) continue;
    try {
      const u = new URL(raw);
      if (u.password) out.push(decodeURIComponent(u.password), u.password);
    } catch {
      /* no es una URL */
    }
  }
  if (env.BETTER_AUTH_SECRET) out.push(env.BETTER_AUTH_SECRET);
  return out;
}
