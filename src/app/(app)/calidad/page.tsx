import type { Metadata } from "next";
import { requirePageUser } from "@/lib/session";
import { PendingView } from "@/components/pending-view";

export const metadata: Metadata = { title: "Calidad" };

export default async function Page() {
  await requirePageUser();
  return <PendingView title="Calidad" what="Mostrará los indicadores de calidad del servicio y su evolución." />;
}
