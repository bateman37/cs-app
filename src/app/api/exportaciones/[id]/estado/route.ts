import { analyticsError, apiReader } from "@/server/analytics/http";
import { getExport } from "@/server/exports/service";
import { json } from "@/server/uploads/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Estado y progreso de una exportación propia (sondeo de la pantalla). Otra persona obtiene el mismo rechazo que si no existiera. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const who = await apiReader(request);
    if (who instanceof Response) return who;
    const { id } = await ctx.params;
    const v = await getExport(who.actorId, id);
    return json(v, 200);
  } catch (e) {
    return analyticsError(e);
  }
}
