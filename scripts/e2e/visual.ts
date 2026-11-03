import "./entorno-test";
import { runAll } from "./nucleo";
import { visualComparativa } from "./casos/visual-comparativa";

/** Revisión visual de Comparativa con datos sintéticos (HOTFIX-02). Requiere `npm run e2e:build` y las variables de `entorno-test.ts` (TEST_DATABASE_URL, E2E_PORT). */
runAll([visualComparativa]).then(
  (code) => process.exit(code),
  (e) => {
    console.error(`Revisión visual abortada: ${e instanceof Error ? e.message : "error"}`);
    process.exit(2);
  },
);
