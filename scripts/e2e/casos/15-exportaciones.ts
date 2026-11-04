import { createHash } from "node:crypto";
import type { Page } from "playwright";
import type { Ctx } from "../nucleo";
import { login, newContext } from "./util";
import { guardedTruncate, resolveTestTarget } from "../../../src/lib/test-guard";

/**
 * Exportaciones completas y conciliación (CSAPP-09 §10 punto 4) por el navegador, sobre el `next start` y el trabajador COMPILADOS, con fixtures SINTÉTICAS
 * aisladas. Cubre: solicitar, ver el progreso hasta «Listo», salir y volver, DESCARGAR y verificar el contenido (recuento, suma, checksum, BOM), cancelar,
 * reintentar, caducar, rechazo por permiso (sin sesión, Consulta ajena, UUID manipulado), aviso sin trabajador, supervisión y conciliación con descargas.
 */
const body = (p: Page) => p.locator("main").innerText();
const MASTERS = ["ExportFile", "ExportRow", "ExportJob", "ReconRun", "HealthFeedbackEvent", "HealthFeedback", "QualityNote", "UploadCoverageDeclaration", "WorkItemLinkEvidence", "WorkItemLink", "WorkItemObservation", "WorkItemRevision", "WorkItem", "FinanceRow", "FinanceBatch", "FinanceScope", "PapCause", "PapRevision", "PapItem", "ZdTimeEntry", "ZdTicketObservation", "ZdTicketRevision", "ZdTicket", "ServiceAssignment", "UserMatrixMonth", "UserMatrix", "ServiceTerm", "ExternalIdentity", "Client", "ClientGroup"];

