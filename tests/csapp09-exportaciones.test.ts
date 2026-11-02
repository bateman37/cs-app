import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { prisma } from "@/lib/db";
import { STANDARD_CAUSE } from "@/domain/zendesk";
import { cancelExport, createExport, getExport, listMyExports, retryExport, authorizeDownload, superviseExports } from "@/server/exports/service";
import { claimNextExport, exportFilePath, expireExports, processExport, runExportOnce, sweepExportOrphans } from "@/server/exports/run";
import { resetDatabase, makeUsers } from "./helpers";
import { addClient, addGroup, addZd, seedFinance, setUsers } from "./economia-helpers";
import { batchOf, seedBugLink, seedPap, seedTicket } from "./calidad-helpers";

/**
 * CSAPP-09 §6: exportaciones completas en segundo plano sobre PostgreSQL REAL con datos SINTÉTICOS. Se verifica el CONTENIDO descargado (no solo «listo»):
 * recuentos, sumas, checksum, unicidad, partición, recuperación, fencing, permisos y caducidad. Almacén temporal propio, limpiado por su directorio.
 */
let admin: { id: string };
let reader: { id: string };
let dir: string;
const WK = "trabajador-prueba";
beforeEach(async () => {
  await resetDatabase();
  ({ admin, reader } = await makeUsers());
  dir = await mkdtemp(path.join(tmpdir(), "csapp09-exp-"));
  process.env.CSAPP_EXPORT_DIR = dir;
  delete process.env.CSAPP_EXPORT_PART_ROWS;
});
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const req = (extra: Record<string, string> = {}) => ({ dataset: "horas", scope: "group", sel: "", desde: "2026-10-01", hasta: "2026-10-31", servicio: "TOTAL", ...extra });
async function csvOf(storageId: string) {
  const raw = await readFile(exportFilePath(storageId), "utf8");
  expect(raw.startsWith("﻿")).toBe(true);
  return { raw, rows: parse(raw.slice(1), { delimiter: ";", columns: true, skip_empty_lines: true }) as Record<string, string>[] };
}
async function world() {
  const g = await addGroup("Atlas");
  const c = await addClient("Atlas 1", g.id);
  await prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: "701", searchValue: "701", clientId: c.id } });
  await setUsers(admin.id, { groupId: g.id }, 2026, Array(12).fill(100));
  const zd = await batchOf(admin.id, "zendesk-tiempo");
  return { g, c, zd };
}

