import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AccessError } from "@/lib/access";
import { DomainError } from "@/server/errors";
import {
  cancelUpload,
  confirmUpload,
  getUpload,
  listStagedRows,
  listUploads,
  receiveUpload,
  reprocessUpload,
  revertUpload,
  UploadBusyError,
  UploadLimitError,
} from "@/server/uploads/batches";
import { claimNextJob, assertFence, LostLeaseError } from "@/server/uploads/queue";
import { processJob, maintenance, runOnce } from "@/server/uploads/worker";
import { getProfiles, resetRegistryCache } from "@/server/uploads/registry";
import { listDir } from "@/server/uploads/storage";
import { canonicalJson, rowFingerprint } from "@/server/uploads/fingerprint";
import { writeXlsx } from "./generators/xlsx";
import { batch, drain, freshEnvironment, removeUploadDir, uploadText, useUploadDir } from "./cargas-helpers";
import { csvText, row } from "./synthetic/data";
import { scopedRecords, setRulesVersion, syntheticRecords } from "./synthetic/schema";

let dir: string;
let admin: { id: string };
let reader: { id: string };

beforeAll(() => {
  dir = useUploadDir();
  process.env.CSAPP_WORKER_BACKOFF_MS = "1";
});
afterAll(() => removeUploadDir(dir));
beforeEach(async () => {
  const u = await freshEnvironment();
  admin = u.admin;
  reader = u.reader;
});

async function uploadAndPrepare(text: string, opts: Parameters<typeof uploadText>[2] = {}) {
  const up = await uploadText(admin.id, text, opts);
  await drain();
  return up.id;
}
async function activate(id: string) {
  await confirmUpload(admin.id, id);
  await drain();
}

describe("Perfil sintético aislado", () => {
  it("solo se habilita con las tres condiciones", async () => {
    expect((await getProfiles()).map((p) => p.id)).toEqual(["sintetico-incorporar", "sintetico-sustituir"]);
    const saved = process.env.CSAPP_ENABLE_SYNTHETIC_PROFILES;
    // 1. variable ausente o distinta del nombre de la base
    delete process.env.CSAPP_ENABLE_SYNTHETIC_PROFILES;
    resetRegistryCache();
    expect(await getProfiles()).toEqual([]);
    process.env.CSAPP_ENABLE_SYNTHETIC_PROFILES = "cs_app";
    resetRegistryCache();
    expect(await getProfiles()).toEqual([]);
    // 3. sin el esquema marcador no hay perfiles aunque la variable sea correcta
    process.env.CSAPP_ENABLE_SYNTHETIC_PROFILES = saved;
    await prisma.$executeRawUnsafe(`DELETE FROM csapp_synthetic.settings WHERE key = 'marker'`);
    resetRegistryCache();
    expect(await getProfiles()).toEqual([]);
    await prisma.$executeRawUnsafe(`INSERT INTO csapp_synthetic.settings VALUES ('marker','synthetic')`);
    resetRegistryCache();
    expect((await getProfiles()).length).toBe(2);
  });

  it("rechaza una subida a un perfil no habilitado", async () => {
    await expect(uploadText(admin.id, csvText([row(1)]), { profileId: "zendesk-tickets" })).rejects.toThrow(/no está disponible/);
  });
});

