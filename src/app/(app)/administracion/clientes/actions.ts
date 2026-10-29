"use server";

import type { FormState } from "@/components/form-kit";
import { runAdminAction, withScope } from "@/app/action-utils";
import { createGroup, setGroupActive, updateGroup } from "@/server/groups";
import {
  createClient,
  createImplementation,
  setClientActive,
  setImplementationActive,
  updateClient,
  updateImplementation,
} from "@/server/clients";
import { createIdentity, setIdentityActive, updateIdentity } from "@/server/identities";
import { addTermPeriod, changeTerm, updateTerm } from "@/server/terms";
import { createMilestone, setMilestoneActive, updateMilestone } from "@/server/milestones";
import { createProduct, setProductActive } from "@/server/products";
import { DomainError } from "@/server/errors";

const BASE = "/administracion/clientes";
const PATHS = [`${BASE}/grupos`, `${BASE}/clientes`, `${BASE}/productos`];

type S = FormState;

export async function createGroupAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => createGroup(a, raw), {
    ok: "Grupo creado.",
    redirectTo: (g) => `${BASE}/grupos/${g.id}?creado=1`,
  });
}
export async function updateGroupAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => updateGroup(a, raw.id, raw), { ok: "Cambios guardados.", paths: PATHS });
}
export async function createClientAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => createClient(a, raw), {
    ok: "Cliente creado.",
    redirectTo: (c) => `${BASE}/clientes/${c.id}?creado=1`,
  });
}
export async function updateClientAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => updateClient(a, raw.id, raw), { ok: "Cambios guardados.", paths: PATHS });
}
export async function createImplementationAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => createImplementation(a, raw.clientId, raw), { ok: "Implantación añadida.", paths: PATHS });
}
export async function updateImplementationAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => updateImplementation(a, raw.id, raw), { ok: "Cambios guardados.", paths: PATHS });
}

/** Desactiva o reactiva cualquier maestro; nunca borra. */
export async function setActiveAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(
    fd,
    async (a, raw) => {
      const active = raw.active === "true";
      switch (raw.entity) {
        case "group": return setGroupActive(a, raw.id, active, raw);
        case "client": return setClientActive(a, raw.id, active, raw);
        case "implementation": return setImplementationActive(a, raw.id, active, raw);
        case "identity": return setIdentityActive(a, raw.id, active, raw);
        case "milestone": return setMilestoneActive(a, raw.id, active, raw);
        case "product": return setProductActive(a, raw.id, active, raw);
        default: throw new DomainError("Operación no reconocida.");
      }
    },
    { ok: "Estado actualizado.", paths: PATHS },
  );
}

export async function createIdentityAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => createIdentity(a, withScope(raw)), { ok: "Equivalencia añadida.", paths: PATHS });
}
export async function updateIdentityAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => updateIdentity(a, raw.id, raw), { ok: "Equivalencia actualizada.", paths: PATHS });
}
export async function changeTermAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => changeTerm(a, withScope(raw)), { ok: "Cambio guardado; el valor anterior se conserva en el historial de vigencias.", paths: PATHS });
}
export async function addTermPeriodAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => addTermPeriod(a, withScope(raw)), { ok: "Tramo añadido.", paths: PATHS });
}
export async function updateTermAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => updateTerm(a, raw.id, raw), { ok: "Tramo corregido.", paths: PATHS });
}
export async function createMilestoneAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => createMilestone(a, withScope(raw)), { ok: "Hito añadido.", paths: PATHS });
}
export async function updateMilestoneAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => updateMilestone(a, raw.id, raw), { ok: "Hito actualizado.", paths: PATHS });
}
export async function createProductAction(_: S, fd: FormData): Promise<S> {
  return runAdminAction(fd, (a, raw) => createProduct(a, raw), { ok: "Producto añadido al catálogo.", paths: PATHS });
}
