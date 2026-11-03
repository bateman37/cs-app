import { NextResponse } from "next/server";
import { collectHealth, toPublicHealth } from "@/server/ops/health";

export const dynamic = "force-dynamic";

/** Salud MÍNIMA pública: solo estado global. Detalles, rutas, colas y configuración están en /api/administracion/salud (solo Administrador). */
export async function GET() {
  try {
    const r = toPublicHealth(await collectHealth());
    return NextResponse.json(r, { status: r.status === "caido" ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "caido" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
