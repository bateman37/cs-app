import type { Ctx } from "../nucleo";

/** 5 intentos por minuto y origen. Va el último: agota el cupo de acceso. */
export async function limite(ctx: Ctx): Promise<void> {
  await ctx.prisma.rateLimit.deleteMany();
  const statuses: number[] = [];
  for (let i = 0; i < 8; i++) {
    const r = await fetch(`${ctx.base}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ctx.base },
      body: JSON.stringify({ email: ctx.accounts.adminEmail, password: `incorrecta-${i}-xxxxxxxx` }),
    });
    statuses.push(r.status);
  }
  ctx.check("Los intentos de acceso fallidos se limitan (llega un 429)", statuses.includes(429) && statuses.slice(0, 5).every((s) => s === 401), statuses.join(","));
  const r = await fetch(`${ctx.base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ctx.base },
    body: JSON.stringify({ email: ctx.accounts.adminEmail, password: ctx.accounts.adminPassword }),
  });
  ctx.check("Bloqueado el origen, ni la contraseña correcta entra durante la ventana", r.status === 429, String(r.status));
}
