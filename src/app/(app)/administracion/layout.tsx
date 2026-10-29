import { requirePageUser } from "@/lib/session";
import { Tabs } from "@/components/nav";

const PENDING = ["Personal", "Usuarios mensuales", "Cargas", "Configuración analítica"];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0 0.25rem", alignItems: "flex-end", borderBottom: "2px solid var(--border)", marginBottom: "1rem" }}>
        <Tabs label="Administración" items={[{ href: "/administracion/clientes", label: "Clientes" }]} />
        {PENDING.map((p) => (
          <span key={p} className="subnav disabled" aria-disabled="true" style={{ border: 0, margin: 0, padding: "0.5rem 0.9rem", color: "var(--muted)", cursor: "not-allowed" }}>
            {p}<span className="tag" style={{ fontSize: "0.72rem", background: "var(--warn-bg)", padding: "0.05rem 0.4rem", borderRadius: 99, marginLeft: 6 }}>Pendiente</span>
          </span>
        ))}
      </div>
      {user.role !== "ADMIN" ? (
        <p className="notice notice-info" role="note">Su perfil es de consulta: puede ver los maestros, pero no modificarlos.</p>
      ) : null}
      {children}
    </>
  );
}
