import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { GET as saludPublica } from "@/app/api/salud/route";
import { GET as saludAdmin } from "@/app/api/administracion/salud/route";
import { classifyWorkers, collectHealth, healthThresholds, redactedDiagnostic, toPublicHealth, type WorkerRow } from "@/server/ops/health";
import { beat, markStopped, registerWorker, requestWorkerStop, setActivity, noteProgress, startHeartbeat } from "@/server/ops/worker-instance";
import { adoptStores, checkStoreLayout, ensureInstallationId, readMarker, STORE_MARKER, verifyStore } from "@/server/ops/stores";
import { operationalEnvIssues } from "@/server/ops/startup";
import { isOperational } from "@/lib/runtime";
import { nodeSupported } from "@/server/ops/preflight";
import { freshEnvironment } from "./cargas-helpers";

/**
 * CSAPP-10 §4: latido por trabajador (en reposo y procesando), clasificación de salud con RELOJ CONTROLADO, permisos de las rutas, redacción del
 * diagnóstico y almacenes enlazados a la instalación. Los umbrales NO se amplían: se mueve el reloj inyectado.
 */
let up: string, ex: string;
beforeAll(() => {
  up = mkdtempSync(path.join(tmpdir(), "csapp-salud-up-"));
  ex = mkdtempSync(path.join(tmpdir(), "csapp-salud-ex-"));
  process.env.CSAPP_UPLOAD_DIR = up;
  process.env.CSAPP_EXPORT_DIR = ex;
});
afterAll(() => { rmSync(up, { recursive: true, force: true }); rmSync(ex, { recursive: true, force: true }); });
beforeEach(async () => { await freshEnvironment(); setActivity("upload", null); setActivity("export", null); });

const T0 = new Date("2026-11-02T10:00:00Z");
const plus = (ms: number) => new Date(T0.getTime() + ms);
const TH = () => healthThresholds();
async function instance(id: string, over: Partial<{ state: "IDLE" | "BUSY" | "STOPPING" | "STOPPED"; lastSeenAt: Date; progressAt: Date | null; currentKind: string | null; sha: string }> = {}) {
  await prisma.workerInstance.create({ data: { id, pid: 123, host: "h", version: "0.1.0", sha: over.sha ?? "desconocido", state: over.state ?? "IDLE", currentKind: over.currentKind ?? null, startedAt: T0, lastSeenAt: over.lastSeenAt ?? T0, progressAt: over.progressAt ?? null } });
}
const codes = async (now: Date) => (await collectHealth({ now })).problems.map((p) => p.code);

describe("clasificación del trabajador con reloj controlado", () => {
  it("ausente sin instancias; presente en reposo SIN ningún trabajo reciente; presente procesando", async () => {
    expect((await collectHealth({ now: T0 })).workers.verdict).toBe("ausente");
    expect(await codes(T0)).toContain("TRABAJADOR_AUSENTE");
    await instance("w1");
    // Sin trabajos en ninguna tabla: antes se inferiría «caído»; ahora el latido en reposo basta.
    expect(await prisma.uploadJob.count()).toBe(0);
    const idle = await collectHealth({ now: plus(10_000) });
    expect(idle.workers.verdict).toBe("presente_en_reposo");
    expect(idle.problems.map((p) => p.code)).not.toContain("TRABAJADOR_AUSENTE");
    await prisma.workerInstance.update({ where: { id: "w1" }, data: { state: "BUSY", currentKind: "upload:PREPARE", progressAt: T0 } });
    expect((await collectHealth({ now: plus(10_000) })).workers.verdict).toBe("presente_procesando");
  });

  it("el umbral de latido es exacto: vivo por debajo, ausente al alcanzarlo", async () => {
    await instance("w1");
    const alive = TH().workerAliveMs;
    expect((await collectHealth({ now: plus(alive - 1) })).workers.verdict).toBe("presente_en_reposo");
    expect((await collectHealth({ now: plus(alive) })).workers.verdict).toBe("ausente");
  });

  it("presente pero sin avanzar: vivo (latido reciente) con el último bloque confirmado hace más que el umbral; avanzando no se marca", async () => {
    const stall = TH().stallMs;
    await instance("w1", { state: "BUSY", currentKind: "upload:ACTIVATE", progressAt: T0, lastSeenAt: plus(stall + 5_000) });
    const r = await collectHealth({ now: plus(stall + 10_000) });
    expect(r.workers.verdict).toBe("presente_sin_avance");
    expect(r.problems.map((p) => p.code)).toContain("TRABAJADOR_SIN_AVANCE");
    expect(r.stuck.some((s) => s.reason.includes("sin avance"))).toBe(true);
    await prisma.workerInstance.update({ where: { id: "w1" }, data: { progressAt: plus(stall + 1_000) } });
    expect((await collectHealth({ now: plus(stall + 10_000) })).workers.verdict).toBe("presente_procesando");
  });

  it("detenido de forma ordenada se distingue de ausente; una instancia detenida no cuenta como viva", async () => {
    await instance("w1", { state: "STOPPED" });
    expect((await collectHealth({ now: plus(5_000) })).workers.verdict).toBe("detenido");
    await instance("w2", { state: "IDLE", lastSeenAt: plus(4_000) });
    expect((await collectHealth({ now: plus(5_000) })).workers.verdict).toBe("presente_en_reposo");
  });

  it("clasificador puro", () => {
    const row = (o: Partial<WorkerRow>): WorkerRow => ({ id: "x", pid: 1, host: "h", version: "v", sha: "s", state: "IDLE", currentKind: null, startedAt: "", lastSeenAt: "", ageSec: 1, alive: true, progressAgeSec: null, stalled: false, stopRequested: false, versionMatches: true, ...o });
    expect(classifyWorkers([])).toBe("ausente");
    expect(classifyWorkers([row({ alive: false })])).toBe("ausente");
    expect(classifyWorkers([row({ state: "STOPPED", alive: false })])).toBe("detenido");
    expect(classifyWorkers([row({}), row({ state: "BUSY", stalled: true })])).toBe("presente_sin_avance");
  });
});

