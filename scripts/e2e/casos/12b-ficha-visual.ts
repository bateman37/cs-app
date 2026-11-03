import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import type { Ctx } from "../nucleo";
import { login } from "./util";
import { todayMadrid } from "../../../src/domain/vigencia";
import { guardedTruncate, resolveTestTarget } from "../../../src/lib/test-guard";

/**
 * Revisión visual de la ficha de Análisis Cliente (HOTFIX-02 §12): datos sintéticos representativos, capturas a 1920×1080, 1536×864 y 390 px y
 * medidas de geometría (sin desplazamiento horizontal del documento; gráficos y los tres cuadros en la primera pantalla). Salida en E2E_CAPTURAS.
 * Solo base `_test`; las capturas y el JSON de medidas son sintéticos y NO se versionan.
 */
type Box = { x: number; y: number; w: number; h: number; bottom: number; right: number };
async function geometry(page: Page) {
  const html = await page.content();
  if (!/fc-root/.test(html)) throw new Error(`La página no es la ficha: ${page.url()} · ${html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200)}`);
  // Texto JS plano (sin TypeScript): tsx/esbuild inyecta ayudantes (__name) en las funciones que se serializan a la página.
  return page.evaluate(GEOMETRY_JS) as Promise<Geometry>;
}

type Geometry = { viewport: { w: number; h: number }; docScrollW: number; hScroll: number; docH: number; mainW: number | null; rootW: number | null; head: Box | null; summary: Box | null; charts: (Box & { title: string | null })[]; tables: (Box & { title: string | null; scrollW: number; clientW: number })[]; rowH: { min: number; max: number; n: number }; fontPx: { min: number; max: number }; overflowing: string[]; tabs: number };

const GEOMETRY_JS = `(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom + window.scrollY), right: Math.round(r.right) };
  };
  const vw = window.innerWidth;
  const doc = document.documentElement;
  const charts = [...document.querySelectorAll(".fc-card")].map((e) => ({ title: e.getAttribute("aria-label"), ...box(e) }));
  const tables = [...document.querySelectorAll(".fc-tcard")].map((e) => { const sc = e.querySelector(".fc-scroll"); return { title: e.getAttribute("aria-label"), ...box(e), scrollW: sc ? sc.scrollWidth : 0, clientW: sc ? sc.clientWidth : 0 }; });
  const rows = [...document.querySelectorAll(".fc-tbl tbody tr")].map((e) => e.getBoundingClientRect().height);
  const fonts = [...document.querySelectorAll(".fc-tbl td, .fc-tbl th")].map((e) => parseFloat(getComputedStyle(e).fontSize));
  const over = [];
  document.querySelectorAll("main *").forEach((e) => {
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.right > vw + 1 && !e.closest(".fc-scroll, .fc-eq, .fc-sum, .fc-pop-list, .fc-tip, .fc-na-pop")) over.push((e.tagName.toLowerCase() + "." + String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className)).slice(0, 60));
  });
  const main = document.querySelector("main");
  const root = document.querySelector(".fc-root");
  return {
    viewport: { w: vw, h: window.innerHeight },
    docScrollW: doc.scrollWidth, hScroll: doc.scrollWidth - vw, docH: doc.scrollHeight,
    mainW: main ? Math.round(main.getBoundingClientRect().width) : null, rootW: root ? Math.round(root.getBoundingClientRect().width) : null,
    head: box(document.querySelector(".fc-head")), summary: box(document.querySelector(".fc-sum")),
    charts, tables,
    rowH: { min: rows.length ? Math.min(...rows) : 0, max: rows.length ? Math.max(...rows) : 0, n: rows.length },
    fontPx: { min: fonts.length ? Math.min(...fonts) : 0, max: fonts.length ? Math.max(...fonts) : 0 },
    overflowing: [...new Set(over)].slice(0, 12),
    tabs: document.querySelectorAll('[role="tab"], .tabs').length,
  };
})()`;

