"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Aviso breve en las herramientas que salieron del menú principal (HOTFIX-03 §3): la URL antigua sigue funcionando y se indica su nuevo destino. */
const MOVED: Record<string, { to: string; where: string }> = {
  "/administracion/servicios": { to: "/administracion/configuracion?seccion=herramientas", where: "Configuración › Herramientas técnicas › Excepciones de servicio" },
  "/administracion/economia": { to: "/administracion/configuracion?seccion=herramientas", where: "Configuración › Herramientas técnicas › Comprobación de datos" },
  "/administracion/conciliacion": { to: "/administracion/configuracion?seccion=herramientas", where: "Configuración › Herramientas técnicas › Comprobación de datos" },
  "/administracion/operacion": { to: "/administracion/configuracion?seccion=herramientas", where: "Configuración › Herramientas técnicas › Estado de la aplicación" },
  "/administracion/exportaciones": { to: "/administracion/cargas", where: "Cargas › Descargas" },
  "/administracion/clientes/productos": { to: "/administracion/configuracion?seccion=herramientas", where: "Configuración › Herramientas técnicas › Catálogo de productos" },
};
export function AvisoHerramienta() {
  const path = usePathname() ?? "";
  const hit = Object.entries(MOVED).find(([p]) => path === p || path.startsWith(`${p}/`));
  if (!hit) return null;
  return <p className="notice notice-info" role="note">Esta herramienta ahora está en <Link href={hit[1].to}>{hit[1].where}</Link>. Esta dirección sigue funcionando.</p>;
}
