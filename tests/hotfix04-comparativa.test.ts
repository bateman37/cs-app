import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { Dec, eurosPerDay } from "@/domain/finance";
import { parseComparativaQuery } from "@/domain/comparativa-query";
import { getPortfolio } from "@/server/analytics/portfolio";
import { classifyReadError, diagnoseReadFailure, redactMessage } from "@/server/analytics/read-failure";
import { resetDatabase, makeUsers } from "./helpers";
import { addClient, addGroup, addTicket, addWrike, addZd, fakeBatch, seedFinance, serviceAssignment, setUsers } from "./economia-helpers";

/**
 * HOTFIX-04 §8 y §10 (11–13). Causa DEMOSTRADA del error «No se pudo cargar la comparativa» reproducible con la ruta de lectura compilada: una base a la que le falta
 * la migración `20261111090000_hotfix03_bandas_economicas` (columna `EconomicSettingsRevision.bandFactors`) lanza Prisma P2022 desde `getSettings`; la página lo mostraba
 * sin detalle y sin registrarlo. Con el esquema al día, ninguna forma de datos probada (Grupos sin hijos, mixtos, sin horas del mes con CUM, ingresos 0/ausentes, bandas NULL)
 * derriba la cartera.
 */
let admin: { id: string };
beforeEach(async () => {
  await resetDatabase();
  ({ admin } = await makeUsers());
});

const NOW = new Date("2026-11-04T10:00:00Z");
const Q = (extra: Record<string, string> = {}) => parseComparativaQuery({ fecha: "2026-11-04", modo: "CUTOFF", ...extra }, NOW).query;

async function withoutBandsColumn<T>(work: () => Promise<T>): Promise<T> {
  await prisma.$executeRawUnsafe('ALTER TABLE "EconomicSettingsRevision" DROP COLUMN "bandFactors"');
  try {
    return await work();
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE "EconomicSettingsRevision" ADD COLUMN "bandFactors" JSONB');
  }
}

