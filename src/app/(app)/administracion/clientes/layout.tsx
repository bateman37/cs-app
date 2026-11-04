/** La gestión de Clientes y Grupos es una única tabla de trabajo (HOTFIX-03 §4): ya no hay submenús Grupos / Clientes / Catálogo. Las fichas siguen siendo accesibles por enlace. */
export default function ClientesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
