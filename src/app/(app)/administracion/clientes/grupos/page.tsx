import { redirect } from "next/navigation";
import { editorHref } from "@/domain/clientes-rutas";
import type { SearchParams } from "@/lib/format";

/** HOTFIX-04 §9: la lista antigua de Grupos ya no existe; se redirige al editor canónico traduciendo los filtros equivalentes. */
export default async function GruposRedirect({ searchParams }: { searchParams: Promise<SearchParams> }) {
  redirect(editorHref(await searchParams));
}
