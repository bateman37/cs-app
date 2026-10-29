import type { Ctx } from "../nucleo";
import { login, newContext, sessionToken } from "./util";

const VIEWS = ["Comparativa", "Análisis Cliente", "Pulse Rent", "Calidad"];

export async function acceso(ctx: Ctx): Promise<void> {
  // Sin sesión: cada ruta privada lleva a /login (también las de administración).
  const anon = await newContext(ctx);
  for (const route of ["/", "/comparativa", "/calidad", "/administracion/clientes/grupos", "/administracion/clientes/clientes/nuevo"]) {
    await anon.page.goto(`${ctx.base}${route}`);
    ctx.check(`Sin sesión, ${route} redirige a /login`, new URL(anon.page.url()).pathname === "/login", anon.page.url());
  }
  // Mutación sin sesión: una petición directa no crea datos.
  const before = await ctx.prisma.clientGroup.count();
  await anon.context.request.post(`${ctx.base}/administracion/clientes/grupos/nuevo`, {
    headers: { Origin: ctx.base },
    multipart: { name: "Grupo sin sesión" },
    maxRedirects: 0,
  });
  ctx.check("Sin sesión, un POST directo no crea datos", (await ctx.prisma.clientGroup.count()) === before);

  // Cookie falsa: no accede y no hay bucle de redirecciones.
  const fake = await newContext(ctx);
  await fake.context.addCookies([{ name: "better-auth.session_token", value: "falsa.firmafalsa", url: ctx.base }]);
  await fake.page.goto(`${ctx.base}/administracion/clientes/grupos`);
  await fake.page.waitForLoadState("networkidle");
  ctx.check(
    "Cookie de sesión falsa: termina en /login sin bucle",
    new URL(fake.page.url()).pathname === "/login" && (await fake.page.getByLabel("Correo electrónico").count()) === 1,
    fake.page.url(),
  );
  await fake.context.close();
  await anon.context.close();

  // Contraseña incorrecta: no entra y el mensaje no revela si el correo existe.
  const bad = await login(ctx, ctx.accounts.adminEmail, "contraseña-incorrecta-123");
  const msg = (await bad.page.locator(".notice-error").textContent().catch(() => "")) ?? "";
  ctx.check("Contraseña incorrecta: no entra y muestra mensaje genérico", !bad.ok && /incorrectos/.test(msg) && !/no existe/i.test(msg), msg);
  await bad.context.close();

  // Login real del Administrador.
  const ok = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);
  ctx.check("Login real del Administrador entra en la aplicación", ok.ok && (await sessionToken(ok.context)) !== null);
  await ok.page.waitForSelector("nav[aria-label=Principal] a", { timeout: 10000 }).catch(() => undefined);
  const links = await ok.page.getByRole("navigation", { name: "Principal" }).getByRole("link").allTextContents();
  ctx.check("El menú principal muestra las cuatro vistas y Administración", VIEWS.every((v) => links.includes(v)) && links.includes("Administración"), links.join("|"));
  const dbSession = await ctx.prisma.session.count({ where: { user: { email: ctx.accounts.adminEmail } } });
  ctx.check("El login crea una sesión en la base de datos", dbSession === 1, String(dbSession));

  // Las cuatro vistas son pendientes honestas: sin tablas ni cifras.
  const views: [string, string][] = [
    ["/comparativa", "Comparativa"],
    ["/analisis-cliente", "Análisis Cliente"],
    ["/pulse-rent", "Pulse Rent"],
    ["/calidad", "Calidad"],
  ];
  for (const [route, v] of views) {
    await ok.page.goto(`${ctx.base}${route}`);
    const text = await ok.page.locator("main").innerText();
    const noData = (await ok.page.locator("main table, main canvas, main svg").count()) === 0 && !/\d/.test(text);
    ctx.check(`Vista ${v}: pendiente, sin cifras ni tablas`, /Todavía no disponible/.test(text) && noData);
  }
  await ok.context.close();
}
