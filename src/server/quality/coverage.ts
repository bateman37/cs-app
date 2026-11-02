import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { isIsoDate, todayMadrid } from "@/domain/vigencia";
import { COVERAGE_SOURCES, SOURCE_PROFILE, type CoverageSource, type Declaration, type Population, type SnapshotBatch, type StatusScope } from "@/domain/quality-coverage";
import { recordAudit } from "@/server/audit";
import { authorize } from "@/server/authorize";
import { DomainError, StaleVersionError } from "@/server/errors";
import { parseInput } from "@/server/parse";
import { adminTransaction } from "@/server/tx";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Cobertura declarada de lotes (CSAPP-08 §6). La declaración es tipada, versionada, con motivo y auditada, y NO cambia filas, extracción original,
 * observaciones ni estados históricos. Solo cuentan lotes COMPLETADOS (los revertidos, cancelados o fallidos no prueban cobertura); un lote sin
 * declaración permanece «desconocido» sin aprobación automática.
 */
const PROFILE_SOURCE = Object.fromEntries(COVERAGE_SOURCES.map((s) => [SOURCE_PROFILE[s], s])) as Record<string, CoverageSource>;

type DeclRow = { batchId: string; version: number; population: string; statusScope: string; coveredFrom: string | null; coveredTo: string | null; extractedOn: string | null; profileId: string };

/** Declaración vigente de cada lote COMPLETADO de los perfiles que alimentan Calidad (una sola consulta por conjuntos). */
export async function loadDeclarations(db: Db): Promise<Declaration[]> {
  const rows = await db.$queryRaw<DeclRow[]>(Prisma.sql`
    SELECT d."batchId", d.version, d.population, d."statusScope", to_char(d."coveredFrom", 'YYYY-MM-DD') AS "coveredFrom", to_char(d."coveredTo", 'YYYY-MM-DD') AS "coveredTo",
      to_char(d."extractedOn", 'YYYY-MM-DD') AS "extractedOn", b."profileId"
    FROM "UploadCoverageDeclaration" d
    JOIN "UploadBatch" b ON b.id = d."batchId" AND b.status = 'COMPLETED'
    WHERE d.version = (SELECT max(x.version) FROM "UploadCoverageDeclaration" x WHERE x."batchId" = d."batchId")
      AND b."profileId" = ANY(${Object.keys(PROFILE_SOURCE)}::text[])`);
  return rows.map((r) => ({ batchId: r.batchId, version: r.version, population: r.population as Population, statusScope: r.statusScope as StatusScope, coveredFrom: r.coveredFrom, coveredTo: r.coveredTo, extractedOn: r.extractedOn, source: PROFILE_SOURCE[r.profileId] }));
}

export type TicketBatchInfo = SnapshotBatch & { receivedOn: string; observationKind: "DECLARED" | "RECEIVED" | null; declared: boolean; tickets: number };
/** Lotes de tickets completados con su fecha de observación y declaración: candidatos a fotografía. Una fecha RECEIVED es frescura desconocida salvo extracción revisada. */
export async function loadTicketBatches(db: Db): Promise<TicketBatchInfo[]> {
  const rows = await db.$queryRaw<{ id: string; observedOn: string | null; kind: string | null; receivedOn: string; declaredExtraction: string | null; population: string | null; statusScope: string | null; extractedOn: string | null; tickets: number }[]>(Prisma.sql`
    SELECT b.id, to_char(max(o."observedOn"), 'YYYY-MM-DD') AS "observedOn", max(o."observedKind") AS kind, to_char(b."createdAt" AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS "receivedOn",
      to_char(b."declaredExtractionDate", 'YYYY-MM-DD') AS "declaredExtraction", d.population, d."statusScope", to_char(d."extractedOn", 'YYYY-MM-DD') AS "extractedOn", count(o.id)::int AS tickets
    FROM "UploadBatch" b
    LEFT JOIN "ZdTicketObservation" o ON o."batchId" = b.id
    LEFT JOIN "UploadCoverageDeclaration" d ON d."batchId" = b.id AND d.version = (SELECT max(x.version) FROM "UploadCoverageDeclaration" x WHERE x."batchId" = b.id)
    WHERE b."profileId" = 'zendesk-tickets' AND b.status = 'COMPLETED'
    GROUP BY b.id, b."createdAt", b."declaredExtractionDate", d.population, d."statusScope", d."extractedOn"
    ORDER BY b."createdAt", b.id`);
  return rows.map((r) => {
    const observedOn = r.extractedOn ?? r.declaredExtraction ?? r.observedOn ?? r.receivedOn;
    return {
      batchId: r.id,
      observedOn,
      extractionKnown: r.extractedOn !== null || r.declaredExtraction !== null,
      population: (r.population ?? "UNKNOWN") as Population,
      statusScope: (r.statusScope ?? "UNKNOWN") as StatusScope,
      receivedOn: r.receivedOn,
      observationKind: r.kind as "DECLARED" | "RECEIVED" | null,
      declared: r.population !== null,
      tickets: r.tickets,
    };
  });
}

// ---------------------------------------------------------------- Escritura (solo ADMIN)

