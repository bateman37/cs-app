import type { BrowserContext } from "playwright";
import type { Ctx } from "../nucleo";
import { login, sessionToken } from "./util";

/** Cabecera Cookie de un contexto para peticiones directas. */
async function cookieHeader(context: BrowserContext, base: string): Promise<string> {
  return (await context.cookies(base)).map((c) => `${c.name}=${c.value}`).join("; ");
}

/** Reproduce el POST de formulario de una Server Action con un ID real y las cookies dadas. */
async function forgedCreate(ctx: Ctx, fields: [string, string][], cookie: string, name: string): Promise<number> {
  const body = new FormData();
  for (const [k, v] of fields) body.set(k, v);
  body.set("name", name);
  const r = await fetch(`${ctx.base}/administracion/clientes/grupos/nuevo`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: ctx.base },
    body,
    redirect: "manual",
  });
  return r.status;
}

export async function consulta(ctx: Ctx): Promise<void> {
  // El ID real de una Server Action se lee de un formulario renderizado para el Administrador.
  const adm = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);
  await adm.page.goto(`${ctx.base}/administracion/clientes/grupos/nuevo`);
  const html = await adm.page.content();
  void html;
  // Campos ocultos reales del formulario (`$ACTION_REF_1`, `$ACTION_1:0`...): se reproducen tal cual.
  const actionFields = await adm.page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLInputElement>("main form input[type=hidden]"))
      .filter((i) => i.name.startsWith("$ACTION"))
      .map((i) => [i.name, i.value] as [string, string]),
  );
  const actionId = actionFields.length > 0 ? "ok" : undefined;
  ctx.check("Se obtiene el ID de una Server Action real desde la página del Administrador", Boolean(actionId));
  const adminCookie = await cookieHeader(adm.context, ctx.base);

  // Control positivo: con la cookie del Administrador la misma petición sí crea; así el rechazo posterior es significativo.
  if (actionId) {
    await forgedCreate(ctx, actionFields, adminCookie, "Grupo control admin");
    ctx.check("Control: la petición forjada con sesión de Administrador crea el grupo", (await ctx.prisma.clientGroup.count({ where: { name: "Grupo control admin" } })) === 1);
  }
  await adm.context.close();

  const rd = await login(ctx, ctx.accounts.readerEmail, ctx.accounts.readerPassword);
  ctx.check("Login real de Consulta", rd.ok && (await sessionToken(rd.context)) !== null);
  const B = `${ctx.base}/administracion/clientes`;
  await rd.page.goto(`${B}/grupos`);
  ctx.check("Consulta lee la lista de grupos", (await rd.page.getByText("Grupo E2E Alfa").count()) > 0);
  ctx.check("Consulta no ve el botón «Nuevo grupo»", (await rd.page.getByRole("link", { name: "Nuevo grupo" }).count()) === 0);
  await rd.page.goto(`${B}/grupos/nuevo`);
  ctx.check("Consulta no llega al formulario de alta (redirige a la lista)", new URL(rd.page.url()).pathname === "/administracion/clientes/grupos", rd.page.url());
  const g = await ctx.prisma.clientGroup.findFirstOrThrow({ where: { name: "Grupo E2E Alfa" } });
  await rd.page.goto(`${B}/grupos/${g.id}`);
  ctx.check("Consulta ve la ficha sin controles de edición ni historial", (await rd.page.locator('main input[name="expectedVersion"], main input[name^="$ACTION"]').count()) === 0 && (await rd.page.getByText(/Historial de cambios/i).count()) === 0);

  // Mutación forjada como Consulta: rechazada en servidor, sin datos ni auditoría nuevos.
  const groups = await ctx.prisma.clientGroup.count();
  const audits = await ctx.prisma.auditEvent.count();
  if (actionId) {
    const status = await forgedCreate(ctx, actionFields, await cookieHeader(rd.context, ctx.base), "Grupo forjado");
    ctx.check("Mutación forjada como Consulta: no crea el grupo", (await ctx.prisma.clientGroup.count({ where: { name: "Grupo forjado" } })) === 0, `estado ${status}`);
    ctx.check(
      "Mutación forjada como Consulta: no cambia el nº de grupos ni la auditoría",
      (await ctx.prisma.clientGroup.count()) === groups && (await ctx.prisma.auditEvent.count()) === audits,
    );
    await forgedCreate(ctx, actionFields, "", "Grupo forjado anónimo");
    ctx.check("Mutación forjada sin sesión: no crea nada", (await ctx.prisma.clientGroup.count({ where: { name: "Grupo forjado anónimo" } })) === 0);
  }

  // Cierre de sesión: elimina la sesión y la cookie vieja deja de valer.
  const token = await sessionToken(rd.context);
  await rd.page.goto(`${ctx.base}/`);
  await rd.page.getByRole("button", { name: "Cerrar sesión" }).click();
  await rd.page.waitForURL(/\/login/, { timeout: 10000 }).catch(() => undefined);
  ctx.check("Cerrar sesión lleva a /login", new URL(rd.page.url()).pathname === "/login");
  ctx.check("Cerrar sesión elimina la sesión en la base", (await ctx.prisma.session.count({ where: { user: { email: ctx.accounts.readerEmail } } })) === 0);
  if (token) {
    await rd.context.addCookies([{ name: "better-auth.session_token", value: token, url: ctx.base }]);
    await rd.page.goto(`${B}/grupos`);
    ctx.check("Reutilizar la cookie anterior tras cerrar sesión no da acceso", new URL(rd.page.url()).pathname === "/login", rd.page.url());
  }
  await rd.context.close();
}