describe("Flujo, contadores y duplicados", () => {
  it("tres filas con una repetida producen dos registros; preparar no toca los datos activos", async () => {
    const id = await uploadAndPrepare(csvText([row(1), row(2), row(1)]));
    let b = await batch(id);
    expect(b.status).toBe("READY");
    expect(b).toMatchObject({ rowsReceived: 3, rowsValid: 3, rowsError: 0, rowsDuplicate: 1, rowsImported: 0 });
    expect(await syntheticRecords()).toHaveLength(0); // previsualización sin efectos
    const prev = await listStagedRows(admin.id, id);
    expect(prev.total).toBe(3);
    await activate(id);
    b = await batch(id);
    expect(b.status).toBe("COMPLETED");
    expect(b.rowsImported).toBe(2);
    expect(await syntheticRecords()).toHaveLength(2);
    expect(await prisma.uploadRecordSource.count({ where: { batchId: id } })).toBe(2);
    const occ = await prisma.uploadRecordSource.findMany({ where: { batchId: id }, orderBy: { firstPosition: "asc" } });
    expect(occ.map((o) => o.occurrences)).toEqual([2, 1]);
    expect(await prisma.auditEvent.count({ where: { batchId: id } })).toBeGreaterThanOrEqual(2); // subida, confirmación, activación
  });

  it("otro lote solapado conserva dos registros y añade procedencias", async () => {
    const a = await uploadAndPrepare(csvText([row(1), row(2)]));
    await activate(a);
    const bId = await uploadAndPrepare(csvText([row(1), row(2), row(3)]));
    const b = await batch(bId);
    expect(b.rowsDuplicate).toBe(2);
    await activate(bId);
    expect(await syntheticRecords()).toHaveLength(3);
    expect(await prisma.uploadRecordSource.count({ where: { batchId: bId } })).toBe(3);
    expect((await batch(bId)).rowsImported).toBe(1);
  });

  it("subir dos veces el mismo archivo no duplica y avisa del mismo checksum", async () => {
    const text = csvText([row(1), row(2)]);
    const a = await uploadAndPrepare(text);
    await activate(a);
    const b = await uploadAndPrepare(text);
    await activate(b);
    expect(await syntheticRecords()).toHaveLength(2);
    const full = await getUpload(admin.id, b);
    expect(full?.sameChecksum.map((s) => s.id)).toContain(a);
    expect((await batch(a)).checksum).toBe((await batch(b)).checksum);
  });

  it("una clave repetida con contenido distinto es revisión, no duplicado idéntico", async () => {
    const a = await uploadAndPrepare(csvText([row(1, { 3: "10" })]));
    await activate(a);
    const bId = await uploadAndPrepare(csvText([row(1, { 3: "20" })]));
    const b = await batch(bId);
    expect(b).toMatchObject({ rowsReviewed: 1, rowsDuplicate: 0 });
    await activate(bId);
    const recs = await syntheticRecords();
    expect(recs).toHaveLength(2);
    expect(recs.filter((r) => r.is_current).map((r) => r.importe)).toEqual(["20"]);
    expect((await batch(bId)).rowsImported).toBe(1);
    // revertir la revisión devuelve la vigencia al contenido anterior
    await revertUpload(admin.id, bId);
    await drain();
    const after = await syntheticRecords();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ importe: "10", is_current: true });
  });

  it("la huella no depende del orden de claves, el lote ni la posición", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: null }] })).toBe('{"a":[2,{"c":null,"d":1}],"b":1}');
    expect(rowFingerprint({ x: "1", y: "2" })).toBe(rowFingerprint({ y: "2", x: "1" }));
  });
});

