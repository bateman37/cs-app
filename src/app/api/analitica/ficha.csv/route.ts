import { ID_PATTERN, parseAnalysisQuery, parseEntityRef } from "@/domain/analytics-query";
import { analyticsError, apiReader, csvResponse } from "@/server/analytics/http";
import { FICHA_TABLES, fichaCsv, type FichaTable } from "@/server/analytics/export";
import { json } from "@/server/uploads/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** CSV de un resumen o serie de la ficha (series, dedicación, PAP o tickets) del ámbito indicado. */
export async function GET(request: Request): Promise<Response> {
  try {
    const who = await apiReader(request);
    if (who instanceof Response) return who;
    const url = new URL(request.url);
    const ref = parseEntityRef(url.searchParams.get("ambito") ?? "", url.searchParams.get("id") ?? "");
    const table = (url.searchParams.get("tabla") ?? "series") as FichaTable;
    if (!ref || !ID_PATTERN.test(ref.id) || !FICHA_TABLES.includes(table)) return json({ error: "Ámbito o tabla no válidos." }, 400);
    const { query } = parseAnalysisQuery(Object.fromEntries(url.searchParams));
    const csv = await fichaCsv(who.actorId, query, ref, table);
    if (!csv) return json({ error: "Ámbito no encontrado." }, 404);
    return csvResponse(csv.body, csv.filename, csv.stamp, query.stamp);
  } catch (e) {
    return analyticsError(e);
  }
}
