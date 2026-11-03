import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { SERVICE_EVIDENCE_SQL, SERVICE_OF_SQL, SERVICE_RULES_VERSION, runEconomics } from "@/server/economics/engine";
import { resetDatabase, makeUsers } from "./helpers";
import { addClient, addGroup, addTicket, addWrike, addZd, fakeBatch, seedFinance, serviceAssignment } from "./economia-helpers";

/**
 * HOTFIX-02 §5: la ausencia de configuración manual no puede vaciar el soporte ordinario. Casos 7 de §12 sin ninguna `ServiceAssignment`, salvo donde la
 * prueba comprueba que una asignación EXPLÍCITA se conserva. Los esperados son los valores de la tabla del contrato, escritos a mano.
 */
let admin: { id: string };
let bid: string;
beforeEach(async () => {
  await resetDatabase();
  ({ admin } = await makeUsers());
  bid = (await fakeBatch(admin.id)).id;
});

type Out = { source: string; svc: string; origins: string | null; minutes: string };
async function services(): Promise<Out[]> {
  return prisma.$queryRaw<Out[]>(Prisma.sql`
    WITH a0 AS (SELECT * FROM "TimeActivity")
    SELECT a.source, ${SERVICE_OF_SQL} AS svc, (SELECT string_agg(ev.origin, ',' ORDER BY ev.origin) FROM (${SERVICE_EVIDENCE_SQL}) ev) AS origins, a.minutes::text AS minutes
    FROM a0 a ORDER BY a."workDate", a.minutes`);
}
const by = (rows: Out[], minutes: string) => rows.find((r) => r.minutes === minutes)!;

