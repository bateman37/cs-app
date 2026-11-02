import "dotenv/config";
import { performance } from "node:perf_hooks";

/**
 * Coste del sello de datos (CSAPP-09 §7): compara la versión de 08 con la actual sobre la base `_test` aprobada (por el guard central) con los datos que
 * haya dejado un benchmark (`npm run benchmark:calidad`). Varias medidas; no modifica nada. Uso: tsx scripts/medir-sello.ts [repeticiones]
 */
(async () => {
  const { activateTestTarget, assertConnectedTo } = await import("../src/lib/test-guard");
  const approved = activateTestTarget();
  const { prisma } = await import("../src/lib/db");
  await assertConnectedTo(prisma, approved.target.name);
  const n = Number(process.argv[2] ?? 5);
  const cur = await import("../src/server/analytics/stamp");
  const old = await import("./.stamp_old");
  const time = async (name: string, fn: (tx: Parameters<typeof cur.readDataStamp>[0]) => Promise<unknown>) => {
    const ms: number[] = [];
    for (let i = 0; i < n; i++) {
      const s = performance.now();
      await prisma.$transaction((tx) => fn(tx), { isolationLevel: "RepeatableRead" });
      ms.push(performance.now() - s);
    }
    ms.sort((a, b) => a - b);
    console.log(`| ${name} | ${ms[Math.floor(ms.length / 2)].toFixed(0)} | ${ms[0].toFixed(0)}–${ms[ms.length - 1].toFixed(0)} |`);
  };
  console.log("| Sello | mediana ms | rango ms |\n| --- | --- | --- |");
  await time("CSAPP-08 (versión anterior)", (tx) => old.readDataStamp(tx));
  await time("CSAPP-09 (observaciones, punteros y evidencias)", (tx) => cur.readDataStamp(tx));
  await prisma.$disconnect();
})();