describe("Validación de archivos", () => {
  it("cabecera equivocada → rechazado y no se puede confirmar", async () => {
    const id = await uploadAndPrepare("a,b,c\n1,2,3\n");
    const b = await batch(id);
    expect(b.status).toBe("REJECTED");
    expect(b.statusDetail).toMatch(/cabeceras/);
    await expect(confirmUpload(admin.id, id)).rejects.toBeInstanceOf(DomainError);
    expect(await syntheticRecords()).toHaveLength(0);
  });

  it("archivo vacío y archivo binario con extensión csv/xlsx → rechazados por contenido", async () => {
    const empty = await uploadAndPrepare("");
    expect((await batch(empty)).status).toBe("REJECTED");
    const fakeXlsx = await uploadAndPrepare(csvText([row(1)]), { name: "libro.xlsx" });
    const b = await batch(fakeXlsx);
    expect(b.status).toBe("REJECTED");
    expect(b.statusDetail).toMatch(/XLSX/);
    const fakeCsv = await uploadAndPrepare(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x01]) as unknown as string, { name: "x.csv" });
    expect((await batch(fakeCsv)).status).toBe("REJECTED");
  });

  it("UTF-8 con BOM, campos entre comillas con comas y saltos interiores se conservan", async () => {
    const id = await uploadAndPrepare(csvText([row(1, { 1: 'Ñandú, "el grande"\nsegunda línea' }), row(2)], { bom: true }));
    expect((await batch(id)).status).toBe("READY");
    const rows = await listStagedRows(admin.id, id);
    const first = rows.rows[0];
    expect((first.typed as { nombre: string }).nombre).toBe('Ñandú, "el grande" segunda línea'.replace(/\s+/g, " "));
    expect((first.raw as [string, string][])[1][0]).toBe('Ñandú, "el grande"\nsegunda línea'); // el bruto se conserva
    await activate(id);
    expect((await syntheticRecords())[0].name).toContain("Ñandú");
  });

  it("filas inválidas se clasifican, no se activan y las válidas sí", async () => {
    const id = await uploadAndPrepare(
      csvText([row(1), row(2, { 2: "31/02/2026" }), row(3, { 3: "abc" }), row(4, { 4: "SIN-RELACION" }), row(5, { 1: "" })]),
    );
    const b = await batch(id);
    expect(b).toMatchObject({ rowsReceived: 5, rowsError: 2, rowsValid: 3, rowsExcluded: 1, rowsWarning: 2 });
    const errors = await listStagedRows(admin.id, id, { classification: "ERROR" });
    expect(errors.total).toBe(2);
    await activate(id);
    expect((await syntheticRecords()).map((r) => r.entity_key)).toEqual(["ID1", "ID5"]);
    expect((await batch(id)).rowsImported).toBe(2);
  });

  it("XLSX con cabeceras válidas pero sin dimensión se lee y se activa", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "csapp-x-")), "libro.xlsx");
    await writeXlsx(file, {
      dimension: false,
      sheets: [{ name: "Datos", rows: [["id", "nombre", "fecha", "importe", "categoria"], ["X1", "Uno", { date: 46100 }, 12.5, "alfa"], ["X2", "Dos", "2026-01-02", 3, "beta"]] }],
    });
    const id = await uploadAndPrepare(readFileSync(file) as unknown as string, { name: "libro.xlsx" });
    const b = await batch(id);
    expect(b.status).toBe("READY");
    expect(b.rowsReceived).toBe(2);
    await activate(id);
    expect(await syntheticRecords()).toHaveLength(2);
  });

  it("una subida incompleta no se procesa como completa", async () => {
    const stream = new Readable({
      read() {
        this.push("id,nombre,fecha,importe,categoria\nA,B,2026-01-01,1,x\n");
        this.destroy(new Error("conexión cortada"));
      },
    });
    await expect(
      receiveUpload(admin.id, { profileId: "sintetico-incorporar", originalName: "x.csv", metadata: {}, declared: {}, contentLength: null, body: stream }),
    ).rejects.toThrow(/interrumpió/);
    const b = await prisma.uploadBatch.findFirstOrThrow();
    expect(b.status).toBe("REJECTED");
    expect(b.statusDetail).toMatch(/incompleta/);
    expect(await prisma.uploadJob.count()).toBe(0);
    expect(await listDir("incoming")).toEqual([]);
    expect(await listDir("files")).toEqual([]);
  });

  it("el mantenimiento rechaza subidas RECEIVING caducadas", async () => {
    const stale = await prisma.uploadBatch.create({
      data: { profileId: "sintetico-incorporar", profileVersion: 1, status: "RECEIVING", originalName: "x.csv", storageId: "00000000-0000-4000-8000-000000000001", fileFormat: "csv", createdById: admin.id, createdAt: new Date(Date.now() - 3 * 3600_000) },
    });
    expect(await maintenance()).toBe(1);
    expect((await batch(stale.id)).status).toBe("REJECTED");
  });

  it("metadatos y extracción declarada se guardan separados de la carga y se validan", async () => {
    const up = await uploadText(admin.id, csvText([row(1)]), { declared: { extraccion: "2026-10-01", desde: "2026-01-01", hasta: "2026-09-30", cobertura: "Enero a septiembre" } });
    const b = await batch(up.id);
    expect(b.declaredExtractionDate?.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(b.declaredFrom?.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(b.coverageNote).toBe("Enero a septiembre");
    expect(b.createdAt.getTime()).toBeGreaterThan(b.declaredExtractionDate!.getTime());
    await expect(uploadText(admin.id, csvText([row(1)]), { declared: { desde: "2026-05-01", hasta: "2026-01-01" } })).rejects.toBeInstanceOf(DomainError);
    await expect(uploadText(admin.id, csvText([row(1)]), { profileId: "sintetico-sustituir" })).rejects.toThrow(/ámbito/i);
  });
});

