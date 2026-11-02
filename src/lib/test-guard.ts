/**
 * Guard central de pruebas (CSAPP-07 §3). Toda operación que muta datos con fines de prueba (E2E, restablecimientos, fixtures, benchmarks,
 * migraciones de test) pasa por aquí. Reglas:
 *  1. Destino autorizado EXPLÍCITO: `TEST_DATABASE_URL` obligatoria; el nombre sale del PATH de la URL (nunca de la contraseña ni de la query),
 *     debe ser `cs_app…_test` y distinto de la base de trabajo (`DATABASE_URL`) en host, puerto y nombre.
 *  2. El destino se comprueba también en la CONEXIÓN QUE EJECUTA la operación (`current_database()`), dentro de la misma transacción:
 *     validar A y borrar B queda prohibido por código.
 *  3. Un fallo se produce ANTES de cualquier DDL, TRUNCATE, siembra, cuenta o migración de prueba, y no modifica nada.
 * Sin dependencias de servidor ni de la base: se puede importar antes que cualquier singleton.
 */
export const TEST_DB_PATTERN = /^cs_app(_[a-z0-9]+)*_test$/;
export const APPROVED_ENV = "CSAPP_APPROVED_TEST_DB";

export class TestGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestGuardError";
  }
}

export type DbTarget = { host: string; port: string; name: string };

/** Destino (host, puerto, base) de una URL; el nombre sale SOLO del path. null si no es una URL postgresql:// bien formada. */
export function parseTarget(url: string): DbTarget | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") return null;
    if (!u.hostname) return null;
    const name = decodeURIComponent(u.pathname.replace(/^\//, ""));
    if (name === "" || name.includes("/")) return null;
    return { host: u.hostname.toLowerCase(), port: u.port || "5432", name };
  } catch {
    return null;
  }
}

export const sameTarget = (a: DbTarget, b: DbTarget): boolean => a.host === b.host && a.port === b.port && a.name === b.name;
export const describeTarget = (t: DbTarget): string => `${t.host}:${t.port}/${t.name}`;

/** Parámetros de conexión que pueden redirigir la sesión a otra base o servidor: no se admiten en un destino de pruebas. */
const FORBIDDEN_PARAMS = ["host", "hostaddr", "port", "dbname", "database", "service", "options", "user", "target_session_attrs"];

export type ApprovedTarget = { url: string; target: DbTarget };

/** Resuelve y valida el destino de pruebas. Lanza `TestGuardError` sin tocar nada. */
export function resolveTestTarget(env: Record<string, string | undefined> = process.env): ApprovedTarget {
  const url = env.TEST_DATABASE_URL;
  if (!url) throw new TestGuardError("Falta TEST_DATABASE_URL: las pruebas que mutan datos exigen una base aislada explícita (p. ej. cs_app_test).");
  const target = parseTarget(url);
  if (!target) throw new TestGuardError("TEST_DATABASE_URL no es una URL postgresql://usuario:clave@host:puerto/base válida.");
  if (!TEST_DB_PATTERN.test(target.name)) {
    throw new TestGuardError(`TEST_DATABASE_URL debe apuntar a una base cuyo nombre sea cs_app…_test. Recibido: ${target.name}.`);
  }
  const u = new URL(url);
  for (const k of FORBIDDEN_PARAMS) {
    if (u.searchParams.has(k)) throw new TestGuardError(`TEST_DATABASE_URL no admite el parámetro «${k}»: podría redirigir la conexión a otra base.`);
  }
  // Ya activado (DATABASE_URL se fijó al destino aprobado tras superar esta misma comprobación): no se re-compara consigo mismo.
  const activated = env[APPROVED_ENV] === target.name;
  if (env.DATABASE_URL && !activated) {
    const work = parseTarget(env.DATABASE_URL);
    if (work && sameTarget(work, target)) throw new TestGuardError("TEST_DATABASE_URL no puede ser la misma base que DATABASE_URL (la de trabajo).");
    if (work && work.name === target.name) throw new TestGuardError("TEST_DATABASE_URL y DATABASE_URL no pueden compartir el nombre de la base.");
  }
  return { url, target };
}

/**
 * Fija el entorno de pruebas ANTES de importar ningún singleton: la aplicación, el cliente de preparación y los procesos web/trabajador
 * de test apuntan al MISMO destino aprobado. Si un cliente ya se creó apuntando a otra base (importación anticipada), falla.
 */
