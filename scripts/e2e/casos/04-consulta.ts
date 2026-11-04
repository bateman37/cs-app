import type { BrowserContext } from "playwright";
import type { Ctx } from "../nucleo";
import { login, sessionToken } from "./util";
import { saveFromTable } from "./03-maestros";

/** Cabecera Cookie de un contexto para peticiones directas. */
async function cookieHeader(context: BrowserContext, base: string): Promise<string> {
  return (await context.cookies(base)).map((c) => `${c.name}=${c.value}`).join("; ");
}

type Captured = { id: string; type: string; body: string };

/** Reproduce una Server Action REAL (capturada del navegador del Administrador) con otra cookie y un destino distinto: la petición forjada de Consulta o anónima. */
async function replay(ctx: Ctx, cap: Captured, cookie: string, name: string): Promise<number> {
  const body = cap.body
    .replace(/"operationId":"[^"]+"/, `"operationId":"forjado-${Math.random().toString(36).slice(2)}-${Date.now()}"`)
    .replace(/,"digest":"[^"]*"/, "")
    .replace(/"name":"[^"]*"/, `"name":"${name}"`);
  const r = await fetch(`${ctx.base}/administracion/clientes`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: ctx.base, "Next-Action": cap.id, "Content-Type": cap.type, Accept: "text/x-component" },
    body,
    redirect: "manual",
  });
  return r.status;
}

export async function consulta(ctx: Ctx): Promise<void> {
  // La Server Action de guardado se captura de una alta real del Administrador (HOTFIX-04): su ID es el de producción.
  const adm = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);
  const captured: Captured[] = [];
  adm.page.on("request", (r) => {
    const id = r.headers()["next-action"];
    if (r.method() === "POST" && id) captured.push({ id, type: r.headers()["content-type"] ?? "text/plain;charset=UTF-8", body: r.postData() ?? "" });
  });
  await adm.page.goto(`${ctx.base}/administracion/clientes`);
  await adm.page.getByRole("button", { name: "Nuevo grupo" }).click();
  await adm.page.getByLabel("Nuevo Grupo: nombre").fill("Grupo control admin");
  await saveFromTable(adm.page);
  const save = captured[captured.length - 1];
  ctx.check("Se captura la Server Action de guardado real desde la página del Administrador", Boolean(save) && captured.length >= 2, String(captured.length));
  const adminCookie = await cookieHeader(adm.context, ctx.base);

  // Control positivo: con la cookie del Administrador la misma petición sí guarda; así el rechazo posterior es significativo.
  if (save) {
    await replay(ctx, save, adminCookie, "Grupo control admin 2");
    ctx.check("Control: la petición forjada con sesión de Administrador guarda el grupo", (await ctx.prisma.clientGroup.count({ where: { name: "Grupo control admin 2" } })) === 1);
  }
  await adm.context.close();

  const rd = await login(ctx, ctx.accounts.readerEmail, ctx.accounts.readerPassword);
  ctx.check("Login real de Consulta", rd.ok && (await sessionToken(rd.context)) !== null);
  const B = `${ctx.base}/administracion/clientes`;
  await rd.page.goto(`${B}/grupos`);
  ctx.check("Consulta: la lista antigua de grupos redirige al editor de solo lectura y ve los datos", new URL(rd.page.url()).pathname === "/administracion/clientes" && (await rd.page.locator('input[value="Grupo E2E Alfa"]').count()) > 0, rd.page.url());
  ctx.check("Consulta no ve botones de guardado ni de alta", (await rd.page.getByRole("button", { name: /Guardar cambios|Nuevo grupo|Añadir Cliente/ }).count()) === 0);
  ctx.check("Consulta no tiene celdas editables", (await rd.page.locator(".ed-input:not([disabled])").count()) === 0);
  await rd.page.goto(`${B}/grupos/nuevo`);
  ctx.check("Consulta que abre el alta antigua llega a la tabla sin borrador ni formulario", new URL(rd.page.url()).pathname === "/administracion/clientes" && (await rd.page.getByLabel("Nuevo Grupo: nombre").count()) === 0, rd.page.url());
  const g = await ctx.prisma.clientGroup.findFirstOrThrow({ where: { name: "Grupo E2E Alfa" } });
  await rd.page.goto(`${B}/grupos/${g.id}`);
  ctx.check("Consulta ve la ficha sin controles de edición ni historial", (await rd.page.locator('main input[name="expectedVersion"], main input[name^="$ACTION"]').count()) === 0 && (await rd.page.getByText(/Historial de cambios/i).count()) === 0);

  // Mutación forjada como Consulta: rechazada en servidor, sin datos ni auditoría nuevos.
  const groups = await ctx.prisma.clientGroup.count();
  const audits = await ctx.prisma.auditEvent.count();
  if (save) {
    const status = await replay(ctx, save, await cookieHeader(rd.context, ctx.base), "Grupo forjado");
    ctx.check("Mutación forjada como Consulta: no crea el grupo", (await ctx.prisma.clientGroup.count({ where: { name: "Grupo forjado" } })) === 0, `estado ${status}`);
    ctx.check("Mutación forjada como Consulta: no cambia el nº de grupos ni la auditoría", (await ctx.prisma.clientGroup.count()) === groups && (await ctx.prisma.auditEvent.count()) === audits);
    await replay(ctx, save, "", "Grupo forjado anónimo");
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
