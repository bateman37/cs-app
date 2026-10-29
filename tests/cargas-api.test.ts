import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { POST as upload } from "@/app/api/cargas/route";
import { GET as estado } from "@/app/api/cargas/[id]/estado/route";
import { GET as archivo } from "@/app/api/cargas/[id]/archivo/route";
import { listDir, filePath } from "@/server/uploads/storage";
import { drain, freshEnvironment, metaHeader, removeUploadDir, useUploadDir } from "./cargas-helpers";
import { csvText, row } from "./synthetic/data";

let dir: string;
beforeAll(() => {
  dir = useUploadDir();
});
afterAll(() => removeUploadDir(dir));
beforeEach(async () => {
  await freshEnvironment();
});

const ORIGIN = "http://localhost:3000";

async function sessionCookie(email: string, password: string): Promise<string> {
  const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]);
  expect(cookies.length).toBeGreaterThan(0);
  return cookies.join("; ");
}

function uploadRequest(cookie: string | null, body: string, over: Record<string, string> = {}): Request {
  const headers: Record<string, string> = {
    origin: ORIGIN,
    "content-type": "application/octet-stream",
    "x-csapp-perfil": "sintetico-incorporar",
    "x-csapp-nombre": encodeURIComponent("datos.csv"),
    "x-csapp-metadatos": metaHeader({}, { extraccion: "2026-10-01" }),
    ...over,
  };
  if (cookie) headers.cookie = cookie;
  return new Request("http://localhost:3000/api/cargas", { method: "POST", headers, body });
}

async function nothingHappened() {
  expect(await prisma.uploadBatch.count()).toBe(0);
  expect(await prisma.uploadJob.count()).toBe(0);
  expect(await prisma.auditEvent.count()).toBe(0);
  expect(await listDir("files")).toEqual([]);
  expect(await listDir("incoming")).toEqual([]);
}

describe("API de cargas: permisos antes de cualquier efecto", () => {
  it("sin sesión → 401; cookie falsa → 401; Consulta → 403; sin origen → 403; sin efectos", async () => {
    const csv = csvText([row(1)]);
    expect((await upload(uploadRequest(null, csv))).status).toBe(401);
    expect((await upload(uploadRequest("better-auth.session_token=falsa.firma", csv))).status).toBe(401);
    const reader = await sessionCookie("lectura@test.local", "clave-de-prueba-456");
    expect((await upload(uploadRequest(reader, csv))).status).toBe(403);
    const admin = await sessionCookie("admin@test.local", "clave-de-prueba-123");
    expect((await upload(uploadRequest(admin, csv, { origin: "http://otro.example" }))).status).toBe(403);
    const sinOrigen = uploadRequest(admin, csv);
    sinOrigen.headers.delete("origin");
    expect((await upload(sinOrigen)).status).toBe(403);
    await nothingHappened();
  });

  it("Administrador sube, el trabajador prepara y activa; se puede sondear y descargar el original", async () => {
    const admin = await sessionCookie("admin@test.local", "clave-de-prueba-123");
    const csv = csvText([row(1), row(2), row(1)]);
    const res = await upload(uploadRequest(admin, csv));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const b = await prisma.uploadBatch.findUniqueOrThrow({ where: { id } });
    expect(b.status).toBe("QUEUED");
    expect(b.checksum).toHaveLength(64);
    expect(Number(b.sizeBytes)).toBe(Buffer.byteLength(csv));
    expect(readFileSync(filePath(b.storageId), "utf8")).toBe(csv);
    await drain();
    const st = await estado(new Request("http://localhost:3000/x", { headers: { cookie: admin } }), { params: Promise.resolve({ id }) });
    expect(st.status).toBe(200);
    expect(await st.json()).toMatchObject({ status: "READY", rowsReceived: 3, rowsDuplicate: 1, terminal: false });
    const dl = await archivo(new Request("http://localhost:3000/x", { headers: { cookie: admin } }), { params: Promise.resolve({ id }) });
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-disposition")).toContain("attachment");
    expect(await dl.text()).toBe(csv);
  });

  it("estado y descarga exigen Administrador: Consulta, sin sesión y cookie falsa no leen", async () => {
    const admin = await sessionCookie("admin@test.local", "clave-de-prueba-123");
    const res = await upload(uploadRequest(admin, csvText([row(1)])));
    const { id } = (await res.json()) as { id: string };
    const reader = await sessionCookie("lectura@test.local", "clave-de-prueba-456");
    for (const handler of [estado, archivo]) {
      for (const [cookie, code] of [[reader, 403], [null, 401], ["better-auth.session_token=x.y", 401]] as const) {
        const h: Record<string, string> = cookie ? { cookie } : {};
        const r = await handler(new Request("http://localhost:3000/x", { headers: h }), { params: Promise.resolve({ id }) });
        expect(r.status).toBe(code);
        expect(await r.text()).not.toContain("Nombre");
      }
    }
  });

  it("una carga mayor que el máximo con Content-Length declarado → 413 sin efectos", async () => {
    process.env.CSAPP_UPLOAD_MAX_BYTES = "100";
    try {
      const admin = await sessionCookie("admin@test.local", "clave-de-prueba-123");
      const big = csvText(Array.from({ length: 50 }, (_, i) => row(i)));
      const r = await upload(uploadRequest(admin, big, { "content-length": String(Buffer.byteLength(big)) }));
      expect(r.status).toBe(413);
      expect(((await r.json()) as { error: string }).error).toMatch(/tamaño máximo/);
      await nothingHappened();
    } finally {
      delete process.env.CSAPP_UPLOAD_MAX_BYTES;
    }
  });

  it("perfil inexistente, formato o metadatos inválidos → 400 sin efectos", async () => {
    const admin = await sessionCookie("admin@test.local", "clave-de-prueba-123");
    const csv = csvText([row(1)]);
    expect((await upload(uploadRequest(admin, csv, { "x-csapp-perfil": "no-existe" }))).status).toBe(400);
    expect((await upload(uploadRequest(admin, csv, { "x-csapp-nombre": encodeURIComponent("datos.pdf") }))).status).toBe(400);
    expect((await upload(uploadRequest(admin, csv, { "x-csapp-metadatos": "%%%" }))).status).toBe(400);
    expect((await upload(uploadRequest(admin, csv, { "x-csapp-perfil": "sintetico-sustituir" }))).status).toBe(400);
    // un nombre con ruta no se usa para almacenar: se sanea y el archivo va a un identificador interno
    const ok = await upload(uploadRequest(admin, csv, { "x-csapp-nombre": encodeURIComponent("../../etc/passwd.csv") }));
    expect(ok.status).toBe(201);
    const b = await prisma.uploadBatch.findFirstOrThrow();
    expect(b.originalName).toBe("passwd.csv");
    expect(b.storageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await prisma.uploadBatch.count()).toBe(1);
  });
});
