import { analyticsError } from "@/server/analytics/http";
import { adminRoute } from "@/server/reconciliation/http";
import { getReconRun } from "@/server/reconciliation/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const who = await adminRoute(request);
    if (who instanceof Response) return who;
    const run = await getReconRun(who.actorId, (await ctx.params).id);
    const body = JSON.stringify({ informe: run.id, creado: run.createdAt, solicitante: run.actor, parametros: run.params, sello_datos: run.stamp, leido_el: run.readAt, resumen: run.summary, manifiesto: run.manifest, resultados: run.results }, null, 2);
    return new Response(body, { status: 200, headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="conciliacion_${run.id.slice(0, 8)}_manifiesto.json"`, "cache-control": "private, no-store", vary: "Cookie", "x-content-type-options": "nosniff" } });
  } catch (e) {
    return analyticsError(e);
  }
}
