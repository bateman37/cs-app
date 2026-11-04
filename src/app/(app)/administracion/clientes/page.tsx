import type { Metadata } from "next";
import { requirePageUser } from "@/lib/session";
import { first, type SearchParams } from "@/lib/format";
import { parseEstado } from "@/domain/estado";
import { loadMasterTable } from "@/server/master-table";
import { listAssignableGroups } from "@/server/groups";
import { formatDecimalEs } from "@/lib/money";
import { ClientesEditor } from "./editor";
import "./tabla.css";
import "./editor.css";

export const metadata: Metadata = { title: "Clientes" };
export const dynamic = "force-dynamic";

/** Editor canónico de Clientes y Grupos (HOTFIX-04 §4): la tabla ES el editor; las fichas quedan como historial y gestión excepcional. */
export default async function ClientesTablaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const q = first(sp.q).slice(0, 100);
  const estado = parseEstado(first(sp.estado));
  const onlyPending = first(sp.pendientes) === "1";
  const grupo = first(sp.grupo).slice(0, 100);
  const nuevo = first(sp.nuevo);
  const isAdmin = user.role === "ADMIN";
  const [t, groups] = await Promise.all([loadMasterTable(user.id, { q, estado, onlyPending, groupId: grupo || undefined }), isAdmin ? listAssignableGroups(user.id) : Promise.resolve([])]);
  return (
    <ClientesEditor
      rows={t.rows}
      totals={t.totals}
      unattributed={t.unattributed}
      filters={{ q, estado, pendientes: onlyPending, grupo }}
      isAdmin={isAdmin}
      groups={groups.filter((g) => g.isActive).map((g) => ({ id: g.id, name: g.name }))}
      initialNew={isAdmin && (nuevo === "grupo" || nuevo === "cliente") ? nuevo : null}
      hoursLabel={formatDecimalEs(t.unattributed.hoursWithoutGroup, 2)}
    />
  );
}
