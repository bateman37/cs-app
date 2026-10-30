import type { Ctx } from "../nucleo";

/**
 * Punto de extensión: añada aquí (o en otro módulo registrado en recorrido.ts) los casos de
 * pantallas nuevas (Personal, Usuarios, Cargas...). Cada caso recibe el contexto y registra
 * sus comprobaciones con ctx.check(etiqueta, ok, detalle). Vacío a propósito en CSAPP-01.
 */
export async function extra(ctx: Ctx): Promise<void> {
  void ctx;
}
