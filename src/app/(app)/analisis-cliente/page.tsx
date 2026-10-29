import type { Metadata } from "next";
import { requirePageUser } from "@/lib/session";
import { PendingView } from "@/components/pending-view";

export const metadata: Metadata = { title: "Análisis Cliente" };

export default async function Page() {
  await requirePageUser();
  return <PendingView title="Análisis Cliente" what="Mostrará la ficha individual de cada cliente con su evolución y desgloses." />;
}
