import { z } from "zod";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/server/audit";
import { authorize } from "@/server/authorize";
import { DomainError } from "@/server/errors";
import { parseInput } from "@/server/parse";
import { adminTransaction } from "@/server/tx";
import { DIAGNOSIS_FAMILIES, INDICATOR_KEYS } from "@/domain/quality-config";

/** Nota sencilla de revisión de QA (DIA 04): autor/fecha y vínculo a ámbito, periodo y evidencia. No es un gestor de tareas ni de planes de pruebas. */
export const TOPICS = [...DIAGNOSIS_FAMILIES, ...INDICATOR_KEYS] as readonly string[];
const schema = z.object({
  scope: z.enum(["group", "client"]),
  entityId: z.string().min(1).max(60),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  topic: z.string().refine((t) => TOPICS.includes(t), "Tema no válido."),
  evidence: z.string().trim().max(500).optional().default(""),
  text: z.string().trim().min(1, "Escriba la nota.").max(2000),
});
export type QualityNoteView = { id: string; year: number; month: number; topic: string; evidence: string | null; text: string; author: string; createdAt: string };

export async function addQualityNote(actorId: string, raw: unknown): Promise<QualityNoteView> {
  const input = parseInput(schema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const ent = input.scope === "group" ? await tx.clientGroup.findUnique({ where: { id: input.entityId }, select: { id: true, name: true } }) : await tx.client.findUnique({ where: { id: input.entityId }, select: { id: true, name: true, isInternal: true } });
    if (!ent) throw new DomainError("El Grupo Cliente o Cliente no existe.");
    if ("isInternal" in ent && ent.isInternal) throw new DomainError("Una organización interna no es un cliente externo.");
    const n = await tx.qualityNote.create({ data: { ...(input.scope === "group" ? { groupId: input.entityId } : { clientId: input.entityId }), year: input.year, month: input.month, topic: input.topic, evidence: input.evidence || null, text: input.text, authorId: actor.id } });
    await recordAudit(tx, actor, { action: "CREATE", entityType: "QualityNote", entityId: String(n.id), groupId: input.scope === "group" ? input.entityId : null, clientId: input.scope === "client" ? input.entityId : null, summary: `Nota de revisión de calidad (${input.topic}) en ${ent.name} · ${input.month}/${input.year}`, after: { topic: input.topic, evidence: n.evidence } });
    return { id: String(n.id), year: n.year, month: n.month, topic: n.topic, evidence: n.evidence, text: n.text, author: actor.email, createdAt: n.createdAt.toISOString() };
  });
}

export async function listQualityNotes(actorId: string, scope: "group" | "client", entityId: string, limit = 50): Promise<QualityNoteView[]> {
  await authorize(prisma, actorId, "READ");
  const rows = await prisma.qualityNote.findMany({ where: scope === "group" ? { groupId: entityId } : { clientId: entityId }, orderBy: { id: "desc" }, take: limit, include: { author: { select: { email: true } } } });
  return rows.map((n) => ({ id: String(n.id), year: n.year, month: n.month, topic: n.topic, evidence: n.evidence, text: n.text, author: n.author.email, createdAt: n.createdAt.toISOString() }));
}
