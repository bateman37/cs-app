import { analyticsError } from "@/server/analytics/http";
import { adminRoute } from "@/server/reconciliation/http";
import { getReconRun, reconCsv } from "@/server/reconciliation/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const who = await adminRoute(request);
    if (who instanceof Response) return who;
    const run = await getReconRun(who.actorId, (await ctx.params).id);
    return new Response(reconCsv(run), { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="conciliacion_${run.id.slice(0, 8)}.csv"`, "cache-control": "private, no-store", vary: "Cookie", "x-content-type-options": "nosniff", "x-referencia-datos": run.stamp } });
  } catch (e) {
    return analyticsError(e);
  }
}
