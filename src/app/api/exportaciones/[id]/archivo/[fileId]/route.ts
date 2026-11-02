import { Readable } from "node:stream";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { analyticsError, apiReader } from "@/server/analytics/http";
import { authorizeDownload } from "@/server/exports/service";
import { exportFilePath } from "@/server/exports/run";
import { json } from "@/server/uploads/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Descarga privada de un archivo de exportación: sesión y rol vigentes, PROPIETARIO, estado LISTO y vigente (un UUID no autoriza). La ruta sale solo del
 * identificador interno guardado en la base; nunca del cliente. Sin caché compartida; nunca en `public/`.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string; fileId: string }> }): Promise<Response> {
  try {
    const who = await apiReader(request);
    if (who instanceof Response) return who;
    const { id, fileId } = await ctx.params;
    const f = await authorizeDownload(who.actorId, id, fileId);
    const path = exportFilePath(f.storageId);
    const size = await stat(path).then((s) => s.size).catch(() => null);
    if (size === null || BigInt(size) !== f.bytes) return json({ error: "El archivo ya no está disponible o no coincide con su registro: solicite la exportación de nuevo." }, 410);
    const safe = f.name.replace(/[^\w.\-]+/g, "_");
    return new Response(Readable.toWeb(createReadStream(path)) as unknown as ReadableStream, {
      status: 200,
      headers: {
        "content-type": f.kind === "MANIFEST" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
        "content-length": String(size),
        "content-disposition": `attachment; filename="${safe}"`,
        "cache-control": "private, no-store",
        vary: "Cookie",
        "x-content-type-options": "nosniff",
        "x-checksum-sha256": f.checksum,
      },
    });
  } catch (e) {
    return analyticsError(e);
  }
}
