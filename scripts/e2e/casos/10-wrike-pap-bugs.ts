import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page } from "playwright";
import type { Ctx } from "../nucleo";
import { login } from "./util";
import { ticket, writeTickets } from "../../../tests/generators/zendesk";
import { bugsCsv, papBuffer, papDate, papRow, vfsBug, vswBug, wrikeCsv, wrikeRow } from "../../../tests/generators/csapp04";

/**
 * Circuito real de Wrike, PAP y bugs VFS/VSW (CSAPP-04) por el navegador y el trabajador compilados: subida, resumen, filtros de detalle,
 * corrección explícita sin ID con comparación y confirmación, Reprocesar, revisión de vínculos y permisos. Solo datos sintéticos.
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
const rowText = async (page: Page, label: string) => (await page.locator("tr", { hasText: label }).first().innerText()).replace(/\s+/g, " ");
async function waitDb(fn: () => Promise<boolean>, ms = 60000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
const n = async (ctx: Ctx, sql: string) => Number((await ctx.prisma.$queryRawUnsafe<{ n: bigint }[]>(sql))[0].n);

export async function wrikePapBugs(ctx: Ctx): Promise<void> {
  const B = `${ctx.base}/administracion/cargas`;
  const dir = await mkdtemp(path.join(tmpdir(), "csapp-e2e-04-"));
  const file = (name: string) => path.join(dir, name);
  try {
    const group = await ctx.prisma.clientGroup.create({ data: { name: "Grupo E2E 04" } });
    const cA = await ctx.prisma.client.create({ data: { name: "Cliente 04 A", groupId: group.id } });
    const cI = await ctx.prisma.client.create({ data: { name: "VINCLE BUGS 04", isInternal: true } });
    await ctx.prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: "7001", searchValue: "7001", clientId: cA.id } });
    await ctx.prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: "7002", searchValue: "7002", clientId: cI.id } });
    await ctx.prisma.externalIdentity.create({ data: { system: "WRIKE", kind: "PROJECT_NAME", rawValue: "Proyecto Alfa", searchValue: "proyecto alfa", clientId: cA.id } });
    await ctx.prisma.externalIdentity.create({ data: { system: "PAP", kind: "PROJECT_NAME", rawValue: "Proyecto PAP", searchValue: "proyecto pap", clientId: cA.id } });
    const ana = await ctx.prisma.person.create({ data: { name: "Ana PMO 04" } });
    await ctx.prisma.personAlias.create({ data: { personId: ana.id, system: "WRIKE", kind: "NAME", rawValue: "ana.wrike", searchValue: "ana.wrike" } });
    await ctx.prisma.personTerm.create({ data: { personId: ana.id, attribute: "PMO_MEMBER", flag: true } });
    const roleAna = await ctx.prisma.staffCatalogItem.create({ data: { kind: "PMO_ROLE", name: "ANA" } });
    await ctx.prisma.personTerm.create({ data: { personId: ana.id, attribute: "PMO_ROLE", catalogItemId: roleAna.id } });

    const reader = await login(ctx, ctx.accounts.readerEmail, ctx.accounts.readerPassword);
    const { context, page } = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);
    await ctx.startWorker();

    const upload = async (source: string, f: string, opts: { extraccion?: string; fields?: Record<string, string>; selects?: Record<string, string> } = {}) => {
      await page.goto(B);
      await page.locator("summary", { hasText: source }).first().click();
      const form = page.locator("details[open]").first();
      await form.locator('input[type="file"]').setInputFiles(f);
      if (opts.extraccion) await form.getByLabel("Fecha de extracción").fill(opts.extraccion);
      for (const [label, v] of Object.entries(opts.fields ?? {})) await form.getByLabel(new RegExp(label)).fill(v);
      for (const [label, v] of Object.entries(opts.selects ?? {})) await form.getByLabel(new RegExp(label)).selectOption(v);
      await form.getByRole("button", { name: "Subir y validar" }).click();
      await page.waitForURL(/\/administracion\/cargas\/[^/]+$/, { timeout: 30000 });
      return page.url().split("/").pop() as string;
    };
    const confirm = async () => {
      await page.getByRole("button", { name: "Confirmar y activar" }).click();
      return waitStatus(page, "Completado");
    };

    await page.goto(B);
    const home = await body(page);
    ctx.check("CSAPP-04: Cargas ofrece Wrike, PAP, Bugs VFS y Bugs VSW como fuentes disponibles; las finanzas siguen pendientes", (await page.locator("summary", { hasText: /^Wrike$/ }).count()) === 1 && (await page.locator("summary", { hasText: "Bugs VFS" }).count()) === 1 && (await page.locator("summary", { hasText: "Bugs VSW" }).count()) === 1 && (await page.locator("summary", { hasText: /^PAP$/ }).count()) === 1 && /Facturación · soporte[\s\S]*No disponible · pendiente/.test(home));

    // ============================================================ Tickets de apoyo (los pone el circuito de Zendesk)
    await writeTickets(file("tickets.xlsx"), [ticket({ ticket_id: "123456", organization_id: "7001" }), ticket({ ticket_id: "222222", organization_id: "7002", type: "problem" })]);
    await upload("Zendesk · tickets", file("tickets.xlsx"), { extraccion: "2026-01-10" });
    ctx.check("CSAPP-04: los tickets de apoyo se preparan y activan por el circuito común", (await waitStatus(page, "Listo para revisar")) && (await confirm()));

    // ============================================================ Wrike: error obligatorio, luego carga correcta
    await writeFile(file("wrike-error.csv"), wrikeCsv([wrikeRow({ tarea: "buena" }), wrikeRow({ usuario: "", fecha: "", horas: "3", tarea: "horas sin fecha" })]));
    await upload("Wrike", file("wrike-error.csv"));
    ctx.check("Wrike: horas positivas sin fecha son un error obligatorio que impide confirmar y explica qué hacer", (await waitStatus(page, "Listo para revisar")) && (await page.getByRole("button", { name: "Confirmar y activar" }).isDisabled()) && /FECHA_OBLIGATORIA/.test(await body(page)));
    await page.getByRole("button", { name: "Cancelar" }).click();
    ctx.check("Wrike: el lote con error se cancela antes de activar y no deja imputaciones", (await waitStatus(page, "Cancelado")) && (await n(ctx, 'SELECT count(*) n FROM "WrikeTimeEntry"')) === 0);

    const tarea = 'Informe mensual, con "comillas"';
    await writeFile(file("wrike-a.csv"), wrikeCsv([
      wrikeRow({ tarea, horas: "1", ticket: "123.456", fecha: "10/01/2025" }),
      wrikeRow({ tarea: "Soporte menor", horas: "0,5", fecha: "11/01/2025" }),
      wrikeRow({ usuario: "", fecha: "", horas: "0", tarea: "solo tarea" }),
    ]));
    const wa = await upload("Wrike", file("wrike-a.csv"));
    ctx.check("Wrike: el CSV original (coma, comillas, 0,5 h) llega a «Listo para revisar» con el trabajador real", await waitStatus(page, "Listo para revisar"));
    const part = page.getByTestId("wr-particion");
    ctx.check("Wrike: la partición asigna 2 filas / 1,5 h a Cliente y concilia; la tarea sin imputación queda aparte", /Elegibles atribuidas a un Cliente 2 1,5/.test(await rowText(page, "Elegibles atribuidas a un Cliente")) && /Concilia/.test(await part.innerText()) && /tareas sin imputación 1/.test(await body(page)), await part.innerText());
    ctx.check("Wrike: ticket explícito 216.527-style (123.456) normalizado y confirmado; el otro sin ticket", /Ticket explícito confirmado 1/.test(await rowText(page, "Ticket explícito confirmado")) && /Sin ticket 1/.test(await rowText(page, "Sin ticket")));
    ctx.check("Wrike: ANA se desglosa por rol y la política PMO se explica", /ANA 2/.test(await rowText(page, "ANA")) && /Política histórica/.test(await body(page)));
    await page.getByTestId("wr-detalle").getByLabel("Motivo").selectOption("UNIMPUTED");
    await page.getByTestId("wr-detalle").getByRole("button", { name: "Filtrar" }).click();
    await page.waitForLoadState("networkidle");
    ctx.check("Wrike: el detalle filtrable por motivo muestra la tarea sin imputación", (await page.locator('[data-testid="wr-detalle"] tbody tr').count()) === 1 && /solo tarea/.test(await page.getByTestId("wr-detalle").innerText()));
    ctx.check("Wrike: antes de confirmar no hay imputaciones activas", (await n(ctx, 'SELECT count(*) n FROM "WrikeTimeEntry"')) === 0);
    await page.goto(`${B}/${wa}`);
    ctx.check("Wrike: confirmar activa el lote y materializa 2 imputaciones (90 minutos, sin dividir entre 60)", (await confirm()) && (await n(ctx, 'SELECT count(*) n FROM "WrikeTimeEntry"')) === 2 && (await n(ctx, `SELECT count(*) n FROM "WrikeTimeEntry" WHERE minutes = 30`)) === 1);

    // ---- Corrección explícita sin ID
    await writeFile(file("wrike-b.csv"), wrikeCsv([wrikeRow({ tarea, horas: "2,5", ticket: "123.456", fecha: "10/01/2025" })]));
    const wb = await upload("Wrike", file("wrike-b.csv"));
    ctx.check("Wrike: el segundo archivo (misma imputación con otra duración) queda listo sin sustituir nada por parecido", (await waitStatus(page, "Listo para revisar")) && (await n(ctx, 'SELECT count(*) n FROM "WrikeTimeDecision"')) === 0);
    await page.getByRole("link", { name: "Relacionar con un registro" }).first().click();
    await page.getByTestId("correccion-panel").waitFor();
    await page.getByTestId("correccion-panel").getByLabel("Texto de tarea/proyecto").fill("informe mensual");
    await page.getByTestId("correccion-panel").getByRole("button", { name: "Buscar" }).click();
    await page.waitForLoadState("networkidle");
    ctx.check("Wrike: los filtros localizan el registro activo (solo ayudan; no deciden)", (await page.getByTestId("correccion-panel").locator("tbody tr").count()) === 1);
    await page.getByTestId("correccion-panel").getByRole("link", { name: "Comparar" }).click();
    await page.getByTestId("comparacion").waitFor();
    ctx.check("Wrike: la comparación muestra ambos registros, la diferencia en minutos y antes/después (1 h → 2,5 h)", /Minutos/.test(await page.getByTestId("comparacion").innerText()) && /Antes: 1 h · después: 2,5 h/.test(await page.getByTestId("minutos-antes-despues").innerText()));
    await page.getByRole("button", { name: "Confirmar sustitución" }).click();
    ctx.check("Wrike: sin la confirmación expresa de la sustitución concreta el servidor rechaza", await page.getByText("Confirme expresamente").waitFor({ timeout: 15000 }).then(() => true, () => false) && (await n(ctx, 'SELECT count(*) n FROM "WrikeTimeDecision"')) === 0);
    await page.getByLabel(/Confirmo que esta fila sustituye/).check();
    await page.getByRole("button", { name: "Confirmar sustitución" }).click();
    ctx.check("Wrike: con la confirmación se guarda la decisión auditada", await waitDb(async () => (await n(ctx, `SELECT count(*) n FROM "WrikeTimeDecision" WHERE decision = 'CORRECTION'`)) === 1) && (await n(ctx, `SELECT count(*) n FROM "AuditEvent" WHERE "batchId" = '${wb}' AND "entityType" = 'TimeDecision'`)) === 1);
    await page.goto(`${B}/${wb}`);
    ctx.check("Wrike: confirmar el lote sustituye la duración (no suma): sigue habiendo 2 registros y el corregido pasa a 150 min en la revisión 2", (await confirm()) && (await n(ctx, 'SELECT count(*) n FROM "WrikeTimeEntry"')) === 2 && (await n(ctx, `SELECT count(*) n FROM "WrikeTimeEntry" WHERE minutes = 150 AND revision = 2`)) === 1);

    // ---- Reprocesar un lote completado y repetir el archivo
    await page.goto(`${B}/${wa}`);
    await page.getByRole("button", { name: "Reprocesar" }).click();
    await page.waitForTimeout(1500);
    ctx.check("Wrike: Reprocesar un lote completado recalcula sin duplicar registros ni cambiar fechas", await waitDb(async () => (await n(ctx, `SELECT count(*) n FROM "AuditEvent" WHERE action = 'REPROCESS' AND "batchId" = '${wa}'`)) >= 2) && (await n(ctx, 'SELECT count(*) n FROM "WrikeTimeEntry"')) === 2);
    await upload("Wrike", file("wrike-a.csv"));
    ctx.check("Wrike: repetir el archivo A no añade imputaciones ni horas (filas idénticas con otra duración corregida no se reintroducen)", (await waitStatus(page, "Listo para revisar")) && /Duplicadas de lotes ya importados/.test(await body(page)) && (await n(ctx, 'SELECT count(*) n FROM "WrikeTimeEntry"')) === 2);

    // ============================================================ PAP
    await writeFile(file("pap.xlsx"), await papBuffer([
      papRow({ Title: "ID 42: PAP texto", "Causa raíz": "Correctivo (Estándar);#Evolutivo", "Tickets asociados": "#123456; 222222", "Nº de BUG": "1001; VFS 2002", Resultado: "Rollback" }),
      papRow({ Title: "43: cliente", "Causa raíz": "Correctivo (Origen cliente)", Proyecto: "Proyecto PAP", "Fecha puesta en producción": papDate("2025-03-01") }),
      papRow({ Title: "44: sin fecha", "Fecha puesta en producción": null, "Fecha de Solicitud": null, "Causa raíz": null }),
    ]));
    const pa = await upload("PAP", file("pap.xlsx"), { fields: { "Lista de origen": "pap-e2e" } });
    ctx.check("PAP: el XLSX de 29 columnas se valida y llega a «Listo para revisar»", await waitStatus(page, "Listo para revisar"));
    ctx.check("PAP: 3 PAP distintos, 2 correctivos únicos aunque uno tenga varias causas y dos tickets, 1 sin clasificar", /PAP distintos \(cada uno cuenta una vez\) 3/.test(await rowText(page, "PAP distintos (cada")) && /Correctivos únicos[^0-9]*2/.test(await rowText(page, "Correctivos únicos")) && /Causa vacía o sin clasificar[^0-9]*1/.test(await rowText(page, "Causa vacía")), await rowText(page, "Correctivos únicos"));
    ctx.check("PAP: origen cliente conservado, pertenencias no aditivas, Resultado sin filtro OK y Duración sin sumar horas", /Origen cliente 1/.test(await rowText(page, "Origen cliente")) && /Rollback/.test(await body(page)) && /no se suma a las horas/.test(await body(page)));
    ctx.check("PAP: el periodo usa la producción; 1 PAP queda sin fecha sin inventar ejecución", /Sin fecha de producción[^0-9]*1/.test(await rowText(page, "Sin fecha de producción (conservados")));
    ctx.check("PAP: Nº de BUG con producto sin determinar (1001) no se asigna; VFS 2002 queda como referencia explícita pendiente", /Nº de BUG con producto sin determinar[^0-9]*1/.test(await rowText(page, "Nº de BUG con producto sin determinar")) && /2 \/ 1 \/ 0/.test(await rowText(page, "Nº de BUG: referencias distintas")), await rowText(page, "Nº de BUG: referencias"));
    await page.goto(`${B}/${pa}`);
    ctx.check("PAP: confirmar activa 3 PAP y las observaciones", (await confirm()) && (await n(ctx, 'SELECT count(*) n FROM "PapItem"')) === 3 && (await n(ctx, 'SELECT count(*) n FROM "PapObservation"')) === 3);
    await writeFile(file("pap2.xlsx"), await papBuffer([papRow({ Title: "42: texto cambiado", "Causa raíz": "Evolutivo;#Correctivo (Estándar)", "Tickets asociados": "#123456; 222222", "Nº de BUG": "1001; VFS 2002", Resultado: "Rollback" })]));
    await upload("PAP", file("pap2.xlsx"), { fields: { "Lista de origen": "pap-e2e" } });
    ctx.check("PAP: el mismo ID con título cambiado es una revisión, no otro PAP", (await waitStatus(page, "Listo para revisar")) && /Revisiones de un PAP existente[^0-9]*1/.test(await rowText(page, "Revisiones de un PAP existente")) && (await n(ctx, 'SELECT count(*) n FROM "PapItem"')) === 3);

    // ============================================================ Bugs VFS y VSW por separado
    await writeFile(file("vfs.csv"), bugsCsv("VFS", [vfsBug({ ID: "2002", State: "PR" }), vfsBug({ ID: "2003", "Work Item Type": "Request", Title: "BUG en un Request", State: "Done" })]));
    await writeFile(file("vsw.csv"), bugsCsv("VSW", [
      vswBug({ ID: "2002", State: "Done (Ready for Release)", "Zendesk Ticket ID": "222222", Clients: '<a href="https://vincle.zendesk.com/agent/tickets/123456">C</a> <a href="https://vincle.zendesk.com/agent/tickets/123456">C</a> <a href="#">@Ana</a>' }),
      vswBug({ ID: "2004", State: "Estado nuevo" }),
    ]));
    await upload("Bugs VFS", file("vfs.csv"), { extraccion: "2026-03-01", selects: { "Vista del listado": "AMPLIA" } });
    ctx.check("Bugs VFS: el CSV llega a «Listo para revisar» con la vista declarada", await waitStatus(page, "Listo para revisar"));
    ctx.check("Bugs VFS: 2 elementos, solo 1 Bug_; un Request llamado BUG no cuenta; PR no acredita producción", /Work Items distintos 2/.test(await rowText(page, "Work Items distintos")) && /Bug_ distintos[^0-9]*1/.test(await rowText(page, "Bug_ distintos")) && /pendiente de crear la pull request/.test(await body(page)));
    ctx.check("Bugs VFS: la ficha explica que la ausencia no cierra ni borra y rotula los no observados", /no cierra, borra ni resuelve/.test(await page.getByTestId("bug-no-observados").innerText()));
    await confirm();
    const bw = await upload("Bugs VSW", file("vsw.csv"), { extraccion: "2026-03-02", selects: { "Vista del listado": "ABIERTOS" } });
    ctx.check("Bugs VSW: se prepara por separado; el ID 2002 no se fusiona con el de VFS y el estado nuevo requiere revisión", (await waitStatus(page, "Listo para revisar")) && /Estados fuera del catálogo[^0-9]*1/.test(await rowText(page, "Estados fuera del catálogo")) && (await body(page)).includes("Ready for Release"));
    ctx.check("Bugs VSW: la URL repetida se deduplica (2 pares: ticket central 222222 y 123456), href=# no es ticket", /Pares Work Item–ticket distintos[^0-9]*2/.test(await rowText(page, "Pares Work Item–ticket")) && /Ticket central interno/.test(await body(page)));
    await page.goto(`${B}/${bw}`);
    ctx.check("Bugs VSW: confirmar activa por separado de VFS (VFS 2 elementos, VSW 2; mismo ID 2002 en ambos)", (await confirm()) && (await n(ctx, `SELECT count(*) n FROM "WorkItem" WHERE product = 'VFS'`)) === 2 && (await n(ctx, `SELECT count(*) n FROM "WorkItem" WHERE product = 'VSW'`)) === 2 && (await n(ctx, `SELECT count(*) n FROM "WorkItem" WHERE "workItemId" = '2002'`)) === 2);
    ctx.check("Bugs: el ticket interno no asigna Clientes y el externo queda resuelto (1 vínculo externo, 1 central)", (await n(ctx, `SELECT count(*) n FROM "WorkItemLink" WHERE "drvState" = 'RESOLVED_EXTERNAL'`)) === 1 && (await n(ctx, `SELECT count(*) n FROM "WorkItemLink" WHERE "drvState" = 'CENTRAL_INTERNAL'`)) === 1);
    await page.goto(`${B}/${bw}/elementos/2002`);
    ctx.check("Bugs: el detalle del Work Item muestra los vínculos con su evidencia y resolución", (await page.getByTestId("wi-vinculos").getByRole("row").count()) >= 3 && /Columna Zendesk Ticket ID/.test(await body(page)) && /URL de ticket en «Clients»/.test(await body(page)));
    await page.getByRole("button", { name: "Confirmar vínculo" }).first().click();
    ctx.check("Bugs: la revisión explícita del vínculo se guarda y se audita", await waitDb(async () => (await n(ctx, `SELECT count(*) n FROM "WorkItemLink" WHERE "manualState" = 'CONFIRMED'`)) === 1) && (await n(ctx, `SELECT count(*) n FROM "AuditEvent" WHERE "entityType" = 'WorkItemLink'`)) === 1);

    // ---- Reversión de un lote propio
    await page.goto(`${B}/${wb}`);
    await page.getByRole("button", { name: "Revertir" }).click();
    ctx.check("Wrike: revertir el lote que corrigió restituye la duración anterior (60 min) sin duplicar", await waitDb(async () => (await n(ctx, `SELECT count(*) n FROM "WrikeTimeEntry" WHERE minutes = 60`)) === 1, 60000) && (await n(ctx, 'SELECT count(*) n FROM "WrikeTimeEntry"')) === 2);

    // ============================================================ Permisos
    const fileRow = await ctx.prisma.uploadBatch.findFirstOrThrow({ where: { profileId: "wrike", status: "COMPLETED" } });
    await reader.page.goto(`${B}/${fileRow.id}`);
    ctx.check("CSAPP-04: Consulta no llega a la ficha del lote", !reader.page.url().includes(`/cargas/${fileRow.id}`));
    const st = await reader.context.request.get(`${ctx.base}/api/cargas/${fileRow.id}/estado`);
    const dl = await reader.context.request.get(`${ctx.base}/api/cargas/${fileRow.id}/archivo`);
    ctx.check("CSAPP-04: Consulta no lee el estado ni descarga el archivo (403)", st.status() === 403 && dl.status() === 403);
    await reader.page.goto(`${B}/${bw}/elementos/2002`);
    ctx.check("CSAPP-04: Consulta no llega al detalle del Work Item ni a sus vínculos", !reader.page.url().includes("/elementos/"));
    const anon = await ctx.browser.newContext();
    const a1 = await anon.request.get(`${ctx.base}/api/cargas/${fileRow.id}/archivo`);
    ctx.check("CSAPP-04: sin sesión tampoco se descarga el archivo (401)", a1.status() === 401);
    await anon.close();
    await reader.context.close();
    await context.close();
  } finally {
    await ctx.stopWorker();
    await rm(dir, { recursive: true, force: true });
  }
}
