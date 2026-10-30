import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page } from "playwright";
import type { Ctx } from "../nucleo";
import { login } from "./util";

const HEADER = "id,nombre,fecha,importe,categoria";
const GOOD = [HEADER, "ID1,Uno,2026-03-15,10.50,alfa", "ID2,Dos,2026-03-16,20,beta", "ID3,Tres,2026-03-17,30.25,alfa", "ID1,Uno,2026-03-15,10.50,alfa", "ID4,Cuatro,no-es-fecha,5,alfa", "ID5,Cinco,2026-03-18,7,SIN-RELACION"].join("\n") + "\n";

async function waitStatus(page: Page, text: string, ms = 40000): Promise<boolean> {
  try {
    await page.locator('[data-testid="estado-lote"]').getByText(text, { exact: false }).waitFor({ timeout: ms });
    return true;
  } catch {
    return false;
  }
}

/** Administración › Cargas con el motor real: web `next start` + trabajador construido + perfil sintético en base de test. */
export async function cargas(ctx: Ctx): Promise<void> {
  const B = `${ctx.base}/administracion/cargas`;
  const good = path.join(tmpdir(), `csapp-e2e-${process.pid}-bueno.csv`);
  const bad = path.join(tmpdir(), `csapp-e2e-${process.pid}-malo.csv`);
  await writeFile(good, GOOD);
  await writeFile(bad, "a,b,c\n1,2,3\n");

  // --- Consulta: sin acceso (interfaz y API), sin efectos.
  const reader = await login(ctx, ctx.accounts.readerEmail, ctx.accounts.readerPassword);
  await reader.page.goto(B);
  ctx.check("Cargas: Consulta no llega a la pantalla (redirigida)", !reader.page.url().includes("/administracion/cargas"));
  await reader.page.goto(`${ctx.base}/administracion/clientes/grupos`);
  ctx.check("Cargas: la pestaña no se ofrece a Consulta", (await reader.page.getByRole("link", { name: "Cargas", exact: true }).count()) === 0);
  const origin = new URL(ctx.base).origin;
  const r1 = await reader.context.request.post(`${ctx.base}/api/cargas`, {
    headers: { origin, "content-type": "application/octet-stream", "x-csapp-perfil": "sintetico-incorporar", "x-csapp-nombre": "x.csv" },
    data: Buffer.from(GOOD),
  });
  ctx.check("Cargas: la subida forjada como Consulta se rechaza (403) y no crea lote", r1.status() === 403 && (await ctx.prisma.uploadBatch.count()) === 0, String(r1.status()));
  await reader.context.close();

  // --- Administrador: fuentes e historial vacío.
  const { context, page } = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);
  await page.goto(B);
  ctx.check("Cargas: el Administrador ve la fuente sintética de pruebas y las operativas (ya no quedan fuentes pendientes tras CSAPP-05)", (await page.getByText("Sintético · incorporar y revisar").count()) > 0 && (await page.getByText("Zendesk · tickets").count()) > 0 && (await page.getByText("Facturación · soporte").count()) > 0 && (await page.getByText("No disponible · pendiente").count()) === 0);
  ctx.check("Cargas: historial vacío con mensaje claro", (await page.getByText("Todavía no se ha realizado ninguna carga").count()) > 0);

  // --- Subida real por la interfaz, sin trabajador: queda en cola.
  const upload = async (file: string) => {
    await page.goto(B);
    const card = page.locator("details", { hasText: "Sintético · incorporar y revisar" }).first();
    await card.locator("summary").click();
    await card.locator('input[type="file"]').setInputFiles(file);
    await card.getByRole("button", { name: "Subir y validar" }).click();
    await page.waitForURL(/\/administracion\/cargas\/[^/]+$/, { timeout: 20000 });
  };
  await upload(good);
  const batch1 = await ctx.prisma.uploadBatch.findFirst({ orderBy: { createdAt: "asc" } });
  ctx.check("Cargas: la subida por la interfaz crea el lote y abre su ficha", Boolean(batch1) && page.url().endsWith(batch1?.id ?? "?"));
  ctx.check("Cargas: sin trabajador el lote queda «En cola» (no se procesa en la petición)", await waitStatus(page, "En cola", 5000));
  ctx.check("Cargas: confirmar está deshabilitado con motivo mientras no hay preparación", (await page.getByRole("button", { name: "Confirmar y activar" }).isDisabled()) && (await page.getByText("Solo se puede confirmar un lote listo para revisar").count()) > 0);

  // --- Trabajador real: la ficha avanza sola por sondeo.
  await ctx.startWorker();
  ctx.check("Cargas: el sondeo muestra «Listo para revisar» sin recargar la página", await waitStatus(page, "Listo para revisar"));
  const text = await page.locator("body").innerText();
  ctx.check("Cargas: contadores correctos (6 recibidas, 1 con error, 5 válidas, 1 duplicada, 1 excluida)", /Recibidas\s+6/.test(text) && /Con error\s+1/.test(text) && /Válidas\s+5/.test(text) && /Duplicadas\s+1/.test(text) && /Excluidas\s+1/.test(text), text.slice(text.indexOf("Resumen de filas"), text.indexOf("Resumen de filas") + 300));
  ctx.check("Cargas: la ficha enseña checksum, extracción y definiciones, e importadas sin valor antes de activar", /Checksum SHA-256/.test(text) && /Filas materializadas en los datos activos/.test(text) && /Importadas\s+—/.test(text));
  ctx.check("Cargas: previsualización con incidencias por código (FECHA_INVALIDA)", (await page.getByText("FECHA_INVALIDA").count()) > 0 && (await page.getByText("ID5").count()) > 0, (await page.locator("body").innerText()).slice(-900));
  await page.getByLabel("Clasificación").selectOption("ERROR");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await page.waitForLoadState("networkidle");
  ctx.check("Cargas: el filtro de clasificación limita la previsualización a las filas con error", (await page.getByText("no-es-fecha").count()) > 0 && (await page.getByText("Dos").count()) === 0, (await page.locator("body").innerText()).slice(-900));
  ctx.check("Cargas: antes de confirmar no hay datos activos", Number((await ctx.prisma.$queryRawUnsafe<{ n: bigint }[]>("SELECT count(*) n FROM csapp_synthetic.record"))[0].n) === 0);
  ctx.check("Cargas: cancelar está permitido y revertir deshabilitado con motivo", (await page.getByRole("button", { name: "Cancelar" }).isEnabled()) && (await page.getByRole("button", { name: "Revertir" }).isDisabled()));

  // --- Confirmar y activar.
  await page.getByRole("button", { name: "Confirmar y activar" }).click();
  ctx.check("Cargas: tras confirmar el lote termina «Completado» activado por el trabajador", await waitStatus(page, "Completado"));
  const active = Number((await ctx.prisma.$queryRawUnsafe<{ n: bigint }[]>("SELECT count(*) n FROM csapp_synthetic.record"))[0].n);
  const done = await ctx.prisma.uploadBatch.findUnique({ where: { id: batch1?.id ?? "" } });
  ctx.check("Cargas: se activan 3 registros (duplicada, error y excluida quedan fuera) y «importadas» = 3", active === 3 && done?.rowsImported === 3, `${active}/${done?.rowsImported}`);
  // El sondeo actualiza la fase antes de que termine el refresco de la ficha: se espera a que las acciones reflejen el estado.
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent === "Revertir" && !b.disabled), null, { timeout: 15000 }).catch(() => undefined);
  ctx.check("Cargas: la ficha de un lote completado ya no admite cancelar (con motivo) y sí revertir", (await page.getByRole("button", { name: "Cancelar" }).isDisabled()) && (await page.getByRole("button", { name: "Revertir" }).isEnabled()), `${await page.getByRole("button", { name: "Cancelar" }).isDisabled()}/${await page.getByRole("button", { name: "Revertir" }).isEnabled()}`);
  ctx.check("Cargas: el historial de la ficha registra carga, confirmación y activación con autor", (await page.getByText("Confirmación").count()) > 0 && (await page.getByText("Activación").count()) > 0 && (await page.getByText(ctx.accounts.adminEmail).count()) > 0);

  // --- Mismo archivo otra vez: aviso de checksum, sin duplicar registros activos.
  await upload(good);
  ctx.check("Cargas: subir el mismo archivo avisa del checksum repetido", (await page.getByText("mismo checksum").count()) > 0);
  ctx.check("Cargas: el segundo lote llega a «Listo para revisar»", await waitStatus(page, "Listo para revisar"));
  await page.getByRole("button", { name: "Confirmar y activar" }).click();
  ctx.check("Cargas: el segundo lote se completa", await waitStatus(page, "Completado"));
  const active2 = Number((await ctx.prisma.$queryRawUnsafe<{ n: bigint }[]>("SELECT count(*) n FROM csapp_synthetic.record"))[0].n);
  ctx.check("Cargas: repetir la carga no duplica los registros activos (siguen 3)", active2 === 3, String(active2));

  // --- Archivo equivocado: rechazado con motivo.
  await upload(bad);
  ctx.check("Cargas: un archivo con cabeceras equivocadas queda «Rechazado» con el motivo", (await waitStatus(page, "Rechazado")) && (await page.getByText("cabeceras").count()) > 0);
  ctx.check("Cargas: un lote rechazado no deja datos activos nuevos", Number((await ctx.prisma.$queryRawUnsafe<{ n: bigint }[]>("SELECT count(*) n FROM csapp_synthetic.record"))[0].n) === 3);

  // --- Historial.
  await page.goto(B);
  ctx.check("Cargas: el historial lista los tres lotes con estado y autor", (await page.locator("tbody tr").count()) === 3 && (await page.getByText(ctx.accounts.adminEmail).count()) >= 3);
  await page.goto(`${B}?estado=REJECTED`);
  ctx.check("Cargas: el filtro por estado funciona", (await page.locator("tbody tr").count()) === 1);
  await ctx.stopWorker();
  await context.close();
}
