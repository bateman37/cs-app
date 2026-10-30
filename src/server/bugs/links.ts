import { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Resolución derivada de los vínculos Work Item–ticket contra los tickets cargados (BUG 06). Un ticket interno es el ticket
 * central: no identifica a los clientes afectados. El tipo real del ticket se conserva (un incident no pasa a problem).
 * Solo escribe los vínculos que cambian (idempotente); no toca evidencias ni decisiones manuales.
 */
export async function rederiveWorkItemLinks(tx: Tx, where: Prisma.Sql): Promise<number> {
  await tx.$executeRaw(Prisma.sql`DROP TABLE IF EXISTS "_wl_drv"`);
  await tx.$executeRaw(Prisma.sql`
    CREATE TEMP TABLE "_wl_drv" ON COMMIT DROP AS
    SELECT l.id, rev."ticketType" AS ticket_type, idn."clientId" AS client_id, c."groupId" AS group_id, c."isInternal" AS internal,
      CASE WHEN t."ticketId" IS NULL THEN 'PENDING_TICKET'
           WHEN c."isInternal" IS TRUE THEN 'CENTRAL_INTERNAL'
           WHEN c.id IS NOT NULL THEN 'RESOLVED_EXTERNAL'
           ELSE 'NO_CLIENT' END AS state
    FROM "WorkItemLink" l
    LEFT JOIN "ZdTicket" t ON t."ticketId" = l."ticketId"
    LEFT JOIN "ZdTicketRevision" rev ON rev.id = t."currentRevisionId"
    LEFT JOIN LATERAL (
      SELECT e."clientId" FROM "ExternalIdentity" e
      WHERE rev."organizationId" IS NOT NULL AND e.system = 'ZENDESK' AND e.kind = 'ORG_ID' AND e."isActive" AND e."searchValue" = rev."organizationId"
        AND (e."validFrom" IS NULL OR e."validFrom" <= rev."createdOn") AND (e."validTo" IS NULL OR rev."createdOn" < e."validTo") LIMIT 1) idn ON true
    LEFT JOIN "Client" c ON c.id = idn."clientId"
    WHERE ${where}`);
  await tx.$executeRaw(Prisma.sql`CREATE INDEX ON "_wl_drv" (id)`);
  return tx.$executeRaw(Prisma.sql`
    UPDATE "WorkItemLink" l SET "drvState" = d.state, "drvTicketType" = d.ticket_type, "drvClientId" = d.client_id, "drvGroupId" = d.group_id,
      "drvInternal" = d.internal, "drvAt" = now()
    FROM "_wl_drv" d
    WHERE l.id = d.id AND (l."drvState", l."drvTicketType", l."drvClientId", l."drvGroupId", l."drvInternal")
      IS DISTINCT FROM (d.state, d.ticket_type, d.client_id, d.group_id, d.internal)`);
}
