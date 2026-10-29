import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/access";
import { LogoutButton, MainNav } from "@/components/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">Vincle <span>CS App</span></Link>
        <MainNav />
        <div className="userbox">
          <span>{user.name}</span>
          <span className="role">{ROLE_LABEL[user.role]}</span>
          <LogoutButton />
        </div>
      </header>
      <main id="contenido">{children}</main>
    </>
  );
}
