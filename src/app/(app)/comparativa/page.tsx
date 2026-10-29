import type { Metadata } from "next";
import { requirePageUser } from "@/lib/session";
import { PendingView } from "@/components/pending-view";

export const metadata: Metadata = { title: "Comparativa" };

export default async function Page() {
  await requirePageUser();
  return <PendingView title="Comparativa" what="Mostrará la cartera de clientes, sus horas, ingresos y objetivos." />;
}
