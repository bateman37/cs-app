"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

const VIEWS = [
  { href: "/comparativa", label: "Comparativa" },
  { href: "/analisis-cliente", label: "Análisis Cliente" },
  { href: "/pulse-rent", label: "Pulse Rent" },
  { href: "/calidad", label: "Calidad" },
];

export function MainNav() {
  const path = usePathname();
  const current = (href: string) => (path === href || path.startsWith(`${href}/`) ? "page" : undefined);
  return (
    <nav aria-label="Principal">
      <ul className="nav">
        {VIEWS.map((v) => (
          <li key={v.href}>
            <Link href={v.href} aria-current={current(v.href)}>{v.label}</Link>
          </li>
        ))}
        <li className="sep">
          <Link href="/administracion/clientes/grupos" aria-current={current("/administracion")}>Administración</Link>
        </li>
      </ul>
    </nav>
  );
}

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      className="btn btn-secondary btn-sm"
      type="button"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      Cerrar sesión
    </button>
  );
}

export function Tabs({ label, items }: { label: string; items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <ul className="subnav" aria-label={label} style={{ borderBottom: 0, marginBottom: 0 }}>
      {items.map((i) => (
        <li key={i.href}>
          <Link href={i.href} aria-current={path === i.href || path.startsWith(`${i.href}/`) ? "page" : undefined}>
            {i.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
