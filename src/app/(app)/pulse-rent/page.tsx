import type { Metadata } from "next";
import { requirePageUser } from "@/lib/session";
import { PendingView } from "@/components/pending-view";

export const metadata: Metadata = { title: "Pulse Rent" };

export default async function Page() {
  await requirePageUser();
  return <PendingView title="Pulse Rent" what="Mostrará las métricas por usuario con medias, medianas y percentiles." />;
}
