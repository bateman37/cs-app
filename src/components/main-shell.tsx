"use client";

import { usePathname } from "next/navigation";

/** Rutas de las vistas panorámicas (HOTFIX-02 §6): el propio `main` (padre) pierde el límite de ancho; formularios y Pulse Rent lo conservan. */
const WIDE = ["/comparativa", "/analisis-cliente", "/calidad"];
export const isWidePath = (path: string) => WIDE.some((w) => path === w || path.startsWith(`${w}/`));

export function MainShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "";
  return <main id="contenido" className={isWidePath(path) ? "main-wide" : undefined}>{children}</main>;
}
