import { apiAdmin, errorResponse, json } from "@/server/uploads/http";
import { getRefreshStatus } from "@/server/relations/refresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Estado de la actualización de relaciones para sondeo (solo Administrador): progreso, fallo y generación publicada. */
export async function GET(request: Request): Promise<Response> {
  try {
    const who = await apiAdmin(request, { checkOrigin: false });
    if (who instanceof Response) return who;
    const s = await getRefreshStatus(who.actorId);
    return json({ state: s.state, requested: s.requestedGeneration, completed: s.completedGeneration, progress: s.progress, lastError: s.lastError, attempts: s.attempts, maxAttempts: s.maxAttempts });
  } catch (e) {
    return errorResponse(e);
  }
}
