import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { isIsoDate } from "@/domain/vigencia";
import { chooseSnapshot } from "@/domain/quality-coverage";
import { authorize } from "@/server/authorize";
import { AccessError } from "@/lib/access";
import { DomainError } from "@/server/errors";
import { readDataStamp } from "@/server/analytics/stamp";
import type { Tx } from "@/server/analytics/snapshot";
import { getActive, getManifest } from "@/server/pulse/config";
import { loadTicketBatches } from "@/server/quality/coverage";
import { DATASETS, datasetOf, type DatasetDef, type Params } from "./datasets";
import { ENGINE_VERSION, FORMAT_VERSION, exportConfig } from "./config";

/**
 * Servicio de exportaciones completas (CSAPP-09 §6). Cada operación vuelve a comprobar sesión/rol vigentes y PROPIETARIO en la base; un UUID no autoriza nada.
 * Consulta y Administrador conservan los permisos analíticos existentes (ambos pueden exportar el detalle que pueden leer); Administración solo SUPERVISA
 * estados (lista), sin descarga de archivos ajenos por defecto.
 */
export const ACTIVE_STATUSES = ["QUEUED", "PREPARING", "GENERATING"] as const;

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const isoDate = z.string().refine(isIsoDate, "Fecha no válida (AAAA-MM-DD).");
export const exportRequestSchema = z
  .object({
    dataset: z.string().refine((v) => DATASETS.some((s) => s.key === v), "Conjunto de exportación no válido."),
    scope: z.enum(["group", "client"]).default("group"),
    sel: z.string().default(""),
    desde: isoDate,
    hasta: isoDate,
    servicio: z.enum(["TOTAL", "SOPORTE", "ADMIN_DELEGADA", "OTROS"]).default("TOTAL"),
  })
  .strict()
  .refine((v) => v.sel === "" || ID.test(v.sel), { path: ["sel"], message: "Identificador de entidad no válido." })
  .refine((v) => v.desde <= v.hasta, { path: ["hasta"], message: "El fin del periodo es anterior al inicio." })
  .refine((v) => Date.parse(v.hasta) - Date.parse(v.desde) <= 5 * 366 * 86_400_000, { path: ["hasta"], message: "El periodo máximo es de cinco años." });
export type ExportRequest = z.infer<typeof exportRequestSchema>;

export function parseExportRequest(raw: unknown): ExportRequest {
  const r = exportRequestSchema.safeParse(raw);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const i of r.error.issues) fields[String(i.path[0] ?? "")] = i.message;
    throw new DomainError("La solicitud de exportación no es válida.", fields);
  }
  return r.data;
}

/** Resuelve parámetros de ejecución (ids del ámbito, fotografía del backlog y umbrales) DENTRO de la lectura coherente del llamador. */
export async function resolveParams(tx: Tx, req: ExportRequest): Promise<{ params: Params; context: Record<string, unknown> }> {
  const scope = req.scope;
  let ids: string[];
  let entityName: string | null = null;
  if (req.sel) {
    const e = scope === "group" ? await tx.clientGroup.findUnique({ where: { id: req.sel }, select: { id: true, name: true } }) : await tx.client.findFirst({ where: { id: req.sel, isInternal: false }, select: { id: true, name: true } });
    if (!e) throw new DomainError("La entidad seleccionada no existe en este ámbito.", { sel: "No existe." });
    ids = [e.id];
    entityName = e.name;
  } else {
    ids = (scope === "group" ? await tx.clientGroup.findMany({ select: { id: true } }) : await tx.client.findMany({ where: { isInternal: false }, select: { id: true } })).map((x) => x.id);
  }
  const quality = await getActive(tx, "QUALITY");
  const batches = await loadTicketBatches(tx);
  const choice = chooseSnapshot(req.hasta, batches.map((b) => ({ batchId: b.batchId, observedOn: b.observedOn, extractionKnown: b.extractionKnown, population: b.population, statusScope: b.statusScope })), quality.payload.snapshotPolicy);
  const used = choice.kind === "EXACT" || choice.kind === "EARLIER" ? choice : null;
  const th = quality.payload.incidents.concerningDays;
  const params: Params = { scope, ids, sel: req.sel || null, from: req.desde, to: req.hasta, service: req.servicio, snapshotBatchId: used?.batchId ?? null, snapshotObservedOn: used?.observedOn ?? null, agedThresholds: { incident: th.incident, problem: th.problem } };
  return { params, context: { ambito: scope === "group" ? "Grupo Cliente" : "Cliente", entidad: entityName, entidades_en_ambito: ids.length, snapshot: { tipo: choice.kind, observadaEl: used?.observedOn ?? null, nota: choice.note, provisional: choice.kind === "EARLIER" }, umbrales_envejecido: th } };
}

