import { describe, expect, it } from "vitest";
import {
  TestGuardError,
  activateTestTarget,
  assertConnectedTo,
  assertNoForeignClient,
  assertSameDatabase,
  guardedTruncate,
  guardedTruncateAll,
  parseTarget,
  resolveTestTarget,
  withGuardedConnection,
} from "@/lib/test-guard";
import { prisma } from "@/lib/db";

/**
 * CSAPP-07 §3: prevención de pruebas sobre una base equivocada. Los rechazos se prueban con dobles controlados: NINGÚN caso negativo
 * ejecuta una operación destructiva sobre una base real. El recorrido válido sí corre contra la base `_test` aprobada.
 */
const WORK = "postgresql://u:p@localhost:5432/cs_app?schema=public";
const TEST = "postgresql://u:p@localhost:5432/cs_app_test?schema=public";

type Call = { kind: "query" | "exec" | "tx"; sql: string };
/** Doble de cliente: dice estar conectado a `db` y anota TODO lo que se le pide. */
function fakeClient(db: string, tables: string[] = ["A", "B"]) {
  const calls: Call[] = [];
  const conn = {
    async $queryRawUnsafe(sql: string) {
      calls.push({ kind: "query", sql });
      if (/current_database/.test(sql)) return [{ db }];
      if (/pg_tables/.test(sql)) return tables.map((t) => ({ tablename: t }));
      return [];
    },
    async $executeRawUnsafe(sql: string) {
      calls.push({ kind: "exec", sql });
      return 0;
    },
  };
  const client = {
    ...conn,
    async $transaction<R>(fn: (tx: typeof conn) => Promise<R>): Promise<R> {
      calls.push({ kind: "tx", sql: "BEGIN" });
      return fn(conn);
    },
  };
  return { client, calls, mutations: () => calls.filter((c) => c.kind === "exec") };
}

describe("destino de pruebas: URL y variable", () => {
  it("rechaza la variable ausente, vacía y una URL mal formada", () => {
    expect(() => resolveTestTarget({})).toThrow(TestGuardError);
    expect(() => resolveTestTarget({ TEST_DATABASE_URL: "" })).toThrow(/Falta TEST_DATABASE_URL/);
    expect(() => resolveTestTarget({ TEST_DATABASE_URL: "no-es-url" })).toThrow(/no es una URL/);
    expect(() => resolveTestTarget({ TEST_DATABASE_URL: "mysql://u:p@h/cs_app_test" })).toThrow(/no es una URL/);
  });
  it("rechaza un nombre que no acaba en _test, aunque el texto aparezca en contraseña o consulta", () => {
    expect(() => resolveTestTarget({ TEST_DATABASE_URL: WORK })).toThrow(/cs_app…_test/);
    expect(() => resolveTestTarget({ TEST_DATABASE_URL: "postgresql://u:cs_app_test@localhost:5432/cs_app" })).toThrow(/cs_app…_test/);
    expect(() => resolveTestTarget({ TEST_DATABASE_URL: "postgresql://u:p@localhost:5432/cs_app?x=cs_app_test" })).toThrow(/cs_app…_test/);
    expect(() => resolveTestTarget({ TEST_DATABASE_URL: "postgresql://u:p@localhost:5432/otra_test" })).toThrow(/cs_app…_test/);
    expect(() => resolveTestTarget({ TEST_DATABASE_URL: "postgresql://u:p@localhost:5432/cs_app_test_x" })).toThrow(/cs_app…_test/);
  });
  it("rechaza parámetros que redirigen la conexión y el mismo destino que la base de trabajo", () => {
    expect(() => resolveTestTarget({ TEST_DATABASE_URL: "postgresql://u:p@localhost:5432/cs_app_test?dbname=cs_app" })).toThrow(/dbname/);
    expect(() => resolveTestTarget({ TEST_DATABASE_URL: "postgresql://u:p@localhost:5432/cs_app_test?options=-c%20search_path" })).toThrow(/options/);
    expect(() => resolveTestTarget({ TEST_DATABASE_URL: "postgresql://u:p@localhost:5432/cs_app_test?host=otro" })).toThrow(/host/);
    expect(() => resolveTestTarget({ TEST_DATABASE_URL: TEST, DATABASE_URL: TEST })).toThrow(/misma base/);
    expect(() => resolveTestTarget({ TEST_DATABASE_URL: TEST, DATABASE_URL: "postgresql://u:p@otro:5433/cs_app_test" })).toThrow(/compartir el nombre/);
  });
  it("acepta un destino válido distinto de la base de trabajo", () => {
    const r = resolveTestTarget({ TEST_DATABASE_URL: TEST, DATABASE_URL: WORK });
    expect(r.target).toEqual({ host: "localhost", port: "5432", name: "cs_app_test" });
    expect(parseTarget("postgresql://u:p@h/a/b")).toBeNull();
  });
  it("activateTestTarget fija DATABASE_URL al destino aprobado, no antes", () => {
    const env: Record<string, string | undefined> = { TEST_DATABASE_URL: TEST, DATABASE_URL: WORK };
    activateTestTarget(env);
    expect(env.DATABASE_URL).toBe(TEST);
    expect(env.CSAPP_APPROVED_TEST_DB).toBe("cs_app_test");
    const bad: Record<string, string | undefined> = { TEST_DATABASE_URL: WORK, DATABASE_URL: WORK };
    expect(() => activateTestTarget(bad)).toThrow(TestGuardError);
    expect(bad.DATABASE_URL).toBe(WORK); // un fallo no modifica el entorno
    expect(bad.CSAPP_APPROVED_TEST_DB).toBeUndefined();
  });
});

