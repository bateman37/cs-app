import { analyticsError } from "@/server/analytics/http";
import { adminRoute } from "@/server/reconciliation/http";
import { collectHealth, redactedDiagnostic } from "@/server/ops/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Detalle técnico de salud: solo Administrador con sesión vigente. Con `?descargar=1` entrega el diagnóstico redactado (sin secretos, DSN, sesiones, SQL ni datos de clientes). */
export async function GET(request: Request): Promise<Response> {
  try {
    const who = await adminRoute(request);
    if (who instanceof Response) return who;
    const report = await collectHealth();
    const download = new URL(request.url).searchParams.get("descargar") === "1";
    const body = JSON.stringify(download ? redactedDiagnostic(report) : report, null, 2);
    const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", vary: "Cookie", "x-content-type-options": "nosniff" };
    if (download) headers["content-disposition"] = `attachment; filename="cs-app_diagnostico_${report.generatedAt.slice(0, 19).replace(/[:T]/g, "-")}.json"`;
    return new Response(body, { status: 200, headers });
  } catch (e) {
    return analyticsError(e);
  }
}
