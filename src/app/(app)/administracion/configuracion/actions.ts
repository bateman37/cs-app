"use server";

import type { FormState } from "@/components/form-kit";
import { runAdminAction } from "@/app/action-utils";
import { updateSettings } from "@/server/economics/settings";

export async function updateSettingsAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAdminAction(fd, (a, raw) => updateSettings(a, raw), {
    ok: "Nueva revisión de la configuración económica guardada y auditada.",
    paths: ["/administracion/configuracion", "/administracion/economia"],
  });
}

import { activateDraft, discardDraft, getActive, getDraft, rollbackTo, saveDraft, type ConfigFamily } from "@/server/pulse/config";
import { buildPulseDraft, buildQualityDraft } from "@/server/pulse/forms";
import type { PulseConfig } from "@/domain/pulse-catalog";
import type { QualityConfig } from "@/domain/quality-config";
import { prisma } from "@/lib/db";

const PATH = "/administracion/configuracion";

/** Guardar borrador: no cambia lo activo. Parte del borrador vigente (o de lo activo) y aplica los campos enviados. */
async function draftAction(family: ConfigFamily, fd: FormData): Promise<FormState> {
  return runAdminAction(
    fd,
    async (actor, raw) => {
      const draft = await getDraft(actor, family);
      const base = draft?.payload ?? (await getActive(prisma, family)).payload;
      const next = family === "PULSE" ? buildPulseDraft(raw, base as PulseConfig) : buildQualityDraft(raw, base as QualityConfig);
      const expected = raw.expectedDraftVersion === undefined || raw.expectedDraftVersion === "" ? null : Number(raw.expectedDraftVersion);
      return saveDraft(actor, family, next, { expectedVersion: expected, note: raw.note });
    },
    { ok: "Borrador guardado. No cambia lo activo hasta que lo active expresamente.", paths: [PATH] },
  );
}
export async function savePulseDraftAction(_: FormState, fd: FormData): Promise<FormState> {
  return draftAction("PULSE", fd);
}
export async function saveQualityDraftAction(_: FormState, fd: FormData): Promise<FormState> {
  return draftAction("QUALITY", fd);
}

function family(raw: Record<string, string>): ConfigFamily {
  if (raw.family !== "PULSE" && raw.family !== "QUALITY") throw new Error("Familia de configuración no válida.");
  return raw.family;
}
// El formulario de activación desaparece al activar (ya no hay borrador): el resultado se muestra tras redirigir, con un aviso de la página.
const back = (f: ConfigFamily, ok: "activada" | "vuelta" | "descartado") => `${PATH}?seccion=${f === "PULSE" ? "pulse" : "calidad"}&ok=${ok}`;
export async function activateConfigAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAdminAction(
    fd,
    (actor, raw) => activateDraft(actor, family(raw), { expectedRevisionNo: Number(raw.expectedRevisionNo), expectedDraftVersion: Number(raw.expectedDraftVersion), reason: raw.reason ?? "" }),
    { ok: "Revisión activada.", paths: [PATH, "/pulse-rent"], redirectTo: (r) => back(r.family, "activada") },
  );
}
export async function rollbackConfigAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAdminAction(
    fd,
    (actor, raw) => rollbackTo(actor, family(raw), { toRevisionNo: Number(raw.toRevisionNo), expectedRevisionNo: Number(raw.expectedRevisionNo), reason: raw.reason ?? "" }),
    { ok: "Nueva activación creada.", paths: [PATH, "/pulse-rent"], redirectTo: (r) => back(r.family, "vuelta") },
  );
}
export async function discardDraftAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAdminAction(fd, async (actor, raw) => { await discardDraft(actor, family(raw)); return { family: family(raw) }; }, { ok: "Borrador descartado.", paths: [PATH], redirectTo: (r) => back(r.family, "descartado") });
}
