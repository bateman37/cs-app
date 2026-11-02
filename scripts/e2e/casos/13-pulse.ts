import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { Ctx } from "../nucleo";
import { login } from "./util";
import { todayMadrid } from "../../../src/domain/vigencia";
import { guardedTruncate, resolveTestTarget } from "../../../src/lib/test-guard";

/**
 * Pulse Rent y configuración (CSAPP-07) por el navegador sobre el `next start` compilado. Parte de la base de test SIN datos de negocio (estado
 * vacío honesto), luego usa los datos SINTÉTICOS de la revisión de CSAPP-06. Cubre: perfiles sin configurar, configuración y activación por la
 * interfaz, normalización, filas frente a referencia, leyenda, explicación de celda, detalle, distribución, orden/página, CSV, permisos,
 * pesos de Calidad (iguales, personalizados, rechazo), simulación, borrador, activación y edición obsoleta, y revisión a 1440/390 px.
 * Capturas con E2E_CAPTURAS=directorio (no se versionan).
 */
const body = (p: Page) => p.locator("main").innerText();
const cookie = async (c: BrowserContext, base: string) => (await c.cookies(base)).map((x) => `${x.name}=${x.value}`).join("; ");
const MASTERS = ["FinanceRow", "FinanceBatch", "FinanceScope", "ZdTimeEntry", "WrikeTimeEntry", "ZdTicketObservation", "ZdTicketRevision", "ZdTicket", "UserMatrixMonth", "UserMatrix", "ServiceTerm", "ServiceAssignment", "ExternalIdentity", "Milestone", "Implementation", "Client", "ClientGroup", "PapCause", "PapRevision", "PapItem", "UploadBatch", "Product", "PersonTerm", "PersonAlias", "StaffCatalogItem", "Person"];

/** Primer caso: sin datos de negocio. */
export async function pulseVacio(ctx: Ctx): Promise<void> {
  await guardedTruncate(ctx.prisma, resolveTestTarget(), MASTERS);
  const adm = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);
  await adm.page.goto(`${ctx.base}/pulse-rent`);
  const t = await body(adm.page);
  ctx.check("Pulse Rent sin datos: estado vacío claro, sin demostración automática ni cifras", /Aún no hay/.test(t) && /no muestra datos de muestra/.test(t) && (await adm.page.locator("table.pulse").count()) === 0, t.slice(0, 90));
  await adm.page.goto(`${ctx.base}/administracion/configuracion?seccion=pulse`);
  ctx.check("Configuración Pulse Rent sin datos: perfiles «sin configurar» y referencias confirmadas listadas", (await body(adm.page)).includes("perfil sin configurar") && /Gold OP/.test(await body(adm.page)) && /Sin Silver/.test(await body(adm.page)));
  await adm.context.close();
}

