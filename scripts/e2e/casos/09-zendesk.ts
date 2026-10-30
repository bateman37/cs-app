import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page } from "playwright";
import type { Ctx } from "../nucleo";
import { login } from "./util";
import { excelSerial, ticket, timeRow, writeTickets, writeTimes, type TicketRow, type TimeRow } from "../../../tests/generators/zendesk";

/**
 * Circuito real de Tickets y Tiempos Zendesk (CSAPP-03): selección, subida de un XLSX por la interfaz, validación,
 * previsualización, confirmación, trabajador real y consulta; más Cancelar (antes de activar), Reprocesar (listo y
 * completado) y Revertir con sus efectos en los datos. Solo datos sintéticos.
 */
const day = (iso: string) => ({ date: excelSerial(iso) });
const hourAt = (h: number, m: number) => ({ date: (h * 60 + m) / 1440 });

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
const filtrar = (page: Page) => page.getByTestId("zd-detalle").getByRole("button", { name: "Filtrar" });
async function waitDb(fn: () => Promise<boolean>, ms = 60000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
const n = async (ctx: Ctx, sql: string) => Number((await ctx.prisma.$queryRawUnsafe<{ n: bigint }[]>(sql))[0].n);

export async function zendesk(ctx: Ctx): Promise<void> {
  const B = `${ctx.base}/administracion/cargas`;
  const dir = await mkdtemp(path.join(tmpdir(), "csapp-e2e-zd-"));
  const file = (name: string) => path.join(dir, name);
  try {
    // --- Maestros sintéticos (los pone el entorno de prueba; el importador nunca los crea).
    const group = await ctx.prisma.clientGroup.create({ data: { name: "Grupo E2E" } });
    const cA = await ctx.prisma.client.create({ data: { name: "Cliente A", groupId: group.id } });
    const cB = await ctx.prisma.client.create({ data: { name: "Cliente B sin grupo" } });
    const cI = await ctx.prisma.client.create({ data: { name: "VINCLE BUGS E2E", isInternal: true } });
    for (const [orgId, c] of [["9001", cA], ["9002", cB], ["9003", cI]] as const) {
      await ctx.prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: orgId, searchValue: orgId, clientId: c.id } });
    }
    const ana = await ctx.prisma.person.create({ data: { name: "Ana PMO E2E" } });
    const ivan = await ctx.prisma.person.create({ data: { name: "Ivan IT E2E" } });
    for (const [p, id, pmo] of [[ana, "5001", true], [ivan, "5002", false]] as const) {
      await ctx.prisma.personAlias.create({ data: { personId: p.id, system: "ZENDESK", kind: "ID", rawValue: id, searchValue: id } });
      await ctx.prisma.personTerm.create({ data: { personId: p.id, attribute: "PMO_MEMBER", flag: pmo } });
    }

    // --- Consulta: sin acceso a fichas, archivos ni estado.
    const reader = await login(ctx, ctx.accounts.readerEmail, ctx.accounts.readerPassword);

    const { context, page } = await login(ctx, ctx.accounts.adminEmail, ctx.accounts.adminPassword);
    await ctx.startWorker();

    const upload = async (source: string, f: string, extraccion?: string, hoja?: string) => {
      await page.goto(B);
      await page.locator("summary", { hasText: source }).first().click();
      const form = page.locator("details[open]").first();
      await form.locator('input[type="file"]').setInputFiles(f);
      if (extraccion) await form.getByLabel("Fecha de extracción").fill(extraccion);
      if (hoja) await form.getByLabel(/Hoja del libro/).fill(hoja);
      await form.getByRole("button", { name: "Subir y validar" }).click();
      await page.waitForURL(/\/administracion\/cargas\/[^/]+$/, { timeout: 30000 });
      return page.url().split("/").pop() as string;
    };

    await page.goto(B);
    const t0 = await body(page);
    ctx.check("Zendesk: Cargas ofrece Tickets y Tiempos como fuentes disponibles y deja solo las finanzas como pendientes", (await page.locator("summary", { hasText: "Zendesk · tickets" }).count()) === 1 && (await page.locator("summary", { hasText: "Zendesk · tiempos" }).count()) === 1 && /Facturación · soporte[\s\S]*No disponible · pendiente/.test(t0) && !/Zendesk · tickets\s*No disponible/.test(t0));

    // ============================================================ Tickets
    const ticketsA: TicketRow[] = [
      ticket({ ticket_id: "1", organization_id: "9001", tags: '["team_n3_pmo","team_it"]', status: "open", causa: "incidente_estándar_plataforma" }),
      ticket({ ticket_id: "2", organization_id: "9001", status: "solved", tags: '["team_n2"]' }),
      ticket({ ticket_id: "3", organization_id: "9002", status: "pending", tags: "[]" }),
      ticket({ ticket_id: "4", organization_id: "9999", causa: "Sistemas del Cliente", tags: "[]" }),
      ticket({ ticket_id: "5", organization_id: null, causa: null, entorno: null, tags: "[]" }),
      ticket({ ticket_id: "6", organization_id: "9003", causa: "Uso Indebido", tags: "[]" }),
      ticket({ ticket_id: "1", organization_id: "9001", tags: '["team_it","team_n3_pmo"]', status: "open", causa: "incidente_estándar_plataforma" }),
      ticket({ ticket_id: "8", type: "epic", tags: "[]" }),
      ticket({ ticket_id: "9", organization_id: "9001", tags: "[]", status: "hold" }),
    ];
    await writeTickets(file("tickets-a.xlsx"), ticketsA);
    const ta = await upload("Zendesk · tickets", file("tickets-a.xlsx"), "2026-01-10");
    ctx.check("Zendesk tickets: la subida por la interfaz llega a «Listo para revisar» con el trabajador real", await waitStatus(page, "Listo para revisar"));
    const sumT = async (label: string) => rowText(page, label);
    ctx.check("Zendesk tickets: el resumen diferencia filas, duplicados exactos y tickets distintos (9 filas, 1 duplicado, 8 tickets)", /Filas recibidas 9/.test(await sumT("Filas recibidas")) && /Duplicados exactos en el archivo 1/.test(await sumT("Duplicados exactos")) && /Tickets distintos 8/.test(await sumT("Tickets distintos")));
    ctx.check("Zendesk tickets: nuevos 8, organizaciones pendientes, Cliente sin grupo, internos y clasificación incompleta", /Nuevos 8/.test(await sumT("Nuevos")) && /Sin organización informada 1/.test(await sumT("Sin organización informada")) && /Organización sin Cliente equivalente 1/.test(await sumT("Organización sin Cliente equivalente")) && /Cliente sin Grupo BC 1/.test(await sumT("Cliente sin Grupo BC")) && /Internos 1/.test(await sumT("Internos")) && /Clasificación incompleta 2/.test(await sumT("Clasificación incompleta")), await sumT("Clasificación incompleta"));
    ctx.check("Zendesk tickets: escalados por tag exacto con unión N3 sin doble conteo (PMO 1, IT 1, unión 1)", /PMO N3 1/.test(await sumT("PMO N3")) && /IT N3 1/.test(await sumT("IT N3")) && /Unión N3[^0-9]*1$/.test(await sumT("Unión N3")), await sumT("Unión N3"));
    ctx.check("Zendesk tickets: la ficha enseña extracción declarada y la observación (frescura conocida)", /Fecha de observación: extracción declarada 10\/01\/2026/.test(await body(page)));
    await page.getByTestId("zd-detalle").getByLabel("Filtro").selectOption("org_none");
    await filtrar(page).click();
    await page.waitForLoadState("networkidle");
    ctx.check("Zendesk tickets: el filtro del detalle por motivo lleva al ticket sin organización y a su fila de origen", (await page.locator('[data-testid="zd-detalle"] tbody tr').count()) === 1 && /5/.test(await page.locator('[data-testid="zd-detalle"] tbody tr').first().innerText()));
    ctx.check("Zendesk tickets: antes de activar los tickets no se enlazan a un detalle que todavía no existe", (await page.locator('[data-testid="zd-detalle"] tbody a').count()) === 0);
    await page.goto(`${B}/${ta}`);
    ctx.check("Zendesk tickets: antes de confirmar no hay tickets activos", (await n(ctx, 'SELECT count(*) n FROM "ZdTicket"')) === 0);
    await page.getByRole("button", { name: "Confirmar y activar" }).click();
    ctx.check("Zendesk tickets: confirmar activa el lote con el trabajador (Completado)", await waitStatus(page, "Completado"));
    ctx.check("Zendesk tickets: se materializan 8 tickets y 8 observaciones; el duplicado y los tickets sin horas se conservan", (await n(ctx, 'SELECT count(*) n FROM "ZdTicket"')) === 8 && (await n(ctx, 'SELECT count(*) n FROM "ZdTicketObservation"')) === 8);
    await page.getByTestId("zd-detalle").getByLabel("Filtro").selectOption("org_none");
    await filtrar(page).click();
    await page.waitForLoadState("networkidle");
    await page.locator('[data-testid="zd-detalle"] tbody a', { hasText: "5" }).first().click();
    await page.waitForURL(/\/tickets\/5$/);
    ctx.check("Zendesk tickets: ya activo, el detalle del ticket muestra revisiones, observaciones y que no tiene horas", (await page.getByText("Revisiones de contenido").count()) > 0 && (await page.getByText("Observaciones", { exact: true }).count()) > 0 && (await page.getByText("Este ticket no tiene horas importadas").count()) > 0);
    await page.goto(`${B}/${ta}`);

    // Segunda extracción: revisión y observación sin cambios.
    await writeTickets(file("tickets-b.xlsx"), [
      ticket({ ticket_id: "1", organization_id: "9001", tags: '["team_n3_pmo","team_it"]', status: "solved", causa: "incidente_estándar_plataforma" }),
      ticket({ ticket_id: "2", organization_id: "9001", status: "solved", tags: '["team_n2"]' }),
    ]);
    const tb = await upload("Zendesk · tickets", file("tickets-b.xlsx"), "2026-02-10");
    ctx.check("Zendesk tickets: la segunda extracción distingue 1 revisado y 1 sin cambios", (await waitStatus(page, "Listo para revisar")) && /Revisados 1/.test(await sumT("Revisados")) && /Sin cambios \(solo observación\) 1/.test(await sumT("Sin cambios")));
    await page.getByRole("button", { name: "Confirmar y activar" }).click();
    await waitStatus(page, "Completado");
    ctx.check("Zendesk tickets: el cambio open→solved crea una revisión (no otro ticket) y la observación del ticket sin cambios se registra", (await n(ctx, 'SELECT count(*) n FROM "ZdTicket"')) === 8 && (await n(ctx, `SELECT count(*) n FROM "ZdTicketRevision" WHERE "ticketId" = '1'`)) === 2 && (await n(ctx, `SELECT count(*) n FROM "ZdTicketObservation" WHERE "ticketId" = '2'`)) === 2 && (await n(ctx, `SELECT count(*) n FROM "ZdTicketRevision" WHERE "ticketId" = '2'`)) === 1);

    // Cancelar antes de activar.
    await writeTickets(file("tickets-c.xlsx"), [ticket({ ticket_id: "77" })]);
    const tc = await upload("Zendesk · tickets", file("tickets-c.xlsx"), "2026-02-11");
    await waitStatus(page, "Listo para revisar");
    await page.getByRole("button", { name: "Cancelar" }).click();
    ctx.check("Zendesk tickets: Cancelar antes de activar deja el lote «Cancelado» sin crear el ticket", (await waitStatus(page, "Cancelado")) && (await n(ctx, `SELECT count(*) n FROM "ZdTicket" WHERE "ticketId" = '77'`)) === 0);
    ctx.check("Zendesk tickets: un lote cancelado ya no puede confirmarse (botón deshabilitado con motivo)", await page.getByRole("button", { name: "Confirmar y activar" }).isDisabled());
    void tc;

    // Formato antiguo.
    await writeTickets(file("tickets-viejo.xlsx"), [ticket()], { headers: ["ticket_id", "organization_id", "Entorno y Tipología", "CausaRaiz(Agr)", "tags", "fecha_creación", "type", "estado"] });
    await upload("Zendesk · tickets", file("tickets-viejo.xlsx"));
    ctx.check("Zendesk tickets: un perfil antiguo sin status se rechaza con el motivo y sin tocar los activos", (await waitStatus(page, "Rechazado")) && /status/.test(await body(page)) && (await n(ctx, 'SELECT count(*) n FROM "ZdTicket"')) === 8);

    // Errores obligatorios: no se confirma.
    await writeTickets(file("tickets-err.xlsx"), [ticket({ ticket_id: "50" }), ticket({ ticket_id: "51", creada: "no-es-fecha" })]);
    await upload("Zendesk · tickets", file("tickets-err.xlsx"));
    await waitStatus(page, "Listo para revisar");
    ctx.check("Zendesk tickets: con errores obligatorios sin resolver «Confirmar» queda deshabilitado y explica qué hacer", (await page.getByRole("button", { name: "Confirmar y activar" }).isDisabled()) && /corrija el archivo/i.test(await body(page)) && /FECHA_INVALIDA/.test(await body(page)));
    await page.getByRole("button", { name: "Cancelar" }).click();
    await waitStatus(page, "Cancelado");

    // ============================================================ Tiempos
    const timesA: TimeRow[] = [
      timeRow({ id: "88", ticket_id: "1", user_id: "5002", user_name: "Ivan", logged_hours: 1, logged_minutes: 30, hour: hourAt(8, 25), date: day("2024-12-15") }),
      timeRow({ id: null, ticket_id: "1", user_id: "5001", user_name: "Ana", logged_hours: 2, logged_minutes: 0, date: day("2024-12-31") }),
      timeRow({ id: null, ticket_id: "1", user_id: "5001", user_name: "Ana", logged_hours: 3, logged_minutes: 0, date: day("2025-01-02"), hour: hourAt(9, 0) }),
      timeRow({ id: null, ticket_id: "555", user_id: "5002", user_name: "Ivan", logged_hours: 0, logged_minutes: 30, date: day("2025-03-03") }),
      timeRow({ id: null, ticket_id: "2", user_id: "9999", user_name: "Sin alta", logged_hours: 0, logged_minutes: 5, date: day("2024-11-05") }),
      timeRow({ id: null, ticket_id: "2", user_id: "5002", user_name: "Ivan", logged_hours: 0, logged_minutes: 5, date: day("2025-04-07"), hour: hourAt(9, 5) }),
      timeRow({ id: null, ticket_id: "2", user_id: "5002", user_name: "Ivan", logged_hours: 0, logged_minutes: 5, date: day("2025-04-07"), hour: hourAt(9, 5) }),
    ];
    await writeTimes(file("tiempos-a.xlsx"), timesA);
    const xa = await upload("Zendesk · tiempos", file("tiempos-a.xlsx"), "2026-02-12");
    ctx.check("Zendesk tiempos: la subida llega a «Listo para revisar»", await waitStatus(page, "Listo para revisar"));
    const zd = page.getByTestId("zd-resumen");
    const rowsOf = async (label: string) => (await zd.locator("tr", { hasText: label }).first().innerText()).replace(/\s+/g, " ");
    ctx.check("Zendesk tiempos: la partición separa duplicada, PMO excluida, sin ticket, sin persona y atribuible", /Duplicadas dentro del archivo.* 1 /.test(await rowsOf("Duplicadas dentro del archivo")) && /Excluidas por fuente: PMO.* 1 3/.test(await rowsOf("Excluidas por fuente")) && /Sin ticket conocido 1 0,5/.test(await rowsOf("Sin ticket conocido")) && /Sin persona resuelta 1 0,0833/.test(await rowsOf("Sin persona resuelta")) && /Atribuibles a un Cliente 3 3,5833/.test(await rowsOf("Atribuibles a un Cliente")), await zd.innerText());
    ctx.check("Zendesk tiempos: la partición reconcilia con las filas y horas válidas (7 filas)", /Reconcilia con las filas y horas válidas/.test(await zd.innerText()) && (await page.getByTestId("zd-suma-filas").innerText()).trim() === "7");
    ctx.check("Zendesk tiempos: se explica que las horas PMO posteriores al corte no se toman de Zendesk", /Las horas de PMO desde el 01\/01\/2025 no se toman de Zendesk/.test(await body(page)));
    await page.getByTestId("zd-detalle").getByLabel("Motivo").selectOption("EXCLUDED_PMO");
    await filtrar(page).click();
    await page.waitForLoadState("networkidle");
    ctx.check("Zendesk tiempos: el filtro por motivo lleva a la fila de origen excluida (3 h)", (await page.locator('[data-testid="zd-detalle"] tbody tr').count()) === 1 && /3/.test(await page.locator('[data-testid="zd-detalle"] tbody tr').first().innerText()));
    await page.goto(`${B}/${xa}`);
    await page.getByRole("button", { name: "Confirmar y activar" }).click();
    ctx.check("Zendesk tiempos: confirmar activa el lote (Completado)", await waitStatus(page, "Completado"));
    ctx.check("Zendesk tiempos: se materializan 6 registros (el duplicado cuenta una vez) incluida la fila PMO excluida como trazabilidad", (await n(ctx, 'SELECT count(*) n FROM "ZdTimeEntry"')) === 6 && (await n(ctx, `SELECT count(*) n FROM "ZdTimeEntry" WHERE "drvBucket" = 'EXCLUDED_PMO'`)) === 1);
    ctx.check("Zendesk tiempos: tras activar la ficha muestra las cifras de los registros y siguen reconciliando", /Cifras de los registros materializados/.test(await body(page)) && /Reconcilia con las filas y horas válidas/.test(await body(page)));

    // Corrección explícita.
    await writeTimes(file("tiempos-b.xlsx"), [timeRow({ id: "88", ticket_id: "1", user_id: "5002", user_name: "Ivan", logged_hours: 2, logged_minutes: 0, hour: hourAt(8, 25), date: day("2024-12-15") })]);
    const xb = await upload("Zendesk · tiempos", file("tiempos-b.xlsx"), "2026-02-13");
    await waitStatus(page, "Listo para revisar");
    ctx.check("Zendesk tiempos: la posible corrección (mismo id y contexto, otra duración) se advierte con antes y después y queda sin decidir", (await page.getByTestId("zd-correcciones").count()) === 1 && /1,5 h → 2 h/.test(await page.getByTestId("zd-correcciones").innerText()) && /Sin decidir/.test(await page.getByTestId("zd-correcciones").innerText()));
    await page.getByRole("link", { name: /Comparar con el registro de 1,5 h/ }).click();
    await page.getByTestId("comparacion").waitFor();
    ctx.check("Zendesk tiempos: la comparación muestra ambos registros y los minutos antes/después", /Antes: 1,5 h · después: 2 h/.test(await page.getByTestId("minutos-antes-despues").innerText()));
    await page.getByLabel(/Confirmo que esta fila sustituye/).check();
    await page.getByRole("button", { name: "Confirmar sustitución" }).click();
    await waitDb(async () => (await n(ctx, `SELECT count(*) n FROM "ZdTimeDecision" WHERE "batchId" = '${xb}'`)) === 1);
    await page.goto(`${B}/${xb}`);
    ctx.check("Zendesk tiempos: la decisión explícita queda registrada y auditada", /Corrige el registro seleccionado/.test(await page.getByTestId("zd-correcciones").innerText()) && (await n(ctx, `SELECT count(*) n FROM "AuditEvent" WHERE "entityType" = 'TimeDecision' AND "batchId" = '${xb}'`)) === 1);
    await page.getByRole("button", { name: "Confirmar y activar" }).click();
    await waitStatus(page, "Completado");
    ctx.check("Zendesk tiempos: la corrección sustituye 1,5 h por 2 h sin sumarlas y conserva el contenido anterior", (await n(ctx, 'SELECT count(*) n FROM "ZdTimeEntry"')) === 6 && (await n(ctx, `SELECT count(*) n FROM "ZdTimeEntry" WHERE "sourceId" = '88' AND minutes = 120`)) === 1 && (await n(ctx, 'SELECT count(*) n FROM "ZdTimeCorrection"')) === 1);

    // Reprocesar (lote listo): vuelve a validar el archivo guardado.
    await writeTimes(file("tiempos-c.xlsx"), [
      timeRow({ id: null, ticket_id: "99", user_id: "7777", user_name: "Persona tardía", logged_hours: 4, logged_minutes: 0, date: day("2024-10-10") }),
      timeRow({ id: null, ticket_id: "99", user_id: "5002", user_name: "Ivan", logged_hours: 1, logged_minutes: 0, date: day("2024-10-11") }),
    ]);
    const xc = await upload("Zendesk · tiempos", file("tiempos-c.xlsx"), "2026-02-14");
    await waitStatus(page, "Listo para revisar");
    const preparedBefore = (await ctx.prisma.uploadBatch.findUniqueOrThrow({ where: { id: xc } })).preparedAt?.getTime() ?? 0;
    await page.getByRole("button", { name: "Reprocesar" }).click();
    const reprepared = await waitDb(async () => {
      const b = await ctx.prisma.uploadBatch.findUniqueOrThrow({ where: { id: xc } });
      return b.status === "READY" && (b.preparedAt?.getTime() ?? 0) > preparedBefore;
    });
    await page.reload();
    ctx.check("Zendesk tiempos: Reprocesar un lote listo lo valida de nuevo con el mismo archivo y vuelve a «Listo para revisar»", reprepared && (await waitStatus(page, "Listo para revisar")) && (await body(page)).includes("Atribuibles a un Cliente") && (await n(ctx, 'SELECT count(*) n FROM "ZdTimeEntry"')) === 6);
    await page.getByRole("button", { name: "Confirmar y activar" }).click();
    await waitStatus(page, "Completado");
    ctx.check("Zendesk tiempos: el tiempo de una persona aún sin alta y de un ticket sin cargar se conserva sin atribuir (no es cero)", (await n(ctx, `SELECT count(*) n FROM "ZdTimeEntry" WHERE "ticketId" = '99' AND "drvBucket" = 'NO_TICKET'`)) === 2);

    // Llegan los tickets después de los tiempos.
    await writeTickets(file("tickets-d.xlsx"), [ticket({ ticket_id: "99", organization_id: "9001", tags: "[]" })]);
    await upload("Zendesk · tickets", file("tickets-d.xlsx"), "2026-02-15");
    await waitStatus(page, "Listo para revisar");
    await page.getByRole("button", { name: "Confirmar y activar" }).click();
    await waitStatus(page, "Completado");
    ctx.check("Zendesk tiempos: al llegar el ticket (después de los tiempos) se resuelven solos, sin recrear ni duplicar los tiempos", (await n(ctx, 'SELECT count(*) n FROM "ZdTimeEntry"')) === 8 && (await n(ctx, `SELECT count(*) n FROM "ZdTimeEntry" WHERE "ticketId" = '99' AND "drvBucket" = 'ATTRIBUTABLE'`)) === 1 && (await n(ctx, `SELECT count(*) n FROM "ZdTimeEntry" WHERE "ticketId" = '99' AND "drvBucket" = 'NO_PERSON'`)) === 1);
    // Se da de alta a la persona (maestro) y se recalcula el lote completado desde su ficha.
    await ctx.prisma.person.create({ data: { name: "Persona tardía E2E" } }).then(async (p) => {
      await ctx.prisma.personAlias.create({ data: { personId: p.id, system: "ZENDESK", kind: "ID", rawValue: "7777", searchValue: "7777" } });
      await ctx.prisma.personTerm.create({ data: { personId: p.id, attribute: "PMO_MEMBER", flag: false } });
    });
    await page.goto(`${B}/${xc}`);
    const before = await n(ctx, `SELECT count(*) n FROM "ZdTimeEntry" WHERE "ticketId" = '99' AND "drvBucket" = 'NO_PERSON'`);
    ctx.check("Zendesk tiempos: un lote completado ofrece Reprocesar (recalcular) con su explicación", await page.getByRole("button", { name: "Reprocesar" }).isEnabled() && /Recalcula relaciones y atribución/.test(await body(page)));
    const audited = () => n(ctx, `SELECT count(*) n FROM "AuditEvent" WHERE "batchId" = '${xc}' AND action = 'REPROCESS' AND summary LIKE '%se recalculó%'`);
    const auditedBefore = await audited();
    await page.getByRole("button", { name: "Reprocesar" }).click();
    await waitDb(async () => (await audited()) > auditedBefore);
    const after = await n(ctx, `SELECT count(*) n FROM "ZdTimeEntry" WHERE "ticketId" = '99' AND "drvBucket" = 'NO_PERSON'`);
    ctx.check("Zendesk tiempos: Reprocesar con el maestro completado resuelve a la persona sin editar el XLSX ni duplicar horas", before - after === 1 && (await n(ctx, 'SELECT count(*) n FROM "ZdTimeEntry"')) === 8, `${before}→${after}`);

    // Revertir el lote de la corrección: solo su aportación.
    await page.goto(`${B}/${xb}`);
    await page.getByRole("button", { name: "Revertir" }).click();
    const revertedB = await waitStatus(page, "Revertido");
    const back90 = await n(ctx, `SELECT count(*) n FROM "ZdTimeEntry" WHERE "sourceId" = '88' AND minutes = 90`);
    const totalB = await n(ctx, 'SELECT count(*) n FROM "ZdTimeEntry"');
    ctx.check("Zendesk tiempos: Revertir el lote que corrigió restituye el registro anterior (1,5 h) sin borrar datos de otros lotes", revertedB && back90 === 1 && totalB === 8, `estado=${revertedB} 90min=${back90} total=${totalB}`);
    await page.goto(`${B}/${xc}`);
    await page.getByRole("button", { name: "Revertir" }).click();
    ctx.check("Zendesk tiempos: Revertir un lote retira solo sus registros (6 quedan de otros lotes)", (await waitStatus(page, "Revertido")) && (await n(ctx, 'SELECT count(*) n FROM "ZdTimeEntry"')) === 6);

    // Errores en tiempos y cancelación.
    await writeTimes(file("tiempos-err.xlsx"), [timeRow({ logged_minutes: -5 }), timeRow({ ticket_id: "2", date: "no-es-fecha" })]);
    await upload("Zendesk · tiempos", file("tiempos-err.xlsx"));
    await waitStatus(page, "Listo para revisar");
    ctx.check("Zendesk tiempos: duraciones negativas o fechas ilegibles bloquean la confirmación y no activan nada", (await page.getByRole("button", { name: "Confirmar y activar" }).isDisabled()) && /DURACION_ILEGIBLE/.test(await body(page)) && (await n(ctx, 'SELECT count(*) n FROM "ZdTimeEntry"')) === 6);
    await page.getByRole("button", { name: "Cancelar" }).click();
    ctx.check("Zendesk tiempos: Cancelar antes de activar descarta el lote sin efectos", (await waitStatus(page, "Cancelado")) && (await n(ctx, 'SELECT count(*) n FROM "ZdTimeEntry"')) === 6);

    // ============================================================ Consulta y repetición
    await writeTickets(file("tickets-a2.xlsx"), ticketsA);
    await upload("Zendesk · tickets", file("tickets-a2.xlsx"), "2026-01-10");
    await waitStatus(page, "Listo para revisar");
    await page.getByRole("button", { name: "Confirmar y activar" }).click();
    await waitStatus(page, "Completado");
    ctx.check("Zendesk: repetir el mismo archivo de tickets no duplica entidades ni revisiones", (await n(ctx, 'SELECT count(*) n FROM "ZdTicket"')) === 9 && (await n(ctx, 'SELECT count(*) n FROM "ZdTicketRevision"')) === 10);

    await writeTimes(file("tiempos-a2.xlsx"), timesA);
    await upload("Zendesk · tiempos", file("tiempos-a2.xlsx"), "2026-02-12");
    await waitStatus(page, "Listo para revisar");
    await page.getByRole("button", { name: "Confirmar y activar" }).click();
    await waitStatus(page, "Completado");
    ctx.check("Zendesk: repetir el mismo archivo de tiempos no duplica registros ni horas", (await n(ctx, 'SELECT count(*) n FROM "ZdTimeEntry"')) === 6);

    const row = await ctx.prisma.uploadBatch.findFirstOrThrow({ where: { id: xa } });
    await reader.page.goto(`${B}/${row.id}`);
    ctx.check("Zendesk: Consulta no llega a la ficha del lote", !reader.page.url().includes(`/cargas/${row.id}`));
    const st = await reader.context.request.get(`${ctx.base}/api/cargas/${row.id}/estado`);
    const dl = await reader.context.request.get(`${ctx.base}/api/cargas/${row.id}/archivo`);
    ctx.check("Zendesk: Consulta no lee el estado ni descarga el archivo (403) y los datos no cambian", st.status() === 403 && dl.status() === 403 && (await n(ctx, 'SELECT count(*) n FROM "ZdTimeEntry"')) === 6);
    const anon = await ctx.browser.newContext();
    const a1 = await anon.request.get(`${ctx.base}/api/cargas/${row.id}/archivo`);
    ctx.check("Zendesk: sin sesión tampoco se descarga el archivo (401)", a1.status() === 401);
    await anon.close();
    await reader.context.close();
    await context.close();
  } finally {
    await ctx.stopWorker();
    await rm(dir, { recursive: true, force: true });
  }
}
