import { prisma } from "@/lib/db";
import { confirmUpload } from "@/server/uploads/batches";
import { decideFinance } from "@/server/finance/review";
import { batch, drain, uploadText } from "./cargas-helpers";
import { buildBook, cliente } from "./generators/precarga-maestros";
import { ticket, ticketsBuffer, timeRow, timesBuffer, excelSerial } from "./generators/zendesk";
import { papBuffer, papRow, wrikeCsv, wrikeRow } from "./generators/csapp04";
import { PAP, importFile, importWrike, addWrikePerson } from "./csapp04-helpers";
import { importZd, TICKETS, TIEMPO, addPerson } from "./zendesk-helpers";
import { importFin } from "./finanzas-helpers";

/**
 * Escenario SINTÉTICO de HOTFIX-02 (nombres inventados distintos entre sistemas: nada procede de datos reales). Mapa del libro de Clientes:
 *   GRP ALFA  : dos Clientes (710001 «Alfa Uno», 710002 «Alfa Dos»), Wrike «W-ALFA», PAP «P-ALFA-1» y «P-ALFA-2» (una implantación cada uno).
 *   GRP BETA  : un Cliente (710003 «Beta Org»), Wrike «W-BETA», PAP «P-BETA».
 *   GRP GAMMA / GRP DELTA : Clientes 710004 «Gamma Org» y 710005 «Delta Org»; el alias Wrike «W-COMPARTIDO» y el PAP «P-MULTI» figuran en AMBOS Grupos.
 *   GRP EPSILON : Cliente 710006 con los dos niveles de servicio (E y H) discrepantes.
 *   «VINCLE INTERNO» 710099: organización interna sin Grupo.
 */
export const CLIENT_ROWS = [
  cliente("W-ALFA", "GRP ALFA", "710001", "Alfa Uno", "Gold", "GRP ALFA", "OP", "Gold", "P-ALFA-1", "GRP ALFA", "Basic"),
  cliente("W-ALFA", "GRP ALFA", "710002", "Alfa Dos", "Gold", "GRP ALFA", "OP", "Gold", "P-ALFA-2", "GRP ALFA", "Medium"),
  cliente("W-BETA", "GRP BETA", "710003", "Beta Org", "Platinum", "GRP BETA", "CLOUD", "Platinum", "P-BETA", "GRP BETA", "Medium"),
  cliente("W-COMPARTIDO", "GRP GAMMA", "710004", "Gamma Org", "Gold", "GRP GAMMA", "OP", "Gold", "P-MULTI", "GRP GAMMA", "Medium"),
  cliente("W-COMPARTIDO", "GRP DELTA", "710005", "Delta Org", "Gold", "GRP DELTA", "OP", "Gold", "P-MULTI", "GRP DELTA", "Medium"),
  cliente(null, "GRP EPSILON", "710006", "Epsilon Org", "Gold", "GRP EPSILON", "OP", "Silver On Demand", null, "GRP EPSILON", null),
  cliente(null, null, "710099", "VINCLE INTERNO", "", null, null, "", null, null, null),
];

/** Libro de UNA hoja (solo CLIENTES), como el archivo actual de Dennis. */
export const singleSheetBook = (rows = CLIENT_ROWS) => buildBook({ omit: ["PERSONAL", "PERSONAL PMO"], clients: rows });

export async function loadMaster(adminId: string, book: Buffer, name = "CLIENTES.xlsx") {
  const { id } = await uploadText(adminId, book, { profileId: "precarga-maestros", name });
  await drain();
  const prepared = await batch(id);
  if (prepared.status !== "READY") throw new Error(`Precarga en ${prepared.status}: ${prepared.statusDetail ?? ""}`);
  await confirmUpload(adminId, id);
  await drain();
  const done = await batch(id);
  if (done.status !== "COMPLETED") throw new Error(`Precarga en ${done.status}: ${done.statusDetail ?? ""}`);
  return done;
}

const d = (iso: string) => ({ date: excelSerial(iso) });