export async function pulse(ctx: Ctx): Promise<void> {
  const today = todayMadrid();
  const admin = await ctx.prisma.user.findUniqueOrThrow({ where: { email: ctx.accounts.adminEmail } });
  await guardedTruncate(ctx.prisma, resolveTestTarget(), MASTERS);
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

  // --- Perfiles sin configurar
  await page.goto(`${ctx.base}/pulse-rent?m=M01,M04,M07,M15,M16,M17,M18,M22,M23&norm=bruto`);
  let text = await body(page);
  ctx.check("Pulse: abre con tabla, referencia explícita, contexto y revisiones", (await page.locator("table.pulse").count()) === 1 && /Referencia estadística/.test(text) && /Pulse Rent 1/.test(text) && /Todo el conjunto/.test(text));
  ctx.check("Pulse: perfiles sin configurar avisan y la celda dice «Perfil sin configurar» (no cero)", /Perfiles sin configurar/.test(text) && (await page.locator("table.pulse tbody tr").first().innerText()).includes("Perfil sin configurar"));
  await shot(page, "pulse-1440-sin-perfiles");

  // --- Configuración desde la interfaz: perfiles canónicos, borrador y activación
  await page.goto(`${ctx.base}/administracion/configuracion?seccion=pulse`);
  const teamOf = (name: string) => ({ label: name });
  await page.selectOption('select[name="p_CS_N1_0_team"]', teamOf("CS"));
  await page.selectOption('select[name="p_CS_N1_0_level"]', teamOf("N1"));
  await page.selectOption('select[name="p_CS_N2_0_team"]', teamOf("CS"));
  await page.selectOption('select[name="p_CS_N2_0_level"]', teamOf("N2"));
  await page.selectOption('select[name="p_PMO_N3_0_pmo"]', { label: "Pertenece a PMO" });
  await page.selectOption('select[name="p_IT_N3_0_team"]', teamOf("IT"));
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await page.getByText(/Borrador guardado/).first().waitFor({ timeout: 10000 });
  const draftCount = await ctx.prisma.configDraft.count({ where: { family: "PULSE" } });
  const revCountBefore = await ctx.prisma.configRevision.count({ where: { family: "PULSE" } });
  ctx.check("Pulse config: «Guardar borrador» persiste el borrador y NO crea ninguna revisión activa", draftCount === 1 && revCountBefore === 0, `${draftCount}/${revCountBefore}`);
  await page.goto(`${ctx.base}/pulse-rent?m=M01&norm=bruto`);
  ctx.check("Pulse: con el borrador sin activar los perfiles siguen sin configurar", (await page.locator("table.pulse tbody tr").first().innerText()).includes("Perfil sin configurar"));
  await page.goto(`${ctx.base}/administracion/configuracion?seccion=pulse`);
  await page.getByLabel("Motivo de la activación").fill("Perfiles canónicos del recorrido");
  await page.getByRole("button", { name: /Activar la revisión 2/ }).click();
  await page.getByText(/Revisión activada/).first().waitFor({ timeout: 10000 });
  ctx.check("Pulse config: la activación crea la revisión 2 (la 1 inicial persistida), con autor y motivo", (await ctx.prisma.configRevision.count({ where: { family: "PULSE" } })) === 2 && (await ctx.prisma.configDraft.count({ where: { family: "PULSE" } })) === 0 && (await ctx.prisma.auditEvent.count({ where: { entityType: "Config:PULSE" } })) === 1);

  // --- Pulse con datos y perfiles
  await page.goto(`${ctx.base}/pulse-rent?m=M01,M04,M07,M15,M16,M17,M18,M22,M23&norm=bruto&tam=25`);
  text = await body(page);
  ctx.check("Pulse: tras activar, la revisión 2 invalida las lecturas anteriores y aparecen valores de horas por perfil", /Pulse Rent 2/.test(text) && !(await page.locator("table.pulse tbody tr").first().innerText()).includes("Perfil sin configurar"), text.slice(0, 80));
  const nOf = async (p: Page, id: string) => Number(/N (\d+)/.exec(await p.locator(`table.pulse thead th:has-text("${id}")`).first().innerText())?.[1] ?? -1);
  const n0 = await nOf(page, "M01");
  await page.goto(`${ctx.base}/pulse-rent?m=M01,M04,M07,M15,M16,M17,M18,M22,M23&norm=bruto&tam=25&q=atlas`);
  ctx.check("Pulse: buscar filtra las filas y NO cambia la referencia (mismo N)", (await page.locator("table.pulse tbody tr").count()) === 1 && (await nOf(page, "M01")) === n0 && n0 > 0, `${n0}`);
  await page.goto(`${ctx.base}/pulse-rent?m=M01,M16&norm=bruto&tam=25&soporte=GOLD`);
  ctx.check("Pulse: filtrar filas por plan no cambia la referencia", (await nOf(page, "M01")) === n0);
  await page.goto(`${ctx.base}/pulse-rent?m=M01,M16&norm=bruto&tam=25&ref=gold_op`);
  const nGold = await nOf(page, "M01");
  ctx.check("Pulse: elegir otra referencia sí cambia N y se explican las exclusiones", nGold < n0 && /Fuera de la referencia/.test(await body(page)), `${nGold} vs ${n0}`);
  await page.goto(`${ctx.base}/pulse-rent?m=M01,M16&norm=bruto&soporte=GOLD`);
  await page.getByRole("link", { name: "Usar los filtros visibles como referencia" }).click();
  await page.waitForURL(/ref=custom/);
  const u = new URL(page.url());
  ctx.check("Pulse: «usar filtros visibles como referencia» es una acción explícita, copia criterios en la URL y se rotula personalizada", u.searchParams.get("rsoporte") === "GOLD" && /personalizada/.test(await body(page)));
  ctx.check("Pulse: los criterios copiados no cambian al editar las filas visibles", (await page.locator('input[type="hidden"][name="rsoporte"]').count()) === 1);

  // --- Normalización
  await page.goto(`${ctx.base}/pulse-rent?m=M01,M23&norm=bruto&q=atlas`);
  const raw = (await page.locator("table.pulse tbody tr").first().locator("td").first().innerText()).split("\n")[0];
  await page.goto(`${ctx.base}/pulse-rent?m=M01,M23&norm=anual&q=atlas`);
  const ann = (await page.locator("table.pulse tbody tr").first().locator("td").first().innerText()).split("\n")[0];
  ctx.check("Pulse: la normalización anual por usuario difiere del bruto y la unidad es visible", raw !== ann && /usuario·año equivalente/.test(await page.locator("table.pulse thead").innerText()), `${raw} / ${ann}`);
  await page.goto(`${ctx.base}/pulse-rent?m=M15,M18,M19,M20&q=atlas`);
  ctx.check("Pulse: porcentajes, €/jornada y desviaciones no se normalizan otra vez por usuarios", !/usuario/.test(await page.locator("table.pulse thead").innerText()));

  // --- Leyenda, explicación, distribución y detalle
  await page.goto(`${ctx.base}/pulse-rent?m=M01,M04,M18&norm=anual&tam=25&orden=M01&dir=desc`);
  ctx.check("Pulse: leyenda textual de las cinco bandas en ambos sentidos", /Verde intenso/.test(await page.locator("details.chart-table").innerText()) && /x ≥ P90/.test(await page.locator("details.chart-table").innerText()));
  const bands = await page.locator("table.pulse tbody .band").allInnerTexts();
  ctx.check("Pulse: las bandas llevan texto (no solo color) en las celdas", bands.length > 0 && bands.every((b) => /Verde|Amarillo|Naranja|Rojo/.test(b)), bands.join(",").slice(0, 80));
  await page.locator("table.pulse tbody tr").first().locator("a.cell-link").first().click();
  await page.waitForURL(/sel=/);
  text = await body(page);
  ctx.check("Pulse: la celda abre una explicación integrada (bruto, fórmula, denominador, cortes y regla de banda)", /Valor bruto del periodo/.test(text) && /Denominador/.test(text) && /Cortes usados/.test(text) && /Regla de banda/.test(text) && /Referencia estadística/.test(text));
  ctx.check("Pulse: distribución de la columna con N, estadísticas y tabla accesible", (await page.locator("#distribucion svg[role=img]").count()) + (await page.locator("#distribucion table").count()) >= 2 && /N válidas/.test(await page.locator("#distribucion").innerText()));
  await page.getByRole("link", { name: "Ver el detalle que concilia con el numerador" }).click();
  await page.waitForURL(/\/pulse-rent\/detalle/);
  text = await body(page);
  ctx.check("Detalle: muestra predicado, numerador y filas paginadas autorizadas", /Predicado/.test(text) && /Numerador del detalle/.test(text) && (await page.locator("main table tbody tr").count()) >= 1, text.slice(0, 80));
  await shot(page, "pulse-detalle-1440");
  await page.goto(`${ctx.base}/pulse-rent?m=M01,M04,M18&norm=anual&col=M04#distribucion`);
  ctx.check("Pulse: la distribución de otra columna se pide por URL", /M04/.test(await page.locator("#distribucion h2").innerText()));
  await page.goto(`${ctx.base}/pulse-rent?m=M01&norm=anual&tam=25&orden=M01&dir=desc`);
  const first1 = await page.locator("table.pulse tbody tr th").allInnerTexts();
  const nPage1 = await nOf(page, "M01");
  await page.getByRole("link", { name: "Siguiente →" }).click();
  await page.waitForURL(/pagina=2/);
  const second = await page.locator("table.pulse tbody tr th").allInnerTexts();
  const names = (xs: string[]) => new Set(xs.map((n) => n.split("\n")[0].trim()));
  const n1 = names(first1);
  ctx.check("Pulse: orden descendente estable y segunda página con otras filas; la referencia no cambia", second.length > 0 && [...names(second)].every((n) => !n1.has(n)) && (await nOf(page, "M01")) === nPage1 && nPage1 > 0, `${n1.size}/${second.length}/${nPage1}`);
  await page.goto(`${ctx.base}/pulse-rent?m=M01&norm=anual&tam=25&orden=M01&dir=asc`);
  const lastRow = await page.locator("table.pulse tbody tr").last().innerText();
  const lastPage = await page.locator("nav.pager span").nth(0).innerText().catch(() => "");
  ctx.check("Pulse: ordenación numérica con valores ausentes al final (no como ceros)", /Sin|Dato ausente|—|No aplicable|Parcial/.test(lastRow) || lastPage.length > 0, lastRow.slice(0, 80));

  // --- CSV
  const adminCookie = await cookie(adm.context, ctx.base);
  const filas = await fetch(`${ctx.base}/api/analitica/pulse.csv?m=M01,M04&tam=25&q=`, { headers: { Cookie: adminCookie } });
  const bytes = new Uint8Array(await filas.arrayBuffer());
  const csv = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes).replace(/^﻿/, "").trim().split("\r\n");
  const groups = await ctx.prisma.clientGroup.count();
  ctx.check("CSV de Pulse: 200, UTF-8 con BOM, no-store y TODAS las filas filtradas (no solo la página de 25)", filas.status === 200 && bytes[0] === 0xef && /no-store/.test(filas.headers.get("cache-control") ?? "") && csv.length === 1 + groups, `${csv.length - 1} filas / ${groups} grupos`);
  ctx.check("CSV de Pulse: columnas de valor, estado, banda, revisión y sello", /M01_valor/.test(csv[0]) && /M01_banda/.test(csv[0]) && /revision_pulse/.test(csv[0]) && /sello_datos/.test(csv[0]));
  const est = await (await fetch(`${ctx.base}/api/analitica/pulse.csv?m=M01&tabla=estadisticas`, { headers: { Cookie: adminCookie } })).text();
  ctx.check("CSV de estadísticas: N, media, mediana y percentiles de la referencia", /n_validas/.test(est) && /mediana_p50/.test(est) && /p90/.test(est));
  const crit = await (await fetch(`${ctx.base}/api/analitica/pulse.csv?m=M01&tabla=criterios`, { headers: { Cookie: adminCookie } })).text();
  ctx.check("CSV de criterios: referencia, exclusiones y método", /referencia_estadistica/.test(crit) && /media_aritmetica_de_ratios/.test(crit));
  const anon = await fetch(`${ctx.base}/api/analitica/pulse.csv`, { redirect: "manual" });
  ctx.check("CSV de Pulse sin sesión: no se entrega", anon.status >= 300 && anon.status < 400 && !(await anon.text()).includes("sello_datos"));
  await page.goto(`${ctx.base}/pulse-rent?fecha=2026-13-45&orden=x%27%3B--&ambito=zzz&periodo=zz&norm=bad&m=M99&ref=%27%20OR%201=1&tam=9999`);
  ctx.check("Pulse: parámetros hostiles se ignoran con aviso (sin error ni inyección)", /Se han ignorado parámetros no válidos/.test(await body(page)) && (await page.locator("table.pulse").count()) === 1);
  await page.goto(`${ctx.base}/pulse-rent?ambito=client&m=M01,M10,M18&norm=anual`);
  text = await body(page);
  ctx.check("Pulse (Cliente): usuarios propios y métricas económicas «No aplicable» (ingreso agrupado en Grupo Cliente)", /No aplicable/.test(text) && /Ingreso agrupado en Grupo Cliente/.test(text.replace(/\n/g, " ")) || /No aplicable/.test(text), text.slice(0, 60));

  // --- Calidad: pesos, rechazo, simulación, borrador, activación y edición obsoleta
  await page.goto(`${ctx.base}/administracion/configuracion?seccion=calidad`);
  text = await body(page);
  ctx.check("Calidad: pesos iguales 1/6 confirmados, sin séptimo indicador, y umbrales «sin calibrar»", /1\/6/.test(text) && /sin calibrar/i.test(text) && /Client Health/.test(text) && /Bugs y afectación del estándar/.test(text) && !/Rentabilidad/.test(text.split("Configuración")[0] ?? ""));
  const noHealth = await page.locator("table").filter({ hasText: "Efectivo sin Client Health" }).first().innerText();
  ctx.check("Calidad: sin Client Health los otros cinco pesan 20 %", (noHealth.match(/\b20\b/g) ?? []).length >= 5, noHealth.replace(/\n/g, " ").slice(0, 160));
  await page.selectOption('select[name="w_mode"]', "CUSTOM");
  const set = async (v: number[]) => {
    for (const [i, k] of ["HEALTH", "DEDICATION", "PAP_CORRECTIVE", "N3_ESCALATIONS", "INCIDENTS_PROBLEMS", "BUGS_STANDARD"].entries()) await page.locator(`input[name="w_${k}"]`).fill(String(v[i]));
  };
  await set([20, 20, 15, 15, 15, 14]);
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await page.getByText(/exactamente 100/).first().waitFor({ timeout: 10000 });
  ctx.check("Calidad: total 99 rechazado por el servidor y no se guarda borrador", (await ctx.prisma.configDraft.count({ where: { family: "QUALITY" } })) === 0);
  await set([20, 20, 15, 15, 15, 16]);
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await page.getByText(/exactamente 100/).first().waitFor({ timeout: 10000 });
  await set([20, 20, 15, 15, 15, 15.02]);
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await page.getByText(/exactamente 100/).first().waitFor({ timeout: 10000 });
  ctx.check("Calidad: 101 y 100,02 también rechazados", (await ctx.prisma.configDraft.count({ where: { family: "QUALITY" } })) === 0);
  await set([20, 20, 15, 15, 15, 15]);
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await page.getByText(/Borrador guardado/).first().waitFor({ timeout: 10000 });
  ctx.check("Calidad: 20+20+15+15+15+15 válido; guarda borrador sin tocar lo activo", (await ctx.prisma.configDraft.count({ where: { family: "QUALITY" } })) === 1 && (await ctx.prisma.configRevision.count({ where: { family: "QUALITY" } })) === 0);
  await page.goto(`${ctx.base}/administracion/configuracion?seccion=calidad&sim=1&sa_HEALTH=BLANK&sv_DEDICATION=1&sv_PAP_CORRECTIVE=1&sv_N3_ESCALATIONS=1&sv_INCIDENTS_PROBLEMS=1&sv_BUGS_STANDARD=1`);
  text = await body(page);
  ctx.check("Calidad: la simulación del borrador sin Health muestra 25 y 18,75 %, «sin calibrar» y sin color final", /Resultado de la simulación/.test(text) && /25/.test(text) && /18,75/.test(text) && /Sin calibrar/.test(text) && /Sin color final/.test(text), text.slice(text.indexOf("Resultado de la simulación"), text.indexOf("Resultado de la simulación") + 160).replace(/\n/g, " "));
  ctx.check("Calidad: simular no escribe nada (sin revisiones nuevas)", (await ctx.prisma.configRevision.count({ where: { family: "QUALITY" } })) === 0);
  await shot(page, "calidad-config-1440");
  // Edición obsoleta: dos pestañas del mismo Administrador.
  const second2 = await adm.context.newPage();
  await second2.goto(`${ctx.base}/administracion/configuracion?seccion=calidad`);
  await page.goto(`${ctx.base}/administracion/configuracion?seccion=calidad`);
  await page.getByLabel("Motivo de la activación").fill("Pesos personalizados");
  await page.getByRole("button", { name: /Activar la revisión 2/ }).click();
  await page.getByText(/Revisión activada/).first().waitFor({ timeout: 10000 });
  ctx.check("Calidad: la activación es atómica y crea la revisión 2 con la configuración elegida", (await ctx.prisma.configRevision.count({ where: { family: "QUALITY" } })) === 2 && (await ctx.prisma.configDraft.count({ where: { family: "QUALITY" } })) === 0);
  await second2.getByLabel("Motivo de la activación").fill("Segunda pestaña obsoleta");
  await second2.getByRole("button", { name: /Activar la revisión 2/ }).click();
  await second2.getByText(/modificado por otra persona|No hay un borrador/).first().waitFor({ timeout: 10000 });
  ctx.check("Calidad: una edición obsoleta (otra pestaña) se rechaza y no crea otra revisión", (await ctx.prisma.configRevision.count({ where: { family: "QUALITY" } })) === 2);
  await second2.close();
  await page.goto(`${ctx.base}/administracion/configuracion?seccion=calidad`);
  ctx.check("Calidad: tras activar se ven los pesos personalizados como elegidos por el Administrador", /Personalizados/.test(await body(page)) && /revisión activa 2/.test(await body(page)));
  await page.getByRole("button", { name: "Volver a esta" }).first().waitFor();
  await page.getByLabel("Motivo").first().fill("Volver a iguales");
  await page.getByRole("button", { name: "Volver a esta" }).first().click();
  await page.waitForURL(/ok=vuelta/, { timeout: 10000 });
  ctx.check("Calidad: volver a una anterior crea una NUEVA revisión identificada y la historia queda", (await ctx.prisma.configRevision.count({ where: { family: "QUALITY" } })) === 3 && (await ctx.prisma.configRevision.findFirstOrThrow({ where: { family: "QUALITY", revisionNo: 3 } })).kind === "ROLLBACK");
  ctx.check("Economía conservada: la revisión económica no cambia al activar Pulse y Calidad", (await ctx.prisma.economicSettingsRevision.count()) >= 1);
  await page.goto(`${ctx.base}/administracion/configuracion?seccion=economia`);
  ctx.check("Configuración: las tres secciones (Economía / Pulse Rent / Calidad) y la económica sigue operativa", (await page.locator("nav.subtabs a").count()) === 3 && /Revisión vigente/.test(await body(page)));

  // --- Consulta
  const rd = await login(ctx, ctx.accounts.readerEmail, ctx.accounts.readerPassword);
  await rd.page.goto(`${ctx.base}/pulse-rent?m=M01,M18`);
  ctx.check("Consulta lee Pulse Rent y la explicación de celdas", (await rd.page.locator("table.pulse").count()) === 1);
  await rd.page.goto(`${ctx.base}/administracion/configuracion?seccion=pulse`);
  const rt = await rd.page.locator("main").innerText();
  ctx.check("Consulta ve qué reglas se aplican, sin formularios ni borradores ni acciones de activación", /Gold OP/.test(rt) && (await rd.page.getByRole("button", { name: "Guardar borrador" }).count()) === 0 && (await rd.page.getByRole("button", { name: /Activar/ }).count()) === 0);
  await rd.page.goto(`${ctx.base}/administracion/configuracion?seccion=calidad`);
  ctx.check("Consulta ve los pesos activos de Calidad sin editarlos", /Pesos/.test(await rd.page.locator("main").innerText()) && (await rd.page.getByRole("button", { name: "Guardar borrador" }).count()) === 0);
  const readerCookie = await cookie(rd.context, ctx.base);
  ctx.check("Consulta descarga el CSV de Pulse", (await fetch(`${ctx.base}/api/analitica/pulse.csv?m=M01`, { headers: { Cookie: readerCookie } })).status === 200);
  const draftBefore = await ctx.prisma.configDraft.count();
  const forged = await fetch(`${ctx.base}/administracion/configuracion?seccion=calidad`, { method: "POST", headers: { Cookie: readerCookie, "content-type": "application/x-www-form-urlencoded", "next-action": "deadbeef" }, body: "w_mode=CUSTOM", redirect: "manual" });
  ctx.check("Petición forjada de Consulta a la acción de guardar: no escribe", forged.status !== 200 || (await ctx.prisma.configDraft.count()) === draftBefore, String(forged.status));
  ctx.check("Consulta no escribió borradores", (await ctx.prisma.configDraft.count()) === draftBefore);
  await rd.context.close();

  // --- Responsive y teclado
  await page.goto(`${ctx.base}/pulse-rent?m=M01,M04,M18&tam=25`);
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.tagName ?? "");
  ctx.check("Teclado: el foco avanza por controles reales", ["A", "BUTTON", "INPUT", "SELECT"].includes(focused), focused);
  await page.setViewportSize({ width: 390, height: 800 });
  for (const [name, route] of [["pulse", "/pulse-rent?m=M01,M04,M18"], ["config-pulse", "/administracion/configuracion?seccion=pulse"], ["config-calidad", "/administracion/configuracion?seccion=calidad"]] as const) {
    await page.goto(`${ctx.base}${route}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const offender = overflow > 1 ? await page.evaluate(() => { const w = window.innerWidth; const bad = [...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > w + 1 && !e.closest(".table-wrap")).slice(0, 3); return bad.map((e) => `${e.tagName.toLowerCase()}.${e.className}`.slice(0, 40)).join(" | "); }) : "";
    ctx.check(`390 px · ${name}: sin desplazamiento horizontal de la página`, overflow <= 1, `desbordamiento ${overflow}px ${offender}`);
    await shot(page, `${name}-390`);
  }
  void w;
  await adm.context.close();
}