describe("clasificación del servicio sin ServiceAssignment manual (regla servicio-v2)", () => {
  it("versiona la regla", () => {
    expect(SERVICE_RULES_VERSION).toBe("servicio-v2");
  });

  it("ticket con Entorno y Tipología ordinario → SOPORTE; Administración Delegada → ADMIN_DELEGADA; sin Entorno informado → SIN_CLASIFICAR (no se inventa soporte)", async () => {
    const g = await addGroup("G");
    await addTicket(bid, { ticketId: "ord", entorno: "Producción · Facturación", adminDelegada: false });
    await addTicket(bid, { ticketId: "del", entorno: "Administración Delegada · Backoffice", adminDelegada: true });
    await addTicket(bid, { ticketId: "sin", entorno: null });
    await addTicket(bid, { ticketId: "blanco", entorno: "   ", adminDelegada: false });
    for (const [t, m] of [["ord", 60], ["del", 120], ["sin", 30], ["blanco", 15]] as const) await addZd({ batchId: bid, date: "2026-03-10", minutes: m, groupId: g.id, ticketId: t });
    const rows = await services();
    expect([by(rows, "60").svc, by(rows, "60").origins]).toEqual(["SOPORTE", "ENTORNO_ORDINARIO"]);
    expect([by(rows, "120").svc, by(rows, "120").origins]).toEqual(["ADMIN_DELEGADA", "TICKET_ADMIN_DELEGADA"]);
    expect(by(rows, "30").svc).toBe("SIN_CLASIFICAR");
    expect(by(rows, "15").svc).toBe("SIN_CLASIFICAR");
  });

  it("una asignación explícita se conserva (OTROS no se sobrescribe por el relleno) y un conflicto real sigue siendo conflicto", async () => {
    const g = await addGroup("G");
    await serviceAssignment({ matchKind: "ENTORNO", matchValue: "Proyecto especial", service: "OTROS" });
    await serviceAssignment({ matchKind: "ENTORNO", matchValue: "Delegada mal catalogada", service: "SOPORTE" });
    await addTicket(bid, { ticketId: "esp", entorno: "Proyecto especial", adminDelegada: false });
    await addTicket(bid, { ticketId: "conf", entorno: "Delegada mal catalogada", adminDelegada: true });
    await addZd({ batchId: bid, date: "2026-03-10", minutes: 45, groupId: g.id, ticketId: "esp" });
    await addZd({ batchId: bid, date: "2026-03-11", minutes: 90, groupId: g.id, ticketId: "conf" });
    const rows = await services();
    expect([by(rows, "45").svc, by(rows, "45").origins]).toEqual(["OTROS", "ENTORNO"]);
    expect(by(rows, "90").svc).toBe("CONFLICTO");
  });

  it("Wrike de mantenimiento con proyecto reconocido y persona PMO elegible → SOPORTE con su procedencia, también sin ticket; sin evidencia o sin elegibilidad no se clasifica", async () => {
    const g = await addGroup("G");
    const c = await addClient("C", g.id);
    await addWrike({ batchId: bid, date: "2026-02-10", minutes: 60, groupId: g.id, project: "PROY", bucket: "GROUP_ONLY" }); // solo Grupo, sin ticket
    await addWrike({ batchId: bid, date: "2026-02-11", minutes: 120, groupId: g.id, clientId: c.id, project: "PROY", bucket: "CLIENT" });
    await addWrike({ batchId: bid, date: "2026-02-12", minutes: 30, project: "DESCONOCIDO", bucket: "NO_SCOPE" }); // proyecto no reconocido
    await addWrike({ batchId: bid, date: "2026-02-13", minutes: 15, groupId: g.id, project: "PROY", bucket: "GROUP_ONLY", eligibility: "NOT_PMO" }); // persona no PMO
    await addWrike({ batchId: bid, date: "2024-12-20", minutes: 10, groupId: g.id, project: "PROY", bucket: "BEFORE_CUTOFF", eligibility: "BEFORE_CUTOFF" }); // antes del corte: Zendesk
    const rows = await services();
    expect([by(rows, "60").svc, by(rows, "60").origins]).toEqual(["SOPORTE", "WRIKE_MANTENIMIENTO_N3"]);
    expect(by(rows, "120").svc).toBe("SOPORTE");
    expect(by(rows, "30").svc).toBe("SIN_CLASIFICAR");
    expect(by(rows, "15").svc).toBe("SIN_CLASIFICAR");
    expect(by(rows, "10").svc).toBe("SIN_CLASIFICAR");
  });

  it("Wrike con proyecto asignado explícitamente a OTROS o con ticket de Administración Delegada conserva ese servicio (el relleno no aplica)", async () => {
    const g = await addGroup("G");
    await serviceAssignment({ matchKind: "WRIKE_PROJECT", matchValue: "PROYECTO OTROS", service: "OTROS" });
    await addTicket(bid, { ticketId: "deleg", entorno: "Delegada", adminDelegada: true });
    await addWrike({ batchId: bid, date: "2026-02-10", minutes: 50, groupId: g.id, project: "Proyecto Otros", bucket: "GROUP_ONLY" });
    await addWrike({ batchId: bid, date: "2026-02-11", minutes: 70, groupId: g.id, project: "PROY", bucket: "GROUP_ONLY", ticketId: "deleg" });
    const rows = await services();
    expect([by(rows, "50").svc, by(rows, "50").origins]).toEqual(["OTROS", "WRIKE_PROJECT"]);
    expect(by(rows, "70").svc).toBe("ADMIN_DELEGADA");
  });

  it("el motor económico suma las horas de soporte ordinario SIN catalogar entornos, y separa la Administración Delegada y lo no clasificado", async () => {
    const g = await addGroup("G");
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "12000" }]);
    await addTicket(bid, { ticketId: "ord", entorno: "Producción · Soporte", adminDelegada: false });
    await addTicket(bid, { ticketId: "del", entorno: "Admin Delegada", adminDelegada: true });
    await addTicket(bid, { ticketId: "sin", entorno: null });
    await addZd({ batchId: bid, date: "2026-06-02", minutes: 120, groupId: g.id, ticketId: "ord" });
    await addZd({ batchId: bid, date: "2026-06-03", minutes: 60, groupId: g.id, ticketId: "del" });
    await addZd({ batchId: bid, date: "2026-06-04", minutes: 30, groupId: g.id, ticketId: "sin" });
    const r = await runEconomics(admin.id, { scope: { type: "groups", ids: [g.id] }, service: "TOTAL", date: "2026-06-15", now: new Date("2026-10-30T10:00:00Z") });
    const h = r.entities[0].periods.cum.hours.byService;
    expect(h).toMatchObject({ SOPORTE: "2", ADMIN_DELEGADA: "1", SIN_CLASIFICAR: "0.5", OTROS: "0", CONFLICTO: "0" });
  });
});
