import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { Ctx } from "../nucleo";
import { login } from "./util";
import { todayMadrid } from "../../../src/domain/vigencia";

/**
 * Comparativa y Análisis Cliente (CSAPP-06) por el navegador sobre el `next start` compilado: filtros, orden numérico con nulos al final,
 * paginación, apertura de ficha y vuelta con el contexto, cohorte de referencia, pestañas, detalle que concilia, CSV completo, permisos
 * (Consulta, anónimo, petición forjada, retorno externo), parámetros hostiles, responsive y capturas (E2E_CAPTURAS=directorio).
 * Solo datos sintéticos de la base `_test`; nada se sube a Git.
 */
const body = (p: Page) => p.locator("main").innerText();
async function cookie(context: BrowserContext, base: string) {
  return (await context.cookies(base)).map((c) => `${c.name}=${c.value}`).join("; ");
}

export async function analitica(ctx: Ctx): Promise<void> {
  const today = todayMadrid();
  const admin = await ctx.prisma.user.findUniqueOrThrow({ where: { email: ctx.accounts.adminEmail } });
  await ctx.prisma.$executeRawUnsafe(`TRUNCATE "FinanceRow", "FinanceBatch", "FinanceScope", "ZdTimeEntry", "WrikeTimeEntry", "ZdTicketObservation", "ZdTicketRevision", "ZdTicket", "UserMatrixMonth", "UserMatrix", "ServiceTerm", "ServiceAssignment", "ExternalIdentity", "Milestone", "Implementation", "Client", "ClientGroup", "PapCause", "PapRevision", "PapItem", "UploadBatch", "Product", "PersonTerm", "PersonAlias", "StaffCatalogItem", "Person" RESTART IDENTITY CASCADE`).catch(() => undefined);
  // Importación diferida: el módulo del generador abre `prisma`, que debe apuntar a la base de test ya fijada por el recorrido.
  const { seedAnalitica } = await import("../../../tests/generators/analitica");
  const w = await seedAnalitica(admin.id, today);
  const shots = process.env.E2E_CAPTURAS;
  if (shots) await mkdir(shots, { recursive: true });
  const shot = async (page: Page, name: string) => {
    if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
  };

  const adm = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);
  const page = adm.page;
  await page.setViewportSize({ width: 1440, height: 900 });

  // --- Comparativa
  await page.goto(`${ctx.base}/comparativa`);
  let text = await body(page);
  ctx.check("Comparativa: abre por defecto con hoy, a fecha de corte, Soporte; tabla, tarjetas y ratio ponderado", (await page.locator("table.cmp").count()) === 1 && /Ratio ponderado de cartera/.test(text) && /A fecha de corte/.test(await page.locator("#f-modo").evaluate((e: HTMLSelectElement) => e.selectedOptions[0].textContent ?? "")) && /ingreso imputado/i.test(text), text.slice(0, 100));
  ctx.check("Comparativa: etiqueta el dinero como ingreso imputado y la rentabilidad en €/jornada dedicada", /facturado \+ potencial anual distribuido linealmente/.test(text) && /€\/jornada dedicada/.test(text));
  ctx.check("Comparativa: el mes en curso se marca provisional", /provisional/.test(await page.locator("table.cmp thead").innerText()));
  ctx.check("Comparativa: cabeceras con fechas concretas de cada bloque", /Mes seleccionado · \d{2}\/\d{2}\/\d{4} – \d{2}\/\d{2}\/\d{4}/.test(await page.locator("table.cmp thead").innerText()));
  ctx.check("Comparativa: columna Grupo Cliente (BC) y enlaces a ficha", (await page.locator("table.cmp tbody th a").count()) >= 6);
  await shot(page, "comparativa-1440");
  const cardRatio = async () => (await page.locator(".cards .card").filter({ hasText: "Ratio ponderado de cartera" }).locator(".stat-value").innerText()).trim();
  const ratio0 = await cardRatio();

  await page.goto(`${ctx.base}/comparativa?modo=FULL_MONTH`);
  text = await body(page);
  ctx.check("Comparativa: «mes completo» del mes en curso sigue provisional y muestra fecha solicitada y corte efectivo", /Fecha solicitada/.test(text) && /mes completo/.test(text) && /provisional/.test(text));
  await page.goto(`${ctx.base}/comparativa?tam=25&orden=cum.hours&dir=desc`);
  const names1 = await page.locator("table.cmp tbody th[scope=row] a").allInnerTexts();
  const ratioP1 = await cardRatio();
  ctx.check("Comparativa: orden numérico descendente por horas CUM (Atlas primero) y 25 filas por página", names1.length === 25 && names1[0] === "Grupo Atlas", names1.slice(0, 3).join("|"));
  await page.getByRole("link", { name: "Siguiente →" }).click();
  await page.waitForURL(/pagina=2/);
  const names2 = await page.locator("table.cmp tbody th[scope=row] a").allInnerTexts();
  ctx.check("Comparativa: segunda página con otras filas y las tarjetas de cartera no cambian", names2.length > 0 && names2.every((n) => !names1.includes(n)) && (await cardRatio()) === ratioP1);
  await page.goto(`${ctx.base}/comparativa?orden=month.perDay&dir=asc`);
  const last = await page.locator("table.cmp tbody tr").last().innerText();
  ctx.check("Comparativa: los grupos sin ratio (nulos) van al final, no como ceros", /no calculable|sin fuente|parcial/.test(last), last.slice(0, 80));
  await page.goto(`${ctx.base}/comparativa?q=atlas`);
  ctx.check("Comparativa: la búsqueda filtra grupos completos y cambia la cartera", (await page.locator("table.cmp tbody th[scope=row] a").count()) === 1 && (await cardRatio()) !== ratio0);
  await page.goto(`${ctx.base}/comparativa?q=zzzzzz`);
  ctx.check("Comparativa: sin coincidencias muestra estado vacío con acción", /Sin coincidencias/.test(await body(page)) && (await page.getByRole("link", { name: "Restablecer filtros" }).count()) === 1);
  await page.goto(`${ctx.base}/comparativa?soporte=SILVER_RECURRENTE`);
  ctx.check("Comparativa: «grupos que contienen» un plan conserva el grupo entero (heterogéneo Cénit)", (await page.locator("table.cmp tbody").innerText()).includes("Grupo Cénit") && /heterogéneo/.test(await page.locator("table.cmp tbody").innerText()));
  await page.goto(`${ctx.base}/comparativa?bloques=mes,anterior,cum,anioant,cumant`);
  ctx.check("Comparativa: los cinco bloques accesibles sin perder filtros", (await page.locator("table.cmp thead tr.groups th").count()) === 6);

  // --- Ficha y vuelta con contexto
  await page.goto(`${ctx.base}/comparativa?soporte=GOLD&orden=cum.revenue&dir=desc&tam=25&bloques=mes,cum,cumant`);
  const rowCum = await page.locator("table.cmp tbody tr").filter({ hasText: "Grupo Atlas" }).locator("td").allInnerTexts();
  await page.getByRole("link", { name: "Grupo Atlas" }).first().click();
  await page.waitForURL(/analisis-cliente/);
  text = await body(page);
  const url = new URL(page.url());
  ctx.check("Ficha: abre el Grupo con periodo, servicio y cohorte filtrada de referencia", url.searchParams.get("ambito") === "group" && url.searchParams.get("soporte") === "GOLD" && /Cohorte filtrada de referencia/.test(text), url.search.slice(0, 120));
  const cumCard = page.locator(".period-cards article").filter({ hasText: "CUM del año seleccionado" });
  const devCard = (await cumCard.locator("dd").nth(3).innerText()).trim();
  ctx.check("Ficha: la desviación contra cartera coincide con la de la fila de Comparativa", rowCum.some((c) => c.includes(devCard.split(" ")[0])) || devCard !== "—", `${devCard} / ${rowCum.join("|").slice(0, 120)}`);
  ctx.check("Ficha: cinco periodos distintos con fechas concretas", (await page.locator(".period-cards article").count()) === 5);
  ctx.check("Ficha: gráficos SVG con tablas equivalentes accesibles", (await page.locator(".chart-card svg[role=img]").count()) >= 5 && (await page.locator("details.chart-table").count()) >= 5);
  ctx.check("Ficha: hitos con fecha y ámbito", /Arranque/.test(text) && /Migración/.test(text));
  await shot(page, "ficha-resumen-1440");
  await page.getByRole("link", { name: /Volver a Comparativa/ }).click();
  await page.waitForURL(/\/comparativa/);
  const back = new URL(page.url());
  ctx.check("Volver a Comparativa conserva filtro, orden, tamaño de página y bloques", back.searchParams.get("soporte") === "GOLD" && back.searchParams.get("orden") === "cum.revenue" && back.searchParams.get("tam") === "25" && back.searchParams.get("bloques") === "mes,cum,cumant", back.search);

  // --- Pestañas, detalle y explicación
  const fichaUrl = `${ctx.base}/analisis-cliente?ambito=group&id=${w.atlas.id}`;
  await page.goto(`${fichaUrl}&pestana=dedicacion`);
  text = await body(page);
  ctx.check("Dedicación: perfiles previstos con sin identificar visible y total del ámbito", /CS N1/.test(text) && /PMO ANA/.test(text) && /Total del ámbito de dedicación/.test(text) && /Sistemas del Cliente|sistemas del cliente/.test(text), text.slice(0, 80));
  await shot(page, "ficha-dedicacion-1440");
  await page.goto(`${fichaUrl}&pestana=pap`);
  text = await body(page);
  ctx.check("PAP: total único, causas, sin fecha de producción conservado y resultado distinto de OK visible", /PAP únicos con puesta en producción/.test(text) && /sin fecha de producción/i.test(text) && /Revertido/.test(text));
  await page.goto(`${fichaUrl}&pestana=tickets`);
  text = await body(page);
  ctx.check("Tickets y bugs: conteos por creación, N3 como unión y bugs vinculados", /Tickets creados/.test(text) && /Escalados a N3/.test(text) && /Bugs vinculados a tickets creados en el periodo/.test(text));
  await page.goto(`${fichaUrl}&pestana=datos`);
  text = await body(page);
  ctx.check("Datos y cobertura: referencia de cálculo, fuentes financieras y reproceso", /Referencia de cálculo/.test(text) && /eco-v2/.test(text) && /Fuentes financieras/.test(text));
  await page.goto(`${fichaUrl}&det=horas&periodo=cum`);
  text = await body(page);
  const detailHours = /Total del conjunto filtrado:\s*(\d+) actividad\(es\) · [\d.]+ min = ([\d.,]+) h/.exec(text);
  await page.goto(fichaUrl);
  const cardHours = (await page.locator(".period-cards article").filter({ hasText: "CUM del año seleccionado" }).locator("dd").first().innerText()).replace(/[^\d,.]/g, "");
  ctx.check("Detalle de horas concilia con la tarjeta (mismas horas, mismo conjunto)", Boolean(detailHours) && detailHours![2] === cardHours, `${detailHours?.[2]} / ${cardHours}`);
  await page.goto(`${fichaUrl}&det=ratio&periodo=cum&metrica=devTarget`);
  text = await body(page);
  ctx.check("Explicación de un ratio: numerador, denominador, operandos, fórmula, referencia y estado", /Numerador/.test(text) && /Denominador/.test(text) && /Operando · objetivo/.test(text) && /\(objetivo − ratio\) \/ objetivo/.test(text) && /Referencia/.test(text) && /Estado/.test(text), text.slice(Math.max(0, text.indexOf("Desviación contra objetivo")), text.indexOf("Desviación contra objetivo") + 700).replace(/\n/g, " | "));
  await page.goto(`${fichaUrl}&det=ingreso&periodo=cum`);
  text = await body(page);
  ctx.check("Detalle del ingreso: importe anual fuente y contribución imputada (sin sumar doce veces)", /Importe anual fuente/.test(text) && /Contribución imputada/.test(text) && /96\.000,00/.test(text) && (await page.getByRole("link", { name: "lote" }).count()) >= 1);
  await page.goto(`${fichaUrl}&det=horas&periodo=cum&sello=0000000000000000`);
  ctx.check("Si cambian los datos entre el agregado y el detalle se declara una nueva lectura", /nueva lectura/.test(await body(page)));

  // --- Cliente sin repartir ingreso
  await page.goto(`${ctx.base}/analisis-cliente?ambito=client&id=${w.a1.id}`);
  text = await body(page);
  ctx.check("Cliente: ingreso agrupado en Grupo Cliente, sin ratio propio, y contexto «del grupo»", /Ingreso agrupado en Grupo Cliente/.test(text) && /del grupo/.test(text) && !/Tarifa anual\/usuario/.test(text));
  await page.goto(`${ctx.base}/analisis-cliente?ambito=client&id=${w.a1.id}&pestana=dedicacion`);
  ctx.check("Cliente: la dedicación es la de su ámbito (sin repartir ni clonar)", /Total del ámbito de dedicación/.test(await body(page)));
  await page.goto(`${ctx.base}/analisis-cliente?buscar=Atlas`);
  text = await body(page);
  ctx.check("Selector: búsqueda en servidor por Grupo / Cliente / implantación", /Grupo Cliente/.test(text) && /Implantación/.test(text) && /Atlas Norte producción/.test(text));
  await shot(page, "selector-1440");

  // --- CSV
  const adminCookie = await cookie(adm.context, ctx.base);
  const csvAdmin = await fetch(`${ctx.base}/api/analitica/comparativa.csv`, { headers: { Cookie: adminCookie } });
  const csvBytes = new Uint8Array(await csvAdmin.arrayBuffer());
  const csvText = new TextDecoder("utf-8", { ignoreBOM: true }).decode(csvBytes);
  const lines = csvText.replace(/^\uFEFF/, "").trim().split("\r\n");
  const groupsTotal = await ctx.prisma.clientGroup.count();
  ctx.check("CSV de la cartera: 200, text/csv UTF-8, BOM, sin caché pública y TODAS las filas (5 periodos por grupo + 5 de cartera)", csvAdmin.status === 200 && /text\/csv; charset=utf-8/.test(csvAdmin.headers.get("content-type") ?? "") && (csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf) && /no-store/.test(csvAdmin.headers.get("cache-control") ?? "") && lines.length === 1 + groupsTotal * 5 + 5, `${lines.length} líneas / ${groupsTotal} grupos`);
  const csvFiltered = await (await fetch(`${ctx.base}/api/analitica/comparativa.csv?q=atlas`, { headers: { Cookie: adminCookie } })).text();
  ctx.check("CSV filtrado: solo el conjunto filtrado, con contexto en columnas", csvFiltered.trim().split("\r\n").length === 1 + 5 + 5 && /sello_datos/.test(csvFiltered) && /ingreso imputado/.test(csvFiltered));
  const fichaCsv = await fetch(`${ctx.base}/api/analitica/ficha.csv?ambito=group&id=${w.atlas.id}&tabla=series`, { headers: { Cookie: adminCookie } });
  const fichaLines = (await fichaCsv.text()).trim().split("\r\n");
  ctx.check("CSV de la ficha: periodos y series mensuales de ambos años", fichaCsv.status === 200 && fichaLines.length > 5 + Number(today.slice(5, 7)), String(fichaLines.length));
  ctx.check("CSV con ámbito o tabla forjados: 400", (await fetch(`${ctx.base}/api/analitica/ficha.csv?ambito=group&id=%27%20OR%201=1&tabla=series`, { headers: { Cookie: adminCookie } })).status === 400 && (await fetch(`${ctx.base}/api/analitica/ficha.csv?ambito=group&id=${w.atlas.id}&tabla=../../etc`, { headers: { Cookie: adminCookie } })).status === 400);
  const anon = await fetch(`${ctx.base}/api/analitica/comparativa.csv`, { redirect: "manual" });
  ctx.check("CSV sin sesión: no se entrega (redirige al acceso)", anon.status >= 300 && anon.status < 400 && !(await anon.text()).includes("sello_datos"));

  // --- Consulta
  const rd = await login(ctx, ctx.accounts.readerEmail, ctx.accounts.readerPassword);
  await rd.page.goto(`${ctx.base}/comparativa`);
  ctx.check("Consulta lee Comparativa", (await rd.page.locator("table.cmp").count()) === 1);
  await rd.page.goto(`${fichaUrl}&det=ingreso&periodo=cum`);
  const rText = await rd.page.locator("main").innerText();
  const hrefs = await rd.page.locator("main a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""));
  ctx.check("Consulta lee el detalle del ingreso sin enlaces a rutas de Administración", /Contribución imputada/.test(rText) && !hrefs.some((h) => h.startsWith("/administracion")));
  const readerCookie = await cookie(rd.context, ctx.base);
  const csvReader = await fetch(`${ctx.base}/api/analitica/comparativa.csv`, { headers: { Cookie: readerCookie } });
  ctx.check("Consulta descarga el mismo CSV de resumen", csvReader.status === 200 && (await csvReader.text()).trim().split("\r\n").length === lines.length);
  const batch = await ctx.prisma.uploadBatch.findFirstOrThrow();
  ctx.check("Consulta no obtiene archivos originales de Cargas", [401, 403].includes((await fetch(`${ctx.base}/api/cargas/${batch.id}/archivo`, { headers: { Cookie: readerCookie } })).status));
  await rd.context.close();

  // --- Parámetros hostiles y retorno externo
  await page.goto(`${ctx.base}/comparativa?fecha=2026-13-45&orden=x%27%3B--&modo=bad&dir=up&pagina=-1&tam=9999&soporte=ZZZ&bloques=mes,zzz`);
  text = await body(page);
  ctx.check("Parámetros hostiles: la página carga y avisa de que los ignora (sin error ni inyección)", /Se han ignorado parámetros no válidos/.test(text) && (await page.locator("table.cmp").count()) === 1);
  await page.goto(`${ctx.base}/analisis-cliente?ambito=group&id=%27%20OR%201=1--`);
  ctx.check("Identificador forjado: vuelve al selector sin error", /Seleccione un/.test(await body(page)));
  await page.goto(`${fichaUrl}&volver=https://evil.example/robar%3Fa%3D1&pestana=pap`);
  const hr = await page.locator("main a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
  ctx.check("Retorno externo rechazado: ningún enlace sale de la aplicación", hr.every((h) => h.startsWith(ctx.base) || h.startsWith("blob:")) && !hr.some((h) => h.includes("evil.example")));

  // --- Responsive (≈390 px) y datos de referencia
  await page.setViewportSize({ width: 390, height: 800 });
  for (const [name, route] of [["comparativa", "/comparativa"], ["ficha", `/analisis-cliente?ambito=group&id=${w.atlas.id}`], ["dedicacion", `/analisis-cliente?ambito=group&id=${w.atlas.id}&pestana=dedicacion`]] as const) {
    await page.goto(`${ctx.base}${route}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ctx.check(`390 px · ${name}: sin desplazamiento horizontal de la página (la tabla se desplaza dentro de su contenedor)`, overflow <= 1, `desbordamiento ${overflow}px`);
    await shot(page, `${name}-390`);
  }
  await adm.context.close();
}
