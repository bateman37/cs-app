import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { parseQualityQuery } from "@/domain/quality-query";
import { uncalibratedQualityConfig as defaultQualityConfig, type QualityConfig } from "@/domain/quality-config";
import { activateDraft, saveDraft } from "@/server/pulse/config";
import { computeQuality } from "@/server/quality/engine";
import { readSnapshot } from "@/server/analytics/snapshot";
import { runEconomics } from "@/server/economics/engine";
import { resetDatabase, makeUsers, useUncalibratedQuality } from "./helpers";
import { addClient, addGroup, addTicket, addZd, fakeBatch, seedFinance, serviceAssignment, setUsers } from "./economia-helpers";
import { batchOf, declare, seedTicket } from "./calidad-helpers";

/**
 * CSAPP-09 §5: casos de aceptación con expectativas CALCULADAS A MANO (no copiadas de otra API). Complementan los de 05–08 (665/68, percentiles inclusivos,
 * pesos 20 %, sexto indicador, N3 doble, ceros y cobertura), que siguen en sus archivos. «Hoy» = 02/11/2026 (Europe/Madrid).
 */
const NOW = new Date("2026-11-02T09:00:00Z");
let admin: { id: string };
beforeEach(async () => {
  await resetDatabase();
  ({ admin } = await makeUsers());
  await useUncalibratedQuality(admin.id);
});
const Q = (extra: Record<string, string> = {}) => parseQualityQuery({ fecha: "2026-10-31", modo: "FULL_MONTH", ...extra }, NOW).query;
const quality = (extra: Record<string, string>, cfg?: QualityConfig) => readSnapshot(admin.id, (tx) => computeQuality(tx, Q(extra), { now: NOW, configOverride: cfg ?? null }));

describe("ingreso imputado y jornada (casos 1 y 2)", () => {
  it("soporte anual 12 000 €, mes de 30 días, corte día 15: ingreso 500 €; con 8 h elegibles, 500 €/jornada de 8 h; el objetivo 550 se lee de configuración; usuarios de junio: 34 (no 68)", async () => {
    const g = await addGroup("Atlas");
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "12000" }]);
    await setUsers(admin.id, { groupId: g.id }, 2026, [65, 65, 65, 65, 65, 68, 68, 68, 68, 68, 68, 68]);
    const t = await fakeBatch(admin.id);
    await serviceAssignment({ matchKind: "ENTORNO", matchValue: "entorno soporte", service: "SOPORTE" });
    await addTicket(t.id, { ticketId: "S", entorno: "Entorno Soporte" });
    await addZd({ batchId: t.id, date: "2026-06-10", minutes: 480, groupId: g.id, ticketId: "S" }); // 8 h
    const r = await runEconomics(admin.id, { scope: { type: "groups", ids: [g.id] }, service: "SOPORTE", date: "2026-06-15", mode: "CUTOFF", now: NOW });
    const m = r.entities[0].periods.month;
    expect(m.revenue.value).toBe("500");
    expect(m.perDay.value).toBe("500"); // 500 € ÷ (480 min ÷ 480 min/jornada)
    expect(r.settings.targetEurosPerDay).toBe("550"); // objetivo inicial de configuración, no escrito en el cálculo
    expect(m.users.userMonths).toBe("34"); // 68 × 15/30
    expect(m.users.stock.value).toBe(68);
  });
});

