import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page } from "playwright";
import type { Ctx } from "../nucleo";
import { login } from "./util";
import { financeXlsx } from "../../../tests/generators/finance";

/**
 * Circuito real de facturación anual y motor económico (CSAPP-05) por el navegador y el trabajador compilados: carga de las tres
 * categorías, vista previa del reemplazo con su impacto, decisiones (importes sin asignar y vacíos), repetición, sustitución con retirada,
 * reversión, comprobación económica (12000 → 500 a 15/30), configuración con edición obsoleta, asignaciones de servicio y permisos.
 * Solo datos sintéticos; nada se sube a Git.
 */
async function waitStatus(page: Page, text: string, ms = 60000): Promise<boolean> {
  try {
    await page.locator('[data-testid="estado-lote"]').getByText(text, { exact: false }).waitFor({ timeout: ms });
    return true;
  } catch {
    return false;
  }
}
const body = (page: Page) => page.locator("body").innerText();
async function waitDb(fn: () => Promise<boolean>, ms = 60000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
async function waitBody(page: Page, re: RegExp, ms = 20000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (re.test(await body(page))) return true;
    await page.waitForTimeout(300);
  }
  return false;
}
const n = async (ctx: Ctx, sql: string) => Number((await ctx.prisma.$queryRawUnsafe<{ n: bigint }[]>(sql))[0].n);
const total = async (ctx: Ctx, cat: string, year: number) =>
  (await ctx.prisma.$queryRawUnsafe<{ t: string | null }[]>(`SELECT trim_scale(sum(r.income))::text AS t FROM "FinanceScope" s JOIN "FinanceRow" r ON r."batchId" = s."activeBatchId" WHERE s.year = ${year} AND s.category = '${cat}'`))[0].t;

