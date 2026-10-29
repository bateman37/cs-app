import type { Ctx } from "../nucleo";
import { login } from "./util";
import { todayMadrid } from "../../../src/domain/vigencia";

/** Personal y matriz de usuarios contratados desde la interfaz real (CSAPP-02). */
export async function personalUsuarios(ctx: Ctx): Promise<void> {
  const year = Number(todayMadrid().slice(0, 4));
  const { context, page } = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);

  // --- Personal
  await page.goto(`${ctx.base}/administracion/personal/nuevo`);
  await page.getByLabel("Nombre canónico").fill("Persona E2E Uno");
  await page.getByRole("button", { name: "Crear persona" }).click();
  await page.waitForURL(/\/administracion\/personal\/[^/]+/, { timeout: 10000 }).catch(() => undefined);
  const p = await ctx.prisma.person.findFirst({ where: { name: "Persona E2E Uno" } });
  ctx.check("El Administrador crea una persona del maestro PERSONAL", Boolean(p));
  await page.goto(`${ctx.base}/administracion/personal/nuevo`);
  await page.getByLabel("Nombre canónico").fill("persona e2e uno");
  await page.getByRole("button", { name: "Crear persona" }).click();
  await page.waitForSelector(".notice-error", { timeout: 10000 }).catch(() => undefined);
  ctx.check("Un nombre canónico repetido (otra capitalización) se rechaza", (await ctx.prisma.person.count()) === 1);
  ctx.check("Crear una persona no crea cuentas de acceso", (await ctx.prisma.user.count({ where: { name: "Persona E2E Uno" } })) === 0);

  // --- Matriz de usuarios (maestros de apoyo sintéticos en la base de test)
  const group = await ctx.prisma.clientGroup.create({ data: { name: "Grupo Usuarios E2E" } });
  const client = await ctx.prisma.client.create({ data: { name: "Cliente Usuarios E2E", groupId: group.id } });
  const base = `${ctx.base}/administracion/usuarios`;
  await page.goto(`${base}/cliente/${client.id}?anio=2025`);
  await page.getByLabel("Usuarios contratados").fill("65");
  await page.getByRole("button", { name: "Ver vista previa" }).click();
  await page.getByRole("button", { name: "Confirmar inicialización" }).click();
  await page.waitForSelector(".notice-ok, h1", { timeout: 10000 }).catch(() => undefined);
  const m25 = await ctx.prisma.userMatrix.findFirst({ where: { clientId: client.id, year: 2025 }, include: { months: true } });
  ctx.check("Inicializar 2025 crea doce valores iguales y bloqueados", m25?.months.length === 12 && m25.months.every((x) => x.value === 65 && x.isLocked));
  ctx.check("El histórico de grupo no se copia al Cliente (el grupo sigue sin matriz)", (await ctx.prisma.userMatrix.count({ where: { groupId: group.id } })) === 0);

  await page.goto(`${base}/cliente/${client.id}?anio=${year}`);
  await page.getByRole("link", { name: /Copiar base de/ }).click();
  await page.getByRole("button", { name: "Confirmar copia" }).click();
  await page.waitForTimeout(800);
  await page.goto(`${base}/cliente/${client.id}?anio=${year}`);
  await page.locator("#mes-2").selectOption("6");
  await page.locator("#valor-2").fill("68");
  await page.getByRole("button", { name: "Ver vista previa" }).nth(1).click();
  ctx.check("«Aplicar desde este mes» muestra la vista previa antes de guardar", (await page.getByRole("heading", { name: /Revisar cambio/ }).count()) > 0);
  await page.getByRole("button", { name: /Confirmar y guardar/ }).click();
  await page.waitForTimeout(800);
  const cur = await ctx.prisma.userMatrix.findFirst({ where: { clientId: client.id, year }, include: { months: { orderBy: { month: "asc" } } } });
  const v = (cur?.months ?? []).map((x) => x.value).join(",");
  ctx.check("65 hasta mayo y 68 desde junio conserva los meses anteriores", v === "65,65,65,65,65,68,68,68,68,68,68,68", v);

  // Año histórico: sin formularios de edición y rechazo directo.
  await page.goto(`${base}/cliente/${client.id}?anio=2025`);
  ctx.check("Un año anterior es solo consulta (sin formulario de edición)", (await page.getByRole("heading", { name: "Editar un mes" }).count()) === 0);
  await context.close();

  // --- Consulta: lectura sin formularios
  const ro = await login(ctx, ctx.accounts.readerEmail, ctx.accounts.readerPassword);
  await ro.page.goto(`${base}/cliente/${client.id}?anio=${year}`);
  ctx.check("Consulta ve la matriz", (await ro.page.getByText("Matriz").count()) > 0);
  ctx.check("Consulta no ve formularios de edición", (await ro.page.getByRole("heading", { name: "Editar un mes" }).count()) === 0);
  await ro.page.goto(`${ctx.base}/administracion/personal/nuevo`);
  ctx.check("Consulta no puede abrir el alta de personal", (await ro.page.getByRole("button", { name: "Crear persona" }).count()) === 0);
  await ro.context.close();
}