/** Tickets: uno por organización más uno sin horas (sirve a Calidad). */
export const TICKET_ROWS = [
  ticket({ ticket_id: "3001", organization_id: "710001", creada: d("2024-03-05") }), // Alfa Uno
  ticket({ ticket_id: "3002", organization_id: "710003", creada: d("2024-03-05") }), // Beta
  ticket({ ticket_id: "3003", organization_id: "710004", creada: d("2024-03-05") }), // Gamma
  ticket({ ticket_id: "3004", organization_id: "710005", creada: d("2024-03-05") }), // Delta
  ticket({ ticket_id: "3005", organization_id: "710002", creada: d("2024-03-05") }), // Alfa Dos
  ticket({ ticket_id: "3006", organization_id: "710006", creada: d("2024-03-05") }), // Epsilon
  ticket({ ticket_id: "3007", organization_id: "710001", creada: d("2024-03-05") }), // sin horas
];

/** Personal sintético existente ANTES de los maestros de Clientes (HOTFIX-02 no exige volver a cargar Personal). */
export async function seedPersonal() {
  const ana = await addPerson({ name: "Ana Prueba", zdId: "5001", zdName: "Ana Prueba", pmo: [[null, null, false]] });
  const pmo = await addWrikePerson({ name: "Pmo Uno", alias: "pmo.uno", pmo: [["2025-01-01", null, true]], role: [{ name: "ANA" }] });
  return { ana, pmo };
}

export const ZD_TIMES = [
  timeRow({ ticket_id: "3001", logged_hours: 1, logged_minutes: 30 }), // 90
  timeRow({ ticket_id: "3002", logged_hours: 1, logged_minutes: 0, date: d("2024-03-07") }), // 60
  timeRow({ ticket_id: "3003", logged_hours: 0, logged_minutes: 45, date: d("2024-03-08") }), // 45
  timeRow({ ticket_id: "3005", logged_hours: 2, logged_minutes: 0, date: d("2024-03-09") }), // 120
  timeRow({ ticket_id: "9999", logged_hours: 0, logged_minutes: 15, date: d("2024-03-10") }), // ticket inexistente
];
export const ZD_TOTAL_MINUTES = 90 + 60 + 45 + 120 + 15;

/** Wrike (2025, personas PMO): sumar a Grupo sin ticket, resolver el alias compartido con ticket, conflicto, enriquecer con ticket y alias ambiguo sin ticket. */
export const WRIKE_ROWS = [
  wrikeRow({ usuario: "pmo.uno", proyecto: "W-ALFA", tarea: "Sin ticket en Grupo", fecha: "15/01/2025", horas: "2" }), // 120 → GRP ALFA (solo Grupo)
  wrikeRow({ usuario: "pmo.uno", proyecto: "W-BETA", tarea: "Con ticket de Beta", ticket: "3002", fecha: "16/01/2025", horas: "1" }), // 60 → Beta Org (enriquecida)
  wrikeRow({ usuario: "pmo.uno", proyecto: "W-COMPARTIDO", tarea: "Alias compartido y ticket de Gamma", ticket: "3003", fecha: "17/01/2025", horas: "0,5" }), // 30 → Gamma
  wrikeRow({ usuario: "pmo.uno", proyecto: "W-COMPARTIDO", tarea: "Alias compartido sin ticket", fecha: "18/01/2025", horas: "3" }), // 180 → sin asignar (ambigua)
  wrikeRow({ usuario: "pmo.uno", proyecto: "W-COMPARTIDO", tarea: "Alias compartido y ticket de otro Grupo", ticket: "3001", fecha: "19/01/2025", horas: "1,5" }), // 90 → conflicto
  wrikeRow({ usuario: "pmo.uno", proyecto: "Proyecto sin equivalencia", tarea: "Sin correspondencia", fecha: "20/01/2025", horas: "4" }), // 240 → sin correspondencia
];
export const WRIKE_TOTAL_MINUTES = 120 + 60 + 30 + 180 + 90 + 240;

export const PAP_ROWS = [
  papRow({ Title: "ID 501: alfa 1", Proyecto: "P-ALFA-1", "Causa raíz": "Correctivo estándar, Evolutivo" }), // varias causas: un PAP
  papRow({ Title: "ID 502: alfa 2", Proyecto: "P-ALFA-2" }),
  papRow({ Title: "ID 503: compartido gamma", Proyecto: "P-MULTI", "Tickets asociados": "3003" }), // → GRP GAMMA por ticket
  papRow({ Title: "ID 504: compartido sin ticket", Proyecto: "P-MULTI" }), // ambiguo
  papRow({ Title: "ID 505: sin equivalencia", Proyecto: "P-NINGUNO" }),
];

