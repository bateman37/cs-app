import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { parseQualityQuery } from "@/domain/quality-query";
import { defaultQualityConfig, readQualityPayload, uncalibratedQualityConfig } from "@/domain/quality-config";
import { getQuality } from "@/server/quality/engine";
import { getActive } from "@/server/pulse/config";
import { installInitialQualityProfile } from "@/server/quality/initial-profile";
import { qualityCsv } from "@/server/quality/export";
import { resetDatabase, makeUsers } from "./helpers";
import { addClient, addGroup, setUsers } from "./economia-helpers";
import { batchOf, declareAllSources, seedPap } from "./calidad-helpers";

/**
 * HOTFIX-03 §10-§12: Calidad por usuario / total, referencia propia (P25/P75, muestra mínima 5) y perfil inicial, sobre PostgreSQL real con datos SINTÉTICOS.
 * «Hoy» 02/11/2026; mes de análisis: octubre de 2026 completo (31 días). Los esperados son aritmética a mano.
 */
let admin: { id: string };
const NOW = new Date("2026-11-02T09:00:00Z");
beforeEach(async () => {
  await resetDatabase();
  ({ admin } = await makeUsers());
});
const Q = (extra: Record<string, string> = {}) => parseQualityQuery({ fecha: "2026-10-31", modo: "FULL_MONTH", ...extra }, NOW).query;
const run = (extra: Record<string, string> = {}) => getQuality(admin.id, Q(extra), { now: NOW });

/** Seis Grupos con un Cliente cada uno; el Grupo i tiene i PAP correctivos en octubre. */
async function world(users: number | null = 10) {
  const out: { g: { id: string; name: string }; c: { id: string }; n: number }[] = [];
  const pb = await batchOf(admin.id, "pap");
  for (let i = 1; i <= 6; i++) {
    const g = await addGroup(`Grupo ${i}`);
    const c = await addClient(`Cliente ${i}`, g.id);
    await prisma.serviceTerm.create({ data: { attribute: "SUPPORT", value: i <= 3 ? "GOLD" : "PLATINUM", groupId: g.id } });
    if (users !== null) {
      await setUsers(admin.id, { groupId: g.id }, 2026, Array(12).fill(users));
      await setUsers(admin.id, { clientId: c.id }, 2026, Array(12).fill(users));
    }
    for (let k = 1; k <= i; k++) await seedPap(pb.id, { id: String(i * 100 + k), groupId: g.id, clientId: c.id, date: `2026-10-${String(k).padStart(2, "0")}`, state: "CORRECTIVE", causes: [{ category: "CORRECTIVE", origin: "STANDARD" }] });
    out.push({ g, c, n: i });
  }
  await declareAllSources(admin.id, "2026-01-01", "2026-10-31");
  return out;
}
/** Cambia los usuarios mensuales ya cargados de un Grupo (la matriz existe; se editan sus doce valores). */
const changeUsers = (groupId: string, value: number) => prisma.userMatrixMonth.updateMany({ where: { matrix: { groupId, year: 2026 } }, data: { value } });
const pap = (v: Awaited<ReturnType<typeof run>>, name: string) => v.rows.find((r) => r.name === name)!.evaluation.indicators.PAP_CORRECTIVE;

