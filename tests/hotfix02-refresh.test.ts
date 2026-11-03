import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AccessError } from "@/lib/access";
import { LostLeaseError } from "@/server/uploads/queue";
import { claimRefresh, readRefreshStatus, releaseRefresh, requestRepair, runRefresh, runRefreshOnce } from "@/server/relations/refresh";
import { drain, freshEnvironment, removeUploadDir, useUploadDir } from "./cargas-helpers";
import { addClient, addGroup, addOrgEquivalence, importZd, TICKETS, TIEMPO } from "./zendesk-helpers";
import { ticket, ticketsBuffer, timeRow, timesBuffer, excelSerial } from "./generators/zendesk";
import { addTicket, fakeBatch, addZd } from "./economia-helpers";
import { ZD_TIMES, TICKET_ROWS, loadOperationalFirst, loadMaster, singleSheetBook, zdOut, sumMinutes } from "./hotfix02-helpers";

/**
 * Estado, generación, coalescencia, fencing y recuperación de la actualización automática de relaciones (HOTFIX-02 §4, casos 9 y 10 de §12).
 */
let dir: string;
let admin: { id: string };
let reader: { id: string };
beforeAll(() => { dir = useUploadDir(); });
afterAll(() => removeUploadDir(dir));
beforeEach(async () => { ({ admin, reader } = await freshEnvironment()); });

const versions = async () => ({
  zd: Number((await prisma.zdTimeEntry.aggregate({ _sum: { drvVersion: true } }))._sum.drvVersion ?? 0),
  wr: Number((await prisma.wrikeTimeEntry.aggregate({ _sum: { drvVersion: true } }))._sum.drvVersion ?? 0),
  pap: Number((await prisma.papItem.aggregate({ _sum: { drvVersion: true } }))._sum.drvVersion ?? 0),
});

describe("estado verificable y generación", () => {
  it("un cambio de maestros solicita una generación; hasta publicarla el estado NO es «al día»; el trabajador la publica y deja el informe de conciliación", async () => {
    expect((await readRefreshStatus()).state).toBe("UP_TO_DATE"); // instalación vacía: nada solicitado
    const g = await addGroup("Grupo A");
    await addClient({ name: "Cliente A", orgId: "810001", groupId: g.id });
    const pending = await readRefreshStatus();
    expect(pending.state).toBe("PENDING");
    expect(pending.requestedGeneration).toBeGreaterThan(pending.completedGeneration);
    expect(pending.reason).toBe("ExternalIdentity");
    await drain();
    const done = await readRefreshStatus();
    expect(done.state).toBe("UP_TO_DATE");
    expect(done.completedGeneration).toBe(pending.requestedGeneration + 0);
    expect(done.lastReport?.totals).toMatchObject({ zendeskRows: 0, wrikeRows: 0, papItems: 0, tickets: 0 });
    expect(done.progress).toBeNull();
    expect(done.attempts).toBe(0);
  });

  it("muchos cambios próximos se coalescen y una ejecución nueva no hace nada si no hay nada pendiente (idempotente, sin versiones nuevas)", async () => {
    await loadOperationalFirst(admin.id);
    await loadMaster(admin.id, await singleSheetBook());
    await drain();
    const before = await versions();
    const status = await readRefreshStatus();
    // Otra ronda sin cambios de maestros: nada que ejecutar.
    expect(await runRefreshOnce("w-test")).toBe(false);
    // La acción de recuperación fuerza una generación y recalcula: nada cambia (cantidades ni versiones derivadas).
    const rep = await requestRepair(admin.id);
    expect(rep.generation).toBe(status.requestedGeneration + 1);
    await drain();
    expect(await versions()).toEqual(before);
    const after = await readRefreshStatus();
    expect(after.state).toBe("UP_TO_DATE");
    expect(after.lastReport?.updated).toEqual({ zendesk: 0, wrike: 0, pap: 0, vinculos: 0, finanzas: 0 });
  });

  it("solo Administrador pide la recuperación; pedirla dos veces seguidas no duplica trabajo", async () => {
    await expect(requestRepair(reader.id)).rejects.toBeInstanceOf(AccessError);
    const a = await requestRepair(admin.id);
    expect(a.alreadyPending).toBe(false);
    const b = await requestRepair(admin.id);
    expect(b.alreadyPending).toBe(true);
    await drain();
    expect((await readRefreshStatus()).state).toBe("UP_TO_DATE");
  });
});

