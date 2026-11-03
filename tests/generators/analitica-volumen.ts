import { prisma } from "../../src/lib/db";
import { Prisma } from "../../src/generated/prisma/client";
import { financeMasterStamp } from "../../src/server/finance/resolve";
import { fakeBatch } from "../economia-helpers";

/** Volumen SINTÉTICO por SQL de conjuntos (solo base `_test`): N grupos, T tiempos Zendesk repartidos en 24 meses y matriz de usuarios. */
export async function seedVolumen(adminId: string, today: string, groups: number, times: number) {
  const Y = Number(today.slice(0, 4));
  const b = await fakeBatch(adminId);
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ClientGroup" (id, name, "updatedAt") SELECT 'vg' || i, 'Grupo vol ' || lpad(i::text, 5, '0'), now() FROM generate_series(1, ${groups}) i`);
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Client" (id, "groupId", name, "updatedAt") SELECT 'vc' || i, 'vg' || i, 'Cliente vol ' || i, now() FROM generate_series(1, ${groups}) i`);
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ServiceTerm" (id, attribute, value, "groupId", "updatedAt") SELECT 'vt' || i, 'SUPPORT', (ARRAY['GOLD','PLATINUM','SILVER_RECURRENTE'])[1 + i % 3], 'vg' || i, now() FROM generate_series(1, ${groups}) i`);
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ServiceTerm" (id, attribute, value, "groupId", "updatedAt") SELECT 'vh' || i, 'HOSTING', (ARRAY['CLOUD','OP'])[1 + i % 2], 'vg' || i, now() FROM generate_series(1, ${groups}) i`);
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ServiceAssignment" (id, "matchKind", "matchValue", "searchValue", service, "updatedAt") VALUES ('vsa', 'ENTORNO', 'soporte', 'soporte', 'SOPORTE', now())`);
  for (const year of [Y, Y - 1]) {
    const fb = await fakeBatch(adminId, "facturacion-soporte");
    await prisma.financeBatch.create({ data: { batchId: fb.id, year, category: "SOPORTE", origin: "UPLOAD", tolerance: "0.01", derivedStamp: await financeMasterStamp(prisma) } });
    await prisma.$executeRaw(Prisma.sql`INSERT INTO "FinanceRow" ("batchId", position, "sourceRow", "groupLabel", "sourceKey", fingerprint, income, "groupId", resolution)
      SELECT ${fb.id}, i, i + 1, 'g' || i, 'g' || i, ${fb.id}::text || '-' || i, 12000 + (i % 40) * 600, 'vg' || i, 'RESOLVED' FROM generate_series(1, ${groups}) i`);
    await prisma.financeScope.upsert({ where: { year_category: { year, category: "SOPORTE" } }, create: { year, category: "SOPORTE", activeBatchId: fb.id, version: 2 }, update: { activeBatchId: fb.id } });
  }
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ZdTicket" ("ticketId", "firstBatchId", "updatedAt") SELECT (950000 + i)::text, ${b.id}, now() FROM generate_series(1, 2000) i`);
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ZdTicketRevision" ("ticketId", fingerprint, "revisionNo", "organizationId", entorno, "causaRaiz", "createdOn", "ticketType", status, "typeKnown", "statusKnown", "batchId")
    SELECT (950000 + i)::text, 'fp' || i, 1, (7000 + i % ${groups})::text, 'Soporte', (ARRAY['incidente_estándar_plataforma','Sistemas del Cliente','Uso Indebido','incidente_infraestructura'])[1 + i % 4], (${`${Y}-01-01`}::date + (i % 300)), (ARRAY['incident','problem'])[1 + i % 2], 'open', true, true, ${b.id} FROM generate_series(1, 2000) i`);
  await prisma.$executeRaw(Prisma.sql`UPDATE "ZdTicket" t SET "currentRevisionId" = r.id FROM "ZdTicketRevision" r WHERE r."ticketId" = t."ticketId"`);
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ZdTimeEntry" (id, "originFingerprint", "firstBatchId", "ticketId", "workDate", "loggedHours", "loggedMinutes", minutes, fingerprint, "drvGroupId", "drvClientId", "drvEligibility", "drvBucket", "drvPmo", "updatedAt")
    SELECT 'vz' || i, 'vzo' || i, ${b.id}, (950001 + i % 2000)::text, ((${`${Y - 1}-01-01`}::date) + (i % 700)), 0, 15 + (i % 8) * 15, 15 + (i % 8) * 15, 'vf' || i, 'vg' || (1 + i % ${groups}), 'vc' || (1 + i % ${groups}), 'ELIGIBLE', 'ATTRIBUTABLE', false, now()
    FROM generate_series(1, ${times}) i`);
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "UserMatrix" (id, "groupId", year, "updatedAt") SELECT 'vm' || i || '-' || y, 'vg' || i, y, now() FROM generate_series(1, ${groups}) i, unnest(ARRAY[${Y}, ${Y - 1}]::int[]) y`);
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "UserMatrixMonth" ("matrixId", month, value, kind, source, "updatedById", "updatedAt") SELECT m.id, mo, 10 + length(m."groupId") % 50, 'ADJUSTED', 'sintético', ${adminId}, now() FROM "UserMatrix" m, generate_series(1, 12) mo`);
}
