"use server";

import type { FormState } from "@/components/form-kit";
import { runAdminAction } from "@/app/action-utils";
import { confirmMatrixChange, copyFromPreviousYear, initializeHistoric } from "@/server/usuarios";
import { resolveUsersBase } from "@/server/usuarios-base";
import { DomainError } from "@/server/errors";
import { SCOPE_SLUG } from "./_lib";

const BASE = "/administracion/usuarios";

type S = FormState;

/** Destino tras guardar: la ficha del mismo ámbito y año. */
function back(raw: Record<string, string>, year: string | number) {
  const slug = SCOPE_SLUG[raw.targetType as keyof typeof SCOPE_SLUG];
  if (!slug || !raw.targetId) throw new DomainError("Ámbito no válido.");
  return `${BASE}/${slug}/${encodeURIComponent(raw.targetId)}?anio=${encodeURIComponent(String(year))}&ok=1`;
}

/** Confirma «editar un mes» o «aplicar desde este mes»; el servidor recalcula y comprueba la versión. */
export async function confirmChangeAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(
    fd,
    async (a, raw) => {
      await confirmMatrixChange(a, raw);
      return { href: back(raw, raw.year) };
    },
    { ok: "Cambio guardado.", redirectTo: (r) => r.href },
  );
}

export async function initializeHistoricAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(
    fd,
    async (a, raw) => {
      await initializeHistoric(a, raw);
      return { href: back(raw, raw.year) };
    },
    { ok: "Valor inicial guardado.", redirectTo: (r) => r.href },
  );
}

export async function copyPreviousYearAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(
    fd,
    async (a, raw) => {
      await copyFromPreviousYear(a, raw);
      return { href: back(raw, raw.year) };
    },
    { ok: "Base copiada.", redirectTo: (r) => r.href },
  );
}

/** Elección explícita de la base 2025 de un Grupo con valores distintos por categoría. */
export async function resolveUsersBaseAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(
    fd,
    async (a, raw) => {
      await resolveUsersBase(a, raw);
      return { href: `${BASE}/grupo/${encodeURIComponent(raw.groupId)}?anio=2025&ok=1` };
    },
    { ok: "Base 2025 resuelta.", redirectTo: (r) => r.href },
  );
}
