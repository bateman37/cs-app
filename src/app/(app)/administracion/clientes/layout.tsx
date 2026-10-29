import { Tabs } from "@/components/nav";

export default function ClientesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Tabs
        label="Maestros de clientes"
        items={[
          { href: "/administracion/clientes/grupos", label: "Grupos Cliente" },
          { href: "/administracion/clientes/clientes", label: "Clientes" },
          { href: "/administracion/clientes/productos", label: "Catálogo de productos" },
        ]}
      />
      {children}
    </>
  );
}
