import type { Ctx } from "../nucleo";

/** Provisión de cuentas compatible con Better Auth: cubre el defecto de accountId corregido en CSAPP-01. */
export async function cuentas(ctx: Ctx): Promise<void> {
  for (const email of [ctx.accounts.adminEmail, ctx.accounts.readerEmail]) {
    const user = await ctx.prisma.user.findUnique({ where: { email }, include: { accounts: true } });
    const acc = user?.accounts[0];
    ctx.check(
      `Cuenta ${email}: una cuenta de credenciales con accountId igual al ID del usuario`,
      Boolean(user && acc && user.accounts.length === 1 && acc.providerId === "credential" && acc.accountId === user.id && acc.password),
    );
  }
}
