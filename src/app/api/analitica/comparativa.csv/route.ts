import { parseAnalysisQuery } from "@/domain/analytics-query";
import { analyticsError, apiReader, csvResponse } from "@/server/analytics/http";
import { portfolioCsv } from "@/server/analytics/export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** CSV de la cartera COMPLETA filtrada (no la página): sesión real, rol ADMIN o Consulta y lectura coherente. */
export async function GET(request: Request): Promise<Response> {
  try {
    const who = await apiReader(request);
    if (who instanceof Response) return who;
    const url = new URL(request.url);
    const { query } = parseAnalysisQuery(Object.fromEntries(url.searchParams));
    const csv = await portfolioCsv(who.actorId, query);
    return csvResponse(csv.body, csv.filename, csv.stamp, query.stamp);
  } catch (e) {
    return analyticsError(e);
  }
}