describe("esquema sin la migración de bandas (estado HOTFIX-02 con código HOTFIX-03)", () => {
  it("la lectura falla con P2022 sobre bandFactors; se clasifica como esquema, con la migración y la acción segura, sin URL ni secretos", async () => {
    await addGroup("Alfa");
    const err = await withoutBandsColumn(() => getPortfolio(admin.id, Q()).then(() => null, (e: unknown) => e));
    expect(err).not.toBeNull();
    const c = classifyReadError(err);
    expect(c.kind).toBe("SCHEMA");
    expect(c.code).toBe("P2022");
    expect(c.migration).toBe("20261111090000_hotfix03_bandas_economicas");
    expect(c.detail.join(" ")).toContain("bandFactors");
    expect(c.action).toContain("db:migrar");
    expect(JSON.stringify(c)).not.toMatch(/postgres(ql)?:\/\//);
  });

  it("el diagnóstico del Administrador añade la compilación y las migraciones pendientes; el de consulta no", async () => {
    await addGroup("Alfa");
    await prisma.$executeRawUnsafe(`DELETE FROM "_prisma_migrations" WHERE migration_name = '20261111090000_hotfix03_bandas_economicas'`);
    const err = await withoutBandsColumn(() => getPortfolio(admin.id, Q()).then(() => null, (e: unknown) => e));
    try {
      const adminDiag = await diagnoseReadFailure("comparativa", err, true);
      expect(adminDiag.kind).toBe("SCHEMA");
      expect(adminDiag.detail.join("\n")).toMatch(/Migración esperada que falta: 20261111090000_hotfix03_bandas_economicas/);
      expect(adminDiag.detail.join("\n")).toMatch(/Migraciones pendientes en la base: .*20261111090000_hotfix03_bandas_economicas/);
      expect(adminDiag.detail.join("\n")).toMatch(/Compilación: versión/);
      const readerDiag = await diagnoseReadFailure("comparativa", err, false);
      expect(readerDiag.detail.join("\n")).not.toMatch(/Compilación|Migraciones pendientes/);
    } finally {
      // La tabla de pruebas se rehace en cada prueba (resetDatabase no toca _prisma_migrations): se restituye la fila para no alterar otras pruebas.
      await prisma.$executeRawUnsafe(`INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) SELECT gen_random_uuid()::text, 'restituida', now(), '20261111090000_hotfix03_bandas_economicas', NULL, NULL, now(), 1 WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261111090000_hotfix03_bandas_economicas')`);
    }
  });

  it("un fallo de conexión se clasifica aparte y una excepción desconocida conserva su tipo sin datos sensibles", () => {
    expect(classifyReadError(Object.assign(new Error("Can't reach database server at `localhost:5432`"), { code: "P1001" })).kind).toBe("CONNECTION");
    const u = classifyReadError(new TypeError("Cannot read properties of undefined (reading 'periods') en postgresql://admin:secreto@host/db"));
    expect(u.kind).toBe("UNKNOWN");
    expect(u.detail.join(" ")).toContain("TypeError");
    expect(u.detail.join(" ")).not.toContain("secreto");
    expect(redactMessage("fallo password=abc123 en C:\\Projects\\cs-app\\x.ts")).not.toMatch(/abc123|C:\\Projects/);
  });
});

describe("esquema al día: ninguna forma de datos derriba la página", () => {
  it("actualización desde el estado anterior: revisión con bandas NULL conserva las bandas por defecto y la cartera carga", async () => {
    const A = await addGroup("Alfa");
    await prisma.$executeRawUnsafe(`INSERT INTO "EconomicSettingsRevision" ("revisionNo", "targetEurosPerDay", "dayHours", "reconciliationTolerance", "reason", "activatedById") VALUES (1, 550, 8, 0.01, 'anterior a HOTFIX-03', '${admin.id}')`);
    expect((await prisma.$queryRawUnsafe<{ b: unknown }[]>('SELECT "bandFactors" AS b FROM "EconomicSettingsRevision"'))[0].b).toBeNull();
    const v = await getPortfolio(admin.id, Q());
    expect(v.economics.settings.customBands).toBe(false);
    expect(v.economics.settings.targetEurosPerDay).toBe("550");
    expect(v.rows.map((r) => r.meta.id)).toEqual([A.id]);
  });

  it("matrices incompletas, mes sin horas pero CUM con horas, ingresos ausentes y a cero, Grupos sin hijos y mixtos, Wrike solo Grupo, en todos los modos, estados y órdenes", async () => {
    const tb = await fakeBatch(admin.id);
    const bid = (await fakeBatch(admin.id)).id;
    await serviceAssignment({ matchKind: "ENTORNO", matchValue: "soporte", service: "SOPORTE" });
    const fin: { groupId: string | null; income: string }[] = [];
    for (let i = 0; i < 14; i++) {
      const g = await addGroup(`G${i}`);
      if (i % 5 === 4) await prisma.clientGroup.update({ where: { id: g.id }, data: { isActive: false } });
      const cs = [];
      for (let k = 0; k < i % 3; k++) cs.push(await addClient(`G${i}C${k}`, g.id, k === 1 && i % 2 === 0));
      if (i % 4 !== 0) await setUsers(admin.id, { groupId: g.id }, 2026, [i % 2 ? 0 : 10, 10, 10, null, 10, 10, 10, 10, 10, 10, i % 3 === 0 ? null : 12, 12]);
      if (i % 2 === 0) fin.push({ groupId: g.id, income: i % 6 === 0 ? "0" : "5000.50" });
      if (i % 3 !== 2) {
        await addTicket(tb.id, { ticketId: `X${i}`, org: String(800 + i), entorno: "Soporte" });
        await addZd({ batchId: bid, date: i % 2 ? "2026-03-10" : "2026-11-02", minutes: i % 7 === 0 ? 0 : 480, groupId: g.id, clientId: cs[0]?.id, ticketId: `X${i}` });
      }
      if (i % 4 === 1) await addWrike({ batchId: bid, date: "2026-11-03", minutes: 90, groupId: g.id });
    }
    await seedFinance(admin.id, "SOPORTE", 2026, fin);
    let checked = 0;
    for (const mode of ["CUTOFF", "TO_DATE", "FULL_MONTH"]) {
      for (const estado of ["activos", "inactivos", "todos"]) {
        for (const sort of ["name", "cum.perDay", "month.devTarget", "prevCum.revenue", "month.stock"]) {
          const v = await getPortfolio(admin.id, Q({ modo: mode, estado, orden: sort }));
          expect(v.totalGroups).toBe(14);
          checked++;
        }
      }
    }
    expect(checked).toBe(45);
  });
});

describe("cifra independiente (R, H y jornada)", () => {
  it("R=1.000 y H=16 con jornada 8 → 500 €/jornada; R desconocido o H=0 conservan su razón y no se fabrica un cero", () => {
    const ok = eurosPerDay(Dec.parse("1000") as Dec, Dec.parse("960") as Dec, Dec.parse("8") as Dec);
    expect(ok.ratio?.toString()).toBe("500");
    expect(ok.hours.toString()).toBe("16");
    expect(eurosPerDay(Dec.parse("1000") as Dec, Dec.ZERO, Dec.parse("8") as Dec).ratio).toBeNull();
  });
});

describe("lectura concurrente sin la revisión 1 de la configuración económica (hallazgo del recorrido de navegador)", () => {
  it("varias lecturas simultáneas de Comparativa con la tabla de revisiones vacía no fallan (la reposición de la revisión 1 no puede romper una lectura REPEATABLE READ)", async () => {
    await addGroup("Alfa");
    await prisma.$executeRawUnsafe('DELETE FROM "EconomicSettingsRevision"');
    expect(await prisma.economicSettingsRevision.count()).toBe(0);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => getPortfolio(admin.id, Q())));
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(failed.map((f) => `${(f.reason as Error).name}: ${String((f.reason as Error).message).split("\n").slice(-2).join(" ")}`)).toEqual([]);
    expect(await prisma.economicSettingsRevision.count()).toBe(1);
  });
});
