import { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Sello de datos (CSAPP-06 §10): identifica el ESTADO que afecta a un resultado, por dominio, dentro de la misma instantánea.
 * `MAX(drvVersion)` no basta (una fila puede pasar de la versión 1 a la 2 mientras otra sigue en la 100), así que cada dominio combina
 * recuento, suma de versiones/revisiones y última modificación; una fila que cambia de versión, aparece o desaparece cambia el sello.
 * No es un cierre certificado ni guarda copias: solo permite detectar que dos lecturas no describen el mismo estado.
 */
export type DataStamp = { stamp: string; domains: Record<string, string> };

const DOMAINS: { key: string; sql: Prisma.Sql }[] = [
  { key: "zendesk_tiempos", sql: Prisma.sql`SELECT count(*)::text || ':' || COALESCE(sum("drvVersion"), 0)::text || ':' || COALESCE(sum(revision), 0)::text || ':' || COALESCE(max("updatedAt")::text, '') FROM "ActiveZdTimeEntry"` },
  { key: "wrike_tiempos", sql: Prisma.sql`SELECT count(*)::text || ':' || COALESCE(sum("drvVersion"), 0)::text || ':' || COALESCE(sum(revision), 0)::text || ':' || COALESCE(max("updatedAt")::text, '') FROM "ActiveWrikeTimeEntry"` },
  { key: "tickets", sql: Prisma.sql`SELECT count(*)::text || ':' || COALESCE(max(id), 0)::text FROM "ZdTicketRevision"` },
  // Observaciones: una observación nueva SIN cambio de contenido (misma revisión) cambia la frescura y el stock observado, y debe invalidar el resultado anterior.
  { key: "tickets_observaciones", sql: Prisma.sql`SELECT count(*)::text || ':' || COALESCE(max(id), 0)::text || ':' || COALESCE(max("observedOn")::text, '') FROM "ZdTicketObservation"` },
  { key: "lotes", sql: Prisma.sql`SELECT count(*) FILTER (WHERE status = 'COMPLETED')::text || ':' || count(*)::text || ':' || COALESCE(max("updatedAt")::text, '') FROM "UploadBatch"` },
  { key: "salud", sql: Prisma.sql`SELECT count(*)::text || ':' || COALESCE(sum(version), 0)::text || ':' || COALESCE(max("updatedAt")::text, '') FROM "HealthFeedback"` },
  { key: "cobertura", sql: Prisma.sql`SELECT count(*)::text || ':' || COALESCE(max(id), 0)::text FROM "UploadCoverageDeclaration"` },
  // Puntero vigente de cada ticket: revisión Y observación (una reversión/reproceso puede mover la observación vigente sin cambiar los recuentos).
  { key: "tickets_actuales", sql: Prisma.sql`SELECT md5(COALESCE(string_agg("ticketId" || '=' || COALESCE("currentRevisionId"::text, '') || '@' || COALESCE("currentObservationId"::text, ''), ',' ORDER BY "ticketId"), '')) FROM "ZdTicket"` },
  { key: "finanzas", sql: Prisma.sql`SELECT COALESCE(string_agg(year || '/' || category || '=' || COALESCE("activeBatchId", '-') || '@' || version, ',' ORDER BY year, category), '') FROM "FinanceScope"` },
  { key: "usuarios", sql: Prisma.sql`SELECT count(*)::text || ':' || COALESCE(sum(revision), 0)::text || ':' || COALESCE(sum(value), 0)::text || ':' || COALESCE(max("updatedAt")::text, '') FROM "UserMatrixMonth"` },
  { key: "maestros", sql: Prisma.sql`SELECT (SELECT count(*) || ':' || COALESCE(sum(version), 0) || ':' || COALESCE(max("updatedAt")::text, '') FROM "ClientGroup") || '|' || (SELECT count(*) || ':' || COALESCE(sum(version), 0) || ':' || COALESCE(max("updatedAt")::text, '') FROM "Client") || '|' || (SELECT count(*) || ':' || COALESCE(sum(version), 0) || ':' || COALESCE(max("updatedAt")::text, '') FROM "Implementation") || '|' || (SELECT count(*) || ':' || COALESCE(sum(version), 0) || ':' || COALESCE(max("updatedAt")::text, '') FROM "ServiceTerm") || '|' || (SELECT count(*) || ':' || COALESCE(sum(version), 0) || ':' || COALESCE(max("updatedAt")::text, '') FROM "ExternalIdentity") || '|' || (SELECT count(*) || ':' || COALESCE(sum(version), 0) || ':' || COALESCE(max("updatedAt")::text, '') FROM "Milestone")` },
  { key: "personal", sql: Prisma.sql`SELECT (SELECT count(*) || ':' || COALESCE(sum(version), 0) || ':' || COALESCE(max("updatedAt")::text, '') FROM "PersonTerm") || '|' || (SELECT count(*) || ':' || COALESCE(sum(version), 0) || ':' || COALESCE(max("updatedAt")::text, '') FROM "PersonAlias") || '|' || (SELECT count(*) || ':' || COALESCE(sum(version), 0) || ':' || COALESCE(max("updatedAt")::text, '') FROM "StaffCatalogItem")` },
  { key: "servicios", sql: Prisma.sql`SELECT count(*)::text || ':' || COALESCE(sum(version), 0)::text || ':' || COALESCE(max("updatedAt")::text, '') FROM "ServiceAssignment"` },
  // Manifiesto de revisiones activas: economía, Pulse Rent y Calidad. Activar otra configuración invalida las bandas y estadísticas anteriores.
  { key: "configuracion", sql: Prisma.sql`SELECT (SELECT COALESCE(max("revisionNo"), 0) FROM "EconomicSettingsRevision")::text || '|' || (SELECT COALESCE(max("revisionNo"), 0) FROM "ConfigRevision" WHERE family = 'PULSE')::text || '|' || (SELECT COALESCE(max("revisionNo"), 0) FROM "ConfigRevision" WHERE family = 'QUALITY')::text` },
  { key: "pap", sql: Prisma.sql`SELECT (SELECT count(*) || ':' || COALESCE(sum("drvVersion"), 0) || ':' || COALESCE(max("updatedAt")::text, '') FROM "PapItem") || '|' || (SELECT count(*) || ':' || COALESCE(max(id), 0) FROM "PapRevision")` },
  // Work Items (CSAPP-09 §7): revisiones, OBSERVACIONES (una observación nueva sin cambio de contenido cambia la frescura sin crear un bug nuevo), punteros vigentes,
  // vínculos (versión, estado derivado, revisión manual y fecha de derivación) y su evidencia (que un lote sustenta o deja de sustentar un vínculo).
  { key: "bugs", sql: Prisma.sql`SELECT (SELECT count(*) || ':' || COALESCE(max(id), 0) FROM "WorkItemRevision") || '|' || (SELECT count(*) || ':' || COALESCE(max(id), 0) || ':' || COALESCE(max("observedOn")::text, '') FROM "WorkItemObservation") || '|' || (SELECT md5(COALESCE(string_agg(id || '=' || COALESCE("currentRevisionId"::text, '') || '@' || COALESCE("currentObservationId"::text, ''), ',' ORDER BY id), '')) FROM "WorkItem") || '|' || (SELECT count(*) || ':' || COALESCE(sum(version), 0) || ':' || COALESCE(max(id), 0) || ':' || COALESCE(max("drvAt")::text, '') FROM "WorkItemLink") || '|' || (SELECT count(*) || ':' || COALESCE(max(id), 0) FROM "WorkItemLinkEvidence")` },
];

/** Una sola sentencia por dominio, dentro de la transacción de lectura (instantánea REPEATABLE READ) del llamador. */
export async function readDataStamp(tx: Tx): Promise<DataStamp> {
  const rows = await tx.$queryRaw<{ k: string; v: string }[]>(
    Prisma.sql`SELECT k, v FROM (${Prisma.join(DOMAINS.map((d) => Prisma.sql`SELECT ${d.key}::text AS k, (${d.sql})::text AS v`), " UNION ALL ")}) x`,
  );
  const domains = Object.fromEntries(rows.map((r) => [r.k, r.v]));
  const md5 = (await tx.$queryRaw<{ h: string }[]>(Prisma.sql`SELECT md5(${JSON.stringify(Object.entries(domains).sort())}) AS h`))[0].h;
  return { stamp: md5.slice(0, 16), domains: Object.fromEntries(Object.entries(domains).map(([k, v]) => [k, v.length > 60 ? v.slice(0, 12) + "…" : v])) };
}