const dateOpt = z.string().optional().default("").refine((v) => v === "" || isIsoDate(v), "Fecha no válida (AAAA-MM-DD).");
export const coverageSchema = z.object({
  batchId: z.string().min(1).max(60),
  population: z.enum(["ALL_CLIENTS", "PARTIAL", "UNKNOWN"]),
  statusScope: z.enum(["ALL_STATUSES", "UNRESOLVED_ONLY", "NOT_APPLICABLE", "UNKNOWN"]),
  coveredFrom: dateOpt,
  coveredTo: dateOpt,
  extractedOn: dateOpt,
  reason: z.string().trim().min(1, "Indique el motivo de la declaración.").max(500),
  expectedVersion: z.coerce.number().int().min(0).max(100000),
});
export type CoverageDeclaration = { batchId: string; version: number; population: Population; statusScope: StatusScope; coveredFrom: string | null; coveredTo: string | null; extractedOn: string | null; reason: string; declaredAt: string; declaredByEmail: string };

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const shape = (d: { batchId: string; version: number; population: string; statusScope: string; coveredFrom: Date | null; coveredTo: Date | null; extractedOn: Date | null; reason: string; declaredAt: Date; declaredBy: { email: string } }): CoverageDeclaration => ({
  batchId: d.batchId, version: d.version, population: d.population as Population, statusScope: d.statusScope as StatusScope, coveredFrom: iso(d.coveredFrom), coveredTo: iso(d.coveredTo), extractedOn: iso(d.extractedOn), reason: d.reason, declaredAt: d.declaredAt.toISOString(), declaredByEmail: d.declaredBy.email,
});

/** Declara o revisa la cobertura de un lote completado: crea una versión nueva (las anteriores se conservan) con motivo y auditoría. No toca filas ni observaciones. */
export async function declareCoverage(actorId: string, raw: unknown, opts: { now?: Date } = {}): Promise<CoverageDeclaration> {
  const input = parseInput(coverageSchema, raw);
  const today = todayMadrid(opts.now ?? new Date());
  return adminTransaction(actorId, async (tx, actor) => {
    const batch = await tx.uploadBatch.findUnique({ where: { id: input.batchId }, select: { id: true, profileId: true, status: true, originalName: true } });
    if (!batch) throw new DomainError("Lote no encontrado.");
    const source = PROFILE_SOURCE[batch.profileId];
    if (!source) throw new DomainError("Este perfil no alimenta Calidad: no admite declaración de cobertura.");
    if (batch.status !== "COMPLETED") throw new DomainError("Solo un lote completado (no revertido) puede declarar cobertura.");
    if (source === "tickets" && input.statusScope === "NOT_APPLICABLE") throw new DomainError("Para tickets indique qué estados contiene el export (todos, solo sin resolver o desconocido).", { statusScope: "Obligatorio para tickets." });
    if (source !== "tickets" && input.statusScope !== "NOT_APPLICABLE") throw new DomainError("El estado de los tickets solo aplica a tickets: use «No aplica».", { statusScope: "No aplica a esta fuente." });
    const from = input.coveredFrom || null;
    const to = input.coveredTo || null;
    if ((from === null) !== (to === null)) throw new DomainError("Indique las dos fechas del alcance temporal o ninguna.", { coveredFrom: "Desde y hasta van juntos." });
    if (from && to && from > to) throw new DomainError("El alcance temporal debe cumplir desde ≤ hasta.", { coveredFrom: "Desde ≤ hasta." });
    if (to && to > today) throw new DomainError("El alcance declarado no puede terminar en una fecha futura.", { coveredTo: "Fecha futura." });
    if (input.extractedOn && input.extractedOn > today) throw new DomainError("La extracción no puede ser futura.", { extractedOn: "Fecha futura." });
    if (input.population === "ALL_CLIENTS" && (from === null || to === null)) throw new DomainError("Declarar «todos los clientes» exige el alcance temporal cubierto.", { coveredFrom: "Obligatorio." });
    if (source === "tickets" && input.population === "ALL_CLIENTS" && input.statusScope === "UNKNOWN") throw new DomainError("Declarar «todos los clientes» en tickets exige indicar qué estados contiene el export.", { statusScope: "Obligatorio." });
    const cur = await tx.uploadCoverageDeclaration.findFirst({ where: { batchId: batch.id }, orderBy: { version: "desc" }, include: { declaredBy: { select: { email: true } } } });
    if ((cur?.version ?? 0) !== input.expectedVersion) throw new StaleVersionError("La declaración de cobertura");
    const created = await tx.uploadCoverageDeclaration.create({
      data: { batchId: batch.id, version: (cur?.version ?? 0) + 1, population: input.population, statusScope: input.statusScope, coveredFrom: from ? new Date(`${from}T00:00:00Z`) : null, coveredTo: to ? new Date(`${to}T00:00:00Z`) : null, extractedOn: input.extractedOn ? new Date(`${input.extractedOn}T00:00:00Z`) : null, reason: input.reason, declaredById: actor.id },
      include: { declaredBy: { select: { email: true } } },
    });
    await recordAudit(tx, actor, {
      action: cur ? "UPDATE" : "CREATE", entityType: "UploadCoverageDeclaration", entityId: `${batch.id}#${created.version}`, batchId: batch.id,
      summary: `Cobertura declarada del lote «${batch.originalName}» (${batch.profileId}), versión ${created.version}: ${input.population}${from ? `, ${from} – ${to}` : ""}. Motivo: ${input.reason}`,
      before: cur ? shape(cur) : null, after: shape(created),
    });
    return shape(created);
  });
}

export async function listDeclarations(actorId: string, batchId: string): Promise<CoverageDeclaration[]> {
  await authorize(prisma, actorId, "ADMIN"); // la gestión de Cargas es de Administración
  const rows = await prisma.uploadCoverageDeclaration.findMany({ where: { batchId }, orderBy: { version: "desc" }, include: { declaredBy: { select: { email: true } } } });
  return rows.map(shape);
}