describe("Calidad: interruptor Por usuario / Total (§11)", () => {
  it("dos PAP con 10 usuarios en mes completo: Total 2, Por usuario 0,2; cambiar usuarios cambia Por usuario y no Total", async () => {
    const w = await world(10);
    const por = await run();
    const tot = await run({ medida: "total" });
    expect(pap(por, "Grupo 2").value).toBe("0.2");
    expect(pap(tot, "Grupo 2").value).toBe("2");
    expect(pap(por, "Grupo 2").unit).toBe("PER_USER_MONTH");
    expect(pap(tot, "Grupo 2").unit).toBe("TOTAL_COUNT");
    await changeUsers(w[1].g.id, 20);
    expect(pap(await run(), "Grupo 2").value).toBe("0.1");
    expect(pap(await run({ medida: "total" }), "Grupo 2").value).toBe("2");
  });

  it("Total no necesita matriz de usuarios (muestra y colorea datos válidos); Por usuario sin usuarios conserva el numerador y explica la división imposible", async () => {
    await world(null);
    const tot = await run({ medida: "total" });
    expect(pap(tot, "Grupo 3")).toMatchObject({ value: "3", status: "OK" });
    expect(pap(tot, "Grupo 3").color).not.toBeNull();
    const por = await run();
    const i = pap(por, "Grupo 3");
    expect(i.value).toBeNull(); // no divide entre uno ni inventa un cero
    expect(por.rows.find((r) => r.name === "Grupo 3")!.explain.PAP_CORRECTIVE.observed).toBe("3"); // el numerador sigue visible
    expect(i.reason).toMatch(/[Uu]suarios/);
  });

  it("referencia propia P25/P75 de la cohorte: [1..6] → P25 = 2,25 y P75 = 4,75 (verdes 1-2, amarillos 3-4, rojos 5-6); sin configurar Pulse; Soporte no mueve los cortes", async () => {
    await world(null);
    const cfg = (await getActive(prisma, "PULSE")).payload;
    expect(cfg.profiles).toEqual({}); // Pulse sin configurar
    const tot = await run({ medida: "total" });
    const color = (n: string) => pap(tot, n).color;
    expect([1, 2, 3, 4, 5, 6].map((n) => color(`Grupo ${n}`))).toEqual(["green", "green", "yellow", "yellow", "red", "red"]);
    expect(pap(tot, "Grupo 1").cuts).toMatchObject({ a: "2.25", b: "4.75" });
    expect(pap(tot, "Grupo 1").n).toBe(6);
    expect(tot.config.persisted).toBe(false);
    expect(JSON.stringify(tot.rows.map((r) => r.evaluation.indicators.PAP_CORRECTIVE.status))).not.toContain("SIN_CALIBRAR");
    // El filtro visual (Soporte) cambia las filas visibles, NO los cortes ni los colores.
    const gold = await run({ medida: "total", soporte: "GOLD" });
    expect(gold.rows.map((r) => r.name).sort()).toEqual(["Grupo 1", "Grupo 2", "Grupo 3"]);
    expect(pap(gold, "Grupo 3").cuts).toEqual(pap(tot, "Grupo 3").cuts);
    expect(pap(gold, "Grupo 3").color).toBe("yellow");
  });

  it("cada modo calcula SUS referencias: Por usuario con 10 usuarios divide los valores y los cortes (÷10) y el color no cambia; con la mitad de usuarios en un Grupo, sí cambia solo su valor", async () => {
    const w = await world(10);
    const por = await run();
    expect(pap(por, "Grupo 1").cuts).toMatchObject({ a: "0.225", b: "0.475" });
    expect([1, 2, 3, 4, 5, 6].map((n) => pap(por, `Grupo ${n}`).color)).toEqual(["green", "green", "yellow", "yellow", "red", "red"]);
    await changeUsers(w[5].g.id, 40); // el Grupo 6 pasa a 6/40 = 0,15 por usuario
    const por2 = await run();
    expect(pap(por2, "Grupo 6").value).toBe("0.15");
    expect(pap(por2, "Grupo 6").color).toBe("green");
    expect(pap(await run({ medida: "total" }), "Grupo 6").color).toBe("red"); // el Total no cambia
  });

  it("menos de cinco entidades válidas: «Muestra insuficiente», sin color definitivo y sin verde inventado", async () => {
    await world(null);
    await prisma.client.updateMany({ data: { isActive: false } });
    await prisma.clientGroup.updateMany({ where: { name: { in: ["Grupo 4", "Grupo 5", "Grupo 6"] } }, data: { isActive: false } });
    const tot = await run({ medida: "total", estado: "todos" });
    const i = pap(tot, "Grupo 1"); // la cohorte activa (Grupos 1-3) no llega a 5
    expect(i.status).toBe("SIN_REFERENCIA");
    expect(i.color).toBeNull();
    expect(i.reason).toContain("Muestra insuficiente");
  });

  it("el CSV y las URL conservan la medida", async () => {
    await world(10);
    const q = Q({ medida: "total" });
    expect(q.measure).toBe("total");
    const csv = await qualityCsv(admin.id, q, "cartera", { now: NOW });
    expect(csv.body.split("\n")[0]).toContain("medida");
    expect(csv.body).toContain("Total");
    expect(csv.body).toContain("total del periodo");
    expect(Q({}).measure).toBe("usuario");
  });
});

