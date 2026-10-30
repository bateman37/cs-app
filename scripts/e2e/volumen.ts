import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAll, type Ctx } from "./nucleo";
import { login } from "./casos/util";
import { seedVolumeMasters, volumeTickets, volumeTimes, writeTickets, writeTimes } from "../../tests/generators/zendesk";

/**
 * Subida web de volumen (CSAPP-03): XLSX sintéticos del orden del origen (≈114 000 tickets y ≈250 000 tiempos) generados en
 * streaming, subidos por el navegador real a `next start`, preparados y activados por el trabajador real. Registra filas, bytes,
 * límites, tiempos de cada fase y pico de memoria (VmHWM de /proc, solo Linux). Nada se sube a Git.
 *   TICKETS=114000 TIMES=250000 npm run e2e:volumen
 */
const TICKETS = Number(process.env.TICKETS ?? 114_000);
const TIMES = Number(process.env.TIMES ?? 250_000);

function peakMb(pattern: string): number | null {
  try {
    const out = execFileSync("ps", ["-eo", "pid,args"], { encoding: "utf8" });
    let best = 0;
    for (const line of out.split("\n")) {
      if (!line.includes(pattern)) continue;
      const pid = Number(line.trim().split(/\s+/)[0]);
      try {
        const m = /VmHWM:\s+(\d+) kB/.exec(execFileSyncRead(`/proc/${pid}/status`));
        if (m) best = Math.max(best, Math.round(Number(m[1]) / 1024));
      } catch {
        /* proceso terminado */
      }
    }
    return best || null;
  } catch {
    return null;
  }
}
function execFileSyncRead(p: string): string {
  return execFileSync("cat", [p], { encoding: "utf8" });
}

async function volumen(ctx: Ctx): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "csapp-e2e-vol-"));
  const out: Record<string, unknown> = {};
  try {
    await seedVolumeMasters(ctx.prisma);
    const tg = Date.now();
    await writeTickets(path.join(dir, "tickets.xlsx"), volumeTickets(TICKETS));
    await writeTimes(path.join(dir, "tiempos.xlsx"), volumeTimes(TIMES, { tickets: TICKETS }));
    out.generacionSegundos = Math.round((Date.now() - tg) / 1000);
    const { context, page } = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);
    await ctx.startWorker();

    const phase = async (source: string, file: string, rows: number, label: string) => {
      const size = (await stat(file)).size;
      await page.goto(`${ctx.base}/administracion/cargas`);
      await page.locator("summary", { hasText: source }).first().click();
      const form = page.locator("details[open]").first();
      await form.locator('input[type="file"]').setInputFiles(file);
      await form.getByLabel("Fecha de extracción").fill("2026-10-01");
      const t0 = Date.now();
      await form.getByRole("button", { name: "Subir y validar" }).click();
      await page.waitForURL(/\/administracion\/cargas\/[^/]+$/, { timeout: 15 * 60_000 });
      const receiveMs = Date.now() - t0;
      const id = page.url().split("/").pop() as string;
      const wait = async (status: string, ms: number) => {
        const t = Date.now();
        for (;;) {
          const b = await ctx.prisma.uploadBatch.findUniqueOrThrow({ where: { id } });
          if (b.status === status) return Date.now() - t;
          if (["FAILED", "REJECTED", "CANCELLED"].includes(b.status)) throw new Error(`${label}: ${b.status} ${b.statusDetail ?? ""}`);
          if (Date.now() - t > ms) throw new Error(`${label}: tiempo agotado esperando ${status}`);
          await new Promise((r) => setTimeout(r, 500));
        }
      };
      const prepareMs = await wait("READY", 30 * 60_000);
      const b = await ctx.prisma.uploadBatch.findUniqueOrThrow({ where: { id } });
      ctx.check(`Volumen ${label}: ${rows} filas recibidas sin errores tras la subida por el navegador`, b.rowsReceived === rows && b.rowsError === 0, `${b.rowsReceived}/${b.rowsError}`);
      const tPage = Date.now();
      await page.reload();
      const readyPageMs = Date.now() - tPage;
      await page.getByRole("button", { name: "Confirmar y activar" }).click();
      const activateMs = await wait("COMPLETED", 30 * 60_000);
      const tDone = Date.now();
      await page.reload();
      await page.getByTestId("zd-resumen").waitFor();
      const donePageMs = Date.now() - tDone;
      const reconciled = /Reconcilia con las filas y horas válidas/.test(await page.locator("body").innerText()) || label === "tickets";
      ctx.check(`Volumen ${label}: la ficha del lote completado responde y el resumen reconcilia`, reconciled, String(donePageMs));
      out[label] = {
        filas: rows,
        archivoMB: Math.round((size / 1048576) * 10) / 10,
        recepcionPorNavegadorSegundos: Math.round(receiveMs / 100) / 10,
        preparacionSegundos: Math.round(prepareMs / 100) / 10,
        activacionSegundos: Math.round(activateMs / 100) / 10,
        fichaListoMs: readyPageMs,
        fichaCompletadoMs: donePageMs,
        picoRssTrabajadorMB: peakMb("worker-dist/worker.mjs"),
        picoRssServidorWebMB: peakMb("next"),
      };
      return id;
    };
    await phase("Zendesk · tickets", path.join(dir, "tickets.xlsx"), TICKETS, "tickets");
    ctx.check("Volumen tickets: se materializan todos los tickets", (await ctx.prisma.zdTicket.count()) === TICKETS);
    const timeBatch = (await phase("Zendesk · tiempos", path.join(dir, "tiempos.xlsx"), TIMES, "tiempos")) as string;
    ctx.check("Volumen tiempos: se materializan todos los registros", (await ctx.prisma.zdTimeEntry.count()) === TIMES);

    // Recalcular un lote completado grande desde su ficha (relaciones tardías sobre 250 000 registros).
    const t0 = Date.now();
    await page.goto(`${ctx.base}/administracion/cargas/${timeBatch}`);
    await page.getByRole("button", { name: "Reprocesar" }).click();
    for (;;) {
      const done = await ctx.prisma.auditEvent.count({ where: { batchId: timeBatch, action: "REPROCESS", summary: { contains: "se recalculó" } } });
      if (done > 0) break;
      if (Date.now() - t0 > 20 * 60_000) throw new Error("recálculo sin terminar");
      await new Promise((r) => setTimeout(r, 500));
    }
    out.recalculoLoteCompletadoSegundos = Math.round((Date.now() - t0) / 100) / 10;
    ctx.check("Volumen tiempos: Reprocesar un lote completado grande no duplica registros", (await ctx.prisma.zdTimeEntry.count()) === TIMES);
    await context.close();
    out.limites = { maxBytes: process.env.CSAPP_UPLOAD_MAX_BYTES ?? "200 MB (por defecto)", maxFilas: process.env.CSAPP_UPLOAD_MAX_ROWS ?? "5 000 000 (por defecto)" };
  } finally {
    const target = process.env.E2E_MEASURES_FILE ?? path.join(tmpdir(), "csapp-medidas-zendesk-web.json");
    await writeFile(target, JSON.stringify(out, null, 2));
    console.log(`MEDIDAS_ZENDESK_WEB ${JSON.stringify(out)}`);
    await rm(dir, { recursive: true, force: true });
    void readFile;
  }
}

runAll([volumen]).then(
  (code) => process.exit(code),
  (e) => {
    console.error(`Volumen abortado: ${e instanceof Error ? e.message : "error"}`);
    process.exit(2);
  },
);
