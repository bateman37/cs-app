import { redirect } from "next/navigation";

/** HOTFIX-04 §9: el alta ordinaria de un Grupo es un borrador en la propia tabla. */
export default function NuevoGrupoRedirect() {
  redirect("/administracion/clientes?nuevo=grupo");
}