describe("importación anticipada y procesos hijos", () => {
  it("un cliente ya conectado a otra base hace fallar el arranque de pruebas", () => {
    const g = globalThis as unknown as { prismaTarget?: unknown };
    const previous = g.prismaTarget;
    try {
      g.prismaTarget = { host: "localhost", port: "5432", name: "cs_app" };
      const env: Record<string, string | undefined> = { TEST_DATABASE_URL: TEST, DATABASE_URL: WORK };
      expect(() => activateTestTarget(env)).toThrow(/Importación anticipada/);
      expect(env.DATABASE_URL).toBe(WORK);
      expect(() => assertNoForeignClient({ host: "localhost", port: "5432", name: "cs_app" })).not.toThrow();
    } finally {
      g.prismaTarget = previous;
    }
  });
  it("web, trabajador y preparación deben compartir el destino aprobado", () => {
    expect(() => assertSameDatabase(TEST, TEST)).not.toThrow();
    expect(() => assertSameDatabase(TEST, WORK, "El trabajador")).toThrow(/El trabajador/);
    expect(() => assertSameDatabase(TEST, "postgresql://u:p@otro:5432/cs_app_test")).toThrow(TestGuardError);
  });
});

describe("la conexión efectiva se comprueba antes de mutar", () => {
  it("URL válida con cliente conectado a otra base: no se emite ninguna mutación", async () => {
    const wrong = fakeClient("cs_app");
    await expect(guardedTruncateAll(wrong.client as never, "cs_app_test")).rejects.toThrow(/«cs_app»/);
    expect(wrong.mutations()).toHaveLength(0);
    await expect(guardedTruncate(wrong.client as never, "cs_app_test", ["A"])).rejects.toThrow(TestGuardError);
    expect(wrong.mutations()).toHaveLength(0);
    // La función destructiva pasada por el llamador tampoco llega a ejecutarse.
    let ran = false;
    await expect(withGuardedConnection(wrong.client as never, "cs_app_test", async () => { ran = true; })).rejects.toThrow(TestGuardError);
    expect(ran).toBe(false);
  });
  it("un destino que no es de pruebas se rechaza antes de abrir transacción", async () => {
    const f = fakeClient("cs_app");
    await expect(guardedTruncateAll(f.client as never, "cs_app")).rejects.toThrow(/no es una base de pruebas/);
    expect(f.calls).toHaveLength(0);
    await expect(assertConnectedTo(fakeClient("cs_app").client as never, "cs_app")).rejects.toThrow(/no es una base de pruebas/);
  });
  it("si no se puede leer current_database() tampoco se muta", async () => {
    const f = fakeClient("cs_app_test");
    f.client.$queryRawUnsafe = async () => { throw new Error("sin conexión"); };
    await expect(assertConnectedTo(f.client as never, "cs_app_test")).rejects.toThrow(/No se pudo comprobar/);
  });
  it("conexión correcta: se trunca solo la base aprobada y con nombres validados", async () => {
    const ok = fakeClient("cs_app_test", ["Uno", "Dos"]);
    await guardedTruncateAll(ok.client as never, "cs_app_test");
    expect(ok.mutations().map((c) => c.sql)).toEqual([`TRUNCATE "Uno", "Dos" RESTART IDENTITY CASCADE`]);
    expect(ok.calls[1].sql).toMatch(/current_database/); // primera sentencia de la transacción
    await expect(guardedTruncate(ok.client as never, "cs_app_test", ['X"; DROP TABLE y; --'])).rejects.toThrow(/Nombre de tabla/);
  });
});

describe("recorrido válido contra la base de pruebas aislada", () => {
  it("el cliente global está conectado a la base aprobada y puede vaciarla", async () => {
    const approved = resolveTestTarget();
    await assertConnectedTo(prisma, approved.target.name);
    await guardedTruncateAll(prisma, approved);
    const [{ db }] = await prisma.$queryRawUnsafe<{ db: string }[]>("SELECT current_database() AS db");
    expect(db).toBe(approved.target.name);
    expect(db).toMatch(/_test$/);
  });
});

describe("el cliente global no se abre al importar y respeta el destino aprobado", () => {
  it("importar el módulo no crea ninguna conexión; con un entorno aprobado distinto, el primer uso se niega", async () => {
    const { vi } = await import("vitest");
    const g = globalThis as unknown as { prisma?: unknown; prismaTarget?: unknown };
    const saved = { prisma: g.prisma, prismaTarget: g.prismaTarget, url: process.env.DATABASE_URL, approved: process.env.CSAPP_APPROVED_TEST_DB };
    try {
      delete g.prisma;
      delete g.prismaTarget;
      vi.resetModules();
      // Entorno inconsistente a propósito: el destino aprobado es la base de pruebas, pero DATABASE_URL apunta a la base de trabajo.
      process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/cs_app?schema=public";
      process.env.CSAPP_APPROVED_TEST_DB = "cs_app_test";
      const mod = await import("@/lib/db"); // importación anticipada: NO debe abrir nada
      expect(g.prismaTarget).toBeUndefined();
      expect(g.prisma).toBeUndefined();
      expect(() => (mod.prisma as unknown as { user: unknown }).user).toThrow(/no se abre/); // primer uso: rechazado antes de conectar
      expect(g.prisma).toBeUndefined();
    } finally {
      g.prisma = saved.prisma;
      g.prismaTarget = saved.prismaTarget;
      process.env.DATABASE_URL = saved.url;
      if (saved.approved === undefined) delete process.env.CSAPP_APPROVED_TEST_DB;
      else process.env.CSAPP_APPROVED_TEST_DB = saved.approved;
      vi.resetModules();
    }
  });
});