export async function fichaVisual(ctx: Ctx): Promise<void> {
  const today = todayMadrid();
  const admin = await ctx.prisma.user.findUniqueOrThrow({ where: { email: ctx.accounts.adminEmail } });
  await guardedTruncate(ctx.prisma, resolveTestTarget(), ["FinanceRow", "FinanceBatch", "FinanceScope", "ZdTimeEntry", "WrikeTimeEntry", "ZdTicketObservation", "ZdTicketRevision", "ZdTicket", "UserMatrixMonth", "UserMatrix", "ServiceTerm", "ServiceAssignment", "ExternalIdentity", "Milestone", "Implementation", "Client", "ClientGroup", "PapCause", "PapRevision", "PapItem", "UploadBatch", "Product", "PersonTerm", "PersonAlias", "StaffCatalogItem", "Person"]);
  const { seedFicha } = await import("../../../tests/generators/ficha");
  const w = await seedFicha(admin.id, today);
  const dir = process.env.E2E_CAPTURAS ?? "";
  if (dir) await mkdir(dir, { recursive: true });
  const out: Record<string, unknown> = {};
  const shot = async (page: Page, name: string, full = false) => {
    if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: full });
  };
  const adm = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);
  const page = adm.page;
  const wait = async () => { await page.waitForLoadState("networkidle"); await page.waitForTimeout(400); };
  const u = (q: string) => `${ctx.base}/analisis-cliente?${q}`;
  const group = `ambito=group&id=${w.big.id}&volver=${encodeURIComponent("orden=name&soporte=GOLD&servidor=CLOUD")}&soporte=GOLD&servidor=CLOUD`;

  for (const [name, vw, vh] of [["1920", 1920, 1080], ["1536", 1536, 864], ["390", 390, 844]] as const) {
    await page.setViewportSize({ width: vw, height: vh });
    await page.goto(u(group));
    await wait();
    const g = await geometry(page);
    out[`grupo-${name}`] = g;
    await shot(page, `ficha-grupo-${name}-pantalla`);
    await shot(page, `ficha-grupo-${name}-completa`, true);
    const firstScreen = g.charts.every((c) => c.bottom <= vh) && g.tables.every((t) => t.bottom <= vh);
    ctx.check(`${name}: sin desplazamiento horizontal del documento`, g.hScroll <= 1, `scrollWidth ${g.docScrollW} / ${vw}`);
    ctx.check(`${name}: sin pestañas y con los cinco gráficos y los tres cuadros`, g.tabs === 0 && g.charts.length === 5 && g.tables.length === 3, `${g.charts.length} gráficos, ${g.tables.length} cuadros`);
    if (vw >= 1900) {
      ctx.check("1920: los cinco gráficos y los tres cuadros caben en la primera pantalla (1080 px)", firstScreen, JSON.stringify({ charts: g.charts.map((c) => c.bottom), tables: g.tables.map((t) => t.bottom) }));
      ctx.check("1920: ficha sin expansión vertical descontrolada (documento ≤ 1.25 × viewport)", g.docH <= vh * 1.25, `${g.docH} px`);
      ctx.check("1920: tablas 11–12 px y filas 26–30 px", g.fontPx.min >= 10.5 && g.fontPx.max <= 12.5 && g.rowH.min >= 25 && g.rowH.max <= 31, JSON.stringify({ f: g.fontPx, r: g.rowH }));
      ctx.check("1920: las tablas no necesitan desplazamiento horizontal interno", g.tables.every((t) => t.scrollW <= t.clientW + 1), JSON.stringify(g.tables.map((t) => [t.scrollW, t.clientW])));
      ctx.check("1920: ancho real del contenedor (sin límite estrecho)", (g.rootW ?? 0) >= 1700, `${g.rootW}`);
    }
  }

  await page.setViewportSize({ width: 1920, height: 1080 });
  // Cliente, implantación, ausentes, base cero, heterogéneo, mega cuenta
  for (const [name, q] of [
    ["cliente", `ambito=client&id=${w.vn.id}`],
    ["cliente-largo", `ambito=client&id=${w.ex.id}`],
    ["implantacion", `ambito=implementation&id=${w.implA.id}`],
    ["sin-ingreso-actual", `ambito=group&id=${w.nov.id}`],
    ["base-cero", `ambito=group&id=${w.zero.id}`],
    ["heterogeneo", `ambito=group&id=${w.mixed.id}`],
    ["mega", `ambito=group&id=${w.mega.id}`],
    ["mes-completo-feb", `ambito=group&id=${w.big.id}&fecha=${Number(today.slice(0, 4))}-02-28&modo=FULL_MONTH`],
    ["febrero-bisiesto", `ambito=group&id=${w.big.id}&fecha=2024-02-29&modo=CUTOFF`],
    ["enero", `ambito=group&id=${w.big.id}&fecha=${Number(today.slice(0, 4))}-01-31&modo=FULL_MONTH`],
    ["objeto-inexistente", `ambito=group&id=zzzzzzzzzzzz`],
    ["detalle-horas", `ambito=group&id=${w.big.id}&det=horas&periodo=cum`],
    ["exportar", `ambito=group&id=${w.big.id}&det=exportar`],
  ] as const) {
    await page.goto(u(q));
    await wait();
    const g = await geometry(page);
    out[name] = g;
    await shot(page, `ficha-${name}-1920`);
    ctx.check(`1920 · ${name}: sin desplazamiento horizontal del documento`, g.hScroll <= 1, `scrollWidth ${g.docScrollW}`);
  }

  // Interacción: tooltip del gráfico, tabla equivalente, cifra no disponible, selector de objeto
  await page.goto(u(group));
  await wait();
  const chart = page.locator(".fc-card").first();
  const band = chart.locator(".fc-band").nth(3);
  await band.hover();
  await page.waitForTimeout(200);
  const tipText = await chart.locator(".fc-tip").innerText().catch(() => "");
  ctx.check("el tooltip del gráfico muestra actual, mismo mes anterior, diferencia y variación", /Diferencia/.test(tipText) && /Variación/.test(tipText), tipText.replace(/\n/g, " | "));
  await shot(page, "ficha-tooltip-1920");
  await chart.getByRole("button", { name: "Tabla" }).click();
  ctx.check("la tabla equivalente muestra los doce meses con el mismo conjunto de datos", (await chart.locator(".fc-eq tbody tr").count()) === 12);
  await shot(page, "ficha-tabla-equivalente-1920");
  await page.locator(".fc-pop-menu > summary", { hasText: "Objeto" }).click();
  await shot(page, "ficha-selector-objeto-1920");
  const objLinks = await page.locator(".fc-pop-list").first().locator("a").count();
  ctx.check("el selector de objeto ofrece Grupo, Clientes e implantaciones", objLinks >= 5, `${objLinks}`);
  await page.keyboard.press("Escape");
  await page.goto(u(`ambito=client&id=${w.vn.id}`));
  await wait();
  const naBtn = page.locator(".fc-na").first();
  await naBtn.click();
  const popText = await page.locator(".fc-na-pop").first().innerText().catch(() => "");
  ctx.check("una cifra no disponible es «—» con explicación al clic", /Ingreso agrupado|Grupo Cliente/.test(popText), popText);
  await shot(page, "ficha-cifra-no-disponible-1920");

  // Volver conserva periodo y filtros
  await page.goto(u(group + `&fecha=${Number(today.slice(0, 4)) - 1}-06-30&modo=FULL_MONTH`));
  await wait();
  const back = await page.locator(".fc-back").first().getAttribute("href");
  ctx.check("volver a Comparativa conserva periodo y filtros Soporte/Servidor", !!back && /soporte=GOLD/.test(back) && /servidor=CLOUD/.test(back) && /fecha=/.test(back) && /modo=FULL_MONTH/.test(back) && /orden=name/.test(back), back ?? "sin enlace");
  // Parámetros obsoletos no filtran ni se arrastran
  await page.goto(u(group + "&alojamiento=OP&complejidad=BASIC&producto=X&estado=inactivos&pestana=pap&q=zzz"));
  await wait();
  const links = await page.locator("main a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""));
  ctx.check("los parámetros obsoletos de la URL no se arrastran a los enlaces de la ficha", !links.some((h) => /alojamiento|complejidad|producto|estado=|pestana|[?&]q=/.test(h)));
  ctx.check("la ficha no tiene pestañas aunque la URL antigua pida «pestana»", (await page.locator('.tabs, [role="tab"]').count()) === 0 && (await page.locator(".fc-card").count()) === 5);

  if (dir) await writeFile(path.join(dir, "geometria.json"), JSON.stringify(out, null, 2));
  await adm.context.close();
}
