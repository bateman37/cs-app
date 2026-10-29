"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!email || !password) {
      setError("Indique su correo y su contraseña.");
      return;
    }
    setPending(true);
    try {
      const { error: err } = await authClient.signIn.email({ email, password });
      if (err) {
        setError(
          err.status === 429
            ? "Demasiados intentos de acceso. Espere un minuto antes de volver a intentarlo."
            : "Correo o contraseña incorrectos, o la cuenta no está activa.",
        );
        setPending(false);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("No se ha podido iniciar sesión. Inténtelo de nuevo.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="form" style={{ flexDirection: "column", alignItems: "stretch" }} noValidate>
      {error ? <p className="notice notice-error" role="alert">{error}</p> : null}
      <div className="field">
        <label htmlFor="email">Correo electrónico</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="field">
        <label htmlFor="password">Contraseña</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
