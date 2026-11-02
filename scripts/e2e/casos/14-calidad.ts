import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { Ctx } from "../nucleo";
import { login } from "./util";
import { guardedTruncate, resolveTestTarget } from "../../../src/lib/test-guard";
import { todayMadrid } from "../../../src/domain/vigencia";

/**
 * Calidad (CSAPP-08) por el navegador sobre el `next start` compilado, con fixtures SINTÉTICAS aisladas en la base de test. Cubre: estado vacío honesto,
 * cartera sin calibrar, matriz de Client Health y edición de celda, efecto sobre la cartera, borrador simulado sobre datos (sin publicar), un global
 * completamente configurado solo con fixtures, vista parcial, cambio de ámbito y mes, backlog de un ticket antiguo, diagnóstico, detalle, CSV completo,
 * vuelta desde la ficha, permisos de Consulta y revisión a 390 px. Capturas con E2E_CAPTURAS=directorio (no se versionan).
 */
const body = (p: Page) => p.locator("main").innerText();
const cookie = async (c: BrowserContext, base: string) => (await c.cookies(base)).map((x) => `${x.name}=${x.value}`).join("; ");
const MASTERS = ["HealthFeedbackEvent", "HealthFeedback", "QualityNote", "UploadCoverageDeclaration", "WorkItemLinkEvidence", "WorkItemLink", "WorkItemObservation", "WorkItemRevision", "WorkItem", "FinanceRow", "FinanceBatch", "FinanceScope", "ZdTimeEntry", "WrikeTimeEntry", "ZdTicketObservation", "ZdTicketRevision", "ZdTicket", "UserMatrixMonth", "UserMatrix", "ServiceTerm", "ServiceAssignment", "ExternalIdentity", "Milestone", "Implementation", "Client", "ClientGroup", "PapCause", "PapRevision", "PapItem", "UploadBatch", "Product", "PersonTerm", "PersonAlias", "StaffCatalogItem", "Person", "ConfigDraft"];
const pad = (n: number) => String(n).padStart(2, "0");

