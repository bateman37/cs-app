import { requirePageUser } from "@/lib/session";
import { Tabs } from "@/components/nav";
import { readRefreshStatus } from "@/server/relations/refresh";
import { AvisoHerramienta } from "./aviso-herramienta";
import { RelationsStatus, type RelState } from "./relaciones-estado";


export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  // HOTFIX-03 §3: cinco entradas. Servicio económico, Comprobación de datos, Estado de la aplicación, Exportaciones y Catálogo de productos pasan a Configuración (herramientas técnicas) o a Cargas.
  const items = [
    { href: "/administracion/clientes", label: "Clientes" },
    { href: "/administracion/personal", label: "Personal" },
    { href: "/administracion/usuarios", label: "Usuarios" },
    // Cargas contiene archivos y brutos: solo Administrador.
    ...(user.role === "ADMIN" ? [{ href: "/administracion/cargas", label: "Cargas" }] : []),
    { href: "/administracion/configuracion", label: "Configuración" },
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
      <AvisoHerramienta />
      <div className="admin-body">{children}</div>
    </>
  );
}