export async function countFiles(tx: Tx, ds: DatasetDef, params: Params): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const f of ds.files) out[f.fileKey] = Number((await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM (${f.sql(params)}) q`))[0].n);
  return out;
}

/** Vista de un trabajo para pantalla y API (sin rutas ni identificadores internos de almacenamiento). */
export type ExportView = {
  id: string; dataset: string; datasetLabel: string; status: string; phase: string | null; progressDone: string; progressTotal: string | null; cancelRequested: boolean;
  query: ExportRequest; createdAt: string; startedAt: string | null; finishedAt: string | null; expiresAt: string | null; lastError: string | null; attempts: number; maxAttempts: number;
  requested: { stamp: string; readAt: string; totals: Record<string, number> };
  material: { stamp: string; readAt: string; rows: string; laterThanScreen: boolean } | null;
  files: { id: string; fileKey: string; part: number; kind: string; name: string; rows: string; bytes: string; checksum: string; additive: boolean }[];
  owner: { id: string; email: string };
  mine: boolean;
  workerWarning: string | null;
};

type JobRow = Prisma.ExportJobGetPayload<{ include: { files: true; owner: { select: { id: true; email: true } } } }>;
const include = { files: { orderBy: [{ fileKey: "asc" as const }, { part: "asc" as const }] }, owner: { select: { id: true, email: true } } };

/** Sin trabajador un trabajo en cola no avanza: se avisa en pantalla (no queda un spinner indefinido). */
const WORKER_STALE_MS = 90_000;
async function workerAlive(): Promise<boolean> {
  const r = await prisma.$queryRaw<{ alive: boolean }[]>(Prisma.sql`SELECT EXISTS (SELECT 1 FROM "UploadJob" WHERE "heartbeatAt" > now() - ${WORKER_STALE_MS} * interval '1 millisecond') OR EXISTS (SELECT 1 FROM "ExportJob" WHERE "heartbeatAt" > now() - ${WORKER_STALE_MS} * interval '1 millisecond') AS alive`);
  return r[0]?.alive === true;
}

function view(j: JobRow, actorId: string, alive: boolean): ExportView {
  const ds = datasetOf(j.dataset);
  const stale = j.status === "QUEUED" && Date.now() - j.createdAt.getTime() > WORKER_STALE_MS && !alive;
  return {
    id: j.id, dataset: j.dataset, datasetLabel: ds?.label ?? j.dataset, status: j.status, phase: j.phase, progressDone: String(j.progressDone), progressTotal: j.progressTotal === null ? null : String(j.progressTotal), cancelRequested: j.cancelRequested,
    query: j.query as ExportRequest, createdAt: j.createdAt.toISOString(), startedAt: j.startedAt?.toISOString() ?? null, finishedAt: j.finishedAt?.toISOString() ?? null, expiresAt: j.expiresAt?.toISOString() ?? null, lastError: j.lastError, attempts: j.attempts, maxAttempts: j.maxAttempts,
    requested: { stamp: j.requestedStamp, readAt: j.requestedReadAt.toISOString(), totals: j.requestedTotals as Record<string, number> },
    material: j.materializedAt ? { stamp: j.materialStamp ?? "", readAt: j.materializedAt.toISOString(), rows: String(j.rowCount ?? 0), laterThanScreen: j.laterThanScreen } : null,
    files: j.files.map((f) => ({ id: f.id, fileKey: f.fileKey, part: f.part, kind: f.kind, name: f.name, rows: String(f.rows), bytes: String(f.bytes), checksum: f.checksum, additive: f.additive })),
    owner: j.owner, mine: j.ownerId === actorId,
    workerWarning: stale ? "No hay un trabajador activo: la exportación sigue en cola y no avanzará hasta que se inicie (npm run worker)." : null,
  };
}

/** Crea el trabajo: valida la consulta, fija el sello y los totales de lo que la pantalla mostraba y encola. No genera nada dentro de la petición. */
export async function createExport(actorId: string, raw: unknown): Promise<ExportView> {
  await authorize(prisma, actorId, "READ");
  const req = parseExportRequest(raw);
  const cfg = exportConfig();
  const ds = datasetOf(req.dataset) as DatasetDef;
  const active = await prisma.exportJob.count({ where: { status: { in: [...ACTIVE_STATUSES] } } });
  const mine = await prisma.exportJob.count({ where: { ownerId: actorId, status: { in: [...ACTIVE_STATUSES] } } });
  if (mine >= cfg.maxActivePerUser) throw new DomainError(`Ya tiene ${mine} exportaciones en curso (máximo ${cfg.maxActivePerUser}). Espere a que terminen o cancele alguna.`);
  if (active >= cfg.maxActiveTotal) throw new DomainError("El sistema tiene el máximo de exportaciones simultáneas. Inténtelo de nuevo en unos minutos.");
  const snap = await prisma.$transaction(
    async (tx) => {
      await authorize(tx, actorId, "READ");
      const { params } = await resolveParams(tx, req);
      const totals = await countFiles(tx, ds, params);
      const stamp = (await readDataStamp(tx)).stamp;
      const manifest = await getManifest(tx);
      const readAt = (await tx.$queryRaw<{ t: Date }[]>(Prisma.sql`SELECT now() AS t`))[0].t;
      return { totals, stamp, manifest, readAt };
    },
    { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 300_000 },
  );
  const total = Object.values(snap.totals).reduce((s, v) => s + v, 0);
  if (total > cfg.maxRows) throw new DomainError(`El conjunto tiene ${total} filas y el máximo por exportación es ${cfg.maxRows}. Reduzca el periodo o el ámbito.`);
  const job = await prisma.exportJob.create({
    data: { ownerId: actorId, dataset: req.dataset, query: req as unknown as Prisma.InputJsonValue, formatVersion: FORMAT_VERSION, engineVersion: ENGINE_VERSION, configRevisions: snap.manifest, requestedStamp: snap.stamp, requestedReadAt: snap.readAt, requestedTotals: snap.totals, phase: "en cola", progressTotal: BigInt(total), maxAttempts: 3 },
    include,
  });
  return view(job, actorId, true);
}

export async function listMyExports(actorId: string, limit = 25): Promise<ExportView[]> {
  await authorize(prisma, actorId, "READ");
  const rows = await prisma.exportJob.findMany({ where: { ownerId: actorId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: limit, include });
  const alive = await workerAlive();
  return rows.map((j) => view(j, actorId, alive));
}

/** Supervisión técnica (Administración): estados de TODOS los trabajos; no habilita la descarga de archivos ajenos. */
export async function superviseExports(actorId: string, limit = 100): Promise<{ jobs: ExportView[]; workerAlive: boolean; counts: Record<string, number> }> {
  await authorize(prisma, actorId, "ADMIN");
  const rows = await prisma.exportJob.findMany({ orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: limit, include });
  const alive = await workerAlive();
  const grouped = await prisma.exportJob.groupBy({ by: ["status"], _count: { _all: true } });
  return { jobs: rows.map((j) => view(j, actorId, alive)), workerAlive: alive, counts: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) };
}

async function owned(actorId: string, id: string): Promise<JobRow> {
  await authorize(prisma, actorId, "READ");
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new DomainError("Exportación no encontrada.");
  const j = await prisma.exportJob.findUnique({ where: { id }, include });
  // Un UUID no autoriza: otra persona recibe el mismo mensaje que si no existiera (sin revelar su existencia).
  if (!j || j.ownerId !== actorId) throw new DomainError("Exportación no encontrada.");
  return j;
}

export async function getExport(actorId: string, id: string): Promise<ExportView> {
  const j = await owned(actorId, id);
  return view(j, actorId, await workerAlive());
}

export async function cancelExport(actorId: string, id: string): Promise<ExportView> {
  const j = await owned(actorId, id);
  if (!(ACTIVE_STATUSES as readonly string[]).includes(j.status)) throw new DomainError("Solo se puede cancelar una exportación en curso.");
  // En cola: cancelación inmediata. En ejecución: se pide y el trabajador la resuelve en la siguiente frontera segura (una transacción de lectura confirmada no se corta).
  const n = await prisma.exportJob.updateMany({ where: { id, ownerId: actorId, status: "QUEUED" }, data: { status: "CANCELLED", phase: "cancelada", finishedAt: new Date(), cancelRequested: true } });
  if (n.count === 0) await prisma.exportJob.updateMany({ where: { id, ownerId: actorId, status: { in: ["PREPARING", "GENERATING"] } }, data: { cancelRequested: true, phase: "cancelación solicitada" } });
  return view((await prisma.exportJob.findUniqueOrThrow({ where: { id }, include })), actorId, true);
}

export async function retryExport(actorId: string, id: string): Promise<ExportView> {
  const j = await owned(actorId, id);
  if (j.status !== "FAILED" && j.status !== "CANCELLED") throw new DomainError("Solo se puede reintentar una exportación fallida o cancelada (una caducada se solicita de nuevo).");
  const cfg = exportConfig();
  const mine = await prisma.exportJob.count({ where: { ownerId: actorId, status: { in: [...ACTIVE_STATUSES] } } });
  if (mine >= cfg.maxActivePerUser) throw new DomainError(`Ya tiene ${mine} exportaciones en curso (máximo ${cfg.maxActivePerUser}).`);
  // Una materialización COMPLETA se reutiliza; si falló antes de completarse el nuevo intento registrará su nueva lectura.
  await prisma.exportJob.update({ where: { id }, data: { status: "QUEUED", phase: "en cola", attempts: 0, cancelRequested: false, lastError: null, finishedAt: null, leaseOwner: null, leaseExpiresAt: null, runAfter: new Date() } });
  return view((await prisma.exportJob.findUniqueOrThrow({ where: { id }, include })), actorId, true);
}

/** Descarga: sesión y rol vigentes, propietario, estado LISTO y vigente. */
export async function authorizeDownload(actorId: string, id: string, fileId: string): Promise<{ storageId: string; name: string; bytes: bigint; checksum: string; kind: string }> {
  const j = await owned(actorId, id);
  if (j.status !== "READY") throw new DomainError("El archivo no está disponible (estado: " + j.status + ").");
  if (j.expiresAt && j.expiresAt.getTime() < Date.now()) throw new DomainError("El archivo ha caducado: solicite la exportación de nuevo.");
  const f = j.files.find((x) => x.id === fileId);
  if (!f) throw new DomainError("Archivo no encontrado.");
  return { storageId: f.storageId, name: f.name, bytes: f.bytes, checksum: f.checksum, kind: f.kind };
}

export { AccessError };
