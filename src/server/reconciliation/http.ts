import { apiAdmin } from "@/server/uploads/http";

/** Sesión real y rol ADMIN vigente leídos de la base (el informe de conciliación es de Administración). */
export const adminRoute = (request: Request) => apiAdmin(request, { checkOrigin: false });