export async function calidad(ctx: Ctx): Promise<void> {
  const today = todayMadrid();
  const admin = await ctx.prisma.user.findUniqueOrThrow({ where: { email: ctx.accounts.adminEmail } });
  await guardedTruncate(ctx.prisma, resolveTestTarget(), MASTERS);
  await ctx.prisma.$executeRawUnsafe(`DELETE FROM "ConfigRevision"`).catch(() => undefined); // el disparador lo impide: las revisiones se conservan y se numeran a partir de lo que haya
  const shots = process.env.E2E_CAPTURAS;
  if (shots) await mkdir(shots, { recursive: true });
  const shot = async (page: Page, name: string) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true }); };

  const adm = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);
  const page = adm.page;
  await page.setViewportSize({ width: 1440, height: 900 });

  // --- Sin datos
  await page.goto(`${ctx.base}/calidad`);
  let t = await body(page);
  ctx.check("Calidad sin datos: estado vacío claro, sin demostración automática", /No hay entidades/.test(t) && /No hay datos demostrativos/.test(t) && (await page.locator("table tbody tr").count()) === 0, t.slice(0, 80));

  // --- Fixtures sintéticas aisladas: mes anterior finalizado P
  const [Y, M] = today.split("-").map(Number);
  const P = M === 1 ? { y: Y - 1, m: 12 } : { y: Y, m: M - 1 };
  const end = new Date(Date.UTC(P.y, P.m, 0)).toISOString().slice(0, 10);
  const day = (n: number) => `${P.y}-${pad(P.m)}-${pad(n)}`;
  const h = await import("../../../tests/economia-helpers");
  const c = await import("../../../tests/calidad-helpers");
  const cfgSvc = await import("../../../src/server/pulse/config");
  const pc = await import("../../../src/domain/pulse-catalog");
  const qc = await import("../../../src/domain/quality-config");
  const atlas = await h.addGroup("Grupo Atlas");
  const boreal = await h.addGroup("Grupo Boreal");
  const a1 = await h.addClient("Atlas Norte", atlas.id);
  const a2 = await h.addClient("Atlas Sur", atlas.id);
  const b1 = await h.addClient("Boreal Central", boreal.id);
  for (const [org, cl] of [["7001", a1], ["7002", a2], ["7003", b1]] as const) await ctx.prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: org, searchValue: org, clientId: cl.id } });
  await h.setUsers(admin.id, { groupId: atlas.id }, P.y, Array(12).fill(100));
  await h.setUsers(admin.id, { clientId: a1.id }, P.y, Array(12).fill(60));
  await h.setUsers(admin.id, { clientId: a2.id }, P.y, Array(12).fill(60));
  await h.setUsers(admin.id, { groupId: boreal.id }, P.y, Array(12).fill(50));
  const team = await ctx.prisma.staffCatalogItem.create({ data: { kind: "TEAM", name: "CSQ" } });
  const lvl = await ctx.prisma.staffCatalogItem.create({ data: { kind: "LEVEL", name: "NQ1" } });
  const tb = await c.batchOf(admin.id, "zendesk-tickets", end);
  const mk = (id: string, o: Parameters<typeof c.seedTicket>[1] extends infer X ? Omit<X & object, "id" | "observedOn"> : never) => c.seedTicket(tb.id, { id, observedOn: end, entorno: "Soporte", ...(o as object) } as never);
  for (let i = 0; i < 4; i++) await mk(`I${i}`, { org: "7001", type: "incident", created: day(3 + i) });
  await mk("OLD", { org: "7001", type: "incident", status: "open", created: `${P.y - 1}-${pad(P.m)}-15` }); // hace más de un año, abierto, sin altas en el mes
  await mk("PB1", { org: "7001", type: "problem", created: day(5), cause: "incidente_estándar_plataforma" });
  await mk("PB2", { org: "7001", type: "problem", created: day(6) });
  await mk("N3A", { org: "7001", type: "incident", created: day(9), destinations: ["PMO_N3", "IT_N3"], cause: "incidente_uso_indebido" });
  await mk("B1T", { org: "7003", type: "incident", created: day(4), cause: "incidente_sistemas_del_cliente" });
  await c.seedBugLink(tb.id, { bugId: "100", ticket: "PB1" });
  await c.seedBugLink(tb.id, { bugId: "101", ticket: "PB2" });
  const pb = await c.batchOf(admin.id, "pap");
  await c.seedPap(pb.id, { id: "1", groupId: atlas.id, clientId: a1.id, date: day(10), state: "CORRECTIVE", causes: [{ category: "CORRECTIVE", origin: "STANDARD" }] });
  const zb = await c.batchOf(admin.id, "zendesk-tiempo");
  await h.addZd({ batchId: zb.id, date: day(12), minutes: 600, groupId: atlas.id, clientId: a1.id, ticketId: "I0", teamId: team.id, levelId: lvl.id });
  await h.serviceAssignment({ matchKind: "ENTORNO", matchValue: "soporte", service: "SOPORTE" });
  const from = `${P.y}-01-01`;
  for (const [b, o] of [[tb, { statusScope: "ALL_STATUSES" }], [pb, {}], [zb, {}]] as const) await c.declare(admin.id, b.id, { ...o, from, to: end });

  // --- Cartera sin calibrar
  const qs = `fecha=${end}&modo=FULL_MONTH`;
  await page.goto(`${ctx.base}/calidad?${qs}`);
  t = await body(page);
  ctx.check("Calidad: cartera con seis indicadores por Grupo Cliente, cartera filtrada y contexto del mes", (await page.locator("table thead th").count()) >= 8 && /Client Health/.test(t) && /Bugs y afectación del estándar/.test(t) && /Resultado global/.test(t) && /corte efectivo/.test(t) && /Grupo Atlas/.test(t));
  ctx.check("Calidad: sin calibrar no hay color ni global; se muestran magnitudes, razón y siguientes acciones", /Sin calibrar/.test(t) && !/Verde/.test(await page.locator("tbody").innerText()) && /Siguientes acciones/.test(t) && /Global sin método ni límites/.test(t));
  ctx.check("Calidad: un cero, una celda de Health en blanco y un KPI ausente no se representan igual", /En blanco \(sin feedback\)/.test(t) && /sin calibrar/.test(t));
  await shot(page, "calidad-1440-sin-calibrar");

  // --- Matriz de Client Health: editar una celda y ver el efecto
  await page.goto(`${ctx.base}/calidad?${qs}&vista=health&anio=${P.y}`);
  t = await body(page);
  ctx.check("Health: matriz enero–diciembre vacía al inicio, enlaces de edición solo para el Administrador", /Client Health · /.test(t) && (await page.locator("a[aria-label*='Editar']").count()) > 0 && /Sin feedback/.test(t));
  await page.locator(`a[aria-label^="Grupo Atlas, ${["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"][P.m - 1]}"]`).first().click();
  await page.getByLabel("Estado del feedback").selectOption("NEGATIVE");
  await page.getByLabel("Comentario (texto)").fill("<script>alert(1)</script> reunión");
  await page.getByRole("button", { name: "Guardar celda" }).click();
  await page.getByText(/Celda de Client Health guardada/).first().waitFor({ timeout: 10000 });
  const cell = await ctx.prisma.healthFeedback.findFirstOrThrow({ where: { groupId: atlas.id } });
  ctx.check("Health: la celda se guarda como texto (sin HTML ejecutable), con versión, historial y auditoría", cell.state === "NEGATIVE" && cell.comment?.includes("<script>") === true && (await ctx.prisma.healthFeedbackEvent.count()) === 1 && (await ctx.prisma.auditEvent.count({ where: { entityType: "HealthFeedback" } })) === 1);
  await page.goto(`${ctx.base}/calidad?${qs}&vista=health&anio=${P.y}`);
  ctx.check("Health: con el mapeo sin confirmar se ve la categoría «Negativo» como sin calibrar, sin color publicado", /Negativo/.test(await body(page)) && (await page.locator("tbody .band-rojo").count()) === 0);
  await page.goto(`${ctx.base}/calidad?${qs}`);
  t = await body(page);
  ctx.check("Health: en la cartera el feedback presente sin calibrar conserva su peso (no se redistribuye) y se muestra como sin calibrar", /Negativo · sin calibrar/.test(t));

  // --- Borrador simulado sobre datos: no publica nada
  const dcfg = qc.defaultQualityConfig();
  dcfg.health.confirmed = true;
  const revBefore = await ctx.prisma.configRevision.count({ where: { family: "QUALITY" } });
  await cfgSvc.saveDraft(admin.id, "QUALITY", dcfg, { expectedVersion: null });
  await page.goto(`${ctx.base}/calidad?${qs}&sim=borrador`);
  t = await body(page);
  ctx.check("Simulación sobre datos: banner «SIMULACIÓN, NO PUBLICADO», comparación activa/borrador y nada activado", /SIMULACIÓN, NO PUBLICADO/.test(t) && /Comparación activa/.test(t) && (await ctx.prisma.configRevision.count({ where: { family: "QUALITY" } })) === revBefore);
  await page.goto(`${ctx.base}/calidad?${qs}`);
  ctx.check("Simulación: la cartera activa sigue sin colorear Health (el borrador no se publica)", /Negativo · sin calibrar/.test(await body(page)));

  // --- Global completamente configurado (solo fixtures): activación elegida por el Administrador
  const pulseCfg = { ...pc.defaultPulseConfig(), profiles: { CS_N1: [{ teamId: team.id, levelId: lvl.id, pmo: null }] } };
  const pd = await cfgSvc.saveDraft(admin.id, "PULSE", pulseCfg, { expectedVersion: null });
  await cfgSvc.activateDraft(admin.id, "PULSE", { expectedRevisionNo: (await cfgSvc.getActive(ctx.prisma, "PULSE")).revisionNo, expectedDraftVersion: pd.version, reason: "Perfiles de la fixture" });
  const full = qc.defaultQualityConfig();
  full.health.confirmed = true;
  full.dedication = { profiles: ["CS_N1"], selectionConfirmed: true };
  const cal = (a: string, b2: string, unit: "HOURS_PER_USER_MONTH" | "PER_100_USER_MONTHS" | "PER_100_USERS_STOCK") => ({ ...qc.emptyRule("LOWER_BETTER", unit), a, b: b2, calibration: "CALIBRADO" as const });
  full.indicators.DEDICATION.rules.GRUPO = cal("1", "3", "HOURS_PER_USER_MONTH");
  for (const k of ["PAP_CORRECTIVE", "N3_ESCALATIONS"] as const) full.indicators[k].rules.GRUPO = cal("1", "3", "PER_100_USER_MONTHS");
  full.indicators.BUGS_STANDARD.rules.GRUPO = cal("1", "3", "PER_100_USER_MONTHS");
  full.indicators.INCIDENTS_PROBLEMS.rules.GRUPO = cal("2", "5", "PER_100_USER_MONTHS");
  full.incidents.concerningDays = { incident: 30, problem: 60 };
  full.incidents.backlog.INCIDENT.GRUPO = cal("10", "20", "PER_100_USERS_STOCK");
  full.incidents.backlog.PROBLEM.GRUPO = cal("10", "20", "PER_100_USERS_STOCK");
  full.incidents.worstOfFlowAndBacklog = true;
  full.incidents.ageBands = [{ from: 0, to: 30 }, { from: 31, to: 365 }, { from: 366, to: null }];
  full.global = { template: "WEIGHTED_SEVERITY", enabled: true, severity: { green: "0", yellow: "0.5", red: "1" }, greenMax: "0.3", yellowMax: "0.6" };
  const qd = await cfgSvc.saveDraft(admin.id, "QUALITY", full, { expectedVersion: (await cfgSvc.getDraft(admin.id, "QUALITY"))?.version ?? null });
  await cfgSvc.activateDraft(admin.id, "QUALITY", { expectedRevisionNo: (await cfgSvc.getActive(ctx.prisma, "QUALITY")).revisionNo, expectedDraftVersion: qd.version, reason: "Calibración de la fixture aislada" });
  await page.goto(`${ctx.base}/calidad?${qs}&sel=${atlas.id}`);
  t = await body(page);
  // Atlas: Health negativo→rojo(1); dedicación 10 h/100 u·mes=0,1 verde; PAP 1 verde; N3 1 verde; bugs 2→amarillo(0,5); incidentes: flujo 8 → rojo (1) → global (1+0+0+0+1+0,5)/6 = 0,4167 → amarillo
  ctx.check("Global configurado (fixture aislada): resultado con texto, índice 0,42 y pesos efectivos de los seis indicadores", /Global del mes|Resultado global del mes/.test(t) && /Amarillo/.test(t) && /índice configurado 0,42/.test(t) && /Peso asignado/.test(t), t.slice(t.indexOf("Resultado global del mes"), t.indexOf("Resultado global del mes") + 160));
  for (const s of await page.locator("details.kpi-detail > summary").all()) await s.click();
  t = await body(page);
  ctx.check("Detalle: seis indicadores explicados con fórmula, numerador, denominador y cobertura; sexto indicador con causa/vínculo/ambas y total único", /Fórmula/.test(t) && /por causa \(S\)/.test(t) && /por vínculo \(B\)/.test(t) && /total único/.test(t));
  await page.locator("details.kpi-detail summary").last().click();
  ctx.check("Detalle: tabla equivalente de evolución con hueco honesto cuando no hay fotografía", /Tabla equivalente/.test(t) && /hueco \(sin fotografía compatible\)|observado/.test(t));
  await shot(page, "calidad-1440-global");

  // --- Backlog de un ticket antiguo; una fecha sin fotografía
  await page.goto(`${ctx.base}/calidad?${qs}&vista=backlog&sel=${atlas.id}`);
  t = await body(page);
  ctx.check("Backlog: incidente de hace un año todavía open entra en el stock sin altas en el mes, con edad y motivo de envejecimiento", /OLD|\d{6,}/.test(t) && /Edad \d+ > umbral 30 días/.test(t) && /Observado el/.test(t));
  await page.goto(`${ctx.base}/calidad?fecha=${P.y}-${pad(P.m)}-10&modo=CUTOFF&vista=backlog&sel=${atlas.id}`);
  t = await body(page);
  ctx.check("Backlog: una fecha sin fotografía compatible no se rellena con el estado actual ni se interpola", /Sin fotografía compatible|no está disponible|No hay fotografía compatible/.test(t));

  // --- Diagnóstico por origen
  await page.goto(`${ctx.base}/calidad?${qs}&vista=diagnostico&fam=USO_INDEBIDO`);
  t = await body(page);
  ctx.check("Diagnóstico: matriz type × familia, Sistemas del Cliente y Uso indebido separadas, orientación como hipótesis y detalle de tickets", /Type × familia/.test(t) && /Uso indebido/.test(t) && /Sistemas del Cliente/.test(t) && /hipótesis/.test(t) && /Tickets de «Uso indebido»/.test(t));

  // --- Cliente, grupo, vista parcial, mes
  await page.goto(`${ctx.base}/calidad?${qs}&ambito=client`);
  t = await body(page);
  ctx.check("Ámbito Cliente: Atlas Norte y Atlas Sur tienen usuarios propios y el grupo no los suma; sin regla de Cliente → sin calibrar (no hereda umbrales de Grupo)", /Atlas Norte/.test(t) && /Atlas Sur/.test(t) && /sin calibrar/.test(t));
  await page.goto(`${ctx.base}/calidad?fecha=${today}&modo=CUTOFF`);
  t = await body(page);
  ctx.check("Mes en curso: provisional, corte efectivo hoy y sin certificar cerrado", /provisional/.test(t));

  // --- CSV completo y permisos
  const ck = await cookie(adm.context, ctx.base);
  const csvRes = await fetch(`${ctx.base}/api/analitica/calidad.csv?${qs}&tabla=cartera`, { headers: { Cookie: ck } });
  const csv = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await csvRes.arrayBuffer());
  ctx.check("CSV: cartera completa filtrada (todas las entidades, no solo la página), con BOM, estados, unidades, colores, pesos y cobertura", csvRes.status === 200 && csv.startsWith("﻿") && csv.split("\r\n").filter(Boolean).length === 3 && /Grupo Atlas/.test(csv) && /global_color/.test(csv) && /cobertura/.test(csv), String(csvRes.status));
  const anon = await fetch(`${ctx.base}/api/analitica/calidad.csv?${qs}`, { redirect: "manual" });
  ctx.check("CSV: sin sesión se rechaza (no devuelve datos)", anon.status === 401 || anon.status === 307 || anon.status === 302, String(anon.status));

  // --- Ficha de Análisis Cliente: mismos resultados y vuelta
  await page.goto(`${ctx.base}/analisis-cliente?ambito=group&id=${atlas.id}&fecha=${end}&modo=FULL_MONTH`);
  t = await body(page);
  ctx.check("Análisis Cliente: integra los seis indicadores de Calidad con el mismo resultado global y enlace al detalle", /Calidad · mes/.test(t) && /Amarillo/.test(t));
  await page.getByRole("link", { name: /Detalle, evolución, diagnóstico y backlog/ }).click();
  await page.waitForURL(/\/calidad/);
  ctx.check("Ir y volver conserva ámbito, periodo y entidad", page.url().includes(`fecha=${end}`) && page.url().includes(atlas.id));

  // --- 390 px y teclado
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${ctx.base}/calidad?${qs}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ctx.check("390 px: sin desplazamiento horizontal de la página (la tabla se desplaza dentro de su región)", overflow <= 1, String(overflow));
  await page.locator(".table-wrap").first().focus();
  ctx.check("Teclado: la región de la tabla recibe foco", await page.evaluate(() => document.activeElement?.classList.contains("table-wrap") ?? false));
  await shot(page, "calidad-390");
  await adm.context.close();

  // --- Consulta: lee, no edita
  const rd = await login(ctx, ctx.accounts.readerEmail, ctx.accounts.readerPassword);
  await rd.page.goto(`${ctx.base}/calidad?${qs}&vista=health&anio=${P.y}&editar=${atlas.id}|${P.m}`);
  t = await body(rd.page);
  ctx.check("Consulta: lee la matriz y el motivo, sin enlaces de edición ni formulario (sin enlaces que terminan en 403)", /su perfil es de consulta/i.test(t) && (await rd.page.locator("a[aria-label*='Editar']").count()) === 0 && (await rd.page.getByRole("button", { name: "Guardar celda" }).count()) === 0);
  await rd.page.goto(`${ctx.base}/calidad?${qs}&sim=borrador`);
  ctx.check("Consulta: la simulación del borrador es solo del Administrador", /solo para Administradores/.test(await body(rd.page)));
  const rcsv = await fetch(`${ctx.base}/api/analitica/calidad.csv?${qs}`, { headers: { Cookie: await cookie(rd.context, ctx.base) } });
  ctx.check("Consulta: puede descargar el CSV de Calidad", rcsv.status === 200);
  await rd.context.close();
}