export const FIN_TOTAL = { total: { vta: 4200 } };
export const FIN_ROWS = [
  { grupo: "grp  ALFA ", vta: 1200 }, // otra caja y espacios que la denominación BC del libro
  { grupo: "GRP BETA", vta: 2400 },
  { grupo: "GRP GAMMA", vta: 600 },
];

/** Carga TODOS los operativos con el maestro de Clientes aún ausente (el finanzas se acepta sin asignar). */
export async function loadOperationalFirst(adminId: string) {
  await seedPersonal();
  await importZd(adminId, TICKETS, await ticketsBuffer(TICKET_ROWS));
  await importZd(adminId, TIEMPO, await timesBuffer(ZD_TIMES));
  await importWrike(adminId, wrikeCsv(WRIKE_ROWS));
  await importFile(adminId, PAP, await papBuffer(PAP_ROWS));
  await importFin(adminId, "SOPORTE", 2025, FIN_ROWS, {
    total: { vta: 4200 },
    unassigned: true,
    decide: async (id) => {
      await decideFinance(adminId, id, { kind: "ACCEPT_UNASSIGNED" });
    },
  });
}

// ---------------------------------------------------------------- Lecturas para las comprobaciones (conteos y cantidades, sin helpers de resolución)

export async function groupName(id: string | null): Promise<string | null> {
  if (!id) return null;
  return (await prisma.clientGroup.findUnique({ where: { id }, select: { name: true } }))?.name ?? null;
}

export type WrikeOut = { task: string; minutes: string; group: string | null; client: string | null; bucket: string; flags: string[]; conflict: boolean };
export async function wrikeOut(): Promise<WrikeOut[]> {
  return prisma.$queryRawUnsafe<WrikeOut[]>(`
    SELECT e."taskName" AS task, trim_scale(e.minutes)::text AS minutes, g.name AS "group", c.name AS client, e."drvBucket" AS bucket, e."drvFlags" AS flags, e."drvConflict" AS conflict
    FROM "WrikeTimeEntry" e LEFT JOIN "ClientGroup" g ON g.id = e."drvGroupId" LEFT JOIN "Client" c ON c.id = e."drvClientId" ORDER BY e."workDate"`);
}
export type ZdOut = { ticket: string; minutes: string; group: string | null; client: string | null; bucket: string };
export async function zdOut(): Promise<ZdOut[]> {
  return prisma.$queryRawUnsafe<ZdOut[]>(`
    SELECT e."ticketId" AS ticket, trim_scale(e.minutes)::text AS minutes, g.name AS "group", c.name AS client, e."drvBucket" AS bucket
    FROM "ZdTimeEntry" e LEFT JOIN "ClientGroup" g ON g.id = e."drvGroupId" LEFT JOIN "Client" c ON c.id = e."drvClientId" ORDER BY e."workDate", e."ticketId"`);
}
export type PapOut = { pap: string; scope: string; group: string | null; client: string | null };
export async function papOut(): Promise<PapOut[]> {
  return prisma.$queryRawUnsafe<PapOut[]>(`
    SELECT t."papId" AS pap, t."drvScope" AS scope, g.name AS "group", c.name AS client
    FROM "PapItem" t LEFT JOIN "ClientGroup" g ON g.id = t."drvGroupId" LEFT JOIN "Client" c ON c.id = t."drvClientId" ORDER BY t."papId"`);
}
export async function financeOut(): Promise<{ label: string; income: string; group: string | null }[]> {
  return prisma.$queryRawUnsafe(`
    SELECT r."groupLabel" AS label, trim_scale(r.income)::text AS income, g.name AS "group"
    FROM "FinanceScope" s JOIN "FinanceRow" r ON r."batchId" = s."activeBatchId" LEFT JOIN "ClientGroup" g ON g.id = r."groupId"
    WHERE s.year = 2025 AND s.category = 'SOPORTE' ORDER BY r."groupLabel"`);
}
export async function sumMinutes(table: "ZdTimeEntry" | "WrikeTimeEntry"): Promise<number> {
  return Number((await prisma.$queryRawUnsafe<{ s: string }[]>(`SELECT COALESCE(sum(minutes),0)::text AS s FROM "${table}"`))[0].s);
}
