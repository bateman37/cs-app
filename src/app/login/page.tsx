import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Acceso" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <main id="contenido" className="login">
      <div className="card">
        <h1>Vincle <span style={{ color: "#7a6600" }}>CS App</span></h1>
        <p className="muted">Acceso con la cuenta que le ha facilitado el administrador.</p>
        <LoginForm />
      </div>
    </main>
  );
}
