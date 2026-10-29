"use client";

import { ActionForm, SubmitButton } from "@/components/form-kit";
import { setActiveAction } from "./actions";

/** Desactiva o reactiva una persona, un alias o un valor de catálogo conservando su historia (no existe el borrado). */
export function ToggleActive({ entity, id, version, active }: { entity: "person" | "alias" | "catalog"; id: string; version: number; active: boolean }) {
  return (
    <ActionForm action={setActiveAction} className="inline-form" hidden={{ entity, id, expectedVersion: version, active: String(!active) }}>
      <SubmitButton variant={active ? "danger" : "secondary"} pending="…">{active ? "Desactivar" : "Reactivar"}</SubmitButton>
    </ActionForm>
  );
}
