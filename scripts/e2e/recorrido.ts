import { runAll } from "./nucleo";
import { cuentas } from "./casos/01-cuentas";
import { acceso } from "./casos/02-acceso";
import { maestros } from "./casos/03-maestros";
import { consulta } from "./casos/04-consulta";
import { persistencia } from "./casos/05-persistencia";
import { limite } from "./casos/06-limite-intentos";
import { cargas } from "./casos/07-cargas";
import { personalUsuarios } from "./casos/08-personal-usuarios";
import { zendesk } from "./casos/09-zendesk";
import { wrikePapBugs } from "./casos/10-wrike-pap-bugs";
import { finanzas } from "./casos/11-finanzas";
import { extra } from "./casos/99-extensiones";

/**
 * Recorrido de navegador de CSAPP-01. El orden importa: el límite de intentos va al final porque
 * agota el cupo de acceso del origen. Nuevas pantallas: añadir un módulo en ./casos y registrarlo aquí.
 */
// E2E_SOLO=finanzas ejecuta únicamente ese caso (depuración); sin la variable se ejecuta el recorrido completo.
const todos = { cuentas, acceso, maestros, consulta, persistencia, cargas, personalUsuarios, zendesk, wrikePapBugs, finanzas, extra, limite };
const solo = process.env.E2E_SOLO?.split(",").map((s) => s.trim());
runAll(solo ? solo.map((n) => todos[n as keyof typeof todos]).filter(Boolean) : Object.values(todos)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(`Recorrido abortado: ${e instanceof Error ? e.message : "error"}`);
    process.exit(2);
  },
);