export function activateTestTarget(env: Record<string, string | undefined> = process.env): ApprovedTarget {
  const approved = resolveTestTarget(env);
  assertNoForeignClient(approved.target);
  env.DATABASE_URL = approved.url;
  env[APPROVED_ENV] = approved.target.name;
  return approved;
}

type ClientRegistry = { prismaTarget?: DbTarget };

/** Registra el destino del cliente global al crearlo (lo llama `src/lib/db.ts`). */
export function registerClientTarget(target: DbTarget | null): void {
  if (target) (globalThis as unknown as ClientRegistry).prismaTarget = target;
}

/** Falla si ya existe un cliente global conectado a un destino distinto del aprobado. */
export function assertNoForeignClient(approved: DbTarget): void {
  const existing = (globalThis as unknown as ClientRegistry).prismaTarget;
  if (existing && !sameTarget(existing, approved)) {
    throw new TestGuardError(
      `Importación anticipada: ya hay un cliente conectado a ${describeTarget(existing)} y el destino de pruebas es ${describeTarget(approved)}. ` +
        "Establezca el entorno de pruebas antes de importar módulos que abran la conexión.",
    );
  }
}

/** Comprueba que dos URL (cliente validado, preparación, procesos hijos) apuntan al mismo destino. */
export function assertSameDatabase(a: string, b: string, label = "El proceso"): void {
  const x = parseTarget(a);
  const y = parseTarget(b);
  if (!x || !y || !sameTarget(x, y)) throw new TestGuardError(`${label} no apunta al destino de pruebas aprobado.`);
}

// ---------------------------------------------------------------- Conexión efectiva

/** Lo mínimo que se pide a un cliente: una consulta, y (para operaciones destructivas) una transacción con la misma conexión. */
export type Probe = { $queryRawUnsafe<T = unknown>(sql: string): Promise<T> };
export type TxRunner<T extends Probe> = { $transaction<R>(fn: (tx: T) => Promise<R>): Promise<R> } & Probe;

/** `current_database()` de la conexión QUE EJECUTARÁ la operación contra el destino aprobado. No modifica nada. */
export async function assertConnectedTo(conn: Probe, expectedName: string): Promise<void> {
  let rows: { db: string }[];
  try {
    rows = await conn.$queryRawUnsafe<{ db: string }[]>("SELECT current_database() AS db");
  } catch {
    throw new TestGuardError("No se pudo comprobar la base de la conexión (current_database()): no se ejecuta ninguna operación.");
  }
  const actual = rows?.[0]?.db;
  if (actual !== expectedName) {
    throw new TestGuardError(`La conexión está en la base «${actual ?? "(desconocida)"}» y el destino de pruebas autorizado es «${expectedName}»: no se ejecuta ninguna operación.`);
  }
  if (!TEST_DB_PATTERN.test(actual)) throw new TestGuardError(`La conexión efectiva «${actual}» no es una base de pruebas.`);
}

/**
 * Ejecuta `fn` en UNA transacción cuya primera sentencia es la comprobación de `current_database()`. Todo lo destructivo debe ir dentro.
 * Si el cliente no está en el destino aprobado, `fn` no se ejecuta.
 */
export async function withGuardedConnection<T extends Probe, R>(client: TxRunner<T>, approved: ApprovedTarget | string, fn: (tx: T) => Promise<R>): Promise<R> {
  const name = typeof approved === "string" ? approved : approved.target.name;
  if (!TEST_DB_PATTERN.test(name)) throw new TestGuardError("El destino indicado no es una base de pruebas.");
  return client.$transaction(async (tx) => {
    await assertConnectedTo(tx, name);
    return fn(tx);
  });
}

type Exec = Probe & { $executeRawUnsafe(sql: string): Promise<unknown> };

/** Vacía todas las tablas públicas (salvo el historial de migraciones) de la base de pruebas aprobada; nunca de otra. */
export async function guardedTruncateAll<T extends Exec>(client: TxRunner<T>, approved: ApprovedTarget | string): Promise<void> {
  await withGuardedConnection(client, approved, async (tx) => {
    const tables = await tx.$queryRawUnsafe<{ tablename: string }[]>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'");
    if (tables.length === 0) return;
    await tx.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  });
}

/** Vacía las tablas indicadas (nombres tomados de código, nunca de entrada) con la misma comprobación. */
export async function guardedTruncate<T extends Exec>(client: TxRunner<T>, approved: ApprovedTarget | string, tables: readonly string[]): Promise<void> {
  if (tables.some((t) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(t))) throw new TestGuardError("Nombre de tabla no válido.");
  await withGuardedConnection(client, approved, async (tx) => {
    await tx.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  });
}
