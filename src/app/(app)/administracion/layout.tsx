import { requirePageUser } from "@/lib/session";
import { Tabs } from "@/components/nav";

const PENDING = ["Configuración analítica"];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const items = [
    { href: "/administracion/clientes", label: "Clientes" },
    { href: "/administracion/personal", label: "Personal" },
    { href: "/administracion/usuarios", label: "Usuarios" },
    // Cargas contiene archivos y brutos: solo Administrador.
    ...(user.role === "ADMIN" ? [{ href: "/administracion/cargas", label: "Cargas" }] : []),
  ];
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0 0.25rem", alignItems: "flex-end", borderBottom: "2px solid var(--border)", marginBottom: "1rem" }}>
        <Tabs label="Administración" items={items} />
        {PENDING.map((p) => (
          <span key={p} className="subnav disabled" aria-disabled="true" style={{ border: 0, margin: 0, padding: "0.5rem 0.9rem", color: "var(--muted)", cursor: "not-allowed" }}>
            {p}<span className="tag" style={{ fontSize: "0.72rem", background: "var(--warn-bg)", padding: "0.05rem 0.4rem", borderRadius: "99px", marginLeft: 6 }}>Pendiente</span>
          </span>
        ))}
      </div>
      {user.role !== "ADMIN" ? (
        <p className="notice notice-info" role="note">Su perfil es de consulta: puede ver los maestros, el personal y la matriz de usuarios, pero no modificarlos.</p>
      ) : null}
      {children}
    </>
  );
}
