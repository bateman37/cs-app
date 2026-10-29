import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Redirección optimista: sin cookie de sesión no se sirven páginas privadas.
 * No es la autorización: cada página, consulta y acción valida la sesión en servidor.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasCookie = Boolean(getSessionCookie(request));
  // /login valida la sesión real en servidor: una cookie caducada no debe provocar bucles.
  if (pathname === "/login") return NextResponse.next();
  if (!hasCookie) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  // api/cargas queda fuera: el proxy bufferiza los cuerpos de petición y las subidas deben ir en
  // streaming. Sus rutas validan origen, sesión real y rol ADMIN por sí mismas antes de leer nada.
  matcher: ["/((?!api/auth|api/cargas|_next/static|_next/image|favicon.ico).*)"],
};
