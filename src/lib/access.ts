import type { UserRole } from "@/generated/prisma/enums";

/** Error de acceso: sin sesión o sin permiso. Su mensaje es seguro de mostrar. */
export class AccessError extends Error {
  constructor(
    public readonly code: "UNAUTHENTICATED" | "FORBIDDEN",
    message?: string,
  ) {
    super(
      message ??
        (code === "UNAUTHENTICATED" ? "Debe iniciar sesión." : "No tiene permiso para esta operación."),
    );
    this.name = "AccessError";
  }
}

export type Actor = { id: string; email: string; role: UserRole };

export const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: "Administrador",
  CONSULTA: "Consulta",
};
