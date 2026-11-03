import { parsePulseQuery } from "@/domain/pulse-query";
import { analyticsError, apiReader, csvResponse } from "@/server/analytics/http";
import { PULSE_TABLES, pulseCsv, type PulseTable } from "@/server/pulse/export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** CSV de Pulse Rent: TODAS las filas visibles filtradas (no la página). Sesión real, ADMIN o Consulta, lectura coherente. `tabla=filas|estadisticas|criterios`. */
export async function GET(request: Request): Promise<Response> {
  try {
    const who = await apiReader(request);
    if (who instanceof Response) return who;
    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams);
    const { query } = parsePulseQuery(params);
    const t = (PULSE_TABLES as readonly string[]).includes(params.tabla ?? "") ? (params.tabla as PulseTable) : "filas";
    const csv = await pulseCsv(who.actorId, query, t);
    return csvResponse(csv.body, csv.filename, csv.stamp, query.base.stamp);
  } catch (e) {
    return analyticsError(e);
  }
}