export async function exportaciones(ctx: Ctx): Promise<void> {
  const admin = await ctx.prisma.user.findUniqueOrThrow({ where: { email: ctx.accounts.adminEmail } });
  await guardedTruncate(ctx.prisma, resolveTestTarget(), MASTERS).catch(() => undefined);
  const h = await import("../../../tests/economia-helpers");
  const c = await import("../../../tests/calidad-helpers");
  const run = await import("../../../src/server/exports/run");
  const atlas = await h.addGroup("Grupo Export");
  const cl = await h.addClient("Cliente Export", atlas.id);
  const zb = await c.batchOf(admin.id, "zendesk-tiempo");
  // La pantalla de Calidad exporta con SU servicio (Soporte por defecto): las horas del fixture se atribuyen a Soporte por Entorno y Tipología.
  await h.serviceAssignment({ matchKind: "ENTORNO", matchValue: "soporte", service: "SOPORTE" });
  await h.addTicket(zb.id, { ticketId: "EXP", entorno: "Soporte" });
  const N = 1300; // varios bloques de 500 filas
  for (let i = 1; i <= N; i++) await h.addZd({ batchId: zb.id, date: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`, minutes: 1 + (i % 7), groupId: atlas.id, clientId: cl.id, ticketId: "EXP" });
  const expectedSum = (await ctx.prisma.$queryRaw<{ m: string }[]>`SELECT sum(minutes)::bigint::text AS m FROM "ZdTimeEntry"`)[0].m;

  // --- Sin trabajador: el aviso es visible (no un spinner indefinido) y se puede cancelar
  const adm = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);
  const page = adm.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${ctx.base}/calidad?fecha=2026-10-31&modo=FULL_MONTH`);
  await page.locator("summary", { hasText: "Exportar detalle completo" }).first().click(); // el panel está plegado en el Resumen de clientes
  ctx.check("Exportar: el panel «Exportar detalle completo» muestra alcance, periodo y referencia antes de solicitar", /Exportar detalle completo/.test(await body(page)) && /Alcance:/.test(await body(page)) && /referencia de la pantalla/.test(await body(page)));
  await page.getByLabel("Conjunto").selectOption("horas");
  await page.getByLabel("Desde").fill("2026-10-01");
  await page.getByLabel("Hasta").fill("2026-10-31");
  await page.getByRole("button", { name: "Exportar detalle completo" }).click();
  await page.getByText(/Exportación solicitada/).first().waitFor({ timeout: 15000 });
  await ctx.prisma.exportJob.updateMany({ data: { createdAt: new Date(Date.now() - 5 * 60_000) } }); // antigüedad suficiente para el aviso
  await page.reload();
  const queued = await body(page);
  ctx.check("Exportar: sin trabajador queda «En cola» y avisa de que no hay trabajador activo (sin spinner indefinido)", /En cola/.test(queued) && /No hay un trabajador activo/.test(queued), queued.slice(0, 200));
  await page.getByRole("button", { name: "Cancelar" }).first().click();
  await page.locator("[data-export-status='CANCELLED']").first().waitFor({ timeout: 15000 }); // la tarjeta se vuelve a pintar con el nuevo estado
  ctx.check("Exportar: cancelar una exportación en cola es inmediato y reintentable", (await ctx.prisma.exportJob.findFirstOrThrow()).status === "CANCELLED" && (await page.getByRole("button", { name: "Reintentar" }).count()) > 0);

  // --- Con trabajador: reintentar, progreso hasta «Listo», salir y volver, descargar y verificar el contenido
  await ctx.startWorker();
  await page.getByRole("button", { name: "Reintentar" }).first().click();
  await page.locator("[data-export-status='QUEUED'], [data-export-status='PREPARING'], [data-export-status='GENERATING'], [data-export-status='READY']").first().waitFor({ timeout: 15000 });
  await page.goto(`${ctx.base}/comparativa`); // sale de la pantalla...
  const job = await ctx.prisma.exportJob.findFirstOrThrow();
  const until = Date.now() + 90000;
  let status = job.status as string;
  while (Date.now() < until && status !== "READY" && status !== "FAILED") {
    await new Promise((r) => setTimeout(r, 500));
    status = (await ctx.prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } })).status;
  }
  await page.goto(`${ctx.base}/calidad?fecha=2026-10-31&modo=FULL_MONTH`); // ...y vuelve: el trabajo propio sigue ahí
  const back = await body(page);
  ctx.check("Exportar: se puede salir y volver; el trabajo propio aparece en estado «Listo» con sus archivos y su referencia", status === "READY" && /Listo/.test(back) && /horas_horas\.csv/.test(back) && /manifiesto\.json/.test(back), `${status} ${back.slice(0, 160)}`);
  const done = await ctx.prisma.exportJob.findUniqueOrThrow({ where: { id: job.id }, include: { files: true } });
  const data = done.files.find((f) => f.kind === "DATA");
  const mf = done.files.find((f) => f.kind === "MANIFEST");
  if (!data || !mf) throw new Error("La exportación no tiene archivos");
  const dl = await page.request.get(`${ctx.base}/api/exportaciones/${job.id}/archivo/${data.id}`);
  const buf = await dl.body();
  const text = buf.toString("utf8");
  const lines = text.replace(/^﻿/, "").split("\r\n").filter((l) => l !== "");
  const header = lines[0].split(";");
  const mins = lines.slice(1).reduce((s, l) => s + Number(l.split(";")[header.indexOf("minutos")].replace(",", ".")), 0);
  ctx.check("Descarga: HTTP 200, privada (no-store), CSV UTF-8 con BOM y ';', recuento = filas de la fuente y Σ minutos = Σ de la fuente",
    dl.status() === 200 && /no-store/.test(dl.headers()["cache-control"] ?? "") && text.startsWith("﻿") && lines.length - 1 === N && String(mins) === expectedSum, `${dl.status()} ${lines.length - 1}/${N} ${mins}/${expectedSum}`);
  ctx.check("Descarga: el SHA-256 del archivo descargado coincide con el registrado y con el declarado en la cabecera", createHash("sha256").update(buf).digest("hex") === data.checksum && dl.headers()["x-checksum-sha256"] === data.checksum);
  const manifest = JSON.parse((await (await page.request.get(`${ctx.base}/api/exportaciones/${job.id}/archivo/${mf.id}`)).body()).toString("utf8"));
  ctx.check("Manifiesto JSON descargable con contexto, totales, sello y columnas", manifest.total_filas === N && typeof manifest.sello_datos === "string" && manifest.archivos[0].columnas.length > 5 && manifest.lectura_posterior_a_la_pantalla === false);
  const st = await (await page.request.get(`${ctx.base}/api/exportaciones/${job.id}/estado`)).json();
  ctx.check("Estado de la exportación propia por API (progreso real = total)", st.status === "READY" && st.progressDone === String(N) && st.progressTotal === String(N));

  // --- Permisos: sin sesión, Consulta (otra persona), UUID manipulado, Administración supervisa sin descargar ajenos
  const anon = await newContext(ctx);
  const r0 = await anon.page.request.get(`${ctx.base}/api/exportaciones/${job.id}/archivo/${data.id}`);
  const t0 = await r0.text();
  ctx.check("Permisos: sin sesión la descarga no entrega contenido (el proxy redirige a /login o la ruta responde 401)", (r0.status() === 401 || r0.url().includes("/login")) && !t0.includes("fecha_trabajo"), `${r0.status()} ${r0.url()}`);
  const fake = await anon.context.addCookies([{ name: "better-auth.session_token", value: "falsa.cookie", url: ctx.base }]).then(() => anon.page.request.get(`${ctx.base}/api/exportaciones/${job.id}/estado`));
  ctx.check("Permisos: cookie falsa rechazada", fake.status() === 401);
  const rd = await login(ctx, ctx.accounts.readerEmail, ctx.accounts.readerPassword);
  const r1 = await rd.page.request.get(`${ctx.base}/api/exportaciones/${job.id}/archivo/${data.id}`);
  const r2 = await rd.page.request.get(`${ctx.base}/api/exportaciones/${job.id}/estado`);
  ctx.check("Permisos: Consulta no descarga ni consulta la exportación de otra persona (UUID no autoriza)", r1.status() >= 400 && r2.status() >= 400 && !(await r1.text()).includes("fecha_trabajo"));
  const r3 = await adm.page.request.get(`${ctx.base}/api/exportaciones/${job.id}/archivo/${"00000000-0000-4000-8000-000000000000"}`);
  const r4 = await adm.page.request.get(`${ctx.base}/api/exportaciones/..%2F..%2Fetc/estado`);
  ctx.check("Permisos: ID de archivo o de trabajo manipulado (inexistente o ruta) rechazado sin filtrar nada", r3.status() >= 400 && r4.status() >= 400);
  await rd.page.goto(`${ctx.base}/calidad?fecha=2026-10-31&modo=FULL_MONTH`);
  ctx.check("Consulta ve su propio panel de exportación (sin las exportaciones del Administrador)", /Exportar detalle completo/.test(await body(rd.page)) && !/horas_horas\.csv/.test(await body(rd.page)));
  await rd.page.goto(`${ctx.base}/administracion/exportaciones`);
  ctx.check("Consulta no accede a la supervisión de exportaciones ni a la conciliación", !/Supervisión técnica/.test(await body(rd.page)));
  await adm.page.goto(`${ctx.base}/administracion/exportaciones`);
  const sup = await body(adm.page);
  ctx.check("Administración supervisa estados y progreso de todas las exportaciones (sin enlaces de descarga ajenos)", /Supervisión técnica/.test(sup) && /Listo/.test(sup) && (await adm.page.locator("a[href*='/api/exportaciones/']").count()) === 0);

  // --- Caducidad: elimina archivos y materialización, conserva el registro
  await ctx.prisma.exportJob.update({ where: { id: job.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await run.expireExports();
  const exp = await ctx.prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
  const gone = await adm.page.request.get(`${ctx.base}/api/exportaciones/${job.id}/archivo/${data.id}`);
  await page.goto(`${ctx.base}/calidad?fecha=2026-10-31&modo=FULL_MONTH`);
  ctx.check("Caducidad: estado «Caducado», materialización y archivos eliminados, descarga rechazada y registro conservado", exp.status === "EXPIRED" && (await ctx.prisma.exportRow.count({ where: { jobId: job.id } })) === 0 && gone.status() >= 400 && /Caducado/.test(await body(page)) && (await ctx.prisma.zdTimeEntry.count()) === N);

  // --- Conciliación
  await adm.page.goto(`${ctx.base}/administracion/conciliacion`);
  await adm.page.getByLabel("Desde").fill("2026-10-01");
  await adm.page.getByLabel("Hasta (corte)").fill("2026-10-31");
  await adm.page.getByRole("button", { name: "Ejecutar comprobación" }).click();
  await adm.page.waitForURL(/informe=/, { timeout: 60000 });
  const rec = await body(adm.page);
  ctx.check("Conciliación: informe con los tres niveles, IDs estables y resultado de la partición de horas", /Nivel 1/.test(rec) && /Nivel 2/.test(rec) && /Nivel 3/.test(rec) && /REC-N2-01/.test(rec) && /REC-N3-01/.test(rec), rec.slice(0, 200));
  const rid = new URL(adm.page.url()).searchParams.get("informe") as string;
  const csv = await (await adm.page.request.get(`${ctx.base}/api/administracion/conciliacion/${rid}/informe`)).text();
  const man = await (await adm.page.request.get(`${ctx.base}/api/administracion/conciliacion/${rid}/manifiesto`)).json();
  ctx.check("Conciliación: informe tabular y manifiesto descargables con la partición de horas conciliada", csv.startsWith("﻿") && /REC-N2-01;2;[^;]*;OK/.test(csv) && typeof man.sello_datos === "string" && man.resultados.length > 8);
  const rc = await rd.page.request.get(`${ctx.base}/api/administracion/conciliacion/${rid}/informe`);
  ctx.check("Conciliación: Consulta no puede descargar el informe", rc.status() >= 400);
  // --- Accesibilidad básica del panel (1440 y 390 px, teclado, anuncio de estado): NO se declara lector de pantalla verificado
  await page.goto(`${ctx.base}/calidad?fecha=2026-10-31&modo=FULL_MONTH`);
  const a11y = await page.evaluate(() => ({ status: document.querySelectorAll("[role='status']").length, labelled: Array.from(document.querySelectorAll("#exp-title ~ form select, #exp-title ~ form input:not([type=hidden])")).every((e) => (e as HTMLInputElement).labels?.length), overflow: document.documentElement.scrollWidth - window.innerWidth }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const narrow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.getByRole("button", { name: "Exportar detalle completo" }).focus();
  const focused = await page.evaluate(() => document.activeElement?.textContent ?? "");
  ctx.check("Accesibilidad del panel: campos con etiqueta, estado anunciado (role=status), sin desplazamiento horizontal a 1440 y 390 px y botón alcanzable por teclado", a11y.status > 0 && a11y.labelled && a11y.overflow <= 1 && narrow <= 1 && /Exportar detalle completo/.test(focused), JSON.stringify({ a11y, narrow, focused }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await anon.context.close();
  await rd.context.close();
  await adm.context.close();
  await ctx.stopWorker();
}
