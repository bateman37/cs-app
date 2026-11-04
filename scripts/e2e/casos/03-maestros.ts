import type { Page } from "playwright";
import type { Ctx } from "../nucleo";
import { login } from "./util";

/** Pulsa «Guardar cambios», comprueba la confirmación y pulsa «Sí, guardar» (o «Cancelar»). Devuelve el texto del aviso. */
export async function saveFromTable(page: Page, action: "confirm" | "cancel" = "confirm"): Promise<string> {
  await page.getByRole("button", { name: /^Guardar cambios/ }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: "¿Estás seguro de que deseas guardar estos cambios?" }).waitFor({ timeout: 15000 });
  if (action === "cancel") {
    await dlg.getByRole("button", { name: "Cancelar" }).click();
    await dlg.waitFor({ state: "hidden" });
    return "";
  }
  await dlg.getByRole("button", { name: "Sí, guardar" }).click();
  const toast = page.locator(".ed-toast");
  await toast.waitFor({ timeout: 20000 });
  return (await toast.textContent()) ?? "";
}

/** HOTFIX-04: el alta ordinaria de Grupo y de Cliente es un borrador en la propia tabla, con revisión y confirmación (ya no hay formularios de alta). */
export async function maestros(ctx: Ctx): Promise<void> {
  const { context, page } = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);
  const B = `${ctx.base}/administracion/clientes`;

  await page.goto(B);
  await page.getByRole("button", { name: "Nuevo grupo" }).click();
  await page.getByLabel("Nuevo Grupo: nombre").fill("Grupo E2E Alfa");
  const t1 = await saveFromTable(page);
  const g = await ctx.prisma.clientGroup.findFirst({ where: { name: "Grupo E2E Alfa" } });
  ctx.check("El Administrador crea un Grupo Cliente desde la tabla (con confirmación)", Boolean(g) && /Guardado/.test(t1), t1);

  await page.goto(B);
  await page.getByRole("button", { name: "Nuevo grupo" }).click();
  await page.getByRole("button", { name: /^Guardar cambios/ }).click();
  await page.locator(".mt-err").first().waitFor({ timeout: 10000 }).catch(() => undefined);
  ctx.check("Un grupo sin nombre se rechaza junto al campo", (await page.locator(".mt-err").count()) > 0);

  await page.reload();
  await page.getByRole("button", { name: "Nuevo grupo" }).click();
  await page.getByLabel("Nuevo Grupo: nombre").fill("GRUPO e2e alfa");
  await page.getByRole("button", { name: /^Guardar cambios/ }).click();
  await page.locator(".mt-err").first().waitFor({ timeout: 10000 }).catch(() => undefined);
  ctx.check("Un nombre de grupo repetido (otra capitalización) se rechaza", (await ctx.prisma.clientGroup.count()) === 1);

  await page.goto(B);
  await page.getByRole("button", { name: "Añadir Cliente/proyecto" }).click();
  await page.getByLabel("Nuevo Cliente: Grupo").selectOption({ label: "Grupo E2E Alfa" });
  await page.getByLabel("Nuevo Cliente: nombre Zendesk").fill("Cliente E2E Uno");
  await saveFromTable(page);
  const c = await ctx.prisma.client.findFirst({ where: { name: "Cliente E2E Uno" } });
  ctx.check("El Administrador crea un Cliente asociado al grupo desde la tabla", Boolean(c) && c?.groupId === g?.id);

  await page.goto(`${B}/clientes`);
  ctx.check("La lista antigua de Clientes redirige al editor y muestra el Cliente", new URL(page.url()).pathname === "/administracion/clientes" && (await page.locator('input[value="Cliente E2E Uno"]').count()) > 0, page.url());
  const audits = await ctx.prisma.auditEvent.count({ where: { action: "CREATE", entityType: { in: ["ClientGroup", "Client"] } } });
  ctx.check("Las altas dejaron auditoría con autor", audits === 2, String(audits));
  await context.close();
}
