/** Comprobación de arranque de la web compilada (CSAPP-10 §3): rechaza configuraciones operativas peligrosas antes de atender peticiones. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertStartup } = await import("@/server/ops/startup");
  await assertStartup("web", (level, m) => console.log(`${new Date().toISOString()} ${level} web ${m}`));
}
