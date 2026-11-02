import { beforeAll, describe, expect, it } from "vitest";
import { parseQualityQuery } from "@/domain/quality-query";
import { evolutionIn, evolutionReferenceIn, type Evolution } from "@/server/quality/detail";
import { readSnapshot, type Tx } from "@/server/analytics/snapshot";
import { resetDatabase, makeUsers } from "./helpers";
import { EVOLUTION_CASES, FIXTURE_NOW, FIXTURE_TODAY, buildEvolutionWorld, entityIdOf, type EvolutionWorld } from "./calidad-evolucion-fixture";

/**
 * CSAPP-10 §5: la evolución mensual por CONJUNTOS (`evolutionIn`) da exactamente el mismo resultado que la de referencia de CSAPP-09 (un `computeQuality`
 * completo por mes, `evolutionReferenceIn`, solo para pruebas) sobre la misma instantánea, campo a campo: valores, estados, colores, percentiles, tamaño de
 * muestra y cortes, numeradores, denominadores, desglose, notas, cobertura, componentes, global, backlog, usuarios y CUM. Ambas leen en la MISMA transacción
 * REPEATABLE READ: mismos datos, misma revisión activa y mismo sello (la referencia de la serie también debe coincidir).
 */
let admin: { id: string };
let world: EvolutionWorld;
beforeAll(async () => {
  await resetDatabase();
  ({ admin } = await makeUsers());
  world = await buildEvolutionWorld(admin.id);
}, 120000);

const query = (params: Record<string, string>, id: string) => ({ ...parseQualityQuery({ ...params, sel: "" }, FIXTURE_NOW).query, sel: id });
const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

describe("evolución por conjuntos == evolución de referencia (09)", () => {
  for (const c of EVOLUTION_CASES) {
    it(c.name, async () => {
      const id = entityIdOf(world, c);
      const q = query(c.params, id);
      const [fast, ref] = await readSnapshot(admin.id, async (tx) => [await evolutionIn(tx, q, id, world[c.cfg], c.today), await evolutionReferenceIn(tx, q, id, world[c.cfg], c.today)] as const);
      expect(plain(fast)).toEqual(plain(ref));
      // La comparación no es vacía: el caso produce los meses esperados.
      expect(fast.points.length).toBe(c.entity === "missing" || c.params.fecha.startsWith("2026-12") ? 0 : Number(c.params.fecha.slice(5, 7)));
    });
  }
});

