/** Error de negocio o validación con mensaje seguro de mostrar y errores por campo. */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "DomainError";
  }
}

/** Edición basada en una versión que ya no es la vigente. */
export class StaleVersionError extends DomainError {
  constructor(what = "El registro") {
    super(
      `${what} ha sido modificado por otra persona desde que abrió este formulario. Recargue la página para revisar los cambios y vuelva a intentarlo; no se ha guardado nada.`,
    );
    this.name = "StaleVersionError";
  }
}

type PgInfo = { code?: string; constraint?: string };

/**
 * Localiza el código SQLSTATE y la restricción incumplida dentro de un error de Prisma
 * (el adaptador de PostgreSQL los deja en meta.driverAdapterError.cause).
 */
export function pgInfo(error: unknown): PgInfo {
  let text = "";
  try {
    const e = error as { message?: string; meta?: unknown };
    text = `${e?.message ?? ""} ${JSON.stringify(e?.meta ?? {})}`;
  } catch {
    return {};
  }
  const code = /"originalCode":"(23[0-9A-Z]{3})"/.exec(text)?.[1] ?? /\b(23505|23P01|23514|23503)\b/.exec(text)?.[1];
  const constraint = /constraint \\?"([^"\\]+)\\?"/.exec(text)?.[1] ?? /"index":"([^"]+)"/.exec(text)?.[1];
  return { code, constraint };
}

/** Restricción de la base que se ha incumplido, si el error es de integridad. */
export function violatedConstraint(error: unknown): { code: string; constraint?: string } | null {
  const info = pgInfo(error);
  if (info.code && ["23505", "23P01", "23514", "23503"].includes(info.code)) {
    return { code: info.code, constraint: info.constraint };
  }
  return null;
}