describe("cambio durante el recálculo, dos trabajadores y recuperación (caso 9)", () => {
  it("un cambio que llega mientras se recalcula NO se pierde: la tarea publica solo hasta SU generación y se vuelve a ejecutar; el resultado final usa el maestro último", async () => {
    await importZd(admin.id, TICKETS, await ticketsBuffer([ticket({ ticket_id: "5001", organization_id: "820001" })]));
    await importZd(admin.id, TIEMPO, await timesBuffer([timeRow({ ticket_id: "5001", logged_hours: 1, logged_minutes: 0 })]));
    const g1 = await addGroup("Grupo Uno");
    await addClient({ name: "Cliente Uno", orgId: "820001", groupId: g1.id });
    const c = await claimRefresh("worker-a");
    expect(c).not.toBeNull();
    // Mientras «worker-a» tiene la generación, el administrador corrige el maestro (otro Grupo para la misma organización).
    const g2 = await addGroup("Grupo Dos");
    const cl = await prisma.client.findFirstOrThrow({ where: { name: "Cliente Uno" } });
    await prisma.client.update({ where: { id: cl.id }, data: { groupId: g2.id } });
    await runRefresh(c!);
    const mid = await readRefreshStatus();
    expect(mid.completedGeneration).toBe(c!.generation); // publicó solo hasta SU generación…
    expect(mid.requestedGeneration).toBeGreaterThan(c!.generation);
    expect(mid.state).toBe("PENDING"); // …y NO se declara «al día»
    await drain();
    expect((await readRefreshStatus()).state).toBe("UP_TO_DATE");
    expect((await zdOut())[0].group).toBe("Grupo Dos");
  });

  it("dos trabajadores a la vez: solo uno reclama; un lease vencido lo recupera otro y el trabajador antiguo ya no puede publicar (fencing)", async () => {
    await addGroup("G");
    const [x, y] = await Promise.all([claimRefresh("w-1"), claimRefresh("w-2")]);
    expect([x, y].filter(Boolean)).toHaveLength(1);
    const first = (x ?? y)!;
    // El primero deja de responder: su lease vence y otro trabajador reclama (intento 2).
    await prisma.$executeRaw`UPDATE "RelationRefresh" SET "leaseExpiresAt" = now() - interval '1 minute'`;
    const second = await claimRefresh("w-3");
    expect(second?.attempts).toBe(2);
    expect(second?.fence).toBe(first.fence + 1);
    await expect(runRefresh(first)).rejects.toBeInstanceOf(LostLeaseError); // el antiguo no publica nada
    expect((await readRefreshStatus()).state).toBe("RUNNING");
    await runRefresh(second!);
    expect((await readRefreshStatus()).state).toBe("UP_TO_DATE");
  });

  it("un trabajador que se detiene a mitad (SIGKILL representativo: la transacción se aborta) no deja una atribución a medias; el reintento la completa sin doble suma", async () => {
    await loadOperationalFirst(admin.id);
    await loadMaster(admin.id, await singleSheetBook());
    // Se deshace el efecto para recalcular desde cero: se anulan las atribuciones derivadas de tiempos Zendesk y Wrike.
    await prisma.$executeRaw`UPDATE "ZdTimeEntry" SET "drvClientId" = NULL, "drvGroupId" = NULL, "drvBucket" = 'NO_CLIENT'`;
    await prisma.$executeRaw`UPDATE "WrikeTimeEntry" SET "drvGroupId" = NULL, "drvClientId" = NULL, "drvBucket" = 'NO_SCOPE', "drvScopeMethod" = NULL`;
    await requestRepair(admin.id);
    const zdMin = await sumMinutes("ZdTimeEntry");
    const wrMin = await sumMinutes("WrikeTimeEntry");
    const before = await versions();
    const c = await claimRefresh("w-kill");
    // «Muere» al empezar la tercera fase: las dos primeras (Zendesk y Wrike) ya habían escrito dentro de la transacción y deben deshacerse.
    let calls = 0;
    const err = await runRefresh(c!, () => ++calls > 2).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(await versions()).toEqual(before); // todo o nada: ni una fila derivada a medias
    await releaseRefresh(c!);
    expect((await readRefreshStatus()).state).toBe("PENDING");
    await drain();
    expect((await readRefreshStatus()).state).toBe("UP_TO_DATE");
    expect(await sumMinutes("ZdTimeEntry")).toBe(zdMin);
    expect(await sumMinutes("WrikeTimeEntry")).toBe(wrMin);
    expect((await zdOut()).filter((r) => r.group === "GRP ALFA")).toHaveLength(2); // 3001 y 3005
  });
});

describe("cobertura de todo el conjunto activo (caso 10)", () => {
  it("más de 100 lotes históricos activos: todos los afectados se atienden y las cantidades concilian antes y después", async () => {
    const g = await addGroup("G");
    const batches: string[] = [];
    for (let i = 0; i < 120; i++) batches.push((await fakeBatch(admin.id)).id);
    const cl = await addClient({ name: "C", groupId: g.id }); // el Cliente existe SIN equivalencia de organización todavía
    for (let i = 0; i < 120; i++) {
      await addTicket(batches[i], { ticketId: `t${i}`, org: "830001", entorno: "Producción" });
      await addZd({ batchId: batches[i], date: "2026-03-10", minutes: 30, ticketId: `t${i}`, bucket: "NO_CLIENT" });
    }
    await drain();
    const minutes = await sumMinutes("ZdTimeEntry");
    expect(minutes).toBe(120 * 30);
    await addOrgEquivalence(cl.id, "830001"); // al llegar la dependencia, los 120 lotes se resuelven
    await drain();
    const attributed = await prisma.zdTimeEntry.count({ where: { drvClientId: cl.id } });
    expect(attributed).toBe(120);
    expect(await sumMinutes("ZdTimeEntry")).toBe(minutes);
    const st = await readRefreshStatus();
    expect(st.lastReport?.totals.zendeskRows).toBe(120);
  });

  it("no reactiva instantáneas sustituidas: el conjunto activo no cambia al recalcular, aunque las entradas antiguas también se recalculan", async () => {
    await importZd(admin.id, TICKETS, await ticketsBuffer(TICKET_ROWS));
    await importZd(admin.id, TIEMPO, await timesBuffer(ZD_TIMES.slice(0, 2))); // primera instantánea
    await importZd(admin.id, TIEMPO, await timesBuffer(ZD_TIMES.slice(2, 4))); // la sustituye (export completo)
    const active = async () => (await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "ActiveZdTimeEntry"`))[0].n;
    const before = await active();
    expect(before).toBe(2n);
    await loadMaster(admin.id, await singleSheetBook());
    await drain();
    expect(await active()).toBe(before);
    const total = (await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "ZdTimeEntry"`))[0].n;
    expect(total).toBe(4n); // las sustituidas se conservan como evidencia, sin reactivarse
    void excelSerial;
  });
});
