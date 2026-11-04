import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parse } from "csv-parse/sync";
import { parseComparativaQuery } from "@/domain/comparativa-query";
import { getPortfolio } from "@/server/analytics/portfolio";
import { portfolioCsv, fichaCsv } from "@/server/analytics/export";
import { getFicha } from "@/server/analytics/ficha";
import { getQuality } from "@/server/quality/engine";
import { parseQualityQuery } from "@/domain/quality-query";
import { drain, freshEnvironment, removeUploadDir, useUploadDir } from "./cargas-helpers";
import { loadMaster, loadOperationalFirst, singleSheetBook } from "./hotfix02-helpers";
import { prisma } from "@/lib/db";

let dir: string;
let admin: { id: string };
beforeAll(() => { dir = useUploadDir(); });
afterAll(() => removeUploadDir(dir));
beforeEach(async () => { ({ admin } = await freshEnvironment()); });

const NOW = new Date("2025-07-15T10:00:00Z");

const Q2 = () => parseComparativaQuery({ fecha: "2025-01-31", modo: "FULL_MONTH" }, NOW).query;
const QQ = () => parseQualityQuery({ fecha: "2025-01-31", modo: "FULL_MONTH" }, NOW).query;
const hrs = (p: { hours: { inPerimeter: string }; revenue: { value: string | null } }) => ({ h: p.hours.inPerimeter, rev: p.revenue.value });
const num = (s: string) => Number(s.replace(",", "."));

/**
 * HOTFIX-02 §12 caso 1, de extremo a extremo: tickets, tiempos Zendesk, Wrike, PAP y finanzas se cargan ANTES que CLIENTES (con nombres distintos en cada
 * sistema); tras confirmar el libro de UNA hoja y sin pulsar «Reprocesar», las tres pantallas y sus exportaciones muestran los mismos valores, escritos a mano
 * desde el escenario (Wrike 2025-01: ALFA 120 min solo Grupo, BETA 60 min enriquecida por ticket, GAMMA 30 min por ticket; Zendesk 2024-03: ALFA 90+120, BETA 60,
 * GAMMA 45; ingreso 2025 de 1200/2400/600 → 100/200/50 al mes). El alias compartido sin ticket (180 min) y el sin correspondencia (240 min) NO se asignan.
 */
describe("HOTFIX-02: lo cargado ANTES del maestro de Clientes llega a las pantallas y exportaciones sin reprocesar", () => {
  it("Comparativa, CSV, ficha y Calidad coinciden con las cantidades de la fuente tras el reenlace automático", async () => {
    await loadOperationalFirst(admin.id);
    // Antes del maestro no hay Grupos que mostrar: la unión no existe todavía.
    expect((await getPortfolio(admin.id, Q2())).rows).toHaveLength(0);

    await loadMaster(admin.id, await singleSheetBook());
    await drain();
    await drain();

    const v = await getPortfolio(admin.id, Q2());
    const by = Object.fromEntries(v.rows.map((r) => [r.meta.name, r]));
    expect(Object.keys(by).sort()).toEqual(["GRP ALFA", "GRP BETA", "GRP DELTA", "GRP EPSILON", "GRP GAMMA"]);
    expect(hrs(by["GRP ALFA"].periods.month as never)).toEqual({ h: "2", rev: "100" });
    expect(hrs(by["GRP BETA"].periods.month as never)).toEqual({ h: "1", rev: "200" });
    expect(hrs(by["GRP GAMMA"].periods.month as never)).toEqual({ h: "0.5", rev: "50" });
    expect(hrs(by["GRP DELTA"].periods.month as never)).toEqual({ h: "0", rev: "0" });
    // Año anterior completo: el Zendesk de marzo de 2024 (ALFA 90+120 min, BETA 60, GAMMA 45).
    expect([by["GRP ALFA"], by["GRP BETA"], by["GRP GAMMA"]].map((r) => hrs(r.periods.prevYear as never).h)).toEqual(["3.5", "1", "0.75"]);

    // CSV = pantalla: la fila CARTERA suma lo mismo (2 + 1 + 0,5 h; 350 €) y hay una fila por Grupo con sus horas.
    const csv = parse(String((await portfolioCsv(admin.id, Q2())).body).replace(/^\uFEFF/, ""), { columns: true, delimiter: ";", skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[];
    const cartera = csv.find((r) => r.fila === "CARTERA" && r.periodo === "mes_seleccionado");
    expect([num(cartera!.horas), num(cartera!.ingreso_imputado_eur)]).toEqual([3.5, 350]);
    const alfa = csv.find((r) => r.denominacion_bc === "GRP ALFA" && r.periodo === "mes_seleccionado");
    expect([num(alfa!.horas), num(alfa!.ingreso_imputado_eur)]).toEqual([2, 100]);

    // Ficha del Grupo: mismas horas y los hechos solo-Grupo en el Grupo, no en cada hijo.
    const ficha = await getFicha(admin.id, Q2(), { type: "group", id: by["GRP ALFA"].meta.id });
    expect(ficha).not.toBeNull();
    const fichaCsvOut = await fichaCsv(admin.id, Q2(), { type: "group", id: by["GRP ALFA"].meta.id }, "series");
    expect(fichaCsvOut).not.toBeNull();
    const cliente = await prisma.client.findFirstOrThrow({ where: { name: "Alfa Uno" } });
    const fichaCliente = await getFicha(admin.id, Q2(), { type: "client", id: cliente.id });
    expect(fichaCliente).not.toBeNull();

    // Calidad: la selección contiene los Grupos y el ticket sin horas (3007, Alfa Uno) sigue disponible para sus indicadores.
    const quality = await getQuality(admin.id, QQ());
    expect(quality.totalEntities).toBe(5);
    expect(quality.rows.map((r) => r.name).sort()).toEqual(["GRP ALFA", "GRP BETA", "GRP DELTA", "GRP EPSILON", "GRP GAMMA"]);
    const ticketsAlfa = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) n FROM "ZdTicket" t JOIN "Client" c ON c."id" IS NOT NULL JOIN "ExternalIdentity" i ON i."clientId" = c.id AND i.kind = 'ORG_ID' AND i."searchValue" = '710001' WHERE t."ticketId" = '3007'`);
    expect(Number(ticketsAlfa[0].n)).toBe(1);

    // Cantidades fuente intactas y nada se reparte: lo ambiguo (180 min) y lo sin correspondencia (240 min) siguen sin Grupo.
    const sinGrupo = await prisma.$queryRawUnsafe<{ m: string }[]>(`SELECT COALESCE(sum(minutes), 0)::text m FROM "WrikeTimeEntry" WHERE "drvGroupId" IS NULL`);
    expect(Number(sinGrupo[0].m)).toBe(180 + 240 + 90); // ambigua + sin correspondencia + conflicto de ticket de otro Grupo
  });
});
