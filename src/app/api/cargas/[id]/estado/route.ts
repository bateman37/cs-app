import { apiAdmin, errorResponse, json } from "@/server/uploads/http";
import { uploadStatus } from "@/server/uploads/batches";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Estado y progreso de un lote para sondeo (solo Administrador). */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const who = await apiAdmin(request, { checkOrigin: false });
    if (who instanceof Response) return who;
    const { id } = await ctx.params;
    const status = await uploadStatus(who.actorId, id);
    return status ? json(status) : json({ error: "Carga no encontrada." }, 404);
  } catch (e) {
    return errorResponse(e);
  }
}
