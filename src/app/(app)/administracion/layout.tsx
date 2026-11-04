import { requirePageUser } from "@/lib/session";
import { Tabs } from "@/components/nav";
import { readRefreshStatus } from "@/server/relations/refresh";
import { RelationsStatus, type RelState } from "./relaciones-estado";


export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const items = [
    { href: "/administracion/clientes", label: "Clientes" },
    { href: "/administracion/personal", label: "Personal" },
    { href: "/administracion/usuarios", label: "Usuarios" },
    // Cargas contiene archivos y brutos: solo Administrador.
    ...(user.role === "ADMIN" ? [{ href: "/administracion/cargas", label: "Cargas" }] : []),
    { href: "/administracion/servicios", label: "Servicio económico" },
    { href: "/administracion/economia", label: "Comprobación económica" },
    { href: "/administracion/configuracion", label: "Configuración" },
    // Conciliación y supervisión de exportaciones: solo Administrador.
    ...(user.role === "ADMIN" ? [{ href: "/administracion/conciliacion", label: "Conciliación" }, { href: "/administracion/exportaciones", label: "Exportaciones" }, { href: "/administracion/operacion", label: "Operación" }] : []),
  ];
  const rel = user.role === "ADMIN" ? await readRefreshStatus() : null;
  const relState: RelState | null = rel ? { state: rel.state, requested: rel.requestedGeneration, completed: rel.completedGeneration, progress: rel.progress, lastError: rel.lastError, attempts: rel.attempts, maxAttempts: rel.maxAttempts } : null;
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0 0.25rem", alignItems: "flex-end", borderBottom: "2px solid var(--border)", marginBottom: "1rem" }}>
        <Tabs label="Administración" items={items} />
      </div>
      {user.role !== "ADMIN" ? (
        <p className="notice notice-info" role="note">Su perfil es de consulta: puede ver los maestros, el personal y la matriz de usuarios, pero no modificarlos.</p>
      ) : null}
      {relState && relState.state !== "UP_TO_DATE" ? <RelationsStatus initial={relState} /> : null}
      {children}
    </>
  );
}