describe("colas y trabajos atascados", () => {
  it("cola desatendida solo si no hay trabajador vivo; con trabajador vivo en reposo no es un problema", async () => {
    const { admin } = await freshEnvironment();
    const b = await prisma.uploadBatch.create({ data: { profileId: "sintetico-incorporar", profileVersion: 1, status: "QUEUED", originalName: "a.csv", storageId: "s1", fileFormat: "csv", createdById: admin.id } });
    await prisma.uploadJob.create({ data: { batchId: b.id, kind: "PREPARE", actorId: admin.id, createdAt: T0 } });
    const late = plus(TH().queueAgeMs + 60_000);
    expect(await codes(late)).toContain("COLA_DESATENDIDA");
    await instance("w1", { lastSeenAt: late });
    const withWorker = await collectHealth({ now: late });
    expect(withWorker.problems.map((p) => p.code)).not.toContain("COLA_DESATENDIDA");
    expect(withWorker.queues.uploads.pending).toBe(1);
  });

  it("lease vencido: error sin trabajador vivo, aviso si hay uno que lo reclamará", async () => {
    const { admin } = await freshEnvironment();
    const b = await prisma.uploadBatch.create({ data: { profileId: "sintetico-incorporar", profileVersion: 1, status: "PREPARING", originalName: "a.csv", storageId: "s2", fileFormat: "csv", createdById: admin.id } });
    await prisma.uploadJob.create({ data: { batchId: b.id, kind: "PREPARE", actorId: admin.id, status: "RUNNING", leaseOwner: "muerto", leaseExpiresAt: T0, createdAt: T0 } });
    const now = plus(120_000);
    const sin = (await collectHealth({ now })).problems.find((p) => p.code === "LEASE_VENCIDO");
    expect(sin?.level).toBe("error");
    await instance("w1", { lastSeenAt: now });
    expect((await collectHealth({ now })).problems.find((p) => p.code === "LEASE_VENCIDO")?.level).toBe("warn");
  });
});

