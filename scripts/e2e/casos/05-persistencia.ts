import type { Ctx } from "../nucleo";
import { login } from "./util";

/** Los datos y la sesión (guardada en la base) sobreviven a reiniciar el servidor web. */
export async function persistencia(ctx: Ctx): Promise<void> {
  const { context, page } = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);
  const groupsBefore = await ctx.prisma.clientGroup.count();
  await ctx.restartServer();
  await page.goto(`${ctx.base}/administracion/clientes/grupos`);
  ctx.check("Tras reiniciar el servidor, la sesión sigue válida (sesiones en base de datos)", new URL(page.url()).pathname === "/administracion/clientes/grupos", page.url());
  ctx.check("Tras reiniciar, los datos creados siguen visibles", (await page.getByText("Grupo E2E Alfa").count()) > 0 && (await ctx.prisma.clientGroup.count()) === groupsBefore);
  await context.close();
}