describe("PAP: del maestro a Calidad (§10)", () => {
  it("un PAP solo-Grupo cuenta en el Grupo y no se copia a sus hijos; varias causas con Correctivo cuentan una vez; sin fecha se localiza; Resultado distinto de OK no se pierde", async () => {
    await declareAllSourcesSafe();
    const g = await addGroup("Solo");
    const c1 = await addClient("Solo Uno", g.id);
    const c2 = await addClient("Solo Dos", g.id);
    const pb = await batchOf(admin.id, "pap");
    await seedPap(pb.id, { id: "1001", groupId: g.id, clientId: c1.id, date: "2026-10-05", state: "CORRECTIVE", causes: [{ category: "CORRECTIVE", origin: "STANDARD" }, { category: "CORRECTIVE", origin: "CONFIG_DATA" }, { category: "CLIENT_REQUEST" }], result: "KO" });
    await seedPap(pb.id, { id: "1002", groupId: g.id, clientId: c2.id, date: "2026-10-06", state: "NON_CORRECTIVE", causes: [{ category: "CLIENT_REQUEST" }] }); // Petición cliente: no es correctivo
    await seedPap(pb.id, { id: "1003", groupId: g.id, clientId: c2.id, date: null, state: "CORRECTIVE", causes: [{ category: "CORRECTIVE", origin: "STANDARD" }] }); // sin fecha: se localiza
    // PAP solo del Grupo (sin Cliente probado): drvClientId nulo.
    const it = await prisma.papItem.create({ data: { listKey: "L1", papId: "1004", firstBatchId: pb.id, drvScope: "GROUP_ONLY", drvGroupId: g.id, drvClientId: null } });
    const rev = await prisma.papRevision.create({ data: { itemId: it.id, fingerprint: "pf-D", revisionNo: 1, title: "PAP D", result: "OK", productionDate: new Date("2026-10-07T00:00:00Z"), correctiveState: "CORRECTIVE", data: {}, batchId: pb.id } });
    await prisma.papItem.update({ where: { id: it.id }, data: { currentRevisionId: rev.id } });
    await prisma.papCause.create({ data: { revisionId: rev.id, rawToken: "t", normalized: "n", category: "CORRECTIVE", origin: "STANDARD" } });
    const grp = (await run({ medida: "total", estado: "todos" })).rows.find((r) => r.name === "Solo")!;
    expect(grp.explain.PAP_CORRECTIVE.numerator).toBe("2"); // A (una vez, KO incluido) + D (solo Grupo)
    expect(grp.explain.PAP_CORRECTIVE.breakdown["sin fecha"]).toBe("1");
    const cli = await run({ medida: "total", estado: "todos", ambito: "client" });
    const num = (n: string) => cli.rows.find((r) => r.name === n)!.explain.PAP_CORRECTIVE.numerator;
    expect(num("Solo Uno")).toBe("1");
    expect(num("Solo Dos")).toBe("0"); // B (petición cliente) y C (sin fecha) no cuentan; D no se copia a los hijos
  });
  async function declareAllSourcesSafe() { await declareAllSources(admin.id, "2026-01-01", "2026-10-31"); }
});

describe("perfil inicial: instalación idempotente (§12)", () => {
  it("base nueva: el perfil inicial es la configuración activa (virtual) y la instalación crea la revisión 1 una sola vez", async () => {
    const virtual = await getActive(prisma, "QUALITY");
    expect(virtual.persisted).toBe(false);
    expect(virtual.payload.global.enabled).toBe(true);
    const first = await installInitialQualityProfile();
    const second = await installInitialQualityProfile();
    expect(first).toMatchObject({ status: "INSTALLED", revisionNo: 1 });
    expect(second).toMatchObject({ status: "UP_TO_DATE", revisionNo: 1 });
    expect(await prisma.configRevision.count({ where: { family: "QUALITY" } })).toBe(1);
    const row = await prisma.configRevision.findFirstOrThrow({ where: { family: "QUALITY" } });
    expect(row.kind).toBe("SYSTEM_INITIAL");
    expect(row.activatedById).toBeNull();
    expect(await prisma.auditEvent.count({ where: { entityType: { contains: "Config" } } })).toBe(0); // sin actor inventado
  });

  it("actualización: la revisión inicial anterior sin calibrar se sustituye por una NUEVA (la anterior se conserva); un borrador y una calibración manual se respetan", async () => {
    const legacy = uncalibratedQualityConfig();
    await prisma.configRevision.create({ data: { family: "QUALITY", revisionNo: 1, payload: legacy as never, reason: "Configuración inicial", kind: "INITIAL", activatedById: admin.id } });
    await prisma.configDraft.create({ data: { family: "QUALITY", payload: legacy as never, baseRevisionNo: 1, updatedById: admin.id } });
    expect(await installInitialQualityProfile()).toMatchObject({ status: "INSTALLED", revisionNo: 2 });
    expect(await installInitialQualityProfile()).toMatchObject({ status: "UP_TO_DATE", revisionNo: 2 });
    expect(await prisma.configRevision.count({ where: { family: "QUALITY" } })).toBe(2);
    const r1 = await prisma.configRevision.findFirstOrThrow({ where: { family: "QUALITY", revisionNo: 1 } });
    expect(readQualityPayload(r1.payload)).toMatchObject({ ok: true });
    const draft = await prisma.configDraft.findUniqueOrThrow({ where: { family: "QUALITY" } });
    expect(draft.baseRevisionNo).toBe(1); // el borrador se conserva y señala su base anterior
    const active = await getActive(prisma, "QUALITY");
    expect(active.revisionNo).toBe(2);
    expect(active.payload.global.greenMax).toBe("0.25");
  });

  it("una calibración manual activa nunca se sobrescribe", async () => {
    const manual = defaultQualityConfig();
    manual.global.greenMax = "0.3";
    await prisma.configRevision.create({ data: { family: "QUALITY", revisionNo: 1, payload: manual as never, reason: "Calibración del Administrador", kind: "ACTIVATION", activatedById: admin.id } });
    expect(await installInitialQualityProfile()).toMatchObject({ status: "KEPT_MANUAL", revisionNo: 1 });
    expect(await prisma.configRevision.count({ where: { family: "QUALITY" } })).toBe(1);
  });
});