describe("latido real del trabajador", () => {
  it("registra, late en reposo, publica el avance del trabajo y se detiene; la petición de cierre llega por la base", async () => {
    await registerWorker("wr1");
    const a = await prisma.workerInstance.findUniqueOrThrow({ where: { id: "wr1" } });
    expect(a.state).toBe("IDLE");
    await new Promise((r) => setTimeout(r, 20));
    expect((await beat("wr1", false)).stopRequested).toBe(false);
    const b = await prisma.workerInstance.findUniqueOrThrow({ where: { id: "wr1" } });
    expect(b.lastSeenAt.getTime()).toBeGreaterThan(a.lastSeenAt.getTime());
    setActivity("upload", { kind: "PREPARE", jobId: "j1", batchId: "b1" });
    await beat("wr1", false);
    const c = await prisma.workerInstance.findUniqueOrThrow({ where: { id: "wr1" } });
    expect(c).toMatchObject({ state: "BUSY", currentKind: "upload:PREPARE", currentJobId: "j1", currentBatchId: "b1" });
    expect(c.progressAt).not.toBeNull();
    noteProgress("upload");
    expect(await requestWorkerStop("wr1")).toBe(1);
    expect((await beat("wr1", false)).stopRequested).toBe(true);
    await beat("wr1", true);
    expect((await prisma.workerInstance.findUniqueOrThrow({ where: { id: "wr1" } })).state).toBe("STOPPING");
    await markStopped("wr1");
    expect(await requestWorkerStop("wr1")).toBe(0);
    const d = await prisma.workerInstance.findUniqueOrThrow({ where: { id: "wr1" } });
    expect(d).toMatchObject({ state: "STOPPED", currentKind: null });
    expect(d.stoppedAt).not.toBeNull();
  });

  it("el bucle de latido sobrevive a una pérdida temporal de base de datos: avisa una vez, se recupera y no duplica instancias", async () => {
    await registerWorker("wr2");
    const logs: string[] = [];
    let calls = 0;
    let stopAsked = 0;
    const stop = startHeartbeat({
      id: "wr2", intervalMs: 15, isStopping: () => false, onStopRequested: () => { stopAsked++; }, log: (l, m) => logs.push(`${l}:${m}`),
      beatFn: async (id, stopping) => { calls++; if (calls <= 3) throw new Error("connection terminated"); return beat(id, stopping); },
    });
    await new Promise((r) => setTimeout(r, 200));
    await requestWorkerStop("wr2");
    await new Promise((r) => setTimeout(r, 120));
    stop();
    expect(logs.filter((l) => l.startsWith("WARN:"))).toHaveLength(1);
    expect(logs.some((l) => l.startsWith("INFO:") && l.includes("recuperada"))).toBe(true);
    expect(stopAsked).toBe(1);
    expect(await prisma.workerInstance.count({ where: { id: "wr2" } })).toBe(1);
    expect((await prisma.workerInstance.findUniqueOrThrow({ where: { id: "wr2" } })).lastSeenAt.getTime()).toBeGreaterThan(T0.getTime());
  });
});

describe("rutas de salud: pública mínima y detalle solo para Administrador", () => {
  const ORIGIN = "http://localhost:3000";
  async function cookie(email: string, password: string) {
    const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  }
  it("la pública solo devuelve el estado; el detalle exige sesión de Administrador y no filtra secretos", async () => {
    const pub = await saludPublica();
    expect(pub.status).toBe(200);
    const body = await pub.json();
    expect(Object.keys(body)).toEqual(["status"]);
    const get = (c?: string) => saludAdmin(new Request(`${ORIGIN}/api/administracion/salud`, { headers: c ? { cookie: c } : {} }));
    expect((await get()).status).toBe(401);
    expect((await get(await cookie("lectura@test.local", "clave-de-prueba-456"))).status).toBe(403);
    const res = await get(await cookie("admin@test.local", "clave-de-prueba-123"));
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const secret of [process.env.BETTER_AUTH_SECRET!, process.env.DATABASE_URL!, "postgresql://", "password"]) expect(text).not.toContain(secret);
    expect(JSON.parse(text)).toMatchObject({ web: { ok: true }, database: { ok: true } });
  });
  it("el diagnóstico descargable no incluye rutas completas, secretos ni sesiones", async () => {
    const r = await collectHealth({ now: T0 });
    const text = JSON.stringify(redactedDiagnostic(r));
    expect(text).not.toContain(up);
    expect(text).not.toContain(ex);
    expect(text).not.toContain(process.env.BETTER_AUTH_SECRET!);
    expect(JSON.stringify(toPublicHealth(r))).toBe('{"status":"degradado"}'); // sin trabajador: degradado, nunca detalle
  });
});

describe("almacenes enlazados a la instalación", () => {
  it("se enlazan al preparar, se reconocen, y un almacén ajeno o con datos sin marca se rechaza sin tocarlo", async () => {
    const id = await ensureInstallationId();
    expect(await ensureInstallationId()).toBe(id); // idempotente
    expect((await verifyStore("uploads", id, { create: true })).state).toBe("creado");
    expect((await verifyStore("uploads", id, { create: true })).state).toBe("ok");
    expect((await readMarker(up))?.installationId).toBe(id);
    // Marca ajena
    writeFileSync(path.join(ex, STORE_MARKER), JSON.stringify({ kind: "exports", installationId: "otra", createdAt: "x" }));
    expect((await verifyStore("exports", id, { create: true })).state).toBe("marca-ajena");
    expect((await readMarker(ex))?.installationId).toBe("otra");
    // Con datos y sin marca
    rmSync(path.join(ex, STORE_MARKER));
    mkdirSync(path.join(ex, "files"), { recursive: true });
    writeFileSync(path.join(ex, "files", "x"), "datos");
    expect((await verifyStore("exports", id, { create: true })).state).toBe("con-datos-sin-marca");
    expect(await readMarker(ex)).toBeNull();
    // Adopción explícita
    await adoptStores(id);
    expect((await verifyStore("exports", id, { create: false })).state).toBe("ok");
  });
  it("la salud informa de un almacén ajeno y de uno inaccesible", async () => {
    const id = await ensureInstallationId();
    await adoptStores(id);
    writeFileSync(path.join(up, STORE_MARKER), JSON.stringify({ kind: "uploads", installationId: "otra", createdAt: "x" }));
    expect(await codes(T0)).toContain("ALMACEN_AJENO");
    const saved = process.env.CSAPP_UPLOAD_DIR;
    process.env.CSAPP_UPLOAD_DIR = path.join(up, "no-existe");
    expect(await codes(T0)).toContain("ALMACEN_AUSENTE");
    process.env.CSAPP_UPLOAD_DIR = saved;
  });
});

