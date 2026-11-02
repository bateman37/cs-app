import { parseQualityQuery } from "@/domain/quality-query";
import { analyticsError, apiReader, csvResponse } from "@/server/analytics/http";
import { QUALITY_TABLES, qualityCsv, type QualityTable } from "@/server/quality/export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** CSV de Calidad: cartera COMPLETA filtrada, resumen de ficha o matriz de Client Health. Sesión real, ADMIN o Consulta, lectura coherente. `tabla=cartera|ficha|health`. */
export async function GET(request: Request): Promise<Response> {
  try {
    const who = await apiReader(request);
    if (who instanceof Response) return who;
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const { query } = parseQualityQuery({ ...params, sim: undefined });
    const t = (QUALITY_TABLES as readonly string[]).includes(params.tabla ?? "") ? (params.tabla as QualityTable) : "cartera";
    const csv = await qualityCsv(who.actorId, query, t);
    return csvResponse(csv.body, csv.filename, csv.stamp, params.sello ?? "");
  } catch (e) {
    return analyticsError(e);
  }
}
