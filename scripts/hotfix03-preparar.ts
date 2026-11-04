import "dotenv/config";
import { prisma } from "../src/lib/db";
import { installInitialQualityProfile } from "../src/server/quality/initial-profile";

/** Prepara la configuración inicial de HOTFIX-03 (Calidad). Idempotente: ejecutarla dos veces no crea revisiones repetidas ni toca calibraciones manuales. */
async function main() {
  const r = await installInitialQualityProfile();
  console.log(`Calidad: ${r.status}${r.revisionNo ? ` (revisión ${r.revisionNo})` : ""}. ${r.detail}`);
}
main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message.split("\n")[0].replace(/postgres(ql)?:\/\/\S+/g, "(URL oculta)") : "Error desconocido.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
