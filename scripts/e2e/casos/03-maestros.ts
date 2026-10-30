import type { Ctx } from "../nucleo";
import { login } from "./util";

export async function maestros(ctx: Ctx): Promise<void> {
  const { context, page } = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);
  const B = `${ctx.base}/administracion/clientes`;

  await page.goto(`${B}/grupos/nuevo`);
  await page.getByLabel("Nombre canónico").fill("Grupo E2E Alfa");
  await page.getByRole("button", { name: "Crear grupo" }).click();
  await page.waitForURL(/\/grupos\/[^/]+\?creado=1/, { timeout: 10000 }).catch(() => undefined);
  const g = await ctx.prisma.clientGroup.findFirst({ where: { name: "Grupo E2E Alfa" } });
  ctx.check("El Administrador crea un Grupo Cliente desde la web", Boolean(g));

  await page.goto(`${B}/grupos/nuevo`);
  await page.getByRole("button", { name: "Crear grupo" }).click();
  await page.waitForSelector(".notice-error", { timeout: 10000 }).catch(() => undefined);
  ctx.check("Un grupo sin nombre se rechaza con mensaje", (await page.locator(".notice-error").count()) > 0);

  await page.goto(`${B}/grupos/nuevo`);
  await page.getByLabel("Nombre canónico").fill("GRUPO e2e alfa");
  await page.getByRole("button", { name: "Crear grupo" }).click();
  await page.waitForSelector(".notice-error", { timeout: 10000 }).catch(() => undefined);
  ctx.check("Un nombre de grupo repetido (otra capitalización) se rechaza", (await ctx.prisma.clientGroup.count()) === 1);

  await page.goto(`${B}/clientes/nuevo`);
  await page.getByLabel("Nombre").first().fill("Cliente E2E Uno");
  const select = page.getByLabel(/Grupo/).first();
  if (g && (await select.count())) await select.selectOption(g.id).catch(() => undefined);
  await page.getByRole("button", { name: /Crear cliente/ }).click();
  await page.waitForURL(/\/clientes\/[^/]+\?creado=1/, { timeout: 10000 }).catch(() => undefined);
  const c = await ctx.prisma.client.findFirst({ where: { name: "Cliente E2E Uno" } });
  ctx.check("El Administrador crea un Cliente asociado al grupo", Boolean(c) && c?.groupId === g?.id);

  await page.goto(`${B}/clientes`);
  ctx.check("El Cliente aparece en la lista", (await page.getByText("Cliente E2E Uno").count()) > 0);
  const audits = await ctx.prisma.auditEvent.count({ where: { action: "CREATE", entityType: { in: ["ClientGroup", "Client"] } } });
  ctx.check("Las altas dejaron auditoría con autor", audits === 2, String(audits));
  await context.close();
}
