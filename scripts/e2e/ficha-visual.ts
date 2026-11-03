import "./entorno-test";
import { runAll } from "./nucleo";
import { fichaVisual } from "./casos/12b-ficha-visual";

/**
 * Revisión visual de la ficha de Análisis Cliente (HOTFIX-02): `E2E_PORT=3202 E2E_CAPTURAS=<dir> TEST_DATABASE_URL=…/cs_app_hf02c_test npx tsx scripts/e2e/ficha-visual.ts`
 * sobre el `next start` compilado. Reutiliza el núcleo del recorrido (base aislada `_test`, cuentas sintéticas, navegador).
 */
runAll([fichaVisual]).then(
  (code) => process.exit(code),
  (e) => {
    console.error(`Revisión visual abortada: ${e instanceof Error ? e.message : "error"}`);
    process.exit(2);
  },
);
