import "dotenv/config";
import { activateTestTarget } from "../../src/lib/test-guard";

/**
 * DEBE ser el PRIMER import del recorrido: fija DATABASE_URL = TEST_DATABASE_URL aprobada antes de que ningún módulo de casos
 * (que importa servicios y generadores) pueda abrir un cliente contra la base de trabajo (CSAPP-07 §3). Falla sin mutar si el destino no es seguro.
 */
activateTestTarget();