describe("configuración operativa", () => {
  const root = "/srv/cs-app/app";
  it("exige rutas explícitas, distintas, no anidadas, fuera de public/, .next/ y de la carpeta de la aplicación", () => {
    const ok = checkStoreLayout({ uploads: "/srv/cs-app/datos/originales", exports: "/srv/cs-app/datos/exportaciones", root, operational: true, uploadsExplicit: true, exportsExplicit: true });
    expect(ok).toEqual([]);
    const cs = (o: Partial<Parameters<typeof checkStoreLayout>[0]>) => checkStoreLayout({ uploads: "/d/u", exports: "/d/e", root, operational: true, uploadsExplicit: true, exportsExplicit: true, ...o }).map((p) => p.code);
    expect(cs({ uploadsExplicit: false })).toContain("UPLOAD_DIR_FALTA");
    expect(cs({ exports: "/d/u" })).toContain("ALMACENES_IGUALES");
    expect(cs({ exports: "/d/u/sub" })).toContain("ALMACENES_ANIDADOS");
    expect(cs({ uploads: `${root}/public/x` })).toContain("ALMACEN_PUBLICO");
    expect(cs({ uploads: `${root}/.next/x` })).toContain("ALMACEN_EN_BUILD");
    expect(cs({ exports: `${root}/worker-dist/x` })).toContain("ALMACEN_EN_BUILD");
    expect(cs({ exports: `${root}/datos` })).toContain("ALMACEN_EN_RELEASE");
    // No operativo (desarrollo): relativo permitido, pero public/ y .next/ siguen prohibidos.
    expect(checkStoreLayout({ uploads: `${root}/almacen-cargas`, exports: `${root}/almacen-exportaciones`, root, operational: false, uploadsExplicit: false, exportsExplicit: false })).toEqual([]);
    expect(checkStoreLayout({ uploads: `${root}/public/u`, exports: "/d/e", root, operational: false, uploadsExplicit: false, exportsExplicit: false }).map((p) => p.code)).toContain("ALMACEN_PUBLICO");
  });
  it("las opciones de prueba no se habilitan por accidente en operación; las bases de prueba/shadow avisan sin impedir el arranque", () => {
    expect(operationalEnvIssues({ NODE_ENV: "production" })).toEqual([]);
    for (const k of ["CSAPP_ENABLE_SYNTHETIC_PROFILES", "CSAPP_APPROVED_TEST_DB", "CSAPP_COUNT_QUERIES"]) {
      expect(operationalEnvIssues({ NODE_ENV: "production", [k]: "x" })).toEqual([expect.objectContaining({ code: "OPCION_DE_PRUEBA", fatal: true })]);
    }
    for (const k of ["TEST_DATABASE_URL", "SHADOW_DATABASE_URL"]) {
      expect(operationalEnvIssues({ NODE_ENV: "production", [k]: "x" })).toEqual([expect.objectContaining({ code: "BASE_DE_PRUEBAS_HEREDADA", fatal: false })]);
    }
    expect(isOperational({ NODE_ENV: "production" })).toBe(true);
    expect(isOperational({ NODE_ENV: "production", CSAPP_ENABLE_SYNTHETIC_PROFILES: "cs_app_test" })).toBe(true); // el flag NO convierte la instalación en «no operativa»: se rechaza
    expect(isOperational({ NODE_ENV: "production", CSAPP_APPROVED_TEST_DB: "cs_app_e2e_test" })).toBe(false); // destino de pruebas aprobado por el guard
    expect(isOperational({ NODE_ENV: "test" })).toBe(false);
  });
  it("versiones de Node: 22.18+, 24.11+; no 22.17 ni 23", () => {
    expect([nodeSupported("v22.22.0"), nodeSupported("v22.18.0"), nodeSupported("v22.17.9"), nodeSupported("v23.0.0"), nodeSupported("v24.11.0"), nodeSupported("v24.10.0")]).toEqual([true, true, false, false, true, false]);
  });
});
