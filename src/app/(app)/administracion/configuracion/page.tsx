import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { first, type SearchParams } from "@/lib/format";
import { EconomiaSection } from "./economia";
import { PulseSection } from "./pulse";
import { CalidadSection } from "./calidad";
import { HerramientasSection } from "./herramientas";

export const metadata: Metadata = { title: "Configuración" };
export const dynamic = "force-dynamic";

const SECTIONS = [
  { id: "economia", label: "Economía" },
  { id: "pulse", label: "Pulse Rent" },
  { id: "calidad", label: "Calidad" },
  { id: "herramientas", label: "Herramientas técnicas" },
] as const;

export default async function ConfiguracionPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const wanted = first(sp.seccion);
  const section = SECTIONS.find((s) => s.id === wanted)?.id ?? "economia";
  const isAdmin = user.role === "ADMIN";
  return (
    <>
      <h1>Configuración</h1>
      <p className="muted">
        Tres familias de parámetros (y las herramientas técnicas), cada una con <strong>revisiones inmutables</strong>, autor, motivo y fecha. Guardar un <strong>borrador</strong>, <strong>simular</strong> y{" "}
        <strong>activar</strong> son acciones distintas: solo la activación cambia lo que usa Pulse Rent y, más adelante, Calidad. Una consulta nunca modifica parámetros.
      </p>
      {first(sp.ok) === "activada" ? <p className="notice notice-ok" role="status">Revisión activada de forma atómica y auditada. Las lecturas anteriores quedan invalidadas por la nueva referencia de datos.</p> : null}
      {first(sp.ok) === "vuelta" ? <p className="notice notice-ok" role="status">Se ha creado una nueva activación con la configuración elegida; la historia no se modifica.</p> : null}
      {first(sp.ok) === "descartado" ? <p className="notice notice-ok" role="status">Borrador descartado.</p> : null}
      <nav className="subtabs" aria-label="Secciones de configuración">
        {SECTIONS.map((s) => (
          <Link key={s.id} href={`/administracion/configuracion?seccion=${s.id}`} aria-current={s.id === section ? "page" : undefined} className={s.id === section ? "subtab subtab-active" : "subtab"}>
            {s.label}
          </Link>
        ))}
      </nav>
      {section === "economia" ? <EconomiaSection userId={user.id} isAdmin={isAdmin} /> : null}
      {section === "pulse" ? <PulseSection userId={user.id} isAdmin={isAdmin} sp={sp} /> : null}
      {section === "calidad" ? <CalidadSection userId={user.id} isAdmin={isAdmin} sp={sp} /> : null}
      {section === "herramientas" ? <HerramientasSection userId={user.id} isAdmin={isAdmin} /> : null}
    </>
  );
}
