import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import type { Ctx } from "../nucleo";
import { login } from "./util";
import { todayMadrid } from "../../../src/domain/vigencia";
import { guardedTruncate, resolveTestTarget } from "../../../src/lib/test-guard";

/**
 * Revisión visual de Comparativa (HOTFIX-02 §6–7 y «Revisión visual obligatoria»): datos SINTÉTICOS con nombres largos, cifras grandes, mezcla de
 * soportes, ausentes y un error real; mide la geometría real (scrollWidth/clientWidth del contenedor y del documento) a 1920×1080, 1536×864 y 390 px.
 * Capturas en E2E_CAPTURAS (nada nominativo: todo se genera aquí). Solo base `_test`.
 */
const SIZES = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1536x864", width: 1536, height: 864 },
  { name: "390x844", width: 390, height: 844 },
] as const;

async function geometry(page: Page) {
  return page.evaluate(() => {
    const sc = document.querySelector(".cmp2-scroll") as HTMLElement | null;
    const t = document.querySelector("table.cmp2") as HTMLElement | null;
    const rows = [...document.querySelectorAll("table.cmp2 tbody tr")] as HTMLElement[];
    const heights = rows.map((r) => r.getBoundingClientRect().height);
    const firstRowCells = rows[0] ? ([...rows[0].children] as HTMLElement[]) : [];
    const overlaps = firstRowCells.some((c, i) => i > 0 && c.getBoundingClientRect().left < firstRowCells[i - 1].getBoundingClientRect().right - 1);
    const main = document.querySelector("main") as HTMLElement;
    return {
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth,
      scrollW: sc?.scrollWidth ?? -1,
      clientW: sc?.clientWidth ?? -1,
      tableW: t?.getBoundingClientRect().width ?? -1,
      mainW: main.getBoundingClientRect().width,
      mainMaxWidth: getComputedStyle(main).maxWidth,
      rowMin: Math.min(...heights),
      rowMax: Math.max(...heights),
      rowCount: rows.length,
      fontPx: t ? getComputedStyle(t).fontSize : "",
      overlaps,
      // Celdas numéricas o de texto (salvo el nombre, que se abrevia con «…» y conserva el nombre completo) cuyo contenido no cabe: debe ser 0.
      clipped: ([...document.querySelectorAll("table.cmp2 tbody td, table.cmp2 tfoot td")] as HTMLElement[]).filter((c) => c.scrollWidth > c.clientWidth + 1).length,
      wrappedRows: rows.filter((r) => r.getBoundingClientRect().height > 31).length,
    };
  });
}

export async function visualComparativa(ctx: Ctx): Promise<void> {
  const today = todayMadrid();
  const admin = await ctx.prisma.user.findUniqueOrThrow({ where: { email: ctx.accounts.adminEmail } });
  await guardedTruncate(ctx.prisma, resolveTestTarget(), ["FinanceRow", "FinanceBatch", "FinanceScope", "ZdTimeEntry", "WrikeTimeEntry", "ZdTicketObservation", "ZdTicketRevision", "ZdTicket", "UserMatrixMonth", "UserMatrix", "ServiceTerm", "ServiceAssignment", "ExternalIdentity", "Milestone", "Implementation", "Client", "ClientGroup", "PapCause", "PapRevision", "PapItem", "UploadBatch", "Product", "PersonTerm", "PersonAlias", "StaffCatalogItem", "Person"]);
  // La base de pruebas se vació: la revisión 1 de la configuración económica se repone ANTES de abrir pantallas (la migración la crea en instalaciones reales).
  await (await import("../../../src/server/economics/settings")).ensureInitialSettings(ctx.prisma);
  const { seedAnalitica } = await import("../../../tests/generators/analitica");
  const w = await seedAnalitica(admin.id, today, 40);
  // Casos extremos sintéticos: nombre larguísimo, cifras grandes, mezcla de soportes/servidores y un Grupo sin atributos.
  const longName = "Corporación Internacional de Servicios Tecnológicos y Telecomunicaciones del Mediterráneo Occidental, Sociedad Anónima Unipersonal";
  await ctx.prisma.clientGroup.update({ where: { id: w.cenit.id }, data: { name: longName } });
  await ctx.prisma.financeRow.updateMany({ where: { groupId: w.atlas.id }, data: { income: "12345678.90" } });
  await ctx.prisma.serviceTerm.create({ data: { attribute: "HOSTING", value: "OP", clientId: w.c2.id } });
  await ctx.prisma.serviceTerm.create({ data: { attribute: "HOSTING", value: "CLOUD", clientId: w.a2.id } });
  await ctx.prisma.serviceTerm.create({ data: { attribute: "SUPPORT", value: "SILVER_ON_DEMAND", clientId: w.a2.id } });

  const shots = process.env.E2E_CAPTURAS;
  if (shots) await mkdir(shots, { recursive: true });
  const adm = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);
  const page = adm.page;
  const out: Record<string, unknown> = {};
  for (const s of SIZES) {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.goto(`${ctx.base}/comparativa`);
    await page.waitForSelector("table.cmp2", { timeout: 15000 }).catch(async () => {
      throw new Error(`Sin tabla en ${s.name}: ${(await page.locator("main").innerText()).slice(0, 900)}`);
    });
    const g = await geometry(page);
    out[s.name] = g;
    console.log(`GEOMETRIA ${s.name} ${JSON.stringify(g)}`);
    if (shots) await page.screenshot({ path: path.join(shots, `comparativa-${s.name}.png`) });
    if (s.width === 1920) {
      const dets = page.locator("table.cmp2 tbody details.nd").first();
      if ((await dets.count()) > 0) {
        await dets.locator("summary").click();
        if (shots) await page.screenshot({ path: path.join(shots, `comparativa-${s.name}-explicacion.png`) });
        await dets.locator("summary").click();
      }
    }
    if (s.width === 390 && shots) await page.screenshot({ path: path.join(shots, `comparativa-${s.name}-pagina.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`${ctx.base}/comparativa?soporte=GOLD&servidor=CLOUD`);
  if (shots) await page.screenshot({ path: path.join(shots, "comparativa-1920x1080-gold-cloud.png") });
  ctx.check("Visual: la tabla compacta con todos los bloques cabe a 1920×1080 sin scroll horizontal del contenedor ni del documento", (out["1920x1080"] as { scrollW: number; clientW: number; docScrollW: number; docClientW: number }).scrollW <= (out["1920x1080"] as { clientW: number }).clientW && (out["1920x1080"] as { docScrollW: number }).docScrollW <= (out["1920x1080"] as { docClientW: number }).docClientW, JSON.stringify(out["1920x1080"]));
  // Error real: se rompe la lectura de verdad (tabla renombrada en la base de test) y después se restablece.
  await ctx.prisma.$executeRawUnsafe('ALTER TABLE "FinanceRow" RENAME TO "FinanceRow_x"');
  try {
    await page.goto(`${ctx.base}/comparativa`);
    await page.waitForSelector(".cmp-error");
    if (shots) await page.screenshot({ path: path.join(shots, "comparativa-1920x1080-error.png") });
    ctx.check("Visual: un error real de lectura muestra mensaje y Reintentar", (await page.getByRole("link", { name: "Reintentar" }).count()) === 1);
  } finally {
    await ctx.prisma.$executeRawUnsafe('ALTER TABLE "FinanceRow_x" RENAME TO "FinanceRow"');
  }
  await adm.context.close();
}
