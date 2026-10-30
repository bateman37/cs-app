import type { BrowserContext, Page } from "playwright";
import type { Ctx } from "../nucleo";

export async function login(ctx: Ctx, email: string, password: string): Promise<{ context: BrowserContext; page: Page; ok: boolean }> {
  // Cupo de acceso (5/min y origen): solo el caso «límite de intentos» lo agota a propósito.
  await ctx.prisma.rateLimit.deleteMany();
  const context = await ctx.browser.newContext();
  const page = await context.newPage();
  await page.goto(`${ctx.base}/login`);
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  let ok = true;
  try {
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 10000 });
  } catch {
    ok = false;
  }
  return { context, page, ok };
}

export async function sessionToken(context: BrowserContext): Promise<string | null> {
  const cookies = await context.cookies();
  return cookies.find((c) => c.name.endsWith("session_token"))?.value ?? null;
}

export async function newContext(ctx: Ctx) {
  const context = await ctx.browser.newContext();
  return { context, page: await context.newPage() };
}
