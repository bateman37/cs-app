import { Readable } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { receiveUpload } from "@/server/uploads/batches";
import { apiAdmin, errorResponse, json } from "@/server/uploads/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Subida de un archivo: el CUERPO es el propio archivo (streaming, sin formData). Metadatos en cabeceras:
 *  x-csapp-perfil: id del perfil; x-csapp-nombre: nombre informativo (URL-encoded);
 *  x-csapp-metadatos: JSON en base64 con {perfil: {...}, declarado: {extraccion, desde, hasta, cobertura}}.
 * Orden: origen → sesión real → rol ADMIN → perfil y límites → solo entonces se abre y se lee el cuerpo.
 * Un rechazo no deja archivo, lote ni trabajo.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const who = await apiAdmin(request, { checkOrigin: true });
    if (who instanceof Response) return who;
    const profileId = request.headers.get("x-csapp-perfil") ?? "";
    let name = "";
    try {
      name = decodeURIComponent(request.headers.get("x-csapp-nombre") ?? "");
    } catch {
      return json({ error: "Nombre de archivo no válido." }, 400);
    }
    let meta: { perfil?: unknown; declarado?: unknown } = {};
    const rawMeta = request.headers.get("x-csapp-metadatos");
    if (rawMeta) {
      try {
        meta = JSON.parse(Buffer.from(rawMeta, "base64").toString("utf8"));
      } catch {
        return json({ error: "Metadatos no válidos." }, 400);
      }
    }
    if (!request.body) return json({ error: "Falta el archivo." }, 400);
    const cl = request.headers.get("content-length");
    const result = await receiveUpload(who.actorId, {
      profileId,
      originalName: name,
      metadata: meta.perfil ?? {},
      declared: meta.declarado ?? {},
      contentLength: cl && /^\d+$/.test(cl) ? Number(cl) : null,
      body: Readable.fromWeb(request.body as unknown as NodeWebStream),
    });
    return json(result, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
