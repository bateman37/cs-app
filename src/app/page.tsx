import { redirect } from "next/navigation";

// Sin portada con métricas: se entra por la primera vista.
export default function Home() {
  redirect("/comparativa");
}
