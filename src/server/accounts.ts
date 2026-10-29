import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { UserRole } from "@/generated/prisma/enums";

const accountSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Correo no válido.")),
  name: z.string().trim().min(1, "Indique un nombre.").max(120),
  password: z.string().min(12, "La contraseña debe tener 12 caracteres o más.").max(128),
  role: z.enum(["ADMIN", "CONSULTA"]),
});

/**
 * Alta de una cuenta local (no hay registro público). Es idempotente: si el correo ya
 * existe no se modifican su contraseña, su rol ni sus datos.
 */
export async function provisionAccount(input: {
  email: string;
  name: string;
  password: string;
  role: UserRole;
}): Promise<{ created: boolean; email: string }> {
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join(" "));
  const data = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email: data.email }, select: { id: true } });
  if (existing) return { created: false, email: data.email };
  const passwordHash = await hashPassword(data.password);
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: data.email, name: data.name, role: data.role, emailVerified: true },
    });
    // Better Auth exige que accountId de la cuenta de credenciales sea el ID del usuario.
    await tx.account.create({
      data: { userId: user.id, accountId: user.id, providerId: "credential", password: passwordHash },
    });
  });
  return { created: true, email: data.email };
}
