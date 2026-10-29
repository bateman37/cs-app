"use server";

import type { FormState } from "@/components/form-kit";
import { runAdminAction } from "@/app/action-utils";
import { createCatalogItem, createPerson, setCatalogItemActive, setPersonActive, updatePerson } from "@/server/personal";
import { addAlias, setAliasActive, updateAlias } from "@/server/personal-aliases";
import { addTermPeriod, changeTerm, updateTerm } from "@/server/personal-terms";
import { DomainError } from "@/server/errors";

const BASE = "/administracion/personal";
const PATHS = [BASE, `${BASE}/catalogo`];

type S = FormState;

export async function createPersonAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => createPerson(a, raw), {
    ok: "Persona creada.",
    redirectTo: (p) => `${BASE}/${p.id}?creada=1`,
  });
}
export async function updatePersonAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => updatePerson(a, raw.id, raw), { ok: "Cambios guardados.", paths: PATHS });
}

/** Desactiva o reactiva; nunca borra. */
export async function setActiveAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(
    fd,
    async (a, raw) => {
      const active = raw.active === "true";
      switch (raw.entity) {
        case "person": return setPersonActive(a, raw.id, active, raw);
        case "alias": return setAliasActive(a, raw.id, active, raw);
        case "catalog": return setCatalogItemActive(a, raw.id, active, raw);
        default: throw new DomainError("Operación no reconocida.");
      }
    },
    { ok: "Estado actualizado.", paths: PATHS },
  );
}

export async function addAliasAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => addAlias(a, raw.personId, raw), { ok: "Alias añadido.", paths: PATHS });
}
export async function updateAliasAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => updateAlias(a, raw.id, raw), { ok: "Alias actualizado.", paths: PATHS });
}
export async function changeTermAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => changeTerm(a, raw.personId, raw), {
    ok: "Cambio guardado; el valor anterior se conserva en la historia.",
    paths: PATHS,
  });
}
export async function addTermPeriodAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => addTermPeriod(a, raw.personId, raw), { ok: "Tramo añadido.", paths: PATHS });
}
export async function updateTermAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => updateTerm(a, raw.id, raw), { ok: "Tramo corregido.", paths: PATHS });
}
export async function createCatalogItemAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => createCatalogItem(a, raw), { ok: "Valor añadido al catálogo.", paths: PATHS });
}
