import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as upload } from "@/app/api/cargas/route";
import { GET as estado } from "@/app/api/cargas/[id]/estado/route";
import { GET as archivo } from "@/app/api/cargas/[id]/archivo/route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AccessError } from "@/lib/access";
import { confirmUpload, reprocessUpload, revertUpload, cancelUpload, listStagedRows } from "@/server/uploads/batches";
import { decideTimeCorrection } from "@/server/zendesk/corrections";
import { getTicketDetail, listBatchTickets, listBatchTimes, listCorrectionCandidates, ticketsSummary, timesSummary } from "@/server/zendesk/summary";
import { drain, freshEnvironment, metaHeader, removeUploadDir, useUploadDir } from "./cargas-helpers";
import { ticket, ticketsBuffer, timeRow, timesBuffer } from "./generators/zendesk";
import { count, importZd, prepareZd, TICKETS, TIEMPO } from "./zendesk-helpers";

let dir: string;
let admin: { id: string };
let reader: { id: string };
beforeAll(() => { dir = useUploadDir(); });
afterAll(() => removeUploadDir(dir));
beforeEach(async () => { ({ admin, reader } = await freshEnvironment()); });

const ORIGIN = "http://localhost:3000";
async function cookie(email: string, password: string) {
  const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const post = (c: string | null, body: Buffer, profile: string, name = "export.xlsx") =>
  new Request("http://localhost:3000/api/cargas", {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/octet-stream",
      "x-csapp-perfil": profile,
      "x-csapp-nombre": encodeURIComponent(name),
      "x-csapp-metadatos": metaHeader({}, { extraccion: "2026-10-01" }),
      ...(c ? { cookie: c } : {}),
    },
    body: new Uint8Array(body),
  });

describe("permisos de los importadores Zendesk (solo Administrador)", () => {
  it("la subida por API: sin sesión 401, Consulta 403 y sin efectos; el Administrador sube un XLSX de cada perfil", async () => {
    const tk = await ticketsBuffer([ticket()]);
    const tm = await timesBuffer([timeRow()]);
    const rc = await cookie("lectura@test.local", "clave-de-prueba-456");
    for (const [profile, file] of [[TICKETS, tk], [TIEMPO, tm]] as const) {
      expect((await upload(post(null, file, profile))).status).toBe(401);
      expect((await upload(post(rc, file, profile))).status).toBe(403);
    }
    expect(await count("UploadBatch")).toBe(0);
    expect(await count("UploadJob")).toBe(0);
    const ac = await cookie("admin@test.local", "clave-de-prueba-123");
    for (const [profile, file] of [[TICKETS, tk], [TIEMPO, tm]] as const) {
      const r = await upload(post(ac, file, profile));
      expect(r.status).toBe(201);
    }
    expect(await prisma.uploadBatch.count({ where: { profileId: { in: [TICKETS, TIEMPO] } } })).toBe(2);
    // Un CSV no es un formato admitido para estas fuentes (XLSX): rechazo sin efectos.
    const csv = await upload(post(ac, Buffer.from("a,b\n1,2\n"), TICKETS, "datos.csv"));
    expect(csv.status).toBe(400);
    expect(((await csv.json()) as { error: string }).error).toMatch(/XLSX/);
    expect(await count("UploadBatch")).toBe(2);
  });

  it("estado y descarga del archivo de un lote de Zendesk no se leen sin ser Administrador", async () => {
    const ac = await cookie("admin@test.local", "clave-de-prueba-123");
    const { id } = (await (await upload(post(ac, await ticketsBuffer([ticket()]), TICKETS))).json()) as { id: string };
    const rc = await cookie("lectura@test.local", "clave-de-prueba-456");
    for (const handler of [estado, archivo]) {
      for (const [c, code] of [[rc, 403], [null, 401], ["better-auth.session_token=x.y", 401]] as const) {
        const r = await handler(new Request("http://localhost:3000/x", { headers: c ? { cookie: c } : {} }), { params: Promise.resolve({ id }) });
        expect(r.status).toBe(code);
      }
    }
  });

  it("los servicios de consulta y de acción (Server Actions) rechazan a Consulta y no mutan nada", async () => {
    await importZd(admin.id, TICKETS, await ticketsBuffer([ticket()]));
    const t = await prepareZd(admin.id, TIEMPO, await timesBuffer([timeRow({ id: "1" })]));
    const tk = await prisma.uploadBatch.findFirstOrThrow({ where: { profileId: TICKETS } });
    const fp = (await prisma.uploadStagedRow.findFirstOrThrow({ where: { batchId: t.id } })).fingerprint as string;
    const before = { entries: await count("ZdTimeEntry"), tickets: await count("ZdTicket"), audits: await count("AuditEvent"), jobs: await count("UploadJob"), decisions: await count("ZdTimeDecision") };
    const calls: [string, () => Promise<unknown>][] = [
      ["ticketsSummary", () => ticketsSummary(reader.id, tk.id)],
      ["timesSummary", () => timesSummary(reader.id, t.id)],
      ["listBatchTickets", () => listBatchTickets(reader.id, tk.id)],
      ["listBatchTimes", () => listBatchTimes(reader.id, t.id)],
      ["listCorrectionCandidates", () => listCorrectionCandidates(reader.id, t.id)],
      ["getTicketDetail", () => getTicketDetail(reader.id, "1001")],
      ["listStagedRows", () => listStagedRows(reader.id, t.id)],
      ["decideTimeCorrection", () => decideTimeCorrection(reader.id, t.id, { fingerprint: fp, decision: "DIFFERENT" })],
      ["confirmUpload", () => confirmUpload(reader.id, t.id)],
      ["cancelUpload", () => cancelUpload(reader.id, t.id)],
      ["reprocessUpload", () => reprocessUpload(reader.id, tk.id)],
      ["revertUpload", () => revertUpload(reader.id, tk.id)],
    ];
    for (const [name, fn] of calls) await expect(fn(), name).rejects.toBeInstanceOf(AccessError);
    await drain();
    expect({ entries: await count("ZdTimeEntry"), tickets: await count("ZdTicket"), audits: await count("AuditEvent"), jobs: await count("UploadJob"), decisions: await count("ZdTimeDecision") }).toEqual(before);
    expect((await prisma.uploadBatch.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("READY");
  });

  it("una decisión con datos manipulados se rechaza (huella inválida, decisión desconocida, lote de otra fuente)", async () => {
    const tk = await importZd(admin.id, TICKETS, await ticketsBuffer([ticket()]));
    const t = await prepareZd(admin.id, TIEMPO, await timesBuffer([timeRow({ id: "1" })]));
    const fp = (await prisma.uploadStagedRow.findFirstOrThrow({ where: { batchId: t.id } })).fingerprint as string;
    await expect(decideTimeCorrection(admin.id, t.id, { fingerprint: "x", decision: "DIFFERENT" })).rejects.toThrow();
    await expect(decideTimeCorrection(admin.id, t.id, { fingerprint: fp, decision: "BORRAR" })).rejects.toThrow();
    await expect(decideTimeCorrection(admin.id, tk.id, { fingerprint: fp, decision: "DIFFERENT" })).rejects.toThrow(/no encontrada/);
    expect(await count("ZdTimeDecision")).toBe(0);
  });
});
