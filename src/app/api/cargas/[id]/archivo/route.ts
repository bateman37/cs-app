import { Readable } from "node:stream";
import { prisma } from "@/lib/db";
import { apiAdmin, errorResponse, json } from "@/server/uploads/http";
import { fileSize, openFile } from "@/server/uploads/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Descarga del archivo original (solo Administrador): la ruta sale del identificador interno, nunca del cliente. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const who = await apiAdmin(request, { checkOrigin: false });
    if (who instanceof Response) return who;
    const { id } = await ctx.params;
    const batch = await prisma.uploadBatch.findUnique({ where: { id }, select: { storageId: true, originalName: true, fileFormat: true } });
    if (!batch) return json({ error: "Carga no encontrada." }, 404);
    const size = await fileSize(batch.storageId);
    if (size === null) return json({ error: "El archivo ya no está en el almacén." }, 404);
    const safeName = batch.originalName.replace(/[^\w.\- ]+/g, "_");
    return new Response(Readable.toWeb(openFile(batch.storageId)) as unknown as ReadableStream, {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(size),
        "content-disposition": `attachment; filename="${safeName}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