describe("la paridad cubre los casos pedidos (la comparación no es vacía)", () => {
  const run = (name: string) => {
    const c = EVOLUTION_CASES.find((x) => x.name === name)!;
    const id = entityIdOf(world, c);
    return readSnapshot(admin.id, (tx) => evolutionIn(tx, query(c.params, id), id, world[c.cfg], c.today));
  };
  const N3 = (ev: Evolution, i: number) => ev.points[i].indicators.N3_ESCALATIONS;

  it("mes sin cobertura: enero no es un cero confirmado (valor nulo con motivo); con cobertura desde febrero un cero SÍ es un cero confirmado", async () => {
    const ev = await run("grupo sin tickets (cero confirmado desde febrero)");
    expect(N3(ev, 0).value).toBeNull();
    expect(N3(ev, 0).reason).toMatch(/no sustentado/i);
    expect(N3(ev, 1)).toMatchObject({ value: "0", color: "green" });
  });
  it("usuarios nulos y cero confirmado se conservan por mes (sin tasas, motivos distintos)", async () => {
    const nulos = await run("grupo con usuarios nulos (mar-abr)");
    expect(nulos.points[2].users.stock).toBeNull();
    expect(N3(nulos, 2).value).toBeNull();
    const cero = await run("grupo con cero confirmado de usuarios (junio)");
    expect(cero.points[5].users.stock).toBe(0);
    expect(N3(cero, 5).value).toBeNull();
    expect(N3(cero, 5).reason).toMatch(/cero confirmado/i);
    expect(N3(nulos, 2).reason).toMatch(/sin informar/i);
  });
  it("fotografía exacta frente a anterior: cada mes conserva su fecha observada y su carácter provisional", async () => {
    const exact = await run("grupo con cobertura desde febrero, publicada");
    expect(exact.points.map((p) => p.backlog.kind)).toEqual(["NONE", "NONE", "EXACT", "NONE", "EXACT", "NONE", "NONE", "NONE", "EXACT", "EXACT"]);
    const earlier = await run("fotografía anterior dentro de 45 días (política elegida)");
    expect(earlier.points[3].backlog).toMatchObject({ kind: "EARLIER", observedOn: "2026-03-31", provisional: true, exact: false });
    expect(earlier.points[5].backlog).toMatchObject({ kind: "EARLIER", observedOn: "2026-06-15" });
    expect(earlier.points[6].backlog.kind).toBe("NONE"); // fuera de la antigüedad máxima: hueco, no relleno
  });
  it("cohorte pequeña (< muestra mínima): magnitud sin color; la muestra de cada mes es la de ESE mes", async () => {
    const ev = await run("cohorte pequeña (muestra mínima 50 > cohorte)");
    expect(N3(ev, 1).color).toBeNull();
    expect(N3(ev, 1).value).not.toBeNull();
    const pub = await run("grupo con cobertura desde febrero, publicada");
    expect(new Set(pub.points.map((p) => N3(pub, p.month - 1).sampleN)).size).toBeGreaterThan(1); // cohorte de «gold_op» distinta según el mes (vigencia por fecha)
  });
  it("borrador simulado frente a publicado: mismos datos, otra configuración; el borrador no altera la revisión activa", async () => {
    const draft = await run("borrador simulado (no publicado)");
    const pub = await run("grupo con cobertura desde febrero, publicada");
    expect(draft.series).toMatchObject({ simulated: true, qualityRevision: 2, basis: "RECALCULADA_CON_REVISION_ACTIVA" });
    expect(pub.series).toMatchObject({ simulated: false, qualityRevision: 2 });
    expect(draft.series.reference).not.toBe(pub.series.reference);
  });
  it("entidad grupo y cliente, Health fechado después del corte y global calculable", async () => {
    const cli = await run("entidad cliente (varios clientes en el grupo)");
    expect(cli.points).toHaveLength(10);
    const g = await run("grupo con usuarios nulos (mar-abr)");
    expect(g.points.some((p) => p.global.color !== null)).toBe(true);
    const h = await run("grupo con Health fechado después del corte");
    expect(h.points[2].healthState).toBe("POSITIVE"); // la celda existe, pero está fechada el 20/04: no puntúa en el corte de marzo
    expect(h.points[2].indicators.HEALTH.value).toBeNull();
    expect(h.points[2].indicators.HEALTH.color).toBeNull();
  });
});

/** Cuenta las sentencias que una función emite sobre el cliente de la transacción (consultas SQL y de modelos). */
function counting(tx: Tx): { tx: Tx; count: () => number } {
  let n = 0;
  const wrap = <T extends object>(o: T, depth: number): T =>
    new Proxy(o, {
      get(t, p, r) {
        const v = Reflect.get(t, p, r);
        if (typeof v === "function") return (...a: unknown[]) => { if (depth === 0 ? String(p).startsWith("$query") || String(p).startsWith("$execute") : true) n++; return v.apply(t, a); };
        if (depth === 0 && v && typeof v === "object" && !String(p).startsWith("$") && !String(p).startsWith("_")) return wrap(v as object, 1);
        return v;
      },
    });
  return { tx: wrap(tx, 0), count: () => n };
}

describe("coste: sentencias de la evolución", () => {
  it("el número de sentencias NO depende del número de meses (la referencia sí crece con ellos)", async () => {
    const c = EVOLUTION_CASES[0];
    const id = entityIdOf(world, c);
    const measure = async (fecha: string, f: typeof evolutionIn) => {
      const out = await readSnapshot(admin.id, async (tx) => {
        const k = counting(tx);
        await f(k.tx, query({ ...c.params, fecha }, id), id, world.published, FIXTURE_TODAY);
        return k.count();
      });
      return out;
    };
    const fast3 = await measure("2026-03-31", evolutionIn);
    const fast10 = await measure("2026-10-31", evolutionIn);
    const ref3 = await measure("2026-03-31", evolutionReferenceIn);
    const ref10 = await measure("2026-10-31", evolutionReferenceIn);
    expect(fast10).toBe(fast3);
    expect(ref10).toBeGreaterThan(ref3 * 2);
    expect(fast10).toBeLessThan(ref3); // incluso con 10 meses, menos sentencias que la referencia con 3
  });
});