describe("Máquina de estados y acciones", () => {
  it("las acciones inválidas se rechazan y el cliente no fuerza estados", async () => {
    const up = await uploadText(admin.id, csvText([row(1)]));
    await expect(confirmUpload(admin.id, up.id)).rejects.toThrow(/QUEUED/); // aún en cola
    await expect(revertUpload(admin.id, up.id)).rejects.toThrow(/completado/);
    await drain();
    await expect(revertUpload(admin.id, up.id)).rejects.toThrow(/completado/);
    await confirmUpload(admin.id, up.id);
    await expect(confirmUpload(admin.id, up.id)).rejects.toThrow(/ACTIVATION_QUEUED/);
    await drain();
    await expect(cancelUpload(admin.id, up.id)).rejects.toThrow(/ya no admite/);
    await expect(reprocessUpload(admin.id, up.id)).rejects.toThrow(/Revertir/);
    const info = await getUpload(admin.id, up.id);
    expect(info?.actions.revert.allowed).toBe(true);
    expect(info?.actions.confirm.allowed).toBe(false);
  });

  it("cancelar durante la activación se explica y no cancela", async () => {
    const id = await uploadAndPrepare(csvText([row(1)]));
    await prisma.uploadBatch.update({ where: { id }, data: { status: "ACTIVATING" } });
    await expect(cancelUpload(admin.id, id)).rejects.toThrow(/transacción atómica/);
    expect((await batch(id)).status).toBe("ACTIVATING");
  });

  it("la cancelación previa no activa nada", async () => {
    const id = await uploadAndPrepare(csvText([row(1), row(2)]));
    await confirmUpload(admin.id, id);
    await cancelUpload(admin.id, id); // aún en cola de activación
    await drain();
    expect((await batch(id)).status).toBe("CANCELLED");
    expect(await syntheticRecords()).toHaveLength(0);
    expect(await prisma.uploadJob.count({ where: { status: "PENDING" } })).toBe(0);
    await expect(confirmUpload(admin.id, id)).rejects.toBeInstanceOf(DomainError);
  });

  it("la cancelación solicitada durante la preparación detiene el trabajo", async () => {
    const up = await uploadText(admin.id, csvText([row(1), row(2)]));
    await prisma.uploadBatch.update({ where: { id: up.id }, data: { status: "PREPARING" } });
    await cancelUpload(admin.id, up.id);
    expect((await batch(up.id)).cancelRequested).toBe(true);
    await drain();
    expect((await batch(up.id)).status).toBe("CANCELLED");
  });

  it("doble confirmación concurrente produce un solo trabajo y un solo efecto", async () => {
    const id = await uploadAndPrepare(csvText([row(1), row(2)]));
    const results = await Promise.allSettled([confirmUpload(admin.id, id), confirmUpload(admin.id, id), confirmUpload(admin.id, id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.uploadJob.count({ where: { batchId: id, kind: "ACTIVATE" } })).toBe(1);
    await drain();
    expect(await syntheticRecords()).toHaveLength(2);
  });

  it("confirmar con una versión obsoleta falla sin cambios", async () => {
    const id = await uploadAndPrepare(csvText([row(1)]));
    const b = await batch(id);
    await expect(confirmUpload(admin.id, id, { expectedVersion: b.version - 1 })).rejects.toThrow(/modificado/);
    expect((await batch(id)).status).toBe("READY");
  });
});

describe("Activación atómica, trabajadores y fencing", () => {
  it("dos trabajadores concurrentes activan el lote una sola vez", async () => {
    const id = await uploadAndPrepare(csvText([row(1), row(2), row(3)]));
    await confirmUpload(admin.id, id);
    const [a, b] = await Promise.all([runOnce("w1"), runOnce("w2")]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect((await batch(id)).status).toBe("COMPLETED");
    expect(await syntheticRecords()).toHaveLength(3);
    expect(await prisma.uploadRecordSource.count({ where: { batchId: id } })).toBe(3);
  });

  it("reclamación exclusiva: cada trabajo lo recibe un único trabajador", async () => {
    for (let i = 0; i < 5; i++) await uploadText(admin.id, csvText([row(i + 1)]));
    const claims = await Promise.all(Array.from({ length: 12 }, (_, i) => claimNextJob(`w${i}`)));
    const got = claims.filter(Boolean);
    expect(got).toHaveLength(5);
    expect(new Set(got.map((j) => j!.id)).size).toBe(5);
  });

  it("un fallo durante la activación deshace todo y conserva el estado activo anterior; no hay bucles infinitos", async () => {
    process.env.CSAPP_WORKER_MAX_ATTEMPTS = "2";
    try {
      const a = await uploadAndPrepare(csvText([row(1), row(2)]));
      await activate(a);
      const before = await syntheticRecords();
      const b = await uploadAndPrepare(csvText([row(3), row(4)]));
      await prisma.$executeRawUnsafe(`ALTER TABLE csapp_synthetic.record RENAME TO record_roto`);
      try {
        await confirmUpload(admin.id, b);
        await drain();
        await new Promise((r) => setTimeout(r, 20));
        await drain();
        await new Promise((r) => setTimeout(r, 20));
        await drain();
      } finally {
        await prisma.$executeRawUnsafe(`ALTER TABLE csapp_synthetic.record_roto RENAME TO record`);
      }
      const fb = await batch(b);
      expect(fb.status).toBe("FAILED");
      expect(await prisma.uploadRecordSource.count({ where: { batchId: b } })).toBe(0);
      expect(await syntheticRecords()).toEqual(before);
      const job = await prisma.uploadJob.findFirstOrThrow({ where: { batchId: b, kind: "ACTIVATE" } });
      expect(job.status).toBe("FAILED");
      expect(job.attempts).toBe(2);
      // se puede reprocesar el lote fallido desde su propio bruto y activarlo después
      process.env.CSAPP_WORKER_MAX_ATTEMPTS = "3";
      await reprocessUpload(admin.id, b);
      await drain();
      await activate(b);
      expect(await syntheticRecords()).toHaveLength(4);
    } finally {
      delete process.env.CSAPP_WORKER_MAX_ATTEMPTS;
    }
  });

  it("un trabajador antiguo que perdió el trabajo no puede confirmar", async () => {
    process.env.CSAPP_WORKER_LEASE_MS = "100";
    try {
      const up = await uploadText(admin.id, csvText([row(1), row(2)]));
      const old = await claimNextJob("viejo");
      expect(old?.batchId).toBe(up.id);
      await prisma.uploadJob.update({ where: { id: old!.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
      const fresh = await claimNextJob("nuevo");
      expect(fresh?.id).toBe(old!.id);
      expect(fresh!.fence).toBe(old!.fence + 1);
      await expect(prisma.$transaction((tx) => assertFence(tx, old!))).rejects.toBeInstanceOf(LostLeaseError);
      await processJob(old!, () => false); // intenta preparar con el token antiguo: no escribe
      expect(await prisma.uploadStagedRow.count({ where: { batchId: up.id } })).toBe(0);
      expect((await batch(up.id)).status).toBe("QUEUED");
      await processJob(fresh!, () => false);
      expect((await batch(up.id)).status).toBe("READY");
      expect(await prisma.uploadStagedRow.count({ where: { batchId: up.id } })).toBe(2);
    } finally {
      delete process.env.CSAPP_WORKER_LEASE_MS;
    }
  });

  it("un trabajador caído que agota los intentos deja el lote en FAILED, no «en ejecución» eternamente", async () => {
    const up = await uploadText(admin.id, csvText([row(1)]));
    process.env.CSAPP_WORKER_MAX_ATTEMPTS = "1";
    try {
      await prisma.uploadJob.updateMany({ where: { batchId: up.id }, data: { maxAttempts: 1 } });
      const job = await claimNextJob("caido");
      await prisma.uploadJob.update({ where: { id: job!.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
      expect(await claimNextJob("otro")).toBeNull();
      expect((await batch(up.id)).status).toBe("FAILED");
      expect((await prisma.uploadJob.findUniqueOrThrow({ where: { id: job!.id } })).status).toBe("FAILED");
    } finally {
      delete process.env.CSAPP_WORKER_MAX_ATTEMPTS;
    }
  });

  it("si el autor deja de ser administrador, la activación falla sin efectos", async () => {
    const id = await uploadAndPrepare(csvText([row(1)]));
    await confirmUpload(admin.id, id);
    await prisma.user.update({ where: { id: admin.id }, data: { isActive: false } });
    await drain();
    expect((await batch(id)).status).toBe("FAILED");
    expect(await syntheticRecords()).toHaveLength(0);
  });
});

describe("Recuperación, reproceso, reversión y alcance", () => {
  it("la reversión respeta una fila compartida con otro lote vigente", async () => {
    const a = await uploadAndPrepare(csvText([row(1), row(2)]));
    await activate(a);
    const b = await uploadAndPrepare(csvText([row(2), row(3)]));
    await activate(b);
    expect(await syntheticRecords()).toHaveLength(3);
    await revertUpload(admin.id, a);
    await drain();
    expect((await batch(a)).status).toBe("REVERTED");
    expect((await syntheticRecords()).map((r) => r.entity_key).sort()).toEqual(["ID2", "ID3"]);
    await revertUpload(admin.id, b);
    await drain();
    expect(await syntheticRecords()).toHaveLength(0);
  });

  it("revertir en cualquier orden no elimina contribuciones vigentes", async () => {
    const a = await uploadAndPrepare(csvText([row(1), row(2)]));
    await activate(a);
    const b = await uploadAndPrepare(csvText([row(2), row(3)]));
    await activate(b);
    await revertUpload(admin.id, b);
    await drain();
    expect((await syntheticRecords()).map((r) => r.entity_key).sort()).toEqual(["ID1", "ID2"]);
  });

  it("reprocesar reutiliza el bruto sin duplicar ni impedirlo por el checksum", async () => {
    const id = await uploadAndPrepare(csvText([row(1), row(2), row(1)]));
    const sum = (await batch(id)).checksum;
    await reprocessUpload(admin.id, id);
    expect((await batch(id)).status).toBe("QUEUED");
    await drain();
    const b = await batch(id);
    expect(b).toMatchObject({ status: "READY", rowsReceived: 3, rowsDuplicate: 1, checksum: sum });
    expect(await prisma.uploadStagedRow.count({ where: { batchId: id } })).toBe(3);
    await activate(id);
    expect(await syntheticRecords()).toHaveLength(2);
  });

  it("si cambian las reglas entre previsualización y activación se revalida y no se aplica lo obsoleto", async () => {
    const id = await uploadAndPrepare(csvText([row(1)]));
    expect((await batch(id)).rulesSnapshot).toBe("1");
    await setRulesVersion("2");
    await confirmUpload(admin.id, id);
    await drain(); // la activación detecta la diferencia y devuelve el lote a preparación
    expect((await batch(id)).status).toBe("READY");
    expect((await batch(id)).rulesSnapshot).toBe("2");
    expect(await syntheticRecords()).toHaveLength(0);
    expect(await prisma.auditEvent.count({ where: { batchId: id, action: "REPROCESS" } })).toBe(1);
    await activate(id);
    expect((await batch(id)).status).toBe("COMPLETED");
    expect(await syntheticRecords()).toHaveLength(1);
  });

  it("sustituir el ámbito A no altera B y revertir restaura el conjunto anterior", async () => {
    const mk = (ambito: string, rows: string[][]) => uploadAndPrepare(csvText(rows), { profileId: "sintetico-sustituir", metadata: { ambito } });
    const a1 = await mk("A", [row(1), row(2)]);
    await activate(a1);
    const b1 = await mk("B", [row(10), row(11)]);
    await activate(b1);
    const a2 = await mk("A", [row(3)]);
    await activate(a2);
    expect((await scopedRecords("A")).map((r) => r.entity_key)).toEqual(["ID3"]);
    expect((await scopedRecords("B")).map((r) => r.entity_key)).toEqual(["ID10", "ID11"]);
    expect((await batch(a1)).supersededByBatchId).toBe(a2);
    await expect(revertUpload(admin.id, a1)).rejects.toThrow(/sustituido/);
    await revertUpload(admin.id, a2);
    await drain();
    expect((await scopedRecords("A")).map((r) => r.entity_key).sort()).toEqual(["ID1", "ID2"]);
    expect((await scopedRecords("B")).map((r) => r.entity_key)).toEqual(["ID10", "ID11"]);
    expect((await batch(a1)).supersededByBatchId).toBeNull();
  });

  it("un fallo en una sustitución conserva el conjunto activo anterior del ámbito", async () => {
    process.env.CSAPP_WORKER_MAX_ATTEMPTS = "1";
    try {
      const a1 = await uploadAndPrepare(csvText([row(1), row(2)]), { profileId: "sintetico-sustituir", metadata: { ambito: "A" } });
      await activate(a1);
      const a2 = await uploadAndPrepare(csvText([row(3)]), { profileId: "sintetico-sustituir", metadata: { ambito: "A" } });
      await prisma.$executeRawUnsafe(`ALTER TABLE csapp_synthetic.scoped ADD CONSTRAINT solo_dos CHECK (batch_id <> '${a2}')`);
      await confirmUpload(admin.id, a2);
      await drain();
      expect((await batch(a2)).status).toBe("FAILED");
      expect((await scopedRecords("A")).map((r) => r.entity_key)).toEqual(["ID1", "ID2"]);
      expect((await batch(a1)).supersededByBatchId).toBeNull();
    } finally {
      delete process.env.CSAPP_WORKER_MAX_ATTEMPTS;
    }
  });
});

describe("Permisos en servicios", () => {
  it("Consulta no sube, confirma, cancela, revierte ni lista cargas, sin efectos", async () => {
    const id = await uploadAndPrepare(csvText([row(1)]));
    await expect(uploadText(reader.id, csvText([row(1)]))).rejects.toBeInstanceOf(AccessError);
    await expect(confirmUpload(reader.id, id)).rejects.toBeInstanceOf(AccessError);
    await expect(cancelUpload(reader.id, id)).rejects.toBeInstanceOf(AccessError);
    await expect(reprocessUpload(reader.id, id)).rejects.toBeInstanceOf(AccessError);
    await expect(revertUpload(reader.id, id)).rejects.toBeInstanceOf(AccessError);
    await expect(listUploads(reader.id)).rejects.toBeInstanceOf(AccessError);
    await expect(listStagedRows(reader.id, id)).rejects.toBeInstanceOf(AccessError);
    expect(await prisma.uploadBatch.count()).toBe(1);
    expect((await batch(id)).status).toBe("READY");
    expect(await listDir("files")).toHaveLength(1);
  });
});

describe("Límites", () => {
  it("un archivo mayor que el máximo se rechaza en streaming sin dejar basura", async () => {
    process.env.CSAPP_UPLOAD_MAX_BYTES = "500";
    try {
      const big = csvText(Array.from({ length: 100 }, (_, i) => row(i)));
      await expect(
        receiveUpload(admin.id, { profileId: "sintetico-incorporar", originalName: "x.csv", metadata: {}, declared: {}, contentLength: null, body: Readable.from([Buffer.from(big)]) }),
      ).rejects.toBeInstanceOf(UploadLimitError);
      expect(await listDir("incoming")).toEqual([]);
      expect(await listDir("files")).toEqual([]);
      expect(await prisma.uploadJob.count()).toBe(0);
      expect((await prisma.uploadBatch.findFirstOrThrow()).status).toBe("REJECTED");
      // con Content-Length declarado se rechaza antes de crear nada
      await prisma.uploadBatch.deleteMany();
      await expect(
        receiveUpload(admin.id, { profileId: "sintetico-incorporar", originalName: "x.csv", metadata: {}, declared: {}, contentLength: 5000, body: Readable.from([Buffer.from(big)]) }),
      ).rejects.toThrow(/tamaño máximo/);
      expect(await prisma.uploadBatch.count()).toBe(0);
    } finally {
      delete process.env.CSAPP_UPLOAD_MAX_BYTES;
    }
  });

  it("limita las subidas simultáneas con un mensaje claro", async () => {
    process.env.CSAPP_UPLOAD_MAX_CONCURRENT = "1";
    try {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const slow = new Readable({ read() {} });
      const first = receiveUpload(admin.id, { profileId: "sintetico-incorporar", originalName: "a.csv", metadata: {}, declared: {}, contentLength: null, body: slow });
      await new Promise((r) => setTimeout(r, 300));
      await expect(uploadText(admin.id, csvText([row(1)]))).rejects.toBeInstanceOf(UploadBusyError);
      slow.push(Buffer.from(csvText([row(1)])));
      slow.push(null);
      release();
      await gate;
      await first;
    } finally {
      delete process.env.CSAPP_UPLOAD_MAX_CONCURRENT;
    }
  });
});

describe("Listados paginados", () => {
  it("el historial se pagina y filtra", async () => {
    for (let i = 0; i < 7; i++) await uploadText(admin.id, csvText([row(i + 1)]));
    const p1 = await listUploads(admin.id, { page: 1, pageSize: 5 });
    expect(p1).toMatchObject({ total: 7, pageCount: 2 });
    expect(p1.rows).toHaveLength(5);
    expect((await listUploads(admin.id, { status: "READY" })).total).toBe(0);
    await drain();
    expect((await listUploads(admin.id, { status: "READY" })).total).toBe(7);
  });
});

