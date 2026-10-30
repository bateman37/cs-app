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
import { extra } from "./casos/99-extensiones";

/**
 * Recorrido de navegador de CSAPP-01. El orden importa: el límite de intentos va al final porque
 * agota el cupo de acceso del origen. Nuevas pantallas: añadir un módulo en ./casos y registrarlo aquí.
 */
runAll([cuentas, acceso, maestros, consulta, persistencia, cargas, personalUsuarios, zendesk, wrikePapBugs, extra, limite]).then(
  (code) => process.exit(code),
  (e) => {
    console.error(`Recorrido abortado: ${e instanceof Error ? e.message : "error"}`);
    process.exit(2);
  },
);
