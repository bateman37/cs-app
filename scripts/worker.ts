import "dotenv/config";
import { getEnv } from "../src/lib/env";
import { prisma } from "../src/lib/db";
import { uploadConfig } from "../src/server/uploads/config";
import { runWorkerLoop } from "../src/server/uploads/worker";

/**
 * Trabajador de cargas: proceso separado de la web que consume la cola de PostgreSQL.
 * Lee el mismo .env que la web. Se detiene con Ctrl+C (SIGINT/SIGTERM): termina el bloque en curso,
 * devuelve el trabajo a la cola conservando el checkpoint y sale.
 */
async function main() {
  getEnv(); // valida la configuración sin mostrar valores
  const cfg = uploadConfig();
  const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
  log(`Almacén privado: ${cfg.dir}`);
  const controller = new AbortController();
  const stop = () => {
    log("Señal de parada recibida: finalizando de forma ordenada…");
    controller.abort();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await runWorkerLoop({ signal: controller.signal, log });
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error("El trabajador terminó con error:", e instanceof Error ? e.message.split("\n")[0] : "desconocido");
  process.exitCode = 1;
});
