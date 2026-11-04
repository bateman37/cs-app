import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { Ctx } from "../nucleo";
import { login } from "./util";
import { guardedTruncate, resolveTestTarget } from "../../../src/lib/test-guard";
import { todayMadrid } from "../../../src/domain/vigencia";

/**
 * Calidad (CSAPP-08, rediseñada en HOTFIX-02 §9) por el navegador sobre el `next start` compilado, con fixtures SINTÉTICAS aisladas en la base de test. Cubre:
 * estado vacío honesto, Resumen de clientes sin calibrar, los seis accesos/cabeceras/celdas como navegación (kpi + objeto, con periodo, nivel y segmentadores),
 * segmentadores Soporte/Servidor y limpieza de parámetros retirados, matriz de Client Health y edición de celda, borrador simulado, un global completamente
 * configurado solo con fixtures, backlog y diagnóstico dentro del apartado de Incidentes y problemas, un error real con Reintentar, nivel Cliente, mes en curso,
 * CSV completo, vuelta desde la ficha, permisos de Consulta y revisión visual con geometría a 1920×1080, 1536×864 y 390 px. Capturas con E2E_CAPTURAS=directorio (no se versionan).
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
  for (const [attribute, value, own] of [["SUPPORT", "GOLD", { clientId: a1.id }], ["HOSTING", "CLOUD", { clientId: a1.id }], ["SUPPORT", "SILVER_RECURRENTE", { clientId: a2.id }], ["HOSTING", "OP", { clientId: a2.id }], ["SUPPORT", "GOLD", { groupId: boreal.id }], ["HOSTING", "OP", { groupId: boreal.id }]] as const) await ctx.prisma.serviceTerm.create({ data: { attribute, value, ...own } });
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
  const NAMES = ["Client Health", "Dedicación", "PAP correctivos", "Escalados a N3", "Incidentes y problemas", "Bugs y afectaciones"];
  ctx.check("Resumen de clientes: título propio (no «Cartera»), seis accesos con nombre completo y una fila por Grupo con seis KPI y resultado global", /Resumen de clientes/.test(await page.locator("h1").first().innerText()) && !/Cartera/.test(t) && (await page.locator("ul.ql-acc-grid a.ql-acc").count()) === 6 && NAMES.every((n) => t.includes(n)) && (await page.locator("table thead th").count()) === 9 && /Resultado global/.test(t) && /Grupo Atlas/.test(t) && (await page.locator("table tbody tr").count()) === 2);
  ctx.check("Resumen: sin muro de avisos ni tarjeta de contexto (sin sellos, revisión de configuración, cobertura declarada ni «corte efectivo»); a lo sumo un indicador «Datos pendientes»", !/Sello|revisión de configuración|Cobertura declarada|corte efectivo|Configuración v1/i.test(t) && (await page.locator(".notice").count()) === 0 && (await page.getByText("Datos pendientes").count()) <= 1);
  ctx.check("Resumen: sin calibrar no hay color ni verde inventado; magnitudes visibles y estado «Sin calibrar»", /Sin calibrar/.test(t) && (await page.locator("tbody .ql-st-green").count()) === 0 && (await page.locator("tbody .ql-st-red").count()) === 0 && (await page.locator("ul.ql-acc-grid .ql-st-green").count()) === 0);
  ctx.check("Resumen: un cero, un Health en blanco y un KPI ausente no se representan igual (texto distinto)", /Sin informar/.test(t) && /Sin calibrar/.test(t));
  // --- Retirados los filtros técnicos: solo Soporte y Servidor + nivel; parámetros antiguos no filtran y se limpian de la URL
  ctx.check("Controles: solo Soporte, Servidor y Nivel (sin búsqueda, servicio, complejidad, producto, estado ni selectores de bloques o tamaño)", (await page.locator(".ql-bar [role=group][aria-label='Soporte'] a.chip").count()) === 4 && (await page.locator(".ql-bar [role=group][aria-label='Servidor'] a.chip").count()) === 2 && (await page.locator("input[type=search], select[multiple], select[name=servicio], select[name=tam]").count()) === 0);
  await page.goto(`${ctx.base}/calidad?${qs}&q=zzz&servicio=TOTAL&color=green&complejidad=ALTA&tam=25&vista=cartera`);
  ctx.check("Parámetros retirados: no recortan datos y se eliminan de la dirección (redirección a la canónica)", !/[?&](q|servicio|color|complejidad|tam|vista)=/.test(page.url()) && (await page.locator("table tbody tr").count()) === 2, page.url());
  await shot(page, "calidad-1440-sin-calibrar");

  // --- Matriz de Client Health: editar una celda y ver el efecto
  await page.goto(`${ctx.base}/calidad?${qs}&kpi=HEALTH&anio=${P.y}`);
  t = await body(page);
  ctx.check("Health: matriz enero–diciembre vacía al inicio, enlaces de edición solo para el Administrador", /Client Health \d{4}/.test(t) && /sin informar/.test(t) && (await page.locator("a[aria-label*='Editar']").count()) > 0 && /Sin feedback/.test(t));
  await page.locator(`a[aria-label^="Grupo Atlas, ${["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"][P.m - 1]}"]`).first().click();
  await page.getByLabel("Estado del feedback").selectOption("NEGATIVE");
  await page.getByLabel("Comentario (texto)").fill("<script>alert(1)</script> reunión");
  await page.getByRole("button", { name: "Guardar celda" }).click();
  await page.getByText(/Celda de Client Health guardada/).first().waitFor({ timeout: 10000 });
  const cell = await ctx.prisma.healthFeedback.findFirstOrThrow({ where: { groupId: atlas.id } });
  ctx.check("Health: la celda se guarda como texto (sin HTML ejecutable), con versión, historial y auditoría", cell.state === "NEGATIVE" && cell.comment?.includes("<script>") === true && (await ctx.prisma.healthFeedbackEvent.count()) === 1 && (await ctx.prisma.auditEvent.count({ where: { entityType: "HealthFeedback" } })) === 1);
  await page.goto(`${ctx.base}/calidad?${qs}&kpi=HEALTH&anio=${P.y}`);
  ctx.check("Health: con el mapeo sin confirmar se ve la categoría «Negativo» como sin calibrar, sin color publicado", /Negativo/.test(await body(page)) && (await page.locator("tbody .ql-st-red").count()) === 0 && /1 negativo/.test(await body(page)));
  await page.goto(`${ctx.base}/calidad?${qs}`);
  t = await body(page);
  ctx.check("Health: en el resumen el feedback presente sin calibrar se muestra como categoría con «Sin calibrar» (conserva su peso)", /Negativo\s+Sin calibrar/.test(t));

  // --- Borrador simulado sobre datos: no publica nada
  const dcfg = qc.defaultQualityConfig();
  dcfg.health.confirmed = true;
  const revBefore = await ctx.prisma.configRevision.count({ where: { family: "QUALITY" } });
  await cfgSvc.saveDraft(admin.id, "QUALITY", dcfg, { expectedVersion: null });
  await page.goto(`${ctx.base}/calidad?${qs}&sim=borrador`);
  t = await body(page);
  ctx.check("Simulación sobre datos: banner «SIMULACIÓN, NO PUBLICADO», comparación activa/borrador y nada activado", /SIMULACIÓN, NO PUBLICADO/.test(t) && /Activa: /.test(t) && (await ctx.prisma.configRevision.count({ where: { family: "QUALITY" } })) === revBefore);
  await page.goto(`${ctx.base}/calidad?${qs}`);
  ctx.check("Simulación: el resumen activo sigue sin colorear Health (el borrador no se publica)", /Negativo\s+Sin calibrar/.test(await body(page)));

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
  ctx.check("Global configurado (fixture aislada): ficha con resultado, índice 0,42 y pesos efectivos de los seis indicadores", /Resultado global del mes/.test(t) && /Amarillo/.test(t) && /índice 0,42/.test(t) && /Peso asignado/.test(t), t.slice(t.indexOf("Resultado global del mes"), t.indexOf("Resultado global del mes") + 160));
  await shot(page, "calidad-1440-ficha");

  // --- Los KPI son la navegación: accesos, cabeceras y celdas (conservan periodo, nivel y segmentadores; «volver al resumen»)
  const withCtx = `${qs}&soporte=GOLD`;
  await page.goto(`${ctx.base}/calidad?${withCtx}`);
  t = await body(page);
  ctx.check("Segmentador Soporte: GOLD deja Atlas (Atlas Norte) y Boreal (hereda GOLD del Grupo)", /Grupo Atlas/.test(t) && /Grupo Boreal/.test(t) && (await page.locator("table tbody tr").count()) === 2);
  await page.goto(`${ctx.base}/calidad?${qs}&soporte=GOLD&servidor=OP`);
  t = await body(page);
  ctx.check("Segmentadores AND en el MISMO Cliente: GOLD + OP deja solo Boreal (en Atlas el GOLD y el OP son de Clientes distintos)", !/Grupo Atlas/.test(t) && /Grupo Boreal/.test(t) && (await page.locator("table tbody tr").count()) === 1);
  await page.goto(`${ctx.base}/calidad?${withCtx}`);
  await page.locator("a.chip", { hasText: "Platinum" }).click();
  await page.waitForURL(/soporte=GOLD%2CPLATINUM|soporte=GOLD,PLATINUM/);
  ctx.check("Un clic en un chip selecciona, otro lo deselecciona (sin Ctrl/Cmd) y se conserva el periodo", (await page.locator("a.chip.chip-on", { hasText: "Platinum" }).count()) === 1 && page.url().includes(`fecha=${end}`));
  await page.goto(`${ctx.base}/calidad?${withCtx}`);
  for (const [i, name] of NAMES.entries()) {
    await page.locator("ul.ql-acc-grid a.ql-acc").nth(i).click();
    await page.waitForURL(/kpi=/);
    const u = new URL(page.url());
    const h1 = await page.locator("h1").first().innerText();
    ctx.check(`Acceso «${name}»: abre su apartado para la selección actual, con periodo y segmentadores, y «volver al resumen»`, h1.trim() === name && u.searchParams.get("soporte") === "GOLD" && u.searchParams.get("fecha") === end && !u.searchParams.has("sel") && (await page.getByRole("link", { name: /Volver al resumen de clientes/ }).count()) === 1, `${h1} ${page.url()}`);
    await page.goto(`${ctx.base}/calidad?${withCtx}`);
  }
  await page.locator("table thead th a", { hasText: "Escalados a N3" }).click();
  await page.waitForURL(/kpi=N3_ESCALATIONS/);
  t = await body(page);
  ctx.check("Cabecera «Escalados a N3»: apartado con tickets únicos, tags PMO/IT por fecha de creación (proxy) y lista del mes", /Tickets escalados a N3 por mes de creación/.test(t) && /no es la fecha del escalado/.test(t) && /PMO N3/.test(t));
  await page.goto(`${ctx.base}/calidad?${withCtx}`);
  const cellN3 = page.locator("tbody tr", { hasText: "Grupo Atlas" }).locator("td a[aria-label*='Escalados a N3']");
  await cellN3.click();
  await page.waitForURL(/kpi=N3_ESCALATIONS&.*sel=|sel=.*kpi=N3_ESCALATIONS/);
  t = await body(page);
  ctx.check("Celda de un Grupo: detalle del indicador de ESE Grupo (encabezado con su nombre, solo sus tickets) y conserva Soporte", /Grupo Atlas · Escalados a N3/.test(t) && t.includes(h.tkey("N3A")) && page.url().includes("soporte=GOLD") && page.url().includes(atlas.id));
  await page.getByRole("link", { name: /Volver al resumen de clientes/ }).click();
  await page.waitForURL((u) => !u.searchParams.has("kpi") && !u.searchParams.has("sel"));
  ctx.check("Volver al resumen conserva periodo, nivel y segmentadores", page.url().includes("soporte=GOLD") && page.url().includes(`fecha=${end}`));

  // --- Apartados con contenido propio
  await page.goto(`${ctx.base}/calidad?${qs}&kpi=DEDICATION&sel=${atlas.id}`);
  t = await body(page);
  ctx.check("Dedicación: horas por perfil, desglose CS / mantenimiento PMO / contexto IT-Plataforma, evolución y normalización por usuarios; «Ver cálculo» bajo demanda", /Horas por perfil/.test(t) && /Desglose CS, mantenimiento PMO y contexto/.test(t) && /Evolución y normalización por usuarios/.test(t) && /Contexto IT \/ Plataforma/.test(t) && (await page.locator("details.ql-calc summary", { hasText: "Ver cálculo" }).count()) === 1);
  await page.goto(`${ctx.base}/calidad?${qs}&kpi=PAP_CORRECTIVE&sel=${atlas.id}`);
  t = await body(page);
  ctx.check("PAP correctivos: PAP únicos, causas, «Petición cliente» como columna aparte, producción por mes y comparación con el año anterior", /PAP únicos por mes de producción/.test(t) && /Petición cliente/.test(t) && /Corr\. año ant\./.test(t) && /PAP del mes \(1\)/.test(t));
  await page.goto(`${ctx.base}/calidad?${qs}&kpi=BUGS_STANDARD&sel=${atlas.id}`);
  t = await body(page);
  ctx.check("Bugs y afectaciones: unión sin duplicar (causa estándar ∪ vínculo a Bug_), contexto VFS/VSW aparte y PR/Ready for Release sin declararlos desplegados", /Problemas de clientes con bug o causa estándar/.test(t) && /Por causa estándar/.test(t) && /Por vínculo a Bug_/.test(t) && /Contexto: bugs abiertos de producto \(VFS \/ VSW\)/.test(t) && /Total único/.test(t));
  await page.goto(`${ctx.base}/calidad?${qs}&kpi=HEALTH&sel=${atlas.id}`);
  t = await body(page);
  ctx.check("Client Health de un Grupo: matriz de su fila, feedback positivo/negativo/sin informar y edición solo para el Administrador", /Client Health \d{4}/.test(t) && /negativo/.test(t) && (await page.locator("a[aria-label*='Editar']").count()) === 12);

  // --- Backlog y diagnóstico dentro de Incidentes y problemas (no son botones principales)
  ctx.check("Backlog y diagnóstico NO son accesos principales: solo seis accesos y ninguna pestaña «Cartera / Diagnóstico / Backlog»", (await page.locator("ul.ql-acc-grid a.ql-acc").count()) === 6 && (await page.getByRole("link", { name: /^(Cartera|Diagnóstico por origen|Backlog por antigüedad)$/ }).count()) === 0);
  await page.goto(`${ctx.base}/calidad?${qs}&kpi=INCIDENTS_PROBLEMS&sel=${atlas.id}`);
  t = await body(page);
  ctx.check("Incidentes y problemas: volumen mensual (incidentes y problemas separados), backlog abierto envejecido con tramos y causas del backlog", /Volumen: altas por mes/.test(t) && /Backlog abierto y antigüedad/.test(t) && /Observado el/.test(t) && /Incidentes/.test(t) && /Problemas/.test(t) && /Causas del backlog abierto/.test(t) && /Tickets abiertos \(\d+\)/.test(t) && /Envejecidos/.test(t));
  await page.goto(`${ctx.base}/calidad?fecha=${P.y}-${pad(P.m)}-10&modo=CUTOFF&kpi=INCIDENTS_PROBLEMS&sel=${atlas.id}`);
  t = await body(page);
  ctx.check("Backlog: una fecha sin observación compatible no se rellena con el estado actual ni se interpola", /Sin observación compatible del corte/.test(t));
  await page.goto(`${ctx.base}/calidad?${qs}&kpi=INCIDENTS_PROBLEMS&fam=USO_INDEBIDO`);
  t = await body(page);
  ctx.check("Diagnóstico por origen: siete familias (Sistemas del Cliente y Uso indebido separadas), orientación como hipótesis y detalle de tickets", /Causas por origen/.test(t) && /Uso indebido/.test(t) && /Sistemas del Cliente/.test(t) && /hipótesis/.test(t) && /Tickets de «Uso indebido»/.test(t));

  // --- Un error real sigue visible y se puede reintentar (revisión de Calidad inexistente)
  await page.goto(`${ctx.base}/calidad?${qs}&rcalidad=9999`);
  t = await body(page);
  ctx.check("Un fallo real del cálculo se muestra con mensaje comprensible y Reintentar (no se disfraza de cero ni de verde)", /No se pudo calcular Calidad/.test(t) && (await page.getByRole("link", { name: "Reintentar" }).count()) === 1 && (await page.locator(".ql-st-green").count()) === 0);

  // --- Nivel Cliente, mes en curso
  await page.goto(`${ctx.base}/calidad?${qs}&ambito=client`);
  t = await body(page);
  ctx.check("Nivel Cliente: Atlas Norte y Atlas Sur tienen usuarios propios y el grupo no los suma; sin regla de Cliente → sin calibrar (no hereda umbrales de Grupo)", /Atlas Norte/.test(t) && /Atlas Sur/.test(t) && /Sin calibrar/.test(t));
  await page.goto(`${ctx.base}/calidad?fecha=${today}&modo=CUTOFF`);
  t = await body(page);
  ctx.check("Mes en curso: etiqueta breve «Provisional» y sin certificar cerrado", /Provisional/.test(t));

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
  ctx.check("Análisis Cliente: la ficha única (HOTFIX-02 §8) no embebe el bloque de Calidad ni abre pestañas; Calidad se consulta en su propia vista", !/Resultado global/.test(t) && (await page.getByRole("tab").count()) === 0);

  // --- Revisión visual con datos representativos: Grupos con varios Clientes, nombres largos, valores grandes, mezcla de soportes, Health informado y no
  // informado, KPI sin datos (Grupos sin usuarios), nivel Cliente sin umbrales y un error real. Se mide la geometría y se capturan las pantallas.
  const SUP = ["GOLD", "PLATINUM", "SILVER_RECURRENTE", "SILVER_ON_DEMAND"] as const;
  const LONG = ["Corporación Industrial Mediterránea de Servicios Integrales y Logística Avanzada", "Distribuciones Peninsulares del Norte", "Grupo Hotelero Costa Dorada Internacional", "Aceros y Metales Especiales de Levante", "Laboratorios Farmacéuticos Ibéricos Asociados", "Transportes Frigoríficos Unidos", "Cooperativa Agroalimentaria del Valle del Ebro", "Editorial y Medios Digitales del Sur", "Inmobiliaria Residencial Atlántica", "Química Industrial Ribera", "Energías Renovables Cantábricas", "Textiles Hispano Europeos", "Constructora Metropolitana de Obras Públicas", "Seguros y Reaseguros Generales", "Navieras del Mediterráneo Occidental", "Sanidad Privada Integral"];
  const hs = await import("../../../src/server/quality/health");
  for (const [gi, name] of LONG.entries()) {
    const g = await h.addGroup(name);
    const nClients = 1 + (gi % 3);
    const kids = [];
    for (let k = 0; k < nClients; k++) {
      const cl = await h.addClient(`${name.split(" ")[0]} ${k + 1}`, g.id);
      kids.push(cl);
      const org = String(8000 + gi * 10 + k);
      await ctx.prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: org, searchValue: org, clientId: cl.id } });
      await ctx.prisma.serviceTerm.create({ data: { attribute: "SUPPORT", value: SUP[(gi + k) % 4], clientId: cl.id } });
      await ctx.prisma.serviceTerm.create({ data: { attribute: "HOSTING", value: (gi + k) % 3 === 0 ? "OP" : "CLOUD", clientId: cl.id } });
      if (gi % 7 !== 3) await h.setUsers(admin.id, { clientId: cl.id }, P.y, Array(12).fill(gi === 0 ? 4200 : 40 + gi * 31 + k * 17));
      for (let i = 0; i < (gi * 2 + k * 3) % 11; i++) await c.seedTicket(tb.id, { id: `V${gi}-${k}-${i}`, observedOn: end, entorno: "Soporte", org, type: i % 4 === 3 ? "problem" : "incident", created: day(1 + ((i * 2 + gi) % 27)), cause: i % 5 === 0 ? "incidente_estándar_plataforma" : i % 5 === 1 ? "incidente_uso_indebido" : null, destinations: i % 4 === 0 ? ["PMO_N3"] : i % 6 === 5 ? ["IT_N3", "PMO_N3"] : [] });
      if (gi % 2 === 0) await c.seedPap(pb.id, { id: String(5000 + gi * 10 + k), groupId: g.id, clientId: cl.id, date: day(5 + k), state: "CORRECTIVE", causes: [{ category: "CORRECTIVE", origin: gi % 4 === 0 ? "STANDARD" : "CONFIG_DATA" }] });
      await h.addZd({ batchId: zb.id, date: day(8 + k), minutes: 300 + gi * 180 + (gi === 0 ? 9000 : 0), groupId: g.id, clientId: cl.id, ticketId: `V${gi}-${k}-0`, teamId: team.id, levelId: lvl.id });
    }
    if (gi % 7 !== 3) await h.setUsers(admin.id, { groupId: g.id }, P.y, Array(12).fill(Math.round(kids.length * (gi === 0 ? 4200 : 40 + gi * 31) * 0.9)));
    if (gi % 3 !== 2) await hs.saveHealthCell(admin.id, { scope: "group", entityId: g.id, year: P.y, month: P.m, state: (["POSITIVE", "MIXED", "NEGATIVE"] as const)[gi % 3], expectedVersion: 0 });
  }
  const vis = process.env.E2E_VISUAL === "0" ? [] : [{ w: 1920, h: 1080 }, { w: 1536, h: 864 }];
  const urls: [string, string][] = [["resumen", qs], ["n3", `${qs}&kpi=N3_ESCALATIONS`], ["dedicacion", `${qs}&kpi=DEDICATION`], ["pap", `${qs}&kpi=PAP_CORRECTIVE`], ["health", `${qs}&kpi=HEALTH&anio=${P.y}`], ["incidentes", `${qs}&kpi=INCIDENTS_PROBLEMS`], ["bugs", `${qs}&kpi=BUGS_STANDARD`], ["cliente", `${qs}&ambito=client`], ["ficha", `${qs}&sel=${atlas.id}`], ["error", `${qs}&rcalidad=9999`]];
  for (const vp of vis) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    for (const [name, query] of urls) {
      await page.goto(`${ctx.base}/calidad?${query}`);
      await page.locator(".ql-page").waitFor();
      await shot(page, `calidad-${vp.w}-${name}`);
      const m = await page.evaluate(() => {
        const doc = document.documentElement;
        const wraps = [...document.querySelectorAll<HTMLElement>(".ql-wrap")].map((w) => w.scrollWidth - w.clientWidth);
        const rows = [...document.querySelectorAll<HTMLElement>(".ql-table tbody tr")].map((r) => r.getBoundingClientRect().height);
        const td = document.querySelector<HTMLElement>(".ql-table tbody td");
        const tbl = document.querySelector<HTMLElement>(".ql-table");
        const acc = [...document.querySelectorAll<HTMLElement>(".ql-acc")].map((a) => Math.round(a.getBoundingClientRect().top));
        return { docOverflow: doc.scrollWidth - window.innerWidth, mainWidth: Math.round(document.querySelector("main")!.getBoundingClientRect().width), wrapOverflow: Math.max(0, ...wraps), rowMin: rows.length ? Math.round(Math.min(...rows)) : 0, rowMax: rows.length ? Math.round(Math.max(...rows)) : 0, font: td ? getComputedStyle(td).fontSize : "", tableTop: tbl ? Math.round(tbl.getBoundingClientRect().top) : 0, accRows: new Set(acc).size, rowsN: rows.length, scrollH: doc.scrollHeight };
      });
      console.log(`GEOMETRIA ${vp.w}x${vp.h} ${name}: ${JSON.stringify(m)}`);
      ctx.check(`Geometría ${vp.w}×${vp.h} «${name}»: sin scroll horizontal del documento`, m.docOverflow <= 1, JSON.stringify(m));
      if (name === "resumen") {
        ctx.check(`Geometría ${vp.w}×${vp.h} resumen: seis accesos en una fila, tabla sin desplazamiento interno, texto ≈12 px y filas de 26–32 px`, m.accRows === 1 && (vp.w >= 1900 ? m.wrapOverflow <= 1 : true) && parseFloat(m.font) >= 11 && parseFloat(m.font) <= 12.5 && (vp.w < 1900 || (m.rowMin >= 26 && m.rowMax <= 44)), JSON.stringify(m));
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${ctx.base}/calidad?${qs}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ctx.check("390 px: sin desplazamiento horizontal de la página (la tabla se desplaza dentro de su región) y los seis accesos legibles", overflow <= 1 && (await page.locator("ul.ql-acc-grid a.ql-acc").count()) === 6, String(overflow));
  await shot(page, "calidad-390-resumen");
  for (const [name, query] of urls.filter(([n]) => ["n3", "health", "incidentes", "ficha"].includes(n))) {
    await page.goto(`${ctx.base}/calidad?${query}`);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ctx.check(`390 px «${name}»: sin desplazamiento horizontal de la página`, o <= 1, String(o));
    await shot(page, `calidad-390-${name}`);
  }
  await page.goto(`${ctx.base}/calidad?${qs}`);
  await page.locator(".ql-wrap").first().focus();
  ctx.check("Teclado: la región de la tabla recibe foco", await page.evaluate(() => document.activeElement?.classList.contains("ql-wrap") ?? false));
  await adm.context.close();

  // --- Consulta: lee, no edita
  const rd = await login(ctx, ctx.accounts.readerEmail, ctx.accounts.readerPassword);
  await rd.page.goto(`${ctx.base}/calidad?${qs}&kpi=HEALTH&anio=${P.y}&editar=${atlas.id}|${P.m}`);
  t = await body(rd.page);
  ctx.check("Consulta: lee la matriz y el motivo, sin enlaces de edición ni formulario (sin enlaces que terminan en 403)", /su perfil es de consulta/i.test(t) && (await rd.page.locator("a[aria-label*='Editar']").count()) === 0 && (await rd.page.getByRole("button", { name: "Guardar celda" }).count()) === 0);
  await rd.page.goto(`${ctx.base}/calidad?${qs}&sim=borrador`);
  ctx.check("Consulta: la simulación del borrador es solo del Administrador", /solo para Administradores/.test(await body(rd.page)));
  const rcsv = await fetch(`${ctx.base}/api/analitica/calidad.csv?${qs}`, { headers: { Cookie: await cookie(rd.context, ctx.base) } });
  ctx.check("Consulta: puede descargar el CSV de Calidad", rcsv.status === 200);
  await rd.context.close();
}
