import "dotenv/config";
import readline from "node:readline";
import { provisionAccount } from "../src/server/accounts";
import { prisma } from "../src/lib/db";

/**
 * Crea una cuenta local. No hay contraseñas predeterminadas ni alta automática.
 * La contraseña se pide sin eco o se toma de CSAPP_CUENTA_CLAVE (variable de la sesión
 * actual); nunca se acepta como argumento ni se imprime.
 * Si el correo ya existe no se modifica nada.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    if (!stdin.isTTY) {
      const rl = readline.createInterface({ input: stdin });
      rl.once("line", (l) => { rl.close(); resolve(l); });
      return;
    }
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\u0003") { process.stdout.write("\n"); process.exit(130); }
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const email = arg("correo") ?? (await ask("Correo electrónico: "));
  const name = arg("nombre") ?? (await ask("Nombre: "));
  const roleArg = (arg("rol") ?? (await ask("Rol (admin o consulta): "))).toLowerCase();
  if (!["admin", "consulta"].includes(roleArg)) throw new Error("El rol debe ser «admin» o «consulta».");
  const password = process.env.CSAPP_CUENTA_CLAVE ?? (await askHidden("Contraseña (mínimo 12 caracteres, no se muestra): "));
  const result = await provisionAccount({
    email,
    name,
    password,
    role: roleArg === "admin" ? "ADMIN" : "CONSULTA",
  });
  console.log(
    result.created
      ? `Cuenta creada: ${result.email} (${roleArg}).`
      : `La cuenta ${result.email} ya existe: no se ha modificado nada.`,
  );
}

main()
  .catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : "Error desconocido.";
    console.error(`No se ha creado la cuenta: ${msg.split("\n")[0]}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
