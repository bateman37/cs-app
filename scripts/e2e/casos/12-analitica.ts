import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { Ctx } from "../nucleo";
import { login } from "./util";
import { todayMadrid } from "../../../src/domain/vigencia";
import { guardedTruncate, resolveTestTarget } from "../../../src/lib/test-guard";

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
  await guardedTruncate(ctx.prisma, resolveTestTarget(), ["FinanceRow", "FinanceBatch", "FinanceScope", "ZdTimeEntry", "WrikeTimeEntry", "ZdTicketObservation", "ZdTicketRevision", "ZdTicket", "UserMatrixMonth", "UserMatrix", "ServiceTerm", "ServiceAssignment", "ExternalIdentity", "Milestone", "Implementation", "Client", "ClientGroup", "PapCause", "PapRevision", "PapItem", "UploadBatch", "Product", "PersonTerm", "PersonAlias", "StaffCatalogItem", "Person"]);
  // Con la base vaciada, la revisión 1 de la configuración económica se repone antes de abrir pantallas en paralelo (la migración la crea en una instalación real).
  await (await import("../../../src/server/economics/settings")).ensureInitialSettings(ctx.prisma);
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

  // --- Comparativa (HOTFIX-02 §6–7): tabla densa de una línea por Grupo, dos filtros de negocio, periodo compacto
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`${ctx.base}/comparativa`);
  let text = await body(page);
  const groupsTotal0 = await ctx.prisma.clientGroup.count();
  ctx.check("Comparativa: abre por defecto con una tabla densa y los seis bloques (Identificación + cinco periodos), objetivo vigente y «Provisional»", (await page.locator("table.cmp2").count()) === 1 && (await page.locator("table.cmp2 thead tr.groups th").count()) === 6 && /Objetivo \d+/.test(text) && /Provisional/.test(text) && /Rentabilidad agregada: mes/.test(text), text.slice(0, 120));
  const head = await page.locator("table.cmp2 thead").innerText();
  ctx.check("Comparativa: bloques con los nombres de §7 y fechas concretas", ["Identificación", "Mes seleccionado", "Mes anterior", "Año actual CUM", "Año anterior completo", "CUM anterior comparable"].every((b) => head.includes(b)) && /\d{2}\/\d{2}\/\d{4} – \d{2}\/\d{2}\/\d{4}/.test(head) && /Usuarios al corte/.test(head) && /Tarifa anual/.test(head) && /Desv\. media filtrada/.test(head));
  ctx.check("Comparativa: una fila de una línea por Grupo y nombre enlazado a Análisis Cliente", (await page.locator("table.cmp2 tbody tr").count()) === groupsTotal0 && (await page.locator("table.cmp2 tbody th a").count()) === groupsTotal0 && (await page.locator("table.cmp2 tbody tr").evaluateAll((rs) => rs.every((r) => r.getBoundingClientRect().height <= 30))));
  const geo = async () => page.evaluate(() => { const c = document.querySelector(".cmp2-scroll") as HTMLElement; return { sw: c.scrollWidth, cw: c.clientWidth, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, main: getComputedStyle(document.querySelector("main") as HTMLElement).maxWidth }; });
  const g1920 = await geo();
  ctx.check("Comparativa 1920×1080: la tabla compacta con TODOS los bloques cabe sin scroll horizontal (contenedor ni documento) y el padre «main» no limita el ancho", g1920.sw <= g1920.cw && g1920.doc <= 0 && g1920.main === "none", JSON.stringify(g1920));
  await shot(page, "comparativa-1920");
  await page.setViewportSize({ width: 1536, height: 864 });
  const g1536 = await geo();
  ctx.check("Comparativa 1536×864: sin scroll horizontal del documento (la tabla se desplaza dentro de su contenedor, accesible por teclado)", g1536.doc <= 0 && (await page.locator(".cmp2-scroll").getAttribute("tabindex")) === "0", JSON.stringify(g1536));
  await shot(page, "comparativa-1536");
  await page.setViewportSize({ width: 1920, height: 1080 });
  text = await body(page);
  ctx.check("Comparativa: sin información técnica en la vista (método, sello, revisión de configuración, cobertura, introducciones) ni filtros retirados", !/Método de ingreso|Referencia de datos|Revisión de configuración|Cobertura|Referencia de cálculo|Buscar grupo|Servicio económico|Complejidad|Filas por página|Bloques/.test(text) && (await page.locator("main select[name=tam], main input[name=q], main select[name=revision]").count()) === 0);
  ctx.check("Comparativa: exactamente dos filtros de negocio (Soporte y Servidor) como segmentadores multiselección", (await page.locator(".chips-group").count()) === 2 && (await page.locator(".chips-group").nth(0).locator(".chip").count()) === 4 && (await page.locator(".chips-group").nth(1).locator(".chip").count()) === 2);
  ctx.check("Comparativa: valores no disponibles como «—» con motivo al clic (sin párrafos en la celda) y un único «Datos pendientes» hacia el diagnóstico", (await page.locator("table.cmp2 details.nd").count()) > 0 && (await page.getByRole("link", { name: "Datos pendientes" }).count()) === 1 && /conciliacion#diagnostico/.test((await page.getByRole("link", { name: "Datos pendientes" }).getAttribute("href")) ?? ""));
  const nd = page.locator("table.cmp2 tbody details.nd").first();
  await nd.locator("summary").click();
  ctx.check("Comparativa: la explicación del «—» se abre al clic", await nd.locator(".nd-pop").isVisible());
  await nd.locator("summary").click();
  const sticky = await page.locator("table.cmp2 thead th").first().evaluate((e) => getComputedStyle(e).position);
  ctx.check("Comparativa: cabeceras y primera columna fijas", sticky === "sticky" && (await page.locator("table.cmp2 tbody th.sticky-col").first().evaluate((e) => getComputedStyle(e).position)) === "sticky");
  await page.goto(`${ctx.base}/comparativa?orden=cum.hours&dir=desc`);
  const names1 = await page.locator("table.cmp2 tbody th[scope=row] a").allInnerTexts();
  ctx.check("Comparativa: orden numérico descendente por horas CUM desde la cabecera (Atlas primero)", names1[0] === "Grupo Atlas", names1.slice(0, 3).join("|"));
  await page.goto(`${ctx.base}/comparativa?orden=month.perDay&dir=asc`);
  const last = await page.locator("table.cmp2 tbody tr").last().innerText();
  ctx.check("Comparativa: los grupos sin ratio (nulos) van al final, no como ceros", /—/.test(last), last.slice(0, 80));
  const footTotal = await page.locator("table.cmp2 tfoot th").innerText();
  ctx.check("Comparativa: totales al pie de TODO el filtrado", new RegExp(`Total filtrado \\(${groupsTotal0} grupos\\)`).test(footTotal), footTotal);
  // Segmentadores: clic selecciona y deselecciona; AND dentro del mismo Cliente; OR dentro del mismo filtro
  await page.goto(`${ctx.base}/comparativa`);
  await page.locator(".chips-group").nth(0).getByText("Gold", { exact: true }).click();
  await page.waitForURL(/soporte=GOLD/);
  const goldNames = await page.locator("table.cmp2 tbody th[scope=row] a").allInnerTexts();
  ctx.check("Comparativa: un clic selecciona Gold (sin Ctrl) y el Grupo incluido conserva todas sus cifras; Cénit (Gold en un Cliente) entra con valor «Mixto»", goldNames.includes("Grupo Atlas") && goldNames.includes("Grupo Cénit") && !goldNames.includes("Grupo Boreal") && /Mixto/.test(await page.locator("table.cmp2 tbody tr").filter({ hasText: "Grupo Cénit" }).innerText()), goldNames.join("|"));
  await page.locator(".chips-group").nth(0).getByText("Gold", { exact: true }).click();
  await page.waitForFunction(() => !location.search.includes("soporte"));
  ctx.check("Comparativa: otro clic deselecciona y vuelve a todos los Grupos", (await page.locator("table.cmp2 tbody tr").count()) === groupsTotal0);
  await page.goto(`${ctx.base}/comparativa?soporte=SILVER_RECURRENTE&servidor=CLOUD`);
  ctx.check("Comparativa: Silver Recurrente + CLOUD exige el MISMO Cliente (Cénit tiene Silver Recurrente en un Cliente y CLOUD en otro): sin coincidencias", /Sin coincidencias/.test(await body(page)));
  await page.goto(`${ctx.base}/comparativa?soporte=SILVER_RECURRENTE`);
  const silver = await page.locator("table.cmp2 tbody th[scope=row] a").allInnerTexts();
  await page.goto(`${ctx.base}/comparativa?servidor=CLOUD`);
  const cloud = await page.locator("table.cmp2 tbody th[scope=row] a").allInnerTexts();
  ctx.check("Comparativa: cada filtro por separado sí incluye a Cénit", silver.includes("Grupo Cénit") && cloud.includes("Grupo Cénit"));
  // Parámetros antiguos: se ignoran y NO se propagan en enlaces
  await page.goto(`${ctx.base}/comparativa?q=zzzzzz&estado=inactivos&producto=VFS&complejidad=BASIC&cobertura=parcial&servicio=OTROS&revision=1&tam=25&bloques=mes&ref=cum&alojamiento=OP`);
  const hrefs0 = await page.locator("main a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""));
  ctx.check("Comparativa: los parámetros antiguos de la URL no filtran en secreto ni se propagan en ningún enlace", (await page.locator("table.cmp2 tbody tr").count()) === groupsTotal0 && !hrefs0.some((h) => /[?&](q|estado|producto|complejidad|cobertura|servicio|revision|tam|bloques|ref|alojamiento)=/.test(h)), hrefs0.filter((h) => /[?&]q=/.test(h)).slice(0, 1).join());
  await page.goto(`${ctx.base}/comparativa?fecha=2026-13-45&orden=x%27%3B--&modo=bad&dir=up&pagina=-1&soporte=ZZZ`);
  ctx.check("Comparativa: valores hostiles se sustituyen por los iniciales sin error", (await page.locator("table.cmp2").count()) === 1);
  // Barra de periodo
  await page.goto(`${ctx.base}/comparativa`);
  await page.getByRole("link", { name: "Mes completo" }).click();
  await page.waitForURL(/modo=FULL_MONTH/);
  ctx.check("Comparativa: la barra de periodo cambia a «Mes completo» y sigue marcando Provisional", /Provisional/.test(await body(page)));
  await page.getByRole("link", { name: "Último mes cerrado" }).click();
  await page.waitForURL(/fecha=/);
  ctx.check("Comparativa: «Último mes cerrado» abre el mes anterior completo y cerrado (sin Provisional)", !/Provisional/.test(await body(page)));
  await page.goto(`${ctx.base}/comparativa?soporte=GOLD`);
  await page.getByRole("link", { name: "Mes completo" }).click();
  await page.waitForURL(/modo=FULL_MONTH/);
  ctx.check("Comparativa: cambiar el periodo conserva Soporte/Servidor", /soporte=GOLD/.test(page.url()));
  // Diagnóstico de datos en Administración
  await page.goto(`${ctx.base}/comparativa`);
  await page.getByRole("link", { name: "Datos pendientes" }).click();
  await page.waitForURL(/administracion\/conciliacion/);
  ctx.check("Administración › Conciliación incluye «Diagnóstico de datos» con método, revisión de configuración, referencia y cobertura financiera", /Diagnóstico de datos/.test(await body(page)) && /Método de ingreso/.test(await body(page)) && /Referencia de datos/.test(await body(page)) && /Fuentes financieras/.test(await body(page)));
  await page.goto(`${ctx.base}/comparativa?modo=FULL_MONTH`);

  // --- Ficha y vuelta con contexto
  await page.goto(`${ctx.base}/comparativa?soporte=GOLD&orden=cum.revenue&dir=desc`);
  await page.getByRole("link", { name: "Grupo Atlas" }).first().click();
  await page.waitForURL(/analisis-cliente/);
  text = await body(page);
  const url = new URL(page.url());
  ctx.check("Ficha: abre el Grupo conservando periodo y filtros, sin pestañas", url.searchParams.get("ambito") === "group" && url.searchParams.get("soporte") === "GOLD" && (await page.locator('.tabs, [role="tab"]').count()) === 0, url.search.slice(0, 120));
  ctx.check("Ficha: cinco gráficos y los tres cuadros de dedicación a la vez, con tabla equivalente", (await page.locator(".fc-card").count()) === 5 && (await page.locator(".fc-tcard").count()) === 3 && (await page.locator(".fc-eq").count()) === 5);
  ctx.check("Ficha: hitos con fecha y ámbito", /Arranque/.test(text) && /Migración/.test(text));
  await shot(page, "ficha-resumen-1440");
  await page.locator(".fc-back").first().click();
  await page.waitForURL(/\/comparativa/);
  const back = new URL(page.url());
  ctx.check("Volver a Comparativa conserva Soporte, orden y periodo (y no reintroduce parámetros antiguos)", back.searchParams.get("soporte") === "GOLD" && back.searchParams.get("orden") === "cum.revenue" && !back.searchParams.has("tam") && !back.searchParams.has("bloques"), back.search);


  // --- Detalle y explicación
  const fichaUrl = `${ctx.base}/analisis-cliente?ambito=group&id=${w.atlas.id}`;
  await page.goto(fichaUrl);
  text = await body(page);
  ctx.check("Dedicación: perfiles previstos, tipos de ticket y tipos de problema en la misma ficha", /CS N1/.test(text) && /PMO ANA/.test(text) && /Incidente\/Problema Vincle/.test(text) && /Otro soporte/.test(text) && /Causa pendiente/.test(text) && /Integración\/Procesos/.test(text));
  ctx.check("Ficha: sin sellos, método ni cobertura en la ficha principal", !/eco-v2|Referencia de cálculo|cobertura/i.test(text));
  const cardHours = (await page.locator(".fc-sum tbody tr").nth(1).locator("td").nth(3).innerText()).replace(/[^\d,.]/g, "");
  await page.goto(`${fichaUrl}&det=horas&periodo=cum`);
  text = await body(page);
  const detailHours = /Total del conjunto filtrado:\s*(\d+) actividad\(es\) · [\d.]+ min = ([\d.,]+) h/.exec(text);
  ctx.check("Detalle de horas concilia con el resumen de la ficha (mismas horas, mismo conjunto)", Boolean(detailHours) && detailHours![2] === cardHours, `${detailHours?.[2]} / ${cardHours}`);
  await page.goto(`${fichaUrl}&det=ratio&periodo=cum&metrica=devTarget`);
  text = await body(page);
  ctx.check("Explicación de un ratio: numerador, denominador, operandos, fórmula, referencia y estado", /Numerador/.test(text) && /Denominador/.test(text) && /Operando · objetivo/.test(text) && /\(objetivo − ratio\) \/ objetivo/.test(text) && /Referencia/.test(text) && /Estado/.test(text));
  await page.goto(`${fichaUrl}&det=ingreso&periodo=cum`);
  text = await body(page);
  ctx.check("Detalle del ingreso: importe anual fuente y contribución imputada (sin sumar doce veces)", /Importe anual fuente/.test(text) && /Contribución imputada/.test(text) && /96\.000,00/.test(text) && (await page.getByRole("link", { name: "lote" }).count()) >= 1);
  await page.goto(`${fichaUrl}&det=horas&periodo=cum&sello=0000000000000000`);
  ctx.check("Si cambian los datos entre el agregado y el detalle se declara una nueva lectura", /nueva lectura/.test(await body(page)));
  await page.goto(fichaUrl);
  const chart = page.locator(".fc-card").first();
  await chart.locator(".fc-band").nth(1).hover();
  ctx.check("Ficha: el tooltip del gráfico da actual, mismo mes anterior, diferencia y variación", /Diferencia/.test(await chart.locator(".fc-tip").innerText().catch(() => "")) );
  await chart.getByRole("button", { name: "Tabla" }).click();
  ctx.check("Ficha: la tabla equivalente trae los doce meses", (await chart.locator(".fc-eq tbody tr").count()) === 12);

  // --- Cliente sin repartir ingreso
  await page.goto(`${ctx.base}/analisis-cliente?ambito=client&id=${w.a1.id}`);
  text = await body(page);
  ctx.check("Cliente: horas propias y contexto económico del Grupo identificado, sin ratio propio", /Grupo · mes \(contexto\)/.test(text) && (await page.locator(".fc-sum .fc-na").count()) >= 3);
  await page.goto(`${ctx.base}/analisis-cliente?ambito=client&id=${w.a1.id}&pestana=dedicacion`);
  ctx.check("Cliente: la dedicación es la de su ámbito (sin repartir ni clonar) y una URL antigua con pestaña no crea pestañas", (await page.locator(".fc-tcard").count()) === 3 && (await page.locator('.tabs, [role="tab"]').count()) === 0);
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
  const csvFiltered = await (await fetch(`${ctx.base}/api/analitica/comparativa.csv?soporte=GOLD`, { headers: { Cookie: adminCookie } })).text();
  const goldGroups = await ctx.prisma.clientGroup.count({ where: { name: { in: ["Grupo Atlas", "Grupo Cénit"] } } });
  ctx.check("CSV filtrado = pantalla: solo el conjunto filtrado por Soporte (todos sus periodos), con contexto y selección en columnas", csvFiltered.trim().split("\r\n").length === 1 + goldGroups * 5 + 5 && /sello_datos/.test(csvFiltered) && /ingreso imputado/.test(csvFiltered) && /soporte: Gold/.test(csvFiltered));
  const csvLegacy = await (await fetch(`${ctx.base}/api/analitica/comparativa.csv?q=atlas&estado=inactivos`, { headers: { Cookie: adminCookie } })).text();
  ctx.check("CSV: los parámetros antiguos no recortan la exportación", csvLegacy.trim().split("\r\n").length === lines.length);
  const fichaCsv = await fetch(`${ctx.base}/api/analitica/ficha.csv?ambito=group&id=${w.atlas.id}&tabla=series`, { headers: { Cookie: adminCookie } });
  const fichaLines = (await fichaCsv.text()).trim().split("\r\n");
  ctx.check("CSV de la ficha: periodos y series mensuales de ambos años", fichaCsv.status === 200 && fichaLines.length > 5 + Number(today.slice(5, 7)), String(fichaLines.length));
  ctx.check("CSV con ámbito o tabla forjados: 400", (await fetch(`${ctx.base}/api/analitica/ficha.csv?ambito=group&id=%27%20OR%201=1&tabla=series`, { headers: { Cookie: adminCookie } })).status === 400 && (await fetch(`${ctx.base}/api/analitica/ficha.csv?ambito=group&id=${w.atlas.id}&tabla=../../etc`, { headers: { Cookie: adminCookie } })).status === 400);
  const anon = await fetch(`${ctx.base}/api/analitica/comparativa.csv`, { redirect: "manual" });
  ctx.check("CSV sin sesión: no se entrega (redirige al acceso)", anon.status >= 300 && anon.status < 400 && !(await anon.text()).includes("sello_datos"));

  // --- Consulta
  const rd = await login(ctx, ctx.accounts.readerEmail, ctx.accounts.readerPassword);
  await rd.page.goto(`${ctx.base}/comparativa`);
  ctx.check("Consulta lee Comparativa", (await rd.page.locator("table.cmp2").count()) === 1);
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

  // --- Parámetros hostiles y retorno externo (la vista normal de Comparativa se comprueba arriba)
  await page.goto(`${ctx.base}/analisis-cliente?ambito=group&id=%27%20OR%201=1--`);
  ctx.check("Identificador forjado: vuelve al selector sin error", /Grupo, Cliente o implantación/.test(await body(page)));
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
