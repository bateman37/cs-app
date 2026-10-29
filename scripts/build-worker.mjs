// Construye el trabajador de cargas: scripts/worker.ts → worker-dist/worker.mjs.
// Node puro (sin shell específico): funciona igual en Linux y Windows. No requiere `next dev`.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** `server-only` lanza fuera de Next; en el trabajador (proceso de servidor) se sustituye por un módulo vacío. */
const serverOnlyStub = {
  name: "server-only-stub",
  setup(b) {
    b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export {};", loader: "js" }));
  },
};

await build({
  entryPoints: [path.join(root, "scripts", "worker.ts")],
  outfile: path.join(root, "worker-dist", "worker.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  tsconfig: path.join(root, "tsconfig.json"),
  plugins: [serverOnlyStub],
  logLevel: "warning",
});
console.log("Trabajador construido en worker-dist/worker.mjs");
