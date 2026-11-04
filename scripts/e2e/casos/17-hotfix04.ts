import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import type { Ctx } from "../nucleo";
import { login } from "./util";
import { saveFromTable } from "./03-maestros";

/**
 * CSAPP-HOTFIX-04 (§10): recorrido de navegador sobre la web COMPILADA con datos SINTÉTICOS de la base de pruebas. Cubre desde «Administración» en Comparativa hasta
 * la edición real de celdas en Clientes y de meses en Usuarios, la cancelación sin escritura, la persistencia tras reiniciar el servidor, la guardia de navegación,
 * la lectura de Consulta y Comparativa sin error. Con E2E_SHOTS=<carpeta> guarda capturas (1920×1080, 1536×864 y móvil) para revisión visual; no se versionan.
 */
const SHOTS = process.env.E2E_SHOTS;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

export async function hotfix04(ctx: Ctx): Promise<void> {
  const year = new Date().getFullYear();
  // ---- Datos sintéticos
  const g = await ctx.prisma.clientGroup.create({ data: { name: "HF4 Alfa", bcDenomination: "HF4 Alfa" } });
  const c1 = await ctx.prisma.client.create({ data: { name: "HF4 Alfa Uno", groupId: g.id } });
  const c2 = await ctx.prisma.client.create({ data: { name: "HF4 Alfa Dos con un nombre de organización bastante largo para probar la fila", groupId: g.id } });
  const idn = (system: "ZENDESK" | "WRIKE" | "PAP", kind: "ORG_ID" | "PROJECT_NAME", raw: string, fk: { groupId?: string; clientId?: string }) =>
    ctx.prisma.externalIdentity.create({ data: { system, kind, rawValue: raw, searchValue: raw.toLowerCase(), ...fk } });
  await idn("ZENDESK", "ORG_ID", "360534144557", { clientId: c1.id });
  await idn("ZENDESK", "ORG_ID", "360534144558", { clientId: c2.id });
  await idn("WRIKE", "PROJECT_NAME", "HF4 - CS", { groupId: g.id });
  await idn("PAP", "PROJECT_NAME", "HF4 - VSW SALES", { clientId: c1.id });
  for (const [cl, sup, host, cx] of [[c1, "GOLD", "OP", "MEDIUM"], [c2, "PLATINUM", "CLOUD", "BASIC"]] as const) {
    await ctx.prisma.serviceTerm.create({ data: { attribute: "SUPPORT", value: sup, clientId: cl.id } });
    await ctx.prisma.serviceTerm.create({ data: { attribute: "HOSTING", value: host, clientId: cl.id } });
    await ctx.prisma.serviceTerm.create({ data: { attribute: "COMPLEXITY", value: cx, clientId: cl.id } });
  }
  const admin = await ctx.prisma.user.findUniqueOrThrow({ where: { email: ctx.accounts.adminEmail } });
  const mk = async (scope: { groupId?: string; clientId?: string }, vals: number[]) => {
    const m = await ctx.prisma.userMatrix.create({ data: { ...scope, year } });
    for (const [i, v] of vals.entries()) await ctx.prisma.userMatrixMonth.create({ data: { matrixId: m.id, month: i + 1, value: v, kind: "INITIAL", source: "Valor inicial sintético", updatedById: admin.id } });
    return m;
  };
  const mG = await mk({ groupId: g.id }, [65, 65, 65, 65, 65, 65, 65, 65, 65, 65, 65, 65]);
  const mC = await mk({ clientId: c1.id }, [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
  await ctx.startWorker();

  const { context, page } = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);
  await page.setViewportSize({ width: 1920, height: 1080 });

  // ---- 1. Navegación: Administración desde Comparativa
  await page.goto(`${ctx.base}/comparativa`);
  ctx.check("Comparativa carga sin el error de lectura (esquema al día)", (await page.getByText("No se pudo cargar la comparativa").count()) === 0);
  await shot(page, "comparativa-1920");
  await page.getByRole("link", { name: "Administración" }).click();
  await page.waitForURL(/\/administracion\/clientes(\?|$)/, { timeout: 15000 });
  ctx.check("Pulsar «Administración» desde Comparativa lleva al editor canónico, no a la lista antigua", new URL(page.url()).pathname === "/administracion/clientes", page.url());
  ctx.check("El editor muestra las ocho columnas del Excel con sus nombres", (await Promise.all(["Grupo Cliente", "Wrike", "Id_Zendesk", "Zendesk", "Nivel de Servicio", "Servidor", "PAP", "Tipo"].map((n) => page.getByRole("columnheader", { name: n, exact: true }).count()))).every((n) => n === 1));
  ctx.check("La tabla es editable en sus celdas (sin enlaces a fichas para cambiar valores)", (await page.locator(".ed-input:not([disabled])").count()) > 10);
  await shot(page, "clientes-1920");
  const fits = await page.evaluate(() => { const s = document.querySelector(".mt-scroll"); return s ? s.scrollWidth <= s.clientWidth + 2 : false; });
  ctx.check("A 1920×1080 las ocho columnas y el estado caben sin scroll horizontal", fits);

  // ---- 2. Rutas antiguas
  for (const [old, qsOld, expect] of [["grupos", "?q=HF4&status=inactive&page=2", "estado=inactivos"], ["clientes", `?groupId=${g.id}&pending=1`, `grupo=${g.id}`]] as const) {
    await page.goto(`${ctx.base}/administracion/clientes/${old}${qsOld}`);
    const u = new URL(page.url());
    ctx.check(`La lista antigua /${old} redirige al editor con filtros traducidos y sin bucle`, u.pathname === "/administracion/clientes" && u.search.includes(expect), page.url());
  }
  await page.goto(`${ctx.base}/administracion/clientes/grupos/${g.id}`);
  await page.getByRole("link", { name: /Volver a la tabla de Clientes/ }).click();
  await page.waitForURL(/\/administracion\/clientes(\?|$)/);
  ctx.check("Volver desde una ficha devuelve a la tabla nueva", new URL(page.url()).pathname === "/administracion/clientes");

  // ---- 3. Edición real: Tab/Enter no guardan; cancelar no escribe; confirmar guarda
  await page.goto(`${ctx.base}/administracion/clientes?q=HF4`);
  const row = page.locator("tr", { has: page.locator('input[value="HF4 Alfa Uno"]') });
  const support = row.getByLabel("Nivel de Servicio", { exact: true });
  const wrike = page.locator("tr", { has: page.locator('input[aria-label="Grupo Cliente de HF4 Alfa"]') }).first().getByLabel("Wrike", { exact: true });
  await support.selectOption("SILVER_ON_DEMAND");
  await wrike.fill("HF4 - CS CORREGIDO");
  await wrike.press("Tab");
  await wrike.press("Enter");
  ctx.check("Se marcan solo las celdas modificadas y la barra cuenta los cambios", (await page.locator(".mt-dirty").count()) === 2 && (await page.getByRole("button", { name: "Guardar cambios (2)" }).count()) === 1);
  ctx.check("Tab y Enter NO guardan: la base sigue con los valores anteriores", (await ctx.prisma.serviceTerm.count({ where: { clientId: c1.id, attribute: "SUPPORT", value: "GOLD" } })) === 1 && (await ctx.prisma.externalIdentity.count({ where: { groupId: g.id, rawValue: "HF4 - CS CORREGIDO" } })) === 0);
  await shot(page, "clientes-editando-1920");
  await saveFromTable(page, "cancel");
  ctx.check("Cancelar la confirmación no escribe y conserva el borrador para corregirlo", (await ctx.prisma.serviceTerm.count({ where: { clientId: c1.id, value: "GOLD" } })) === 1 && (await support.inputValue()) === "SILVER_ON_DEMAND" && (await page.getByRole("button", { name: "Guardar cambios (2)" }).count()) === 1);
  const opsBefore = await ctx.prisma.auditEvent.count({ where: { entityType: "EditOperation" } });
  await page.getByRole("button", { name: /^Guardar cambios/ }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: "¿Estás seguro de que deseas guardar estos cambios?" }).waitFor();
  const reviewText = (await dlg.textContent()) ?? "";
  ctx.check("La confirmación lista entidad, campo y valores antes → después", /Nivel de Servicio/.test(reviewText) && /Gold/.test(reviewText) && /Silver On Demand/.test(reviewText) && /HF4 - CS CORREGIDO/.test(reviewText));
  await shot(page, "clientes-confirmacion-1920");
  const confirmBtn = dlg.getByRole("button", { name: "Sí, guardar" });
  await Promise.all([confirmBtn.dblclick(), page.locator(".ed-toast").waitFor({ timeout: 20000 })]); // doble clic: una sola operación
  ctx.check("Confirmar guarda en la misma pantalla y la tabla se limpia", new URL(page.url()).pathname === "/administracion/clientes" && (await page.locator(".mt-dirty").count()) === 0);
  ctx.check("Valor guardado en la base (soporte y clave Wrike)", (await ctx.prisma.serviceTerm.count({ where: { clientId: c1.id, attribute: "SUPPORT", value: "SILVER_ON_DEMAND" } })) === 1 && (await ctx.prisma.externalIdentity.count({ where: { groupId: g.id, system: "WRIKE", rawValue: "HF4 - CS CORREGIDO" } })) === 1);
  ctx.check("El doble clic en «Sí, guardar» aplica UNA sola operación auditada (idempotente)", (await ctx.prisma.auditEvent.count({ where: { entityType: "EditOperation" } })) === opsBefore + 1);
  ctx.check("La auditoría registra al Administrador como actor y los valores antes/después", (await ctx.prisma.auditEvent.count({ where: { entityType: "ServiceTerm", actorId: admin.id, summary: { contains: "Edición en la tabla" } } })) >= 1);
  // Reenlace: el guardado solicitó la actualización de relaciones y el trabajador la publica.
  const t0 = Date.now();
  let refreshed = false;
  while (Date.now() - t0 < 30000 && !refreshed) {
    const r = await ctx.prisma.relationRefresh.findUnique({ where: { scope: "global" } });
    refreshed = Boolean(r) && Number(r!.completedGeneration) >= Number(r!.requestedGeneration);
    if (!refreshed) await page.waitForTimeout(500);
  }
  ctx.check("El guardado dispara el reenlace automático y el trabajador lo completa (sin pasar por Cargas)", refreshed);

  // ---- 4. Persistencia tras reiniciar y volver a entrar
  await ctx.restartServer();
  await context.close();
  const again = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);
  await again.page.setViewportSize({ width: 1920, height: 1080 });
  await again.page.goto(`${ctx.base}/administracion/clientes?q=HF4`);
  const row2 = again.page.locator("tr", { has: again.page.locator('input[value="HF4 Alfa Uno"]') });
  ctx.check("Tras reiniciar el servidor y entrar otra vez, los valores guardados persisten", (await row2.getByLabel("Nivel de Servicio", { exact: true }).inputValue()) === "SILVER_ON_DEMAND" && (await again.page.locator('input[value="HF4 - CS CORREGIDO"]').count()) >= 1);

  // ---- 5. Guardia de navegación con borrador pendiente
  const p2 = again.page;
  await row2.getByLabel("Servidor", { exact: true }).selectOption("CLOUD");
  await p2.getByRole("link", { name: "Usuarios", exact: true }).click();
  const guardDlg = p2.getByRole("dialog");
  await guardDlg.getByRole("heading", { name: "Tiene cambios sin guardar" }).waitFor({ timeout: 10000 });
  ctx.check("Con borrador pendiente, navegar pide Guardar / Descartar / Seguir editando", (await guardDlg.getByRole("button", { name: "Guardar" }).count()) === 1 && (await guardDlg.getByRole("button", { name: "Descartar" }).count()) === 1 && (await guardDlg.getByRole("button", { name: "Seguir editando" }).count()) === 1);
  await guardDlg.getByRole("button", { name: "Seguir editando" }).click();
  ctx.check("Seguir editando conserva el borrador y la página", new URL(p2.url()).pathname === "/administracion/clientes" && (await row2.getByLabel("Servidor", { exact: true }).inputValue()) === "CLOUD");
  ctx.check("Navegar sin guardar no guarda nada", (await ctx.prisma.serviceTerm.count({ where: { clientId: c1.id, attribute: "HOSTING", value: "OP" } })) === 1);
  await p2.getByRole("link", { name: "Estado" }).count();
  await p2.getByRole("link", { name: "Usuarios", exact: true }).click();
  await guardDlg.getByRole("button", { name: "Descartar" }).click();
  await p2.waitForURL(/\/administracion\/usuarios/, { timeout: 15000 });
  ctx.check("Descartar abandona el borrador y navega sin escribir", (await ctx.prisma.serviceTerm.count({ where: { clientId: c1.id, attribute: "HOSTING", value: "OP" } })) === 1);

  // ---- 6. Usuarios: varios meses de varias filas, una sola confirmación
  await p2.goto(`${ctx.base}/administracion/usuarios?ambito=cliente&q=HF4`);
  await shot(p2, "usuarios-1920");
  const uRow = p2.locator("tr", { has: p2.getByRole("link", { name: "HF4 Alfa Uno", exact: true }) });
  await uRow.locator('[data-month="3"]').fill("12");
  await uRow.locator('[data-month="4"]').fill("0");
  await uRow.locator('[data-month="5"]').fill("");
  ctx.check("Editar celdas de Usuarios no guarda (borrador local)", (await ctx.prisma.userMatrixMonth.count({ where: { matrixId: mC.id, month: 3, value: 12 } })) === 0 && (await p2.getByRole("button", { name: "Guardar cambios (1)" }).count()) === 1);
  await saveFromTable(p2, "cancel");
  ctx.check("Cancelar la confirmación de Usuarios no escribe y conserva el borrador", (await uRow.locator('[data-month="3"]').inputValue()) === "12" && (await ctx.prisma.userMatrix.findUniqueOrThrow({ where: { id: mC.id } })).version === 1);
  const toast = await saveFromTable(p2);
  const mm = Object.fromEntries((await ctx.prisma.userMatrixMonth.findMany({ where: { matrixId: mC.id } })).map((x) => [x.month, x.value]));
  ctx.check("Confirmar guarda marzo=12, abril=0 (cero confirmado) y mayo sin informar (no es 0) con una sola versión nueva", mm[3] === 12 && mm[4] === 0 && mm[5] === undefined && (await ctx.prisma.userMatrix.findUniqueOrThrow({ where: { id: mC.id } })).version === 2, JSON.stringify(mm) + toast);
  ctx.check("Los meses sin editar conservan su clasificación y revisión", (await ctx.prisma.userMatrixMonth.findUniqueOrThrow({ where: { matrixId_month: { matrixId: mC.id, month: 6 } } })).kind === "INITIAL");
  await p2.reload();
  ctx.check("Tras recargar, la matriz muestra los valores guardados y «—» para sin informar", (await uRow.locator('[data-month="3"]').inputValue()) === "12" && (await uRow.locator('[data-month="5"]').inputValue()) === "");
  // Valores inválidos: se marcan en la celda y no se envía nada
  await uRow.locator('[data-month="7"]').fill("1.5");
  await p2.getByRole("button", { name: /^Guardar cambios/ }).click();
  await p2.locator(".mt-err").first().waitFor({ timeout: 10000 });
  ctx.check("Un decimal se rechaza junto a la celda sin guardar", (await ctx.prisma.userMatrixMonth.findUniqueOrThrow({ where: { matrixId_month: { matrixId: mC.id, month: 7 } } })).value === 10);
  await p2.getByRole("button", { name: "Cancelar cambios" }).click();
  await p2.getByRole("dialog").getByRole("button", { name: /Descartar/ }).click();
  // Aplicar desde un mes en el Grupo: preserva ajustes explícitos
  await p2.goto(`${ctx.base}/administracion/usuarios?q=HF4`);
  const gRow = p2.locator("tr", { has: p2.getByRole("link", { name: "HF4 Alfa", exact: true }) });
  await gRow.locator("summary").click();
  await gRow.getByLabel(/Mes desde el que aplicar/).selectOption("6");
  await gRow.getByLabel(/Valor a aplicar/).fill("68");
  await gRow.getByRole("button", { name: "Aplicar al borrador" }).click();
  await saveFromTable(p2);
  const gm = (await ctx.prisma.userMatrixMonth.findMany({ where: { matrixId: mG.id }, orderBy: { month: "asc" } })).map((x) => x.value).join(",");
  ctx.check("«Aplicar desde este mes» desde la propia fila: 65 hasta mayo y 68 desde junio", gm === "65,65,65,65,65,68,68,68,68,68,68,68", gm);
  await shot(p2, "usuarios-aplicado-1920");

  // ---- 7. Comparativa sigue cargando con los datos editados
  await p2.goto(`${ctx.base}/comparativa`);
  ctx.check("Comparativa carga con los datos editados (sin error)", (await p2.getByText("No se pudo cargar la comparativa").count()) === 0 && (await p2.locator("table").count()) > 0);

  // ---- 7b. Esquema sin la migración de bandas (estado HOTFIX-02 con el código compilado de HOTFIX-04): diagnóstico específico; con el esquema al día, la ruta compilada funciona
  await ctx.prisma.$executeRawUnsafe('ALTER TABLE "EconomicSettingsRevision" DROP COLUMN "bandFactors"');
  try {
    await p2.goto(`${ctx.base}/comparativa`);
    const errBox = p2.locator(".cmp-error");
    await errBox.waitFor({ timeout: 15000 });
    const errText = (await errBox.textContent()) ?? "";
    ctx.check("Esquema sin la migración de bandas: Comparativa muestra el error con detalle técnico desplegado, la causa (P2022 bandFactors), la migración que falta y la acción segura", /P2022/.test(errText) && /bandFactors/.test(errText) && /20261111090000_hotfix03_bandas_economicas/.test(errText) && /db:migrar/.test(errText) && (await p2.locator(".cmp-error details[open]").count()) === 1 && (await p2.getByRole("link", { name: "Reintentar" }).count()) === 1, errText.slice(0, 200));
    ctx.check("El detalle técnico no contiene URL de conexión ni credenciales", !/postgres(ql)?:\/\//.test(errText) && !/password/i.test(errText));
    ctx.check("No se sustituye el error por una cartera de ceros: no hay tabla de Comparativa", (await p2.locator("table.cmp2").count()) === 0);
  } finally {
    await ctx.prisma.$executeRawUnsafe('ALTER TABLE "EconomicSettingsRevision" ADD COLUMN "bandFactors" JSONB');
  }
  await p2.goto(`${ctx.base}/comparativa`);
  ctx.check("Con el esquema al día (revisiones con bandas NULL) la ruta compilada de Comparativa carga la tabla", (await p2.getByText("No se pudo cargar la comparativa").count()) === 0 && (await p2.locator("table.cmp2").count()) === 1);

  // ---- 8. Capturas y adaptación (1536×864 y móvil)
  for (const [w, h, tag] of [[1536, 864, "1536"], [390, 844, "movil"]] as const) {
    await p2.setViewportSize({ width: w, height: h });
    for (const [url, name] of [["/administracion/clientes?q=HF4", "clientes"], ["/administracion/usuarios?ambito=cliente&q=HF4", "usuarios"], ["/comparativa", "comparativa"]] as const) {
      await p2.goto(`${ctx.base}${url}`);
      await shot(p2, `${name}-${tag}`);
    }
    if (tag === "movil") {
      await p2.goto(`${ctx.base}/administracion/clientes?q=HF4`);
      await p2.getByLabel("Nivel de Servicio", { exact: true }).first().selectOption("GOLD").catch(() => undefined);
      ctx.check("En móvil las acciones de guardado siguen visibles", (await p2.getByRole("button", { name: /Guardar cambios/ }).isVisible()) && (await p2.getByRole("button", { name: "Cancelar cambios" }).isVisible()));
      await p2.getByRole("button", { name: "Cancelar cambios" }).click().catch(() => undefined);
      await p2.getByRole("dialog").getByRole("button", { name: /Descartar/ }).click().catch(() => undefined);
    }
  }
  await again.context.close();
  await ctx.stopWorker();

  // ---- 9. Consulta: mismas cifras, sin controles
  const rd = await login(ctx, ctx.accounts.readerEmail, ctx.accounts.readerPassword);
  await rd.page.goto(`${ctx.base}/administracion/usuarios?ambito=cliente&q=HF4`);
  ctx.check("Consulta ve la matriz de usuarios sin celdas editables ni botones de guardado", (await rd.page.locator(".ed-input:not([disabled])").count()) === 0 && (await rd.page.getByRole("button", { name: /Guardar cambios/ }).count()) === 0 && (await rd.page.locator("td").filter({ hasText: /^12[BCPAE]?$/ }).count()) >= 1);
  await rd.context.close();
}