export async function finanzas(ctx: Ctx): Promise<void> {
  const B = `${ctx.base}/administracion/cargas`;
  const dir = await mkdtemp(path.join(tmpdir(), "csapp-e2e-05-"));
  const file = (name: string) => path.join(dir, name);
  try {
    const gA = await ctx.prisma.clientGroup.create({ data: { name: "Grupo Fin A" } });
    const gB = await ctx.prisma.clientGroup.create({ data: { name: "Grupo Fin B" } });
    await ctx.prisma.externalIdentity.create({ data: { system: "BC", kind: "GROUP_KEY", rawValue: "ACME SA", searchValue: "acme sa", groupId: gA.id } });
    await ctx.prisma.externalIdentity.create({ data: { system: "BC", kind: "GROUP_KEY", rawValue: "BETA SL", searchValue: "beta sl", groupId: gB.id } });

    const reader = await login(ctx, ctx.accounts.readerEmail, ctx.accounts.readerPassword);
    const { context, page } = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);
    await ctx.startWorker();

    const upload = async (source: string, f: string, anio: string, extraccion = "2026-10-01") => {
      await page.goto(B);
      await page.locator("summary", { hasText: source }).first().click();
      const form = page.locator("details[open]").first();
      await form.locator('input[type="file"]').setInputFiles(f);
      await form.getByLabel(/Año del conjunto/).selectOption(anio);
      await form.getByLabel(/Declaro que el archivo contiene el conjunto anual completo/).check();
      await form.getByLabel("Fecha de extracción").fill(extraccion);
      await form.getByRole("button", { name: "Subir y validar" }).click();
      await page.waitForURL(/\/administracion\/cargas\/[^/]+$/, { timeout: 30000 });
      return page.url().split("/").pop() as string;
    };
    const click = async (name: string | RegExp, ok?: RegExp) => {
      try {
        await page.getByRole("button", { name }).first().click({ timeout: 15000 });
      } catch (e) {
        // Diagnóstico: qué botones y qué pendientes veía la página cuando falló el clic.
        const botones = await page.getByRole("button").allInnerTexts();
        throw new Error(`No se pudo pulsar «${String(name)}»: botones visibles [${botones.join(" | ")}]; ${(e as Error).message.split("\n")[0]}`);
      }
      // Con la acción terminada el servidor devuelve el aviso y la ficha se refresca con la versión nueva: se espera a verlo.
      if (ok) {
        try {
          await page.getByText(ok).first().waitFor({ timeout: 20000 });
        } catch {
          const avisos = await page.locator(".notice").allInnerTexts();
          throw new Error(`Tras pulsar «${String(name)}» no apareció ${String(ok)}; avisos visibles: ${JSON.stringify(avisos).slice(0, 600)}`);
        }
      }
      await page.waitForLoadState("networkidle");
    };
    const confirm = async () => {
      await page.getByRole("button", { name: "Confirmar y activar" }).click();
      return waitStatus(page, "Completado");
    };
    const reason = async (text: string) => {
      await page.getByLabel(/Motivo/).first().fill(text);
    };

    await page.goto(B);
    const home = await body(page);
    ctx.check("CSAPP-05: Cargas ofrece las tres fuentes financieras y ya no queda ninguna fuente pendiente", (await page.locator("summary", { hasText: "Facturación · soporte" }).count()) === 1 && (await page.locator("summary", { hasText: "Facturación · administración delegada" }).count()) === 1 && (await page.locator("summary", { hasText: "Facturación · otros" }).count()) === 1 && !/No disponible · pendiente/.test(home));

    // ============================================================ Soporte 2026 (para comprobar que otros ámbitos no se tocan)
    await writeFile(file("soporte.xlsx"), await financeXlsx([{ grupo: "ACME SA", vta: 7, dif: 1 }], { category: "SOPORTE", total: { vta: 7, dif: 1 } }));
    await upload("Facturación · soporte", file("soporte.xlsx"), "2026");
    ctx.check("Soporte 2026: se prepara con el pie verificado y el Total conciliado; es el primer conjunto del ámbito", (await waitStatus(page, "Listo para revisar")) && (await waitBody(page, /verificado/)) && (await waitBody(page, /concilia/)));
    await click("Revisar el impacto frente al conjunto vigente", /Impacto revisado frente al conjunto vigente/);
    ctx.check("Soporte 2026: tras revisar el impacto se puede confirmar y activar", await confirm());

    // ============================================================ Administración delegada 2026: pendientes, decisiones, activación
    await writeFile(file("admin1.xlsx"), await financeXlsx([{ grupo: "ACME SA", vta: 12000, dif: 100 }, { grupo: "BETA SL", vta: 2400, dif: -50 }, { grupo: "GAMMA SA", vta: 600, dif: 0 }], { category: "ADMIN_DELEGADA", total: { vta: 15000, dif: 50 } }));
    const a1 = await upload("Facturación · administración delegada", file("admin1.xlsx"), "2026");
    ctx.check("Admin delegada 2026: la vista previa muestra año/categoría, conciliación contra el Total y el impacto (primer conjunto)", (await waitStatus(page, "Listo para revisar")) && (await waitBody(page, /Administración delegada 2026/)) && (await waitBody(page, /15\.000,00 €/)) && (await waitBody(page, /ninguno/)));
    ctx.check("Admin delegada 2026: GAMMA SA sin Grupo Cliente bloquea la confirmación (y el botón está deshabilitado)", /1 grupos? de origen sin Grupo Cliente|1 fila\(s\) sin Grupo Cliente/.test(await body(page)) && (await page.getByRole("button", { name: "Confirmar y activar" }).isDisabled()));
    await click("Aceptar que queden fuera de los informes atribuidos", /Decisión guardada y auditada/);
    await click("Revisar el impacto frente al conjunto vigente", /Impacto revisado frente al conjunto vigente/);
    ctx.check("Admin delegada 2026: con la aceptación expresa y el impacto revisado se confirma; GAMMA queda en el conjunto activo sin grupo (600 €)", (await confirm()) && (await total(ctx, "ADMIN_DELEGADA", 2026)) === "15000" && (await n(ctx, `SELECT count(*) n FROM "FinanceRow" r JOIN "FinanceScope" s ON s."activeBatchId" = r."batchId" WHERE s.category = 'ADMIN_DELEGADA' AND r."groupId" IS NULL`)) === 1);

    // ============================================================ Repetir el mismo archivo
    const a2 = await upload("Facturación · administración delegada", file("admin1.xlsx"), "2026");
    ctx.check("Repetición: el impacto del mismo archivo muestra 0 modificados/nuevos/retirados y 3 sin cambios", (await waitStatus(page, "Listo para revisar")) && (await waitBody(page, /\b0 \/ 0 \/ 0 \/ 3\b/)));
    await click("Aceptar que queden fuera de los informes atribuidos", /Decisión guardada y auditada/);
    await click("Revisar el impacto frente al conjunto vigente", /Impacto revisado frente al conjunto vigente/);
    ctx.check("Repetición: se activa sin duplicar ni dejar a cero (sigue siendo 15.000 €, no 30.000)", (await confirm()) && (await total(ctx, "ADMIN_DELEGADA", 2026)) === "15000");

    // ============================================================ Sustitución con retirada (BETA SL desaparece)
    await writeFile(file("admin2.xlsx"), await financeXlsx([{ grupo: "ACME SA", vta: 12000, dif: 100 }, { grupo: "GAMMA SA", vta: 600, dif: 0 }], { category: "ADMIN_DELEGADA", total: { vta: 12600, dif: 100 } }));
    const a3 = await upload("Facturación · administración delegada", file("admin2.xlsx"), "2026");
    ctx.check("Sustitución: el impacto indica 1 grupo retirado y el total pasa de 15.000 a 12.600 antes de activar", (await waitStatus(page, "Listo para revisar")) && (await waitBody(page, /\b0 \/ 0 \/ 1 \/ 2\b/)) && (await waitBody(page, /15\.000,00 € → 12\.600,00 €/)));
    ctx.check("Sustitución: preparar y revisar no cambian los hechos activos", (await total(ctx, "ADMIN_DELEGADA", 2026)) === "15000");
    await click("Aceptar que queden fuera de los informes atribuidos", /Decisión guardada y auditada/);
    await click("Revisar el impacto frente al conjunto vigente", /Impacto revisado frente al conjunto vigente/);
    ctx.check("Sustitución: al activar, BETA SL se retira (12.600 €, no 27.600) y soporte 2026 queda intacto", (await confirm()) && (await total(ctx, "ADMIN_DELEGADA", 2026)) === "12600" && (await total(ctx, "SOPORTE", 2026)) === "7" && (await n(ctx, `SELECT count(*) n FROM "FinanceRow" r JOIN "FinanceScope" s ON s."activeBatchId" = r."batchId" WHERE s.category = 'ADMIN_DELEGADA' AND r."sourceKey" = 'beta sl'`)) === 0);

    // ============================================================ Reversión: restaura el predecesor completo
    await page.goto(`${B}/${a3}`);
    await page.getByRole("button", { name: "Revertir" }).click();
    ctx.check("Reversión: revertir el lote vigente restaura el conjunto anterior completo (15.000 € con BETA SL)", await waitDb(async () => (await total(ctx, "ADMIN_DELEGADA", 2026)) === "15000", 60000) && (await total(ctx, "SOPORTE", 2026)) === "7");
    await page.goto(`${B}/${a1}`);
    await page.reload();
    ctx.check("Reversión: un lote sustituido no se puede revertir saltándose el posterior (el botón explica por qué)", (await page.getByRole("button", { name: "Revertir" }).isDisabled()) && /sustituido|revierta primero/.test(await body(page)));
    void a2;

    // ============================================================ Otros 2026: vacío de ingreso con decisión específica
    await writeFile(file("otros.xlsx"), await financeXlsx([{ grupo: "ACME SA", vta: 100, dif: 5 }, { grupo: "BETA SL", vta: null, dif: 40 }], { category: "OTROS", total: { vta: 100, dif: 45 } }));
    await upload("Facturación · otros", file("otros.xlsx"), "2026");
    ctx.check("Otros 2026: una Vta Potencial vacía bloquea sin decisión (no usa «Diferencia»)", (await waitStatus(page, "Listo para revisar")) && (await waitBody(page, /Vta Potencial vacía/)) && (await page.getByRole("button", { name: "Confirmar y activar" }).isDisabled()));
    await click("Tratar los vacíos como cero en este lote");
    ctx.check("Otros 2026: sin motivo el servidor rechaza la decisión", (await waitBody(page, /Indique el motivo/)) && (await n(ctx, 'SELECT count(*) n FROM "FinanceDecision"')) === 3);
    await reason("El Total del archivo confirma que el vacío es cero");
    await page.waitForTimeout(500);
    await click("Tratar los vacíos como cero en este lote", /Decisión guardada y auditada/);
    await click(/Revisar el impacto|Actualizar la revisión/, /Impacto revisado frente al conjunto vigente/);
    ctx.check("Otros 2026: con motivo y revisión se activa; el vacío conserva su origen y queda como cero derivado (la Diferencia 40 no pasa al ingreso)", (await confirm()) && (await total(ctx, "OTROS", 2026)) === "100" && (await n(ctx, `SELECT count(*) n FROM "FinanceRow" WHERE "incomeDerivedZero" AND "incomeOriginal" IS NULL AND income = 0 AND difference = 40`)) === 1);

    // ============================================================ Comprobación económica: 12000 → 500 a 15/30
    await ctx.prisma.serviceAssignment.create({ data: { matchKind: "WRIKE_PROJECT", matchValue: "Proyecto Fin", searchValue: "proyecto fin", service: "ADMIN_DELEGADA" } });
    await page.goto(`${ctx.base}/administracion/economia`);
    await page.getByLabel("Grupo Cliente").selectOption(gA.id);
    await page.getByLabel("Servicio").selectOption("ADMIN_DELEGADA");
    await page.getByLabel("Fecha de análisis").fill("2026-06-15");
    await page.getByRole("button", { name: "Calcular" }).click();
    await page.waitForLoadState("networkidle");
    const eco = await body(page);
    ctx.check("Comprobación económica: anual 12.000 €, corte 15 de un mes de 30 días → 500,00 € del mes (motor de producción)", /Mes seleccionado[\s\S]{0,200}500,00 €/.test(eco) && /eco-v1/.test(eco));
    ctx.check("Comprobación económica: muestra periodos, referencia de configuración y lotes vigentes con enlaces", /CUM actual/.test(eco) && /Año anterior completo/.test(eco) && /CUM anterior comparable/.test(eco) && /revisión 1: objetivo 550,00 €\/jornada/.test(eco) && (await page.locator('a[href*="/administracion/cargas/"]').count()) > 0);
    ctx.check("Comprobación económica: sin horas sin servicio, un ingreso conocido y cero horas no inventa un ratio (no calculable, nunca infinito)", /cero horas|Sin horas/.test(eco));
    await page.getByLabel("Modo").selectOption("FULL_MONTH");
    await page.getByRole("button", { name: "Calcular" }).click();
    await page.waitForLoadState("networkidle");
    ctx.check("Comprobación económica: en «mes completo» el mes equivale a la base mensual (1.000,00 €) y deja de ser provisional", /Mes seleccionado[\s\S]{0,200}1\.000,00 €/.test(await body(page)));
    const detalle = await body(page);
    ctx.check("Comprobación económica: el detalle paginado enlaza ingresos con su lote", /Detalle de ingresos y lotes vigentes/.test(detalle) && /ACME SA/.test(detalle));

    // ============================================================ Configuración: revisiones y edición obsoleta
    const second = await ctx.browser.newContext();
    const p2 = await second.newPage();
    const adminEmail = ctx.accounts.adminEmail;
    await p2.goto(`${ctx.base}/login`);
    await p2.getByLabel("Correo electrónico").fill(adminEmail);
    await p2.getByLabel("Contraseña").fill(ctx.accounts.adminPassword);
    await p2.getByRole("button", { name: "Entrar" }).click();
    await p2.waitForURL((u) => !u.pathname.startsWith("/login"));
    await page.goto(`${ctx.base}/administracion/configuracion`);
    await p2.goto(`${ctx.base}/administracion/configuracion`);
    await p2.getByLabel(/Objetivo/).fill("600");
    await p2.getByRole("button", { name: "Guardar nueva revisión" }).click();
    ctx.check("Configuración: se guarda una nueva revisión inmutable (600 €/jornada) con autor y auditoría", await waitDb(async () => (await n(ctx, 'SELECT count(*) n FROM "EconomicSettingsRevision"')) === 2) && (await n(ctx, `SELECT count(*) n FROM "AuditEvent" WHERE "entityType" = 'EconomicSettings'`)) === 1);
    await page.getByLabel(/Objetivo/).fill("700");
    await page.getByRole("button", { name: "Guardar nueva revisión" }).click();
    ctx.check("Configuración: la edición obsoleta (otra persona guardó antes) se rechaza sin guardar nada", await page.getByText(/modificado por otra persona/).waitFor({ timeout: 15000 }).then(() => true, () => false) && (await n(ctx, 'SELECT count(*) n FROM "EconomicSettingsRevision"')) === 2);
    await second.close();
    await page.goto(`${ctx.base}/administracion/economia?grupo=${gA.id}&servicio=ADMIN_DELEGADA&fecha=2026-06-15&revision=1`);
    ctx.check("Comprobación económica: consultar con una revisión anterior es un recálculo identificado", /recálculo identificado con una revisión anterior/.test(await body(page)));

    // ============================================================ Servicio económico
    await page.goto(`${ctx.base}/administracion/servicios`);
    await page.locator("summary", { hasText: "Añadir asignación" }).click();
    const f = page.locator("details[open]").filter({ hasText: "Valor exacto" }).last();
    await f.getByLabel("Valor exacto").fill("Entorno Fin");
    await f.getByRole("button", { name: "Añadir asignación" }).click();
    ctx.check("Servicio económico: la asignación por Entorno y Tipología se guarda con auditoría (sin semillas inventadas)", await waitDb(async () => (await n(ctx, `SELECT count(*) n FROM "ServiceAssignment" WHERE "searchValue" = 'entorno fin'`)) === 1) && (await n(ctx, `SELECT count(*) n FROM "AuditEvent" WHERE "entityType" = 'ServiceAssignment'`)) === 1);
    await page.goto(`${ctx.base}/administracion/servicios`);
    await page.locator("summary", { hasText: "Añadir asignación" }).click();
    const f2 = page.locator("details[open]").filter({ hasText: "Valor exacto" }).last();
    await f2.getByLabel("Valor exacto").fill("entorno FIN");
    await f2.getByRole("button", { name: "Añadir asignación" }).click();
    ctx.check("Servicio económico: una asignación solapada del mismo valor se rechaza", await page.getByText(/se solapa/).first().waitFor({ timeout: 15000 }).then(() => true, () => false) && (await n(ctx, `SELECT count(*) n FROM "ServiceAssignment" WHERE "searchValue" = 'entorno fin'`)) === 1);

    // ============================================================ Permisos
    await reader.page.goto(B);
    ctx.check("CSAPP-05: Consulta no llega a Cargas", !reader.page.url().endsWith("/administracion/cargas"));
    await reader.page.goto(`${ctx.base}/administracion/configuracion`);
    ctx.check("CSAPP-05: Consulta ve la configuración pero sin formulario de edición", /Revisión vigente/.test(await body(reader.page)) && (await reader.page.getByRole("button", { name: "Guardar nueva revisión" }).count()) === 0);
    await reader.page.goto(`${ctx.base}/administracion/economia?grupo=${gA.id}&servicio=ADMIN_DELEGADA&fecha=2026-06-15`);
    ctx.check("CSAPP-05: Consulta puede usar la comprobación económica (lectura) sin enlaces al detalle de lotes", /Mes seleccionado/.test(await body(reader.page)) && !/Detalle de ingresos y lotes vigentes/.test(await body(reader.page)));
    await reader.page.goto(`${ctx.base}/administracion/servicios`);
    ctx.check("CSAPP-05: Consulta revisa las asignaciones de servicio sin poder modificarlas", (await reader.page.getByRole("button", { name: "Añadir asignación" }).count()) === 0 && /perfil es de consulta/.test(await body(reader.page)));
    const before = await n(ctx, 'SELECT count(*) n FROM "FinanceDecision"');
    const forged = await reader.context.request.post(`${ctx.base}/administracion/cargas/${a3}`, { form: { id: a3, kind: "ACCEPT_UNASSIGNED" } });
    ctx.check("CSAPP-05: una petición forjada de Consulta no crea decisiones ni auditoría de éxito", forged.status() !== 500 && (await n(ctx, 'SELECT count(*) n FROM "FinanceDecision"')) === before);
    await reader.context.close();
    await context.close();
  } finally {
    await ctx.stopWorker();
    await rm(dir, { recursive: true, force: true });
  }
}
