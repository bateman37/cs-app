import { describe, expect, it } from "vitest";
import { reapOwnWorkers, spawnWorker } from "./cargas-helpers";

/** Demuestra que un fallo forzado tras lanzar un trabajador real lo limpia y que la prueba siguiente puede continuar. */
describe("limpieza de trabajadores hijos", () => {
  let leaked: number | undefined;
  it("un fallo forzado a mitad de prueba deja un hijo vivo…", async () => {
    const w = spawnWorker({ CSAPP_WORKER_POLL_MS: "200" });
    leaked = w.pid;
    expect(w.exitCode).toBeNull();
    await expect(Promise.reject(new Error("fallo forzado antes del bloque final"))).rejects.toThrow("fallo forzado");
    // sin cierre propio: queda para la limpieza centralizada
  });
  it("…y la limpieza centralizada lo termina (solo los suyos) y permite continuar", async () => {
    const alive = () => { try { process.kill(leaked as number, 0); return true; } catch { return false; } };
    expect(alive()).toBe(true);
    const n = await reapOwnWorkers(2000);
    expect(n).toBe(1);
    expect(alive()).toBe(false);
  });
});
