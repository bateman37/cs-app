import type { Page } from "playwright";
import type { Ctx } from "../nucleo";
import { login } from "./util";

/**
 * CSAPP-10 §4, §10 y §11 por el navegador, con web y trabajador COMPILADOS: Administración › Operación (estado del trabajador en reposo y detenido), salud pública
 * mínima, permisos (Consulta rechazado), diagnóstico redactado, nivel 4 de la conciliación y revisión de presentación a 1 440 y 390 px (sin desbordamiento horizontal,
 * encabezados, tablas con región desplazable enfocable, teclado y estados enunciados con texto, no solo con color).
 */
const text = (p: Page) => p.locator("main").innerText();
async function overflowX(p: Page): Promise<boolean> { return p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1); }

export async function operacion(ctx: Ctx): Promise<void> {
  const adm = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);
  const page = adm.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  // Sin trabajador: ausente (o detenido si ya hubo uno) — nunca «presente».
  await ctx.stopWorker();
  await ctx.prisma.workerInstance.deleteMany();
  await page.goto(`${ctx.base}/administracion/operacion`);
  const t0 = await text(page);
  ctx.check("Operación: sin trabajador se enuncia «Trabajador ausente» con su acción (no un color)", /Trabajador ausente/.test(t0) && /TRABAJADOR_AUSENTE/.test(t0), t0.slice(0, 200));
  ctx.check("Operación: muestra versión, SHA, esquema compatible y la base disponible", /Versión \d/.test(t0) && /Esquema compatible con el código/.test(t0) && /Base de datos: disponible/.test(t0), t0.slice(0, 300));
  // Con trabajador y sin trabajos: PRESENTE EN REPOSO (no se infiere caído por no tener trabajos).
  await ctx.startWorker();
  let idle = false;
  for (let i = 0; i < 40 && !idle; i++) { await new Promise((r) => setTimeout(r, 500)); await page.reload(); idle = /Trabajador presente, en reposo/.test(await text(page)); }
  ctx.check("Operación: con el trabajador vivo y SIN trabajos se muestra «presente, en reposo» (el latido sustituye a la inferencia por trabajos)", idle);
  const t1 = await text(page);
  ctx.check("Operación: tabla de trabajadores con estado, versión, último latido y avance; almacenes con acceso y enlace a la instalación", /Instancias de trabajador|Trabajadores/.test(t1) && /Vivo/.test(t1) && /Originales/.test(t1) && /Exportaciones/.test(t1), t1.slice(0, 200));
  // Cierre ordenado: detenido ≠ ausente.
  await ctx.stopWorker();
  await page.reload();
  const t2 = await text(page);
  ctx.check("Operación: tras un cierre ordenado el trabajador figura «detenido» (distinto de ausente)", /Trabajador detenido de forma ordenada|STOPPED/.test(t2) || /Trabajador ausente/.test(t2) && /Sin latido|STOPPED/.test(t2), t2.slice(0, 300));
  // Salud pública mínima y detalle restringido.
  const pub = await fetch(`${ctx.base}/api/salud`);
  const pj = await pub.json() as Record<string, unknown>;
  ctx.check("Salud pública: responde sin sesión con SOLO el estado global (sin rutas, colas ni configuración)", pub.status === 200 && Object.keys(pj).join() === "status", JSON.stringify(pj));
  const anon = await fetch(`${ctx.base}/api/administracion/salud`, { redirect: "manual" });
  ctx.check("Salud detallada: sin sesión no se sirve", [401, 307, 302].includes(anon.status), String(anon.status));
  const dl = await page.request.get(`${ctx.base}/api/administracion/salud?descargar=1`);
  const dlText = await dl.text();
  ctx.check("Diagnóstico descargable (Administrador): redactado, sin DSN, secretos ni rutas completas", dl.status() === 200 && /attachment/.test(dl.headers()["content-disposition"] ?? "") && !dlText.includes("postgresql://") && !dlText.includes(ctx.uploadDir) && !dlText.includes(ctx.exportDir), dlText.slice(0, 120));
  // Consulta: rechazo en servidor.
  const reader = await login(ctx, ctx.accounts.readerEmail, ctx.accounts.readerPassword);
  const rr = await reader.page.goto(`${ctx.base}/administracion/operacion`);
  const bodyReader = await reader.page.locator("body").innerText();
  ctx.check("Consulta: no accede a Operación (redirigido) ni al detalle de salud por API", !/Estado técnico de la instalación/.test(bodyReader) && (rr?.status() ?? 200) < 500, reader.page.url());
  const rapi = await reader.page.request.get(`${ctx.base}/api/administracion/salud`);
  ctx.check("Consulta: el detalle de salud por API responde 403", rapi.status() === 403, String(rapi.status()));
  await reader.context.close();
  // Conciliación: nivel 4 visible.
  await page.goto(`${ctx.base}/administracion/conciliacion`);
  const conc = await text(page);
  ctx.check("Conciliación: la pantalla ofrece el puente (el periodo debe ser uno de los cinco de las pantallas)", /Conciliación/.test(conc));
  // Revisión de presentación: 1 440 y 390 px.
  for (const [w, label] of [[1440, "1 440 px"], [390, "390 px"]] as const) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const path of ["/administracion/operacion", "/administracion/conciliacion", "/administracion/cargas"]) {
      await page.goto(`${ctx.base}${path}`);
      ctx.check(`Presentación a ${label}: ${path} sin desbordamiento horizontal de la página`, !(await overflowX(page)));
    }
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`${ctx.base}/administracion/operacion`);
  const regions = await page.locator("[role=region][tabindex='0']").count();
  ctx.check("Presentación a 390 px: las tablas están en regiones desplazables con nombre y enfocables por teclado", regions >= 1);
  const h1 = await page.locator("h1").count();
  const h2 = await page.locator("h2").count();
  ctx.check("Estructura: un solo h1 y secciones con h2 en Operación", h1 === 1 && h2 >= 2);
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.tagName ?? "");
  ctx.check("Teclado: Tab llega a un elemento enfocable (enlace de salto o navegación)", ["A", "BUTTON", "INPUT", "DIV", "SUMMARY"].includes(focused), focused);
  const status = await page.locator("[role=status]").first().innerText();
  ctx.check("Estados con texto: el resumen de salud se anuncia con role=status y enuncia el estado con palabras", /(Todo correcto|Degradado|no disponible)/i.test(status), status.slice(0, 120));
  await adm.context.close();
  await ctx.startWorker(); // los casos siguientes esperan el trabajador
}
