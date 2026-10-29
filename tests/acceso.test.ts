import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { provisionAccount } from "@/server/accounts";
import { counts, makeUsers, resetDatabase } from "./helpers";
import { verifyPassword } from "better-auth/crypto";

beforeEach(async () => {
  await resetDatabase();
});

const signIn = (email: string, password: string) =>
  auth.api.signInEmail({ body: { email, password }, headers: new Headers(), asResponse: true });

function cookieOf(res: Response): string {
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

describe("Acceso local", () => {
  it("inicia sesión, la sesión es válida y al cerrar sesión se invalida para siempre", async () => {
    await makeUsers();
    const res = await signIn("admin@test.local", "clave-de-prueba-123");
    expect(res.status).toBe(200);
    const cookie = cookieOf(res);
    expect(cookie).toContain("better-auth.session_token");

    const headers = new Headers({ cookie });
    expect((await auth.api.getSession({ headers }))?.user.email).toBe("admin@test.local");

    await auth.api.signOut({ headers });
    expect(await auth.api.getSession({ headers })).toBeNull(); // la cookie antigua ya no sirve
    expect(await prisma.session.count()).toBe(0);
  });

  it("rechaza contraseñas incorrectas y cuentas desactivadas, sin crear sesión", async () => {
    const { admin } = await makeUsers();
    expect((await signIn("admin@test.local", "otra-clave-de-prueba")).status).toBe(401);
    await prisma.user.update({ where: { id: admin.id }, data: { isActive: false } });
    expect((await signIn("admin@test.local", "clave-de-prueba-123")).status).toBeGreaterThanOrEqual(400);
    expect(await prisma.session.count()).toBe(0);
  });

  it("no hay registro público", async () => {
    const res = await auth.api.signUpEmail({
      body: { email: "nuevo@test.local", name: "Nuevo", password: "clave-larga-123456" },
      headers: new Headers(),
      asResponse: true,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it("guarda la contraseña con hash, no en claro", async () => {
    await makeUsers();
    const acc = await prisma.account.findFirstOrThrow({ where: { user: { email: "admin@test.local" } } });
    expect(acc.password).not.toContain("clave-de-prueba-123");
    expect(await verifyPassword({ hash: acc.password as string, password: "clave-de-prueba-123" })).toBe(true);
  });
});

describe("Instalación repetida", () => {
  it("volver a crear una cuenta existente no modifica contraseña, rol ni datos, ni duplica", async () => {
    await provisionAccount({ email: "admin@test.local", name: "Admin", password: "clave-de-prueba-123", role: "ADMIN" });
    const before = await prisma.account.findFirstOrThrow();
    const again = await provisionAccount({ email: "ADMIN@test.local", name: "Otro Nombre", password: "una-clave-distinta-9", role: "CONSULTA" });
    expect(again.created).toBe(false);
    const after = await prisma.account.findFirstOrThrow();
    expect(after.password).toBe(before.password);
    const user = await prisma.user.findFirstOrThrow();
    expect(user.role).toBe("ADMIN");
    expect(user.name).toBe("Admin");
    expect(await prisma.user.count()).toBe(1);
  });

  it("no precarga maestros: tras provisionar cuentas no hay ningún dato de clientes", async () => {
    await makeUsers();
    const c = await counts();
    expect(c).toEqual({ groups: 0, clients: 0, impls: 0, identities: 0, terms: 0, milestones: 0, audits: 0 });
  });

  it("exige contraseñas de 12 caracteres o más", async () => {
    await expect(provisionAccount({ email: "a@test.local", name: "A", password: "corta", role: "ADMIN" })).rejects.toThrow();
  });
});