describe("backlog y flujo de Calidad (casos 4, 7 y 10)", () => {
  async function setup(policy?: QualityConfig["snapshotPolicy"]) {
    const g = await addGroup("Atlas");
    const c = await addClient("Atlas 1", g.id);
    await prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: "701", searchValue: "701", clientId: c.id } });
    await setUsers(admin.id, { groupId: g.id }, 2026, Array(12).fill(10)); // 10 usuarios al corte
    const cfg: QualityConfig = { ...defaultQualityConfig(), snapshotPolicy: policy ?? defaultQualityConfig().snapshotPolicy, incidents: { ...defaultQualityConfig().incidents, concerningDays: { incident: 30, problem: 60 } } };
    const d = await saveDraft(admin.id, "QUALITY", cfg, { expectedVersion: null });
    await activateDraft(admin.id, "QUALITY", { expectedRevisionNo: 1, expectedDraftVersion: d.version, reason: "aceptación" });
    return { g, c, cfg };
  }
  it("dos envejecidos y 10 usuarios al corte → 20 por 100 usuarios; un ticket antiguo abierto, sin horas ni altas en el mes, está en el stock observado y NO en el flujo de altas", async () => {
    const { g } = await setup();
    const photo = await batchOf(admin.id, "zendesk-tickets", "2026-10-31");
    await declare(admin.id, photo.id, { statusScope: "UNRESOLVED_ONLY", from: "2026-01-01" });
    // dos incidentes envejecidos (> 30 d) abiertos y uno reciente; todos creados antes de octubre salvo el reciente
    await seedTicket(photo.id, { id: "A1", org: "701", type: "incident", status: "open", created: "2026-05-01", observedOn: "2026-10-31" });
    await seedTicket(photo.id, { id: "A2", org: "701", type: "incident", status: "pending", created: "2025-12-10", observedOn: "2026-10-31" });
    await seedTicket(photo.id, { id: "A3", org: "701", type: "incident", status: "open", created: "2026-10-25", observedOn: "2026-10-31" });
    const v = await quality({ sel: g.id });
    const row = v.rows.find((r) => r.id === g.id)!;
    const e = row.explain.INCIDENTS_PROBLEMS;
    expect(e.breakdown["stock incidentes activos"]).toBe("3");
    expect(e.breakdown["stock incidentes envejecidos"]).toBe("2");
    expect(row.evaluation.indicators.INCIDENTS_PROBLEMS.components?.find((c) => c.id === "backlog_incident")?.value).toBe("20"); // 2 × 100 ÷ 10
    expect(e.breakdown.incidentes).toBe("1"); // flujo de octubre: solo A3 (los antiguos no son altas del mes)
    expect(v.backlog).toMatchObject({ exact: true, observedOn: "2026-10-31" });
  });
  it("foto del día 10 y corte día 30, política EXACT: NO es stock exacto del día 30 (se informa aparte); con «última anterior» elegida solo se usa dentro del máximo y como provisional", async () => {
    const { g } = await setup();
    const photo = await batchOf(admin.id, "zendesk-tickets", "2026-10-10");
    await declare(admin.id, photo.id, { statusScope: "UNRESOLVED_ONLY", from: "2026-01-01", to: "2026-10-10" });
    await seedTicket(photo.id, { id: "B1", org: "701", type: "incident", status: "open", created: "2026-05-01", observedOn: "2026-10-10" });
    const exact = await quality({ fecha: "2026-10-30", modo: "CUTOFF", sel: g.id });
    expect(exact.backlog).toMatchObject({ exact: false, provisional: false, observedOn: null });
    expect(exact.backlog.earlierInfo).toMatchObject({ observedOn: "2026-10-10", gapDays: 20 }); // existe, pero se muestra aparte
    const within = await quality({ fecha: "2026-10-30", modo: "CUTOFF", sel: g.id }, { ...defaultQualityConfig(), snapshotPolicy: { mode: "LATEST_BEFORE", maxDays: 20 }, incidents: { ...defaultQualityConfig().incidents, concerningDays: { incident: 30, problem: 60 } } });
    expect(within.backlog).toMatchObject({ exact: false, provisional: true, observedOn: "2026-10-10" }); // 20 d ≤ 20 d: dentro del máximo
    const beyond = await quality({ fecha: "2026-10-30", modo: "CUTOFF", sel: g.id }, { ...defaultQualityConfig(), snapshotPolicy: { mode: "LATEST_BEFORE", maxDays: 19 } });
    expect(beyond.backlog.observedOn).toBeNull(); // 20 d > 19 d: fuera del máximo
  });
});

describe("fronteras temporales (año/mes, bisiesto, día de corte, Europe/Madrid, posteriores al corte)", () => {
  it("el día de corte se incluye, el siguiente no; 29/02/2028 existe y el comparable de 2027 no usa un día imposible; un ticket creado a las 23:30 UTC del 31/10 es del 1/11 en Madrid solo si su fecha de negocio lo dice", async () => {
    const g = await addGroup("Atlas");
    const c = await addClient("Atlas 1", g.id);
    await prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: "701", searchValue: "701", clientId: c.id } });
    await setUsers(admin.id, { groupId: g.id }, 2026, Array(12).fill(100));
    const tb = await batchOf(admin.id, "zendesk-tickets", "2026-10-31");
    await declare(admin.id, tb.id, { statusScope: "ALL_STATUSES", from: "2026-01-01" });
    await seedTicket(tb.id, { id: "F1", org: "701", type: "incident", created: "2026-10-15", observedOn: "2026-10-31" }); // día de corte: entra
    await seedTicket(tb.id, { id: "F2", org: "701", type: "incident", created: "2026-10-16", observedOn: "2026-10-31" }); // posterior al corte: no entra por conveniencia
    const v = await quality({ fecha: "2026-10-15", modo: "CUTOFF", sel: g.id });
    expect(v.rows.find((r) => r.id === g.id)!.explain.INCIDENTS_PROBLEMS.breakdown.incidentes).toBe("1");
    const feb = await runEconomics(admin.id, { scope: { type: "groups", ids: [g.id] }, service: "SOPORTE", date: "2028-02-29", mode: "CUTOFF", now: NOW });
    expect(feb.input.cut).toBe("2028-02-29"); // año bisiesto
    const next = await runEconomics(admin.id, { scope: { type: "groups", ids: [g.id] }, service: "SOPORTE", date: "2027-02-28", mode: "FULL_MONTH", now: NOW });
    expect(next.input.cut).toBe("2027-02-28"); // 2027 no es bisiesto: no existe el 29
  });
});
