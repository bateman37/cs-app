import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { parseQualityQuery } from "@/domain/quality-query";
import { uncalibratedQualityConfig as defaultQualityConfig } from "@/domain/quality-config";
import { activateDraft, saveDraft } from "@/server/pulse/config";
import { computeQuality } from "@/server/quality/engine";
import { evolutionIn } from "@/server/quality/detail";
import { readSnapshot } from "@/server/analytics/snapshot";
import { resetDatabase, makeUsers, useUncalibratedQuality } from "./helpers";
import { addClient, addGroup, setUsers } from "./economia-helpers";
import { batchOf, declare, seedTicket } from "./calidad-helpers";

/**
 * CSAPP-09 §3: la evolución recalcula CADA mes con su cohorte, usuarios, cobertura y referencias por percentiles (nunca umbrales del último mes).
 * Expectativas calculadas a mano: seis grupos con 100 usuarios; N3 por 100 usuarios·mes de un mes completo = nº de tickets.
 * Enero: G_i tiene i-1 tickets N3 → valores 0..5; P25 inclusivo (n-1)q = 1,25 y P75 = 3,75 (n = 6).
 * Octubre: solo G1 tiene 5 tickets (valores 5,0,0,0,0,0 → P25 = P75 = 0). G3 vale 2 en enero (amarillo) y 0 en octubre (verde).
 */
const NOW = new Date("2026-11-02T09:00:00Z");
const Q = (extra: Record<string, string> = {}) => parseQualityQuery({ fecha: "2026-10-31", modo: "FULL_MONTH", ...extra }, NOW).query;
let admin: { id: string };
beforeEach(async () => {
  await resetDatabase();
  ({ admin } = await makeUsers());
  await useUncalibratedQuality(admin.id);
});

describe("evolución de Calidad por cohorte propia de cada mes", () => {
  it("el color de enero coincide con evaluar enero aisladamente y no con la referencia de octubre; sin muestra mínima: magnitud y motivo", async () => {
    const tb = await batchOf(admin.id, "zendesk-tickets", "2026-10-31");
    const groups = [];
    for (let i = 1; i <= 6; i++) {
      const g = await addGroup(`G${i}`);
      const c = await addClient(`C${i}`, g.id);
      await prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: `71${i}`, searchValue: `71${i}`, clientId: c.id } });
      await setUsers(admin.id, { groupId: g.id }, 2026, Array(12).fill(100));
      for (let n = 0; n < i - 1; n++) await seedTicket(tb.id, { id: `J${i}-${n}`, org: `71${i}`, type: "question", created: "2026-01-12", destinations: ["PMO_N3"], observedOn: "2026-10-31" });
      if (i === 1) for (let n = 0; n < 5; n++) await seedTicket(tb.id, { id: `O${i}-${n}`, org: `71${i}`, type: "question", created: "2026-10-12", destinations: ["PMO_N3"], observedOn: "2026-10-31" });
      groups.push(g);
    }
    await declare(admin.id, tb.id, { statusScope: "ALL_STATUSES", from: "2026-01-01" });
    const cfg = defaultQualityConfig();
    cfg.indicators.N3_ESCALATIONS.rules.GRUPO = { ...cfg.indicators.N3_ESCALATIONS.rules.GRUPO, method: "PERCENTILE", a: "25", b: "75", referenceId: "todos", minSample: 5, calibration: "CALIBRADO" };
    const d = await saveDraft(admin.id, "QUALITY", cfg, { expectedVersion: null });
    await activateDraft(admin.id, "QUALITY", { expectedRevisionNo: 1, expectedDraftVersion: d.version, reason: "percentiles" });
    const g3 = groups[2];

    const ev = await readSnapshot(admin.id, (tx) => evolutionIn(tx, Q({ sel: g3.id }), g3.id, cfg, "2026-11-02"));
    const jan = ev.points[0].indicators.N3_ESCALATIONS;
    const oct = ev.points[9].indicators.N3_ESCALATIONS;
    expect(jan).toMatchObject({ value: "0.02", color: "yellow", sampleN: 6, numerator: "2" }); // 2 / 100 usuarios·mes
    expect(Number(jan.cuts?.a)).toBeCloseTo(0.0125, 10);
    expect(Number(jan.cuts?.b)).toBeCloseTo(0.0375, 10);
    expect(oct).toMatchObject({ value: "0", color: "green", sampleN: 6 });
    expect(Number(oct.cuts?.a)).toBe(0);
    expect(Number(oct.cuts?.b)).toBe(0);
    // Evaluar enero aisladamente da el mismo resultado que el punto de enero de la serie.
    const isolated = await readSnapshot(admin.id, (tx) => computeQuality(tx, Q({ fecha: "2026-01-31", sel: g3.id }), { now: NOW }));
    const iso = isolated.rows.find((r) => r.id === g3.id)!.evaluation.indicators.N3_ESCALATIONS;
    expect({ value: iso.value, color: iso.color, cuts: iso.cuts, n: iso.n }).toEqual({ value: jan.value, color: jan.color, cuts: jan.cuts, n: jan.sampleN });
    // La serie es única en su revisión y declara su política; todos los puntos con la misma.
    expect(ev.series).toMatchObject({ basis: "RECALCULADA_CON_REVISION_ACTIVA", qualityRevision: 2 });
    // Seis indicadores en cada punto, con global solo si es calculable (aquí no: pesos sin calibrar → sin global).
    expect(Object.keys(ev.points[0].indicators)).toHaveLength(6);
    expect(ev.points[0].global.color).toBeNull();
    // Un cambio retroactivo de datos cambia la referencia de la serie.
    await seedTicket(tb.id, { id: "LATE", org: "713", type: "question", created: "2026-01-20", destinations: ["PMO_N3"], observedOn: "2026-10-31" });
    const ev2 = await readSnapshot(admin.id, (tx) => evolutionIn(tx, Q({ sel: g3.id }), g3.id, cfg, "2026-11-02"));
    expect(ev2.series.reference).not.toBe(ev.series.reference);
  });
});