describe("exportación completa de hechos", () => {
  it("genera el archivo por bloques, con contrato, sello y conciliación: Σ minutos del CSV = Σ de la fuente; checksum y recuento coinciden con el registro", async () => {
    const { g, c, zd } = await world();
    await addZd({ batchId: zd.id, date: "2026-10-05", minutes: 30, groupId: g.id, clientId: c.id });
    await addZd({ batchId: zd.id, date: "2026-10-06", minutes: 90, groupId: g.id, clientId: c.id });
    await addZd({ batchId: zd.id, date: "2026-10-07", minutes: 45, groupId: g.id, clientId: c.id, eligibility: "PENDING_ELIGIBILITY", bucket: "PENDING_ELIGIBILITY" });
    await addZd({ batchId: zd.id, date: "2026-10-08", minutes: 10, eligibility: "EXCLUDED_PMO", bucket: "EXCLUDED_PMO" }); // sin Grupo: se conserva
    await addZd({ batchId: zd.id, date: "2026-11-02", minutes: 999, groupId: g.id, clientId: c.id }); // posterior al corte: no entra
    process.env.CSAPP_EXPORT_PAGE_ROWS = "2"; // fuerza varios bloques
    const job = await createExport(admin.id, req());
    expect(job.status).toBe("QUEUED");
    expect(job.requested.totals).toEqual({ horas: 4 });
    expect(await runExportOnce(WK)).toBe(true);
    const done = await getExport(admin.id, job.id);
    expect(done).toMatchObject({ status: "READY", progressDone: "4", phase: "listo" });
    expect(done.material?.laterThanScreen).toBe(false);
    const data = done.files.find((f) => f.fileKey === "horas")!;
    const { raw, rows } = await csvOf((await authorizeDownload(admin.id, job.id, data.id)).storageId);
    expect(rows).toHaveLength(4);
    expect(rows.reduce((s, r) => s + Number(r.minutos.replace(",", ".")), 0)).toBe(175);
    expect(rows.filter((r) => r.clase_particion === "ELEGIBLE").reduce((s, r) => s + Number(r.minutos.replace(",", ".")), 0)).toBe(120);
    expect(rows.find((r) => r.clase_particion === "EXCLUIDA")).toMatchObject({ grupo_id: "", motivo_particion: "EXCLUDED_PMO" }); // conservada y separada
    expect(new Set(rows.map((r) => `${r.fuente}|${r.id_entrada}`)).size).toBe(4); // unicidad de la clave
    expect(createHash("sha256").update(raw, "utf8").digest("hex")).toBe(data.checksum);
    expect(Number(data.rows)).toBe(4);
    const mf = done.files.find((f) => f.kind === "MANIFEST")!;
    const manifest = JSON.parse(await readFile(exportFilePath((await authorizeDownload(admin.id, job.id, mf.id)).storageId), "utf8"));
    expect(manifest).toMatchObject({ total_filas: 4, lectura_posterior_a_la_pantalla: false });
    expect(manifest.archivos_generados[0]).toMatchObject({ filas: 4, sha256: data.checksum });
    expect(manifest.archivos[0].columnas.map((c: { nombre: string }) => c.nombre)).toContain("minutos");
    delete process.env.CSAPP_EXPORT_PAGE_ROWS;
  });

  it("más de 10 filas y bloques pequeños: orden numérico estable, sin saltos ni repeticiones (regresión: ORDER BY sobre el texto de salida)", async () => {
    const { g, c, zd } = await world();
    for (let i = 1; i <= 25; i++) await addZd({ batchId: zd.id, date: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`, minutes: i, groupId: g.id, clientId: c.id });
    process.env.CSAPP_EXPORT_PAGE_ROWS = "3";
    const job = await createExport(admin.id, req());
    await runExportOnce(WK);
    const done = await getExport(admin.id, job.id);
    expect(done).toMatchObject({ status: "READY", progressDone: "25" });
    const { rows } = await csvOf((await authorizeDownload(admin.id, job.id, done.files.find((f) => f.fileKey === "horas")!.id)).storageId);
    expect(rows).toHaveLength(25);
    expect(new Set(rows.map((r) => r.id_entrada)).size).toBe(25);
    expect(rows.reduce((s, r) => s + Number(r.minutos.replace(",", ".")), 0)).toBe(325); // 1 + … + 25
    expect(rows.map((r) => r.fecha_trabajo)).toEqual([...rows.map((r) => r.fecha_trabajo)].sort());
    delete process.env.CSAPP_EXPORT_PAGE_ROWS;
  });

  it("tickets: la suma de cuenta_numerador es el numerador del sexto indicador (un problema con dos bugs cuenta una vez; un bug con dos problemas, dos) y N3 no se duplica", async () => {
    const { g, c } = await world();
    const tb = await batchOf(admin.id, "zendesk-tickets", "2026-10-31");
    await seedTicket(tb.id, { id: "P1", org: "701", type: "problem", created: "2026-10-05", cause: STANDARD_CAUSE, destinations: ["PMO_N3", "IT_N3"], observedOn: "2026-10-31" });
    await seedTicket(tb.id, { id: "P2", org: "701", type: "problem", created: "2026-10-06", observedOn: "2026-10-31" });
    await seedBugLink(tb.id, { bugId: "1", ticket: "P1", clientId: c.id, groupId: g.id });
    await seedBugLink(tb.id, { bugId: "2", ticket: "P1", clientId: c.id, groupId: g.id });
    await seedBugLink(tb.id, { bugId: "3", ticket: "P2", clientId: c.id, groupId: g.id });
    const job = await createExport(admin.id, req({ dataset: "tickets" }));
    await runExportOnce(WK);
    const done = await getExport(admin.id, job.id);
    expect(done.status).toBe("READY");
    const tickets = await csvOf((await authorizeDownload(admin.id, job.id, done.files.find((f) => f.fileKey === "tickets")!.id)).storageId);
    expect(tickets.rows).toHaveLength(2);
    expect(tickets.rows.filter((r) => r.es_n3 === "sí")).toHaveLength(1);
    expect(tickets.rows.find((r) => r.n3_pmo === "sí")).toMatchObject({ n3_it: "sí", afectacion_union: "sí" }); // un ticket con dos destinos: una fila, dos desgloses no aditivos
    expect(tickets.rows.filter((r) => r.afectacion_union === "sí")).toHaveLength(2);
    const backlog = done.files.find((f) => f.fileKey === "backlog")!;
    expect(Number(backlog.rows)).toBe(0); // sin fotografía declarada completa: archivo vacío (con su motivo en el manifiesto), no relleno con el estado actual
  });

  it("problemas–bugs: relación no aditiva con una única fila que cuenta por ticket", async () => {
    const { g, c } = await world();
    const tb = await batchOf(admin.id, "zendesk-tickets", "2026-10-31");
    await seedTicket(tb.id, { id: "Q1", org: "701", type: "problem", created: "2026-10-05", cause: STANDARD_CAUSE, observedOn: "2026-10-31" });
    await seedTicket(tb.id, { id: "Q2", org: "701", type: "problem", created: "2026-10-06", observedOn: "2026-10-31" });
    await seedBugLink(tb.id, { bugId: "10", ticket: "Q1", clientId: c.id, groupId: g.id });
    await seedBugLink(tb.id, { bugId: "11", ticket: "Q1", clientId: c.id, groupId: g.id });
    await seedBugLink(tb.id, { bugId: "12", ticket: "Q2", clientId: c.id, groupId: g.id });
    const job = await createExport(admin.id, req({ dataset: "bugs" }));
    await runExportOnce(WK);
    const done = await getExport(admin.id, job.id);
    const rel = await csvOf((await authorizeDownload(admin.id, job.id, done.files.find((f) => f.fileKey === "problemas_bugs")!.id)).storageId);
    expect(rel.rows).toHaveLength(3); // tres vínculos
    expect(rel.rows.filter((r) => r.cuenta_numerador === "sí")).toHaveLength(2); // dos problemas únicos, no tres
    expect(done.files.find((f) => f.fileKey === "problemas_bugs")?.additive).toBe(false);
  });

  it("PAP: un archivo de PAP únicos y otro de causas; varias causas no multiplican el PAP", async () => {
    const { g, c } = await world();
    const b = await batchOf(admin.id, "pap");
    await seedPap(b.id, { id: "7", groupId: g.id, clientId: c.id, date: "2026-10-10", state: "CORRECTIVE", causes: [{ category: "CORRECTIVE", origin: "STANDARD" }, { category: "CORRECTIVE", origin: "CLIENT_ORIGIN" }] });
    await seedPap(b.id, { id: "8", groupId: g.id, clientId: c.id, date: null, state: "UNKNOWN" });
    const job = await createExport(admin.id, req({ dataset: "pap" }));
    await runExportOnce(WK);
    const done = await getExport(admin.id, job.id);
    const pap = await csvOf((await authorizeDownload(admin.id, job.id, done.files.find((f) => f.fileKey === "pap")!.id)).storageId);
    const causes = await csvOf((await authorizeDownload(admin.id, job.id, done.files.find((f) => f.fileKey === "pap_causas")!.id)).storageId);
    expect(pap.rows).toHaveLength(2);
    expect(pap.rows.filter((r) => r.es_correctivo === "sí")).toHaveLength(1);
    expect(pap.rows.find((r) => r.pap_id === "8")).toMatchObject({ fecha_produccion: "", en_periodo: "" }); // sin fecha: conservado, sin ubicar
    expect(causes.rows).toHaveLength(2);
  });
});

describe("formato CSV", () => {
  it("neutraliza fórmulas en texto no confiable pero conserva el negativo numérico válido con coma decimal; vacío y cero son distintos", async () => {
    const { g, c } = await world();
    const tb = await batchOf(admin.id, "zendesk-tickets", "2026-10-31");
    await seedTicket(tb.id, { id: "FX", org: "701", type: "incident", created: "2026-10-05", cause: "=HYPERLINK(\"http://x\")", entorno: "+SUM(1)", observedOn: "2026-10-31" });
    await seedFinance(admin.id, "SOPORTE", 2026, [{ groupId: g.id, income: "-100.50" }, { groupId: g.id, income: "0", label: "cero" }, { groupId: null, income: "7.25", label: "sin grupo" }]);
    void c;
    const t = await createExport(admin.id, req({ dataset: "tickets" }));
    const f = await createExport(admin.id, req({ dataset: "finanzas" }));
    await runExportOnce(WK);
    await runExportOnce(WK);
    const tj = await getExport(admin.id, t.id);
    const { raw: traw } = await csvOf((await authorizeDownload(admin.id, t.id, tj.files.find((x) => x.fileKey === "tickets")!.id)).storageId);
    expect(traw).toContain("\"'=HYPERLINK(\"\"http://x\"\")\""); // texto con fórmula: apóstrofo y comillas escapadas
    const fj = await getExport(admin.id, f.id);
    const { raw: fraw, rows } = await csvOf((await authorizeDownload(admin.id, f.id, fj.files.find((x) => x.fileKey === "finanzas_lineas")!.id)).storageId);
    expect(fraw).toContain(";-100,5;"); // negativo numérico válido: sin apóstrofo, coma decimal
    expect(fraw).not.toContain("'-100");
    expect(rows.map((r) => r.ingreso).sort()).toEqual(["-100,5", "0", "7,25"]); // el cero es explícito
    expect(rows.find((r) => r.etiqueta_origen === "sin grupo")?.grupo_id).toBe(""); // vacío = sin atribución, no cero
  });
});

describe("recuperación, fencing, cancelación y caducidad", () => {
  it("un fallo tras escribir y antes de marcar LISTO regenera desde la materialización: mismos bytes, un único archivo vigente por parte, sin filas duplicadas", async () => {
    const { g, c, zd } = await world();
    for (let i = 1; i <= 5; i++) await addZd({ batchId: zd.id, date: `2026-10-0${i}`, minutes: 10 * i, groupId: g.id, clientId: c.id });
    process.env.CSAPP_WORKER_BACKOFF_MS = "1";
    const job = await createExport(admin.id, req());
    let crashed = false;
    const claimed = (await claimNextExport(WK))!;
    await processExport(claimed, () => false, () => {}, { beforePublish: () => { crashed = true; throw new Error("caída simulada tras escribir los archivos"); } });
    expect(crashed).toBe(true);
    const mid = await getExport(admin.id, job.id);
    expect(mid.status).toBe("QUEUED"); // reintento programado, nada publicado
    expect(mid.files).toHaveLength(0);
    expect(mid.material).not.toBeNull(); // la materialización completa se conserva
    const matAt = mid.material!.readAt;
    await new Promise((r) => setTimeout(r, 30));
    expect(await runExportOnce(WK)).toBe(true);
    const done = await getExport(admin.id, job.id);
    expect(done.status).toBe("READY");
    expect(done.material!.readAt).toBe(matAt); // se reutiliza: no se presenta como una lectura nueva
    const { rows } = await csvOf((await authorizeDownload(admin.id, job.id, done.files.find((f) => f.fileKey === "horas")!.id)).storageId);
    expect(rows).toHaveLength(5);
    expect(await prisma.exportFile.count({ where: { jobId: job.id } })).toBe(2); // datos + manifiesto
    expect((await readdir(path.join(dir, "tmp"))).length).toBe(0);
    delete process.env.CSAPP_WORKER_BACKOFF_MS;
  });

  it("lease vencido y trabajador antiguo: el nuevo confirma y el antiguo no puede (fencing); no hay dos resultados vigentes", async () => {
    const { g, c, zd } = await world();
    await addZd({ batchId: zd.id, date: "2026-10-05", minutes: 30, groupId: g.id, clientId: c.id });
    const job = await createExport(admin.id, req());
    const old = (await claimNextExport("trabajador-antiguo"))!;
    await prisma.exportJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } }); // el lease del antiguo vence
    const fresh = (await claimNextExport("trabajador-nuevo"))!;
    expect(fresh.id).toBe(old.id);
    expect(fresh.fence).toBeGreaterThan(old.fence);
    await processExport(old, () => false); // el antiguo intenta preparar y confirmar: pierde el lease sin escribir
    expect((await getExport(admin.id, job.id)).status).not.toBe("READY");
    await processExport(fresh, () => false);
    const done = await getExport(admin.id, job.id);
    expect(done.status).toBe("READY");
    expect(await prisma.exportFile.count({ where: { jobId: job.id } })).toBe(2);
  });

  it("reintentos agotados dejan un fallo visible y recuperable (no «en ejecución» eterno); reintentar reutiliza lo materializado", async () => {
    const { g, c, zd } = await world();
    await addZd({ batchId: zd.id, date: "2026-10-05", minutes: 30, groupId: g.id, clientId: c.id });
    process.env.CSAPP_WORKER_BACKOFF_MS = "1";
    const job = await createExport(admin.id, req());
    for (let i = 0; i < 3; i++) {
      const c1 = (await claimNextExport(WK))!;
      await processExport(c1, () => false, () => {}, { beforePublish: () => { throw new Error("disco lleno simulado"); } });
      await new Promise((r) => setTimeout(r, 10));
    }
    const failed = await getExport(admin.id, job.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.lastError).toMatch(/disco lleno/);
    expect(failed.expiresAt).not.toBeNull();
    const again = await retryExport(admin.id, job.id);
    expect(again.status).toBe("QUEUED");
    await runExportOnce(WK);
    expect((await getExport(admin.id, job.id)).status).toBe("READY");
    delete process.env.CSAPP_WORKER_BACKOFF_MS;
  });

  it("si los datos cambian entre la pantalla y la preparación se conservan ambos sellos y se avisa «lectura posterior a la pantalla»", async () => {
    const { g, c, zd } = await world();
    await addZd({ batchId: zd.id, date: "2026-10-05", minutes: 30, groupId: g.id, clientId: c.id });
    const job = await createExport(admin.id, req());
    await addZd({ batchId: zd.id, date: "2026-10-06", minutes: 60, groupId: g.id, clientId: c.id }); // cambia el mundo tras pedir
    await runExportOnce(WK);
    const done = await getExport(admin.id, job.id);
    expect(done.material?.laterThanScreen).toBe(true);
    expect(done.requested.totals).toEqual({ horas: 1 }); // lo que mostraba la pantalla
    expect(done.material?.rows).toBe("2"); // lo que contiene el archivo
    expect(done.requested.stamp).not.toBe(done.material?.stamp);
  });

  it("partición determinista cuando el archivo supera el límite de filas: sin truncar, partes numeradas, unión = total, sin repetidos", async () => {
    const { g, c, zd } = await world();
    for (let i = 1; i <= 7; i++) await addZd({ batchId: zd.id, date: `2026-10-0${i}`, minutes: i, groupId: g.id, clientId: c.id });
    process.env.CSAPP_EXPORT_PART_ROWS = "3";
    const job = await createExport(admin.id, req());
    await runExportOnce(WK);
    const done = await getExport(admin.id, job.id);
    const parts = done.files.filter((f) => f.kind === "DATA");
    expect(parts.map((p) => p.name)).toEqual(["horas_horas_p001.csv", "horas_horas_p002.csv", "horas_horas_p003.csv"]);
    expect(parts.map((p) => Number(p.rows))).toEqual([3, 3, 1]);
    const all: Record<string, string>[] = [];
    for (const p of parts) all.push(...(await csvOf((await authorizeDownload(admin.id, job.id, p.id)).storageId)).rows);
    expect(all).toHaveLength(7);
    expect(new Set(all.map((r) => r.id_entrada)).size).toBe(7);
    expect(all.map((r) => r.fecha_trabajo)).toEqual([...all.map((r) => r.fecha_trabajo)].sort()); // orden estable
    const manifest = JSON.parse(await readFile(exportFilePath((await authorizeDownload(admin.id, job.id, done.files.find((f) => f.kind === "MANIFEST")!.id)).storageId), "utf8"));
    expect(manifest.avisos[0]).toMatch(/partido de forma determinista/);
  });

  it("cancelar en cola es inmediato; cancelar durante la generación se resuelve en la siguiente frontera segura y limpia la materialización", async () => {
    const { g, c, zd } = await world();
    for (let i = 1; i <= 6; i++) await addZd({ batchId: zd.id, date: `2026-10-0${i}`, minutes: 5, groupId: g.id, clientId: c.id });
    const queued = await createExport(admin.id, req());
    expect((await cancelExport(admin.id, queued.id)).status).toBe("CANCELLED");
    expect(await runExportOnce(WK)).toBe(false); // nada que procesar
    process.env.CSAPP_EXPORT_PAGE_ROWS = "2";
    const job = await createExport(admin.id, req());
    const claimed = (await claimNextExport(WK))!;
    await processExport(claimed, () => false, () => {}, { afterPage: async ({ page }) => { if (page === 1) await cancelExport(admin.id, job.id); } });
    const after = await getExport(admin.id, job.id);
    expect(after.status).toBe("CANCELLED");
    expect(after.files).toHaveLength(0);
    expect(await prisma.exportRow.count({ where: { jobId: job.id } })).toBe(0);
    expect((await retryExport(admin.id, job.id)).status).toBe("QUEUED");
    delete process.env.CSAPP_EXPORT_PAGE_ROWS;
  });

  it("caducar elimina artefactos y materialización, conserva el registro mínimo y no toca datos de negocio ni lotes", async () => {
    const { g, c, zd } = await world();
    await addZd({ batchId: zd.id, date: "2026-10-05", minutes: 30, groupId: g.id, clientId: c.id });
    const job = await createExport(admin.id, req());
    await runExportOnce(WK);
    const files = (await getExport(admin.id, job.id)).files;
    const ids = await Promise.all(files.map(async (f) => (await authorizeDownload(admin.id, job.id, f.id)).storageId));
    const batches = await prisma.uploadBatch.count();
    const times = await prisma.zdTimeEntry.count();
    await prisma.exportJob.update({ where: { id: job.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await expireExports()).toBe(1);
    const exp = await getExport(admin.id, job.id);
    expect(exp).toMatchObject({ status: "EXPIRED", files: [] });
    expect(await prisma.exportRow.count({ where: { jobId: job.id } })).toBe(0);
    for (const id of ids) await expect(readFile(exportFilePath(id))).rejects.toThrow();
    expect(await prisma.uploadBatch.count()).toBe(batches);
    expect(await prisma.zdTimeEntry.count()).toBe(times);
    await expect(authorizeDownload(admin.id, job.id, files[0].id)).rejects.toThrow(/no está disponible/);
  });

  it("barrido de huérfanos: solo archivos sin registro y antiguos, dentro del almacén de exportaciones", async () => {
    const { g, c, zd } = await world();
    await addZd({ batchId: zd.id, date: "2026-10-05", minutes: 30, groupId: g.id, clientId: c.id });
    const job = await createExport(admin.id, req());
    await runExportOnce(WK);
    const { writeFile, utimes } = await import("node:fs/promises");
    const orphan = exportFilePath("11111111-1111-4111-8111-111111111111");
    await writeFile(orphan, "huérfano");
    const old = new Date(Date.now() - 2 * 3_600_000);
    await utimes(orphan, old, old);
    expect(await sweepExportOrphans()).toBe(1);
    expect((await getExport(admin.id, job.id)).status).toBe("READY");
    await expect(authorizeDownload(admin.id, job.id, (await getExport(admin.id, job.id)).files[0].id)).resolves.toBeTruthy(); // lo registrado sigue ahí
  });
});

describe("permisos y manipulación", () => {
  it("el propietario ve y descarga; otra persona recibe «no encontrada» (un UUID no autoriza); Administración supervisa estados sin descargar archivos ajenos", async () => {
    const { g, c, zd } = await world();
    await addZd({ batchId: zd.id, date: "2026-10-05", minutes: 30, groupId: g.id, clientId: c.id });
    const job = await createExport(reader.id, req()); // Consulta exporta el detalle que puede leer
    await runExportOnce(WK);
    const f = (await getExport(reader.id, job.id)).files[0];
    await expect(getExport(admin.id, job.id)).rejects.toThrow(/no encontrada/);
    await expect(authorizeDownload(admin.id, job.id, f.id)).rejects.toThrow(/no encontrada/);
    await expect(cancelExport(admin.id, job.id)).rejects.toThrow(/no encontrada/);
    await expect(retryExport(admin.id, job.id)).rejects.toThrow(/no encontrada/);
    const sup = await superviseExports(admin.id);
    expect(sup.jobs[0]).toMatchObject({ id: job.id, status: "READY", mine: false });
    await expect(superviseExports(reader.id)).rejects.toThrow(); // la supervisión técnica es de Administración
    expect(await listMyExports(admin.id)).toHaveLength(0);
    await expect(getExport(reader.id, "../../etc/passwd")).rejects.toThrow(/no encontrada/);
    await expect(authorizeDownload(reader.id, job.id, "otro-archivo")).rejects.toThrow(/no encontrado/i);
  });

  it("consultas no válidas se rechazan en servidor sin crear nada; actor desactivado no puede crear", async () => {
    await world();
    for (const bad of [req({ dataset: "usuarios" }), req({ desde: "2026-13-01" }), req({ hasta: "2020-01-01" }), req({ sel: "x'; DROP TABLE" }), req({ servicio: "OTRO" }), { ...req(), extra: "1" }]) await expect(createExport(admin.id, bad)).rejects.toThrow(/no es válida/);
    expect(await prisma.exportJob.count()).toBe(0);
    await prisma.user.update({ where: { id: reader.id }, data: { isActive: false } });
    await expect(createExport(reader.id, req())).rejects.toThrow();
  });

  it("actor revocado mientras el trabajo espera: el trabajador no genera nada y deja constancia", async () => {
    const { g, c, zd } = await world();
    await addZd({ batchId: zd.id, date: "2026-10-05", minutes: 30, groupId: g.id, clientId: c.id });
    const job = await createExport(reader.id, req());
    await prisma.user.update({ where: { id: reader.id }, data: { isActive: false } });
    await runExportOnce(WK);
    const j = await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(j.status).toBe("CANCELLED");
    expect(j.lastError).toMatch(/ya no tiene permiso/);
    expect(await prisma.exportFile.count({ where: { jobId: job.id } })).toBe(0);
  });

  it("límite de exportaciones activas por persona", async () => {
    await world();
    await createExport(admin.id, req());
    await createExport(admin.id, req());
    await expect(createExport(admin.id, req())).rejects.toThrow(/en curso/);
  });
});
